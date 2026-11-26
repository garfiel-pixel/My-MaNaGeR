---
name: high-grade-mcp
description: >-
  Design, build, audit or extend a production-grade Model Context Protocol
  (MCP) agent surface for a multi-user app — the My MaNaGeR MCP being the
  reference implementation. Use whenever a task touches MCP tools
  (apply_changes, validate_changes, get_*), the agent write path, change sets,
  the accept engine, proposal queueing, scoped API keys, budget read/write
  gates, or asks to "make the MCP high grade". Covers the safety invariants
  (never auto-apply, scope at queue AND merge, budget gates, derived fields
  read-only, proto-key guard), the one-model / one-validator contract, the pure
  accept engine and its conflict rules, atomic + idempotent writes, the audit
  trail, and the R/AT test methodology that proves it.
---

# High-Grade MCP

A high-grade MCP surface is not a bag of tools that mutate state. It is a
contract: an agent can only **propose**, a human always **decides**, every write
is **scoped**, validated against **one model**, applied **atomically**,
**attributed**, and **provable by tests**. This skill encodes that contract from
the My MaNaGeR implementation and `MCP-AGENT-FIRST-DIRECTIVE.md`.

## When this applies

- Adding or changing an MCP tool, its schema, or its description.
- Touching the proposal queue, the accept path, change sets, apply reports, or
  the changelog.
- Working on scoped API keys, budget read/write switches, OAuth, or the
  app-wide vs per-project surfaces.
- Auditing "why did the agent's change not apply / get refused / duplicate?".

## The non-negotiables (never weaken)

1. **Never auto-apply.** `apply_changes` queues a proposal; live state is
   untouched until an owner (or the budget approver for a budget-only set)
   clicks Accept. Any auto-accept is opt-in per key, default OFF, and limited to
   a fixed low-risk allowlist.
2. **Scope at two points.** Enforce the key's granted sections at QUEUE time
   (`planProposal`) AND at MERGE time (`cloudScopeMerge`, `src/lib/http.js`).
   One check without the other is a data leak.
3. **Budget is doubly gated.** Reading budget tables needs `budgetReadAllowed`;
   writing needs `budgetWriteAllowed` (`src/mcp/budget-access.js`). The generic
   diff/create/set path must route budget paths through these gates, never
   around them.
4. **Derived fields are read-only to agents.** `critical`, `totalFloat`,
   `freeFloat`, `floatBaseline`, `statusSince`, `startedDate`, `completedDate`,
   `boardPosition`, budget-line `actual`, and the like are recomputed by the
   app; an agent write is refused as derived.
5. **Proto-key guard.** `PROTO_KEYS` / `isProtoKey`
   (`src/cloud/proposal-diffs.js`) must reject `__proto__`, `constructor` and
   `prototype` on every path write.
6. **Budget lines cannot be deleted through MCP.**
7. **No credential echo, no untrusted echo.** No MCP tool output may return an
   owner code, session cookie, API key, or password hash. `create_project`
   returns `projectId`, `status`, `syncMode` only - the owner code stays in the
   app. Untrusted storage read on behalf of a client (e.g. the calculator
   workspace blob in R2) is validated before use: a non-object or array payload
   reads as empty, and its raw text is never passed through to MCP output.
8. **Revision-gated whole-state writes.** Every save and every accept bumps the
   state's numeric `revision` (`nextRevision` in `src/lib/http.js`). A save that
   quotes a `baseRevision` behind the server's is refused `409
   {code:'stale_revision', revision}` - never merged over. The app reloads the
   full state and retries; an accept response reports
   `{revision, applied[], appliedCount, blocked[], refused[]}` and
   `get_proposal_status` reports the same count and revision later.
9. **Every limit follows the project owner's tier.** `src/mcp/tier-limits.js`
   is the only table: pending cap, daily ops, per-call cap (total across
   arrays, each array also bounded by its ceiling), large budget changes per
   day, active API keys and report retention. Never hardcode a cap in a handler
   or message; pass the tier the handler already resolved. An unknown paid tier
   reads as contractor, an empty tier as free. `pricing.html` publishes two of
   the columns and `test/tier-limits.test.mjs` fails if either side drifts.
10. **A delete cleans every reference to the deleted id.** In `applyOps`, a
    task delete strips the id from EVERY survivor's `predecessors` (AT14c). A
    guard that only strips "when the record is not also being deleted" is
    always false-to-strip and leaves dangling predecessors - the schedule then
    references a record that no longer exists.
11. **A delete-only call must queue.** `planProposal` writes the touched
    section into `submitted` with the record REMOVED - not the unchanged base
    list. `submitted` is the map the queue guard reads; if only diffs/creates/
    sets populate it, a call carrying just a `deletes` op comes back "Nothing
    to propose" and no delete can be proposed at all (AT14e, owner manual test
    7). A bare `base[path]` is deep-equal to `prev`, so `cloudScopeMerge` still
    sees no diff - the submitted array MUST differ from prev.
12. **The JSON Schema is the contract, not the description.** Every argument a
    handler accepts must be a declared property on that tool's `inputSchema`.
    `creates[].tempId` and `idempotencyKey` were accepted by `planProposal` /
    `handleMcpRequest` for weeks while only prose mentioned them, so a client
    that validates arguments against the schema could never send them - an
    agent building a WBS reported "the tool rejected temporary task
    references" and shipped a plan with no dependency network. When you add an
    argument: add the property, the description, and a harness assertion
    (`tools/qa-mcp-surface.cjs` S1 proves the schema advertises it).
13. **A computed answer must state its preconditions.** `run_monte_carlo` on a
    WBS with zero dependency edges is not a forecast: each task only advances
    from its own start date, so the project end is the latest single task and
    P10-P90 collapse onto it. The tool now returns
    `networkHealth:{dependencyEdges,cycles,reliable}` and a `note` beginning
    "NOT A FORECAST" instead of letting a caller read "0% by the deadline" as
    a schedule verdict. Apply the same rule to any new derived read: say what
    had to be true for the number to mean anything.

## Architecture (reference: My MaNaGeR)

- **Two surfaces, one catalog.** `POST /api/mcp/:projectId`
  (`src/mcp/server.js` → `handleMcpServer`) and `POST /api/mcp` app-wide
  (`src/mcp/appwide.js` → `handleAppwideMcp`). Both build from the same `TOOLS`
  and `tool-meta.js`; they differ only by the `projectId` argument. Keep
  `tools/list` identical across the two.
- **One model.** `src/mcp/model.js` is the single source of truth: field names,
  types, enums, aliases, derived flags, defaults. `TASK_STATUSES` is
  `todo`, `inprogress`, `blocked`, `completed` (never `done`). Derive defaults
  from the UI creators, not from guesses; `createDefaults` must equal what the
  UI creator produces.
- **One validator.** `planProposal(args, liveState, auth, deps)`
  (`src/mcp/plan.js`) returns `{ops, refused, warnings}`. Both `apply_changes`
  and `validate_changes` call it, so they cannot drift.
- **Queue.** A proposal is immutable in `cloud_reviews`, carrying `ops_json`,
  `ops_count`, `diffs_json` (display copy, capped at `MCP_MAX_DIFFS`),
  `change_set_id`, `key_id`, `apply_report_json`.
- **Change sets.** Same key + same UTC day → `cs_<yyyymmdd>_<keyId>`, or an
  explicit `changeSetId`. The owner decides a whole set in one click
  ("Accept all").
- **Accept engine.** `applyOps(liveState, proposals, deps)`
  (`src/cloud/apply-ops.js`) is PURE (no env access). It returns
  `{next, report, derivedChanges, hardFailure, conflicts}` and never mutates
  the caller's state (it clones into a working copy).
- **Recompute.** After apply, stamp status/dates and recompute derived schedule
  fields server-side only where a parity harness proves byte-identical results;
  otherwise set them `null` with `derived: "pending recompute (opens in the app)"`.

## The apply pipeline (order matters)

1. **Queue.** Agent calls `apply_changes` → `planProposal` validates every op
   against the model + scope + budget gates → refused ops are listed per op;
   valid ops are queued as a proposal in a change set. The first text sentence
   stays `Queued N field change(s) for owner review (proposal #ID).`; add a
   second JSON block with counts, refusals and warnings.
2. **Accept.** Owner Accept (single proposal or whole set) → claim the row
   atomically (`UPDATE ... WHERE status='pending'`), read live state with its R2
   etag, run `applyOps`, recompute, write with `onlyIf: {etagMatches}` (retry
   ≤3), then log one `cloud_changelog` entry per proposal with attribution.
3. **Conflicts.** Per-op for non-budget ops; a stale budget change refuses the
   whole proposal's budget group (H-6). Zero applied + ≥1 conflict leaves the
   proposal `pending` and returns 409 with the report.
4. **Hard failure.** A scope violation, model re-validation failure, predecessor
   cycle, or post-condition failure rolls back the whole accept with no state
   written (422 + report).

## Conflict + idempotency rules

- `set`: live == `before` (or `beforeAbsent` and live absent) → apply; live ==
  `after` → `skipped_already`; otherwise `conflict` and the live value stays.
- `create`: id absent → insert; id present → `skipped_already`.
- `delete`: only model-deletable lists; refuse a task referenced by a budget
  line, a phase that still has children, or a predecessor that is not also
  deleted (cleanup never edits outside the proposal's granted scope).
- **Supersession:** a later op on the same `(path, recordId, field)` supersedes
  the earlier one (`superseded`), computed against the pre-state snapshot.
- **Idempotency:** `cloud_reviews.import_key` is unique; identical arguments in
  the same 10-minute bucket return the same proposal id with `duplicate: true`.
- **No false success on a zero-diff accept:** when every op resolves
  `skipped_already`/`superseded` (live already equals `after`) on a proposal
  whose pre-claim `decided_at` is still null, another path applied the change -
  the row is a STALE DUPLICATE. `acceptMcpV2` (`src/reviews.js`) must refuse
  `409 stale` with the "Refresh the project and review it again" sentence,
  release the claim and leave the row pending (e2e B5, gate AT25e). Only a row
  that was already decided (an earlier claim whose R2 write survived a lost D1
  status update) may heal to accepted on an all-skipped retry (AT25a-d): the
  claim stamps `decided_at` before any R2 write, so that stamp distinguishes a
  recovery retry from a redundant duplicate. Never report "accepted, N updates
  pulled" for a no-op accept.

## Tool catalog shape

- **Read:** `get_project_summary`, `get_project_health`, `get_tasks`,
  `get_schedule`, `get_resources`, `get_risks`, `get_issues`, `get_budget`,
  `get_table`, `get_schema`, `get_pending`, `get_proposal_status`,
  `get_apply_report`, `get_changes_since`.

Every read tool is scope-aware and returns projected data only. `get_schema` is
derived from the model; `validate_changes` and `apply_changes` share
`planProposal`.

`get_schedule` (`src/mcp/schedule.js`) is a pure port of the browser CPM
engine; `tools/qa-mcp-surface.cjs` loads the real `js/mmgr-schedule.js` in a
vm and fails on any date or float drift. `get_project_health`
(`src/mcp/health.js`) is the readiness gate an agent should call before
planning, and its `buildLint` is the structural lint `validate_changes`
returns.

12. **Readiness must answer "what first?", not just "something is wrong".** A
    gate list with 25 near-identical warnings is not an actionable conclusion.
    `get_project_health` therefore pairs its gates with a plain `verdict` and
    a ranked `nextActions` list where every action carries `code`, `severity`,
    `gate`, `count`, `ids[]` and an imperative `action`. Before adding a new
    gate or lint rule, add the matching action and prove it on a messy fixture
    in `tools/qa-mcp-messy-projects.cjs`: cycles, duplicate ids, dangling
    predecessors, dates without duration, reversed dates, a parentName that
    holds a phase id, and a deadline with slack. Actions MUST be scoped to the
    sections the key can read — the gate-to-scope map is
    `schedule -> wbs`, `data -> always`, `res -> res`, `bud -> bud`. An empty
    zero-float critical set against a later deadline is slack, not an absent
    risk: say so in the schedule gate instead of letting an agent conclude
    "no critical path".
- **Write:** `apply_changes`, `validate_changes`, `withdraw_changes`.

Every tool is scope-aware and returns projected data only. `get_schema` is
derived from the model; `validate_changes` and `apply_changes` share
`planProposal`.

## Test methodology (prove it, don't assert it)

- **Reproductions first.** `R01..R14` in `tools/qa-mcp-agent-first.cjs` must
  fail on the pre-fix tree for the stated reason, then pass after the fix.
- **Acceptance.** `AT01..AT21` prove union, conflict, enum refusal, derived
  refusal, cycle rollback, report accuracy, withdraw, >500 leaves, the
  large-change message, idempotency, the permission matrix, concurrent accept,
  the UI-save race, deletes, attribution, XSS, schema parity, fuzz parity,
  round-trip, legacy rows, and the end-to-end replay.
- **Infrastructure.** Reuse the fake D1/R2 pattern from
  `tools/qa-mcp-write-path.cjs`; do not invent new test infrastructure.
- **Gate battery.** `npm test`, `verify-eslint`, `verify-prettier`,
  `verify-test-registry`, `verify-sw-cache`, plus the MCP harnesses. No check may
  be worse than the Phase 0 baseline.

## Hard-won lessons (do not relearn these)

- `tasks.status` is `completed`, not `done`. A harness that sends `done` never
  queues, and the accept path then crashes on `undefined.id`.
- `acceptMcpV2` returns `applied` as a **count** (the review UI does
  `data.applied || 0`); the save-accept path returns an **array**. Do not assume
  one shape.
- A stored budget proposal carries the **output** shape (`{kind, lineId, field,
  before, after}` with money under `after`); the accept path re-runs
  `buildBudgetProposal`, which wants the **raw input** shape. Normalize with
  `normalizeBudgetChange` (`src/reviews.js`) or every budget accept fails with
  "No budget changes to apply."
- Title-keyed lists (`meetings`, `logEntries`, `commsEntries`) need their parent
  array to exist; a state that drops them makes an MCP create fail at accept
  with "X is not an array list."
- `logEntries` persist `decision`, not `title`.

## Shipping checklist

1. Model and validator updated together (`src/mcp/model.js`, `plan.js`).
2. Both surfaces registered (`server.js`, `appwide.js`); `tools/list` parity
   holds.
3. Queue, accept, report and changelog all carry `proposalId`, `keyId`,
   `changeSetId`, `sourceType`, `sourceLabel`.
4. New/changed behavior tagged `MCP-AGENT-FIRST <date> <step id>`.
5. Harness updated and registered in `docs/CI-TEST-COVERAGE.md` and `ci.yml`.
6. `docs/DEVELOPER-GUIDE.md` and `docs/MCP-DIRECTIVE-LOG.md` updated.
7. Gate battery green, and not worse than baseline anywhere.
