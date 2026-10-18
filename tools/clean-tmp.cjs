#!/usr/bin/env node
/* ============================================================
   tools/clean-tmp.cjs - session scratch cleanup (AUDIT-DIRECTIVE-2026-10-18, D-10)
   ------------------------------------------------------------
   tmp/ is where every session puts fetched pages, probe output, patches and
   screenshots. It is gitignored, listed in .assetsignore and excluded by the
   deploy tar recipe, so it can never be committed or served - but it grows
   without limit (354 MB / 4,466 files at the 2026-10-18 audit).

   Deletes files older than --days (default 14) and reports what it kept. Run it
   by hand, or from a session that wants a clean tree:

     node tools/clean-tmp.cjs              # dry run, prints the plan
     node tools/clean-tmp.cjs --apply      # deletes
     node tools/clean-tmp.cjs --apply --days 30
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const daysArg = args.indexOf('--days');
const days = daysArg > -1 ? Number(args[daysArg + 1]) || 14 : 14;
const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, 'tmp');

if (!fs.existsSync(TMP)) {
  console.log('[clean-tmp] no tmp/ directory - nothing to do');
  process.exit(0);
}

const cutoff = Date.now() - days * 86400000;
let deleted = 0;
let deletedBytes = 0;
let kept = 0;
let keptBytes = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(p);
      try {
        if (fs.readdirSync(p).length === 0) fs.rmdirSync(p);
      } catch (e) {
        /* not empty any more: leave it */
      }
      continue;
    }
    const st = fs.statSync(p);
    if (st.mtimeMs < cutoff) {
      deleted++;
      deletedBytes += st.size;
      if (apply) {
        fs.unlinkSync(p);
      }
    } else {
      kept++;
      keptBytes += st.size;
    }
  }
}

walk(TMP);
const mb = n => (n / 1048576).toFixed(1) + ' MB';
console.log(
  '[clean-tmp] older than ' + days + ' days: ' + deleted + ' file(s), ' + mb(deletedBytes)
);
console.log('[clean-tmp] kept (recent): ' + kept + ' file(s), ' + mb(keptBytes));
console.log(
  apply ? '[clean-tmp] deleted.' : '[clean-tmp] dry run - re-run with --apply to delete.'
);
