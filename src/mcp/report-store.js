/* ============================================================
   Apply-report storage and retention
   (MCP-AGENT-FIRST 2026-11-12, ADDENDUM A6, steps 3.6 / 5.3)
   ------------------------------------------------------------
   An accept report is one entry per op, and a bulk proposal can carry
   thousands of ops, so the stored JSON had no bound: a 5000-op proposal wrote
   a multi-hundred-KB row into D1 and kept it forever.

   Two rules now apply:

   1. SIZE. `storeApplyReport` keeps at most MCP_REPORT_MAX_ENTRIES entries and
      stores a `summary` counted over EVERY entry, so a truncated report still
      tells the agent how much landed. `truncated` and `storedCount` make the
      cap explicit rather than silent.

   2. RETENTION. `pruneDecidedReports` runs from the daily cron. A decided row
      older than MCP_REPORT_RETENTION_DAYS loses its op list (`ops_json`, the
      only copy of what the agent proposed) and its entry list, keeping a small
      `{pruned: true, summary}` blob so `get_apply_report` can answer
      "this happened, here is the tally" instead of "no report".
      Pending and accepting rows are never touched - the owner may still
      decide them.
   ============================================================ */

export const MCP_REPORT_MAX_ENTRIES = 500;
export const MCP_REPORT_RETENTION_DAYS = 90;

// How many rows one cron run examines per batch, and how many batches it will
// drain. A large backlog clears over a few days instead of holding the cron
// open; the sweep is idempotent, so a partial pass is always safe.
const PRUNE_BATCH = 500;
const PRUNE_MAX_BATCHES = 10;

const DECIDED = ['accepted', 'rejected', 'withdrawn'];

// Counts by outcome over the WHOLE report, not the stored slice. `applied` and
// `skipped` are the two an agent cares about; `conflict` and `superseded` say
// why the rest did not land.
export function summarizeApplyReport(report) {
  const all = Array.isArray(report) ? report : [];
  const summary = {
    total: all.length,
    applied: 0,
    skipped: 0,
    conflict: 0,
    superseded: 0,
    other: 0
  };
  for (let i = 0; i < all.length; i++) {
    const entry = all[i];
    const result = entry && entry.result;
    if (result === 'applied') {
      summary.applied++;
    } else if (result === 'skipped_already') {
      summary.skipped++;
    } else if (result === 'conflict') {
      summary.conflict++;
    } else if (result === 'superseded') {
      summary.superseded++;
    } else {
      summary.other++;
    }
  }
  return summary;
}

// The blob written to cloud_reviews.apply_report_json. Versioned so a later
// reader can tell a v1 row from the pre-A6 `{report, derivedChanges}` shape.
export function storeApplyReport(report, derivedChanges, conflicts) {
  const all = Array.isArray(report) ? report : [];
  const kept = all.slice(0, MCP_REPORT_MAX_ENTRIES);
  const conflictRows = Array.isArray(conflicts)
    ? conflicts
    : all.filter(function (r) {
        return r && r.result === 'conflict';
      });
  return JSON.stringify({
    v: 1,
    summary: summarizeApplyReport(all),
    report: kept,
    truncated: all.length > kept.length,
    storedCount: kept.length,
    derivedChanges: Array.isArray(derivedChanges) ? derivedChanges : [],
    conflicts: conflictRows
  });
}

// True when the stored blob has already been reduced to its summary.
export function isPrunedReport(report) {
  return !!(report && report.pruned === true);
}

// Daily sweep. Returns what it did so the cron log can prove it ran.
export async function pruneDecidedReports(env, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const cutoff = new Date(now - MCP_REPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let cursor = 0;
  let scanned = 0;
  let opsCleared = 0;
  let reportsPruned = 0;
  for (let batch = 0; batch < PRUNE_MAX_BATCHES; batch++) {
    const rows =
      (
        await env.DB.prepare(
          'SELECT id, status, decided_at, ops_json, apply_report_json FROM cloud_reviews WHERE id > ? AND decided_at IS NOT NULL AND decided_at < ? ORDER BY id ASC LIMIT ' +
            PRUNE_BATCH
        )
          .bind(cursor, cutoff)
          .all()
      ).results || [];
    if (!rows.length) {
      break;
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowId = Number(row.id) || 0;
      if (rowId > cursor) {
        cursor = rowId;
      }
      scanned++;
      // The SELECT already narrows on D1. These two guards keep a mock store
      // (or a stale read) from pruning a row that is not old enough or not
      // decided yet - retention is never worth a data loss.
      if (!row.decided_at || String(row.decided_at) >= cutoff) {
        continue;
      }
      if (DECIDED.indexOf(row.status) === -1) {
        continue;
      }
      if (row.ops_json != null) {
        await env.DB.prepare('UPDATE cloud_reviews SET ops_json = NULL WHERE id = ?')
          .bind(row.id)
          .run();
        opsCleared++;
      }
      if (row.apply_report_json) {
        let report = null;
        try {
          report = JSON.parse(row.apply_report_json);
        } catch (e) {
          report = null;
        }
        if (report && !isPrunedReport(report)) {
          const summary = report.summary || summarizeApplyReport(report.report);
          const slim = JSON.stringify({
            v: 1,
            summary: summary,
            pruned: true,
            prunedAt: new Date(now).toISOString()
          });
          await env.DB.prepare('UPDATE cloud_reviews SET apply_report_json = ? WHERE id = ?')
            .bind(slim, row.id)
            .run();
          reportsPruned++;
        }
      }
    }
  }
  return { scanned: scanned, opsCleared: opsCleared, reportsPruned: reportsPruned, cutoff: cutoff };
}
