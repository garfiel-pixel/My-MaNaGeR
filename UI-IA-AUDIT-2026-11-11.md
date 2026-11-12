# UI SPACE / IA AUDIT — 2026-11-11

**Owner:** Garfield Fairclough
**Ask:** find places where separate boxes and tabs represent the same thing, and
put them under one major topic with its own dropdown or sub-tabs — the Paddle
"Catalog → Products / Discounts" pattern.
**Status:** audit only. No code was changed.

---

## 0. How this was measured

Read from the served markup and CSS, not from screenshots:

- `project.html` — the Settings drawer (`#drw`), its 4 tabs, the Controls pane
  (`#db-ctrl`), and the 24-button section nav (`#sec-nav`).
- `css/mmgr.css` — `.ctl-sec`, `.fmt-card`, `.ctl-sec-group`.
- `js/mmgr-cloud.js`, `js/mmgr-google-auth.js` — the five render slots inside
  Controls.
- `app.html` — the dashboard rail.
- Existing harnesses that read the Controls pane.

Height figures are **estimates computed from the CSS box model** (margins,
padding, borders, line height), not browser measurements. Every one is labelled
`est.`. A browser pass can replace them with exact numbers before any work
starts.

---

## 1. What the app actually has today

### 1.1 The Settings drawer

`project.html:1895` — four tabs:

| Tab | Content | Rows |
|---|---|---|
| Features | a walkthrough of what the app does | 11 `.fi` |
| Q & A | 10 questions and answers | 10 `.fi` |
| Prompts | one button per AI prompt | 13 buttons |
| Controls | everything else | **17 sections** |

So the drawer is three small tabs and one enormous one. Controls is roughly the
whole drawer.

### 1.2 Controls is a flat accordion — one level, seventeen peers

`project.html:2587` is an inline script (the owner's earlier "use a drop down
system instead of it being fluttered") that turns each `.ctl-sec` into a
collapsed toggle. It already works. What it does **not** do is group anything:
all 17 sections sit at the same level, same weight, same size.

Collapsed by default; three (`Profile`, `Share & Access`, `Workspace`) and
`Advanced Packs` start open.

```
Profile          Share & Access   Rules            Templates
Copy As...       Email Templates  Appearance       Workspace
Privacy          Your data        Cloud & Sync     MCP Server
Regular Terminal Features         Advanced Packs   Support & Diagnostics
Backup & Transfer  (+ Danger Zone, owner only)
```

### 1.3 The section nav — 24 sections in 7 groups

`project.html:262–300`:

| Group | Count | Sections |
|---|---|---|
| Overview | 2 | Dashboard, Definitions |
| Plan | 3 | Charter, WBS, Gantt |
| Intake | 2 | Intake, Agenda |
| **Collaborate** | **10** | Kanban, Planning, Resources, Budget, Procurement, RACI, Comms Log, Documents, Meetings, Photos |
| Control | 4 | Stakeholders, Changes, Decision Log, Risk / Issues |
| Close | 2 | Claim Pack, Closure |
| Quality | 1 | DMAIC |

### 1.4 A second, contradictory taxonomy already ships

Every gated nav button already carries `data-pack`:

| Pack | Sections |
|---|---|
| *(core, no pack)* | Dashboard, Definitions, Charter, WBS, Intake, Agenda, Kanban, Planning |
| `schedule` | Gantt |
| `money` | Resources, Budget |
| `procurement` | Procurement |
| `governance` | RACI, Comms Log, Documents, Stakeholders, Changes, Decision Log, Risk / Issues, Closure |
| `field` | Meetings, Photos, Claim Pack |
| `quality` | DMAIC |

The nav says one grouping, the pack toggles say another. Same 24 sections, two
mental models, and the user meets both.

---

## 2. Findings

### F1 — "Collaborate" is a catch-all, not a topic (S1)

10 of 24 sections — 42% of the app — live under one label. Those ten are
Resources, Budget, Procurement (money), RACI, Comms Log, Documents
(governance), Meetings, Photos (field), Kanban, Planning (planning). It is the
union of four packs. Every other group is a clean subset of one or two.

Effect: the largest group has the vaguest name, so the nav teaches nothing.
After Plan/Intake, the user has no idea where Budget went.

### F2 — Controls is one level deep, so every section shouts equally (S1)

Seventeen peer headings means the user must open each one to find anything. There
is no "you are in Workspace, and inside it these four things" — the exact shape
the Paddle catalogue solves with one major row and sub-tabs under it.

`est.` cost of the flat list: 17 header bands × ~57px = **~970px** of chrome
before any setting is visible, and every panel's content is stacked in one
scroll when open.

### F3 — One job, three headings: Connect & Sync (S1)

`project.html:2077–2103` renders five different slots in this order:

| Line | Heading | Slot rendered into it |
|---|---|---|
| 2077 | Cloud & Sync | `#sync-section` |
| 2086 | MCP Server | `#ctrl-mcp` |
| 2088 | *(MCP Server still)* | the "Sync identity is 100% optional…" hint |
| 2095 | Regular Terminal | `#ctrl-terminal` |
| 2099 | *(Regular Terminal still)* | `#drive-section` — Google Drive backup |
| 2103 | *(Regular Terminal still)* | `#cloud-section` — Cloud backup |

Two real defects, not taste:

1. **Google Drive backup and Cloud backup are filed under "Regular Terminal."**
   Their headings were never written; they inherit the box above them.
2. **The sync-identity hint sits under "MCP Server."** It describes cloud sync,
   not MCP — the "status line in the wrong home" defect.

Five slots, three headings, one subject. This is the clearest case in the app of
boxes that should be one topic with sub-tabs.

### F4 — MCP Server and Regular Terminal are the same job in two boxes (S1)

`renderMcp()` (`js/mmgr-cloud.js:2986`) is the HTTP path — needs a cloud link.
`renderTerminal()` (`js/mmgr-cloud.js:3053`) is the stdio path — works on every
project. Both answer one question: *"how do I let an AI work on this project?"*
They differ only in transport. The code comments say it plainly: the card above
is the cloud path, this one is the non-cloud path.

Three costs:

- Two headings for one decision.
- The MCP heading renders its own name **twice** — once as the `.ctl-sec` header
  (line 2086) and again inside the body (`mmgr-cloud.js:2998`).
- On an offline project the MCP section still occupies a full header plus one
  grey sentence ("not available until a cloud link exists"). The empty state is
  paid for by every offline user.

**Merge:** one "Connect an AI" group, two sub-tabs — *Cloud (HTTP)* and
*This computer (terminal)*. Default to the one that works: terminal when there is
no cloud link, cloud when there is.

### F5 — Copy As… and Email Templates are seven cards for one job (S2)

`project.html:1986–2029`. Both build a ready-to-paste message from live project
data and copy it.

- Copy As… → Slack Digest, Email Digest, Client Summary (3 `.fmt-card`)
- Email Templates → Status Update, Change Request, Risk Escalation, Closure
  Sign-Off (4 `.fmt-card`)

`est.` ~840px of stacked cards. They use different handlers (`cpFormats` vs
`emailTpl`) but the user does not care — they care "I need to send an update".

**Merge:** one "Share & Send" group, sub-tabs *Digests* / *Emails* / *Templates*.
Visual only; both handlers stay as they are.

### F6 — "Your data" is split across three sections (S2)

| Section | Job |
|---|---|
| Privacy | what we store, usage statistics |
| Your data | download everything as JSON |
| Backup & Transfer | save, load, merge, baseline, undo, output, print, shortcuts |

All three are "what happens to my data". `est.` ~1,400px combined. Merge into one
"Your Data" group with sub-tabs *Privacy* / *Export* / *Backup & Transfer*.

### F7 — Four boxes for "how the workspace behaves" (S2)

Appearance, Workspace, Features, Advanced Packs — four peer headings, one
subject: how this workspace is set up. Rules belongs here too (it is automation,
i.e. behaviour).

**Merge:** one "Workspace" group with sub-tabs *Look & feel* / *Behaviour* /
*Modules* / *Packs* / *Rules*.

### F8 — Naming collision: "Features" means two different things (S2)

- Settings tab **Features** (`project.html:1896`) = a catalogue of what the app
  can do. Documentation.
- Controls section **Features** (`project.html:2105`) = the on/off switches.

A user told "turn that off in Features" has two places to look, and one of them
is nested inside the other.

**Rename:** drawer tab → **Guide**; Controls section → **Modules**.

### F9 — Offline projects pay for cloud sections they cannot use (S3)

MCP Server, Drive backup and Cloud backup all render a "not available" sentence
for a project with no cloud link. With the merge in F3/F4 this disappears —
the group shows the terminal path, and the cloud tab explains itself only when
opened.

---

## 3. Recommended target: 6 topics, one level of sub-tabs

Controls drawer, 17 sections → 6 majors. Sub-tabs, not nested accordions — one
click to any panel, same as today.

| Major | Sub-tabs | Was |
|---|---|---|
| **You & Access** | Profile · Share & Access | 2 |
| **Workspace** | Look & feel · Behaviour · Modules · Packs · Rules | 5 |
| **Connect & Sync** | Sync · Connect an AI (Cloud \| Terminal) · Drive backup · Cloud backup | 3 headings, 5 slots |
| **Share & Send** | Digests · Emails · Templates | 3 |
| **Your Data** | Privacy · Export · Backup & Transfer | 3 |
| **Help** | Diagnostics · Danger Zone | 2 |

Default: open **You & Access** (top) with everything else one click away.

### Space

| | Today | After |
|---|---|---|
| Top-level header bands | 17 (`est.` ~970px) | 6 (`est.` ~340px) |
| Stacked static content in the default view | `est.` ~2,960px | `est.` ~1,100px |
| Estimated saving | — | **~2,000–2,400px ≈ 3–4 drawer screens** |

The saving is not mainly the headers — it is that one panel's content shows at a
time instead of seventeen stacked.

### Nav (separate, smaller change)

Do **not** add a second level to the desktop nav. `STRUCTURAL-IA §2` guarantees
every section stays one click away, and that rule is correct.

Instead, **relabel the groups to the pack names that already exist** — one
taxonomy instead of two:

| New group | Sections | Replaces |
|---|---|---|
| Overview | Dashboard, Definitions | Overview |
| Plan | Charter, WBS, Gantt, Planning, Kanban, Intake, Agenda | Plan + Intake + 2 from Collaborate |
| Money | Resources, Budget, Procurement | 3 from Collaborate |
| Govern | Stakeholders, RACI, Comms Log, Documents, Changes, Decision Log, Risk / Issues | Control + 3 from Collaborate |
| Field | Meetings, Photos, Claim Pack | 2 from Collaborate + 1 from Close |
| Close | Closure, DMAIC | Close + Quality |

Result: no group above 7 items, no group below 2, and every group name matches a
pack toggle the user already sees in Controls.

---

## 4. Hard constraints for whoever implements this

These are the reasons this change is riskier than it looks.

1. **The accordion is inline in `project.html` (line 2587).** Editing it changes
   an inline `<script>`, which changes a CSP hash. Regenerate
   `INLINE_SCRIPT_HASHES` in `worker.js` and the mirror in `serve.cjs`, then
   **restart `serve.cjs`** — a running server keeps the old CSP in memory and
   silently blocks the edited block (AGENTS.md lessons 1 and 10).
2. **Three harnesses find Controls sections by heading text** and will break the
   moment a heading is renamed or nested:
   - `tools/qa-consent.cjs:861` — finds the section starting with `Privacy`
   - `tools/qa-process.cjs:450` — finds the section matching `/^Rules/`
   - `tools/verify-controls-admin.cjs:245` — asserts `Copy As` / `Your Name` /
     `Status` exist in `#db-ctrl` text (safe if all content stays in `#db-ctrl`)
   Re-baseline them in the **same commit**, and verify in a browser.
3. **Do not rename the ids** `#db-ctrl`, `#ctrl-mcp`, `#ctrl-terminal`,
   `#ctrl-share`, `#ctrl-mcp-sec`, `#ctrl-terminal-sec` without updating every
   reference in `js/mmgr-cloud.js`, `js/mmgr-google-auth.js`,
   `js/cloud/share.js` and the harnesses above.
4. **`ALWAYS_OPEN` keys are label strings** (`'Profile'`, `'Share & Access'`,
   `'Workspace'`). Any rename silently stops matching — no error, the section
   just starts collapsed.
5. **One click to every panel.** Sub-tabs only — do not chain accordions inside
   accordions.
6. **The drawer is device/session UI.** None of this may touch project state,
   and it must never require a network or an account.
7. **No emoji.** Any new icon is a sprite symbol added to `css/mmgr-icons.svg`.
8. **Rebuild before testing:** `node build.js` after any `js/` edit.
9. **Gates:** `npm run verify`, then the three harnesses above plus
   `tools/qa-health-sweep.cjs`, at 1440 / 768 / 390, light **and** dark.

---

## 5. Suggested order

Superseded by the consolidated, phased plan in
**`UI-IA-IMPLEMENTATION-PLAN-2026-11-11.md`**, which folds the second-pass
findings (§7) and the search build (§8) into one sequence.

The short version: **truth pass → Controls 17 → 6 → search → other surfaces.**
The truth pass first, because it is the cheapest change in this document and it
removes three contradictions users can see today.

---

## 6. What was deliberately not proposed

- **No new drawer tab.** The drawer already has four; adding a fifth would make
  the problem worse.
- **No nesting in the desktop nav.** One click per section stays.
- **No merge of the Settings tabs themselves.** Features / Q&A / Prompts /
  Controls are genuinely different jobs. Only the *names* need fixing (F8).
- **No removal of any setting.** Every control keeps its home; only the number of
  boxes between the user and it changes.

---

## 7. Second pass — the rest of the site

Read after the first pass, on the owner's instruction to check the admin panel,
the calculator page and "anywhere else". Six more findings, two of them
contradictions a user can see right now.

### F10 — Three served pages state three different panel counts (S1)

| Page | Says |
|---|---|
| `index.html:146`, `index.html:251`, `js/marketing.js:1981` | **15** |
| `features.html:86`, `features.html:110` | **Eighteen panels** |
| `mymanager-field-guide.html:769`, `814`, `844` | **18** |
| `mymanager-field-guide.html:675` | **Sheets 32** — the guide actually ships 36 `class="sheet "` sections |

`docs/UI-AUDIT-MAP-2026-11.md:18` already recorded this as **TRUE** (assumption
U-A4, "page states different panel counts in different places") and §C.1 planned
the fix. Only `index.html` was fixed.

**Root cause:** `tools/qa-copy-gate.cjs:29-30` reads `index.html` and
`js/marketing.js` only. `features.html` and the field guide have never been
scanned, so CI is green on a page that contradicts the one beside it.

**Fix:** extend the gate to every served page, then set the copies to the real
counts. This is the cheapest high-trust change in the whole audit.

### F11 — The landing page's 15 features and `features.html`'s 13 are different sets (S1)

| | ids |
|---|---|
| `index.html` (15 cards) | `f-wbs` `f-kanban` `f-raci` `f-lookahead` `f-budget` `f-risk` `f-health` `f-gonogo` `f-voice` `f-weather` `f-meetings` `f-claims` `f-registers` `f-ai` `f-offline` |
| `features.html` (13 blocks) | `f-wbs` `f-kanban` `f-raci` `f-risk` `f-budget` `f-ai` `f-voice` `f-glass` `f-weather` `f-offline` `f-backup` `f-connect` `f-teams` |

- **Missing on `features.html`:** `f-lookahead`, `f-health`, `f-gonogo`,
  `f-meetings`, `f-claims`, `f-registers` — 6 of the 15.
- **Only on `features.html`:** `f-glass`, `f-backup`, `f-connect`, `f-teams`.

The marketing nav dropdown (`js/marketing.js:795-911`) lists the six missing
ones as items, and its footer says "See every feature in detail" →
`features.html`. So the dropdown promises six sections that page does not have.

**Fix:** one registry of features, consumed by the landing cards, the features
page, the nav dropdown and the search index. This is the same registry §8 needs
— build it once.

### F12 — Field guide: a duplicated sheet number and an out-of-order one (S2)

- `A-26` is used **twice**: `Signing In` (`:726`) and `Shared Resource Pool`
  (`:743`).
- `A-34` (`Intake & Agenda`) sits **between A-05 and A-06** (`:701`).
- Sidebar claims **Sheets 32**; 36 ship.
- Nav groups unbalanced: `Projects & Admin` holds 12 items, `Governance` holds 2.

A sheet number that does not order or identify is decoration. Either renumber in
reading order or drop the numbers.

### F13 — Admin panel already does the right thing (precedent, no change)

`admin.html:481-565` is exactly the pattern this audit recommends and should be
cited, not touched:

- one `<main>`, one toolbar with the two creation actions;
- both site-wide operator cards **collapsed inside one disclosure**
  (`<details id="operator-tools">`, `:516-562`) with a plain-language summary
  ("For the deployment operator. Your own panel, projects and backup work
  without this");
- the project list below.

Two nits only:

1. The rail's `Cloud Admin` link points at that closed `<details>` (`:582` →
   `#operator-tools`). Worth one browser check that the fragment expands it.
2. The rail's `Customize` dropdown holds both a **Premium** indicator and the
   **theme** picker (`:589-595`) — two different jobs in one dropdown.

### F14 — Calculator page: three cards for one job (S2)

`calculator.html` stacks 10 cards in one column, no in-page index.

| Line | Card | Job |
|---|---|---|
| 873 | History | my saved estimates |
| 883 | Named estimates | my saved estimates |
| 893 | Compare estimates | my saved estimates (hidden until Compare is pressed) |

One job, three boxes — the same defect as Controls. Merge into one "Saved
estimates" card with sub-tabs *History* / *Named* / *Compare*, and reuse the
page's own working precedent: the "How to use" Steps/Notes tabs (`:102-103`).

Secondary: the Estimate card (`:672`) sits after a 535-line input card. Mobile
already solved this with the fixed total bar (`:955`); desktop still scrolls.
Lower priority than the merge.

### F15 — Search exists on exactly one page, and it searches the wrong thing (S1)

| Surface | Search today |
|---|---|
| `app.html` | `#db-search-btn` (`:495`) → `#ps-modal` → **project names only** (`openProjectSearch`, `:1813`) |
| `project.html` | **none** |
| `admin.html` | **none** |
| `calculator.html` | **none** |
| marketing / field guide | nav dropdowns only |

The one place a user is most likely to be lost — inside a project with 24
sections and 17 collapsed settings groups — has no search at all. And the
existing project search cannot find a *feature*, a *setting*, a *section* or a
*shortcut*; it can only find a project the user already named.

The shortcut table (`js/mmgr-shortcuts.js:39-53`) already proves the pattern
this needs: one table, rendered into the sheet **and** the drawer
(`paintDrawerGrid()`, `:389`), so the two can never drift. A search index should
be built the same way.

---

## 8. The search gap, stated plainly

Owner's requirement: *"if someone isn't seeing a feature, they can search for
that feature and click it. If they can't find MCP, they type in MCP — or the
full name, model context protocol."*

That is a **command palette**, not a project filter. It needs four things the
app does not have:

1. **A registry** of everything findable: sections, settings rows, drawer tabs,
   prompts, shortcuts, pages, guide sheets — each with a label, a group, an icon
   and a way to reach it.
2. **Aliases**, so plain speech works: `mcp` → Model Context Protocol,
   `dark mode` → Theme, `backup` → Drive backup, `undo` → the action.
3. **A runner** that does not just navigate but *reveals*: open the drawer, pick
   the tab, expand the collapsed group, scroll the row into view, flash it.
4. **Gating that matches the rest of the app**, so search never becomes a way
   around a pack or an editor-code scope.

Point 4 is the one that can go wrong quietly. `js/mmgr-render.js:1911` already
blocks opening a section outside an editor code's grant; search must call that
same guard, never its own copy. A gated section must not be findable, and the
only result offered for a pack that is off is "turn the pack on".

The full build is specified in
**`UI-IA-IMPLEMENTATION-PLAN-2026-11-11.md`, §3 Phase 4**.
