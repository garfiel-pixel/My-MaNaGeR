/* ============================================================
   My MaNaGeR MCP — write-op validation (expanded)
   ------------------------------------------------------------
   Every write operation the AI proposes is validated here against
   per-record-type field whitelists + enum/type checks — model
   output is untrusted input (security-audit AI-AND-LLM.md:
   "Tool-argument injection"). The whitelists mirror the actual
   record shapes the app creates (js/mmgr-tasks.js addTask,
   mmgr-risks.js, mmgr-resources.js, mmgr-stakeholders.js,
   mmgr-decisions.js, mmgr-documents.js, mmgr-bids.js,
   mmgr-state.js defaults), so an AI edit can never introduce a
   field the app won't understand or a value the app's renderer
   can't display.

   validateOps(ops) -> { ok:true, ops } | { ok:false, error }
   ============================================================ */

export const STATUS_ENUM = ['todo', 'inprogress', 'blocked', 'completed'];
export const CONFIDENCE_ENUM = ['high', 'medium', 'low'];
export const LEVEL_ENUM = ['Low', 'Medium', 'High'];
export const ISSUE_STATUS_ENUM = ['open', 'inprogress', 'resolved', 'closed', ''];
export const CHANGE_STATUS_ENUM = ['submitted', 'review', 'approved', 'rejected', 'implemented', 'closed', ''];
export const RESOURCE_TYPE_ENUM = ['Labor', 'Equipment', 'Material', 'Subcontractor', 'Other'];
export const STAKEHOLDER_INFLUENCE_ENUM = ['Low', 'Medium', 'High'];
export const STAKEHOLDER_INTEREST_ENUM = ['Low', 'Medium', 'High'];
export const DOC_TYPE_ENUM = ['spec', 'drawing', 'report', 'contract', 'photo', 'rfi', 'submittal', 'correspondence', 'other'];
export const BID_STATUS_ENUM = ['pending', 'submitted', 'awarded', 'rejected', 'withdrawn'];
export const MEETING_KIND_ENUM = ['kickoff', 'weekly', 'risk', 'steering', 'phase-gate', 'lessons', 'custom'];
export const CLOSURE_STATUS_ENUM = ['pending', 'done'];

const isStr = v => typeof v === 'string';
const isBool = v => typeof v === 'boolean';
const isNum = v => typeof v === 'number' && isFinite(v);
const isDateStr = v => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{4}-\d{2}-\d{2}T/.test(v);
const isId = v => isStr(v) && v.length > 0 && v.length <= 64;
const isStrOrEmpty = v => typeof v === 'string';

// Whitelisted mutable fields per record type, keyed to their validators.
// Only these fields may be written by the AI — everything else is rejected.
const FIELD_SCHEMAS = {
  task: {
    name: { v: isStr, note: 'string' },
    status: { v: v => STATUS_ENUM.includes(v), note: STATUS_ENUM.join('|') },
    startDate: { v: isDateStr, note: 'YYYY-MM-DD or empty' },
    endDate: { v: isDateStr, note: 'YYYY-MM-DD or empty' },
    duration: { v: v => v === '' || isNum(v) || /^\d+(\.\d+)?$/.test(v), note: 'number or empty' },
    assignee: { v: isStr, note: 'string' },
    confidence: { v: v => CONFIDENCE_ENUM.includes(v), note: CONFIDENCE_ENUM.join('|') },
    milestone: { v: isBool, note: 'boolean' },
    weatherSensitive: { v: isBool, note: 'boolean' },
    notes: { v: isStr, note: 'string' }
  },
  risk: {
    description: { v: isStr, note: 'string' },
    probability: { v: v => LEVEL_ENUM.includes(v), note: LEVEL_ENUM.join('|') },
    impact: { v: v => LEVEL_ENUM.includes(v), note: LEVEL_ENUM.join('|') },
    mitigation: { v: isStr, note: 'string' }
  },
  issue: {
    description: { v: isStr, note: 'string' },
    status: { v: v => ISSUE_STATUS_ENUM.includes(v), note: ISSUE_STATUS_ENUM.join('|') }
  },
  budgetLine: {
    name: { v: isStr, note: 'string' },
    planned: { v: isNum, note: 'number' },
    actual: { v: isNum, note: 'number' }
  },
  change: {
    title: { v: isStr, note: 'string' },
    status: { v: v => CHANGE_STATUS_ENUM.includes(v), note: CHANGE_STATUS_ENUM.join('|') }
  },
  charter: {
    name: { v: isStr, note: 'string' },
    sponsor: { v: isStr, note: 'string' },
    objective: { v: isStr, note: 'string' },
    scope: { v: isStr, note: 'string' },
    deliverables: { v: isStr, note: 'string' },
    targetStart: { v: isDateStr, note: 'YYYY-MM-DD or empty' },
    targetCompletion: { v: isDateStr, note: 'YYYY-MM-DD or empty' },
    budgetEnvelope: { v: isNum, note: 'number' },
    constraints: { v: isStr, note: 'string' },
    assumptions: { v: isStr, note: 'string' }
  },
  resource: {
    name: { v: isStr, note: 'string' },
    type: { v: v => RESOURCE_TYPE_ENUM.includes(v), note: RESOURCE_TYPE_ENUM.join('|') },
    role: { v: isStr, note: 'string' },
    availability: { v: v => isNum(v) && v >= 0 && v <= 100, note: 'number 0-100' },
    rate: { v: v => isNum(v) && v >= 0, note: 'number >= 0' },
    hoursAllocated: { v: v => isNum(v) && v >= 0, note: 'number >= 0' }
  },
  stakeholder: {
    name: { v: isStr, note: 'string' },
    role: { v: isStr, note: 'string' },
    influence: { v: v => STAKEHOLDER_INFLUENCE_ENUM.includes(v), note: STAKEHOLDER_INFLUENCE_ENUM.join('|') },
    interest: { v: v => STAKEHOLDER_INTEREST_ENUM.includes(v), note: STAKEHOLDER_INTEREST_ENUM.join('|') },
    strategy: { v: isStr, note: 'string' },
    contact: { v: isStr, note: 'string' }
  },
  meeting: {
    kind: { v: v => MEETING_KIND_ENUM.includes(v), note: MEETING_KIND_ENUM.join('|') },
    date: { v: isDateStr, note: 'YYYY-MM-DD or empty' },
    attendees: { v: v => Array.isArray(v) || isStr(v), note: 'array or string' },
    minutes: { v: isStr, note: 'string' },
    actionItems: { v: v => Array.isArray(v) || isStr(v), note: 'array or string' }
  },
  decision: {
    title: { v: isStr, note: 'string' },
    date: { v: isDateStr, note: 'YYYY-MM-DD or empty' },
    owner: { v: isStr, note: 'string' },
    rationale: { v: isStr, note: 'string' },
    status: { v: v => ['pending', 'approved', 'rejected', 'implemented'].includes(v), note: 'pending|approved|rejected|implemented' }
  },
  document: {
    name: { v: isStr, note: 'string' },
    type: { v: v => DOC_TYPE_ENUM.includes(v), note: DOC_TYPE_ENUM.join('|') },
    location: { v: isStr, note: 'string' },
    notes: { v: isStr, note: 'string' }
  },
  bidPackage: {
    package: { v: isStr, note: 'string' },
    targetBudget: { v: isNum, note: 'number' },
    bidDeadline: { v: isDateStr, note: 'YYYY-MM-DD or empty' },
    status: { v: v => BID_STATUS_ENUM.includes(v), note: BID_STATUS_ENUM.join('|') }
  },
  closure: {
    well: { v: isStr, note: 'string' },
    improvements: { v: isStr, note: 'string' },
    recommendations: { v: isStr, note: 'string' }
  },
  sprint: {
    name: { v: isStr, note: 'string' },
    start: { v: isDateStr, note: 'YYYY-MM-DD or empty' },
    end: { v: isDateStr, note: 'YYYY-MM-DD or empty' }
  },
  spendLog: {
    date: { v: isDateStr, note: 'YYYY-MM-DD' },
    amount: { v: isNum, note: 'number' },
    description: { v: isStr, note: 'string' },
    category: { v: isStrOrEmpty, note: 'string' }
  },
  weatherLog: {
    date: { v: isDateStr, note: 'YYYY-MM-DD' },
    delayDays: { v: v => isNum(v) && v >= 0, note: 'number >= 0' },
    reason: { v: isStr, note: 'string' }
  },
  commsEntry: {
    date: { v: isDateStr, note: 'YYYY-MM-DD' },
    to: { v: isStr, note: 'string' },
    subject: { v: isStr, note: 'string' },
    body: { v: isStr, note: 'string' }
  },
  logEntry: {
    date: { v: isDateStr, note: 'YYYY-MM-DD' },
    text: { v: isStr, note: 'string' }
  },
  dmaic: {
    phase: { v: v => ['define', 'measure', 'analyze', 'improve', 'control'].includes(v), note: 'define|measure|analyze|improve|control' },
    field: { v: isStr, note: 'field name within the phase' },
    value: { v: v => typeof v === 'string' || typeof v === 'boolean', note: 'string or boolean' }
  },
  raci: {
    task: { v: isStr, note: 'task id or name' },
    person: { v: isStr, note: 'person name' },
    value: { v: v => ['R', 'A', 'C', 'I', ''].includes(v), note: 'R|A|C|I|empty' }
  }
};

// Top-level operation verbs -> { recordType, action, required, optional }
const OP_SCHEMAS = {
  'task.add': { recordType: 'task', action: 'add', required: ['name'], optional: ['status', 'startDate', 'endDate', 'duration', 'assignee', 'confidence', 'milestone', 'weatherSensitive', 'notes'] },
  'task.update': { recordType: 'task', action: 'update', required: ['id'], optional: ['name', 'status', 'startDate', 'endDate', 'duration', 'assignee', 'confidence', 'milestone', 'weatherSensitive', 'notes'] },
  'task.delete': { recordType: 'task', action: 'delete', required: ['id'], optional: [] },
  'risk.add': { recordType: 'risk', action: 'add', required: ['description', 'probability', 'impact'], optional: ['mitigation'] },
  'risk.update': { recordType: 'risk', action: 'update', required: ['id'], optional: ['description', 'probability', 'impact', 'mitigation'] },
  'risk.delete': { recordType: 'risk', action: 'delete', required: ['id'], optional: [] },
  'issue.add': { recordType: 'issue', action: 'add', required: ['description'], optional: ['status'] },
  'issue.update': { recordType: 'issue', action: 'update', required: ['id'], optional: ['description', 'status'] },
  'issue.delete': { recordType: 'issue', action: 'delete', required: ['id'], optional: [] },
  'budgetLine.add': { recordType: 'budgetLine', action: 'add', required: ['name', 'planned'], optional: ['actual'] },
  'budgetLine.update': { recordType: 'budgetLine', action: 'update', required: ['id'], optional: ['name', 'planned', 'actual'] },
  'budgetLine.delete': { recordType: 'budgetLine', action: 'delete', required: ['id'], optional: [] },
  'change.update': { recordType: 'change', action: 'update', required: ['id'], optional: ['title', 'status'] },
  'charter.update': { recordType: 'charter', action: 'update', required: [], optional: ['name', 'sponsor', 'objective', 'scope', 'deliverables', 'targetStart', 'targetCompletion', 'budgetEnvelope', 'constraints', 'assumptions'] },
  'resource.add': { recordType: 'resource', action: 'add', required: ['name'], optional: ['type', 'role', 'availability', 'rate', 'hoursAllocated'] },
  'resource.update': { recordType: 'resource', action: 'update', required: ['id'], optional: ['name', 'type', 'role', 'availability', 'rate', 'hoursAllocated'] },
  'resource.delete': { recordType: 'resource', action: 'delete', required: ['id'], optional: [] },
  'stakeholder.add': { recordType: 'stakeholder', action: 'add', required: ['name'], optional: ['role', 'influence', 'interest', 'strategy', 'contact'] },
  'stakeholder.update': { recordType: 'stakeholder', action: 'update', required: ['id'], optional: ['name', 'role', 'influence', 'interest', 'strategy', 'contact'] },
  'stakeholder.delete': { recordType: 'stakeholder', action: 'delete', required: ['id'], optional: [] },
  'meeting.add': { recordType: 'meeting', action: 'add', required: ['kind'], optional: ['date', 'attendees', 'minutes', 'actionItems'] },
  'meeting.update': { recordType: 'meeting', action: 'update', required: ['id'], optional: ['kind', 'date', 'attendees', 'minutes', 'actionItems'] },
  'meeting.delete': { recordType: 'meeting', action: 'delete', required: ['id'], optional: [] },
  'decision.add': { recordType: 'decision', action: 'add', required: ['title'], optional: ['date', 'owner', 'rationale', 'status'] },
  'decision.update': { recordType: 'decision', action: 'update', required: ['id'], optional: ['title', 'date', 'owner', 'rationale', 'status'] },
  'decision.delete': { recordType: 'decision', action: 'delete', required: ['id'], optional: [] },
  'document.add': { recordType: 'document', action: 'add', required: ['name'], optional: ['type', 'location', 'notes'] },
  'document.update': { recordType: 'document', action: 'update', required: ['id'], optional: ['name', 'type', 'location', 'notes'] },
  'document.delete': { recordType: 'document', action: 'delete', required: ['id'], optional: [] },
  'bidPackage.add': { recordType: 'bidPackage', action: 'add', required: ['package'], optional: ['targetBudget', 'bidDeadline', 'status'] },
  'bidPackage.update': { recordType: 'bidPackage', action: 'update', required: ['id'], optional: ['package', 'targetBudget', 'bidDeadline', 'status'] },
  'bidPackage.delete': { recordType: 'bidPackage', action: 'delete', required: ['id'], optional: [] },
  'closure.update': { recordType: 'closure', action: 'update', required: [], optional: ['well', 'improvements', 'recommendations'] },
  'sprint.update': { recordType: 'sprint', action: 'update', required: [], optional: ['name', 'start', 'end'] },
  'spendLog.add': { recordType: 'spendLog', action: 'add', required: ['date', 'amount'], optional: ['description', 'category'] },
  'weatherLog.add': { recordType: 'weatherLog', action: 'add', required: ['date', 'delayDays'], optional: ['reason'] },
  'commsEntry.add': { recordType: 'commsEntry', action: 'add', required: ['date', 'subject'], optional: ['to', 'body'] },
  'logEntry.add': { recordType: 'logEntry', action: 'add', required: ['date', 'text'], optional: [] },
  'dmaic.update': { recordType: 'dmaic', action: 'update', required: ['phase', 'field', 'value'], optional: [] },
  'raci.update': { recordType: 'raci', action: 'update', required: ['task', 'person', 'value'], optional: [] }
};

export function opCatalog() {
  return Object.keys(OP_SCHEMAS).map(op => {
    const s = OP_SCHEMAS[op];
    const fs = FIELD_SCHEMAS[s.recordType];
    return { op, recordType: s.recordType, action: s.action, required: s.required, fields: fs ? Object.keys(fs) : [] };
  });
}

function bad(msg) {
  return { ok: false, error: msg };
}

function validFieldValue(recordType, field, value) {
  const schema = FIELD_SCHEMAS[recordType] && FIELD_SCHEMAS[recordType][field];
  if (!schema) return false;
  return schema.v(value);
}

// Validate an array of operations. Each op: { op: '<verb>', ...args }.
// Enforces: known verb, required fields present, only whitelisted fields,
// field types/enums valid, ids non-empty strings.
export function validateOps(ops) {
  if (!Array.isArray(ops) || !ops.length) return bad('operations must be a non-empty array');
  if (ops.length > 20) return bad('at most 20 operations per change (batch safety)');

  const seen = new Set();
  for (const op of ops) {
    if (!op || typeof op !== 'object' || Array.isArray(op)) return bad('each operation must be an object');
    const verb = op.op;
    if (!OP_SCHEMAS[verb]) return bad('unknown operation "' + verb + '" — use mmgr_list_writable_fields to see the catalog');
    const schema = OP_SCHEMAS[verb];
    const fschema = FIELD_SCHEMAS[schema.recordType];
    const extra = Object.keys(op).filter(k => k !== 'op' && !schema.required.includes(k) && !schema.optional.includes(k) && k !== 'fields');
    if (extra.length) return bad(verb + ': unexpected field(s) ' + extra.join(', ') + ' — only whitelisted fields may be written');
    for (const req of schema.required) {
      if (op[req] === undefined || op[req] === null || op[req] === '') return bad(verb + ': missing required field "' + req + '"');
    }
    const fieldErr = (f) => {
      const s = fschema && fschema[f];
      return bad(verb + ': invalid value for "' + f + '" (expected ' + (s ? s.note : 'string') + ')');
    };
    if (schema.action !== 'add' && schema.action !== 'delete') {
      // update ops: at least one whitelisted field must actually change
      if (!fschema) return bad(verb + ': no field schema for record type "' + schema.recordType + '"');
      const patchFields = Object.keys(fschema).filter(f => op[f] !== undefined);
      if (!patchFields.length) return bad(verb + ': no writable fields supplied — nothing to change');
      for (const f of patchFields) {
        if (!validFieldValue(schema.recordType, f, op[f])) return fieldErr(f);
      }
    } else {
      // add/delete: required fields are record data (name/description/...) plus
      // the structural 'id' on deletes, which has no field schema — validate it
      // via the explicit id check below instead.
      for (const f of schema.required) {
        if (f === 'id') continue;
        if (!validFieldValue(schema.recordType, f, op[f])) return fieldErr(f);
      }
      for (const f of schema.optional) {
        if (op[f] !== undefined && !validFieldValue(schema.recordType, f, op[f])) return fieldErr(f);
      }
    }
    if (op.id !== undefined && !isId(op.id)) return bad(verb + ': id must be a non-empty string (max 64 chars)');
    if (op.id && seen.has(op.id)) return bad('duplicate record id "' + op.id + '" in one change batch');
    if (op.id) seen.add(op.id);
  }
  return { ok: true, ops };
}
