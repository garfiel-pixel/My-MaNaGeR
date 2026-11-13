/* ============================================================
   get_changes_since — the audit read
   (MCP-AGENT-FIRST 2026-11-12, Phase 4.2)
   ------------------------------------------------------------
   An agent that has been away can ask what changed since a timestamp and get
   every accepted change back with its attribution, instead of re-reading the
   whole project and diffing it itself.

   Shape of one entry:
     {changeId, at, approvedBy:{type,label}, source:{type,label,keyId},
      proposalId, changeSetId, changes:[{path, recordId, recordName, field,
      before, after}], moreInEntry?}

   Paging is deliberately two-dimensional. `limit` caps ENTRIES (max 200) and
   a hard cap of 500 CHANGES applies per call. When one entry alone exceeds
   what is left, it is returned in part with `moreInEntry: true` and a cursor
   of `<changeId>:<offset>` pointing at the first change not yet sent. `since`
   is an ISO timestamp; `cursor` resumes exactly where the last page stopped.

   The full diff list is read from `diffs_key` (R2) when the entry has one -
   that is the copy `cloudLogSave` writes for entries whose leaf count is over
   the inline cap, where `diffs_json` is deliberately null. Older rows fall
   back to `diffs_json`.
   ============================================================ */

import { CLOUD_KEY_TO_SECTION } from '../lib/http.js';
import { budgetReadAllowed } from './budget-access.js';

export const CHANGES_MAX_PER_CALL = 500;
export const CHANGES_MAX_ENTRIES = 200;
const CHANGES_DEFAULT_ENTRIES = 50;

// Budget tables are gated by the read switch as well as the section, exactly
// like get_table.
const BUDGET_KEYS = ['budgetLines', 'spendLog', 'budgetEnvelope', 'nspid'];

function sectionAllowed(scope, sec) {
  return !Array.isArray(scope) || scope.indexOf(sec) !== -1;
}

function topKey(path) {
  return String(path || '').split(/[.[]/)[0];
}

// One change is visible when its table is inside the key's sections, its
// budget gate is open, and it matches the optional path filter. An unknown
// path is never visible: the audit trail must not become a way around scope.
function changeAllowed(diff, scope, auth, pathFilter) {
  const key = topKey(diff && diff.path);
  if (!key) {
    return false;
  }
  const section = CLOUD_KEY_TO_SECTION[key];
  if (section === undefined) {
    return false;
  }
  if (!sectionAllowed(scope, section)) {
    return false;
  }
  if (BUDGET_KEYS.indexOf(key) !== -1 && !budgetReadAllowed(auth)) {
    return false;
  }
  if (pathFilter && key !== pathFilter) {
    return false;
  }
  return true;
}

// Parse `<changeId>:<offset>`. Anything malformed starts from the beginning
// rather than throwing at an agent that guessed the format.
function parseCursor(cursor) {
  if (typeof cursor !== 'string' || cursor.indexOf(':') === -1) {
    return { id: 0, offset: 0 };
  }
  const parts = cursor.split(':');
  const id = parseInt(parts[0], 10);
  const offset = parseInt(parts[1], 10);
  return {
    id: isFinite(id) && id > 0 ? id : 0,
    offset: isFinite(offset) && offset > 0 ? offset : 0
  };
}

// The stored diff list, enriched at write time. Legacy rows have only the raw
// leaf paths (`tasks.3.notes`), so the fallback splits them into the response
// shape as far as it can - no recordName, which only the writer knew.
async function loadChanges(env, row) {
  if (row.diffs_key) {
    try {
      const obj = await env.R2.get(row.diffs_key);
      if (obj) {
        const parsed = JSON.parse(await obj.text());
        if (Array.isArray(parsed)) {
          return parsed;
        }
        if (parsed && Array.isArray(parsed.diffs)) {
          return parsed.diffs;
        }
      }
    } catch (e) {
      /* fall through to diffs_json */
    }
  }
  if (!row.diffs_json) {
    return [];
  }
  let raw = null;
  try {
    raw = JSON.parse(row.diffs_json);
  } catch (e) {
    return [];
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map(function (d) {
    if (d && d.field) {
      return d;
    }
    const path = String((d && d.path) || '');
    const segs = path.split('.');
    if (segs.length < 2) {
      return {
        path: path,
        recordId: null,
        recordName: null,
        field: null,
        before: d.before,
        after: d.after
      };
    }
    if (segs.length === 2) {
      return {
        path: segs[0],
        recordId: null,
        recordName: null,
        field: segs[1],
        before: d.before,
        after: d.after
      };
    }
    return {
      path: segs[0],
      recordId: segs[1],
      recordName: null,
      field: segs.slice(2).join('.'),
      before: d.before,
      after: d.after
    };
  });
}

export async function changesSinceResult(env, projectId, auth, args, rpcId) {
  const a = args && typeof args === 'object' ? args : {};
  const scope = auth && auth.role === 'api' ? auth.scope : null;
  const pathFilter = typeof a.path === 'string' ? a.path.trim() : '';
  const since = typeof a.since === 'string' ? a.since.trim() : '';
  let limit = a.limit != null ? parseInt(a.limit, 10) : CHANGES_DEFAULT_ENTRIES;
  if (!isFinite(limit) || limit < 1) {
    limit = CHANGES_DEFAULT_ENTRIES;
  }
  if (limit > CHANGES_MAX_ENTRIES) {
    limit = CHANGES_MAX_ENTRIES;
  }
  const cur = parseCursor(a.cursor);
  const afterId = cur.id;
  const startOffset = cur.offset;

  let sql =
    'SELECT id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, diffs_key, created_at, proposal_id, source_type, source_label, key_id, change_set_id FROM cloud_changelog WHERE project_id = ? AND id >= ?';
  const binds = [projectId, afterId];
  if (since) {
    sql += ' AND created_at > ?';
    binds.push(since);
  }
  sql += ' ORDER BY id ASC LIMIT ' + (limit + 1);
  const rows =
    (
      await env.DB.prepare(sql)
        .bind(...binds)
        .all()
    ).results || [];

  const entries = [];
  let budget = CHANGES_MAX_PER_CALL;
  let nextCursor = null;
  let moreInEntry = false;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowId = Number(row.id) || 0;
    if (rowId < afterId) {
      continue;
    }
    if (entries.length >= limit) {
      // The peek row: this entry has not been sent at all.
      nextCursor = rowId + ':0';
      break;
    }
    if (budget <= 0) {
      nextCursor = rowId + ':0';
      break;
    }
    const all = await loadChanges(env, row);
    const visible = all.filter(function (d) {
      return changeAllowed(d, scope, auth, pathFilter);
    });
    if (!visible.length) {
      continue;
    }
    const offset = rowId === afterId ? startOffset : 0;
    if (offset >= visible.length) {
      continue;
    }
    const slice = visible.slice(offset, offset + budget);
    budget -= slice.length;
    entries.push({
      changeId: rowId,
      at: row.created_at || null,
      approvedBy: { type: row.actor_type || null, label: row.actor_label || null },
      source: {
        type: row.source_type || null,
        label: row.source_label || null,
        keyId: row.key_id == null ? null : String(row.key_id)
      },
      proposalId: row.proposal_id == null ? null : Number(row.proposal_id),
      changeSetId: row.change_set_id || null,
      changes: slice
    });
    if (offset + slice.length < visible.length) {
      nextCursor = rowId + ':' + (offset + slice.length);
      moreInEntry = true;
      break;
    }
  }

  const changeCount = entries.reduce(function (n, e) {
    return n + e.changes.length;
  }, 0);
  return {
    jsonrpc: '2.0',
    id: rpcId,
    result: {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              projectId: projectId,
              since: since || null,
              cursor: a.cursor || null,
              limit: limit,
              entryCount: entries.length,
              changeCount: changeCount,
              moreInEntry: moreInEntry,
              nextCursor: nextCursor,
              entries: entries
            },
            null,
            2
          )
        }
      ]
    }
  };
}
