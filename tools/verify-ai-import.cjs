/* ============================================================
   verify-ai-import.cjs - T1 static gate: AI-assisted Import Dates
   reading with mismatch flagging before commit (plan Task 3 +
   Task 9 entitlement seam, owner 2026-09-19).

   Checks (disk-to-disk, no browser):
     A1  validateImportLines exists in mmgr-tasks.js and is exported
     A2  validator flags shape errors AND end-before-start as blocking
     A3  validator warns on days-vs-dates disagreement (dates win)
     A4  idCommit refuses when severity==='error' issues exist
     A5  idCommit reconciles warn-level duration (dates drive days)
     A6  AI prompt builder exists in mmgr-ai.js and is exported
     A7  "Read with AI" handler: relay submit + line split + validate
         + degrades with honest toast offline
     A8  modal has AI button + #id-mismatch panel (project.html)
     A9  file input: .txt/.md accepted via FileReader, others refused
         with plain-language toast
     A10 entitlement seam exists (Entitlements.aiAssistant) and AI
         button renders only when the seam allows (signed-in);
         strict-grammar path stays available signed-out

   Usage:  node tools/verify-ai-import.cjs
   Exit:   0 all gates pass; 1 otherwise.
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const tasksSrc = fs.readFileSync(path.join(ROOT, 'js', 'mmgr-tasks.js'), 'utf8');
const aiSrc = fs.readFileSync(path.join(ROOT, 'js', 'mmgr-ai.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(ROOT, 'project.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'mmgr-app.js'), 'utf8');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 300)));
};

// A1: validator exists + exported
check('A1 validateImportLines defined and exported',
  /function validateImportLines\s*\(/.test(tasksSrc) && /validateImportLines\s*:/.test(tasksSrc),
  'function or export missing');

// A2: error severities - shape + inverted dates block commit
check('A2 validator severity error: not-in-format + end-before-start',
  /severity:\s*'error'/.test(tasksSrc) && /End date is before start date/.test(tasksSrc)
    && /Not in the format/.test(tasksSrc),
  'blocking reasons or severity missing');

// A3: warn on days-vs-dates disagreement, wording names both numbers
check('A3 validator warns days-vs-dates disagreement (dates win)',
  /severity:\s*'warn'/.test(tasksSrc) && /working days/.test(tasksSrc)
    && /durationFromDates\s*\(\s*start\s*,\s*end\s*\)/.test(tasksSrc),
  'warn path missing');

// A4: commit refuses on error-severity issues
check('A4 idCommit refuses while error issues exist',
  /hasErrors|severity\s*===?\s*'error'/.test(tasksSrc) && /refusing|Refusing|blocked|cannot import|Cannot import/.test(tasksSrc),
  'commit guard missing');

// A5: warn reconciliation - dates drive days (duration set from durationFromDates)
check('A5 idCommit reconciles warn durations: dates win',
  /dates?\s+win|dates drive|reconcil/i.test(tasksSrc),
  'reconciliation comment/logic missing');

// A6: AI prompt builder in mmgr-ai.js + exported
check('A6 aiNormalizeSchedulePrompt defined and exported',
  /function aiNormalizeSchedulePrompt\s*\(/.test(aiSrc) && /aiNormalizeSchedulePrompt\s*:/.test(aiSrc),
  'prompt builder or export missing');
check('A6b prompt demands the strict line grammar + ONLY-lines rule',
  /\(\d+d\)/.test(aiSrc) && /YYYY-MM-DD/.test(aiSrc) && /Output ONLY the lines|Output only the lines/i.test(aiSrc),
  'prompt contract incomplete');

// A7: read-with-AI handler: submit seam, parse lines, validate, offline toast
check('A7 idReadWithAi: submit seam + validate + offline degradation',
  /function idReadWithAi|async function idReadWithAi/.test(tasksSrc)
    && /aiNormalizeSchedulePrompt/.test(tasksSrc)
    && /validateImportLines\s*\(/.test(tasksSrc)
    && /submit\s*\(/.test(tasksSrc)
    && /works offline|Paste the strict format|strict format/i.test(tasksSrc),
  'AI read path incomplete');

// A8: modal markup - AI button + mismatch panel + file input
check('A8 project.html: AI button, mismatch panel, file input present',
  /id="id-ai-btn"/.test(htmlSrc) && /id="id-mismatch"/.test(htmlSrc) && /id="id-file"/.test(htmlSrc)
    && /accept="\.txt,\.md"/.test(htmlSrc),
  'modal wiring missing');
check('A8b action map wires idReadWithAi + idFilePick',
  /'idReadWithAi'\s*:/.test(appSrc) && /'idFilePick'\s*:/.test(appSrc),
  'action map entries missing');

// A9: file type honesty - txt/md read, others refused in plain language
check('A9 file input: txt/md read, others refused plainly',
  /\.endsWith\('\.txt'\)|\.endsWith\("\.txt"\)/.test(tasksSrc) && /\.endsWith\('\.md'\)|\.endsWith\("\.md"\)/.test(tasksSrc)
    && /paste the text|Can't read|can't read/i.test(tasksSrc),
  'file acceptance path incomplete');

// A10: entitlement seam (Task 9 delivers the module; Task 3 consumes it safely)
check('A10 Entitlements.aiAssistant seam gates the AI button',
  /Entitlements\s*&&\s*.*aiAssistant\(\)|Entitlements\.aiAssistant\(\)/.test(tasksSrc)
    && /AI reading is part of the signed-in experience|part of the signed-in/.test(tasksSrc),
  'entitlement gating missing');

const pass = results.every(r => r.ok);
console.log('\n' + (pass ? 'ALL CHECKS PASSED' : results.filter(r => !r.ok).length + ' CHECK(S) FAILED') + ' (' + results.length + ' total)');
process.exit(pass ? 0 : 1);
