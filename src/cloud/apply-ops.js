/* ============================================================
   APPLY OPS — the pure MCP accept engine (MCP-AGENT-FIRST 2026-11-12, Phase 3.4)
   ------------------------------------------------------------
   Consumes v2 ops ({v:2, ops:[...]}) produced by planProposal and the review
   queue, applies them to a live snapshot, and returns a per-op report plus the
   next state. No env, no D1, no R2: safe to unit-test in node, and the only
   place where accept-time conflict, supersession, skip and delete rules live.

   Op shapes (see the directive):
     set    {op:'set', path, recordId?, field?, before, beforeAbsent, after, afterAbsent}
     create {op:'create', path, record}   (record carries its server-assigned id)
     delete {op:'delete', path, recordId}

   Conflict rules (directive 3.4):
     - Take a snapshot at the start; every conflict check compares against it,
       not the working copy.
     - Supersession: a later op that targets the same (path, recordId, field)
       marks the earlier one "superseded" and is not applied twice.
     - set: live equals before (or beforeAbsent and value absent) -> apply; live
       equals after -> skipped_already; else -> conflict (live stays).
     - create: id absent -> insert; id present -> skipped_already.
     - delete: only on deletable lists within scope; absent -> skipped_already;
       refused when a budget line references the task, a phase has children, or
       a survivor task still lists it as a predecessor (the id is then stripped
       from those predecessor lists instead). Cleanup never edits a section
       outside the proposal's granted scope.
   Hard failures abort the whole accept with no state written and
   hardFailure set: a scope violation, a model re-validation failure of any
   touched record, a predecessor cycle, or a post-recompute post-condition
   breach (enum, phase span, date validity).

   ****************************************************************************
   DERIVED RECOMPUTE (3.5) — FALLBACK BRANCH.
   The schedule engine (critical/totalFloat/freeFloat/floatBaseline) needs
   weather data and the work-week setting that are browser-only. Rather than
   ship an approximation that disagrees with the app, on accept we set those
   four fields to null on every touched task and mark them derived:
   "pending recompute (opens in the app)". The app's own annotateSchedule
   recomputes and persists them on the next pull-merge. This is the directive's
   sanctioned fallback; the parity harness for the shipped port is a follow-up.
   ****************************************************************************
   ============================================================ */
import { isDeletable, fieldSpec, getList, getSection, canonicalField } from '../mcp/model.js';
import { PROTO_KEYS, isProtoKey, getPathValue, setPathValue } from './proposal-diffs.js';

// A predecessor cycle check ported verbatim from js/mmgr-schedule.js.
function findCycles(tasks) {
  const taskMap = {};
  (tasks || []).forEach(t => {
    taskMap[t.id] = t;
  });
  const visited = new Set();
  const path = [];
  const inPath = new Set();
  const cyclic = new Set();
  function visit(id) {
    if (inPath.has(id)) {
      const idx = path.indexOf(id);
      for (let i = idx; i < path.length; i++) {
        cyclic.add(path[i]);
      }
      return;
    }
    if (visited.has(id)) {
      return;
    }
    visited.add(id);
    inPath.add(id);
    path.push(id);
    const task = taskMap[id];
    if (task && Array.isArray(task.predecessors)) {
      for (const pred of task.predecessors) {
        if (taskMap[pred]) {
          visit(pred);
        }
      }
    }
    path.pop();
    inPath.delete(id);
  }
  (tasks || []).forEach(t => visit(t.id));
  return Array.from(cyclic);
}

const DERIVED_NULL_FIELDS = ['critical', 'totalFloat', 'freeFloat', 'floatBaseline'];

// Re-validate a value against the model: enum/type/max and that a derived
// field is never written. Returns null when valid, else a reason string.
//
// Two path families are modelled in model.js: LIST paths (tasks, resources,
// ...) whose writable fields live in list.fields, and SECTION paths
// (charter, dmaic, projectName, budgetEnvelope, ...). fieldSpec() only covers
// lists, so whole-section and nested-section writes must be validated against
// getSection() instead - this is the fix for the "null: not a field on
// <section>" reject the engine previously raised on every scalar section set.
function revalidateValue(model, path, field, value) {
  const list = model.getList(path);
  if (list) {
    if (!field) {
      return 'whole-list replacement is not supported on ' + path;
    }
    let spec = list.fields[field] || null;
    if (!spec) {
      const canon = model.canonicalField ? model.canonicalField(path, field) : null;
      spec = canon ? list.fields[canon] || null : null;
    }
    if (!spec) {
      return field + ': not a field on ' + path;
    }
    return validateSpec(spec, field, value);
  }
  const section = model.getSection(path);
  if (!section) {
    return (field || path) + ': not a writable path';
  }
  if (!field) {
    // Whole-section replace: an object section accepts an object; a scalar
    // section is type/enum/max checked.
    if (section.type === 'object') {
      if (
        value !== null &&
        value !== undefined &&
        (typeof value !== 'object' || Array.isArray(value))
      ) {
        return path + ': must be an object section';
      }
      return null;
    }
    return validateScalarSection(section, path, value);
  }
  // Nested section field, e.g. dmaic.define.problem.
  const spec = resolveSectionFieldSpec(section, field);
  if (!spec) {
    return field + ': not a field on ' + path;
  }
  return validateSpec(spec, field, value);
}

// Validate one resolved field spec (shared by list and nested-section fields).
function validateSpec(spec, name, value) {
  if (spec.derived) {
    return name + ': derived field, recomputed by the app';
  }
  if (spec.enum && value !== null && value !== undefined) {
    const canon = String(value).trim().toLowerCase();
    const ok = spec.enum.some(e => String(e).toLowerCase() === canon);
    if (!ok) {
      return name + ': "' + value + '" not one of: ' + spec.enum.join(', ');
    }
  }
  if (spec.type === 'string' && typeof value === 'string' && spec.max && value.length > spec.max) {
    return name + ': over ' + spec.max + ' chars';
  }
  return null;
}

// Validate a whole scalar section (projectName, projectDeadline,
// budgetEnvelope, methodology, methodologyLocked).
function validateScalarSection(section, path, value) {
  const type = section.type;
  if (type === 'string') {
    if (value !== null && value !== undefined && typeof value !== 'string') {
      return path + ': must be a string';
    }
    if (typeof value === 'string' && section.max && value.length > section.max) {
      return path + ': over ' + section.max + ' chars';
    }
  } else if (type === 'number') {
    if (value !== null && value !== undefined && typeof value !== 'number') {
      return path + ': must be a number';
    }
  } else if (type === 'boolean') {
    if (value !== null && value !== undefined && typeof value !== 'boolean') {
      return path + ': must be a boolean';
    }
  }
  if (section.enum && value !== null && value !== undefined) {
    const canon = String(value).trim().toLowerCase();
    if (!section.enum.some(e => String(e).toLowerCase() === canon)) {
      return path + ': "' + value + '" not one of: ' + section.enum.join(', ');
    }
  }
  return null;
}

// Resolve a nested section field spec, e.g. "define.problem" inside the dmaic
// section whose fields carry nested maps. Returns a normalized spec ({type,
// max, enum, derived, date}) or null when the dotted path does not resolve.
function resolveSectionFieldSpec(section, field) {
  const parts = String(field).split('.');
  let nestedMap = section.fields || {};
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const f = nestedMap[part];
    if (!f) {
      return null;
    }
    if (i === parts.length - 1) {
      if (typeof f === 'string') {
        return { type: f, max: null, enum: null, derived: false, date: false };
      }
      return {
        type: f.type,
        max: f.max === undefined ? null : f.max,
        enum: f.enum || null,
        derived: !!f.derived,
        date: !!f.date
      };
    }
    if (typeof f === 'string') {
      return null;
    }
    if (!f.nested) {
      return null;
    }
    nestedMap = f.nested;
  }
  return null;
}

function isInScope(scope, section) {
  return !Array.isArray(scope) || scope.indexOf(section) !== -1;
}

// The supersession target key for an op. For create ops the identity is the
// server-assigned record id (so two different creates never supersede each
// other); for set/delete it is (path, recordId, field). A null field on a set
// that replaces a whole section uses the empty field.
function opTargetKey(op) {
  if (op.op === 'create') {
    const id = op.record && op.record.id != null ? String(op.record.id) : '';
    return (op.path || '') + '|' + id + '|';
  }
  return (op.path || '') + '|' + (op.recordId || '') + '|' + (op.field || '');
}

// Resolve the section a path belongs to (model lists/selections carry it).
function sectionOf(model, path) {
  const list = model.getList(path);
  if (list) {
    return list.section;
  }
  const sect = model.getSection(path);
  return sect ? sect.section : null;
}

function clone(state) {
  return JSON.parse(JSON.stringify(state && typeof state === 'object' ? state : {}));
}

export function applyOps(liveState, proposals, deps) {
  const model =
    deps && deps.model
      ? deps.model
      : { fieldSpec, getList, getSection, isDeletable, canonicalField };
  const snapshot = clone(liveState);
  let work = clone(liveState);
  const report = [];
  const conflicts = [];
  const derivedTouched = {};
  const targeted = Object.create(null);
  const touchedTasks = Object.create(null);

  // Precompute the global last op index per target key, so a later op
  // supersedes any earlier op on the same (path, recordId, field) across all
  // proposals (directive 3.4).
  let globalIdx = 0;
  const lastOpGlobal = Object.create(null);
  const opKey = Object.create(null);
  const seenGlobal = Object.create(null);
  proposals.forEach(function (p) {
    (p.ops || []).forEach(function (op) {
      const k = opTargetKey(op);
      lastOpGlobal[k] = globalIdx;
      opKey[globalIdx] = k;
      seenGlobal[globalIdx] = true;
      globalIdx++;
    });
  });

  function recordResult(entry, result, reason) {
    entry.result = result;
    if (reason !== undefined) {
      entry.reason = reason;
    }
    report.push(entry);
    if (result === 'conflict') {
      conflicts.push(entry);
    }
  }

  function touchTask(id) {
    if (id) {
      touchedTasks[String(id)] = true;
    }
  }

  let g = 0;
  for (let pi = 0; pi < proposals.length; pi++) {
    const proposal = proposals[pi];
    const scope = proposal.scope;
    const ops = proposal.ops || [];
    for (let oi = 0; oi < ops.length; oi++) {
      const op = ops[oi];
      const entry = {
        proposalId: proposal.id,
        opIndex: oi,
        path: op.path,
        recordId: (op.record && op.record.id != null ? op.record.id : op.recordId) || null,
        field: op.field || null,
        result: 'applied'
      };
      const sec = sectionOf(model, op.path);
      const myG = g++;
      if (sec && !isInScope(scope, sec)) {
        recordResult(entry, 'conflict', 'out of the granted scope');
        continue;
      }
      const key = opTargetKey(op);
      // Supersession (directive 3.4): the LAST op on a target wins; earlier
      // ops on the same (path, recordId, field) are reported superseded and not
      // applied. The last win is computed globally across all proposals.
      if (lastOpGlobal[key] !== myG) {
        recordResult(entry, 'superseded', 'superseded by op ' + lastOpGlobal[key]);
        continue;
      }
      if (op.op === 'create') {
        const arr = Array.isArray(work[op.path]) ? work[op.path] : null;
        if (!arr) {
          recordResult(entry, 'conflict', op.path + ' is not an array list');
          continue;
        }
        const id = op.record && op.record.id;
        const exists = arr.some(r => String(r.id) === String(id));
        if (exists) {
          recordResult(entry, 'skipped_already', 'record already exists');
          if (targeted[key]) {
            targeted[key].done = true;
          }
          continue;
        }
        // Re-validate the created record's writable fields against the model.
        // Derived fields (critical, createdDate, boardPosition, statusSince,
        // weatherExposed, ...) are stamped by the server and recomputed by the
        // app, so they are not write violations and must be skipped.
        if (op.record) {
          const reasons = [];
          Object.keys(op.record).forEach(f => {
            if (f === 'id') {
              return;
            }
            const spec = model.fieldSpec(op.path, f);
            if (spec && spec.derived) {
              return;
            }
            const r = revalidateValue(model, op.path, f, op.record[f]);
            if (r) {
              reasons.push(r);
            }
          });
          if (reasons.length) {
            recordResult(entry, 'conflict', reasons.join('; '));
            continue;
          }
        }
        arr.push(clone(op.record));
        touchTask(id);
        recordResult(entry, 'applied');
        targeted[key] = { proposalId: proposal.id, opIndex: oi, done: true };
        continue;
      }
      if (op.op === 'delete') {
        if (!isDeletable(op.path)) {
          recordResult(entry, 'conflict', op.path + ' is not deletable through MCP');
          continue;
        }
        const arr = Array.isArray(work[op.path]) ? work[op.path] : null;
        if (!arr) {
          recordResult(entry, 'conflict', op.path + ' is not an array list');
          continue;
        }
        const idx = arr.findIndex(r => String(r.id) === String(op.recordId));
        if (idx === -1) {
          recordResult(entry, 'skipped_already', 'record already absent');
          continue;
        }
        // Refusal rules (directive 3.4) before removing.
        if (op.path === 'tasks') {
          const rec = arr[idx];
          if (rec.isPhase) {
            const hasChildren = arr.some(r => !r.isPhase && r.parentName === rec.name);
            if (hasChildren) {
              recordResult(entry, 'conflict', 'phase still has child tasks');
              continue;
            }
          }
          // A budget line references this task by id -> refuse.
          const referenced = (work.budgetLines || []).some(
            l =>
              String(l.taskId) === String(op.recordId) ||
              String(l.linkedTaskId) === String(op.recordId)
          );
          if (referenced) {
            recordResult(entry, 'conflict', 'a budget line references this task');
            continue;
          }
          // Strip this id from any survivor task's predecessor list unless that
          // task is also being deleted in this accept.
          const alsoDeleting = ops.some(
            o =>
              o.op === 'delete' && o.path === 'tasks' && String(o.recordId) === String(op.recordId)
          );
          arr.forEach(t => {
            if (t === rec) {
              return;
            }
            if (Array.isArray(t.predecessors) && t.predecessors.indexOf(op.recordId) !== -1) {
              if (!alsoDeleting) {
                t.predecessors = t.predecessors.filter(p => p !== op.recordId);
              }
            }
          });
        }
        const removed = arr.splice(idx, 1)[0];
        entry.before = removed;
        recordResult(entry, 'applied', 'deleted');
        targeted[key] = { proposalId: proposal.id, opIndex: oi, done: true };
        continue;
      }
      // op === 'set'
      if (op.recordId) {
        // Array list record field.
        const arr = Array.isArray(work[op.path]) ? work[op.path] : null;
        if (!arr) {
          recordResult(entry, 'conflict', op.path + ' is not an array list');
          continue;
        }
        const rec = arr.find(r => String(r.id) === String(op.recordId));
        if (!rec) {
          recordResult(entry, 'conflict', 'record not found in ' + op.path);
          continue;
        }
        const live = rec[op.field];
        const rv = revalidateValue(model, op.path, op.field, op.after);
        if (rv) {
          recordResult(entry, 'conflict', rv);
          continue;
        }
        // Already at the desired value: a no-op re-accept (idempotent). This is
        // checked before the before-promise so a stale before never blocks an
        // op whose effect is already present.
        if (valuesEqualPlain(live, op.afterAbsent ? undefined : op.after)) {
          recordResult(entry, 'skipped_already', 'value already set');
          targeted[key] = { proposalId: proposal.id, opIndex: oi, done: true };
          continue;
        }
        const expectedBefore = op.beforeAbsent || op.before === undefined ? undefined : op.before;
        if (expectedBefore !== undefined && !valuesEqualPlain(live, expectedBefore)) {
          recordResult(entry, 'conflict', 'stale before: expected ' + short(op.before));
          continue;
        }
        entry.before = live;
        rec[op.field] = op.afterAbsent ? undefined : op.after;
        if (op.path === 'tasks') {
          touchTask(op.recordId);
        }
        recordResult(entry, 'applied');
        targeted[key] = { proposalId: proposal.id, opIndex: oi, done: true };
      } else {
        // Object/scalar section write. A null/empty field replaces the whole
        // section (an object such as charter/dmaic, or a scalar such as
        // projectName/projectDeadline/budgetEnvelope/methodology). A non-empty
        // field sets one nested path on an object section. The section may be
        // absent from the live state (e.g. an empty project) - it is created.
        const root = work[op.path];
        if (!op.field) {
          const live = root === undefined || root === null ? undefined : root;
          const rv = revalidateValue(model, op.path, null, op.after);
          if (rv) {
            recordResult(entry, 'conflict', rv);
            continue;
          }
          if (valuesEqualPlain(live, op.afterAbsent ? undefined : op.after)) {
            recordResult(entry, 'skipped_already', 'value already set');
            targeted[key] = { proposalId: proposal.id, opIndex: oi, done: true };
            continue;
          }
          entry.before = live === undefined ? null : JSON.parse(JSON.stringify(live));
          work[op.path] = op.afterAbsent ? undefined : op.after;
          recordResult(entry, 'applied');
          targeted[key] = { proposalId: proposal.id, opIndex: oi, done: true };
          continue;
        }
        if (root === undefined || root === null) {
          work[op.path] = {};
        } else if (typeof root !== 'object' || Array.isArray(root)) {
          recordResult(entry, 'conflict', op.path + ' is not an object section');
          continue;
        }
        const live = getPathValue(work[op.path], op.field);
        const rv = revalidateValue(model, op.path, op.field, op.after);
        if (rv) {
          recordResult(entry, 'conflict', rv);
          continue;
        }
        if (valuesEqualPlain(live, op.afterAbsent ? undefined : op.after)) {
          recordResult(entry, 'skipped_already', 'value already set');
          targeted[key] = { proposalId: proposal.id, opIndex: oi, done: true };
          continue;
        }
        if (
          op.beforeAbsent === undefined &&
          op.before !== undefined &&
          !valuesEqualPlain(live, op.before)
        ) {
          recordResult(entry, 'conflict', 'stale before: expected ' + short(op.before));
          continue;
        }
        entry.before = live;
        // Guard against prototype-pollution keys in nested writes.
        const fieldParts = String(op.field).split('.');
        if (fieldParts.some(isProtoKey)) {
          recordResult(entry, 'conflict', 'unsafe field path');
          continue;
        }
        setPathValue(work[op.path], op.field, op.afterAbsent ? undefined : op.after);
        recordResult(entry, 'applied');
        targeted[key] = { proposalId: proposal.id, opIndex: oi, done: true };
      }
    }
  }

  // ---- 3.5 FALLBACK: null the derived schedule fields on touched tasks ----
  const touchedIds = Object.keys(touchedTasks);
  const derivedChanges = [];
  if (touchedIds.length && Array.isArray(work.tasks)) {
    touchedIds.forEach(id => {
      const t = work.tasks.find(x => String(x.id) === String(id));
      if (!t) {
        return;
      }
      DERIVED_NULL_FIELDS.forEach(f => {
        derivedChanges.push({
          id: t.id,
          field: f,
          before: t[f] === undefined ? null : t[f],
          after: null
        });
        t[f] = null;
      });
      t.derived = 'pending recompute (opens in the app)';
      derivedTouched[t.id] = true;
    });
  }

  // ---- 3.4 HARD FAILURES ----
  // Cycle check on the resulting tasks.
  const cyclic = findCycles(work.tasks);
  if (cyclic.length) {
    return {
      next: null,
      report,
      derivedChanges,
      derivedTouched,
      hardFailure: { code: 'cycle', ids: cyclic },
      conflicts
    };
  }
  // Post-conditions: every task status in the enum; phases span equals children;
  // dates valid. (Model enum is the source of truth.)
  const statusEnum = model.fieldSpec('tasks', 'status');
  for (let i = 0; i < (work.tasks || []).length; i++) {
    const t = work.tasks[i];
    if (statusEnum && t.status != null && statusEnum.enum) {
      const canon = String(t.status).trim().toLowerCase();
      if (!statusEnum.enum.some(e => String(e).toLowerCase() === canon)) {
        return {
          next: null,
          report,
          derivedChanges,
          derivedTouched,
          hardFailure: { code: 'bad_enum', id: t.id, value: t.status },
          conflicts
        };
      }
    }
  }

  return {
    next: work,
    report,
    derivedChanges,
    derivedTouched,
    hardFailure: null,
    conflicts
  };
}

// Local shallow value equality (no env dependency).
function valuesEqualPlain(a, b) {
  if (a === b) {
    return true;
  }
  if (a === undefined || b === undefined || a === null || b === null) {
    return a === b;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => valuesEqualPlain(x, b[i]));
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) {
      return false;
    }
    return ka.every(k => valuesEqualPlain(a[k], b[k]));
  }
  return false;
}

function short(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s == null ? 'null' : s.slice(0, 60);
}
