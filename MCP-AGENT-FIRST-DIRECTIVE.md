# MCP AGENT-FIRST DIRECTIVE — My MaNaGeR

Audience: the terminal AI that writes and runs all code. Date: 2026-11-12.
Goal: an agent drives the project through MCP and the owner's only action is one Accept click. Nothing is ever applied without that click, except under the Phase 6 policy, which ships OFF.

Sources merged here:
- (A) the live-test plan on `bank-renovation` (10 `apply_changes` calls, about 560 field changes, 9 proposals).
- (B) a static code review of the repo export (`src/mcp/server.js`, `src/mcp/appwide.js`, `src/reviews.js`, `src/cloud/proposal-diffs.js`, `src/lib/http.js`, `src/lib/budget.js`, `js/mmgr-*.js`).

Line numbers below come from the export. Re-locate every reference by symbol name, not by line number.

---

## 0. Execution rules (binding, no interpretation)

1. Work the phases in order, and the steps inside a phase in order. Every step ends with a GATE. When its gate passes, start the next step immediately. Do not ask for confirmation between verified steps.
2. Stop and report only for one of these: (a) a gate still fails after two fix attempts; (b) a step needs a file outside the stated scope; (c) a migration would alter or drop existing data; (d) a previously green check turns red and the cause is unknown.
3. Tests first. For every defect, write the failing test, watch it fail for the stated reason, then fix. Tests live in the repo and ship with the fix.
4. If the code differs from what this directive describes (symbol moved, behavior different), trust the code, record the difference in `docs/MCP-DIRECTIVE-LOG.md` under "Deviations", and continue with the closest faithful implementation of the intent.
5. Never weaken an existing guard. These must still hold after every phase:
   - scope enforcement at queue time and at merge time (`cloudScopeMerge`)
   - the proto-key guard (`PROTO_KEYS`)
   - budget lines cannot be deleted through MCP
   - budget money validation (`buildBudgetProposal`)
   - the budget stale refusal at accept (H-6)
   - owner-only decisions, except the existing budget-approver rule
   - nothing applies without an owner decision (until Phase 6, which is off by default)
6. Follow repo conventions: function declarations, dated comment tags, Prettier and ESLint gates. Tag every behavior change with a comment `MCP-AGENT-FIRST 2026-11-12 <step id>`.
7. Migrations are additive only: new numbered files starting at `0040_`, following how earlier migrations add columns. No data rewrites.
8. Standard gate battery, run at the end of every phase:
   `npm test`; `node tools/verify-eslint.cjs`; `node tools/verify-prettier.cjs`; `node tools/verify-test-registry.cjs`; `node tools/verify-sw-cache.cjs`; and these harnesses: `tools/qa-mcp-write-path.cjs`, `tools/qa-mcp-budget.cjs`, `tools/qa-mcp-parity.cjs`, `tools/qa-appwide-mcp.cjs`, `tools/qa-api-keys.cjs`, `tools/qa-approval.cjs`, `tools/qa-changelog-diffs.cjs`, `tools/qa-cloud-phase1.cjs`, `tools/qa-cloud-phase2.cjs`, `tools/qa-engine-parity.cjs`, `mcp/qa-mcp.cjs`.
   Phase 0 records the baseline. After that, no check may be worse than baseline.
9. Maintain `docs/MCP-DIRECTIVE-LOG.md`. One line per step: id, files changed, gate result. Add a "Deviations" section.
10. Reuse the fake D1/R2 environment pattern already used by `tools/qa-mcp-write-path.cjs`. Do not invent new test infrastructure.
11. Back-out is `git revert` of the phase commits. Migrations are additive, so no down-migration is needed. Commit once per step.

---

## 1. Rulings where plan (A) and the code review (B) disagree

| # | Topic | Ruling |
|---|---|---|
| 1 | Plan A: "accept replaces whole arrays" | The accept path already applies field patches on the live state with a `before` check (`handleReviewAccept`, `applyLeafDiffs`). It still has three real defects: the stored diffs are capped at 500 leaves (silent loss), a legacy fallback merges whole arrays, and accept is not atomic. Keep the patch design. Reproduce first (Step 0.2), then fix. |
| 2 | Plan A: status enum `todo / inprogress / complete` | WRONG. The true enum is `todo`, `inprogress`, `blocked`, `completed` (`COLUMNS` in `js/mmgr-kanban.js`). Use only these. |
| 3 | Plan A: "one draft per project" replacing proposals | Do not replace the queue. Proposals stay immutable and become op-lists. Add change sets (grouping) plus Accept-all for one atomic click. |
| 4 | Plan A: "derived fields accepted then silently recomputed" | True, and the cause is that recompute exists only in the browser (`annotateSchedule`, `markCritical`, `rollupPhases`). The server never recomputes. Derived fields become read-only to agents. |
| 5 | Plan A: `get_apply_report` is new | `get_proposal_status` already exists. Extend it and add `get_apply_report` as a thin reader of the same stored report. |
| 6 | Plan A: separate `delete_records` tool | No. Add a `deletes` array to `apply_changes` (one entry point). Budget lines stay undeletable. |
| 7 | Conflict rule | Per-patch conflict skip for non-budget ops. Budget stale keeps the existing whole-proposal refusal. See Step 3.4. |
| 8 | "Large budget change counter wrong" | The counter is not wrong. The message omits the incoming count, the count includes decided rows, and a single call with more than 10 large changes can never succeed. Fix the message and the counting rule (Step 1.5). |
| 9 | "Only 3 of 39 qa scripts in CI" | Wrong for this repo: 166 harnesses, 119 referenced by `ci.yml`. Add the new harnesses to `ci.yml` and `docs/CI-TEST-COVERAGE.md`. |
| 10 | Auto-accept | Last phase, per API key, default OFF, fixed allowlist (Phase 6). |

---

## PHASE 0 — Baseline and reproduction (read-only for source code)

**0.1 Baseline.** Run the full gate battery from rule 8 on the untouched tree. Save pass/fail per command into `docs/MCP-DIRECTIVE-LOG.md` under "Baseline".
GATE: log file exists and lists every command with a result.

**0.2 Reproduction tests.** Create `tools/qa-mcp-agent-first.cjs` (and pure-module tests under `test/` as `*.test.mjs` where the module is pure). Write one named test per defect below. Each must FAIL now, for the stated reason. Do not wire into CI yet.

| Test id | Must demonstrate |
|---|---|
| R01 | A proposal with 100 task creates (more than 500 leaves) accepts only about 25 of them; the queue response reports the capped count. |
| R02 | A row with no usable stored diffs accepts through the whole-array `submitted_json` merge and overwrites a field changed in the live state since. |
| R03 | `get_table` returns `budgetLines`, `spendLog` and `budgetEnvelope` to a key that has the Budget section but Read budget off. |
| R04 | A key with the Budget section but "Propose budget changes" off can queue diffs on `budgetLines`, `spendLog`, `budgetEnvelope`. |
| R05 | An agent-supplied diff `before` that does not match the live value is queued and later accepted without a stale flag. |
| R06 | A single call with 24 large budget changes returns "already queued 0 … allows 10". |
| R07 | Two concurrent accepts of the same proposal both pass the pending check. |
| R08 | `apply_changes` retried with identical arguments queues two pending rows. |
| R09 | A risk created through `creates` with `name` shows "(untitled)" in `get_risks` and is missing from `openRisks`. |
| R10 | A task diff with `status: "done"` is queued; `completedTasks` stays 0; the task is in no Kanban column. |
| R11 | A diff writing `critical: true` is queued and accepted; `get_tasks` still reports the stored value until the browser recomputes. |
| R12 | A task diff changing `status` to `completed` does not set `completedDate` or `statusSince`. |
| R13 | After an accept of 40 or more leaf changes the changelog entry has null `diffs_json` and no proposal id or agent label. |
| R14 | `get_changes_since` is absent from `tools/list`. |

GATE: every R-test fails, each for its stated reason. If a test passes unexpectedly, the defect is not reproduced: record it under "Deviations", mark that R-test "not reproduced", and skip the matching fix step only if every sub-claim of that step is also not reproduced.

---

## PHASE 1 — Safety fixes (small, independent, ship first)

**1.1 Budget read gate on `get_table`.** Pass `auth` into `executeGetTable`. For `budgetLines`, `spendLog` and `budgetEnvelope`, enforce `budgetReadAllowed(auth)` and return `BUDGET_READ_REFUSAL`. Apply the same on the app-wide server (it shares `executeTool`). Also remove those three tables from any other read path that bypasses the check.
GATE: R03 passes; `qa-appwide-mcp` and `qa-mcp-parity` green.

**1.2 Budget write gate on the generic path.** In the queue function (`queueMcpProposal`), for any diff, create or set whose path is `budgetLines`, `spendLog`, `budgetEnvelope` or `nspid`:
- If `budgetWriteAllowed(auth)` is false, refuse the whole call with `BUDGET_WRITE_REFUSAL` (the same behavior as the `budget` array).
- `creates` into `budgetLines` or `spendLog`: refuse the op with "use the budget array (addLine / addDelivery)". Delete the `budgetLines` and `spendLog` entries from `CREATE_DEFAULTS`.
- Diffs on `budgetLines` whose field is in `BUDGET_LINE_FIELDS`: convert internally into `changeLine` entries and run them through `buildBudgetProposal` (money validation and large-change flags apply). Any other budget-line field (including `id`, `actual`, `committed`) is refused as "not writable".
- Diffs on `spendLog`: refuse ("use addDelivery").
- Sets on `budgetEnvelope`: value must be a finite number ≥ 0; flag it large when the change is ≥ min(10% of the current envelope, 50000).
- `nspid`: refuse always (server-managed).
GATE: R04 passes; `qa-mcp-budget` green; a new permission-matrix test covers key × {section Budget on/off} × {read on/off} × {write on/off} × {diff, create, set, budget array}.

**1.3 Remove silent truncation.** Add migration `0040_mcp_agent_first.sql` with ALL of these additive columns (used by later phases):
- `cloud_reviews`: `ops_json TEXT`, `ops_count INTEGER`, `change_set_id TEXT`, `key_id TEXT`, `apply_report_json TEXT`, plus an index on `(project_id, change_set_id)`.
- `cloud_changelog`: `proposal_id INTEGER`, `source_type TEXT`, `source_label TEXT`, `key_id TEXT`, `change_set_id TEXT`, `diffs_key TEXT`.

At queue time store the FULL uncapped enriched leaf-diff list in `ops_json` (call `enrichDiffs` with no cap for this copy) and the true total in `ops_count`. `diffs_json` stays capped at 500 for display only. At accept, prefer `ops_json` over `diffs_json`. The queue response and `get_proposal_status` must use `ops_count`, never the capped length.
Legacy rows (no `ops_json`):
- If the stored diff list length equals 500, refuse the accept with 409 and the message "This older proposal was truncated when it was queued. Reject it and ask the agent to resubmit."
- Otherwise keep the existing behavior.
GATE: R01 and R02 pass; legacy-row test passes; `qa-approval`, `qa-changelog-diffs` green.

**1.4 Make the agent's `before` real.** In the diffs loop, when `before` is supplied and is not `valuesEqual` to the live value (`valuesEqual` from `proposal-diffs.js`), refuse that op with reason `stale before: expected <x>, live <y>`. When `before` is omitted, queue it and list the op under `warnings` as `before not checked`. Do the same for `sets` with an optional `before`.
GATE: R05 passes.

**1.5 Budget-limit message and counting.** Message format, exactly: `This call has N large budget change(s). This key has U large change(s) pending or accepted today (UTC). The limit is L per day and L per call. Split into calls of at most L large changes, or ask the owner to decide pending ones.` Count only rows with status `pending` or `accepted`. Do not change the thresholds.
GATE: R06 passes; message test asserts N, U and L appear.

**1.6 Atomic accept and conditional state writes.**
(a) Claim: in `handleReviewAccept`, replace read-then-write with `UPDATE cloud_reviews SET status='accepting' WHERE id=? AND status='pending'`. If zero rows changed, return 409 "already being decided". On any failure after the claim, set the status back to `pending`. Apply `AND status='pending'` to the reject UPDATE as well. Treat `accepting` as pending in list queries and in `get_proposal_status` (outcome `pending`). A row stuck in `accepting` for more than 60 seconds reverts to `pending` the next time it is read.
(b) State writes: find every writer of `projects/<id>/latest.json` (grep `latest.json` under `src/`). For each, read the R2 etag with the state and write with `onlyIf: { etagMatches }`. On precondition failure:
   - accept: re-read and re-apply, up to 3 attempts, then 409 `{code:'busy'}`;
   - the UI save path: re-run its existing merge once on fresh state; if it still fails, return 409 `{code:'busy'}`. Read how the browser handles a non-OK save response; if it does not retry, add one retry in the client save.
   Introduce one shared helper for this; do not copy the logic per writer.
GATE: R07 passes; new tests: UI-save-versus-accept race keeps both changes; `qa-cloud-phase1`, `qa-cloud-phase2`, `qa-sync` green.

**1.7 Idempotent `apply_changes`.** Set `cloud_reviews.import_key` (it already has a UNIQUE index) at insert:
- With an agent-supplied `idempotencyKey` (string, max 80): `mcp:<projectId>:<keyId>:<idempotencyKey>`.
- Otherwise: `mcp:<projectId>:<keyId>:<sha256 hex of canonical JSON of the whole arguments object>:<10-minute UTC bucket start>`. Before inserting, look up both the current and the previous bucket key.
On a hit, return the original proposal id with the same text plus `duplicate: true`. On a UNIQUE violation, do the same lookup and return it.
GATE: R08 passes; a resend after 25 minutes queues a new row.

**1.8 Structured response.** Keep the first text block's first sentence unchanged in format (`Queued N field change(s) for owner review (proposal #ID).`) because existing tests assert it; N is now the true op count. Add a second text block containing JSON: `{proposalId, changeSetId, duplicate, counts:{diffs,creates,sets,deletes,budget}, opsQueued, refused:[{section,index,path,recordId,field,reason}], warnings:[...], truncated:false}`. Every refused op must appear in `refused` with a reason.
GATE: updated existing harness assertions pass; new test asserts every refused input appears in `refused`.

**PHASE 1 GATE:** standard battery green, R01–R08 pass.

---

## PHASE 2 — One model contract

**2.1 `src/mcp/model.js` (new, single source of truth).** One table per list path (`tasks`, `resources`, `risks`, `issues`, `logEntries`, `meetings`, `stakeholders`, `documents`, `changes`, `commsEntries`) and the object and scalar sections. Each field records: type, max length, enum or null, required, read-only/derived flag, input alias, date flag. Derive it from the client, not from guesses:
- Field names and defaults from the UI creators: `addTask` in `js/mmgr-tasks.js`, `addRisk` and the issue creator in `js/mmgr-risks.js`, and the matching creators in the resources, stakeholders, decisions, meetings, documents, comms and change modules.
- Enums from the client's `<select>` options and constants. If a field has no enum in the client, record `enum: null` and accept any non-empty string up to its max length. Do not invent enums.
- Known enum: `tasks.status` = `todo`, `inprogress`, `blocked`, `completed`. Match case-insensitively on input; store the canonical lowercase value.
- Minimum derived or read-only set: every list's `id`; tasks `critical`, `totalFloat`, `freeFloat`, `floatBaseline`, `statusSince`, `startedDate`, `completedDate`, `boardPosition`, `weatherExposed`; tasks `startDate` and `endDate` when `isPhase` is true; budget lines `actual`. Extend the set with any field written by `markCritical`, `applyPlan`, `rollupPhases`, `stampStatus` or `checkWeatherExposure`.
- Canonical stored name for risk and issue text is `description` (the UI field). Input alias: `name` maps to `description`. Title-keyed lists keep `title`.
- Custom fields: allow only keys that `CustomFields.isCustomKey` accepts.
`CREATE_DEFAULTS` is deleted; defaults come from the model and must equal what the UI creator produces (compare field sets in a test).
GATE: `test/mcp-model.test.mjs` asserts each list's default field set equals the UI creator's field set (read from the client source via the harness) and that the status enum matches `COLUMNS`.

**2.2 Validation in one function.** Create `planProposal(args, liveState, auth, deps)`. It returns `{ops, refused, warnings}` and holds all validation. `queueMcpProposal` and `validate_changes` both call it, so they cannot drift. Validation rules:
- unknown field on a modelled list: refuse, listing the allowed fields
- type mismatch: refuse
- enum miss: refuse with the allowed list
- derived or read-only field: refuse with "derived field, recomputed by the app"
- strings longer than the field max (default 4000): refuse
- any date field: must be a real calendar date `YYYY-MM-DD`. The existing `parseISO` is lenient; use a strict round-trip check so `2026-02-30` is refused.
- numbers: finite
- `predecessors`: array of existing task ids (from the live state or from `tempId`, see 2.3); self-reference refused
- `id` is never writable
GATE: R09, R10 and R11 now fail to reproduce (agent gets refusals); fuzz test: 50 generated inputs produce identical `refused` lists from `validate_changes` and `apply_changes`.

**2.3 `tempId` for creates.** A create may carry `tempId` (string, max 40, unique within the call). `predecessors` on any create or diff in the same call may reference a `tempId`. The server maps `tempId` to the assigned id before storing ops. An unknown reference is refused.
GATE: test creates a 30-task chain with dependencies in one call and the stored ops carry real ids.

**2.4 Read tools fixed.**
- `get_risks`: emit `description` and `name` (same value); read with fallback `description || name`; same for issues. `openRisks` in `get_project_summary`: a risk is open when it has no `issueId` and its status, lower-cased, is empty or `open`. Use the same predicate in `get_risks` (add `isOpen`).
- `get_tasks`: keep the `dependencies` output name (parity harness asserts it) and also emit `predecessors`. Add `level`, `isPhase`, `parentName`, `milestone` (if the model has it), `duration`, `percent`, `totalFloat`, `freeFloat`, `startedDate`, `completedDate`, `statusSince`, `leadTime`, `confidence`. Add a `fields` argument (array) to choose columns.
- `get_project_summary`: add `projectDeadline`, `budgetEnvelope` (only when budget read is allowed), `statusCounts` `{todo, inprogress, blocked, completed, other}`, and a `warnings` list naming tasks whose status is outside the enum. `completedTasks` and `completion` use the Kanban work-item definition (`workItems` in `js/mmgr-kanban.js`: exclude phases and roll-up parents). Keep `totalTasks` as all rows and add `workItemCount`.
- `get_budget`: return the real line label (`name` if present else `category`), plus `category` and `id`. Read `lineActual` and `deliveryRollup` and emit an `actualBasis` string describing exactly what is counted. If future-dated spend is included in `actual`, return `actualToDate` and `committedFuture` separately. Where EVM values are null, return `evmNote` stating the reason read from the code (for example, no baseline). Do not invent reasons.
- `get_table`: add `offset`; return `nextOffset` when more remain; `limit` max stays 1000.
GATE: R09 passes; `qa-engine-parity` and `qa-mcp-parity` updated and green (output shapes only added to, never renamed).

**2.5 `get_schema` tool.** Input: optional `table`. Output from the model: fields, types, enums, aliases, derived flags, required flags, and the limits (op caps, string max, large-change rule values from `budget.js` constants, change-set rules). Scope-aware: only tables in the key's granted sections. Register in both servers.
GATE: test asserts `get_schema` output equals the model for every table and respects scope.

**2.6 `validate_changes` tool.** Same input as `apply_changes`; calls `planProposal`; writes nothing. Returns `{ok, refused, warnings, wouldCreateOps}` and the large-change counter lookup (read-only). Same permission checks as `apply_changes`, minus the queue. Register in both servers (the app-wide server takes `projectId`, matching its existing write-tool pattern).
GATE: fuzz parity from 2.2 passes; `tools/list` parity test passes for both servers.

**2.7 Tool descriptions.** `apply_changes` description: remove stale claims, state the enums, derived-field rule, `tempId`, `before` checking, and point to `get_schema` and `validate_changes`.

**PHASE 2 GATE:** standard battery green, R09–R11 pass.

---

## PHASE 3 — Accept pipeline, change sets, deletes, report

**3.1 Ops v2.** `ops_json` becomes `{v:2, ops:[...]}`. The accept handler dispatches on shape: a bare array is v1 (Phase 1.3 leaf list); an object with `v:2` is v2. Op shapes:
- set: `{op:'set', path, recordId, field, before, beforeAbsent, after, afterAbsent}`
- create: `{op:'create', path, record}` (the record includes its server-assigned id)
- delete: `{op:'delete', path, recordId}`
`diffs_json` (display) is always generated by applying the ops to a copy of the live state and running the existing `cloudDiffState` plus `enrichDiffs`. v2 rows do not rely on `submitted_json`.

**3.2 Change sets.** `apply_changes` takes an optional `changeSetId` (`[A-Za-z0-9_-]`, max 64). Default: `cs_<UTC yyyymmdd>_<keyId>`. Store it in `cloud_reviews.change_set_id`. Ensure the API-key auth object carries the key's id (add it if `cloudAuthApiKey` only returns the label) and store `key_id`.
GATE: two calls the same day by one key land in one set; a different key lands in a different set.

**3.3 Withdraw.** Tool `withdraw_changes({proposalId, opIndexes?})`. An API key may withdraw only its own pending proposals (`key_id` match). Whole withdraw sets status `withdrawn` (new value; list queries order `pending` first and show withdrawn as closed). Partial withdraw rewrites `ops_json`, `ops_count` and `diffs_json`, and only while pending. A proposal left with zero ops becomes `withdrawn`.
GATE: acceptance test AT07 (Phase 5).

**3.4 Accept engine `src/cloud/apply-ops.js` (pure, no env access).** Input: live state, ordered proposals with their v2 ops, granted scope. Output: `{next, report[], derivedTouched, hardFailure|null}`.
- Take a snapshot of the live state at the start. All conflict checks compare against this snapshot, not the working copy.
- Process proposals in id order. Supersession: when a later op targets the same `(path, recordId, field)`, the earlier op is reported `superseded` and not applied.
- set: live equals `before` (or `beforeAbsent` and the live value is absent) → apply. Live equals `after` → `skipped_already`. Otherwise → `conflict`; the live value stays.
- create: id absent → insert. Id present → `skipped_already`.
- delete: allowed only for lists the model marks deletable (all record lists except `budgetLines` and `spendLog`). Record already absent → `skipped_already`. Refuse (reported `conflict`, reason named) when: a task is referenced by any budget line's `taskId` or `linkedTaskId`; a phase still has child tasks; a task is a predecessor of another task and that task is not also deleted in the same accept (in that case remove the id from the predecessor lists). Cleanup never edits a section outside the proposal's granted scope; if it would, report `conflict`.
- Budget changes (`proposal_json.changes`): keep the H-6 behavior. If any budget change in a proposal is stale, skip that proposal's budget changes as a group and report `conflict_budget` with both values. Other proposals in the same accept continue.
- Hard failures abort the whole accept with no state written, return 422 and the report: a scope violation; model re-validation failure of any touched record in `next`; a predecessor cycle (port the cycle check from `js/mmgr-schedule.js` `findCycles`); the post-recompute checks in 3.5.
- If zero ops applied and at least one conflict exists, leave the proposals `pending`, store the report, and return 409 with the conflict list.
GATE: `test/apply-ops.test.mjs` covers every branch above, including supersession against the pre-state, idempotent re-accept, cycle rollback, and a delete refused by a budget reference.

**3.5 Post-apply recompute.**
Step A, task side effects, for every touched task: port `stampStatus` (`js/mmgr-kanban.js`) and the relevant branches of the task update in `js/mmgr-tasks.js`: status stamps (`statusSince`, `startedDate`, `completedDate` set and cleared exactly as the client does), `leadTime` cleared on a real status change, working-day end-date from duration and the duration/start/end triad (read the work-week setting from state, find how the client gets it), `rollupPhases` for phases.
Step B, derived schedule fields (`critical`, `totalFloat`, `freeFloat`, `floatBaseline`):
- First check whether `forwardPass`, `backwardPass`, `calcFloat`, `markCritical` and weather padding can run server-side with identical results. Build a parity harness in the style of `tools/qa-engine-parity.cjs` that runs the browser code and the port on at least 20 fixtures (include phases, lead-time items, deadlines, weather-exposed tasks).
- If parity is exactly zero differences on all fixtures: ship the port and recompute on accept (`src/domain/schedule.js`).
- If parity cannot be reached (for example, weather data is browser-only): do NOT ship an approximation. Instead, on accept, set `critical`, `totalFloat` and `freeFloat` to `null` on every task of a project whose schedule inputs changed (dates, duration, predecessors, status, deadline), make `get_tasks` emit them as `null` with `derived: "pending recompute (opens in the app)"`, and verify (with the browser harness) that the next app load recomputes through `annotateSchedule` and persists the values back. If the browser does not persist them back, add that persist step to the pull-merge path.
- Record which branch was taken in `docs/MCP-DIRECTIVE-LOG.md`.
Step C, post-conditions (hard failure if violated): every task status in the enum; no cycles; phase spans equal their children; dates valid.
Report: for touched tasks (cap 50) include before and after of `critical` and `totalFloat` in the apply report.
GATE: parity harness result recorded; AT05, AT06 and R11, R12 pass.

**3.6 Accept endpoints.** Keep the per-proposal accept URL; it now uses the 3.4 engine. Add `POST …/changesets/:id/accept` and `…/changesets/:id/reject` (owner only; the budget approver may decide a set only if every pending proposal in it is budget-only, per the existing rule). Find the route table in `worker.js` by grepping for `/accept`. Accept-all performs one read-modify-write with one conditional R2 write (Step 1.6), then updates every proposal and writes its report in `apply_report_json`.
Changelog: write one `cloud_changelog` entry per accepted proposal by running the engine proposal by proposal and logging each intermediate state change. Extend `cloudLogSave` with `{proposalId, sourceType:'agent', sourceLabel, keyId, changeSetId}`. For entries over `CLOUD_MAX_LEAF_DIFFS` (40), keep the snapshot key for revert and also store the full diff list in R2 and its key in `diffs_key`. Revert behavior must not change.
GATE: `qa-changelog-diffs`, `qa-cloud-phase2` green; two proposals in one set accept as one R2 write.

**3.7 Owner UI (`js/cloud/review.js`).** Group pending proposals by change set with a header showing counts, an "Accept all" button and a "Reject all" button. After Accept all, show: applied count, skipped count, the conflict list (path, record name, expected value, live value), and derived-field changes. Every dynamic string goes through the existing `esc()` helper; the `mmgr/no-unsanitized-html` rule must pass. After success call the existing pull-merge and refresh so the Gantt and Kanban show the result. Bump the service-worker cache version per repo convention and pass `verify-sw-cache`.
GATE: `qa-approval`, `qa-cloud-phase2`, ESLint and Prettier green; a headless test accepts a set and sees the applied and conflict counts rendered.

**3.8 Agent-facing report tools.**
- `get_apply_report({proposalId | changeSetId})`: returns the stored report: per op `{opIndex, path, recordId, field, result: applied|skipped_already|conflict|superseded|rejected, reason, before, after}`, plus `derivedChanges`.
- `get_proposal_status`: add `changeSetId`, and outcome `accepted-with-conflicts` when an accepted row's report holds any conflict. Existing outcomes are unchanged.
- `get_pending`: the key's own pending proposals grouped by change set, op counts, and a read-only dry run of the accept engine against the live state so conflicts are visible before the owner clicks.
Register in both servers; both only read the calling key's own rows.
GATE: tests for each tool; an agent cannot read another key's rows.

**3.9 `deletes` in `apply_changes`.** Add `deletes: [{path, recordId}]` to both servers' schema and to the empty-envelope check, with the cap 200 per call. Validation in `planProposal`: the path must be deletable and in the key's scope, the record must exist. The accept-side rules are in 3.4.
GATE: AT14.

**PHASE 3 GATE:** standard battery green; AT01–AT07, AT12–AT14 pass.

---

## PHASE 4 — Audit trail and `get_changes_since`

**4.1 Attribution on every writer.** Every call that logs a changelog entry passes a source: owner or editor UI saves → `sourceType` `ui` or `editor` with their label; accepted agent proposals → `agent` with the key label and `key_id`. The accepting human stays in `actor_type` and `actor_label`.

**4.2 `get_changes_since({since | cursor, limit, path})`.** Scoped to the key's sections; budget data requires budget read. Each entry: `{changeId, at, approvedBy:{type,label}, source:{type,label,keyId}, proposalId, changeSetId, changes:[{path, recordId, recordName, field, before, after}]}`. `since` is an ISO time; `cursor` is `<changeId>:<offset>`. Return at most 500 changes per call, `limit` max 200 entries. If a single entry exceeds the cap, return part of it with `moreInEntry: true` and the next cursor. Read the full diff list from `diffs_key` when the entry has one.
GATE: R13 and R14 pass; test with an accepted 600-op proposal lists all 600 changes across pages.

**PHASE 4 GATE:** standard battery green.

---

## PHASE 5 — Tests, CI, docs

**5.1 Acceptance tests (all in `tools/qa-mcp-agent-first.cjs`, plus pure tests under `test/`).**

| Id | Must prove |
|---|---|
| AT01 | Two proposals touching the same table, accepted via Accept all: the result is the union. |
| AT02 | A task date edited in the UI after the proposal, then the older proposal accepted: that op is `conflict`, the UI value stays, other ops apply. |
| AT03 | `status: "done"` (or any invalid enum): `validate_changes` returns the allowed list; `apply_changes` refuses the op. |
| AT04 | Writing `critical`, `totalFloat` or `status`-stamp fields is refused as derived. |
| AT05 | A hard failure (predecessor cycle) rolls back the whole accept; the stored blob hash is unchanged; the report names the op. |
| AT06 | After accept, `completedTasks` equals the number of work items with status `completed`; `openRisks` equals the register's open count for UI-shaped and MCP-created risks. |
| AT07 | `withdraw_changes` removes a queued op before accept (whole and partial). |
| AT08 | A proposal over 500 leaves applies fully; the response reports the true count. |
| AT09 | The large-change message states N, U and L; counting uses pending and accepted rows only. |
| AT10 | A retry with identical arguments returns the same proposal id; one row exists. |
| AT11 | Permission matrix: key × section × read switch × write switch × every read tool and `get_table` × every write path, on both servers. |
| AT12 | Two concurrent accepts: exactly one applies. |
| AT13 | A UI save racing an accept: neither change is lost. |
| AT14 | Deletes: a referenced task is refused; an unreferenced task is deleted and its predecessor links removed; budget lines cannot be deleted. |
| AT15 | `get_changes_since` attribution (agent versus UI) and the over-40-leaf case. |
| AT16 | XSS sweep: for every modelled list and text field, write the payload `"><img src=x onerror=window.__pwn=1>` through `apply_changes`, accept it, load every view that renders that table, the review panel, exports and the print view, and assert `window.__pwn` is unset and the markup appears escaped. Use the repo's existing headless-browser harness pattern. |
| AT17 | `get_schema` equals the model; `tools/list` is identical in tool names and schemas between the per-project and app-wide servers (apart from the `projectId` argument). |
| AT18 | `validate_changes` and `apply_changes` produce identical refusals (fuzz). |
| AT19 | Create-then-read round trip for every creatable list: the text written is the text read. |
| AT20 | Legacy rows: a truncated one is refused with the stated message; a normal one accepts as before. |
| AT21 | End to end on a synthetic fixture (at least 60 tasks, 9 risks, a 24-change budget batch, mixed conflicts): replay the live-test scenario of 10 calls and 9 proposals, then one Accept all. Extend `tools/qa-mcp-live-e2e.cjs` (extended and nightly workflows) with this scenario. |

**5.2 CI wiring.** Add `tools/qa-mcp-agent-first.cjs` to `.github/workflows/ci.yml` next to the `qa-mcp-write-path` step (same step style, with an `id:`). If AT16 is too slow for the main job, put AT16 in `extended-qa.yml` and `nightly.yml` and note that in the coverage doc, but AT01–AT15 and AT17–AT20 must run in `ci.yml`. Register every new harness in `docs/CI-TEST-COVERAGE.md` using the tags the registry gate expects. Pure tests under `test/` run through `npm test`.
GATE: `verify-test-registry` green; the new harness runs in the CI workflow file (confirm by grep).

**5.3 Docs.** Update `docs/DEVELOPER-GUIDE.md` with: the model, change sets, ops v2, the accept engine and its conflict rules, the new tools and the derived-field rule. Finish `docs/MCP-DIRECTIVE-LOG.md`.

**PHASE 5 GATE:** standard battery plus the new harness green.

---

## PHASE 6 — Optional auto-accept (ships OFF)

Only after Phases 0–5 are green.
- Add migration `0041_` with `auto_accept TEXT NOT NULL DEFAULT 'off'` on the API-keys table. Values: `off`, `low-risk`. Only the owner can change it, in the key admin panel (find it under `js/app/mcp-admin.js` and the API-keys section of `js/mmgr-cloud.js`), through the existing owner-gated route. Escape all rendered strings.
- Allowlist for `low-risk` (fixed; no other op may auto-apply): `set` ops on text fields `notes` (tasks, resources, meetings, documents, stakeholders, commsEntries) and `mitigation` and `notes` on risks.
- Never auto-apply: any budget op, any `status`, `deletes`, creates, `predecessors`, dates, `sets` on object or scalar sections, any op with a conflict, any proposal that mixes allowed and disallowed ops (it queues entirely).
- Auto-apply only when the proposal has at most 50 ops, runs through the same accept engine, and records `approvedBy {type:'policy', label:'auto-accept: low-risk'}` in the changelog. The Accept UI shows an "auto-applied" badge. Revert works as for any entry.
GATE: tests prove: default is off; with `low-risk` on, an allowlisted op applies and a non-allowlisted op queues; a mixed proposal queues entirely; budget never auto-applies; a 51-op proposal queues.

---

## Definition of done

1. R01–R14 pass (or are recorded "not reproduced"), and AT01–AT21 pass.
2. The standard gate battery is not worse than the Phase 0 baseline anywhere, and is green on everything that was green at baseline.
3. The new harness is referenced in `ci.yml` and registered in `docs/CI-TEST-COVERAGE.md`.
4. `docs/MCP-DIRECTIVE-LOG.md` has one line per step and a Deviations section, including which Step 3.5 branch was shipped.
5. Final report to the owner, plain text, at most 25 lines: what changed per phase, what is not reproduced, deviations, and the Step 3.5 branch.
