/* verify-date-wiring.cjs - T1 static gate: endDate edits back-compute duration.
   Fails unless both wiring points exist in source. Run: node tools/verify-date-wiring.cjs */
'use strict';
const fs = require('fs');
let fail = 0;
function need(name, path, re) {
  let ok = false;
  try { ok = re.test(fs.readFileSync(path, 'utf8')); } catch (e) { ok = false; }
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) fail++;
}
need('updTaskField endDate branch back-computes duration', 'js/mmgr-tasks.js',
  /field === 'endDate'[\s\S]{0,400}durationFromDates/);
need('durationFromDates helper exported', 'js/mmgr-tasks.js', /durationFromDates/);
need('Gantt drag commit syncs duration', 'js/mmgr-render.js',
  /durationFromDates[\s\S]{0,200}\.duration\s*=/);
need('endDate commit patches duration cell in place (no WBS rebuild)', 'js/mmgr-tasks.js',
  /data-field="duration"\s*\)\);|input\[data-field="duration"\]/);
process.exit(fail ? 1 : 0);
