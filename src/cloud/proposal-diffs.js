/* ============================================================
   PROPOSAL DIFFS — one shape for every review producer
   ------------------------------------------------------------
   cloudDiffState() emits flat leaf paths ("tasks[0].status",
   "dmaic.define.problem"). The review UI and the accept path need
   { path, recordId, field, before, after } with a record name. This module
   is the single parser/normalizer both sides use, so an editor proposal, an
   API-key save and an MCP apply_changes all render and apply identically.

   Pure: no env, no D1, no R2. Safe to unit-test in node.
   ============================================================ */

// Null-prototype map: a plain object literal with a __proto__ key sets the
// prototype instead of creating a property, which silently disables the guard.
export const PROTO_KEYS = Object.create(null);
PROTO_KEYS['__proto__'] = 1;
PROTO_KEYS.constructor = 1;
PROTO_KEYS.prototype = 1;

export function isProtoKey(key) {
  return PROTO_KEYS[String(key)] === 1;
}

const LEAF_RE = /^([A-Za-z0-9_]+)(?:\[(\d+)\])?\.(.+)$/;

// cloudDiffState() walks a scalar top-level key to a BARE path ("budgetEnvelope",
// "projectDeadline"). Those are real changes and must survive normalization;
// any other bare word is not a project path.
export const SCALAR_TOP_KEYS = [
  'projectName',
  'methodology',
  'methodologyLocked',
  'projectDeadline',
  'budgetEnvelope',
  'nspid',
  'nmeetid',
  'currency'
];

export function isScalarTopKey(path) {
  return SCALAR_TOP_KEYS.indexOf(String(path)) > -1;
}

// "tasks[0].status"       -> { path:'tasks', index:0, field:'status' }
// "dmaic.define.problem"  -> { path:'dmaic', index:null, field:'define.problem' }
// "closure.lessons[0].x"  -> { path:'closure', index:null, field:'lessons[0].x' }
export function parseDiffPath(raw) {
  const m = LEAF_RE.exec(String(raw || ''));
  if (!m) {
    return null;
  }
  const path = m[1];
  const field = m[3];
  if (isProtoKey(path) || field.split(/[.[\]]+/).some(isProtoKey)) {
    return null;
  }
  return {
    path: path,
    index: m[2] === undefined ? null : Number(m[2]),
    field: field
  };
}

// Split a field into object keys and array indexes:
// "lessons[0].text" -> ["lessons", 0, "text"]; "define.problem" -> ["define","problem"]
export function splitField(field) {
  const out = [];
  String(field || '')
    .split('.')
    .forEach(function (part) {
      const m = /^([A-Za-z0-9_]+)((?:\[\d+\])*)$/.exec(part);
      if (!m) {
        out.push(part);
        return;
      }
      out.push(m[1]);
      const idx = m[2].match(/\[(\d+)\]/g) || [];
      idx.forEach(function (tok) {
        out.push(Number(tok.slice(1, -1)));
      });
    });
  return out;
}

function safeSegments(field) {
  const segs = splitField(field);
  for (let i = 0; i < segs.length; i++) {
    if (typeof segs[i] === 'string' && isProtoKey(segs[i])) {
      return null;
    }
  }
  return segs;
}

export function getPathValue(obj, field) {
  const segs = safeSegments(field);
  if (!segs) {
    return undefined;
  }
  let cur = obj;
  for (let i = 0; i < segs.length; i++) {
    if (cur === null || cur === undefined) {
      return undefined;
    }
    cur = cur[segs[i]];
  }
  return cur;
}

export function setPathValue(obj, field, value) {
  const segs = safeSegments(field);
  if (!segs || !segs.length) {
    return false;
  }
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const key = segs[i];
    const nextIsIndex = typeof segs[i + 1] === 'number';
    if (cur[key] === null || cur[key] === undefined) {
      cur[key] = nextIsIndex ? [] : {};
    }
    cur = cur[key];
    if (cur === null || typeof cur !== 'object') {
      return false;
    }
  }
  cur[segs[segs.length - 1]] = value;
  return true;
}

export function deletePathValue(obj, field) {
  const segs = safeSegments(field);
  if (!segs || !segs.length) {
    return false;
  }
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur === null || cur === undefined) {
      return false;
    }
    cur = cur[segs[i]];
  }
  if (cur === null || typeof cur !== 'object') {
    return false;
  }
  delete cur[segs[segs.length - 1]];
  return true;
}

// null and undefined are the same "absent" value to the app; primitives are
// compared by string so 1 and "1" (a number stored as text) are not stale.
export function valuesEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (a === null || a === undefined || b === null || b === undefined) {
    return a === null || a === undefined ? b === null || b === undefined : false;
  }
  if (typeof a === 'object' || typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch (e) {
      return false;
    }
  }
  return String(a) === String(b);
}

export function recordNameOf(record) {
  if (!record || typeof record !== 'object') {
    return '';
  }
  const name = record.name || record.title || record.category || record.description || '';
  return String(name || '');
}

// Which screens a change reaches. The review card states this so the owner
// knows a status change moves a card on the Kanban board while a date change
// moves bars on the WBS and Gantt - not just "a field changed".
const KEY_SURFACES = {
  projectName: ['Charter', 'Dashboard'],
  methodology: ['Charter', 'Dashboard'],
  methodologyLocked: ['Charter'],
  projectDeadline: ['WBS / Tasks', 'Gantt', 'Dashboard'],
  currency: ['Budget', 'Reports'],
  charter: ['Charter', 'Dashboard'],
  resources: ['Resources', 'WBS / Tasks'],
  budgetLines: ['Budget', 'Dashboard', 'Reports'],
  budgetEnvelope: ['Budget', 'Dashboard', 'Reports'],
  spendLog: ['Budget', 'Dashboard', 'Reports'],
  nspid: ['Budget'],
  stakeholders: ['Stakeholders', 'Dashboard'],
  changes: ['Change register', 'Dashboard'],
  logEntries: ['Decision log', 'Dashboard'],
  risks: ['Risk register', 'Dashboard'],
  issues: ['Issue log', 'Dashboard'],
  closure: ['Closure', 'Dashboard'],
  raci: ['RACI matrix'],
  commsEntries: ['Comms log'],
  documents: ['Documents'],
  dmaic: ['DMAIC'],
  supplierBook: ['Procurement', 'Budget'],
  meetings: ['Meetings', 'Dashboard'],
  meetingPromises: ['Meetings', 'Dashboard'],
  activeMeeting: ['Meetings'],
  nmeetid: ['Meetings'],
  sentimentHistory: ['Meetings', 'Dashboard'],
  photos: ['Project photos']
};

const TASK_SURFACES = {
  status: ['Kanban board', 'WBS / Tasks', 'Dashboard'],
  startDate: ['WBS / Tasks', 'Gantt', 'Dashboard'],
  endDate: ['WBS / Tasks', 'Gantt', 'Dashboard'],
  duration: ['WBS / Tasks', 'Gantt'],
  dependsOn: ['WBS / Tasks', 'Gantt'],
  workingDays: ['WBS / Tasks', 'Gantt'],
  assignee: ['WBS / Tasks', 'Resources', 'Gantt'],
  percent: ['WBS / Tasks', 'Gantt', 'Dashboard'],
  progress: ['WBS / Tasks', 'Gantt', 'Dashboard'],
  name: ['WBS / Tasks', 'Gantt', 'Kanban board', 'Dashboard'],
  notes: ['WBS / Tasks'],
  description: ['WBS / Tasks']
};

export function surfacesFor(path, field) {
  if (path === 'tasks') {
    return (TASK_SURFACES[field] || ['WBS / Tasks', 'Dashboard']).slice();
  }
  const list = KEY_SURFACES[path];
  return list ? list.slice() : [];
}

// Normalize one stored diff. Already-structured diffs (MCP producers) pass
// through; legacy flat leaves are split. Returns null when the path is not a
// usable project path or contains a prototype key.
export function normalizeDiff(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  let path = String(raw.path || '');
  let field = raw.field === undefined || raw.field === null ? '' : String(raw.field);
  let index = raw.index === undefined || raw.index === null ? null : Number(raw.index);
  let recordId = raw.recordId === undefined || raw.recordId === null ? '' : String(raw.recordId);
  let fullPath = String(raw.fullPath || '');

  if (!field || path.indexOf('[') > -1 || path.indexOf('.') > -1) {
    const parsed = parseDiffPath(path || fullPath);
    if (!parsed) {
      // A bare scalar key ("budgetEnvelope") is a whole-value change.
      if (!field && isScalarTopKey(path || fullPath)) {
        return {
          path: path || fullPath,
          index: null,
          recordId: recordId,
          recordName: raw.recordName ? String(raw.recordName) : '',
          field: '',
          fullPath: path || fullPath,
          before: raw.before,
          after: raw.after,
          beforeAbsent: raw.beforeAbsent === true,
          afterAbsent: raw.afterAbsent === true,
          surfaces: Array.isArray(raw.surfaces)
            ? raw.surfaces.slice()
            : surfacesFor(path || fullPath, '')
        };
      }
      return null;
    }
    path = parsed.path;
    if (!field) {
      field = parsed.field;
    }
    if (index === null && parsed.index !== null) {
      index = parsed.index;
    }
    if (!fullPath) {
      fullPath = raw.path;
    }
  }
  if (!path || isProtoKey(path) || (!field && !isScalarTopKey(path))) {
    return null;
  }
  if (!fullPath) {
    fullPath = (index === null ? path : path + '[' + index + ']') + (field ? '.' + field : '');
  }
  return {
    path: path,
    index: index,
    recordId: recordId,
    recordName: raw.recordName ? String(raw.recordName) : '',
    field: field,
    fullPath: fullPath,
    before: raw.before,
    after: raw.after,
    beforeAbsent: raw.beforeAbsent === true,
    afterAbsent: raw.afterAbsent === true,
    surfaces: Array.isArray(raw.surfaces) ? raw.surfaces.slice() : surfacesFor(path, field)
  };
}

// Legacy leaves carry no recordId, only an array index - the index must be
// part of the key or tasks[0].status and tasks[1].status collapse into one.
export function diffKey(d) {
  const rec = d.recordId || (d.index === null || d.index === undefined ? '' : '#' + d.index);
  return d.path + '|' + rec + '|' + d.field;
}

// Dedupe (last wins), drop unusable entries, cap the payload. The cap matches
// the propose-time limit (500); the flag tells the UI to say "and more".
export function normalizeProposalDiffs(rawDiffs, cap) {
  const limit = Number.isFinite(cap) ? cap : 500;
  const list = Array.isArray(rawDiffs) ? rawDiffs : [];
  const seen = {};
  const out = [];
  list.forEach(function (raw) {
    const d = normalizeDiff(raw);
    if (!d) {
      return;
    }
    const key = diffKey(d);
    if (seen[key] === undefined) {
      seen[key] = out.length;
      out.push(d);
    } else {
      out[seen[key]] = d;
    }
  });
  return {
    diffs: out.slice(0, limit),
    total: out.length,
    truncated: out.length > limit
  };
}

// Accept-side entry point: apply approved leaves to the CURRENT state instead
// of trusting a submitted snapshot. Handles creates (a leaf that was absent
// before, whose record exists in the submission), scalar top-level keys, and
// per-record fields. Returns every change that cannot be applied safely so the
// route can refuse the whole accept and name the values.
export function applyLeafDiffs(prev, approved, submitted) {
  const base = JSON.parse(JSON.stringify(prev && typeof prev === 'object' ? prev : {}));
  const out = {};
  const stale = [];
  const unaddressable = [];
  let changed = 0;
  (approved || []).forEach(function (raw) {
    const d = normalizeDiff(raw);
    if (!d) {
      unaddressable.push({
        path: raw && raw.path ? String(raw.path) : '',
        field: raw && raw.field ? String(raw.field) : '',
        reason: 'unreadable'
      });
      return;
    }
    if (!d.field) {
      const live = base[d.path];
      if (valuesEqual(live, d.after)) {
        return;
      }
      if (!d.beforeAbsent && !valuesEqual(live, d.before)) {
        stale.push({
          path: d.path,
          recordId: '',
          field: '',
          expected: d.before == null ? null : d.before,
          actual: live == null ? null : live
        });
        return;
      }
      if (d.afterAbsent) {
        delete base[d.path];
      } else {
        base[d.path] = d.after;
      }
      out[d.path] = base[d.path];
      changed++;
      return;
    }
    let arr = base[d.path];
    if (!Array.isArray(arr) && !arr && d.recordId && d.beforeAbsent) {
      // A create into a section the live snapshot does not carry yet (a
      // project whose first meeting or log entry arrives through a proposal)
      // starts an empty list. Refusing here made a title-keyed create
      // un-acceptable even though the producer's submission held the record.
      arr = [];
      base[d.path] = arr;
    }
    if (!Array.isArray(arr)) {
      // Object section: a leaf with no record identity and no index is a
      // nested key such as dmaic.define.problem or closure.lessons[0].text.
      if (d.index === null && !d.recordId && (arr === undefined || arr === null)) {
        base[d.path] = {};
      }
      if (
        d.index === null &&
        !d.recordId &&
        base[d.path] &&
        typeof base[d.path] === 'object' &&
        !Array.isArray(base[d.path])
      ) {
        const obj = base[d.path];
        const liveObj = getPathValue(obj, d.field);
        if (!d.beforeAbsent && !valuesEqual(liveObj, d.before)) {
          stale.push({
            path: d.path,
            recordId: '',
            field: d.field,
            expected: d.before == null ? null : d.before,
            actual: liveObj == null ? null : liveObj
          });
          return;
        }
        if (d.afterAbsent) {
          deletePathValue(obj, d.field);
        } else {
          setPathValue(obj, d.field, d.after);
        }
        out[d.path] = obj;
        changed++;
        return;
      }
      unaddressable.push({
        path: d.path,
        recordId: d.recordId,
        field: d.field,
        reason: 'not_a_list'
      });
      return;
    }
    let item = null;
    if (d.recordId) {
      item =
        arr.find(function (x) {
          return x && String(x.id) === d.recordId;
        }) || null;
    }
    if (!item && d.index !== null && d.index >= 0) {
      item = arr[d.index] || null;
    }
    if (!item && d.beforeAbsent) {
      const src = submitted && Array.isArray(submitted[d.path]) ? submitted[d.path] : [];
      let rec = null;
      if (d.recordId) {
        rec =
          src.find(function (x) {
            return x && String(x.id) === d.recordId;
          }) || null;
      }
      if (!rec && d.index !== null && src[d.index]) {
        rec = src[d.index];
      }
      if (rec) {
        item = JSON.parse(JSON.stringify(rec));
        arr.push(item);
      }
    }
    if (!item) {
      stale.push({
        path: d.path,
        recordId: d.recordId,
        field: d.field,
        expected: d.before == null ? null : d.before,
        actual: null,
        reason: 'record_missing'
      });
      return;
    }
    const live = getPathValue(item, d.field);
    if (!d.beforeAbsent && !valuesEqual(live, d.before)) {
      stale.push({
        path: d.path,
        recordId: d.recordId,
        field: d.field,
        expected: d.before == null ? null : d.before,
        actual: live == null ? null : live
      });
      return;
    }
    if (d.afterAbsent) {
      deletePathValue(item, d.field);
    } else {
      setPathValue(item, d.field, d.after);
    }
    out[d.path] = arr;
    changed++;
  });
  return { submitted: out, stale: stale, unaddressable: unaddressable, changed: changed };
}
// prev is the fallback (a delete has no next entry).
function recordAt(prevState, nextState, d) {
  if (d.index === null || d.index === undefined) {
    return null;
  }
  const sources = [nextState, prevState];
  for (let i = 0; i < sources.length; i++) {
    const st = sources[i];
    if (!st || typeof st !== 'object') {
      continue;
    }
    const arr = st[d.path];
    if (Array.isArray(arr) && arr[d.index] && typeof arr[d.index] === 'object') {
      return arr[d.index];
    }
  }
  return null;
}

// Producer entry point: normalize a cloudDiffState() leaf list, stamp each
// leaf with the record id/name it belongs to, drop fieldTs noise, dedupe and
// cap. Both the row's diffs_json and every later read use this shape.
export function enrichDiffs(rawDiffs, prevState, nextState, cap) {
  const list = Array.isArray(rawDiffs) ? rawDiffs : [];
  const enriched = [];
  list.forEach(function (raw) {
    if (raw && String(raw.path || '').indexOf('fieldTs') === 0) {
      return;
    }
    const d = normalizeDiff(raw);
    if (!d) {
      return;
    }
    if (!d.recordId || !d.recordName) {
      const rec = recordAt(prevState, nextState, d);
      if (rec) {
        if (!d.recordId && rec.id !== undefined && rec.id !== null) {
          d.recordId = String(rec.id);
        }
        if (!d.recordName) {
          d.recordName = recordNameOf(rec);
        }
      }
    }
    enriched.push(d);
  });
  return normalizeProposalDiffs(enriched, cap);
}
