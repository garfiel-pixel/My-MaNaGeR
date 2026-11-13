/* MCP model tests (MCP-AGENT-FIRST 2026-11-12 2.1).
   The model must equal what the app's own creators produce, field for field.
   This test loads the client modules in a vm sandbox with a minimal MMGR
   namespace, calls the real creators, and compares the resulting record shape
   with src/mcp/model.js. No browser, no storage. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  MODEL,
  LIST_PATHS,
  createDefaults,
  canonicalField,
  fieldSpec,
  isDeletable,
  TASK_STATUSES,
  ISSUE_STATUSES,
  CHANGE_STATUSES,
  SCALE_3,
  CONFIDENCE,
  RESOURCE_TYPES,
  DOCUMENT_TYPES,
  DOCUMENT_STATUSES,
  COMMS_TYPES
} from '../src/mcp/model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const js = name => fs.readFileSync(path.join(here, '..', 'js', name), 'utf8');

const noop = () => {};
const state = {
  tasks: [],
  resources: [],
  risks: [],
  issues: [],
  stakeholders: [],
  changes: [],
  logEntries: [],
  commsEntries: [],
  documents: [],
  meetings: [],
  activeMeeting: null,
  nmeetid: 1
};
let seq = 0;

const sandbox = {
  window: {},
  console,
  // startMeeting arms an elapsed-time timer; the test must not keep node
  // alive waiting on it.
  setInterval: () => 0,
  clearInterval: noop
};
sandbox.window.MMGR = {
  Utils: {
    genId: prefix => (prefix || 't') + '_' + ++seq,
    genShortId: prefix => (prefix || 'x') + String(++seq).padStart(3, '0'),
    todayStr: () => '2026-11-12',
    fmtDate: d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '')),
    addWorkingDays: d => d,
    daysBetween: () => 0,
    isOverdue: () => false,
    escapeHtml: v => String(v == null ? '' : v),
    $: () => null
  },
  Render: new Proxy(
    {},
    {
      get: () => noop
    }
  ),
  State: {
    getState: () => state,
    updateState: fn => {
      fn(state);
      return state;
    }
  },
  Process: {
    runRules: () => ({ messages: [], hooks: [] })
  },
  App: { showToast: noop, dispatchHooks: noop }
};
vm.createContext(sandbox);
[
  'mmgr-kanban.js',
  'mmgr-process.js',
  'mmgr-tasks.js',
  'mmgr-resources.js',
  'mmgr-risks.js',
  'mmgr-stakeholders.js',
  'mmgr-closure.js',
  'mmgr-meetings.js'
].forEach(name => vm.runInContext(js(name), sandbox));

const M = sandbox.window.MMGR;

// Keys a create starts with. `id` is server-assigned for every list, and the
// Decision Log creator writes no id at all, so it is compared separately.
const keysOf = record =>
  Object.keys(record)
    .filter(k => k !== 'id')
    .sort();

const creatorRecords = {};
creatorRecords.tasks = (() => {
  M.Tasks.createTask({});
  return state.tasks[state.tasks.length - 1];
})();
creatorRecords.resources = (() => {
  M.Resources.addResource();
  return state.resources[state.resources.length - 1];
})();
creatorRecords.risks = (() => {
  M.Risks.addRisk();
  return state.risks[state.risks.length - 1];
})();
creatorRecords.issues = (() => {
  // The only issue creator in the client: a risk raises one.
  M.Risks.toggleRiskIssue(0);
  return state.issues[state.issues.length - 1];
})();
creatorRecords.logEntries = (() => {
  M.Log.addLog();
  return state.logEntries[state.logEntries.length - 1];
})();
creatorRecords.meetings = (() => {
  // endMeeting stores a JSON clone of the live session, so the active record
  // IS the stored field set.
  M.Meetings.startMeeting('kickoff');
  return state.activeMeeting;
})();
creatorRecords.stakeholders = (() => {
  M.Stakeholders.addStake();
  return state.stakeholders[state.stakeholders.length - 1];
})();
creatorRecords.documents = (() => {
  M.Documents.addDoc();
  return state.documents[state.documents.length - 1];
})();
creatorRecords.changes = (() => {
  M.Changes.addChange();
  return state.changes[state.changes.length - 1];
})();
creatorRecords.commsEntries = (() => {
  M.Comms.addComms();
  return state.commsEntries[state.commsEntries.length - 1];
})();

test('every modelled list has a client creator under test', () => {
  LIST_PATHS.filter(p => MODEL.lists[p].writeVia !== 'budget').forEach(p => {
    assert.ok(creatorRecords[p], 'no creator record captured for ' + p);
  });
});

for (const path of LIST_PATHS) {
  if (MODEL.lists[path].writeVia === 'budget') {
    continue;
  }
  test(path + ': create defaults equal the UI creator field set', () => {
    assert.deepEqual(
      keysOf(createDefaults(path)),
      keysOf(creatorRecords[path]),
      path + ' defaults drifted from js/ creator'
    );
  });
}

test('tasks.status enum equals the Kanban COLUMNS constant', () => {
  assert.deepEqual(TASK_STATUSES, Array.from(M.Kanban.COLUMNS));
  assert.deepEqual(fieldSpec('tasks', 'status').enum, TASK_STATUSES);
});

test('issue and change enums equal the process model constants', () => {
  assert.deepEqual(ISSUE_STATUSES, Array.from(M.Process.ISSUE_STATUSES));
  assert.deepEqual(CHANGE_STATUSES, Array.from(M.Process.CHANGE_STATUSES));
  assert.deepEqual(fieldSpec('issues', 'status').enum, ISSUE_STATUSES);
  assert.deepEqual(fieldSpec('changes', 'status').enum, CHANGE_STATUSES);
});

test('risk and stakeholder scales come from the client selects', () => {
  assert.deepEqual(SCALE_3, ['Low', 'Medium', 'High']);
  assert.match(js('render/risks.js'), /const probs = \['Low', 'Medium', 'High'\]/);
  assert.match(js('render/people.js'), /\['Low', 'Medium', 'High'\]\.map/);
  assert.deepEqual(fieldSpec('risks', 'probability').enum, SCALE_3);
  assert.deepEqual(fieldSpec('risks', 'impact').enum, SCALE_3);
  assert.deepEqual(fieldSpec('stakeholders', 'influence').enum, SCALE_3);
  assert.deepEqual(fieldSpec('stakeholders', 'interest').enum, SCALE_3);
});

test('resource, document and comms enums come from the client selects', () => {
  assert.match(js('render/resources.js'), /'Labor', 'Equipment', 'Material', 'Subcontractor'/);
  assert.match(
    js('render/documents.js'),
    /'Drawing', 'Contract', 'Permit', 'Specification', 'Report', 'Other'/
  );
  assert.match(
    js('render/documents.js'),
    /'current', 'pending-review', 'superseded', 'outstanding'/
  );
  assert.match(js('render/people.js'), /'Meeting', 'Call', 'Email', 'Site Visit', 'Letter'/);
  assert.deepEqual(fieldSpec('resources', 'type').enum, RESOURCE_TYPES);
  assert.deepEqual(fieldSpec('documents', 'type').enum, DOCUMENT_TYPES);
  assert.deepEqual(fieldSpec('documents', 'status').enum, DOCUMENT_STATUSES);
  assert.deepEqual(fieldSpec('commsEntries', 'type').enum, COMMS_TYPES);
});

test('confidence values match the client state contract', () => {
  assert.deepEqual(CONFIDENCE, ['high', 'medium', 'low']);
  assert.match(js('mmgr-state.js'), /'low'\|'medium'\|'high'/);
});

test('risk and issue text is stored as description, name is an input alias', () => {
  assert.equal(canonicalField('risks', 'name'), 'description');
  assert.equal(canonicalField('issues', 'name'), 'description');
  assert.equal(canonicalField('tasks', 'name'), 'name');
  assert.equal(canonicalField('risks', 'description'), 'description');
  assert.equal(canonicalField('risks', 'nope'), null);
});

test('the derived set covers every field the app recomputes', () => {
  const derived = name => fieldSpec('tasks', name).derived === true;
  [
    'id',
    'critical',
    'totalFloat',
    'freeFloat',
    'floatBaseline',
    'statusSince',
    'startedDate',
    'completedDate',
    'boardPosition',
    'weatherExposed',
    'createdDate',
    '_schedPad'
  ].forEach(name => assert.equal(derived(name), true, name + ' must be derived'));
  // A phase's dates are rolled up from its children; a leaf's are editable.
  assert.equal(fieldSpec('tasks', 'startDate').derived, false);
  assert.equal(fieldSpec('tasks', 'startDate').derivedWhen, 'isPhase');
  assert.equal(fieldSpec('tasks', 'endDate').derivedWhen, 'isPhase');
  assert.equal(fieldSpec('budgetLines', 'actual').derived, true);
  assert.equal(fieldSpec('resources', 'utilization').derived, true);
});

test('every date field is flagged and every enum is an array', () => {
  Object.keys(MODEL.lists).forEach(path => {
    const fields = MODEL.lists[path].fields;
    Object.keys(fields).forEach(name => {
      const f = fields[name];
      if (f.date) {
        assert.equal(f.type, 'string', path + '.' + name + ': a date is a string');
      }
      if (f.enum) {
        assert.ok(Array.isArray(f.enum) && f.enum.length > 0, path + '.' + name + ': enum');
      }
    });
  });
  assert.equal(fieldSpec('tasks', 'startDate').date, true);
  assert.equal(fieldSpec('tasks', 'createdDate').date, true);
  assert.equal(fieldSpec('stakeholders', 'coiExpiry').date, true);
  assert.equal(fieldSpec('documents', 'dateIssued').date, true);
});

test('every list names a title field that exists in the model', () => {
  Object.keys(MODEL.lists).forEach(path => {
    const list = MODEL.lists[path];
    assert.ok(list.titleField, path + ': titleField');
    assert.ok(list.fields[list.titleField], path + ': titleField is modelled');
  });
});

test('money tables are not deletable through the generic path', () => {
  assert.equal(isDeletable('budgetLines'), false);
  assert.equal(isDeletable('spendLog'), false);
  assert.equal(isDeletable('tasks'), true);
  assert.equal(isDeletable('commsEntries'), true);
});

test('a custom key is not a modelled field, so callers can gate it', () => {
  // The model deliberately returns null: the caller checks the client's own
  // CustomFields.isCustomKey predicate before accepting cf_* keys.
  assert.equal(canonicalField('tasks', 'cf_zone'), null);
  assert.equal(fieldSpec('tasks', 'cf_zone'), null);
});
