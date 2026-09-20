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

// ---- Task 13: sync bond (owner 2026-09-19) ----
need('export embeds cloudBond pointer when linked', 'js/mmgr-state.js',
  /cloudBond[\s\S]{0,300}cloudProjectId/);
need('import detects the bond and stores it locally', 'js/mmgr-state.js',
  /importState[\s\S]{0,1200}mmgr_cloud_bond_/);
need('bond pending flag exposed on State', 'js/mmgr-state.js', /isBondPending/);
need('cloud module stores + resolves the bond', 'js/mmgr-cloud.js',
  /function getBond[\s\S]{0,500}function clearBond/);
need('cloud create probes the bonded twin before making a duplicate', 'js/mmgr-cloud.js',
  /createProject[\s\S]{0,700}getBond\(\)/);
need('explicit re-sync action exists (load + per-field merge)', 'js/mmgr-cloud.js',
  /async function resyncNow[\s\S]{0,2500}mergeExternal/);
need('one-time re-sync offer renders in the unlinked branch', 'js/mmgr-cloud.js',
  /bondOfferPending\(\)[\s\S]{0,2000}cloudResync/);
need('re-sync + later actions wired in ACTION_MAP', 'js/mmgr-app.js',
  /'cloudResync'[\s\S]{0,300}'cloudBondLater'/);
need('bond carries no credential (id pointer only)', 'js/mmgr-state.js',
  /cloudProjectId: \(storedBond && storedBond\.cloudProjectId\) \|\| bondPid/);
process.exit(fail ? 1 : 0);
