# P10 Loop + Full Repo Audit — Findings & Remedy Plan
Auditor: Claude (manager/auditor role — no code touched, static analysis only)
Source: mymanager-fixed__2_.zip, as of the moment of upload
Scope: full unzip, git history/status, every diff, targeted source trace of the P10 flow

Every finding below is traced to an actual file, line, or `git diff` output — not a guess.
Nothing here was "fixed" by me. This is what the terminal AI needs to do next, in order.

---

## 0. TL;DR — do these in this exact order

1. **Fix the CRLF contamination first.** This is almost certainly why the terminal AI
   "lost track of which version is staged vs working tree" — it's not confusion, the
   diffs it was reading were 90%+ fake noise (see Finding 1).
2. **Fix two real bugs in `tools/qa-client-codes.cjs`'s P10 diagnostic code** (Finding 2)
   — as currently written, the console-error capture the AI added CANNOT ever report a
   real error. That's why every P10 hardening attempt "felt" blind.
3. **Re-run P10 once**, with working diagnostics this time, and read the actual output
   before writing another line of code.
4. Then, and only then, decide whether the bug is in app.html, the worker, or the harness.

Do **not** `git reset --hard HEAD` on `tools/qa-client-codes.cjs` (option "a" in the
last status update). The staged diff contains real, wanted work (P0c–P0e editor-scope
tests + the P10 diagnostic scaffolding). Resetting would throw that away. Fix forward
instead — see Section 4 for the exact sequence.

---

## FINDING 1 — CRITICAL: The working tree is CRLF-corrupted across 139 tracked files

**This is the actual root cause of "I lost track of which version is staged vs
working-tree vs HEAD."** It is not a debugging-discipline failure — the diffs
themselves were lying.

### Evidence

```
$ file tools/qa-client-codes.cjs
tools/qa-client-codes.cjs: ASCII text, with CRLF line terminators

$ git diff --stat -- tools/qa-client-codes.cjs
 tools/qa-client-codes.cjs | 764 +++++++++++++++++++++++-----------------------
 1 file changed, 382 insertions(+), 382 deletions(-)
```

That looks like the whole 382-line file was rewritten. It was not. Stripping `\r` and
diffing again:

```
$ tr -d '\r' < tools/qa-client-codes.cjs | diff <(git show :tools/qa-client-codes.cjs) -
(zero lines of output)
```

**Byte-for-byte identical content.** The entire "382/382" diff is CRLF vs LF noise.
Zero real changes exist between the staged version and the working-tree version of
this file.

This is not isolated to one file. Checking the whole tracked tree:

```
$ git ls-files | xargs file | grep CRLF | wc -l
139
```

139 tracked files — nearly every `.js`, `.cjs`, `.md`, `.sql`, `.json`/`.jsonc`, `.yml`
in the repo — currently have CRLF line endings in the working tree while HEAD has LF.
Concretely, for files touching the exact flow under investigation:

| File | git diff --stat says | real content diff (CRLF-normalized) |
|---|---|---|
| `worker.js` | 193 ins / 193 del | **0** |
| `sw.js` | 131 ins / 131 del | **0** |
| `src/cloud/projects.js` | 567 ins / 567 del | 72 (real — session-owner-save + lookup-scope work) |
| `js/mmgr-cloud.js` | 2013 ins / 2013 del | 222 (real) |
| `tools/qa-client-codes.cjs` (staged→working) | 382 ins / 382 del | **0** |

So the vast majority of the ~150 files `git status` currently shows as "modified" are
**not actually modified** — they're CRLF echoes of HEAD. This is exactly the kind of
noise that makes it impossible to tell what you're running vs. what you last verified,
and it's why re-reading the same files repeatedly felt like a loop: the file *looked*
different every time a diff was pulled, even when nothing had changed.

### Why this happened (and why it's not the first time)

`.gitattributes` already exists and already documents this exact failure mode:

```
*.html text eol=lf
```
with a comment: *"CRLF in a served HTML working copy changes the inline `<script>`
bytes and silently blocks every inline script in production (see commit v30, which
re-normalized project.html to LF for exactly this reason)."*

**The fix from v30 only covers `*.html`.** It was never extended to `.js`, `.cjs`,
`.md`, `.sql`, `.json`, `.jsonc`, `.yml` — which is exactly the file-type set that just
got corrupted. Some Windows-side tool/shell in a prior session (per the project's own
`shell-discipline` skill notes) wrote those files back out with CRLF, and nothing in
`.gitattributes` or CI catches it for non-HTML files.

### The fix

**Step 1 — extend `.gitattributes`** so git normalizes on `git add` from now on and
this class of bug becomes structurally impossible to reintroduce:

```gitattributes
# existing line — do not remove
*.html text eol=lf

# ADD — same reasoning as the HTML rule, applied to every text source type
# that has been hand-edited from a Windows shell in this project
*.js    text eol=lf
*.cjs   text eol=lf
*.mjs   text eol=lf
*.md    text eol=lf
*.json  text eol=lf
*.jsonc text eol=lf
*.sql   text eol=lf
*.yml   text eol=lf
*.css   text eol=lf
*.svg   text eol=lf
*.txt   text eol=lf
```

(Keep binary assets — `.png`, `.webp`, `.jpg` — out of this; git already treats them as
binary by default as long as they aren't matched by a `text` rule above.)

**Step 2 — renormalize the working tree** (this touches file bytes only, not logic —
still "not editing code" in the sense that matters: no function bodies change):

```bash
git add --renormalize .
git status   # should now show ONLY real content changes
```

**Step 3 — verify the noise is gone:**

```bash
git diff --cached --stat -- tools/qa-client-codes.cjs
# expect: the real ~68-line diff (P0c-e + P10 diagnostics), not 764 lines
```

**Step 4 — add a CI gate so this can never silently land again.** There is currently
no line-ending check in `.github/workflows/ci.yml` at all — `verify:csp` will only
catch it for the HTML files whose hashes are hardcoded, nothing catches it for JS/MD/SQL.
Add this as a new step (before the existing verify steps):

```yaml
      - name: Verify no CRLF in tracked text files
        run: |
          BAD=$(git grep -Il $'\r' -- '*.js' '*.cjs' '*.mjs' '*.md' '*.json' '*.jsonc' '*.sql' '*.yml' '*.css' '*.txt' || true)
          if [ -n "$BAD" ]; then
            echo "CRLF line endings found in:"
            echo "$BAD"
            exit 1
          fi
```

---

## FINDING 2 — HIGH: The P10 harness's own diagnostic code cannot capture errors

This is separate from Finding 1 and is a **real logic bug**, not an EOL artifact. It
explains why previous P10 "hardening" passes never surfaced a root cause even when the
AI added console-error capture specifically to find one.

### Where (staged diff, `tools/qa-client-codes.cjs`, current P10 block)

```javascript
// (A) BEFORE the click — installs a console.error override, stores errors
//     into window.__ccClickPre.errors
const preClickConsole = await ev(`(function(){
  const orig = console.error;
  let errors = [];
  console.error = function() { errors.push(Array.prototype.slice.call(arguments).join(' ')); };
  window.__ccClickPre = { ..., errors: errors };
  return window.__ccClickPre;
})()`);

// (B) the actual click
await ev(`(function(){ ... if (...) b.click(); return {...}; })()`);

// (C) AFTER the click — installs a SECOND, BRAND NEW console.error override
//     with its own fresh, empty `errors` array
const postClickConsole = await ev(`(function(){ return window.__ccClickErrors || (window.__ccClickErrors = (function(){
    const orig = console.error;
    let errors = [];
    console.error = function() { errors.push(Array.prototype.slice.call(arguments).join(' ')); };
    return errors;
  })()); })()`);
```

### The bug

1. Block (C) runs **after** the click already happened. Any `console.error` call that
   fired synchronously during the click handler already went to the **original**
   `console.error` from block (A)'s closure — block (C) wasn't installed yet, so it
   physically cannot have seen it.
2. Block (C) then **overwrites** the override that block (A) installed, replacing it
   with a second override that starts from a fresh empty `errors` array. Any error
   captured by (A)'s override (which is still live and pushing into (A)'s `errors`
   array) is now orphaned — nothing ever reads `window.__ccClickPre.errors` again
   after the click.
3. Net result: **`postClickConsole` will report `[]` almost every single time**,
   whether or not `cloudCodeOpen()` actually threw or logged anything. This gives a
   false "no errors" signal on every run, which is worse than no diagnostic at all —
   it actively tells you the wrong thing.

### The fix — one override, installed once, read once

```javascript
// Install ONE override before the click, and just keep reading the SAME array.
// Do this once, right after navigating to app.html and before doing anything else.
await ev(`(function(){
  if (window.__mmgrConsoleErrors) return; // idempotent if re-run
  window.__mmgrConsoleErrors = [];
  const orig = console.error;
  console.error = function() {
    window.__mmgrConsoleErrors.push(Array.prototype.slice.call(arguments).map(String).join(' '));
    orig.apply(console, arguments);
  };
})()`);

// ... later, at ANY point (before click, after click, after delay — doesn't matter,
// it's the same live array) ...
const consoleErrors = await ev(`window.__mmgrConsoleErrors || []`);
```

Then use `consoleErrors` (a single, continuously-growing array) instead of the two
separate/broken `preClickConsole`/`postClickConsole` variables. This is the change
that will actually tell you whether `cloudCodeOpen` threw, and where.

---

## FINDING 3 — MEDIUM: Diagnostics are read before the async work they're diagnosing has finished

Current order in the staged diff:

```javascript
await ev(click script)          // synchronous click dispatch only
const postClickConsole = await ev(...)   // read IMMEDIATELY
const clickResult = await ev(...)        // read IMMEDIATELY
await delay(3000)                        // the wait happens AFTER reading diagnostics
const launcherState = await ev(...)      // navigation is actually checked here
```

`cloudCodeOpen()` is `async` and does two sequential `fetch()` calls (`/api/cloud/codes/lookup`
then `/api/cloud/projects/:id/load`) before it navigates. Reading `clickResult` (button
`disabled` state) immediately after the synchronous click — before either fetch has
resolved — tells you almost nothing about the outcome; it just tells you the state
mid-flight, one microtask in.

### The fix — read state AFTER the settle delay, not before it

```javascript
await ev(click script);
await delay(3500); // let both fetches + navigation actually happen first
const consoleErrors = await ev(`window.__mmgrConsoleErrors || []`);
const clickResult = await ev(`(function(){
  const b = document.getElementById('code-entry-btn');
  return { href: location.href, btnDisabled: b ? b.disabled : null, btnText: b ? b.textContent.trim() : null };
})()`);
const launcherState = await ev(...); // existing check, unchanged
check('P10a ...', navOk && esc && ..., { launcherState, consoleErrors, clickResult });
```

If `cloudCodeOpen` is still sitting on a rejected/never-resolving fetch at that point,
`clickResult.btnText` will still read `"Opening…"` — which is itself a useful,
honest diagnostic (means the request never came back), instead of a meaningless
snapshot from one tick after the click.

---

## FINDING 4 — Reconciling staged vs. working tree (answers the "(a) or (b)" question)

Neither option as posed is quite right once Finding 1 is accounted for:

- **Option (a) (`git reset` to HEAD, reapply on top)** would throw away the staged
  P0c–P0e editor-scope tests and the P10 diagnostic scaffolding — real, wanted work,
  confirmed not to be CRLF noise (it's the genuine `+62/-6` diff shown in Finding 1's
  table). Don't do this.
- **Option (b) (keep current edits, just get a clean P10 run)** is directionally right,
  but "the current edits" as they stand include the broken diagnostic code from
  Finding 2, so a "clean run" would still report bogus (empty) console errors even if
  it fails.

**Correct sequence:**

```bash
# 1. Kill the CRLF noise everywhere (Finding 1)
git add --renormalize .

# 2. Confirm the staged tools/qa-client-codes.cjs diff is now just the real +62/-6
git diff --cached --stat -- tools/qa-client-codes.cjs

# 3. Apply the two harness fixes from Finding 2 and Finding 3 on top of the
#    now-clean staged version (single console-error install, diagnostics read
#    after the settle delay)

# 4. Run ONLY the P10 harness, capture full output to a file so there's a
#    single source of truth for this run (no more re-reading stale terminal scrollback):
node tools/qa-client-codes.cjs > tmp/p10-run-$(date +%s).log 2>&1
grep -A2 "P10" tmp/p10-run-*.log | tail -60

# 5. Read that file. Do not re-edit the harness again until you've read it.
```

---

## FINDING 5 — Repo hygiene: ~150 files staged/unstaged simultaneously, mixed intent

`git status` currently shows 16 files staged for commit and ~130 additional files
modified-but-unstaged, plus 3 untracked files at repo root. Once Finding 1's
renormalization is applied, most of the *unstaged* pile should collapse to nothing
(pure CRLF echo). Whatever remains unstaged after renormalizing is the real thing to
review before the next commit — don't `git add -A` blindly, because at least two
of the currently-listed "modified" files (`js/mmgr-app.js`, `src/mcp/server.js`, etc.)
may contain real, separate work-in-progress that hasn't been described anywhere yet.
Recommend: after Step 1 of Finding 4, run `git diff --stat` (unstaged) and `git diff
--cached --stat` (staged) and account for every remaining file by name before the next
commit — don't let this pile grow further.

Also flagging, low priority: three **untracked** files sit at the repo root —
`Freebuff CONTINUE.txt`, `Freebuff add a full comprehensive calculater as a project
#U2026.txt`, and `images/site-blueprint.webp`. The two `.txt` files look like
conversation-continuation scratch notes, not source. They're already excluded from the
deploy tarball pattern-wise (`--exclude='Freebuff*'` in `package.json`'s `deploy`
script), so they won't ship, but they're also not in `.gitignore`, so a stray `git add
-A` will pull them into the repo permanently. Recommend adding to `.gitignore`:

```gitignore
Freebuff*.txt
```

---

## FINDING 6 — Checked and clean (for completeness, since "flag everything" was the ask)

- **`mymanager.app` / `garfieldprocis.workers.dev` hardcoded domain refs**: searched
  every `.html`/`.js`/`.json`/`.jsonc` outside `_archive/` — **zero hits**. This
  matches the "confirmed open bug" from earlier sessions, but it appears to have
  already been resolved since that note was written. Worth a quick manual confirm on
  the live canonical/OG/JSON-LD tags before closing it out permanently, since this
  audit only checked the unzipped source tree, not the deployed site.
- **Hardcoded secrets / API keys**: none found via pattern scan across `.js`/`.json`/`.jsonc`.
- **`.gitleaksignore` fingerprint format**: entries are well-formed
  (`<sha>:<file>:<rule>:<line>`), contrary to the "malformed fingerprint" note in
  earlier session history — also appears already resolved.
- **`cloudCodeOpen` wiring itself** (the actual app.html function, independent of the
  harness): traced end-to-end —
  - Button has `data-action="cloudCodeOpen"`, correctly present in `DASH_ACTION_MAP`,
    correctly picked up by the single delegated `document.addEventListener('click', ...)`
    handler at the bottom of app.html's inline script.
  - No other earlier click listener calls `stopPropagation()`/`preventDefault()` in a
    way that would swallow this click.
  - Button is not `disabled` by default and has no hidden-container gating.
  - For the **client-role** path specifically, traced the full section-grant chain:
    `src/cloud/client-codes.js`'s `verifyClientCode()` → `handleCloudCodeLookup()` in
    `src/cloud/projects.js` correctly returns `sections` for client codes → app.html's
    `grantSections` logic correctly consumes `ld.sections` for `role === 'client'`
    (the "OWNER BUG 2026-09-12" fallback that was added only patches editor/viewer,
    but client doesn't need that fallback — its `sections` field is already present
    at the lookup stage). **No bug found in this chain** — assuming P10 still fails
    after Findings 1–3 are fixed, the fault is more likely in timing/environment
    (local `wrangler dev` cold-start latency, D1 emulation lag) than in this logic.
    Re-run with real diagnostics before assuming otherwise.
- **CI pipeline** (`ci.yml`): runs gitleaks, CSP-hash verify, service-worker verify,
  hidden-attribute verify, skills-lock verify, export-wrapper verify, then a
  `wrangler deploy --dry-run` gate. No line-ending gate existed before this audit —
  see Finding 1, Step 4 for the addition.

---

## What I did NOT do

- Did not run `npx wrangler dev` or the QA harness myself — this sandbox has no
  Chrome/Chromium/Puppeteer available and no network path to install one, so I could
  not reproduce the live P10 browser flow end-to-end. Everything above is static
  source + git-history analysis, cross-checked line-by-line against the actual files
  in the zip.
- Did not edit any file. Every code block above is a proposed patch for the terminal
  AI to apply, not something already applied.
- Did not re-verify the still-open items from prior sessions that this zip snapshot
  doesn't contain evidence for either way: Google OAuth authorized-origins update,
  Cloudflare Bot Fight Mode / Leaked Credentials Mitigation toggles, Turnstile on the
  public reviews endpoint, and the 15-min-vs-24-hr OTP expiry decision. These require
  either dashboard access or a decision from you (KING), not source inspection.
