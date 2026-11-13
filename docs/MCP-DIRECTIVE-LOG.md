# MCP agent-first directive — execution log

Tracks `MCP-AGENT-FIRST-DIRECTIVE.md` (2026-11-12). One line per step: id, files
changed, gate result. Deviations are recorded at the bottom, per rule 4.

Branch: `feat/mcp-agent-first`, cut from `origin/main` at `b68c6a3`.

---

## Baseline (Phase 0.1)

Recorded on `057ab5f` before any Phase 1 edit. Rule 8 battery:

| Command | Result |
|---|---|
| `npm test` | 389 / 389 pass |
| `node tools/verify-eslint.cjs` | 0 errors (999 warnings, ceiling 1286) |
| `node tools/verify-prettier.cjs` | pass |
| `node tools/verify-test-registry.cjs` | pass |
| `node tools/verify-sw-cache.cjs` | pass — `mmgr-shell-v651` newer than all 62 shell assets |
| `node tools/qa-mcp-write-path.cjs` | 20 / 20 |
| `node tools/qa-mcp-budget.cjs` | 46 / 46 |
| `node tools/qa-mcp-parity.cjs` | 13 / 13 |
| `node tools/qa-appwide-mcp.cjs` | 55 / 55 |
| `node tools/qa-api-keys.cjs` | all gates pass |
| `node tools/qa-approval.cjs` | 24 / 24 |
| `node tools/qa-changelog-diffs.cjs` | all gates pass |
| `node tools/qa-cloud-phase1.cjs` | 29 / 29 |
| `node tools/qa-cloud-phase2.cjs` | 85 / 85 |
| `node tools/qa-engine-parity.cjs` | 19 / 19 |
| `mcp/qa-mcp.cjs` | 52 / 52 |

Reference run for the connector itself: `node tools/qa-mcp-live-e2e.cjs` 33 / 33
(full OAuth discovery → DCR → PKCE → tool call → owner accept).

No check may fall below these numbers.

---

## Phase 0 — baseline and reproduction

| Step | Files | Gate |
|---|---|---|
| 0.1 Baseline | `docs/MCP-DIRECTIVE-LOG.md` (this file) | PASS — every rule-8 command listed with a result |
| 0.2 Reproduction | `tools/qa-mcp-agent-first.cjs` (new), `docs/CI-TEST-COVERAGE.md` (TRIAGE row) | PASS — 23 / 23 checks fail, each for its stated reason |

### R-test map (all red on the pre-fix tree)

| Test | Checks | Stated reason observed |
|---|---|---|
| R01 | 3 | queue reports `Queued 500 field change(s)` for 100 creates; accept materialises 58 of 100 tasks |
| R02 | 2 | a row with `diffs_json: null` accepts through the whole-array merge and rolls a live `status` back to the proposal value |
| R03 | 3 | `get_table` returns `budgetLines`, `spendLog`, `budgetEnvelope` with Read budget off |
| R04 | 1 | all three budget paths queue with Propose budget changes off |
| R05 | 2 | an agent `before` of `completed` against live `todo` is rewritten to `todo`, queued, and accepted with no stale flag |
| R06 | 1 | 24 large changes answer "already queued 0 … a day allows 10"; the message never names 24 |
| R07 | 1 | two concurrent accepts both answer 200 |
| R08 | 1 | identical retry creates two pending rows |
| R09 | 2 | `name`-only risk reads `(untitled)`; `openRisks` counts 1 of 2 because `Open` ≠ `open` |
| R10 | 2 | `status:"done"` queues and accepts; `completedTasks` stays 5 |
| R11 | 1 | `critical:true` queues and accepts |
| R12 | 1 | `status:"completed"` leaves `completedDate` and `statusSince` unset |
| R13 | 2 | 41-leaf accept writes a changelog row with `diffs_json: null` and no attribution columns |
| R14 | 1 | `tools/list` has no `get_changes_since` |

The harness drives the real `handleMcpServer` and `handleReviewAccept` through a
fake D1/R2 that mirrors the binding contracts it depends on: the real
`cloud_reviews` column list, the `UPDATE … WHERE id=? AND status='pending'`
claim guard (returns `changes: 0` when the row is not pending), the API-key row
with `budget_read`/`budget_write`, a real PBKDF2 owner-code hash, and v2-envelope
decryption through `cloudDecryptState`.

---

## Phase 1 — safety fixes

| Step | Files | Gate |
|---|---|---|
| 1.1 Budget read gate on `get_table` | `src/mcp/server.js` | PASS — R03 4/4; `qa-appwide-mcp` 56/56; `qa-mcp-parity` 13/13 |
| 1.2 Budget write gate on the generic path | `src/mcp/server.js`, `src/lib/budget.js`, `tools/qa-mcp-agent-first.cjs`, `tools/qa-appwide-mcp.cjs` | PASS — R04 5/5 + R04m 32-case matrix; `qa-mcp-budget` 46/46; `qa-mcp-write-path` 20/20 |

1.1 detail: `executeGetTable` takes `auth` and refuses `budgetLines`, `spendLog`
and `budgetEnvelope` with `BUDGET_READ_REFUSAL` when the key's Read budget
switch is off. The section check runs first, so a key without the Budget
section still gets the scope message.

1.2 detail: any diff, create or set naming `budgetLines`, `spendLog`,
`budgetEnvelope` or `nspid` refuses the WHOLE call with `BUDGET_WRITE_REFUSAL`
when the switch is off — the same contract the `budget` array always had.
With the switch on:
- a budget-line diff on one of `BUDGET_LINE_FIELDS` becomes a `changeLine` op
  and runs through `buildBudgetProposal` (money validation + large flag); any
  other field is refused as not writable;
- a `spendLog` diff is refused with "use the budget array (addDelivery)";
- a `budgetLines` / `spendLog` create is refused the same way, and both entries
  are gone from `CREATE_DEFAULTS`;
- a `budgetEnvelope` set becomes a `changeEnvelope` op: finite, non-negative,
  large when the change is at least min(10% of the envelope, 50000);
- `nspid` is refused everywhere as server-managed.

---

## Deviations

1. **R04's fake state needed a `spendLog` row.** The first run refused the
   `spendLog` diff with `s1: not found in spendLog`, so only 2 of 3 budget paths
   queued. That was a harness fixture gap, not a product behaviour: the fixture
   now carries `spendLog: [{id:'s1', …}]`. No directive change.
2. **R01b's baseline task count is a harness constant.** `baseState()` was
   raised from 30 to 60 tasks so R13 can touch 41 records; R01b measures created
   tasks against `BASE_TASKS`, not a literal 30. No directive change.
3. **The harness is registered TRIAGE, not CI.** The directive says "do not wire
   into CI yet" (0.2), but `verify-test-registry` refuses an unregistered
   harness. TRIAGE is the honest token for a suite that is red by design until
   Phase 1; Phase 5 flips the row to CI/EXTENDED with the final counts.
4. **`qa-appwide-mcp` W5 now probes scope with a non-money path.** Its
   out-of-scope diff used `budgetLines`; 1.2 deliberately checks the write
   switch before the section, so W5 got the switch message. W5 now uses `risks`
   (still out of the key's `wbs` scope) and a new W5b asserts the budget path is
   refused for the switch. 55 -> 56 checks.
