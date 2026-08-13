/* ============================================================
   verify-report-issue.cjs — MASTER-ACTION-PLAN Rank 6.1 gate
   ------------------------------------------------------------
   Static gate over js/mmgr-report.js's PURE reportIssueText()
   builder. Asserts the hard exclusion rule from the plan: the
   default payload NEVER includes budget dollar figures, risk
   descriptions, or personal names; the explicit Include-project-
   context opt-in adds them; AI keys never appear in either mode.

   Zero dependencies. Run:  node tools/verify-report-issue.cjs
   ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// Load the module with a bare window shim — reportIssueText() itself reads
// no DOM (buildPackage does, and is not exercised here).
global.window = { MMGR: {} };
require(path.join(ROOT, 'js', 'mmgr-report.js'));
const Report = global.window.MMGR.Report;

const state = {
  schemaVersion: 18,
  charter: { name: 'Secret Project Omega', sponsor: 'Pat Doe' },
  tasks: [{ id: 't1', status: 'inprogress', name: 'Pour foundation' }, { id: 't2', status: 'completed', name: 'Strip out' }],
  risks: [{ description: 'Sensitive risk detail', probability: 'High', impact: 'Medium' }],
  issues: [{ description: 'Private issue detail' }],
  budgetLines: [{ planned: 123456, actual: 234567 }],
  changes: [{}],
  meetings: [{ title: 'Steering board' }],
  decisions: [{ text: 'Proceed with phase 2' }],
  stakeholders: [{ name: 'Confidential Stakeholder' }],
  packs: { schedule: false, money: true, governance: true, field: true, quality: false },
  config: { ai: { apiKey: 'sk-SUPER-SECRET-999' } }
};
const errors = [
  { ts: '2026-08-12T10:00:00.000Z', action: 'global', msg: 'window error: boom' },
  { ts: '2026-08-12T10:01:00.000Z', action: 'promise', msg: 'unhandled rejection' }
];

let fails = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('  PASS  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

const opts = { activePanel: 'wbs', viewport: '1440x900', theme: 'default (dark)', ua: 'test-ua' };
const sanitized = Report.reportIssueText(state, errors, opts);
const full = Report.reportIssueText(state, errors, Object.assign({}, opts, { includeContext: true }));

console.log('Report Issue gate (MASTER-ACTION-PLAN Rank 6.1)');
console.log('--- R1 sanitized payload: informative skeleton ---');
check('R1a header line present', sanitized.indexOf('Report Issue package') > -1);
check('R1b schema version present', sanitized.indexOf('Schema version: 18') > -1);
check('R1c active panel present', sanitized.indexOf('Active panel: wbs') > -1);
check('R1d packs line present with ON/OFF split', sanitized.indexOf('Packs ON: money, governance, field') > -1 && sanitized.indexOf('OFF: schedule, quality') > -1);
check('R1e counts line present', sanitized.indexOf('Counts — tasks: 2') > -1 && sanitized.indexOf('budget lines: 1') > -1);
check('R1f error log entries rendered', sanitized.indexOf('window error: boom') > -1 && sanitized.indexOf('unhandled rejection') > -1);
check('R1g pack order is the five canonical names', Report.PACK_ORDER.length === 5 && Report.PACK_ORDER.join(',') === 'schedule,money,governance,field,quality');

console.log('--- R2 sanitized payload: hard exclusions (the plan rule) ---');
const forbidden = [
  'Secret Project Omega', 'Pat Doe', 'Pour foundation', 'Strip out',
  'Sensitive risk detail', 'Private issue detail', '123456', '234567',
  'Confidential Stakeholder', 'Steering board', 'sk-SUPER-SECRET-999'
];
for (const f of forbidden) check('R2 excludes ' + JSON.stringify(f), sanitized.indexOf(f) === -1);
check('R2 note that context is omitted', sanitized.indexOf('Project context omitted') > -1);

console.log('--- R3 opt-in context adds names/figures, still never keys ---');
check('R3 project name appears', full.indexOf('Secret Project Omega') > -1);
check('R3 sponsor appears', full.indexOf('Pat Doe') > -1);
check('R3 task list appears', full.indexOf('Pour foundation') > -1);
check('R3 risk description appears', full.indexOf('Sensitive risk detail') > -1);
check('R3 issue description appears', full.indexOf('Private issue detail') > -1);
check('R3 budget totals appear (planned + actual)', full.indexOf('123,456 planned') > -1 && full.indexOf('234,567 actual') > -1);
check('R3 AI key STILL never appears', full.indexOf('sk-SUPER-SECRET-999') === -1);

console.log('--- R4 zero-fabrication on an empty project ---');
const empty = Report.reportIssueText({ schemaVersion: 18, packs: {} }, [], {});
check('R4 empty counts render (none/0)', empty.indexOf('tasks: 0') > -1 && empty.indexOf('Error log (0):') > -1 && empty.indexOf('(none)') > -1);

console.log('---');
console.log((fails ? 'FAIL ' : 'PASS ') + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
