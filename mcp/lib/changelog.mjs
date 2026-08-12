/* ============================================================
   My MaNaGeR MCP — changelog (sidecar, cloud-shaped)
   ------------------------------------------------------------
   The app's cloud backend keeps a changelog (D1 cloud_changelog,
   migrations/0003): entries carry entry_type ('edit'|'bulk'|
   'revert'), actor_type ('owner'|'editor'), actor_label, section,
   diffs_json [{path,before,after,beforeAbsent,afterAbsent}], and
   created_at. This module maintains the LOCAL equivalent for MCP
   edits as a sidecar file next to the exported project JSON, using
   the exact same entry shape — so AI-made changes are auditable
   in the same vocabulary the cloud uses, and a future session can
   replay/import them into the D1 changelog verbatim.

   Revert semantics mirror the cloud's owner-revert rule: applying
   a revert restores the pre-change field values AND logs a NEW
   'revert' changelog row (history is never erased). Reverts are
   only permitted on entries whose actor_label is 'mcp-ai' — i.e.
   exactly the changes this MCP's AI made, never user edits.
   ============================================================ */

import fs from 'node:fs';

// Sidecar file name next to the project file: <project>.mcp-changelog.json
export function changelogPathFor(projectFile) {
  return projectFile.replace(/\.json$/i, '') + '.mcp-changelog.json';
}

export function loadChangelog(projectFile) {
  const p = changelogPathFor(projectFile);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { /* corrupt sidecar -> start fresh, don't crash the server */ }
  return { version: 1, entries: [] };
}

export function saveChangelog(projectFile, log) {
  const p = changelogPathFor(projectFile);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(log, null, 2));
  fs.renameSync(tmp, p);
}

// Append one entry and persist. entry: { entry_type, actor_type, actor_label,
// section, diffs_json, created_at } -> returns the full entry with id.
// An explicit entry.id is honored (used when the id was pre-computed so the
// pre-change backup file can carry the same id); otherwise one is assigned.
export function appendEntry(projectFile, entry) {
  const log = loadChangelog(projectFile);
  const id = entry.id !== undefined ? entry.id
    : (log.entries.length ? Math.max.apply(null, log.entries.map(e => e.id)) + 1 : 1);
  const full = Object.assign({}, entry, { id }, { created_at: entry.created_at || new Date().toISOString() });
  log.entries.push(full);
  saveChangelog(projectFile, log);
  return full;
}

// Apply an inverse of the given diffs to a state object. Returns a NEW state
// (deep-cloned). Mirrors the cloud's leaf-level revert: only the fields named
// in diffs_json change. Records are resolved by STABLE record id (diffs carry
// recordId) rather than by array index, so reverting an old entry stays correct
// even after later edits inserted/removed earlier records.
export function applyInverseDiffs(state, diffs) {
  const s = JSON.parse(JSON.stringify(state));
  for (const d of diffs || []) {
    const m = d.path.match(/^([a-zA-Z]+)(?:\[(\d+)\])?(?:\.([a-zA-Z]+))?$/);
    if (!m) continue;
    const [, listKey, , field] = m;
    if (listKey === 'charter') {
      if (d.beforeAbsent) delete s.charter[field];
      else s.charter[field] = d.before;
      continue;
    }
    const list = s[listKey];
    if (!Array.isArray(list)) continue;
    // A delete diff records the id of the record that WAS there — on revert it is
    // intentionally absent, so delete-restores resolve by recorded index, never
    // by id lookup. Every other diff resolves by stable id first (survives index
    // drift): when the recorded recordId is gone (a LATER edit deleted it), SKIP
    // rather than falling back to the stale index — writing to that slot would
    // silently corrupt whatever record sits there now.
    const isDeleteRestore = d.afterAbsent === true && d.beforeAbsent !== true && !field;
    let idx = -1;
    if (!isDeleteRestore && d.recordId !== undefined) {
      idx = list.findIndex(r => r && String(r.id) === String(d.recordId));
      if (idx < 0) continue;
    } else if (m[2] !== undefined) {
      idx = Number(m[2]);
    }
    if (d.beforeAbsent) {
      // A FIELD-level add (leaf diff — the field was undefined before the
      // change) reverts to deleting just that field; only a WHOLE-RECORD add
      // removes the record. REVIEW FIX (2026-08-11): the previous version
      // spliced for every beforeAbsent diff, which deleted the whole record
      // when only a field was added.
      if (field) {
        const rec = idx >= 0 && idx < list.length ? list[idx] : null;
        if (rec) delete rec[field];
        continue;
      }
      if (idx >= 0) list.splice(idx, 1);
      continue;
    }
    const rec = idx >= 0 ? list[idx] : null;
    if (field) {
      if (rec) rec[field] = d.before;
    } else if (isDeleteRestore) {
      // record was deleted by the AI edit -> re-insert at a clamped position
      // (never overwrite a possibly-drifted neighbor)
      list.splice(Math.min(idx, list.length), 0, d.before);
    } else if (idx >= 0) {
      list[idx] = d.before;
    }
  }
  return s;
}

// Revert an MCP-AI change by entry id. Only entries with actor_label 'mcp-ai'
// and entry_type 'edit'|'bulk' are revertible; already-reverted entries are
// rejected (a revert of a revert is not allowed — use propose/approve instead).
// Returns { ok, entry, next } where next is the state AFTER the inverse is
// applied (the caller persists it), or { ok:false, error }.
export function prepareRevert(projectFile, entryId) {
  const log = loadChangelog(projectFile);
  const entry = log.entries.find(e => e.id === entryId);
  if (!entry) return { ok: false, error: 'changelog entry ' + entryId + ' not found' };
  if (entry.actor_label !== 'mcp-ai') return { ok: false, error: 'only MCP-AI changes can be reverted by this tool (entry ' + entryId + ' is ' + (entry.actor_label || 'unknown') + ')' };
  if (entry.entry_type === 'revert') return { ok: false, error: 'entry ' + entryId + ' is itself a revert — re-reverting is not allowed; propose a new change instead' };
  const alreadyReverted = log.entries.some(e => e.entry_type === 'revert' && (e.reverts_id === entryId || (e.diffs_json && entry.diffs_json && JSON.stringify(e.diffs_json) === JSON.stringify(entry.diffs_json))));
  if (alreadyReverted) return { ok: false, error: 'entry ' + entryId + ' has already been reverted' };
  return { ok: true, entry };
}

// Build the 'revert' changelog row that documents a revert (cloud parity:
// reverts are logged, history is never erased). The inverse diffs are stored
// in the same diffs_json vocabulary with before/after swapped.
export function revertEntryShape(entry) {
  const inverse = (entry.diffs_json || []).map(d => ({
    path: d.path,
    before: d.after,
    after: d.before,
    beforeAbsent: d.afterAbsent,
    afterAbsent: d.beforeAbsent
  }));
  return {
    entry_type: 'revert',
    actor_type: 'owner',
    actor_label: 'mcp-ai',
    section: entry.section || null,
    diffs_json: inverse,
    reverts_id: entry.id
  };
}
