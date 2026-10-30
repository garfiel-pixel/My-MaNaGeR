# Directive v1: repo trim, reliability evidence, market proof

**Version:** v1, 2026-10-30. Source: the owner's review note pasted this session
("trim the repo, but treat it as housekeeping, not as what makes the product
great"). **Audience:** the terminal AI. Everything below is an instruction.
**Status:** VERIFIED against the code and the tree before being written. The
review's numbers and three of its recommendations were corrected; see section 2.
Do not re-litigate what section 2 already settles.

---

## 1. Verified ground truth (measured 2026-10-30, HEAD `b077a0f`)

| Claim in the review | Measured | Verdict |
|---|---|---|
| 701 tracked files | **706** (`git ls-files \| wc -l`) | close, count changed with this session's 3 new harnesses |
| 36 loose `.md`/`.txt` at the root | **40** (`ls *.md *.txt`, including `robots.txt`, which must stay) | 39 documents + `robots.txt` |
| 48 screenshots in `tools/` | **48** exactly (`git ls-files tools` image extensions) | confirmed |
| `_archive/` about 11.8 MB | **12 MB, 67 tracked files** (`du -sh`, `git ls-files`) | confirmed |
| `vendor/` about 15.6 MB, Whisper needed | **16 MB, 14 tracked files** | confirmed |
| `mmgr.css` is one file | **484,347 bytes, 20,016 lines**; `calculator-page.js` alone is **562,161 bytes** | confirmed, worse than implied |
| No load test | no `k6`, no load-test harness, nothing in `git ls-files` matching k6/load-test/uptime/status-page/incident | confirmed |
| No tenant isolation harness | `tools/qa-team-rbac.cjs` and `tools/qa-team-enterprise.cjs` exist, `test/private-paths.test.mjs` exists, but nothing tries tenant A against tenant B's rows on every endpoint | confirmed gap |
| No error tracking / uptime / status page | "sentry" appears only in old docs and `mcp/README.md`, never in `js/`, `worker.js` or `package.json` | confirmed |
| No backup restore drill | `qa-restore-verify.cjs` and `qa-drive-smoke.cjs` cover local/Drive restore, not a D1 backup restore with a written runbook and a measured time | confirmed gap |
| No file-size limits in CI | no size gate exists; `verify-doc-size.cjs` caps only `AGENTS.md`, `CLAUDE.md`, `CONTINUATION-DIRECTIVE.md` | confirmed |
| No type checking | no `tsconfig*.json`, no `checkJs`, no `tsc` in `package.json` | confirmed |
| Rate book is JIC-derived and sold | `pricing.html` already sells it as the **"My MaNaGeR Rate Book" (811 planning rates)**; but `calculator.html` still labels the picker and popup **"JIC"** and `js/calc-ai.js` names the JIC book in comments and UI strings | **half true, and the half that is true is the risk** |

---

## 2. Corrections to the review (settled, do not redo)

1. **`_archive/` is referenced, so it cannot simply be untracked-blind.** It is
   a denied path in `worker.js:284` (`'/_archive/'`), and it is in the exclude
   lists of `tools/deploy.cjs:69`, `tools/verify-icons.cjs:75` and
   `tools/verify-links.cjs:58`. That is a reason to KEEP the deny rule and the
   exclude lists (they cost nothing when the folder is gone), not a reason to
   keep 12 MB in git. Task E3 says exactly how to remove it safely.
2. **Some `tools/*.png` screenshots ARE referenced** by audit documents (for
   example `dash-review-admin-panel.png` and `dash-review-admin-rail.png` each
   appear in one doc), so the removal is a per-file decision, not a folder
   sweep. Task E4.
3. **The rate book is already rebranded where it is sold**, not where it is
   used. `pricing.html` says "My MaNaGeR Rate Book". What remains is the
   provenance question the owner already opened
   (`DIRECTIVE-ASSISTANT-JIC-RATES-ACCESS.md`), plus the visible "JIC" strings
   in the calculator. Task G1, and it is an owner decision, not a code task.
4. **The parked folder is not in `.gitignore` today**, and it must never be
   staged (EXECUTION-PLAN section 0). Task E0 fixes the first half only.

---

## 3. Phase E: repo housekeeping (build work, low risk, one sprint)

Housekeeping is not the product. It makes the repo navigable for the person and
the terminal AI, and it removes 12 MB of dead weight from every clone. It ships
before the next feature plan because a smaller tree makes every later diff
easier to read. It does not touch a served file except where a string moves.

**E0. Parked material out of sight (no content change).**
Add to `.gitignore`: the folder `the last update towrads maintainance mode/`
and `AUTHORS-FIX-ISSUE.md`. Neither is tracked; both are owner files; both are
already on the never-stage list. Gate: `git status` no longer shows them.

**E1. Finished planning documents into `docs/history/`.**
Move, do not delete. A root document qualifies only when all three hold:
(a) it is finished (its own Definition of Done is ticked or its wave is
recorded CLOSED), (b) no tracked file references its name outside `docs/history/`,
(c) it is not one of the live index files (`AGENTS.md`, `CLAUDE.md`,
`CONTINUATION-DIRECTIVE.md`, `EXECUTION-PLAN.md`, `CONTRIBUTING.md`,
`SECURITY.md`, `reflection.txt`, `robots.txt`). Move with `git mv` so history
follows. Update any reference found in (b) rather than leaving it dangling.
Gate: `npm run verify` green, `node tools/verify-doc-size.cjs` green, and the
moved list printed in the commit body.

**E2. One index for the tree.** `docs/history/README.md` lists what moved and
when, one line each, so a person can still find a plan by name. No prose.

**E3. `_archive/` untracked, with its guards kept.**
1. `grep -rn "_archive" worker.js tools/*.cjs .assetsignore wrangler.jsonc`
   and keep every hit (they are denies and excludes; they stay correct when the
   folder is absent).
2. `git rm -r --cached _archive` (history keeps every byte; no rewrite).
3. Add `/_archive/` to `.gitignore`.
4. Gate: `npm run verify`, `node tools/verify-icons.cjs`,
   `node tools/verify-links.cjs`, `node tools/qa-icons.cjs`, plus
   `npx wrangler deploy --dry-run` all green with the folder absent from disk.
   If any gate reads the folder as a source, that gate is re-baselined to skip
   a missing directory, not the other way round.

**E4. `tools/*.png` audit shots untracked.** For each of the 48 files: find
references (`grep -rn "<basename>" --include=*.cjs --include=*.js --include=*.md`).
Referenced files move to `docs/history/shots/` and the referencing doc's path is
updated in the same commit. Unreferenced files are `git rm --cached` and added
to `.gitignore`. Gate: the two `qa-calc` screenshot writers still work (they
write to `tmp/`, not `tools/`), `npm run verify` green.

**E5. Size limits in CI, so nothing grows back.**
New `tools/verify-sizes.cjs` (three edits: file, registry row, `static` job
step). Caps, chosen from today's measured sizes plus about 5 to 10 percent
headroom, not invented: `css/mmgr.css` 500 KB, `css/marketing.css` 156 KB,
`js/calculator-page.js` 586 KB, `project.html` 205 KB, `calculator.html`
78 KB, `app.html` 137 KB, `index.html` 49 KB, and 300 KB for any other `js/`,
`css/` or `src/` file. It skips `dist`, `_archive`, `vendor`, `tmp` and the two
parked spec folders, prints the three largest files every run, and fails naming
the file, its size and its cap. A cap is raised only in the commit that needs
it, with the reason in the body.

**E6. CSS split. Rule it in or out with a measurement, do not start blind.**
Run Playwright's CSS coverage over `project.html`, `calculator.html` and
`app.html` first, then decide. If coverage shows more than 15 percent dead
rules, delete those in their own commit before splitting. The split itself is
by area (`tokens`, `shell`, `calculator`, `ai`, `print`) into `css/src/*.css`
bundled by `build.js`; `verify-css-integrity.cjs` must still prove every source
rule survives into `dist`. Out of scope until E6.1 (the coverage number) is
recorded.

**E7. Type checking, core first.** `tsconfig.json` with `checkJs` on
`allowJs`, applied to three modules only to start: `js/mmgr-state.js`,
`js/mmgr-cloud.js`, billing helpers under `src/`. JSDoc on exported functions.
A new `npm run typecheck`, wired into `static`. No `any` casts to silence it: a
suppression needs a one-line reason. This is a gate addition, not a rewrite.

**E. Gates.** `npm run verify` green after each task, one commit per task,
`chore(repo): ...`, explicit paths, and the full `static` job green in the
remote run before the next task starts.

---

## 4. Phase F: reliability evidence (what the review calls gap 1)

The product's honest claim today is "offline-first, and cloud sync is opt-in".
It does not claim uptime. This phase produces the evidence to make a claim, or
records that we cannot yet.

**F1. Cross-tenant isolation harness (the highest-value item).**
New `tools/qa-tenant-isolation.cjs` (three edits; `cloud-auth` job), built on
`qa-team-rbac.cjs`'s boot seam: tenant A owns a project with a share code and a
project API key; tenant B, tenant C (editor) and an anonymous client each try
to read and write every cloud endpoint that takes a project id or a key. Every
attempt is asserted on the RESPONSE and on the stored row, not on intent.
Endpoints in scope: `/api/cloud/*` load, save, meta, photos, codes, logs,
reviews; `/api/keys/*`; the MCP server route. Gate: all refusals generic (no
existence leak), no write lands, no read returns A's bytes.

**F2. Load test against a staging Worker and D1.**
Scripted, reproducible, in `load/` (k6 JS or a Playwright-free Node driver,
whichever needs no new service). Scenarios: 50 concurrent project saves on one
tenant, 50 across 50 tenants, repeated sync pulls, and the MCP route. D1
serialises writes, so the numbers to publish are p50/p95/p99 per scenario and
the write queue depth, not a headline. Output: `docs/PERF-LOAD-2026-11.md`
with the raw result files committed under `load/results/`. This runs against a
staging Worker only, never production.

**F3. Uptime and errors.** One uptime check on `/api/health` (external service,
owner picks it), error tracking in `worker.js` behind a queue or a beacon with
the same privacy rules as the log scrubber (no keys, no project data), and a
public status page. The repo records the choice and the privacy analysis; the
accounts are owner actions. Sentry is the default suggestion but the owner
approves the vendor before any script is embedded, because the CSP whitelists
exactly one origin per provider.

**F4. Backup restore drill.** One real restore of a D1 database from the
provider's backup into a scratch database, timed and written up as
`docs/RESTORE-DRILL-2026-11.md`: who, when, from which backup, how long, what
verified (row counts per table, one R2 object, one project load end to end).
Repeat quarterly. This is an owner-run drill with the agent writing the runbook
from the first run.

**F5. Targets and incident log.** `docs/RELIABILITY-TARGETS.md`: 99.9 percent
availability on `/api/health` and p95 API under 300 ms, with the measurement
method named for each. `docs/INCIDENTS.md` starts empty except for the template
and the two known past incidents that already have entries in the log. No
number is published on a marketing page until F2 and F4 have real results.

---

## 5. Phase G: market proof (owner, not build work)

The agent does not sign customers. These are recorded so they are not lost, and
the code items they imply are queued where they belong.

**G1. Rate book provenance (owner decision, then code).** Either obtain written
permission for the JIC data, or replace it with rates built from the owner's own
site data and rebrand fully. Until permission exists, do not put JIC anywhere a
customer pays for. Code side when the decision lands: remove the remaining
"JIC" strings from `calculator.html` (picker label, popup title) and
`js/calc-ai.js`, or keep them with the permission recorded in
`docs/RATEBOOK-PROVENANCE.md`. `pricing.html`'s "My MaNaGeR Rate Book" already
reads as ours; the calculator is the last place that contradicts it.

**G2. Pilot programme.** 5 to 10 Jamaican/Caribbean contractors, free or
discounted in exchange for feedback, turning into two or three case studies.
Owner-run. The code asks that come out of it go into the queue as their own
items, never bolted onto C1 to C5.

**G3. Activation and support telemetry.** First-project-created, week-4
retention, support tickets per customer, and an in-app feedback button. The
feedback button is a small build item and takes the existing notice/mailbox
surface rather than a second widget. It is queued AFTER C1 (schema v25) so the
migration number is not shared with a feature plan.

---

## 6. Order and exit

1. **E0 to E5 now** (housekeeping, one sprint, one commit each). E6 and E7 only
   after C1, and E6 only with its coverage number recorded first.
2. **C1 to C5** as `EXECUTION-PLAN.md` already orders them.
3. **F1** immediately after C2 (the auth surface stops moving by then), **F2,
   F4, F5** as the owner's staging and backup access allows, **F3** after the
   owner picks vendors.
4. **G** runs in parallel on the owner's side; G1's code half is unblocked the
   day the permission decision is written down.

**What this directive does not claim.** Trimming the repo does not make the
product better for a customer. It makes it cheaper to work in. The customer-
facing case is F1 to F5 plus G, and none of those numbers may be quoted until
they exist.

## 7. Second review pass: checked line by line (2026-10-30, after E0 and E5)

The owner pasted a second review of the same three gaps this session. It was
re-checked against the tree at `607961c`, not accepted on its word. Verdict:
**every gap it names is real**, two of its numbers had moved, and one
recommendation it makes is already half-shipped in a place it did not look.

| Its claim | Checked now | Where it is handled |
|---|---|---|
| 701 tracked files | **597** after E0 (was 706 at the review's baseline) | E0 done |
| 36 loose `.md`/`.txt` at the root | **40**, of which 39 are documents and `robots.txt` must stay | E1, E2 |
| 48 screenshots in `tools/` | **48**; 42 untracked, 6 kept because history docs cite them by name | E4 done |
| `_archive/` about 11.8 MB | **12,220,014 bytes, 67 files** | E3 done |
| `vendor/` 15.6 MB, Whisper needed | **16,337,933 bytes, 14 files**, Whisper among them | nothing to do; confirmed |
| Load test with k6 against staging Worker + D1, measure write-heavy | no load harness exists; D1 serialises writes, so the published numbers are per-scenario p50/p95/p99 | **F2** (k6 or a Node driver, either is allowed) |
| Tenant isolation harness in CI, A against B on every endpoint | `qa-team-rbac.cjs` and `qa-team-enterprise.cjs` exist; neither tries cross-tenant reads and writes on every cloud route | **F1** |
| Uptime monitor, error tracking (Sentry named), public status page | no `sentry`, no uptime, no status page in `js/`, `worker.js` or `package.json`; `/api/health` exists at `src/router.js:968` and is the right probe target | **F3** (owner picks vendors; CSP is one origin per provider) |
| Backup restore drill, written steps, measured time | `qa-restore-verify.cjs` restores local and Drive state, never a D1 backup | **F4** |
| Targets (99.9%, p95 under 300 ms) and an incident log | neither file exists | **F5** |
| Split `mmgr.css` by area, bundle in `build.js`, use a coverage tool first | 484 KB / 20,016 lines in one file; `build.js` already bundles `dist`, so the seam exists | **E6**, coverage number recorded before any move |
| File-size limits in CI | shipped this session: `tools/verify-sizes.cjs` 9/9, in `npm run verify` and the `static` job | **E5 done** |
| JSDoc plus `tsc --checkJs` on state, sync, billing first | no `tsconfig`, no `checkJs`, no `typescript` dependency | **E7** |
| One source of truth; finished plans into `docs/history/` | `CONTINUATION-DIRECTIVE.md` and `AGENTS.md` are the live index; the finished plans are still at the root | **E1, E2** |
| Rate book: written JIC permission, or own data rebranded; do not charge without it | `pricing.html` sells it as "My MaNaGeR Rate Book"; **7** "JIC" strings remain in `calculator.html` and **5** in `js/calc-ai.js`; no permission record anywhere in the repo | **G1**, and it is an owner decision before it is a code task |
| Pilots, positioning, activation and support metrics | none recorded | **G2, G3**, plus G4 below |

**Corrections this pass adds.**

1. **Positioning is not yet backed by the copy.** The review says the edge is
   offline-first use, JMD and local rates. Offline-first is on the landing page
   ("Offline-first" appears four times on `index.html`); **JMD, J$, and Jamaica
   appear zero times on `index.html`, `pricing.html` and `features.html`**
   (`grep -oi "JMD\|J$\|Jamaica"`). The rate book is sold without saying it is
   a Jamaican rate book. That is a copy gap, not a code gap, and it is the
   cheapest part of the market argument. New task **G4** below.
2. **`_archive/` can go but its guards stay.** `worker.js:284` denies
   `/_archive/`, and `tools/deploy.cjs`, `tools/verify-icons.cjs` and
   `tools/verify-links.cjs` exclude it. Untracking the folder keeps all four
   correct; deleting the guards would remove a defence that costs nothing.
3. **E4 deviation, recorded.** The directive said referenced shots move to
   `docs/history/shots/`. They did not move: the citing documents are dated
   history entries, and rewriting a history log to fix a path is a worse edit
   than keeping six files tracked. They stay in `tools/` and stay tracked; the
   other 42 are untracked and ignored.
4. **What the trim did not change.** Tracked files fell from 706 to 597 and the
   asset bundle lost `_archive` (42 of the 48 screenshots were never uploaded -
   `tools` is already excluded from assets). No served byte changed, so no
   customer-visible claim changed. The review's own closing line stands: the
   customer case is F1 to F5 plus G.

**G4 (new, small).** Say where the rates come from and who they are for, in the
copy that already exists: name the currency and the market on `index.html` and
`pricing.html`, and let G1 decide whether the wording says "JIC" or the owner's
own book. No new page, no new claim, and no number that F2 or F4 has not
produced. Blocked by G1's decision, because the sentence differs depending on it.
