# My MaNaGeR — MCP Server

A **Model Context Protocol** server that lets an AI assistant (Claude Desktop,
Cursor, Claude Code, Windsurf, Gemini CLI, or anything else that speaks MCP) read
your **My MaNaGeR** project data, and suggest changes to it.

There are **two different servers** in this repository. They are not two ways of
reaching the same thing — they are separate tools with separate tool lists:

| | Cloud MCP (HTTP) | Local MCP (stdio) |
|---|---|---|
| **What it is** | A per-project endpoint on the live site | A Node script on your own machine |
| **Data it sees** | The project as it is right now, in the cloud | Exported project `.json` files on disk |
| **Needs the site** | Yes | No — works with no network |
| **Tools** | 7 | 33 |
| **How a change lands** | Queued for your review in the app | Queued for your approval, then written |
| **Start with** | The **MCP Server** card in the app | The **Regular Terminal** card in the app |

Both are described below. Pick the Cloud one unless you specifically want the AI
to work on exported files with no network at all.

---

## Option 1 — Cloud MCP (recommended)

This is the server the app advertises. It works against your live project, so
the AI sees today's data rather than a stale export.

### Get your URL and key

1. Link the project to the cloud (Controls > Share & Access).
2. Open **Controls > Cloud & Sync > MCP Server**. Copy the URL. It looks like
   `https://mymanagerworkspace.com/api/mcp/<your-project-id>`.
3. Create a key in **Settings > API Keys**. A key looks like `sk-mmgr-…`.

Use the **API key**, not your owner code, whenever you can. A key is scoped to
one project, can be given a date where it expires, and can be thrown away in one
click. The owner code grants full access to everything — treat it as a last
resort.

### Connect it

Claude Desktop, Cursor, Windsurf and friends take a URL. Other clients may want
headers instead — the server accepts either form:

| Client | What to enter |
|---|---|
| URL-based clients | The `/api/mcp/<id>` URL, with the key as `Authorization: Bearer sk-mmgr-…` |
| Header-based clients | The same URL, key in `X-API-Key` instead |

### What the seven tools do

| Tool | Returns |
|---|---|
| `get_project_summary` | Project name, description, health score, completion |
| `get_tasks` | Tasks with status, start and end dates, dependencies, critical flag |
| `get_budget` | Budget lines planned vs actual, plus EVM (SPI, CPI, EAC, ETC, VAC) |
| `get_risks` | Risk register with probability, impact, status, linked issues |
| `get_weather` | Weather risk days and the delay log |
| `get_meetings` | Meeting log with decisions and actions |
| `apply_changes` | Queues proposed edits for **your review** |

### Why the tool list loads without a key

The MCP handshake and the tool list answer with no credential, on purpose. Some
clients read a bare `401` on an MCP endpoint as "this needs OAuth", then fail
discovery against routes that do not exist, and the user never sees a working
setup at all.

Every **tool call** does require a credential. Without one the call returns a
normal, readable error and **no project data is ever sent**:

> This endpoint needs its own credential before it will share project data or
> accept changes. Supply the project API key as `Authorization: Bearer <key>` or
> `X-API-Key`, or the owner code as `Authorization: Bearer <owner-code>`.

This behaviour is deliberate, not a missing security check.

### Changes never land on their own

`apply_changes` does **not** write to your project. It places the proposed edits
in the **Review** queue inside the project, and nothing is imported to the
changelog until you accept them there. A key that only has read access simply
cannot queue anything.

---

## Option 2 — Local MCP (stdio)

Runs on your own machine against exported project files. No site, no network,
no port, no handshake. Useful when you want the AI to work offline, or to point
it at files you exported yourself.

### 1. Point it at your project files

```bash
mkdir -p mcp/projects
cp "mmgr-project-demo.json" mcp/projects/
```

### 2. Connect a client

```json
{
  "mcpServers": {
    "mymanager": {
      "command": "node",
      "args": ["/full/path/to/mymanager/mcp/server.mjs"],
      "env": {
        "MMGR_MCP_DIR": "/full/path/to/mymanager/mcp/projects",
        "MMGR_MCP_PROJECT": "my-project.json"
      }
    }
  }
}
```

Use forward slashes. On Windows a path like `C:/Users/you/mymanager/mcp/server.mjs`
is correct as-is.

That is the whole setup. Leave the cloud key out and the server uses only its own
local engine and never calls out to anything.

### 3. Or run it by hand to check it works

```bash
MMGR_MCP_DIR=./mcp/projects MMGR_MCP_PROJECT=demo.json node mcp/server.mjs
```

It speaks MCP over stdin/stdout, so on a terminal it will simply wait for input.
That is expected — it is waiting to be spoken to.

---

## Settings (local server)

| Variable | Default | What it does |
|---|---|---|
| `MMGR_MCP_DIR` | the `projects` folder next to `server.mjs` | Folder holding the exported project `.json` files |
| `MMGR_MCP_PROJECT` | — | Which file to use when a tool is not told which project |
| `MMGR_MCP_CLOUD_URL` | — | Site address, for cloud mode (e.g. `https://mymanagerworkspace.com`) |
| `MMGR_MCP_CLOUD_PROJECT` | — | Which cloud project to work on |
| `MMGR_MCP_OWNER_CODE` | — | Owner code — full access |
| `MMGR_MCP_EDITOR_CODE` | — | Editor code — scoped access |
| `MMGR_MCP_AI_KEY` | — | Your own AI key, used only when the local engine cannot answer |
| `MMGR_MCP_PROVIDER` | `google-gemini` | `google-gemini`, `openai` or `anthropic` |
| `MMGR_MCP_ALLOW_WRITES` | off | Set to `1` to enable the change tools |
| `MMGR_MCP_TOKEN_TTL_MS` | `600000` | How long an approval stays open (10 minutes) |

An AI key is read from the environment only. It is never read out of a project
file and never written anywhere.

---

## Local tool catalog (33 tools)

### Reading — no approval needed

| Tool | Returns |
|---|---|
| `mmgr_list_projects` | Which projects are available |
| `mmgr_get_project_overview` | Health, EVM SPI/CPI, counts, target completion |
| `mmgr_get_context` | The whole project as sectioned text |
| `mmgr_get_tasks` / `mmgr_get_task` | Task list / one task |
| `mmgr_get_risks` / `mmgr_get_issues` | Open risks / live issues |
| `mmgr_get_budget` | Budget lines planned vs actual, and the envelope |
| `mmgr_get_evm` | SPI, CPI, EV, PV, AC, BAC, EAC, VAC |
| `mmgr_get_health` | The five-factor health score, broken down |
| `mmgr_get_schedule_audit` | Date-logic problems, without changing anything |
| `mmgr_get_weather` | Site, risk days, logged delays |
| `mmgr_get_claim_slips` | Baseline slips, with likely causes |
| `mmgr_get_changelog` | Every AI edit and revert |
| `mmgr_answer_question` | Answers in plain language |
| `mmgr_get_resources` | Labour, equipment, materials, subcontractors |
| `mmgr_get_stakeholders` | Stakeholders with influence, interest, strategy |
| `mmgr_get_meetings` | Recent meetings with attendees and minutes |
| `mmgr_get_decisions` | Decision log with status, owner, reason |
| `mmgr_get_documents` | Registered documents with type and location |
| `mmgr_get_bids` | Bid packages with budget, deadline, line items |
| `mmgr_get_closure` | Closure checklist and lessons learned |
| `mmgr_get_sprint` | Current sprint name, start and end dates |
| `mmgr_get_dmaic` | DMAIC quality phase status |
| `mmgr_get_spend_log` | Recent spend with amounts and totals |
| `mmgr_get_weather_log` | Weather delays with days and reasons |
| `mmgr_list_writable_fields` | What can be changed, and the allowed values |
| `mmgr_list_cloud_projects` | Every cloud project your code or sign-in can reach |
| `mmgr_choose_cloud_project` | Turn "the Riverwalk job" into the exact project id |

### Changing things — two steps, and you are the second step

These only work when `MMGR_MCP_ALLOW_WRITES=1`.

| Tool | What it does |
|---|---|
| `mmgr_propose_change` | Checks a batch of edits and returns a **preview** and a one-time token. **Touches nothing.** |
| `mmgr_approve_change` | Your confirmation. This is the only thing that writes. |
| `mmgr_reject_change` | Throws the proposal away. Nothing was written. |
| `mmgr_revert_change` | Undoes an earlier AI change by its changelog id, and records the undo — history is never erased |

40 operations can be proposed. Grouped by what they act on:

- **Full add / update / delete:** `task`, `risk`, `issue`, `budgetLine`, `resource`,
  `stakeholder`, `meeting`, `decision`, `document`, `bidPackage`
- **Update only:** `change`, `charter`, `closure`, `sprint`, `dmaic`, `raci`
- **Add only:** `spendLog`, `weatherLog`, `logEntry`, `commsEntry`

`mmgr_list_writable_fields` is the authority on this list, and it reports straight
from the server, so it cannot drift out of date the way a printed list can.

---

## Checking it works

**Cloud.** In your client, ask it to call `get_project_summary`. If you get a
description back, the key is good. If you get the credential message above, the
key is missing, expired, revoked, or pointed at a different project than the one
in the URL.

**Local.** Run the server by hand (step 3 above). If it starts and waits without
printing an error, it is fine — it is listening for MCP on stdin. If it exits
immediately, `MMGR_MCP_DIR` is wrong or has no `.json` files in it.

### If things go wrong

| What you see | What it means |
|---|---|
| "needs its own credential" | No key reached the tool call. Check the header, and that the key is still live in Settings > API Keys |
| Tools listed, every call refused | The client is discovering fine but not sending the key on calls. Put it in a header, not just the URL |
| Local server exits at once | `MMGR_MCP_DIR` is missing, empty, or not a folder of `.json` files |
| Local server finds nothing | The export did not include a project file, or `MMGR_MCP_PROJECT` names a file that is not there |
| AI answers from general knowledge, not your project | It is not connected. Confirm the tool list appears in the client first |

---

## How answers are produced

The local server answers from a **local engine** that works only from real fields
in your data, and shows its working on every line — so it cannot invent a number.
When a question falls outside what that engine can ground, it can pass the
question to a cloud model **you supply the key for**, using the same rule about
not guessing. Leave the key out and those questions are simply not answered from
the cloud.

Either way: **a suggested change is not a change.** In both servers, nothing
reaches your project until you approve it.
