/* ============================================================
   MCP PROPOSAL PLANNER — one validation function for every write.
   ============================================================
   MCP-AGENT-FIRST 2026-11-12 2.2: before this file the write rules
   lived in three loops inside queueMcpProposal, so validate_changes
   could only exist by copying them. planProposal now owns every
   check and both callers use it, which is what keeps the dry run
   and the real queue from disagreeing.

   It returns:
     { ops, refused, warnings, submitted, base, counts, budget,
       usedLarge }
   and, for a whole-call refusal:
     { error: { text }, refused, warnings, ops: [] }

   Nothing here touches D1 or R2 except the read-only large-change
   counter (deps.env); the caller decides whether to queue.
   ============================================================ */

import { CLOUD_SECTIONS, CLOUD_KEY_TO_SECTION } from '../lib/http.js';
import { setPathValue, getPathValue, valuesEqual } from '../cloud/proposal-diffs.js';
import {
  BUDGET_PROPOSAL_LIMIT,
  BUDGET_LARGE_PER_DAY,
  BUDGET_LINE_FIELDS,
  buildBudgetProposal
} from '../lib/budget.js';
import {
  MODEL,
  createDefaults,
  stampCreated,
  canonicalField,
  fieldSpec,
  getSection,
  isListPath,
  isSectionPath
} from './model.js';
import { budgetWriteAllowed, BUDGET_WRITE_REFUSAL } from './budget-access.js';

// MCP-DIRECTIVE 2026-11-11 P0: validate the apply_changes envelope BEFORE
// loading project state. An empty or malformed envelope must return a tool
// error in microseconds - never load and decrypt a multi-megabyte snapshot
// (and never reach the platform CPU limit) just to reject it. Both servers
// call this same function, so the refusal text cannot drift.
export const MCP_MAX_DIFFS = 500;
export const MCP_MAX_CREATES = 500;
export const MCP_MAX_SETS = 100;
// Wall-clock ceiling for the write pipeline. Cloudflare's 1102 must never be
// the first signal: abort with a plain, structured message before the
// platform limit. The state read is cached (r2DeriveKey), so a normal
// 1/30/200-diff proposal finishes far inside this budget.
export const MCP_WRITE_BUDGET_MS = 4000;

export function validateProposalEnvelope(toolArgs, auth) {
  const a = toolArgs || {};
  const diffs = Array.isArray(a.diffs) ? a.diffs : [];
  const creates = Array.isArray(a.creates) ? a.creates : [];
  const budgetRaw = Array.isArray(a.budget) ? a.budget : [];
  const setsRaw = Array.isArray(a.sets) ? a.sets : [];
  if (
    diffs.length === 0 &&
    creates.length === 0 &&
    budgetRaw.length === 0 &&
    setsRaw.length === 0
  ) {
    return {
      content: [
        {
          type: 'text',
          text: 'Nothing provided. Supply diffs as {path, recordId, field, after}, creates as {path, record} objects, sets as {path, field, value} objects, or budget changes as {kind, ...} objects.'
        }
      ],
      isError: true
    };
  }
  if (diffs.length > MCP_MAX_DIFFS) {
    return {
      content: [
        {
          type: 'text',
          text:
            'A proposal can carry at most ' +
            MCP_MAX_DIFFS +
            ' diffs. Split this into smaller proposals.'
        }
      ],
      isError: true
    };
  }
  if (creates.length > MCP_MAX_CREATES) {
    return {
      content: [
        {
          type: 'text',
          text:
            'A proposal can carry at most ' +
            MCP_MAX_CREATES +
            ' creates. Split this into smaller proposals.'
        }
      ],
      isError: true
    };
  }
  if (setsRaw.length > MCP_MAX_SETS) {
    return {
      content: [
        {
          type: 'text',
          text:
            'A proposal can carry at most ' +
            MCP_MAX_SETS +
            ' sets. Split this into smaller proposals.'
        }
      ],
      isError: true
    };
  }
  // H-5: the write switch. A key without it cannot queue a budget proposal
  // AT ALL - the whole call is refused rather than silently dropping the
  // budget part and queuing the rest.
  if (budgetRaw.length && !budgetWriteAllowed(auth)) {
    return { content: [{ type: 'text', text: BUDGET_WRITE_REFUSAL }], isError: true };
  }
  if (budgetRaw.length > BUDGET_PROPOSAL_LIMIT) {
    return {
      content: [
        {
          type: 'text',
          text:
            'A proposal can carry at most ' +
            BUDGET_PROPOSAL_LIMIT +
            ' budget changes. Split this into smaller proposals.'
        }
      ],
      isError: true
    };
  }
  return null;
}

export function mcpShortValue(v) {
  if (v === undefined) {
    return '(absent)';
  }
  if (v === null) {
    return 'null';
  }
  let s;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v);
  } catch (e) {
    s = String(v);
  }
  if (s === undefined) {
    s = String(v);
  }
  return s.length > 60 ? s.slice(0, 57) + '...' : s;
}

// js/mmgr-custom-fields.js isCustomKey: the prefix is the whole contract.
function isCustomKey(key) {
  return typeof key === 'string' && key.indexOf('cf_') === 0;
}

// A real calendar date, not just three numbers. parseISO in budget.js is
// lenient by design; an agent write must not smuggle 2026-02-30 into state.
function isRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return false;
  }
  const y = +s.slice(0, 4);
  const m = +s.slice(5, 7);
  const d = +s.slice(8, 10);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Case-insensitive enum match that stores the client's canonical spelling
// (tasks.status stays lowercase, risk probability keeps its capital).
function canonicalEnum(values, raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  for (let i = 0; i < values.length; i++) {
    if (values[i] === raw) {
      return values[i];
    }
  }
  const lower = raw.toLowerCase();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i]).toLowerCase() === lower) {
      return values[i];
    }
  }
  return null;
}

// Validate one value against its model spec. Returns {ok, value|reason}.
function validateValue(spec, raw) {
  if (raw === null) {
    return { ok: true, value: null };
  }
  if (!spec) {
    return { ok: true, value: raw };
  }
  switch (spec.type) {
    case 'string': {
      let v = raw;
      if (typeof v === 'number' && spec.numeric && isFinite(v)) {
        v = String(v);
      }
      if (typeof v !== 'string') {
        return { ok: false, reason: 'expected a string' };
      }
      if (spec.max != null && v.length > spec.max) {
        return { ok: false, reason: 'longer than ' + spec.max + ' characters' };
      }
      if (spec.date && v !== '' && !isRealDate(v)) {
        return { ok: false, reason: 'not a real calendar date (YYYY-MM-DD)' };
      }
      if (spec.enum) {
        const canon = canonicalEnum(spec.enum, v);
        if (canon === null) {
          return { ok: false, reason: 'not one of: ' + spec.enum.join(', ') };
        }
        return { ok: true, value: canon };
      }
      return { ok: true, value: v };
    }
    case 'number':
      if (typeof raw !== 'number' || !isFinite(raw)) {
        return { ok: false, reason: 'expected a finite number' };
      }
      return { ok: true, value: raw };
    case 'boolean':
      if (typeof raw !== 'boolean') {
        return { ok: false, reason: 'expected true or false' };
      }
      return { ok: true, value: raw };
    case 'array':
      if (!Array.isArray(raw)) {
        return { ok: false, reason: 'expected an array' };
      }
      return { ok: true, value: raw };
    case 'object':
      if (typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, reason: 'expected an object' };
      }
      return { ok: true, value: raw };
    default:
      return { ok: true, value: raw };
  }
}

function derivedFor(spec, record) {
  if (!spec) {
    return false;
  }
  if (spec.derived) {
    return true;
  }
  return !!(spec.derivedWhen && record && record[spec.derivedWhen]);
}

function modelFieldNames(path) {
  return Object.keys(MODEL.lists[path].fields);
}

// Mirrors js/mmgr-kanban.js nextPosition: the new card lands at the end of
// its column, never in the middle of the owner's ordering.
function nextTaskPosition(tasks, status) {
  let max = -1;
  (tasks || []).forEach(function (t) {
    if (!t || (t.status || 'todo') !== status) {
      return;
    }
    const p =
      typeof t.boardPosition === 'number' && isFinite(t.boardPosition)
        ? t.boardPosition
        : Number.MAX_SAFE_INTEGER;
    if (p !== Number.MAX_SAFE_INTEGER && p > max) {
      max = p;
    }
  });
  return max + 1;
}

function buildCreatedRecord(path, record, nowMs, counterRef, siblings) {
  const rec = createDefaults(path);
  if (!rec) {
    return null;
  }
  rec.id =
    (path === 'tasks' ? 't_' : path === 'resources' ? 'R' : 'mcp_') +
    nowMs.toString(36) +
    '_' +
    ++counterRef.n;
  if (record && typeof record === 'object') {
    for (const k of Object.keys(record)) {
      if (k === 'id') {
        continue;
      } // ids are server-assigned, never client-supplied
      rec[k] = record[k];
    }
  }
  return stampCreated(path, rec, {
    // The client's U.todayStr() uses the browser's local day. The Worker has
    // only UTC, so a create near midnight can carry the neighbouring day; the
    // date is informational and the app re-stamps on the next status move.
    today: new Date(nowMs).toISOString().slice(0, 10),
    boardPosition: path === 'tasks' ? nextTaskPosition(siblings, rec.status || 'todo') : 0
  });
}

// Validate the fields of a create. Returns {record, reasons}. Unknown,
// derived and id fields refuse the whole create, so an agent never believes a
// field landed when it was silently dropped.
function planCreateFields(path, input) {
  const reasons = [];
  const clean = {};
  const defaults = createDefaults(path) || {};
  Object.keys(input || {}).forEach(function (rawName) {
    if (rawName === 'id') {
      reasons.push('id: server-assigned and cannot be written');
      return;
    }
    const name = canonicalField(path, rawName);
    if (!name) {
      if (isCustomKey(rawName)) {
        const v = input[rawName];
        const t = typeof v;
        if (v !== null && t !== 'string' && t !== 'number' && t !== 'boolean') {
          reasons.push(rawName + ': a custom field holds a string, number or boolean');
          return;
        }
        clean[rawName] = v;
        return;
      }
      reasons.push(
        rawName + ': unknown field on ' + path + '. Allowed: ' + modelFieldNames(path).join(', ')
      );
      return;
    }
    const spec = fieldSpec(path, name);
    if (derivedFor(spec, Object.assign({}, defaults, clean, input))) {
      reasons.push(name + ': derived field, recomputed by the app');
      return;
    }
    const checked = validateValue(spec, input[rawName]);
    if (!checked.ok) {
      reasons.push(name + ': ' + checked.reason);
      return;
    }
    clean[name] = checked.value;
  });
  return { record: clean, reasons: reasons };
}

// Predecessors must name a task that exists, or a tempId assigned in this
// same call (2.3). A task cannot depend on itself.
function checkPredecessors(value, base, selfId, tempIds) {
  if (!Array.isArray(value)) {
    return 'predecessors: expected an array of task ids';
  }
  const known = {};
  (base.tasks || []).forEach(function (t) {
    if (t && t.id != null) {
      known[String(t.id)] = true;
    }
  });
  Object.keys(tempIds || {}).forEach(function (k) {
    known[k] = true;
    // A mapped predecessor carries the server-assigned id, not the tempId.
    known[String(tempIds[k])] = true;
  });
  for (let i = 0; i < value.length; i++) {
    const id = value[i];
    if (typeof id !== 'string' || !id) {
      return 'predecessors[' + i + ']: expected a task id string';
    }
    if (selfId && id === selfId) {
      return 'predecessors[' + i + ']: a task cannot depend on itself';
    }
    if (!known[id]) {
      return 'predecessors[' + i + ']: ' + id + ' is not a task in this project';
    }
  }
  return null;
}

function mapTempIds(list, tempIds) {
  return list.map(function (id) {
    return Object.prototype.hasOwnProperty.call(tempIds, id) ? tempIds[id] : id;
  });
}

/**
 * Validate every part of an apply_changes call and materialise the accepted
 * parts onto a copy of the live state.
 *
 * @param {object} toolArgs  the raw tool arguments
 * @param {object|null} liveState  the full stored project state
 * @param {object} auth  the resolved credential (scope, budget switches)
 * @param {object} [deps]  { env, projectId, tempIds }
 * @returns {Promise<object>} {ops, refused, warnings, submitted, base, counts, budget, usedLarge, error}
 */
export async function planProposal(toolArgs, liveState, auth, deps) {
  const a = toolArgs || {};
  const d = deps || {};
  const diffs = Array.isArray(a.diffs) ? a.diffs : [];
  const creates = Array.isArray(a.creates) ? a.creates : [];
  const setsRaw = Array.isArray(a.sets) ? a.sets : [];
  const budgetRaw = Array.isArray(a.budget) ? a.budget : [];
  const writeStartedAt = Date.now();
  const ops = [];
  const refused = [];
  const warnings = [];
  const refusedCreates = [];
  const refusedSets = [];

  // 1.2: the generic paths can name the money tables too. The whole call is
  // refused when the key's "Propose budget changes" switch is off.
  const BUDGET_WRITE_PATHS = ['budgetLines', 'spendLog', 'budgetEnvelope', 'nspid'];
  const touchesBudget =
    diffs.some(function (x) {
      return x && BUDGET_WRITE_PATHS.indexOf(String(x.path || '')) !== -1;
    }) ||
    creates.some(function (x) {
      return x && BUDGET_WRITE_PATHS.indexOf(String(x.path || '')) !== -1;
    }) ||
    setsRaw.some(function (x) {
      return x && BUDGET_WRITE_PATHS.indexOf(String(x.path || '')) !== -1;
    });
  if (touchesBudget && !budgetWriteAllowed(auth)) {
    return {
      error: { text: BUDGET_WRITE_REFUSAL },
      ops: ops,
      refused: refused,
      warnings: warnings
    };
  }
  // Budget-line diffs and envelope sets are re-expressed as budget-array ops so
  // ONE validator (buildBudgetProposal) owns every money check.
  const budgetFromDiffs = [];
  const budgetFromSets = [];

  const granted = Array.isArray(auth.scope) ? auth.scope : Object.keys(CLOUD_SECTIONS);
  let prev = liveState; // the full stored state fetched above (pre-scope)
  // CREATE into an empty project (owner 2026-09-17): a brand-new cloud
  // project has no snapshot yet - the owner's lazy-PM scenario starts
  // exactly there. With creates only, seed a minimal prev instead of
  // refusing; the review-accept path writes the merged state either way.
  if (!prev && diffs.length === 0 && (creates.length > 0 || setsRaw.length > 0)) {
    prev = { schemaVersion: 19, projectId: d.projectId, updatedAt: new Date().toISOString() };
  }
  if (!prev) {
    return {
      error: {
        text: 'No project data available. Save a snapshot first, or use creates to add new records to the empty project.'
      },
      ops: ops,
      refused: refused,
      warnings: warnings
    };
  }
  const base = JSON.parse(JSON.stringify(prev));
  const submitted = {};
  const tempIds = d.tempIds || {};
  // Predecessor ops wait until every create in the call has an id, so a
  // forward tempId reference resolves. {item, path, recordId, field, value}.
  const pendingPreds = [];

  // ---- diffs ------------------------------------------------------------
  for (let i = 0; i < diffs.length; i++) {
    if (Date.now() - writeStartedAt > MCP_WRITE_BUDGET_MS) {
      return {
        error: {
          text: 'MCP_WRITE_BUDGET_EXCEEDED - this proposal is too large to process safely. Split it into smaller proposals.'
        },
        ops: ops,
        refused: refused,
        warnings: warnings
      };
    }
    const raw = diffs[i];
    if (!raw || typeof raw !== 'object') {
      refused.push('diff ' + i + ': invalid');
      continue;
    }
    const path = String(raw.path || '');
    const rec = String(raw.recordId || '');
    let field = String(raw.field || '');
    const sec = CLOUD_KEY_TO_SECTION[path];
    if (!sec) {
      refused.push((path || '(empty)') + ': not a project section');
      continue;
    }
    if (granted.indexOf(sec) === -1) {
      refused.push(path + ': outside the granted sections');
      continue;
    }
    // 1.2: money tables do not take generic diffs.
    if (path === 'budgetLines') {
      if (BUDGET_LINE_FIELDS.indexOf(field) === -1) {
        refused.push(
          path +
            '.' +
            (field || '(no field)') +
            ': not writable through MCP. Allowed: ' +
            BUDGET_LINE_FIELDS.join(', ') +
            '.'
        );
        continue;
      }
      budgetFromDiffs.push({
        kind: 'changeLine',
        lineId: rec,
        field: field,
        value: raw.after,
        before: raw.before
      });
      continue;
    }
    if (path === 'spendLog') {
      refused.push(path + ': use the budget array (addDelivery)');
      continue;
    }
    if (path === 'budgetEnvelope') {
      refused.push(
        path + ': use a set ({"path":"budgetEnvelope","value":<number>}) rather than a diff'
      );
      continue;
    }
    if (path === 'nspid') {
      refused.push(path + ': server-managed and cannot be written');
      continue;
    }
    const arr = base[path];
    if (!Array.isArray(arr)) {
      refused.push(path + ': not an editable list');
      continue;
    }
    let item = null;
    for (let j = 0; j < arr.length; j++) {
      if (arr[j] && String(arr[j].id) === rec) {
        item = arr[j];
        break;
      }
    }
    if (!item) {
      refused.push((rec || '(no record id)') + ': not found in ' + path);
      continue;
    }
    if (!field) {
      refused.push('diff ' + i + ': missing field');
      continue;
    }
    // 2.2: model validation. Resolve the alias first (`name` on a risk means
    // `description`), then refuse unknown, derived and id fields.
    if (isListPath(path)) {
      const canonical = canonicalField(path, field);
      if (!canonical) {
        if (isCustomKey(field)) {
          const checked = validateValue(null, raw.after === undefined ? null : raw.after);
          if (!checked.ok) {
            refused.push(path + '.' + field + ': ' + checked.reason);
            continue;
          }
          item[field] = checked.value;
          submitted[path] = arr;
          ops.push({ op: 'set', path: path, recordId: rec, field: field, after: checked.value });
          continue;
        }
        refused.push(
          path + '.' + field + ': unknown field. Allowed: ' + modelFieldNames(path).join(', ')
        );
        continue;
      }
      field = canonical;
      const spec = fieldSpec(path, field);
      if (field === 'id' || derivedFor(spec, item)) {
        refused.push(path + '[' + rec + '].' + field + ': derived field, recomputed by the app');
        continue;
      }
      const checked = validateValue(spec, raw.after === undefined ? null : raw.after);
      if (!checked.ok) {
        refused.push(path + '[' + rec + '].' + field + ': ' + checked.reason);
        continue;
      }
      // 1.4: a supplied `before` is a promise about the live value.
      if (raw.before !== undefined) {
        if (!valuesEqual(raw.before, item[field])) {
          refused.push(
            path +
              '[' +
              rec +
              '].' +
              field +
              ': stale before: expected ' +
              mcpShortValue(raw.before) +
              ', live ' +
              mcpShortValue(item[field])
          );
          continue;
        }
      } else {
        warnings.push(path + '[' + rec + '].' + field + ': before not checked');
      }
      if (path === 'tasks' && field === 'predecessors') {
        pendingPreds.push({ item: item, path: path, recordId: rec, value: checked.value });
        continue;
      }
      item[field] = checked.value;
      submitted[path] = arr;
      ops.push({
        op: 'set',
        path: path,
        recordId: rec,
        field: field,
        before: raw.before,
        after: checked.value
      });
      continue;
    }
    // A path inside a section but outside the model (none today) keeps the
    // old behaviour rather than inventing rules.
    if (raw.before !== undefined) {
      if (!valuesEqual(raw.before, item[field])) {
        refused.push(
          path +
            '[' +
            rec +
            '].' +
            field +
            ': stale before: expected ' +
            mcpShortValue(raw.before) +
            ', live ' +
            mcpShortValue(item[field])
        );
        continue;
      }
    } else {
      warnings.push(path + '[' + rec + '].' + field + ': before not checked');
    }
    item[field] = raw.after !== undefined ? raw.after : null;
    submitted[path] = arr;
    ops.push({
      op: 'set',
      path: path,
      recordId: rec,
      field: field,
      before: raw.before,
      after: raw.after === undefined ? null : raw.after
    });
  }

  // ---- creates (two passes so a forward tempId resolves) -----------------
  const counterRef = { n: 0 };
  const nowMs = Date.now();
  const plannedCreates = [];
  for (let i = 0; i < creates.length; i++) {
    if (Date.now() - writeStartedAt > MCP_WRITE_BUDGET_MS) {
      return {
        error: {
          text: 'MCP_WRITE_BUDGET_EXCEEDED - this proposal is too large to process safely. Split it into smaller proposals.'
        },
        ops: ops,
        refused: refused,
        warnings: warnings
      };
    }
    const c = creates[i];
    if (!c || typeof c !== 'object') {
      refusedCreates.push('create ' + i + ': invalid');
      continue;
    }
    const cpath = String(c.path || '');
    const recInput = c.record;
    const csec = CLOUD_KEY_TO_SECTION[cpath];
    if (!csec) {
      refusedCreates.push((cpath || '(empty)') + ': not a project section');
      continue;
    }
    if (granted.indexOf(csec) === -1) {
      refusedCreates.push(cpath + ': outside the granted sections');
      continue;
    }
    if (cpath === 'budgetLines' || cpath === 'spendLog') {
      refusedCreates.push(
        cpath +
          ': use the budget array (' +
          (cpath === 'budgetLines' ? 'addLine' : 'addDelivery') +
          ')'
      );
      continue;
    }
    if (cpath === 'nspid') {
      refusedCreates.push(cpath + ': server-managed and cannot be written');
      continue;
    }
    if (!recInput || typeof recInput !== 'object') {
      refusedCreates.push('create ' + i + ': missing record');
      continue;
    }
    // TITLE-KEYED LISTS (2026-09-26): meetings, logEntries and commsEntries
    // are title-keyed by the app's own creators, so the gate must accept name
    // OR title. A title-only create used to be refused with 'record needs at
    // least a name', silently shrinking the queued proposal.
    const titleVal =
      recInput.title !== undefined && recInput.title !== null ? String(recInput.title).trim() : '';
    const hasName =
      (recInput.name !== undefined &&
        recInput.name !== null &&
        String(recInput.name).trim() !== '') ||
      titleVal !== '';
    if (!hasName) {
      refusedCreates.push(
        'create ' + i + ' (' + cpath + '): record needs at least a name or title'
      );
      continue;
    }
    if (!createDefaults(cpath)) {
      refusedCreates.push(cpath + ': not a list that accepts new records');
      continue;
    }
    // 2.2: validate every field before the record is built. A refused create
    // does not land at all; a partially cleaned one would lie to the agent.
    const planned = planCreateFields(cpath, recInput);
    if (planned.reasons.length) {
      planned.reasons.forEach(function (reason) {
        refusedCreates.push('create ' + i + ' (' + cpath + '): ' + reason);
      });
      continue;
    }
    const tempId = typeof c.tempId === 'string' ? c.tempId.trim().slice(0, 40) : '';
    if (tempId && Object.prototype.hasOwnProperty.call(tempIds, tempId)) {
      refusedCreates.push('create ' + i + ' (' + cpath + '): tempId ' + tempId + ' is not unique');
      continue;
    }
    const arr2 = Array.isArray(base[cpath]) ? base[cpath] : (base[cpath] = []);
    const created = buildCreatedRecord(cpath, planned.record, nowMs, counterRef, arr2);
    if (tempId) {
      tempIds[tempId] = created.id;
    }
    plannedCreates.push({ arr: arr2, created: created, path: cpath, tempId: tempId });
  }
  // Pass 2: predecessors now resolve every tempId in the call.
  for (let i = 0; i < plannedCreates.length; i++) {
    const p = plannedCreates[i];
    if (p.path === 'tasks') {
      const mapped = mapTempIds(p.created.predecessors || [], tempIds);
      const pred = checkPredecessors(mapped, base, p.created.id, tempIds);
      if (pred) {
        refusedCreates.push('create (' + p.path + '): ' + pred);
        if (p.tempId) {
          delete tempIds[p.tempId];
        }
        continue;
      }
      p.created.predecessors = mapped;
    }
    p.arr.push(p.created);
    submitted[p.path] = p.arr;
    ops.push({ op: 'create', path: p.path, record: p.created, tempId: p.tempId || null });
  }
  // Diff-side predecessor ops now that every tempId exists.
  for (let i = 0; i < pendingPreds.length; i++) {
    const p = pendingPreds[i];
    const mapped = mapTempIds(p.value || [], tempIds);
    const pred = checkPredecessors(mapped, base, p.recordId, tempIds);
    if (pred) {
      refused.push(p.path + '[' + p.recordId + '].' + pred);
      continue;
    }
    p.item.predecessors = mapped;
    submitted[p.path] = base[p.path];
    ops.push({
      op: 'set',
      path: p.path,
      recordId: p.recordId,
      field: 'predecessors',
      after: mapped
    });
  }

  // ---- sets -------------------------------------------------------------
  const SET_FIELD_RE = /^[A-Za-z0-9_]+(\[\d+\])?(\.[A-Za-z0-9_]+(\[\d+\])?)*$/;
  for (let i = 0; i < setsRaw.length; i++) {
    if (Date.now() - writeStartedAt > MCP_WRITE_BUDGET_MS) {
      return {
        error: {
          text: 'MCP_WRITE_BUDGET_EXCEEDED - this proposal is too large to process safely. Split it into smaller proposals.'
        },
        ops: ops,
        refused: refused,
        warnings: warnings
      };
    }
    const s = setsRaw[i];
    if (!s || typeof s !== 'object') {
      refusedSets.push('set ' + i + ': invalid');
      continue;
    }
    const spath = String(s.path || '');
    const sec = CLOUD_KEY_TO_SECTION[spath];
    if (!sec) {
      refusedSets.push((spath || '(empty)') + ': not a project section');
      continue;
    }
    if (granted.indexOf(sec) === -1) {
      refusedSets.push(spath + ': outside the granted sections');
      continue;
    }
    if (spath === 'budgetEnvelope') {
      const envField = s.field === undefined || s.field === null ? '' : String(s.field);
      if (envField) {
        refusedSets.push(spath + '.' + envField + ': the envelope is a single number - omit field');
        continue;
      }
      if (
        s.before !== undefined &&
        !valuesEqual(s.before, base.budgetEnvelope == null ? null : +base.budgetEnvelope)
      ) {
        refusedSets.push(
          spath +
            ': stale before: expected ' +
            mcpShortValue(s.before) +
            ', live ' +
            mcpShortValue(base.budgetEnvelope)
        );
        continue;
      }
      budgetFromSets.push({ kind: 'changeEnvelope', value: s.value, before: s.before });
      continue;
    }
    if (spath === 'nspid') {
      refusedSets.push(spath + ': server-managed and cannot be written');
      continue;
    }
    if (Array.isArray(base[spath])) {
      refusedSets.push(spath + ': is a record list - use diffs or creates');
      continue;
    }
    if (s.value === undefined) {
      refusedSets.push(spath + ': missing value');
      continue;
    }
    const field = s.field === undefined || s.field === null ? '' : String(s.field);
    // 2.2: model validation for object and scalar sections.
    if (isSectionPath(spath)) {
      const section = getSection(spath);
      if (!field) {
        const checked = validateValue(sectionSpec(section), s.value);
        if (!checked.ok) {
          refusedSets.push(spath + ': ' + checked.reason);
          continue;
        }
        base[spath] = checked.value;
        submitted[spath] = base[spath];
        ops.push({ op: 'set', path: spath, field: null, before: s.before, value: checked.value });
        continue;
      }
      if (!SET_FIELD_RE.test(field)) {
        refusedSets.push(spath + '.' + field + ': not a valid field path');
        continue;
      }
      const top = field.split('.')[0].split('[')[0];
      const topSpec = section.fields[top];
      if (!topSpec) {
        refusedSets.push(
          spath +
            '.' +
            field +
            ': unknown field. Allowed: ' +
            Object.keys(section.fields).join(', ')
        );
        continue;
      }
      // A nested path is validated against the one level the client writes.
      const nestedName = field.indexOf('.') !== -1 ? field.split('.')[1].split('[')[0] : null;
      if (nestedName && topSpec.nested) {
        const nestedType = topSpec.nested[nestedName];
        if (!nestedType) {
          refusedSets.push(
            spath +
              '.' +
              field +
              ': unknown field. Allowed: ' +
              Object.keys(topSpec.nested).join(', ')
          );
          continue;
        }
        const checked = validateValue({ type: nestedType, max: null, enum: null }, s.value);
        if (!checked.ok) {
          refusedSets.push(spath + '.' + field + ': ' + checked.reason);
          continue;
        }
      }
      if (s.before !== undefined) {
        const cur = getPathValue(base, spath + '.' + field);
        if (!valuesEqual(s.before, cur)) {
          refusedSets.push(
            spath +
              '.' +
              field +
              ': stale before: expected ' +
              mcpShortValue(s.before) +
              ', live ' +
              mcpShortValue(cur)
          );
          continue;
        }
      } else {
        warnings.push(spath + '.' + field + ': before not checked');
      }
      if (!setPathValue(base, spath + '.' + field, s.value)) {
        refusedSets.push(spath + '.' + field + ': could not be set');
        continue;
      }
      submitted[spath] = base[spath];
      ops.push({ op: 'set', path: spath, field: field, before: s.before, value: s.value });
      continue;
    }
    // A section path that is not modelled keeps the old generic behaviour.
    if (field) {
      if (!SET_FIELD_RE.test(field)) {
        refusedSets.push(spath + '.' + field + ': not a valid field path');
        continue;
      }
      if (s.before !== undefined) {
        const cur = getPathValue(base, spath + '.' + field);
        if (!valuesEqual(s.before, cur)) {
          refusedSets.push(
            spath +
              '.' +
              field +
              ': stale before: expected ' +
              mcpShortValue(s.before) +
              ', live ' +
              mcpShortValue(cur)
          );
          continue;
        }
      } else {
        warnings.push(spath + '.' + field + ': before not checked');
      }
      if (!setPathValue(base, spath + '.' + field, s.value)) {
        refusedSets.push(spath + '.' + field + ': could not be set');
        continue;
      }
    } else if (s.value && typeof s.value === 'object') {
      base[spath] = JSON.parse(JSON.stringify(s.value));
    } else {
      base[spath] = s.value;
    }
    submitted[spath] = base[spath];
    ops.push({ op: 'set', path: spath, field: field, before: s.before, value: s.value });
  }

  // ---- budget -----------------------------------------------------------
  let budgetBuilt = { submitted: {}, changes: [], refused: [], summary: '' };
  const budgetAll = budgetRaw.concat(budgetFromDiffs, budgetFromSets);
  let usedLarge = 0;
  if (budgetAll.length) {
    if (granted.indexOf('bud') === -1) {
      refusedCreates.push('budget: outside the granted sections');
    } else if (budgetAll.length > BUDGET_PROPOSAL_LIMIT) {
      return {
        error: {
          text:
            'A proposal can carry at most ' +
            BUDGET_PROPOSAL_LIMIT +
            ' budget changes. Split this into smaller proposals.'
        },
        ops: ops,
        refused: refused,
        warnings: warnings
      };
    } else {
      budgetBuilt = buildBudgetProposal(base, budgetAll, base.currency);
      Object.keys(budgetBuilt.submitted).forEach(function (k) {
        submitted[k] = budgetBuilt.submitted[k];
      });
      if (budgetBuilt.refused.length) {
        refusedCreates.push.apply(refusedCreates, budgetBuilt.refused);
      }
      const newLarge = budgetBuilt.changes.filter(function (c) {
        return c.large;
      }).length;
      if (newLarge) {
        const dayStart = new Date();
        dayStart.setUTCHours(0, 0, 0, 0);
        try {
          if (d.env && d.env.DB && d.projectId) {
            // 1.5: only undecided or accepted rows count. A rejected row frees
            // its quota, and `accepting` is a pending decision (1.6).
            const todayRows = await d.env.DB.prepare(
              "SELECT proposal_json FROM cloud_reviews WHERE project_id = ? AND source_type = 'api' AND source_label = ? AND proposed_at >= ? AND status IN ('pending','accepting','accepted')"
            )
              .bind(d.projectId, auth.label || 'MCP AI', dayStart.toISOString())
              .all();
            (todayRows.results || []).forEach(function (r) {
              try {
                const p = r.proposal_json ? JSON.parse(r.proposal_json) : null;
                if (p && Array.isArray(p.changes)) {
                  usedLarge += p.changes.filter(function (c) {
                    return c.large;
                  }).length;
                }
              } catch (e) {
                /* a malformed old row must not block a new proposal */
              }
            });
          }
        } catch (e) {
          usedLarge = 0;
        }
        if (usedLarge + newLarge > BUDGET_LARGE_PER_DAY) {
          return {
            error: {
              text:
                'This call has ' +
                newLarge +
                ' large budget change(s). This key has ' +
                usedLarge +
                ' large change(s) pending or accepted today (UTC). The limit is ' +
                BUDGET_LARGE_PER_DAY +
                ' per day and ' +
                BUDGET_LARGE_PER_DAY +
                ' per call. Split into calls of at most ' +
                BUDGET_LARGE_PER_DAY +
                ' large changes, or ask the owner to decide pending ones.'
            },
            ops: ops,
            refused: refused,
            warnings: warnings
          };
        }
      }
      budgetBuilt.changes.forEach(function (change, idx) {
        ops.push({ op: 'budget', index: idx, change: change });
      });
    }
  }

  return {
    ops: ops,
    refused: refused.concat(refusedCreates, refusedSets),
    warnings: warnings,
    submitted: submitted,
    base: base,
    prev: prev,
    counts: {
      diffs: diffs.length,
      creates: creates.length,
      sets: setsRaw.length,
      deletes: 0,
      budget: budgetAll.length
    },
    budget: budgetBuilt,
    usedLarge: usedLarge
  };
}

// The 1.8 machine-readable refusal shape, shared by apply_changes and
// validate_changes so the dry run reports exactly what the queue would.
export function structuredRefusals(list) {
  return (list || []).map(function (s) {
    const text = String(s);
    const m = /^([A-Za-z0-9_]+)(?:\[([^\]]+)\])?(?:\.([A-Za-z0-9_.\[\]]+))?:\s*(.*)$/.exec(text);
    const path = m ? m[1] : null;
    return {
      section: path && CLOUD_KEY_TO_SECTION[path] ? CLOUD_KEY_TO_SECTION[path] : null,
      index: null,
      path: path,
      recordId: m && m[2] ? m[2] : null,
      field: m && m[3] ? m[3] : null,
      reason: m ? m[4] : text
    };
  });
}

// MCP-AGENT-FIRST 2026-11-12 2.6: the dry run. Same input as apply_changes,
// same permission checks and the same planProposal, but nothing is queued.
// Returns {ok, refused, warnings, wouldCreateOps, counts, largeChanges}.
export async function validateChangesProposal(env, projectId, auth, toolArgs, id, state) {
  const precheck = validateProposalEnvelope(toolArgs, auth);
  if (precheck) {
    return { jsonrpc: '2.0', id, result: precheck };
  }
  const plan = await planProposal(toolArgs, state, auth, { env: env, projectId: projectId });
  if (plan.error) {
    return {
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: plan.error.text }], isError: true }
    };
  }
  const large = plan.budget.changes.filter(function (c) {
    return c.large;
  }).length;
  const body = {
    ok: plan.refused.length === 0,
    refused: structuredRefusals(plan.refused),
    refusedText: plan.refused,
    warnings: plan.warnings,
    wouldCreateOps: plan.ops.length,
    counts: plan.counts,
    largeChanges: {
      incoming: large,
      used: plan.usedLarge,
      limit: BUDGET_LARGE_PER_DAY
    }
  };
  return {
    jsonrpc: '2.0',
    id,
    result: { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] }
  };
}

// The spec for a whole-section set (projectName, projectDeadline, ...).
function sectionSpec(section) {
  if (!section) {
    return null;
  }
  return {
    type: section.type,
    max: section.max === undefined ? null : section.max,
    enum: section.enum || null,
    date: !!section.date
  };
}
