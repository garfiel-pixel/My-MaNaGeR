# My MaNaGeR — MCP Server (zero-dependency, stdio)

A **Model Context Protocol** server that gives AI clients (Claude Desktop, Cursor,
Claude Code, Gemini CLI, …) safe, structured access to **My MaNaGeR** project data —
the same offline-first construction workspace the app ships.

**One design decision drives everything:** the local deterministic engine answers
what it genuinely can (completion, overdue, budget, risks, issues, critical path,
EVM, weather, health — with a per-line `trace` back to real state fields, so it can
never fabricate). Everything it cannot ground falls through to the **cloud tier**
(OpenAI / Anthropic / Google Gemini, BYO key) using the exact same grounding
discipline as the app. **Cloud model is used only where the local engine can't
handle it** — the behavior you asked for, inverted into the safest shape.

**Writes are owner-approved, two-phase, revertible, and audited.**

---

## Quick start

```bash
# 1. Point the server at a folder of exported project .json files
mkdir -p mcp/projects
cp "mmgr-project-demo.json" mcp/projects/

# 2. Run it (stdio — an MCP client will spawn it; or test in a terminal)
MMGR_MCP_DIR=mcp/projects MMGR_MCP_PROJECT=demo.json node mcp/server.mjs
```

### Claude Desktop

```json
{
  "mcpServers": {
    "mymanager": {
      "command": "node",
      "args": ["C:/path/to/mymanager/mcp/server.mjs"],
      "env": {
        "MMGR_MCP_DIR": "C:/path/to/mymanager/mcp/projects",
        "MMGR_MCP_PROJECT": "my-project.json",
        "MMGR_MCP_AI_KEY": "optional-cloud-key",
        "MMGR_MCP_PROVIDER": "google-gemini",
        "MMGR_MCP_ALLOW_WRITES": "1"
      }
    }
  }
}
```

### Cursor / Claude Code

```
mcp mymanager -s node C:/path/to/mymanager/mcp/server.mjs
```

---

## Environment configuration

| Var | Default | Purpose |
|---|---|---|
| `MMGR_MCP_DIR` | `./mcp/projects` | Directory of exported project `.json` files |
| `MMGR_MCP_PROJECT` | — | Default project file name when a tool omits `project` |
| `MMGR_MCP_AI_KEY` | — | BYO cloud key enabling the `answer_question` cloud fallback |
| `MMGR_MCP_PROVIDER` | `google-gemini` | `google-gemini` \| `openai` \| `anthropic` |
| `MMGR_MCP_ALLOW_WRITES` | off | `=1` enables the owner-approved write tools |
| `MMGR_MCP_TOKEN_TTL_MS` | `600000` | Approval-token lifetime (10 min) |

The cloud key is read from the environment **only** — it is never read from a project
file and never written anywhere.

---

## Tool catalog (20 tools)

### Read / analytics (no approval needed)
| Tool | Returns |
|---|---|
| `mmgr_list_projects` | Available exported project files |
| `mmgr_get_project_overview` | Health, EVM SPI/CPI, counts, target completion |
| `mmgr_get_context` | Full sectioned Markdown context dump (same grounding the app uses) |
| `mmgr_get_tasks` / `mmgr_get_task` | Task list (status filter + limit) / single task |
| `mmgr_get_risks` / `mmgr_get_issues` | Open risks / live issues |
| `mmgr_get_budget` | Budget lines planned vs actual + envelope |
| `mmgr_get_evm` | SPI, CPI, EV/PV/AC, BAC, EAC, VAC |
| `mmgr_get_health` | 5-factor health score breakdown |
| `mmgr_get_schedule_audit` | Non-destructive date-logic audit |
| `mmgr_get_weather` | Site, risk days, logged delays |
| `mmgr_get_claim_slips` | Baseline slips with auto causes (weather/predecessor/other) |
| `mmgr_get_changelog` | Every AI edit/revert, cloud-shaped entries |
| `mmgr_answer_question` | **Local-first**; cloud fallback when the local engine can't ground it |
| `mmgr_list_writable_fields` | Introspect the write catalog + enums |

### Write (two-phase owner approval; gated behind `MMGR_MCP_ALLOW_WRITES=1`)
| Tool | What it does |
|---|---|
| `mmgr_propose_change` | Validates a batch of ops, returns a **preview** + single-use token. **Never touches the file.** |
| `mmgr_approve_change` | The owner's explicit confirmation — the **only** path that writes. Logs a changelog entry. |
| `mmgr_reject_change` | Discards the proposal; file untouched. |
| `mmgr_revert_change` | Undoes an MCP-AI change by changelog entry id; **logs a new revert row** (history never erased). |

### Write operations (validated)
`task.add/update/delete`, `risk.add/update/delete`, `issue.add/update/delete`,
`budgetLine.add/update/delete`, `change.update`, `charter.update`

Only **whitelisted fields per record type** may be written (matching the app's actual
record shapes). Enums are enforced server-side: task status
`todo|inprogress|blocked|completed`, risk level `Low|Medium|High`, issue status
`open|inprogress|resolved|closed`, change status `submitted|review|approved|rejected|
implemented|closed`.

---

## Safety model (why writes are safe)

- **Model output is untrusted input.** Every operation is validated by
  `mcp/lib/validate.mjs` (field whitelists + enum/type checks) *before* it can touch
  the file. No free-form JSON-path writes exist.
- **Two-phase approval is a code gate, not a prompt.** `propose_change` returns a
  preview and a **single-use, TTL'd token** created by the server. `approve_change` —
  which the owner invokes — is the only path that writes. An attacker who convinces
  the model to call a write tool still cannot write without the token.
- **Stale-file guard.** If the project file changes on disk between propose and
  approve, the approval is refused — nothing gets clobbered.
- **Revert-only-what-the-AI-did.** `mmgr_revert_change` refuses non-AI entries and
  refuses to re-revert. Reverts are logged as new `revert` rows (cloud parity: history
  is never erased).
- **No path traversal.** Project selection is a bare filename resolved inside
  `MMGR_MCP_DIR`.
- **Atomic writes + backups.** Every apply is tmp+rename; pre-change backups and the
  cloud-shaped changelog sit next to the project file
  (`<project>.pre-<id>.json`, `<project>.mcp-changelog.json`).
- **Changelog parity.** Entries use the exact `cloud_changelog` vocabulary
  (`entry_type`, `actor_type`, `actor_label`, `section`, `diffs_json
  [{path,before,after,beforeAbsent,afterAbsent}], created_at`) so the cloud importer
  can push them into the D1 changelog verbatim (see below).

## The local engine handles what it can — here's the boundary

| Intent | Local engine | Cloud fallback |
|---|---|---|
| "What % complete?", overdue, budget/cost, risks, live issues, critical path, EVM, weather delays, health | ✅ deterministic + traceable | — |
| Anything else (drafting, analysis, synthesis) | ❌ honest "not answerable locally" | ✅ BYO key, same grounding prompt |

---

## Development

```bash
# QA harness — spawns the real server, drives the protocol, asserts every gate
node mcp/qa-mcp.cjs
```

See `mcp/qa-mcp.cjs` for the full gate list (H1–H2 handshake, R1–R6 read/local-answer,
W1–W7 write/approval/revert/changelog).

---

## Cloud changelog importer (AI edits → D1 `cloud_changelog`)

Approved AI edits recorded in the sidecar (`<project>.mcp-changelog.json`) can be
pushed into the **D1 `cloud_changelog`**, where they join the app's own save history
and become revertible through the owner's existing changelog UI/revert route.

```bash
node tools/import-mcp-changelog.cjs \
  --file mcp/projects/demo.json \
  --url https://your-mymanager.workers.dev \
  --owner-code XXXX-XXXX-XXXX-XXXX
# dry-run first:
#   ... --dry-run
```

Env fallbacks: `MMGR_MCP_DIR`, `MMGR_CLOUD_URL`, `MMGR_OWNER_CODE`. Cloud project id
comes from `state.projectId` (override with `--project-id`).

**How it stays honest and safe** (all enforced server-side, `POST
/api/cloud/projects/:id/changelog/import`, owner-only):

- **Honesty gate.** Every diff in an imported entry is verified against the live
  cloud snapshot — the blob must already be in the state the MCP edit produced
  (record diffs resolve by `recordId`, field diffs by path). Entries whose diffs no
  longer match are skipped and reported (`stale`/`diverged`), **never stored** — a
  stale diff would corrupt a later revert. Projects with no cloud snapshot yet reject
  every entry.
- **Idempotent.** Rows carry a UNIQUE `import_key` (`mcp:<projectId>:<localId>`,
  migration 0005) — re-running the import (even after losing the local ledger)
  can never duplicate audit rows.
- **Revertible.** Imported entries are plain `cloud_changelog` rows; the owner can
  revert them with the existing revert route. The revert route resolves record diffs
  by stable `recordId` (MCP parity with the sidecar's own revert logic), so an
  imported edit stays revertible even after later cloud saves shift the arrays.
- **Normalized.** MCP `bulk` entries carry field diffs but no R2 snapshot, so they
  are stored as `edit` (the only reversible form); `bulk` without diffs and
  `recovery` entries are rejected.

Tested by `node tools/qa-cloud-import.cjs` (auth, honesty gate, dedupe, recordId
revert, bulk normalization, CLI end-to-end against local `wrangler dev`).

## Suggestions (from the build)

1. **Keep exported files under git** — every AI edit is then diffable and restorable
   at the file level too, on top of the changelog + backups.
2. **Re-import after AI edits.** The MCP writes the exported `.json`; open it in the
   app (Settings → Import) to see the changes rendered. `fieldTs` is stamped like the
   app's own saves, so a later merge treats MCP edits as a normal newer save.
3. **Import after AI edits** — `tools/import-mcp-changelog.cjs` pushes the sidecar
   entries into the D1 `cloud_changelog` (see above); re-export the edited file into
   the app afterwards so the state and changelog agree.
4. **Limit `MMGR_MCP_ALLOW_WRITES` scope** per deployment (e.g. a dedicated projects
   folder) rather than pointing the server at your whole drive.
