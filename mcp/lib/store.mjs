/* ============================================================
   My MaNaGeR MCP — project store
   ------------------------------------------------------------
   Loads/saves the app's exported project JSON (the single-file
   portable format exportState() produces: JSON.stringify of the
   full state tree). Writes are ATOMIC (tmp + rename) and every
   applied write is preceded by a pre-change backup at
   <project>.pre-<entryid>.json so even a catastrophic failure
   can be recovered by hand. The store is the only module that
   touches the filesystem for project files.
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FIELD_KEYS = ['projectName', 'methodology', 'workWeek', 'theme', 'crosshairOn', 'userName', 'charter', 'tasks', 'meetings', 'meetingPromises', 'activeMeeting', 'resources', 'budgetLines', 'budgetEnvelope', 'spendLog', 'stakeholders', 'risks', 'issues', 'changes', 'logEntries', 'commsEntries', 'documents', 'closure', 'raci', 'sprint', 'dailySnapshots', 'dmaic', 'baseline', 'weatherRegion', 'siteLat', 'siteLon', 'sitePlace', 'wxCache', 'weatherLog', 'ldRate', 'wxViewDays', 'wxWindow', 'kbShowLeadtime', 'hlCritical', 'dailySnapshot', 'focusMode', 'streak', 'sentimentHistory', 'scheduleSlips', 'slipCauses', 'digestSnapshot', 'aiOutputs', 'packs', 'packsCalloutDismissed', 'packsEverEnabled'];

export function isProjectFile(name) {
  return /\.json$/i.test(name) && !name.includes('.mcp-changelog') && !name.includes('.pre-');
}

export function listProjects(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(isProjectFile)
      .sort((a, b) => a.localeCompare(b));
  } catch (e) {
    return [];
  }
}

export function resolveProjectFile(dir, name) {
  if (!name) return null;
  // Path safety: only a bare filename inside the configured dir is allowed
  // (no traversal, no absolute paths) — the AI must never pick a path.
  const base = path.basename(name);
  if (base !== name || base !== path.normalize(name)) return null;
  const full = path.join(dir, name);
  if (!fs.existsSync(full)) return null;
  return full;
}

// Read + parse + shallow-validate a project file. Returns { ok, state, file }
// or { ok:false, error }. Never mutates anything on read.
export function loadProject(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { ok: false, error: 'cannot read project file: ' + e.message };
  }
  let state;
  try {
    state = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: 'project file is not valid JSON: ' + e.message };
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, error: 'project file must be a state object (an exported My MaNaGeR .json)' };
  }
  if (!state.tasks || !Array.isArray(state.tasks)) {
    return { ok: false, error: 'project file does not look like a My MaNaGeR export (no tasks array)' };
  }
  return { ok: true, state, file };
}

// Serialize with the app's own pretty format (exportState uses 2-space indent).
export function serialize(state) {
  return JSON.stringify(state, null, 2);
}

// Atomic write: tmp file in the same dir, then rename over the target.
// The pre-change backup is written by the CALLER (it knows the changelog id
// and must snapshot the BEFORE state, not the one being written).
export function saveProject(file, state) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, '.mmgr-mcp-write-' + process.pid + '.tmp');
  fs.writeFileSync(tmp, serialize(state));
  fs.renameSync(tmp, file);
  return { ok: true, file };
}

// Fingerprint the project file's content (used to detect external edits and
// to refuse stale approvals — the owner may have changed the file on disk
// between propose and approve).
export function fingerprint(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (e) {
    return null;
  }
}

// Stamps the same bookkeeping the app's save() does: updatedAt + per-field
// timestamps for every FIELD_KEYS key whose serialized value changed vs the
// given prior fingerprint state. Mirrors stampFieldTs so a later import/merge
// treats MCP edits as a normal, newer save.
export function stampLikeApp(state, prevState) {
  const nowIso = new Date().toISOString();
  state.updatedAt = nowIso;
  if (!state.fieldTs || typeof state.fieldTs !== 'object') state.fieldTs = {};
  const prev = prevState || {};
  for (const k of FIELD_KEYS) {
    const a = prev[k] === undefined ? '__undef__' : JSON.stringify(prev[k]);
    const b = state[k] === undefined ? '__undef__' : JSON.stringify(state[k]);
    if (a !== b) state.fieldTs[k] = nowIso;
  }
  return state;
}
