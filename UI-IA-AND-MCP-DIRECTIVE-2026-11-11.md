# UI, SEARCH AND MCP - IMPLEMENTATION DIRECTIVE 2026-11-11

**Status:** NOT STARTED. This is the full ordered build list. Nothing in it is built.
**Date:** 2026-11-11. **Approvals:** granted 2026-11-12 (section 12).
**Owner:** Garfield Fairclough
**Order law:** implement from T-00 down to the last task, in this order, all of it.
No task may be skipped, reordered, merged into another, or declared "done" on a
partial pass. If a task cannot be finished, stop and escalate with the evidence -
do not quietly drop it and move on.

**Absorbs and supersedes:**

- `UI-IA-IMPLEMENTATION-PLAN-2026-11-11.md` - all phases 0-7, the architecture
  spines, the acceptance criteria and the four prompts.
- `MCP-DIRECTIVE-2026-11-11.md` - sections 3 to 11 as the contract of record,
  plus section 7 (the landing-page MCP card), which `docs/MCP-CONTRACT.md:53`
  deferred and which the owner now wants shipped.
- `UI-IA-AUDIT-2026-11-11.md` - findings F1-F15 are the evidence base; every
  task below names the findings it closes.

**Read order for the implementing session:** `AGENTS.md` (already loaded) ->
this file -> `docs/DEVELOPER-GUIDE.md` -> `docs/MCP-CONTRACT.md` ->
`docs/CI-TEST-COVERAGE.md`. Do not open `docs/history/`.

---

## 0. Why this order

Value first, dependencies second, cosmetics last. The sequence is not a wish
list - each stage removes a reason the next stage would otherwise fail.

| Stage | Tasks | Why it sits here |
|---|---|---|
| 0 | T-00 | You cannot prove a change you did not measure first, and the working tree already has uncommitted CSS that could be a hand edit. |
| 1 | T-01, T-02 | A shipped feature (`/api/mcp`) still fails every write in production, and the project's own data correction is blocked behind it. This is the only stage that fixes something *currently broken for a user*. |
| 2 | T-03 to T-06 | Cheapest high-trust change in the whole file: three pages state three different panel counts. It also builds the one registry that the landing cards, the features page and the nav dropdown all need before they can agree. |
| 3 | T-07 to T-12 | The biggest usability win (17 visible settings boxes become 6 topics), and it must come after the shell extraction or every edit moves a CSP hash. |
| 4 | T-13 to T-16 | The owner's explicit ask: type a feature name, land on it. It needs the registry (stage 2) and the Controls groups (stage 3) to exist before it can find them. |
| 5 | T-17 to T-20 | Real but smaller: three calculator cards for one job, field-guide numbering, two admin nits, nav labels. Independent and low risk, so they can wait. |
| 6 | T-21 | Wire the new gates into CI so none of the above can silently regress. |
| 7 | T-22, T-23 | Staged deploy, live acceptance, then the correction that was blocked in stage 1. |

---

## 1. What is already true today (verified before writing this file)

Read this section before touching anything. Two of these facts change what the
tasks are.

### 1.1 The MCP repair is committed and green locally

| Item | State |
|---|---|
| `2279930 fix(mcp): repair project write path and unify app-wide contract` | committed |
| `4de0faf docs(mcp): add the two-endpoint contract note` | committed |
| `5fcde08 test(mcp): add a 30-call mixed loop to the write-path gate` | committed |
| `node tools/qa-mcp-write-path.cjs` | 20 passed, 0 failed (incl. 30-call mixed loop) |
| `node tools/qa-mcp-parity.cjs` | 13 passed, 0 failed |
| `src/mcp/server.js`, `src/mcp/appwide.js`, `src/mcp/oauth.js` | shared engine, no fork |

**Therefore T-01 is a deploy-and-prove task, not a build task.** The live 1102
evidence was captured at `2026-11-12T03:12:37Z` (= 22:12 EST on 2026-11-11); the
fix commit landed at 23:05 EST. The production Worker has almost certainly not
carried the fix yet. Prove it rather than assuming either way.

### 1.2 The correction payload is not in the repository

`mcp-correction-payload.json` does not exist on disk. It was described as 30
prepared diffs (11 overdue tasks, 8 untitled risk descriptions, 11 risk
mitigations). **T-02 regenerates it from live state after the write path is
proven.** Do not hunt for the old file and do not invent its contents.

### 1.3 The UI work is untouched

No UI IA, search, calculator, field-guide or admin task from this file has been
started. The only related artefact is the audit.

### 1.4 The working tree has uncommitted CSS

```
 M css/mmgr.css
 M css/src/86-theme-bento.css
 M css/src/86-theme-obsidian.css
 M css/src/86-theme-pegboard.css
 M css/src/86-theme-permit.css
 M tools/qa-what-is-this.cjs
```

`css/mmgr.css` is **generated**. If that modification is a hand edit, it is a
live violation of `css/src/README.md:3` and it will be wiped by the next build.
T-00 resolves this before anything else, because every later phase rebuilds CSS.

### 1.5 The three-count contradiction is live right now

| Page | Says | Truth |
|---|---|---|
| `index.html:146`, `:251`, `js/marketing.js:1981` | 15 panels | 15 |
| `features.html:86`, `:110` | "Eighteen panels" | 15 |
| `mymanager-field-guide.html:769`, `:814`, `:844` | 18 panels | 15 |
| `mymanager-field-guide.html:675` | Sheets 32 | 36 ship |

`docs/UI-AUDIT-MAP-2026-11.md:18` recorded this as TRUE (U-A4) and only
`index.html` was ever fixed. `tools/qa-copy-gate.cjs:29-30` scans `index.html`
and `js/marketing.js` only - that is why CI stayed green.

---

## 2. The ordered task list

| # | Task | Closes | Risk | Commit type |
|---|---|---|---|---|
| T-00 | Baseline, pre-flight, uncommitted-work reconciliation | - | none | `chore` |
| T-01 | Deploy the committed MCP repair and prove it live | MCP live 1102 | low | `fix(mcp)` |
| T-02 | Rebuild and submit the project correction (owner accepts) | project data | low | none (owner action) |
| T-03 | One feature registry; `PANEL_COUNT` derived from it | F10 root | low | `refactor(marketing)` |
| T-04 | Count truth pass on every served page + copy gate scope | F10 | low | `fix(marketing)` |
| T-05 | Anchor and registry gates | F11 recurrence | low | `test(marketing)` |
| T-06 | Landing MCP card, features-page parity, five count re-baselines | F11, MCP §7 | low | `feat(marketing)` |
| T-07 | Extract the Controls accordion into a module | CSP risk | medium | `refactor(project)` |
| T-08 | Controls merge 1: Connect & Sync (+ Drive/Cloud misfiling) | F3, F4 | low | `refactor(controls)` |
| T-09 | Controls merge 2: Your Data | F6 | low | `refactor(controls)` |
| T-10 | Controls merge 3: Share & Send | F5 | low | `refactor(controls)` |
| T-11 | Controls merge 4: Workspace | F7, F8 (half) | low | `refactor(controls)` |
| T-12 | Controls final shape, 6 groups, naming, `qa-controls-ia` | F1, F2, F8 | medium | `refactor(controls)` |
| T-13 | Search core: index, scoring, aliases, gating | F15 | medium | `feat(search)` |
| T-14 | Search UI: palette, a11y, keys, reveal | F15 | medium | `feat(search)` |
| T-15 | Search on all four surfaces; unify project search | F15 | medium | `feat(search)` |
| T-16 | Search gate | F15 recurrence | low | `test(search)` |
| T-17 | Calculator: one saved-estimates card + search | F14 | low | `refactor(calculator)` |
| T-18 | Field guide: numbering, sheet count, sidebar balance | F12 | low | `fix(guide)` |
| T-19 | Admin: two nits + search entry | F13 | low | `fix(admin)` |
| T-20 | Project nav group relabel (labels only) | F1, F2 | low | `refactor(nav)` |
| T-21 | CI wiring, registry rows, full green run | - | low | `ci` |
| T-22 | Staged deploy + live acceptance | - | - | `chore(release)` |
| T-23 | Correction acceptance + close-out docs | - | - | `docs` |
| T-24 | Collaboration-panel project-name vertical-wrapping layout bug fix | F1 | low | `fix(css)` |

---

## 3. Hard rules (a change that breaks one of these is not shippable)

1. **Offline-first stays sacred.** No task may make the app require a network,
   an account, or a cloud project. The search palette must answer with devtools
   set to offline.
2. **Cloud sync stays opt-in** and is never enabled implicitly.
3. **Writes never auto-apply.** Every external change stays a proposal in
   *Review incoming changes* until the owner accepts it.
4. **The index is derived, never authored.** Search entries are read from the
   live DOM on every open. `features.html` versus `index.html` (F11) is this
   repo's own proof of what a hand-maintained second list becomes.
5. **One source of truth per fact.** Panel counts from `MMGR_PANEL_COUNT`.
   Feature ids from `FEATURES`. Shortcut rows from `js/mmgr-shortcuts.js`.
   MCP tool names from `src/mcp/server.js`. Nothing is copied.
6. **Reveal, do not just navigate.** A search hit for a setting opens the
   drawer, picks the tab, expands the group, scrolls the row into view and
   flashes it. Landing the user at the top of a closed drawer is a failed result.
7. **Search never bypasses a gate.** It calls
   `MMGR.Cloud.isClientSectionHidden(section)` (`js/mmgr-render.js:1911`) and
   honours pack gating. A gated section is not findable.
8. **Do not edit `css/mmgr.css`.** It is generated from `css/src/*.css`
   (`css/src/README.md:3`). `tools/verify-css-integrity.cjs` ARM 0 fails on a
   hand edit. Controls styles live in `css/src/35-workspace.css:803` and `:1029`.
9. **Do not add inline `<script>` blocks.** Every one is a CSP hash in
   `worker.js:28` and the `serve.cjs` mirror. Build the search DOM from JS.
10. **If you change an inline block, regenerate the hashes.** `project.html`
    carries four inline blocks, starting at `:65`, `:79`, `:2530`, `:2579`. T-07
    edits the one at `:2579`, so its hash is **replaced, not removed** - the
    block still carries the icon-sprite guard, the service-worker registration
    and the sign-in backdrop (`:2580-2586`, `:2648-2675`).
11. **Restart `serve.cjs` after any inline-script edit.** It computes
    `INLINE_SCRIPT_HASHES` at startup and will serve the new HTML with the old
    CSP, silently blocking the block. Verify with the live header, not disk.
12. **Rebuild before testing.** `node build.js` after any `js/` edit. A stale
    `dist/bundle.js` runs old code and looks like a failed fix. Confirm with
    `grep -c '<new symbol>' dist/bundle.js`.
13. **Re-baseline harnesses in the same commit as the contract change**, in a
    browser, with the reason in the commit body. Never delete an assertion to
    go green.
14. **Register every new harness** in `docs/CI-TEST-COVERAGE.md` and wire it into
    `ci.yml` or `extended-qa.yml`. `tools/verify-test-registry.cjs` enforces it.
15. **No emoji on served pages or in JS strings that render.** New icons are
    sprite symbols added to `css/mmgr-icons.svg`.
16. **No nested dropdowns in the project section nav.** 24 sections stay one
    click each. Search is how you find an unseen section, not a nav tree.
17. **Conventional Commits, subject <= 72 chars, no AI attribution footer.**
18. **Do not apply the project correction without explicit owner acceptance.**

### Out of scope (do not do these "while you are in there")

- **No project-data search.** The palette finds UI. Project names keep their
  existing `#ps-modal` path.
- **No dropdowns in the project section nav.** One click per section, always.
- **No new drawer tab.** There are four; a fifth makes the problem worse.
- **No removal of any setting.** Every control keeps a home, one tab deeper.
- **No network, no new persisted state, no account requirement for search.**
- **No `workers-oauth-provider`, no new OAuth library, no new OAuth surface.**
  The app already runs its own authorization server with public clients and PKCE
  S256 (`src/mcp/oauth.js`). Nothing in this file touches it.
- **No rewording of user-facing copy** beyond the count corrections and the MCP
  card. Plain language, no jargon, no emoji.

---

## 4. Architecture - the four spines

### 4.1 One feature registry (`js/marketing.js`)

Three surfaces describe the same product and disagree today:

| Surface | Source | Count | ids |
|---|---|---|---|
| Landing bento cards | `index.html` `#features` | 15 | includes `f-lookahead`, `f-health`, `f-gonogo`, `f-meetings`, `f-claims`, `f-registers` |
| Features page | `features.html` `.feature` | 13 | includes `f-glass`, `f-backup`, `f-connect`, `f-teams` |
| Nav dropdown | `js/marketing.js:795` `NAV_DD` | 15 | lists six ids `features.html` does not have |

```js
var FEATURES = [
  { id:'f-wbs', label:'WBS + Gantt', group:'Plan and schedule',
    desc:'Outline in, live schedule out', icon:'i-calendar',
    panel:true, detail:true, cardId:'f-wbs' },
  // ... the other 14 panel features, panel:true
  // the four features-page-only blocks: panel:false, detail:true, cardId:null
  // the connector: panel:false, detail:true, id:'f-connect', cardId:'f-mcp'
];
var PANEL_COUNT = FEATURES.filter(function (f) { return f.panel; }).length;
```

`detail` means the features page has a block for it. `cardId` is the landing
card id and defaults to `id`; it exists for the one feature whose two anchors
differ - MCP is `#f-connect` on `features.html` (already shipped) and `#f-mcp` on
the landing page (T-06). Documenting that mapping is what stops the registry
from claiming two features where there is one.

Consumers: the bento pool, the nav dropdown, the features page, the copy-gate
counts, the landing copy and the feature-parity gate. `window.MMGR_PANEL_COUNT` keeps its name.

### 4.2 One Controls shell (`js/app/controls-nav.js`)

The accordion is ~60 lines of inline JS at `project.html:2587-2646`, inside the
block that starts at `:2579`. It matches sections by **heading string**
(`ALWAYS_OPEN = {'Profile':1,'Share & Access':1,'Workspace':1}`, `:2596`) and
hardcodes `'Advanced Packs'` and `'Danger Zone'`. That is why every rename is a
silent behaviour change.

It becomes a module driven by attributes:

```html
<div class="ctl-sec" data-ctl-group="connect" data-ctl-open="1">
  <svg class="ico"><use href="css/mmgr-icons.svg#i-cloud"></use></svg> Connect &amp; Sync
</div>
<div class="ctl-sec-group" data-ctl-parent="connect">
  <div class="ctl-tabs" role="tablist" aria-label="Connect and sync">
    <button type="button" role="tab" data-ctl-tab="sync"  aria-selected="true">Cloud &amp; Sync</button>
    <button type="button" role="tab" data-ctl-tab="ai"    aria-selected="false">Connect an AI</button>
    <button type="button" role="tab" data-ctl-tab="drive" aria-selected="false">Drive backup</button>
    <button type="button" role="tab" data-ctl-tab="cloud" aria-selected="false">Cloud backup</button>
  </div>
  <div class="ctl-panel" role="tabpanel" data-ctl-panel="sync"><!-- #sync-section --></div>
</div>
```

**Every render slot keeps its id.** These are written into by JS and must
survive reparenting (renaming any one breaks one panel silently):

`#sync-section` (`js/mmgr-sync.js:327`), `#ctrl-mcp` and `#ctrl-terminal`
(`js/mmgr-cloud.js`), `#drive-section`, `#cloud-section`, `#ctrl-share`
(`js/mmgr-app.js:1059`, `:7203`), `#rules-body` (`js/render/process.js`),
`#data-account` (`js/mmgr-app.js:4905`), `#errlog-body` (`js/mmgr-errors.js:195`),
`#template-list` (`js/mmgr-render.js:4371`), `#adv-packs-section`, `#del-zone`,
`#ctrl-mcp-sec`, `#ctrl-terminal-sec`.

**Panels stay in the DOM** and are toggled with `[hidden]`, so
`document.querySelector('#db-ctrl').textContent` still contains every label.

### 4.3 One palette (`js/app/search.js` + `css/src/36-search.css`)

- Standalone module, `MMGR.AppSearch`, no dependency on `js/mmgr-app.js`
  (`APP_LAUNCHER_MODULES` and `ADMIN_MODULES` do not include it).
- Added to `APP_MODULES` before `js/mmgr-app.js` (`build.js:128`), to
  `APP_LAUNCHER_MODULES` (`build.js:238`) and to `ADMIN_MODULES`
  (`build.js:265`).
- Calculator is **not bundled** (`calculator.html:947-978` load individual
  scripts), so it gets its own `<script src="js/app/search.js?v=1">` tag and the
  `?v=` must be bumped on every change to that file.
- New stylesheet layer `css/src/36-search.css`, between `35-workspace` and
  `40-ai` (`css/src/README.md` rule 2).
- DOM built in JS on first open - zero new CSP hashes.

### 4.4 One MCP contract (`docs/MCP-CONTRACT.md`)

Already true and must stay true: one tool registry (`TOOLS`), one executor and
scope projector (`executeTool`), one proposal pipeline (`queueMcpProposal` +
`validateProposalEnvelope`), shared refusal constants, and a parity gate that
fails on drift. `get_proposal_status` is deliberately project-only;
`list_projects` and `create_project` are deliberately app-wide-only.

---

## 5. Tasks in detail

### T-00 - Baseline, pre-flight, uncommitted-work reconciliation

**Why first:** every later verdict depends on knowing the starting state, and the
tree has a modified generated stylesheet that could silently disappear at the
next build.

**Do**

1. Resolve the uncommitted CSS. For each of `css/src/86-theme-*.css`, decide:
   intentional (commit it as `fix(theme): ...`) or accidental (revert it). Then
   prove the generated file matches its sources:
   ```bash
   node build.js --css
   git diff --stat css/mmgr.css
   ```
   If `css/mmgr.css` still differs, it was hand-edited: move the change into the
   owning layer file and regenerate. `tools/verify-css-integrity.cjs` ARM 0 must
   pass.
2. Decide on `tools/qa-what-is-this.cjs` the same way (commit or revert).
   Leave the other untracked files alone - the directive `.md` files and the
   screenshot at the repo root are the owner's. Do not delete them and do not
   stage them in a code commit.
3. Capture the baseline (repo `tmp/`, never `/tmp`):
   ```bash
   node build.js
   npm run verify
   node tools/verify-controls-admin.cjs
   node tools/qa-consent.cjs
   node tools/qa-process.cjs
   node tools/qa-mcp-write-path.cjs
   node tools/qa-mcp-parity.cjs
   ```
   Save to `tmp/baseline-2026-11-11.txt`.
4. Record the live MCP state non-destructively: `initialize`, `tools/list`,
   `get_project_summary`, `get_risks`, `get_budget`. Do **not** send
   `apply_changes` to production until T-01's harness proof is green locally.
5. Confirm `serve.cjs` is not holding a stale CSP:
   ```bash
   curl -sI http://127.0.0.1:8765/project.html | grep -io "sha256-[^']*"
   ```

**Exit:** no modified tracked file except ones you intend to commit, a saved
baseline, and a recorded live MCP state. The owner's untracked documents stay
untracked.

---

### T-01 - Deploy the committed MCP repair and prove it live

**Why here:** `/api/mcp/:projectId` is a shipped feature that fails every write
in production. Nothing else in this file fixes something currently broken for a
real user. It also unblocks T-02, the project's own data correction.

**Files:** none by default. Only `src/mcp/*`, `src/lib/http.js`, `src/router.js`
if a live probe fails and the fix needs a follow-up.

**Do**

1. Re-run the local proof (must be green before deploying):
   ```bash
   node tools/qa-mcp-write-path.cjs   # 20/20
   node tools/qa-mcp-parity.cjs       # 13/13
   ```
2. Deploy from a clean staging copy under `$HOME`, never `/tmp`:
   ```bash
   node build.js
   STAGE="$HOME/mmgr-deploy"
   rm -rf "$STAGE" && mkdir -p "$STAGE"
   tar --exclude='.git' --exclude='.wrangler' --exclude='node_modules' \
     --exclude='.agents' --exclude='_archive' --exclude='tmp' -cf - . | tar -xf - -C "$STAGE"
   grep -c "MCP_WRITE_BUDGET_EXCEEDED" "$STAGE/src/mcp/server.js"   # must be >= 1
   cd "$STAGE" && npx wrangler deploy
   ```
   `grep` for any symbol that only exists in the new fix - if it is 0, the staged
   copy is stale and the deploy must not proceed.
3. Live probe, in this order. **Read probes go to the real project; every write
   probe goes to a throwaway project** (create one, seed it, mint a scoped key,
   delete it afterwards - `tools/qa-mcp-live-e2e.cjs` already does exactly this).
   If you write to the real project, you will leave stray pending proposals and
   T-02's correction will collide with them, because accepting a tasks proposal
   replaces the whole tasks array.
   - `initialize` unauthenticated -> 200, `my-manager-mcp`
   - `tools/list` unauthenticated -> 200, catalog present
   - `tools/call` with no credential -> 200 + MCP `isError` (never HTTP 401)
   - real project: `get_project_summary`, `get_tasks` (with `limit`),
     `get_risks`, `get_budget`, `get_weekly_summary`, `get_table`
   - real project: `apply_changes {}` -> **structured `isError`, not 503/1102**
     (no row is queued, so this is safe)
   - throwaway: `apply_changes` with 1 diff -> exactly one proposal receipt
   - throwaway: `apply_changes` with 30 diffs -> exactly one proposal receipt
   - real project: `run_monte_carlo {targetDate:"not-a-date"}` -> tool error,
     endpoint still healthy
   - real project: `get_weekly_summary {week:"2026-13-45"}` -> tool error
   - throwaway: 30-call mixed loop (10 reads, 10 budget reads, 10 single-diff
     writes) -> zero 5xx, zero 1102. Record p95.
4. Record the p95 and the exact commit/version deployed in `tmp/` and in the
   commit body.

**Gates:** `tools/qa-mcp-write-path.cjs`, `tools/qa-mcp-parity.cjs`,
`tools/qa-appwide-mcp.cjs`, `tools/qa-mcp-admin.cjs`, `tools/qa-mcp-budget.cjs`,
`tools/qa-api-keys.cjs` P12-P17.

**Exit:** `apply_changes {}` returns a validation error and no 1102 appears
anywhere in a 30-call mixed loop.

---

### T-02 - Rebuild and submit the project correction

**Why here:** immediately after the write path is proven, because this is the
work that was blocked. It is real data: 11 overdue tasks, 8 untitled risk
descriptions, 11 risk mitigations.

**Do**

1. Re-derive the 30 diffs from live state (the old payload file does not exist):
   - 11 tasks whose `end`/`due` is before today and whose status is still `todo`
   - 8 risks with an empty `description`
   - 11 risks with an empty `mitigation`
   Read first, propose second. Never guess a record id.
2. Submit as **one** `apply_changes` call with a section-scoped key. One call,
   one proposal, 30 diffs - this is also the final acceptance test for T-01.
3. Leave the proposal in *Review incoming changes* for the owner. **Do not
   accept it.** Capture the proposal id and the change count.
4. If any diff is refused for scope, remove it and record why - do not widen the
   key to make it pass.

**Exit:** one queued proposal, visible only to the key that queued it, with
`changeCount: 30` (or the recorded reduced count with reasons).

---

### T-03 - One feature registry

**Why here:** the cheapest way to end three contradictions, and the only way the
landing cards, the features page and the nav dropdown can stop describing
different products.

**Files:** `js/marketing.js` (`NAV_DD` at `:795`, `PANEL_COUNT` at `:1981`).

**Do**

1. Add `FEATURES` next to `NAV_DD`, derived from the 15 existing `index.html`
   cards: `id`, `label`, `group`, `desc`, `icon`, `panel:true`, and
   `detail:true` where `features.html` has a matching block.
2. `PANEL_COUNT = FEATURES.filter(f => f.panel).length`; keep
   `window.MMGR_PANEL_COUNT` (`:1983`).
3. Point `NAV_DD['index.html#features']` at `FEATURES` instead of its inline
   copy. Keep the six ids it already lists.
4. Do **not** add the MCP entry to the dropdown yet. It would point at
   `index.html#f-mcp`, which does not exist until T-06, and the T-05 anchor gate
   would (correctly) fail in between. T-06 adds both the card and the dropdown
   item in one commit.
5. Update the stale comment at `:2050` ("15 real .fcard nodes") in T-06, not
   here.

**Gates:** `tools/qa-copy-gate.cjs`; `node build.js` then
`grep -c "FEATURES" dist/marketing-bundle.js`.

**Exit:** one array, every consumer reads it, `PANEL_COUNT === 15`.

---

### T-04 - Count truth pass on every served page

**Files:** `features.html:86`, `:110`; `mymanager-field-guide.html:675`,
`:769`, `:814`, `:844`; `tools/qa-copy-gate.cjs:29-30`.

**Do**

1. `features.html`: "Eighteen panels" -> 15 in both places, or remove the number
   from the sentence entirely. Prefer removal where the sentence reads fine
   without it; the count then cannot drift again.
2. Field guide: "18 panels" -> 15 in all three places; "Sheets 32" -> 36.
3. Extend the copy gate to loop over every served page:
   `index.html`, `features.html`, `about.html`, `pricing.html`,
   `mymanager-field-guide.html`, `privacy.html`, `terms.html`, `refund.html`,
   `reviews.html`, `contact.html`, `app.html`, `project.html`, `admin.html`,
   `calculator.html`.
   - assert no hardcoded `N panels` / `N sheets` outside a `data-count` span;
   - assert every stated count equals the registry value.
4. Keep the gate's existing 9 checks intact; this is an extension, not a rewrite.

**Exit:** `node tools/qa-copy-gate.cjs` green, and a deliberate planted "18
panels" on a page outside `index.html` turns it red (prove the gate can fail).

---

### T-05 - Anchor and registry gates

**New files:** `tools/verify-navigation-anchors.cjs`,
`tools/verify-feature-registry.cjs`.

**Do**

1. Anchors: every `href="#id"` on a served page resolves to an element with that
   id on that page; every `NAV_DD` item id exists on its declared target page.
2. Registry: `index.html` card ids equal `FEATURES.map(f => f.cardId)` for every
   non-null `cardId`; `features.html` block ids equal
   `FEATURES.filter(f => f.detail).map(f => f.id)`; no duplicate ids anywhere;
   `PANEL_COUNT` equals the number of `panel:true` entries.
3. Register both in `docs/CI-TEST-COVERAGE.md` and wire into the `static` job.

**Exit:** both green now, and both fail when a single id is removed (prove it).

---

### T-06 - Landing MCP card and features-page parity

**Why here:** it is a copy/registry change on the pages Stage 2 already owns, and
it closes F11 (the landing page and the features page describe different
products) together with the last outstanding item of
`MCP-DIRECTIVE-2026-11-11.md` section 7.

**Files:** `index.html` (`#features` pool, `#features-all`, intro at `:251`),
`features.html` (`.feature` blocks), `js/marketing.js:1981`, `:2050`.

**Do**

1. Insert after `#f-ai`:

   ```html
   <article class="fcard" role="listitem" id="f-mcp">
     <span class="fc-art" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7V4a3 3 0 0 1 6 0v3"/><rect x="4" y="7" width="16" height="10" rx="2"/><path d="M8 17v3M16 17v3"/></svg></span>
     <div class="fc-icon"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-key"></use></svg></div>
     <h3>Open MCP Server</h3>
     <p>Connect Claude, Cursor or your own scripts to the live project. They read only the sections you grant, and every change they propose waits for your approval. Nothing lands on its own.</p>
   </article>
   ```

2. Add `Open MCP Server` to the motion-free `#features-all` list (the bento slots
   are `aria-hidden`; this is the screen-reader and no-JS path).
3. Add the MCP entry to `NAV_DD`'s `Platform` group (label `Open MCP Server`,
   desc `Outside AIs read and propose changes`, target `index.html#f-mcp`). It
   must land in this commit, not T-03, because the anchor now exists - the T-05
   gate would have failed in between.
4. Keep "15 panels" truthful:
   `<span data-count="panels">15</span> panels, wired together, plus an open MCP server any AI client can connect to.`
5. **Do not change `PANEL_COUNT`.** MCP is a connector, not a panel. So
   `panel:false` for `f-mcp` in `FEATURES`, and the card count becomes 16 while
   the panel count stays 15.
6. Update the stale comment at `js/marketing.js:2050` to "16 feature cards (15
   panels + the MCP connector)". With 16 cards, indices 0-15 are all seen within
   60 s (initial 0-3, then 4-15).
7. Re-baseline the five card-count assertions **in this commit**:

   | File | Check | Change |
   |---|---|---|
   | `qa-marketing.cjs` | mkt-03 `cards.length === 15` | 16 |
   | `tools/qa-bento-gate.cjs` | pool cards `=== 15` | 16 |
   | `tools/qa-bento-gate.cjs` | sr list `=== 15` + name regex | 16, add `MCP` |
   | `tools/qa-bento-gate.cjs` | `CARDS = 15`, `seen.size === 15` | 16 |
   | `tools/qa-landing-ui.cjs` | U-12 `feat.cards === 15` | 16 |

8. Verify at 1440 / 1280 / 768 / 390: card rotates in, no layout shift, no
   overflow, no duplicate id, `#features-all` reachable by keyboard.
9. **Close F11 - features-page parity.** `features.html` ships 13 blocks against
   the landing page's 15 cards. Six ids exist only on the landing page:
   `f-lookahead`, `f-health`, `f-gonogo`, `f-meetings`, `f-claims`,
   `f-registers`. The nav dropdown already links all six, so today they are six
   dead ends.
   - Add one `.feature` block for each, with the same id, the same `<h2>` label
     as the landing card and the dropdown item, a sprite icon, and two or three
     plain sentences.
   - Note the overlap that must not be duplicated: `features.html` already
     covers MCP as `#f-connect` ("Open API & MCP Server", `:299`). The landing
     card is `#f-mcp` per the MCP directive. Register them as ONE feature with
     two anchors: `{ id:'f-connect', cardId:'f-mcp', detail:true, panel:false }`.
     Do not add a second MCP section to the features page.
   - The four features-page-only blocks (`f-glass`, `f-backup`, `f-connect`,
     `f-teams`) stay in the registry with `panel:false, cardId:null`.
   - Set `detail:true` for all of them, so T-05's registry gate now asserts real
     parity instead of passing over a gap.

**Exit:** 16 cards render, 15 panels is still the stated panel count, every
landing card has a matching `features.html` block or a documented `cardId`
mapping, all five count gates green at 16, no emoji,
`tools/verify-css-integrity.cjs` passes.

---

### T-07 - Extract the Controls accordion into a module

**Why before any merge:** the accordion is inline and CSP-hashed. Restructuring
inside it would move a hash on every single merge commit - the most expensive
failure mode in this repo. Extract once, then never touch a hash again.

**New file:** `js/app/controls-nav.js` (`MMGR.AppControls`).
**Edited:** `project.html:2587-2646` (delete), `build.js:128`, `worker.js:28`,
the `serve.cjs` mirror, `js/mmgr-app.js:6138` (`ACTION_MAP`).

**Do**

1. Port the existing logic exactly: same caret, same `max-height` transition
   (`260ms` then `none`, `requestAnimationFrame` on close), same
   `role="button"`/`tabindex="0"`/`aria-expanded`, same Enter/Space handling.
   Export `init()`, `toggle(key)`, `setOpen(key, bool)`, `open()`, `close()`,
   `focus(group, tab)`, `current()`.
2. Replace string matching with attributes:
   - `data-ctl-group="<key>"` on every `.ctl-sec`;
   - `data-ctl-open="1"` where `ALWAYS_OPEN` applied (`Profile`, `Share & Access`,
     `Workspace`) and on `Advanced Packs`;
   - delete `ALWAYS_OPEN` (`:2596`) and the two hardcoded label comparisons
     (`'Advanced Packs'`, `'Danger Zone'`, `:2607`, `:2611`);
   - mark the conditional Danger Zone with `data-ctl-static="1"` instead.
3. **Delete only the accordion IIFE (`:2587-2646`).** The surrounding block
   (`:2579-2676`) keeps the icon-sprite guard, the service-worker registration
   and the sign-in backdrop. Regenerate that block's hash in `worker.js` and
   `serve.cjs` - it is replaced, not removed.
4. Restart `serve.cjs`; probe the live header and confirm the on-disk hashes and
   the served hashes match 1:1.
5. Add to `APP_MODULES` before `js/mmgr-app.js`. Add a `ctlToggle` entry to
   `ACTION_MAP` so the click path is inspectable.
6. Re-baseline only what actually breaks, in a browser:
   - `tools/qa-consent.cjs:860-866` finds `.ctl-sec` whose text starts with
     `Privacy` and clicks it. After T-09 Privacy is a tab, so this becomes:
     open drawer -> `swDtab('ctrl')` -> open the `yourdata` group -> click the
     `privacy` tab. At T-07 it should still pass unchanged - verify before
     editing.
   - `tools/qa-process.cjs:450-453` does the same for `/^Rules/`; it moves at
     T-11, not here.
   - `tools/verify-controls-admin.cjs:245` asserts
     `Copy As` OR `Slack` OR `Email` in `#db-ctrl` text. The OR fallbacks
     survive T-10, so **do not pre-emptively edit it** - run it and only
     re-baseline if it genuinely fails.

**Exit:** zero visual change (screenshot matrix before/after at 1440/768/390,
light and dark), one inline block's hash regenerated, `npm run verify` green,
`qa-consent` and `verify-controls-admin` green unmodified.

---

### T-08 - Controls merge 1: Connect & Sync

**Why this merge first:** it is the only one that also fixes a real filing bug -
Google Drive backup and Cloud backup currently render **under the "Regular
Terminal" heading** (`project.html:2077-2103`), so two backup surfaces are filed
under an AI connector.

**Do**

```
Connect & Sync
  [Cloud & Sync] [Connect an AI] [Drive backup] [Cloud backup]

  Cloud & Sync   -> #sync-section (+ the sync-identity hint, moved out of the MCP box)
  Connect an AI  -> [Cloud (HTTP)] -> #ctrl-mcp
                    [This computer (terminal)] -> #ctrl-terminal
  Drive backup   -> #drive-section
  Cloud backup   -> #cloud-section
```

Also in this commit:

- delete the duplicate inner heading at `js/mmgr-cloud.js:2998` (the `.ctl-sec`
  header already says the same thing);
- `renderMcp()` sets `data-mcp-linked="1"` on `#ctrl-mcp` when the project is
  linked (it already computes this). The Controls module reads that attribute to
  default the AI sub-tab - it must never reach into `mmgr-cloud.js`'s private
  state;
- plain labels only: "Cloud (HTTP)" and "This computer (terminal)". "MCP Server"
  and "Regular Terminal" stop being two competing headings.

**Risk:** markup reordering plus one attribute assignment. No inline script, no
CSP hash.

**Exit:** Drive and Cloud backup are no longer descendants of the Terminal
section; all five slot ids still receive their render; both themes, three widths.

---

### T-09 - Controls merge 2: Your Data

```
Your Data
  [Privacy] [Export] [Backup & Transfer]

  Privacy            -> the consent toggle + the "What we store" link
  Export             -> #data-account + Download all my data
  Backup & Transfer  -> #data-backup content: existing buttons, baseline, undo/redo,
                        output, shortcuts
```

Closes F6: three sibling boxes that all answer "what happens to my data".

Re-baseline `tools/qa-consent.cjs` B13 here: open the `yourdata` group, click the
`privacy` tab, then the existing `tglConsentStat` toggle logic runs unchanged.

**Exit:** `qa-consent` B13 green, consent toggle still flips the device record and
the mirror cookie in both directions.

---

### T-10 - Controls merge 3: Share & Send

```
Share & Send
  [Digests] [Emails] [Templates]

  Digests   -> the 3 .fmt-card blocks from "Copy As."
  Emails    -> the 4 .fmt-card blocks from "Email Templates"
  Templates -> #template-list (save / apply)
```

Handlers unchanged (`cpFormats`, `emailTpl`, `saveAsTemplate`). This is a visual
merge only; the risk is a mis-scoped selector, so assert every `.fmt-card` still
exists and every Copy button still fires.

Note the current heading is `Copy As.` **with a trailing period** (`:1986`). It
disappears here; the `Copy As` string does not need to survive as a heading.

**Exit:** 7 format cards present, every Copy button fires, `#template-list`
renders, `tools/verify-controls-admin.cjs` S4 still green (its OR fallbacks cover
`Slack`/`Email`).

---

### T-11 - Controls merge 4: Workspace

```
Workspace
  [Look & feel] [Behaviour] [Modules] [Packs] [Rules]

  Look & feel -> Appearance (theme dock, performance mode, crosshair, calculator)
  Behaviour   -> work week, weather region, lock methodology
  Modules     -> the 5 feature flags (renamed from "Features")
  Packs       -> Advanced Packs
  Rules       -> #rules-body
```

Closes F7 (four peer boxes for "how the workspace is set up") and half of F8
("Features" means two different things).

Re-baseline `tools/qa-process.cjs:450` here: open the `workspace` group, click
the `rules` tab, then the existing `#rule-name` flow runs unchanged.

**Exit:** `qa-process` green; `renderRules()` still populates `#rules-body`;
Advanced Packs still opens from the website link (`openPacks()`), which now must
open the group plus select the `packs` tab.

---

### T-12 - Controls final shape, naming, and the gate

```
You & Access    [Profile] [Access]
Workspace       [Look & feel] [Behaviour] [Modules] [Packs] [Rules]
Connect & Sync  [Cloud & Sync] [Connect an AI] [Drive backup] [Cloud backup]
Share & Send    [Digests] [Emails] [Templates]
Your Data       [Privacy] [Export] [Backup & Transfer]
Help            [Diagnostics] [Danger Zone]
```

Counted against the 18 `.ctl-sec` nodes that exist today (17 visible plus the
hidden Danger Zone), every one has exactly one home. Nothing is removed. The
Connect group shows four tabs because `#drive-section` and `#cloud-section` are
content today, not headings - they become tabs, not new `.ctl-sec` nodes.

**Do**

1. Group 1: Profile + Share & Access.
2. Group 6: Support & Diagnostics + Danger Zone (`#del-zone`, still `[hidden]`,
   still conditional).
3. Rename the drawer tab **Features -> Guide** (`project.html:1896`). Keep
   `data-tab="feat"` and every id - only the label changes.
4. Rename the Controls section **Features -> Modules** (already landed in T-11).
5. Add the deep link `?ctl=<group>.<tab>` and `AppControls.focus(group, tab)`,
   used by search (T-13) and by `openPacks()`.
6. New gate `tools/qa-controls-ia.cjs`:
   - 6 `[data-ctl-group]` nodes, each with >= 2 `[data-ctl-tab]`;
   - exactly one `[data-ctl-panel]` visible per group;
   - every listed slot id exists and is inside `#db-ctrl` exactly once;
   - no `.sr`, `.fmt-card`, `#errlog-body`, `#data-account`, `#template-list`
     orphaned outside a panel;
   - no nested accordion inside a panel;
   - `Esc`, `Enter` and `Space` all still operate the headings.
   Register it and wire it into the `browser-app` job.
7. Prove the whole drawer: 1440 / 768 / 390, light and dark, keyboard only.

**Exit:** 6 majors, every setting one click plus one tab away, `#db-ctrl` text
still carries every label, `npm run verify` green.

---

### T-13 - Search core: index, scoring, aliases, gating

**New file:** `js/app/search.js`.

**Do**

1. `buildIndex()` runs on **every open**. ~170 entries cost about a millisecond,
   and rebuilding removes the entire "the index went stale after a pack toggle"
   class of bug. Do not cache and do not subscribe to events.
2. Sources:

   | Surface | Kind | Selector / source |
   |---|---|---|
   | project | `section` | `#sec-nav .sec-btn` -> label, `data-section`, nearest `.nav-group-label` |
   | project | `setting-group` | `#db-ctrl .ctl-sec[data-ctl-group]` |
   | project | `setting` | `#db-ctrl .sr .sl` -> label, owning group + tab |
   | project | `setting` | `#db-ctrl .fmt-card .fmt-title` |
   | project | `tab` | `.dtab` |
   | project | `guide` | `#db-feat .fi .fn`, `#db-qa .fi .fn` |
   | project | `prompt` | `#db-prompt [data-action="openPrompt"]` |
   | project | `shortcut` | `MMGR.Shortcuts` (exposed in this task) |
   | project | `action` | a short allow-list: undo, redo, save, load, merge, print, backup, sign-in, settings |
   | project | `page` | static `PAGES` table (~12 rows) |
   | project | `page` | static `SHEETS` table (36 rows, kept honest by T-18) |
   | app | `page` / `action` | launcher rail + cards: new project, import, sign in, Drive backup, Drive restore, theme, account, recover deleted, cloud projects |
   | admin | `page` / `action` | project list, operator tools, customize, backup, cloud admin |
   | calculator | `page` / `setting` | guide steps, history, named estimates, compare, business details, print |

3. Expose the shortcut table: `js/mmgr-shortcuts.js` currently keeps `TABLE`
   (`:37`, keys `app` and `calc`) inside a private IIFE. Add
   `MMGR.Shortcuts = { table: TABLE }`. It is loaded directly on `project.html`
   (`:2683`) and `calculator.html` (`:978`), and **not** on `app.html` or
   `admin.html` - so every consumer must guard with
   `window.MMGR && MMGR.Shortcuts`.
4. Entry shape:

   ```js
   { id:'ctrl-connect-ai-cloud', kind:'setting', label:'MCP Server',
     hint:'Connect an outside AI to this project', group:'Connect & Sync',
     icon:'i-sparkle', aliases:['mcp','model context protocol','claude','cursor','api'],
     weight:90, run: function () { /* reveal */ } }
   ```

5. Scoring, deterministic, no library:

   | Match | Score |
   |---|---|
   | label exact | 1000 |
   | label prefix | 800 |
   | word-boundary prefix | 600 |
   | alias exact | 500 |
   | subsequence (gap-penalised) | 300 |
   | hint or group contains | 200 |

   Tie-break: `weight` desc, label length asc, DOM order. Cap 12 results, grouped
   by `kind` with a small heading. The same query must give the same order in
   every browser, or the gate is flaky.

6. Aliases (hand-authored, ~40 rows, covered by the gate):

   ```
   mcp / model context protocol        -> Connect an AI
   ai / assistant / chat / claude      -> AI Assistant
   dark mode / theme / appearance      -> Look & feel
   backup / save a copy / export       -> Export
   drive / google drive                -> Drive backup
   cloud / sync                        -> Cloud & Sync
   undo / redo                         -> action:undo / action:redo
   keyboard / shortcuts / hotkeys      -> shortcut sheet
   budget / money / evm                -> Budget
   risk / monte carlo                  -> Risk / Issues
   ```

7. Gating, reusing the existing guards - never a copy:
   - pack off -> the section is excluded; one synthetic result replaces it:
     "Money pack - turn it on to see Budget, Resources, Procurement", which
     reveals Workspace -> Packs;
   - editor/client scope -> excluded, **no** synthetic result
     (`MMGR.Cloud.isClientSectionHidden`, `js/mmgr-render.js:1911`);
   - `[hidden]` rows (`#del-zone`, the billing admin block) -> excluded by the
     visibility filter, never by a hardcoded list.

**Exit:** `MMGR.AppSearch.buildIndex()` returns ~170 entries on a loaded project
and 0 network requests; `search('mcp')` and `search('model context protocol')`
both return the Connect an AI entry first.

---

### T-14 - Search UI: palette, accessibility, keys, reveal

**New file:** `css/src/36-search.css`.

**Do**

1. DOM built in JS, appended to `<body>`, `role="dialog" aria-modal="true"`,
   `hidden` until opened. Zero inline scripts.
2. Semantics: input `role="combobox"` with `aria-expanded`, `aria-controls`,
   `aria-activedescendant`; list `role="listbox"`; results `role="option"` with
   `aria-selected`; a polite live region announces "7 results".
3. Keys: `Ctrl/⌘+K` open - `ArrowUp`/`ArrowDown` move - `Enter` run - `Esc`
   close and restore focus to the invoker. `/` stays the assistant.
4. Reveal table:

   | kind | Behaviour |
   |---|---|
   | `section` | pre-check `isClientSectionHidden`, then `MMGR.App.showSec(id)` (`js/mmgr-app.js:1288`) |
   | `tab` | `MMGR.App.openDrw()` then `swDtab(key, btn)` (`:1340`) |
   | `setting-group` | open drawer -> `swDtab('ctrl')` -> `AppControls.setOpen(group, true)` |
   | `setting` | then `AppControls.focus(group, tab)` -> `scrollIntoView({block:'center'})` -> `.search-hit` for 1.6 s |
   | `prompt` | open drawer -> `swDtab('prompt')` -> flash the button |
   | `shortcut` | open the shortcut sheet (`data-mmks="open"`) |
   | `action` | dispatch through `ACTION_MAP` (`js/mmgr-app.js:6138`) |
   | `page` | `location.href` |

5. Add one row to `js/mmgr-shortcuts.js`:
   `{ keys: 'Ctrl/⌘ + K', what: 'Search every feature and setting' }`. The drawer
   grid repaints from the same table (`paintDrawerGrid`, `:389`), so the sheet
   and the drawer agree for free.
6. `prefers-reduced-motion` -> no flash animation, a static outline instead.
7. Styles: reuse the shared modal sheet classes (`.mb`/`.mh`/`.mbody`) so the
   palette matches the rest of the app without new visual language.

**Exit:** keyboard-only open/move/run/close works, focus returns to the invoker,
reduced-motion honoured, offline works, zero network requests while typing.

---

### T-15 - Search on every surface

**Do**

1. Project: a search button in `.hdr-right` next to the settings button
   (`project.html:251`), plus `Ctrl+K` document-wide.
2. Launcher: `#db-search-btn` (`app.html:495`) becomes "search everything". The
   existing `#ps-modal` project-name search stays, but its results are folded
   into the same palette as `kind:'project'`, ranked first for that kind. Do not
   delete `#ps-modal` - it is the keyboard path today and several harnesses use
   it.
3. Admin: a search button in the admin header, indexing its own rail and cards.
4. Calculator: a search button in `bcp-top` (`calculator.html:47`), indexing its
   own cards and guide steps.
5. Bump `js/app/search.js?v=` on the calculator tag whenever that file changes
   (`calculator.html:943-946` warns about the one-year cache).

**Exit:** `Ctrl+K` opens the palette on project, app, admin and calculator; on
each surface the results are that surface's real UI.

---

### T-16 - The search gate

**New file:** `tools/qa-search.cjs`.

Prove, in a real browser:

1. `Ctrl+K` opens; `Esc` closes; focus returns to the invoker.
2. Eight real queries return the expected first result:
   `mcp`, `model context protocol`, `dark mode`, `backup`, `budget`, `undo`,
   `shortcuts`, `privacy`.
3. A setting result opens the drawer, selects the right tab, expands the right
   group and scrolls the row into view.
4. A pack-off section is **absent**, and one "turn the pack on" result appears.
5. An editor-scoped session cannot find a section outside its grant.
6. Typing issues zero network requests (intercept and count).
7. `MMGR.Shortcuts` absence on `app.html`/`admin.html` does not throw.

Register it, wire it into `browser-app`.

**Exit:** 20+ checks green, and the gate fails when the `mcp` alias is removed.

---

### T-17 - Calculator: one saved-estimates card

**Why here:** real, but purely local to one page and lower value than the app
shell.

**Files:** `calculator.html:873`, `:883`, `:893`, `:102-103` (the working
Steps/Notes tab pattern to copy).

**Do**

1. Merge History, Named estimates and Compare estimates into one card:
   `Saved estimates` with tabs `[History] [Named] [Compare]`.
2. Keep every id: `#calc-history`, `#calc-estimates`, `#calc-compare`,
   `#calc-hist-card`, `#calc-estimates-card`. Keep `calcCompare` /
   `calcCompareClose` wiring untouched.
3. Reuse `.bcp-tab` and the `calcGuideTab` behaviour (`:102-103`) rather than
   inventing a second tab style.
4. Bump `js/calculator-page.js?v=` (`:973`, currently 49).
5. Optional, only if it costs nothing: a page index at the top listing the 10
   cards. Lower priority than the merge.

**Exit:** one card, three tabs, every saved estimate still appears, `qa-calculator-page.cjs`
and `qa-calc-trade-coverage.cjs` green.

---

### T-18 - Field guide: numbering, sheet count, balance

**Files:** `mymanager-field-guide.html`.

**Do**

1. `A-26` is used twice - `Signing In` (`:726`) and `Shared Resource Pool`
   (`:743`). Renumber one.
2. `A-34` (`Intake & Agenda`) sits between A-05 and A-06 (`:701`). Move it into
   reading order.
3. `Sheets 32` (`:675`) -> 36 (landed in T-04; confirm here).
4. Rebalance the sidebar: `Projects & Admin` holds 12 items, `Governance` holds 2
   (`:703-751`). Split at the natural seam - `Admin`, `Bids`, `RFIs`, `Registers`
   / `Reviews`, plus the connect and API pair.
5. Keep the `A-xx` labels in the sidebar `<span class="idx">` in sync with the
   sheet headers; that is what a reader uses to find a sheet.

**Exit:** no duplicate sheet number, numbers ascend down the sidebar, one
`SHEETS` table matches (T-13 consumes it).

---

### T-19 - Admin nits and admin search

**Files:** `admin.html:582`, `:589-595`.

**Do**

1. Verify the rail's `Cloud Admin` link (`#operator-tools`) actually expands the
   closed `<details>` (`:516-562`) in Chrome, Firefox and Safari. If it does not,
   add three lines on click. This is the one place the admin panel's pattern can
   fail in practice.
2. Move the **Premium** indicator out of the rail's `Customize` dropdown
   (`:589-595`). A plan status is not a customisation.
3. Add the admin search entry point (T-15 item 3) if not yet done.

Cite `admin.html:481-565` in the commit body as the pattern the Controls work
followed - it already collapses both site-wide operator cards inside one
disclosure with a plain-language summary.

**Exit:** the fragment expands the disclosure in all three browsers; Premium has
its own home; admin search opens.

---

### T-20 - Project nav group relabel

Labels only. No nesting, no moved sections, no new gating.

| Group | Sections |
|---|---|
| Overview | Dashboard, Definitions |
| Plan | Charter, WBS, Gantt, Planning, Kanban, Intake, Agenda |
| Money | Resources, Budget, Procurement |
| Govern | Stakeholders, RACI, Comms Log, Documents, Changes, Decision Log, Risk / Issues |
| Field | Meetings, Photos, Claim Pack |
| Close | Closure, DMAIC |

**Why it is last of the UI work:** it changes nothing a harness asserts (the
groups are labels, and `data-pack` gating is untouched), so it is the safest
possible final polish - and it is worth doing because the current labels and the
Advanced Packs a user sees do not correspond.

**Exit:** no group exceeds 7 items, every group name matches a pack the user can
already see, every section is still one click from the nav.

---

### T-21 - CI wiring and the full green run

**Do**

1. `docs/CI-TEST-COVERAGE.md`: new rows for `verify-navigation-anchors`,
   `verify-feature-registry`, `qa-controls-ia`, `qa-search`; update the
   `qa-bento-gate` row (15 -> 16 cards) and the `qa-copy-gate` row (9 checks ->
   every page).
2. `.github/workflows/ci.yml`: static job gets the two static gates; browser-app
   gets `qa-controls-ia` and `qa-search`; no cross-job `id:` references (D-4).
3. `node tools/verify-ci-coverage.cjs` proves the `run:` multiset.
4. Full run: `npm run verify`, `tools/verify-test-registry.cjs`,
   `tools/verify-css-integrity.cjs`, and every gate named in section 8.
5. Push and poll the Actions API until the run completes. Re-enter the loop on a
   new red step; do not assume a green push.

**Exit:** all six jobs green on the branch, one run, no skipped step.

---

### T-22 - Staged deploy and live acceptance

1. Local: `node build.js`, `npm run verify`, every gate, 1440 / 768 / 390, light
   and dark.
2. Staging copy under `$HOME` (never `/tmp`), `grep` the staged file for a new
   symbol before `wrangler deploy`.
3. Live checks, in this order:
   - `/project` -> `Ctrl+K` -> `mcp` -> lands on Connect an AI, Cloud (HTTP);
   - Controls opens with 6 groups and no dead tab;
   - a pack-off project cannot find Budget in search;
   - an editor code cannot find a section outside its grant;
   - offline: the palette still opens and answers;
   - `features.html` and the field guide state the same panel count as the
     landing page;
   - the MCP write path still returns a validation error for `{}` on the real
     project and one receipt for a 1-diff proposal on a throwaway project.
4. Rollback: revert the Worker version. T-07 to T-20 are presentational; there is
   no state migration, no schema change, and nothing to undo in D1 or R2.

**Exit:** every acceptance criterion in section 6 observed on the live site, not
locally.

---

### T-23 - Correction acceptance and close-out

1. The owner accepts the T-02 proposal in *Review incoming changes*.
2. Re-read `get_project_summary`, `get_tasks`, `get_risks`, `get_budget` and
   confirm the 11 tasks, 8 descriptions and 11 mitigations landed.
3. Record, in `PLANNING-TODO-2026-09-03.txt` and the commit bodies: the MCP
   root cause, which harness contract changed and why, and the new gates.
4. Update `docs/MCP-CONTRACT.md`: remove the "Deferred" paragraph about the
   landing card (it ships in T-06), keep the proposal-review note if any of it is
   still deferred.
5. Delete or archive `UI-IA-IMPLEMENTATION-PLAN-2026-11-11.md` with a one-line
   pointer to this file, so there is one plan of record.

---

## 6. Acceptance criteria (all binary)

**Truth**

1. No served page states a panel or sheet count that disagrees with the registry.
2. Every `href="#..."` on every served page resolves.
3. Every `NAV_DD` item exists on its target page.
4. `FEATURES` ids with `detail:true` all exist on `features.html`, and every
   non-null `cardId` exists on `index.html`.

**MCP**

5. `apply_changes {}` returns a structured `isError`, never 503/1102.
6. 1 / 30 / 200 diffs each produce exactly one proposal receipt.
7. 30 mixed read/write calls produce zero 5xx and zero 1102; p95 recorded.
8. `targetDate:"not-a-date"` and `week:"2026-13-45"` return tool errors and leave
   the endpoint healthy.
9. Unset envelope returns `null` remaining, never a negative plan; the default
   weekly view is never future-dated.
10. The API-key catalog hides `get_weather`.
11. Project and app-wide catalogs pass the parity gate.
12. The landing page shows the MCP card; panel-count gates pass at 16 cards and
   `PANEL_COUNT` is still 15.
13. The T-02 proposal is queued and unaccepted until the owner accepts it.

**Controls**

14. Six majors, each with at least two sub-tabs.
15. Exactly one panel visible per group; no nested accordion.
16. Every render slot id in section 4.2 still exists and still receives its
    render.
17. Drive backup and Cloud backup are not under a terminal heading.
18. The drawer tab is `Guide`, the Controls section is `Modules`, and no other
    "Features" collision remains.

**Search**

19. `Ctrl+K` opens the palette on project, app, admin and calculator.
20. `mcp` and `model context protocol` both reach Connect an AI first.
21. `dark mode` reaches Look & feel; `undo` performs Undo; `backup` reaches the
    data surface.
22. A pack-off section is not findable; one "turn the pack on" result replaces it.
23. An editor code cannot find a section outside its grant.
24. Typing in the palette issues zero network requests.
25. `Esc` closes and restores focus to the invoker.

**Collaboration Layout**

31. Project names in the collaboration panel no longer wrap vertically (letters on separate lines). The `.team-project-name` element uses `white-space: nowrap`, `overflow: hidden`, and `text-overflow: ellipsis` to ensure single-line display.

**Engineering**

26. `npm run verify` green; every new harness registered and wired into CI.
27. No new inline `<script>`; the T-07 block's hash is regenerated in `worker.js`
    **and** `serve.cjs`, and the live header matches disk.
28. `css/mmgr.css` is only ever produced by `node build.js`.
29. No emoji on any served page.
30. No AI attribution footer in any commit.
31. `git status` shows no unexpected modified tracked file at any stage boundary
    (the owner's untracked documents are expected).

---

## 7. Re-baseline inventory (do not guess; run first)

| Harness | What it does today | When it moves |
|---|---|---|
| `tools/qa-consent.cjs:860-866` | finds `.ctl-sec` whose text starts with `Privacy`, clicks it | T-09 (Privacy becomes a tab) |
| `tools/qa-process.cjs:450-453` | finds `.ctl-sec` matching `/^Rules/`, clicks it | T-11 (Rules becomes a tab) |
| `tools/verify-controls-admin.cjs:245` | asserts `Copy As` **or** `Slack` **or** `Email` in `#db-ctrl` | probably never - the OR fallbacks survive T-10. Run it; only edit on a real failure. |
| `verify-controls-admin.cjs` S6 (`:303-345`) | drawer open/close/focus-mode exits | should not move; it uses ids and actions, not headings |
| `qa-marketing.cjs` mkt-03 | `cards.length === 15` | T-06 -> 16 |
| `tools/qa-bento-gate.cjs` | pool 15, sr list 15, `CARDS = 15`, `seen === 15` | T-06 -> 16 |
| `tools/qa-landing-ui.cjs` U-12 | `feat.cards === 15` | T-06 -> 16 |
| `tools/qa-copy-gate.cjs` | 9 checks over `index.html` + `js/marketing.js` | T-04 (scope) and T-06 (count) |
| `qa-full.cjs` MCP transport checks (`:2676-2691`) | dev-server MCP contract | untouched by this file; confirm still green at T-21 |
| `docs/CI-TEST-COVERAGE.md:88,90` | row text says 9 checks / 15-card pool | T-21 |

**Method for every re-baseline:** reproduce the failure locally, change the
assertion to the new contract, add a sentence to the commit body saying what
contract changed and why, and verify the new assertion in a browser. Never
delete a check to go green.

---

## 8. Gate matrix

| Gate | File | Proves | Job |
|---|---|---|---|
| MCP write path | `tools/qa-mcp-write-path.cjs` | empty/1/30/200 diffs, 500 cap, scope refusal, strict dates, envelope, weekly, 30-call mixed loop | `cloud-core` |
| MCP parity | `tools/qa-mcp-parity.cjs` | one registry, one executor, one pipeline, shared refusals | `cloud-auth` |
| MCP app-wide | `tools/qa-appwide-mcp.cjs` | OAuth/PKCE, token rotation, account gates, write path | `cloud-auth` |
| MCP admin | `tools/qa-mcp-admin.cjs` | account config, client revoke, project opt-out | `cloud-auth` |
| MCP budget | `tools/qa-mcp-budget.cjs` | budget read/propose switches, proposal-only writes | `cloud-core` |
| MCP keys | `tools/qa-api-keys.cjs` P12-P17 | section projection, budget switches | `cloud-core` |
| Copy counts | `tools/qa-copy-gate.cjs` (extended) | every served page agrees with the registry | `static` |
| Anchors | `tools/verify-navigation-anchors.cjs` (new) | every `#anchor` and dropdown id resolves | `static` |
| Feature registry | `tools/verify-feature-registry.cjs` (new) | `FEATURES` == index cards == features page == `NAV_DD` | `static` |
| Controls IA | `tools/qa-controls-ia.cjs` (new) | 6 groups, tabs, one panel visible, no orphan rows, no id renamed | `browser-app` |
| Search | `tools/qa-search.cjs` (new) | open/close, 8 queries, aliases, gating, keyboard, focus, zero network | `browser-app` |
| Collaboration layout | `tools/qa-team-collaboration.cjs` (new) | project names in the collaboration panel display as single lines, no vertical letter wrapping | `browser-app` |
| Controls existing | `tools/verify-controls-admin.cjs` | S4 text contract, S6 drawer exits | `cloud-core` |
| Consent | `tools/qa-consent.cjs` | Privacy toggle round-trip, CSP inventory | `cloud-core` |
| Rules | `tools/qa-process.cjs` | rules form + declared rule | `cloud-core` |
| Landing counts | `qa-marketing.cjs`, `tools/qa-bento-gate.cjs`, `tools/qa-landing-ui.cjs` | 16 cards, 15 panels | `static` / `browser-app` |
| Static | `npm run verify` | CSP, SW, CSS integrity, test registry | `static` |

A new harness means **three** edits: the file, the row in
`docs/CI-TEST-COVERAGE.md`, and a step in `ci.yml` or `extended-qa.yml`.

---

## 9. Prompt pack

Each prompt is self-contained enough to run in a fresh session. Run them in
order. Each ends with a verification step, because "done" without evidence is
not done.

### P1 - T-01 and T-02: prove the MCP repair live, then submit the correction

```
You are proving an already-committed MCP repair on the live site, then using it.

READ FIRST: UI-IA-AND-MCP-DIRECTIVE-2026-11-11.md T-00 to T-02,
docs/MCP-CONTRACT.md, docs/DEVELOPER-GUIDE.md.

FACTS: commits 2279930, 4de0faf and 5fcde08 repaired the project MCP write path
and unified the app-wide contract. Locally, qa-mcp-write-path is 20/20 and
qa-mcp-parity is 13/13. The live 1102 evidence predates those commits, so the fix
may simply not be deployed. mcp-correction-payload.json does NOT exist - rebuild
the diffs from live state; do not invent them.

DO
1. Re-run both MCP harnesses. Do not deploy on a red run.
2. Resolve the uncommitted css/mmgr.css first if T-00 is not done: regenerate
   from css/src and confirm verify-css-integrity ARM 0 is green.
3. Stage under $HOME (never /tmp), grep the staged server.js for a symbol that
   only exists in the fix, then wrangler deploy.
4. Probe live in the order listed in T-01. The decisive checks are:
   apply_changes {} -> isError (not 1102), 1 diff -> one receipt, 30 diffs ->
   one receipt, invalid targetDate -> tool error and the endpoint stays healthy,
   30 mixed calls -> zero 5xx. Do every write probe on a THROWAWAY project: the
   real project's queue must hold exactly one proposal - your correction.
5. Re-derive the correction: 11 tasks overdue and still todo, 8 risks with an
   empty description, 11 risks with an empty mitigation. Submit ONE apply_changes
   with a section-scoped key. Do not accept the proposal.

RULES: no test weakening, no key widening to pass a diff, no auto-apply, no AI
attribution in commits. If a live probe still 1102s, stop and report the probe,
the timestamp and the response body - do not paper over it.

DELIVERABLE: harness results, deploy version, each live probe result, p95 for the
mixed loop, proposal id + change count.
```

### P2 - T-03 to T-05: the truth pass

```
You are removing contradicting numbers from the served pages and building the
one registry everything else will use.

READ: this directive T-03, T-04, T-05; audit findings F10, F11.

FACTS: index.html and js/marketing.js say 15 panels. features.html says
"Eighteen panels" twice (86, 110). mymanager-field-guide.html says "18 panels"
three times (769, 814, 844) and "Sheets 32" (675) while shipping 36 sheet
sections. tools/qa-copy-gate.cjs scans index.html and js/marketing.js ONLY -
that is why CI never caught it.

DO
1. Add FEATURES to js/marketing.js next to NAV_DD, derived from the 15 existing
   index.html cards, with panel:true and detail:true where features.html has a
   block. PANEL_COUNT derives from it.
2. Point NAV_DD['index.html#features'] at FEATURES. Add the MCP entry to its
   Platform group.
3. Fix every count on features.html and the field guide. Where the sentence reads
   fine without a number, remove the number instead of replacing it.
4. Extend qa-copy-gate.cjs to scan every served page. Keep its 9 existing checks.
5. Add tools/verify-navigation-anchors.cjs and tools/verify-feature-registry.cjs,
   register both, wire both into the static job.
6. node build.js; npm run verify; run the gates.
7. Prove each gate can fail: remove one id and watch it go red, then restore.

RULES: do not invent a count. Do not delete a check to go green. No emoji.
Commit: fix(marketing): single source of truth for feature counts and anchors
```

### P3 - T-06: the landing MCP card

```
You are adding the MCP connector to the landing page and closing the gap between
the landing page and the features page.

READ: this directive T-06, and MCP-DIRECTIVE-2026-11-11.md section 7 (the card
markup is specified there verbatim).

FACTS: the landing page ships 15 cards. features.html ships 13 blocks with a
different id set - six landing ids have no block there (f-lookahead, f-health,
f-gonogo, f-meetings, f-claims, f-registers), while the nav dropdown already
links all six. features.html already covers MCP as #f-connect ("Open API & MCP
Server"), so the landing card #f-mcp must map to it, not duplicate it.

DO
1. Insert #f-mcp immediately after #f-ai, exactly as specified.
2. Add "Open MCP Server" to the motion-free #features-all list.
3. Add the MCP entry to the nav dropdown's Platform group, pointing at
   index.html#f-mcp.
4. Keep "15 panels" truthful; add the MCP clause to the intro sentence.
5. Do NOT change PANEL_COUNT. MCP is a connector, not a panel. Register it as
   { id:'f-connect', cardId:'f-mcp', panel:false, detail:true }.
6. Add the six missing .feature blocks to features.html, same ids, same labels as
   the cards and dropdown items.
7. Re-baseline the five card-count assertions in the SAME commit:
   qa-marketing mkt-03, qa-bento-gate (pool, sr list, CARDS/seen), qa-landing-ui U-12.
8. Update the stale "15 real .fcard nodes" comment in js/marketing.js.
9. Verify 1440/1280/768/390: rotation includes the new card, no layout shift, no
   duplicate id, #features-all reachable by keyboard.
10. Run the anchor and registry gates - every dropdown id must now resolve.

DO NOT add a second MCP section to features.html. DO NOT duplicate a feature to
make a count work.
Commit: feat(marketing): add the MCP card and match the features page to it
```

### P4 - T-07: extract the Controls accordion

```
You are moving the Controls accordion out of an inline CSP-hashed script into a
module, with ZERO visual change.

READ: this directive T-07 and section 4.2.

WHY: the accordion is inline at project.html:2587-2646 inside the block starting
at :2579. Every edit to it moves a CSP hash. Extract once.

DO
1. Create js/app/controls-nav.js (MMGR.AppControls) with init, toggle, setOpen,
   open, close, focus, current. Port the logic exactly: same caret, same
   max-height 260ms transition, same aria-expanded, same Enter/Space handling.
2. Replace ALWAYS_OPEN and the two hardcoded label comparisons with
   data-ctl-group / data-ctl-open="1" / data-ctl-static="1".
3. Delete ONLY the accordion IIFE (:2587-2646). The block still carries the icon
   guard, the service-worker registration and the sign-in backdrop - so its hash
   is REGENERATED, not removed. Update worker.js and the serve.cjs mirror.
4. Restart serve.cjs and prove the served header hashes match disk 1:1.
5. Add the module to APP_MODULES before js/mmgr-app.js; route the click through
   ACTION_MAP.
6. Run qa-consent and verify-controls-admin UNMODIFIED. Re-baseline only what
   genuinely fails, and say why in the commit body.
7. Screenshot matrix before and after: 1440/768/390, light and dark.

DO NOT merge any section yet. DO NOT rename any id.
Commit: refactor(project): extract the Controls accordion into a module
```

### P5 - T-08 to T-12: the 17-to-6 restructure

```
You are turning 18 flat Controls nodes into 6 topics with sub-tabs.

READ: this directive T-08 to T-12, audit findings F3 to F8.

SHIP ONE MERGE PER COMMIT, in this order:
T-08 Connect & Sync - also fixes Drive backup and Cloud backup rendering under
     the "Regular Terminal" heading (project.html:2077-2103), deletes the
     duplicated heading at js/mmgr-cloud.js:2998, and adds data-mcp-linked.
T-09 Your Data       - Privacy + Export + Backup & Transfer.
T-10 Share & Send    - Digests + Emails + Templates (Copy As. and Email Templates
     merge). Keep all 7 .fmt-card blocks and every Copy button.
T-11 Workspace       - Look & feel + Behaviour + Modules + Packs + Rules.
T-12 the shell       - 6 groups, drawer tab Features -> Guide, section
     Features -> Modules, Help group, Danger Zone under Help, ?ctl= deep link,
     tools/qa-controls-ia.cjs.

RULES
- Every render slot id in section 4.2 keeps its id and stays inside #db-ctrl.
- Panels toggle with [hidden]; every panel stays in the DOM.
- One panel visible per group. No nested accordion.
- Markup only for T-08 to T-11, plus the one renderMcp attribute line.
- Re-baseline qa-consent at T-09 and qa-process at T-11 onto data-ctl-group /
  data-ctl-tab. Run verify-controls-admin unmodified each time.
- Both themes, 1440/768/390, screenshot per commit.

Commit each: refactor(controls): <what merged>
```

### P6 - T-13 to T-16: search

```
You are adding one search palette to every surface of the app.

READ: this directive T-13 to T-16 and section 4.3; audit section 8.

BUILD js/app/search.js (MMGR.AppSearch) and css/src/36-search.css.

Index derived from the DOM on EVERY open, never cached and never hand-authored.
Sources: #sec-nav .sec-btn, #db-ctrl .ctl-sec[data-ctl-group], #db-ctrl .sr .sl,
#db-ctrl .fmt-card .fmt-title, .dtab, #db-feat .fi .fn, #db-qa .fi .fn,
#db-prompt [data-action=openPrompt], MMGR.Shortcuts, a 12-row PAGES table, a
36-row SHEETS table; on app/admin/calculator, that surface's own rail and cards.

MUST
1. Reveal, do not just navigate: open drawer -> pick tab -> expand group ->
   scrollIntoView -> flash the row.
2. Alias table including mcp / model context protocol / claude / cursor.
3. Gating through MMGR.Cloud.isClientSectionHidden (mmgr-render.js:1911).
   Pack off -> excluded, replaced by ONE "turn the pack on" result.
   Editor scope -> excluded, no substitute.
4. Ctrl/Cmd+K; arrows; Enter; Esc; focus restore. '/' stays the assistant.
5. One new row in js/mmgr-shortcuts.js, and expose the table as MMGR.Shortcuts
   (it is a private IIFE today, and it is absent on app.html and admin.html -
   guard every use).
6. Build the DOM in JS. Add NO inline script. Calculator gets its own script tag
   with a bumped ?v= because that page is not bundled.
7. Zero network requests while typing.
8. Add tools/qa-search.cjs; register and wire it.

DO NOT index project data. This finds UI, not content.
Commit: feat(search): one palette for every section, setting and page
```

### P7 - T-17 to T-20: the other surfaces

```
You are cleaning the calculator, the field guide, the admin panel and the
project nav labels.

READ: this directive T-17 to T-20; audit F12, F13, F14.

DO
1. calculator.html: merge History, Named estimates and Compare estimates into one
   "Saved estimates" card with [History] [Named] [Compare], reusing the page's
   own .bcp-tab pattern (:102-103). Keep every id and the calcCompare wiring.
   Bump js/calculator-page.js?v=.
2. mymanager-field-guide.html: remove the A-26 duplicate (:726 and :743), move
   A-34 into reading order, confirm "Sheets 32" is 36, rebalance the
   Projects & Admin group (12 items) at a natural seam.
3. admin.html: verify the rail's Cloud Admin link expands the closed
   <details id="operator-tools"> in three browsers; move the Premium indicator
   out of the Customize dropdown (:589-595).
4. Project nav: relabel the 7 groups to Overview, Plan, Money, Govern, Field,
   Close - labels only, no nesting, nothing moved that the label does not demand.

RULES: no id renames, no emoji, no new inline script, bump every ?v= you touch.
Commit per surface: refactor(calculator): ..., fix(guide): ..., fix(admin): ...,
refactor(nav): ...
```

### P8 - T-21 to T-24: gates, deploy, close-out

```
You are wiring the new gates into CI, deploying, and closing the loop.

READ: this directive T-21 to T-24, section 6, section 8.

DO
1. Register every new harness in docs/CI-TEST-COVERAGE.md; update the bento gate
   row (15 -> 16 cards) and the copy gate row (9 checks -> every page).
2. Wire the static gates into the static job and the browser gates into
   browser-app. No cross-job id: references. Prove with
   node tools/verify-ci-coverage.cjs.
3. Full local run: npm run verify, verify-test-registry, verify-css-integrity,
   and every gate in section 8.
4. Push, then poll the Actions API until the run completes. Fix the FIRST red
   step and re-run; steps after it are skipped, so there may be more than one.
5. Deploy from a staging copy under $HOME. Grep a new symbol in the staged file
   before wrangler deploy.
6. Live acceptance: every item in section 6, on the live site, in a browser.
   Include: offline palette, pack-off search, editor-scope search, 6 Controls
   groups, one MCP receipt for a 1-diff proposal, matching panel counts.
7. Close-out: owner accepts the T-02 proposal; re-read summary/tasks/risks/budget
   and confirm the correction landed; record the root cause and contract changes
   in PLANNING-TODO-2026-09-03.txt; update docs/MCP-CONTRACT.md; archive the old
   plan file with a pointer to this one.

Commit: ci: wire the UI IA, search and MCP gates
DELIVERABLE: green run URL, deploy version, acceptance table with evidence.
```

---

## 10. Risk register

| Risk | Likelihood | Blast radius | Mitigation |
|---|---|---|---|
| CSP hash drift after the T-07 edit | high if rushed | every page silently dead | regenerate `worker.js` + `serve.cjs`, restart the server, probe the live header 1:1 |
| Whole inline block deleted instead of the accordion | medium | icon guard, SW registration and sign-in backdrop vanish | delete only `:2587-2646`; check the block still has its other three jobs |
| `css/mmgr.css` hand-edited (already modified in the tree) | medium now | integrity gate red, rules silently dropped | T-00 resolves it before any build |
| A render slot id renamed during reparenting | medium | one Control silently stops rendering | `qa-controls-ia` asserts every id and every render |
| Search becomes a gate bypass | medium | scope leak | call the existing guard; the gate asserts an editor code cannot find an out-of-grant section |
| Index goes stale after a pack toggle | low | wrong results | rebuild on every open; no cache, no event subscription |
| Harness re-baseline hides a regression | medium | silent break | re-baseline in the same commit, reason in the body, browser-verified |
| Stale `dist/bundle.js` during testing | high | "the fix did nothing" | `node build.js` then grep the bundle for a new symbol |
| Calculator `?v=` not bumped | medium | returning users keep old JS for a year | bump on every calculator asset change |
| T-06 drift: 16 cards re-baselined but `PANEL_COUNT` changed too | medium | copy gate and landing agree on the wrong number | `panel:false` for `f-mcp`; assert 16 cards / 15 panels in the gate |
| Live MCP still fails after deploy | medium | T-02 blocked again | T-01 stops and reports the probe; do not attempt the correction on a failing endpoint |
| Scope creep into project-data search | medium | a second, worse `#ps-modal` | out of scope by rule 4; the palette may surface project rows only through the existing `#ps-modal` path |
| `qa-shortcuts.cjs` breaks when the table gains a row | medium | gate red | run it at T-14; if it counts rows exactly, re-baseline to the new count and say why |

---

## 11. Rollout and rollback

**Order:** T-00 baseline -> T-01 deploy/prove -> T-02 submit -> T-03..T-06 truth
-> T-07..T-12 controls -> T-13..T-16 search -> T-17..T-20 other surfaces ->
T-21 gates/CI -> T-22 deploy -> T-23 acceptance/close-out -> T-24 collaboration layout fix.

**Staging:**

```bash
node build.js
npm run verify
STAGE="$HOME/mmgr-deploy"
rm -rf "$STAGE" && mkdir -p "$STAGE"
tar --exclude='.git' --exclude='.wrangler' --exclude='node_modules' \
  --exclude='.agents' --exclude='_archive' --exclude='tmp' -cf - . | tar -xf - -C "$STAGE"
grep -c "MMGR.AppSearch" "$STAGE/js/app/search.js"   # must be >= 1
cd "$STAGE" && npx wrangler deploy
```

**Rollback:** revert the Worker version. The UI stages carry no state migration
and no schema change; D1 and R2 are untouched. The T-02 proposal stays queued and
is rejectable without side effects.

---

## 12. Approvals (granted 2026-11-12)

All decisions below are the owner's, recorded so a later session does not re-ask
them. Items 1-7 are approved as written.

| # | Decision | State |
|---|---|---|
| 1 | **Deploy and prove before any UI change.** Stage 1 (T-01, T-02) completes and is verified live before Stage 2 begins. | APPROVED |
| 2 | **Extract the Controls accordion before any Controls merge.** Everything else gets out of the way first, then T-07, then the merges. | APPROVED |
| 3 | **The six group names:** You & Access, Workspace, Connect & Sync, Share & Send, Your Data, Help. Renaming them later is expected and harmless - they are labels, not contracts. | APPROVED |
| 4 | **"Connect an AI"** as the merged label, halves called "Cloud (HTTP)" and "This computer (terminal)". | APPROVED |
| 5 | **Search scope is UI only.** Never project data; project names keep their existing path. | APPROVED |
| 6 | **Selecting a result opens what needs to be opened.** Section, drawer tab, group, row - the palette reveals the target, it does not just navigate near it. | APPROVED |
| 7 | **`Ctrl/⌘+K`** opens search. `/` stays the assistant. A visible search button ships on every surface, so the key is optional for the user. | APPROVED |
| 8 | **T-02 is submitted and waits** for the owner's acceptance; it is never auto-applied. | APPROVED |

Because of statement 1, the stage boundaries in section 11 are hard gates: a
stage does not start until the previous one is green locally **and** observed
working on the live site.

---

## 13. Evidence and artefacts

| Artefact | Role |
|---|---|
| `UI-IA-AUDIT-2026-11-11.md` | findings F1-F15 with line-level evidence; the audit behind T-03 to T-20 |
| `UI-IA-IMPLEMENTATION-PLAN-2026-11-11.md` | superseded by this file; archive at T-23 |
| `MCP-DIRECTIVE-2026-11-11.md` | the MCP contract of record; sections 3-6 and 8-11 already implemented |
| `docs/MCP-CONTRACT.md` | the live two-endpoint contract note; parity rules |
| `docs/CI-TEST-COVERAGE.md` | every harness with a status token; T-21 updates it |
| `docs/DEVELOPER-GUIDE.md` | module map and load order; read before touching `js/` |
| `tmp/baseline-2026-11-11.txt` | the T-00 baseline capture (repo `tmp/`, never `/tmp`) |

**Live MCP evidence (2026-11-12T03:12:37Z, before the fix commit):**
`apply_changes` returned Cloudflare 1102 for 30 diffs, 1 diff and `{}`;
`get_budget`, `get_weekly_summary` and `get_table` also 1102'd;
`get_proposal_status` (D1 only) always worked. That asymmetry is the reason the
fix targeted per-diff overhead rather than payload size - see
`MCP-DIRECTIVE-2026-11-11.md` section 2.

**Verified today:** `qa-mcp-write-path` 20/20, `qa-mcp-parity` 13/13. The repair
is real; it is not yet proven in production.
