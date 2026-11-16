# MCP FINAL DIRECTIVE — My MaNaGeR (single authoritative file)

Audience: the terminal AI that writes and runs all code. This is the ONE
authoritative directive. It supersedes `MCP-AGENT-FIRST-DIRECTIVE.md`, the A1–A6
addendum, and the standalone "propose → accept → apply → reload" review
directive. Everything below is merged into one implementation-first sequence.

Basis: strict review of `review-export_1.zip` (the tree after the first pass),
its `REVIEW-ARTIFACTS/MCP-DIRECTIVE-LOG.md`, and the owner's second MCP test
report (proposal #68). In the review sandbox, `tools/qa-mcp-agent-first.cjs`
ran 140/140 and the five new `test/mcp-*.test.mjs` + `apply-ops` files ran
52/52, matching the log.

Line numbers are not given on purpose. Locate everything by symbol name.

---

## 0. Execution rules (binding, no interpretation)

1. Work in order: F0, F1, F2, F3, F4, then F5 only if allowed. Every step ends
   with a GATE. When its gate passes, start the next step at once. Never ask for
   confirmation between verified steps.
2. Stop and report only if: (a) a gate fails twice after fixes; (b) a step needs
   a file outside its stated scope; (c) a migration would alter or drop existing
   data; (d) a previously green check turns red and the cause is unknown; (e) an
   owner-only decision from section 7 is reached.
3. **Implementation first, then its verifying test, in the same commit.** Write
   the implementation, then write the test that would have caught the defect,
   run it to confirm it now passes on the fixed tree, and prove (by reverting in
   a scratch copy or by construction) that it would fail on the pre-fix tree.
   A test that asserts a defect as correct behavior is itself a defect: when a
   fix lands, rewrite that test to assert the fixed behavior in the same commit.
   Never let a test be authored before the code it verifies exists.
4. If code differs from this file's description, trust the code, record it under
   "Deviations" in `docs/MCP-DIRECTIVE-LOG.md`, and continue.
5. Never weaken an existing guard: scope enforcement (queue time and merge
   time), `PROTO_KEYS`, no budget-line deletes, budget money validation, the
   budget stale refusal (H-6), owner-only decisions (plus the budget-approver
   rule), the premium gate (`MCP_PREMIUM_REFUSAL`), the atomic accept claim, the
   conditional R2 writes.
6. Repo conventions: function declarations, dated comment tags
   `MCP-FINAL 2026-11-13 <step id>`, Prettier and ESLint gates (including
   `mmgr/no-unsanitized-html`). Migrations additive only, numbered from `0041_`.
7. Standard gate battery (run at the end of each phase): `npm test`;
   `node tools/verify-eslint.cjs`; `node tools/verify-prettier.cjs`;
   `node tools/verify-test-registry.cjs`; `node tools/verify-sw-cache.cjs`; the
   full `npm run verify`; and `tools/qa-mcp-agent-first.cjs`,
   `tools/qa-mcp-write-path.cjs`, `tools/qa-mcp-budget.cjs`,
   `tools/qa-mcp-parity.cjs`, `tools/qa-appwide-mcp.cjs`, `tools/qa-api-keys.cjs`,
   `tools/qa-approval.cjs`, `tools/qa-changelog-diffs.cjs`,
   `tools/qa-cloud-phase1.cjs`, `tools/qa-cloud-phase2.cjs`,
   `tools/qa-engine-parity.cjs`, `tools/qa-mcp-live-e2e.cjs`, `mcp/qa-mcp.cjs`.
   No gate may be worse than the F0 result.
8. Gate hygiene: a size cap or threshold may be changed only to a value you
   MEASURED, with the measured number written in the comment and the log. Never
   raise a cap to make a gate pass without a measurement.
9. `docs/MCP-DIRECTIVE-LOG.md` is the only progress record. One line per step:
   id, files, gate evidence. A step is marked PASS only after its gate output
   was seen in the current session. At the start of every session: read the log
   and git log, re-run the gate of the last PASS step, continue at the first
   step without PASS.
10. One commit per step. Back-out is `git revert`.
11. You are directing yourself: write all code yourself. Do not wait for patches
    or scripts from anyone.

---

## 1. Ledger (verified from the export; do NOT redo DONE items)

| Area | Status |
|---|---|
| Phase 1 (1.1–1.9): budget read and write gates, ops_json uncapped, real `before`, limit message, atomic accept and conditional R2 writes, idempotency, structured response, abuse limits | DONE (incl. F1.1 idempotency) |
| Phase 2: model, one validator (`planProposal`), error codes, cross-proposal deps, tool annotations, `tempId`, read fixes, `get_schema`, `validate_changes` | DONE |
| Phase 3: ops v2, change sets, withdraw, accept engine, change-set endpoints, D1/R2 recovery, owner UI grouping, report tools, deletes, report retention | DONE (incl. 3.5 via F1.2/F1.3) |
| Phase 4: attribution, `get_changes_since` | DONE |
| Phase 5: AT02–AT12, AT15, AT19, AT21–AT27 present; harness wired at `ci.yml` step `qa-mcp-agent-first` | DONE — AT01, AT13 (named), AT14a–e (end to end), AT16, AT17, AT18, AT20 added by F3 |
| Phase 6: auto-accept | SHIPPED via PR #11 (opt-in low-risk auto-accept, OFF by default); directive F5 workstream not started — no `PHASE6-GO` token |
| Tier-aware limits | DONE (F2) |

**Status refreshed 2026-11-16** after PR #12 merged (`5b561ba`) and deployed live
(Worker `21b35fe3`, MCP server 2.1.0). F0 baseline + green gates, F1.1–F1.7
correctness, F2 tier-aware limits, F3 acceptance tests (incl. AT14e), and F4
agent-facing release notes are all DONE and gated green. The authoritative
running record is `docs/MCP-DIRECTIVE-LOG.md` ("Directive close-out" section).

Defects found in review, each closed by a step below:
- D1 Idempotency dedupes against rejected and withdrawn proposals, and nothing clears `import_key` on decide (the lookup selects by `import_key` alone, in `findDuplicateProposal`).
- D2 Step 3.5 Step A (status stamps) was skipped with the reason "weather and work-week are browser-only", but stamps need neither. The test R12 asserts the missing stamps as expected behavior.
- D3 The recompute fallback nulls derived fields only on touched tasks. Float and criticality are global, so every other task keeps stale `critical`, `totalFloat`, `freeFloat`. It also nulls them for edits that cannot change the schedule (notes, descriptions).
- D4 The fallback writes a `derived` text property onto task records. Nothing in the browser ever clears it, so it persists forever and adds an unknown field to saved state.
- D5 MCP limits are single global constants (50 pending, 2000 daily ops, 10 keys, 10 large budget changes, 90-day retention) although the premium gate already depends on the owner's tier, and the five plans cost between about $8 and $200 a month.
- D6 The last logged battery run ended red at `verify-sw-cache`, and no log line shows it turned green.
- D7 `docs/CI-TEST-COVERAGE.md`, which the log says holds the harness row (tagged TRIAGE), is missing from the export. On the current branch it EXISTS — F0.2 verifies, does not create.
- D8 AT16 (XSS sweep) is deferred and "not yet authored".

---

## 2. Deviations: claims from the review/test report already FIXED in code
   (DO-NOT-RE-FIX; add one regression assertion each, then close)

These came from the "propose → accept → apply → reload" review directive and the
second MCP test report. Code is the source of truth (rule 4). Each was checked
against the live tree and found already implemented. Do not rewrite them; add a
small regression test that pins the current correct behavior, and record the
evidence pointer in `docs/MCP-DIRECTIVE-LOG.md` under "Deviations".

- **"done" status has no validation** — FALSE now. `TASK_STATUSES =
  ['todo','inprogress','blocked','completed']` in `src/mcp/model.js`, enforced
  case-insensitively in `src/mcp/plan.js` `validateValue` (reason
  "not one of: todo, inprogress, blocked, completed"), wired to task `.status`,
  and post-checked in `src/cloud/apply-ops.js`. `"done"` is a *module* status
  (`MODULE_STATUSES` in `js/mmgr-cycles.js`), never a task status. No code path
  writes `"done"` onto a task. Regression: assert a task-status `"done"` op is
  refused listing `completed`.
- **"MCP cannot delete records / no delete path"** — FALSE now. `deletes`
  schema in `src/mcp/server.js`, validation in `src/mcp/plan.js`, applier in
  `src/cloud/apply-ops.js`. Regression: assert an unreferenced task deletes.
- **"phase-delete guard keys on empty parentName"** — the guard does key on
  `parentName` (`src/cloud/apply-ops.js`, `rec.isPhase` and
  `arr.some(r => !r.isPhase && r.parentName === rec.name)`) and it DOES refuse a
  populated phase. Regression: assert deleting a phase with children is refused.
- **"large-change counter stayed 0 with 12 edits against limit 10"** — expected.
  The counter is budget-money-only (`BUDGET_LARGE_PER_DAY` in `src/lib/budget.js`,
  `c.large` set only on money changes in `src/mcp/plan.js`), keyed per API key per
  project per UTC day. 12 *task/status* edits do not consume it. Document this in
  the log; the F2 tier table keeps the rule but makes the limit tier-aware.
  Regression: assert 12 task edits leave `used:0`, and 11 money changes over the
  limit are refused.
- **"before not checked" should be a refusal** — currently a warning
  (`src/mcp/plan.js`, `warnings.push(... + ': before not checked')`); only a
  mismatched supplied `before` is a `STALE_BEFORE` refusal. Whether a missing
  `before` becomes a refusal is recorded as an owner decision (section 7), not
  changed here. Regression: pin that a mismatched `before` still refuses.

---

## 3. Target flow (the behaviour every step below must produce)

```
MCP apply_changes
  -> validate against the CURRENT revision (reject stale "before")
  -> queue proposal (pending), return proposalId + baseRevision

Owner accepts in app
  -> server applies the proposal to the latest state (CAS on baseUpdatedAt/ETag)
  -> server recomputes derived fields (float, critical, % complete)
  -> server writes new state, bumps revision, writes changelog
  -> returns { revision, applied[], blocked[], refused[] }

App after accept
  -> fetch /load (full state replace, NOT a partial merge)
  -> replace in-memory state, re-render every open view
  -> show per-change result: "11 of 11 applied, revision 42"
  -> if applied < proposed, show each refusal with its reason

MCP get_proposal_status(proposalId)
  -> returns accepted | rejected | pending, applied count, and the revision it landed in
```

Flow rules:
- **Revisions.** Every saved state carries a monotonically increasing
  `revision`. A save sends the revision it was based on. If the server is ahead,
  the save is refused (409) and the app reloads before retrying. This prevents a
  stale tab overwriting an accept and prevents a report-recompute from silently
  touching unrelated records.
- **No wholesale overwrite.** App saves send changed records only, or the server
  merges per record by `updatedAt`. Deleting a record requires an explicit delete
  intent, never an absence in a full snapshot. (Interim: `replayServerChanges`
  in `src/cloud/projects.js` rebases accepted leaves; F1.4 hardens it.)
- **Derived fields are recomputed server-side** on every accepted write, not left
  blank, and not persisted as an ad-hoc `derived` string.
- **Accept is visible.** The app must not report "accepted" until it has
  re-loaded and the new revision is on screen.
- **Create seeds a snapshot.** Both REST and MCP create paths write a valid
  default state at create time, so a freshly created project is openable.

---

## 4. F0 — Green baseline

**F0.1** Run the full battery (rule 7) on the current tree. If `verify-sw-cache`
is red, bump the `CACHE` version string in `sw.js` per repo convention (do not
edit the changed asset). Record every command's result under "F0 baseline".
GATE: every command in the log with a result, and `verify-sw-cache` green.

**F0.2** Locate `docs/CI-TEST-COVERAGE.md` (or wherever `verify-test-registry`
reads it). If it truly does not exist in the repo, the registry gate cannot be
passing: record that under Deviations and create it in the format the gate
expects. Flip the `qa-mcp-agent-first` row from TRIAGE to CI and add rows for
every new harness and test file this directive creates.
GATE: `verify-test-registry` green with the CI row.

**F0.3** Find every R-test in `tools/qa-mcp-agent-first.cjs` whose assertion
encodes a defect as expected (at least R12 and R13a; check every title containing
"does not", "leaves", "loses", "without", "unset", "null"). List them in the log.
They are fixed in F1.2 and by the Phase 4 work already done; rewrite R13a now to
assert the fixed behavior (diffs stored through `diffs_key`, proposal id and
source columns set).
GATE: the log lists each defect-asserting test with the step that rewrites it;
R13a rewritten and green.

---

## 5. F1 — Correctness fixes (implementation, then its gate)

**F1.1 Idempotency (D1).** Implement first:
- `findDuplicateProposal` returns only rows whose status is `pending`,
  `accepting` or `accepted`.
- Every path that decides a proposal as rejected or withdrawn sets
  `import_key = NULL` in the same UPDATE: single reject, change-set reject,
  whole withdraw, partial withdraw that leaves zero ops, and the stuck-`accepting`
  recovery path (leave `import_key` untouched there).
- Keep the 10-minute bucket logic and the optional `idempotencyKey` argument unchanged.
Then its gate (new tests): identical resubmit while pending returns
`duplicate: true` with the original id; identical resubmit after reject, after
withdraw and after change-set reject creates a fresh proposal; after accept it
still returns the original id.

**F1.2 Task status side effects (D2).** Implement first:
- Port `stampStatus` and the status-change branches of the task update
  (`js/mmgr-kanban.js`, `js/mmgr-tasks.js`) into a pure server module
  `src/domain/task-effects.js`: `statusSince`, `startedDate`, `completedDate`,
  `leadTime` cleared on a real status change, exactly as the client does. Dates
  are UTC `YYYY-MM-DD`; record the UTC-versus-local nuance in the log (the app
  re-stamps on the next real status move).
- Phase roll-up (`rollupPhases`) for phase rows whose children were touched: port
  only if it reads nothing browser-only; otherwise stamp the phase as
  derived-pending through the F1.3 mechanism and record why.
- The duration and start/end triad uses working days. Read where the client gets
  the work-week setting. If it lives in the saved state, port it and apply it.
  If it does not, do NOT compute end dates; leave `endDate` unchanged and add a
  warning with code `CONFLICT`-free reason text "end date not recomputed" in the
  apply report.
- Call it from the accept engine for every touched task, before the F1.3 marking.
Then its gate: extend `tools/qa-engine-parity.cjs` (or add
`tools/qa-task-effects-parity.cjs`) to run the browser functions and the port over
at least 12 status-transition fixtures (todo to inprogress, to blocked, to
completed, back to todo, completed to inprogress, a lead-time task, a task with
existing stamps) and require zero differences; rewrite R12 to assert the stamps
ARE set; `apply-ops.test.mjs` extended with stamp cases.

**F1.3 Staleness scope (D3, D4) + reload-after-accept.** Implement first:
- In `src/mcp/model.js` mark the schedule-input fields by reading what
  `js/mmgr-schedule.js` actually reads (at minimum: `startDate`, `endDate`,
  `duration`, `predecessors`, `status`, `isPhase`, `milestone`, `parentName`, plus
  any field the engine reads such as lead-time or weather flags). Flag them
  `scheduleInput: true` and add a test that fails when the engine reads a field
  not flagged.
- In the accept engine: if ANY applied op creates or deletes a task, or writes a
  `scheduleInput` field, or the project deadline is set, null `critical`,
  `totalFloat`, `freeFloat`, `floatBaseline` on ALL tasks. Otherwise touch nothing.
- Stop writing the `derived` text property. Remove the `t.derived =
  'pending recompute (opens in the app)'` write in `src/cloud/apply-ops.js`. In
  every accept, delete a leftover string-valued `derived` property from any task
  that has one (cleanup of records written by the first pass).
- `get_tasks` reports `derived: "pending recompute (opens in the app)"` computed
  at read time when `critical` and `totalFloat` are both null on a non-phase
  task; never stored.
- **Fix the witnessed core failure.** In `js/cloud/review.js` the accept handlers
  (`cloudReviewAcceptAll`, single accept) currently call `C.cloudPullMerge()`
  only, which merges without a reload. Replace that with: fetch `/load` for the
  full state, replace in-memory state, re-render every open view, and show a
  per-change result line "N of N applied, revision X". If `applied < proposed`,
  list each refusal with its reason. Do not show "accepted" until the new revision
  is on screen.
- Verify with the browser harness that the next app load after an accept
  recomputes through `annotateSchedule` AND persists the recomputed values to the
  cloud. If it does not persist, add that persist step to the pull-merge path
  after accept, guarded so it writes only when values differ.
Then its gate: tests show a notes edit nulls nothing; a predecessor edit nulls
every task; a delete nulls every task; no stored task has a `derived` string after
an accept; browser harness shows recompute AND persist AND full reload AND the
per-change result line.

**F1.4 Revisions and whole-state save (D: stale overwrite / recompute side
effect).** Implement first:
- Add a monotonically increasing numeric `revision` to saved state alongside the
  existing `baseUpdatedAt` + R2 ETag CAS in `src/cloud/projects.js` save and
  `src/reviews.js` accept. A save sends the base revision; if the server is ahead,
  refuse 409 and make the app reload before retrying.
- Harden `replayServerChanges` in `src/cloud/projects.js` so an accept that lands
  mid-save is replayed and the whole-state write cannot erase server-accepted
  leaves, and so a save cannot recompute/touch records it did not change (the
  11:40pm side effect).
Then its gate: concurrency tests show an interleaved accept + save keeps both
changes; revision increments on every write; a save from a stale base gets 409.

**F1.5 Accept result shape.** Implement first:
- `src/reviews.js` accept returns `{ ok, revision, applied[], blocked[],
  refused[] }` (plus existing metadata). `applied` becomes the detailed list;
  keep a count for backward compatibility if a harness needs it.
- `src/mcp/server.js` `proposalStatusResult` (`get_proposal_status`) reports the
  applied count and the revision the proposal landed in, alongside the existing
  status/outcome/changeCount.
Then its gate: tests assert a numeric revision and the three arrays on accept and
on `get_proposal_status`.

**F1.6 Credential and calc-workspace hygiene.** Implement first:
- Remove `ownerCode: ins.ownerCode` from the `create_project` text output in
  `src/mcp/appwide.js`. Owner code is a full-access credential and must never be
  returned by MCP (report section 1).
- `src/cloud/calc-workspace.js` writes `calc-ws/<sub>.json` as plain JSON. Treat
  that path as untrusted storage: validate/escape on read and never return raw
  content through MCP. Encrypt at rest if calculator sync stays (owner decision,
  section 7).
Then its gate: a test asserts `create_project` output has no `ownerCode`, and a
malformed calc-ws payload is handled without injection.

**F1.7** Re-run the standard battery. GATE: battery not worse than F0; R11, R12
and the AT05/AT06 groups green.

---

## 6. F2 — Tier-aware limits

The MCP premium gate and every MCP limit follow the PROJECT OWNER's plan
(`ownerTier`), never the caller's. On the app-wide server use the account owner's
plan. Plans and prices (from `pricing.html`): Free $0; Contractor $18.99 per month
(first month free); Estimator $49.99 per 6 months (about $8.33 a month); Company
$49.99 per month; Enterprise $200 per month.

**F2.1 One table.** Create `src/mcp/tier-limits.js`: one frozen table and one
function `limitsFor(tier)`. Exact values:

| Tier | Active API keys | Pending proposals per key | Ops per key per UTC day | Max ops per call (all arrays together) | Large budget changes per day | Days decided proposals keep full detail (`ops_json`, report) |
|---|---|---|---|---|---|---|
| free | 2 | 0 (MCP refused by the gate) | 0 | 0 | 0 | 30 |
| estimator | 2 | 10 | 300 | 100 | 5 | 30 |
| contractor | 5 | 25 | 1000 | 250 | 10 | 60 |
| company | 10 | 50 | 3000 | 500 | 20 | 90 |
| enterprise | 25 | 100 | 10000 | 500 | 50 | 180 |

- An unrecognised paid tier uses the contractor row (the billing code treats an
  unknown paid tier as paid, never as free).
- The existing per-array caps (`MCP_MAX_DIFFS` 500, `MCP_MAX_CREATES` 500,
  `MCP_MAX_SETS` 100) stay as ceilings. The effective per-call cap is
  `min(array cap, maxOpsPerCall)`, and `maxOpsPerCall` also bounds the total across
  arrays.
- Enterprise "volume pricing on request" overrides are out of scope. Note in the
  log that the single table is where an override hook would go.

**F2.2 Wire it.** Replace every use of the global constants
(`MCP_MAX_PENDING_PER_KEY`, `MCP_MAX_DAILY_OPS_PER_KEY`, the budget large-change
daily constant in `src/lib/budget.js`, `CLOUD_MAX_API_KEYS` in `src/cloud/api-keys.js`,
the retention days in `src/mcp/report-store.js` and the scheduled prune in
`worker.js`) with the row for the owner's tier.
- Reuse the tier already fetched per request (`ownerTier` in the MCP handler and
  in `appwide.js`). Do not add a second tier query to any MCP call.
- API-key creation reads the owner's tier once. The retention prune runs one
  UPDATE per tier, selecting projects by the owner's subscription tier.
- The old constants stay exported only if a test or tool still imports them;
  otherwise delete them.

**F2.3 Messages and codes.** Over-limit refusals use the existing frozen codes
(`LIMIT_EXCEEDED`, `RATE_PENDING_CAP`, `RATE_DAILY_OPS`) and state: the tier name,
the limit, the current usage and the incoming count. For estimator, contractor
and company add exactly one sentence: "A higher plan raises this limit (see /pricing)." Enterprise gets no upsell sentence.

**F2.4 Schema.** `get_schema.limits` returns the effective limits for this owner's
tier plus the tier name.

**F2.5 Downgrade and lapse.** No deletion and no key revocation. After a
downgrade: creating a new key over the cap is refused; existing keys keep working;
new proposals are refused while the key is over its pending cap; existing pending
proposals stay decidable by the owner. On lapse to free: the premium gate refuses
calls as today; the owner can still decide pending proposals in the UI.

**F2.6 Pricing page truth.** In the `pricing.html` comparison table add two rows,
"Active API keys" and "Agent changes per day (per key)", filled from the table
above for every plan (Free shows "2 keys, MCP not included"). Add a check in an
existing pricing QA harness (or `tools/qa-mcp-agent-first.cjs`) that parses those
cells and fails if any number differs from `tier-limits.js`.

**F2.7 Tests (new section "AT28" in the harness).** For each of the five tiers and
each limit: at the cap passes, at cap + 1 refuses with the right tier name and
numbers; an unknown paid tier behaves as contractor; a tier change between two
calls applies the new caps to the second call; the daily ops counter does not
reset on a tier change; the free tier is refused by the gate before any limit is
read; per-call caps apply to the total across arrays; the same matrix passes on
the app-wide server; no MCP call performs more than one tier query (count D1
statements in the fake env).
GATE: AT28 green; `qa-api-keys` green with tier-aware key caps; pricing parity check green.

---

## 7. F3 — Remaining acceptance tests and CI

Add each as a named test in `tools/qa-mcp-agent-first.cjs` unless stated. Each
must run in `ci.yml` unless stated.

- **AT01** Two proposals on the same table accepted through the change-set Accept all: the result is the union (both fields present).
- **AT13** Rename the existing R07b test to carry the AT13 id (UI save racing an accept keeps both changes).
- **AT14** End to end through the accept endpoint: a task referenced by a budget line is refused (`NOT_DELETABLE` or the engine's conflict code), a phase with children is refused, an unreferenced task is deleted and survivors lose it from `predecessors`, budget lines cannot be deleted.
- **AT16** XSS sweep. Author it now. For every modelled list and every text field, send `"><img src=x onerror=window.__pwn=1>` through `apply_changes`, accept, load every view that renders that table, the review panel, the export paths and the print view in the existing headless-browser pattern, and assert `window.__pwn` is undefined and the markup appears escaped. Put it in `ci.yml` if it runs in 90 seconds or less; otherwise in `extended-qa.yml` and `nightly.yml`, and record the measured time.
- **AT17** `tools/list` parity between the per-project and app-wide servers: names, schemas, annotations, `outputSchema` presence, the untrusted-text sentence.
- **AT18** 50 generated inputs through `validate_changes` and `apply_changes` produce identical `refused` lists and codes.
- **AT20** Legacy rows: a truncated one (stored list length 500) is refused with the stated message; a normal legacy row accepts as before.
GATE: every AT above present by id in the harness output; `verify-test-registry` green; the harness step is in `ci.yml`.

**Manual test plan (owner's 8 report tests).** Run these against the deployed
build and record the result; they cover the accept-to-screen loop that no
automated test currently proves:
1. Create a project over MCP. Expect a snapshot and an openable project.
2. Propose one task status change. Accept in the app. Expect the app to reload and show the change without a manual refresh.
3. Propose 11 status changes. Expect 11 applied and a revision bump; no manual edits needed.
4. Open the app, edit one unrelated field, save. Confirm no other record changed.
5. Save from a stale tab with an old revision. Expect a 409 and a reload prompt, not an overwrite.
6. Propose a task with `"done"` status. Expect refusal listing `"completed"`.
7. Propose deletion of a phase with children. Expect refusal.
8. Propose 12 budget or task changes. Expect the large-change rule to be applied as documented.

---

## 8. F4 — Agent-facing release notes

Add `releaseNotes` to `get_schema`: a short fixed list of behavior changes since
the first MCP release, each one sentence: `completedTasks` and `completion` now
count work items only (no phases); `get_risks` returns both `description` and
`name`; `openRisks` now matches the register; derived schedule fields are
read-only and recomputed in the app; status stamps are set on accept; limits
depend on the owner's plan. Add `serverInfo.version` bump to the next minor.
GATE: `test/mcp-schema.test.mjs` asserts the notes exist; AT17 still green.

Final battery: the full standard battery, not worse than F0 anywhere.

---

## 9. F5 — Optional auto-accept (DO NOT START unless the owner's message
   contains the exact token `PHASE6-GO`)

If the token is absent, write "F5 skipped: no PHASE6-GO" in the log and finish.
If present:
- Migration `0041_` adds `auto_accept TEXT NOT NULL DEFAULT 'off'` to the API-keys table. Values: `off`, `low-risk`. Only the owner can set it (owner-gated route, key admin panel in `js/app/mcp-admin.js`, all strings escaped). Only the Company and Enterprise plans can set `low-risk`; other plans see it disabled with the reason.
- Allowlist for `low-risk` (nothing else ever auto-applies): `set` ops on `notes` for tasks, resources, meetings, documents, stakeholders and commsEntries, and `mitigation` and `notes` on risks.
- Never auto-apply: any budget op, any `status`, deletes, creates, `predecessors`, any date, section or scalar sets, any op with a conflict, or any proposal mixing allowed and disallowed ops (that queues entirely).
- Only if the proposal has at most 50 ops. It runs through the same accept engine and records approvedBy `{type:'policy', label:'auto-accept: low-risk'}` in the changelog; the review UI shows an "auto-applied" badge; revert works as usual.
GATE: tests: default off; Contractor and Estimator cannot enable it; allowlisted op applies on a Company key; any non-allowlisted op queues; mixed proposal queues entirely; budget never auto-applies; 51 ops queue; the call still passes the tier daily-ops limit.

Note: the advanced worktree `c75de36` already contains an F5 auto-accept
implementation (`e85fcb8`). Whether to adopt that work is an owner decision
(baseline choice), not a reason to start F5 here.

---

## 10. Owner-only decisions (NOT for the coding AI)

- Whether MCP should be able to delete at all. (Deletes exist in code today.)
- Whether the calculator is exposed to MCP and whether `calc-ws/*.json` is
  encrypted (the owner has said a simple upload is acceptable for now).
- Whether `"done"` is a valid task status alongside `"completed"`; the app and
  MCP must agree on one.
- Whether a missing `before` (not a mismatched one) is a refusal or a warning.
- Choice of the measured baseline branch (see F0 / baseline step).

---

## Definition of done

1. F0–F4 steps all marked PASS in the log with gate evidence from the current session; F5 either skipped with the token note or PASS.
2. R11, R12, R13 rewritten to the fixed behavior; AT01–AT28 present by id and green.
3. No gate worse than the F0 baseline; `npm run verify` green end to end.
4. Every limit in the code reads from `tier-limits.js`; `pricing.html` numbers match it.
5. The full reload-after-accept loop is proven in a browser: accept shows "N of N applied, revision X" on screen without a manual refresh, derived fields are populated, and a stale save gets 409.
6. Both MCP surfaces are tested and recorded: local wrangler harnesses and the deployed `https://mymanagerworkspace.com/api/mcp`.
7. Final report to the owner, plain text, at most 25 lines: what changed per phase, deviations, measured values for any changed cap, the AT16 placement, and the two-surface MCP test results.
