# Kanban Board Mechanics Implementation Plan

> **For the executing agent:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` to implement this plan task-by-task. Work in a fresh branch, one task per commit, and stop at every **Checkpoint** until the user confirms.

**Goal:** Turn the My MaNaGeR Kanban view from a status board into a working Kanban board by borrowing the mechanics Kanboard gets right, without importing Kanboard, its PHP, its database, or its server model.

**Architecture:** A new pure model module (`js/mmgr-kanban.js`) owns order, WIP limits, filters, lanes, and flow metrics. `js/render/kanban.js` keeps owning markup and reads the model. `js/mmgr-app.js` keeps owning event delegation and drag/drop, and calls the model instead of writing `task.status` directly. Shared board settings live in `state.kanban` (schema v23); per-card order lives on `task.boardPosition`. Filters stay in module memory and never become a storage key.

**Tech stack:** Vanilla browser JS on the existing `window.MMGR` namespace (IIFEs, no bundler imports), `esbuild` concatenation in `build.js`, `node:test` for the model tests, Playwright for the browser gate, and the existing service-worker shell.

**Reference version:** Kanboard `v1.2.54-13` at commit `ec3398d0`. The Kanboard checkout is read-only reference material. Do not copy PHP, CSS, templates, or SQL into My MaNaGeR.

**Written against:** My MaNaGeR schema v22 (`SCHEMA_VERSION = 22`), 55-module project bundle, `sw.js` cache `mmgr-shell-v471`. If the tree has moved on, the quoted anchors are still the contract; only surrounding line numbers move.

---

## 1. Why this plan exists

My MaNaGeR already draws a Kanban view, but it is a status board, not a working board:

- It counts cards in a column, but a count is not a WIP limit. Nothing turns red, nothing warns, and the number has no target.
- Cards inside a column cannot be ordered. Column order is whatever order the WBS array happens to be in, so a card jumps around when any task is edited.
- There are no board filters. Finding "Sam's overdue cards" means leaving the board for the WBS table.
- Cards are read-only. Every edit means switching to the WBS tab and finding the row.
- Dropping a card into Completed does **not** stamp `completedDate`, so a drag-completed task is invisible to completion metrics and to the Daily Field snapshot.
- There are no swimlanes, so a 60-card board is one undifferentiated wall.
- There are no flow metrics, so the board cannot answer "how long does work take here".
- There are no keyboard moves, so the board cannot be run without a mouse.

Kanboard solves all of these in a small, well-factored way. This plan borrows the mechanics, not the implementation.

---

## 2. What to borrow from Kanboard, and what not to borrow

| Kanboard mechanic | Where Kanboard does it | What My MaNaGeR should do | Task |
|---|---|---|---|
| Per-column task limit, `0` = unlimited, soft warning not a hard block | `app/Model/BoardModel.php:40`, `app/Template/board/table_column.php:113-114`, `table_tasks.php:6` | `state.kanban.wip[status]`, header reads `count / limit`, column gets an over-limit class and a warning toast. Moves are never blocked. | 2 |
| Explicit position inside a column and swimlane | `app/Model/TaskPositionModel.php:66` | `task.boardPosition` integer, renumbered on every move, drag inserts at the pointer, keyboard moves by one slot | 3 |
| Board filters (assignee, due date, category, status) | `app/Filter/TaskAssigneeFilter.php`, `TaskDueDateFilter` family | Ephemeral board filter bar: text, assignee, due, flag. Never persisted. | 4 |
| Task detail modal over the board | `app/Template/task/show.php`, `details.php` | In-place card sheet using the existing `updTaskField` action | 5 |
| Swimlanes grouped by assignee or project | `app/Template/board/table_swimlane.php`, `SwimlaneModel` | Derived lanes: none, assignee, or parent phase. No new lane entity, no new table. | 6 |
| Lead time and cycle time analytics | `app/Model/TaskAnalyticModel.php:22,34`, `analytic/lead_cycle_time.php` | Footer strip computed from `createdDate`, `startedDate`, `completedDate` | 7 |
| Quick add card directly in a column | Kanboard "Add a new task" inline form | Inline quick add with `@assignee` and `due:YYYY-MM-DD` shorthand | 3 |
| Column collapse, close all, subtasks, comments, file attachments, categories, projects, users, permissions, database | Kanboard server features | **Do not borrow.** My MaNaGeR has no server, no multi-user board model, and already has WBS phases, notes, and comments. | none |

**Hard rule:** `state.kanban` holds only board configuration. It never holds a copy of task data. `task.boardPosition` is the only new per-task field that the board owns.

---

## 3. Architecture

```
project.html
  Kanban panel markup (filters, board, WIP modal, card sheet)
        |
        v
js/mmgr-app.js  (delegation, drag/drop, keyboard, sheet open/close)
        |  calls MMGR.Kanban
        v
js/mmgr-kanban.js  (pure model: order, limits, filters, lanes, metrics)
        ^
        |  reads state / returns view data
js/render/kanban.js  (markup only: cards, columns, lanes, footer)
        |
        v
js/mmgr-state.js  (schema v23, migration, default state, FIELD_KEYS)
```

**Why a separate model module:**

1. The board rules become testable in Node without a browser or IndexedDB.
2. `render/kanban.js` stops owning filtering and ordering logic that it currently duplicates.
3. Future board features (saved filters, per-lane limits) have one place to land.
4. The module loads before the domain modules, so `mmgr-tasks.js` can call `MMGR.Kanban.stampStatus` without a cycle.

**Load order:** insert `js/mmgr-kanban.js` immediately after `js/mmgr-utils.js` in three places:

- `build.js` -> `APP_MODULES`
- `project.html` -> dev-fallback module list (inside the inline script, so CSP hashes must be regenerated)
- `sw.js` -> is **not** needed: the service worker caches `dist/bundle.js`, not individual modules. Confirm with `grep -n "mmgr-kanban" sw.js`; it should return nothing.

**No new storage key.** `state.kanban` rides inside the project state object, so localStorage, IndexedDB journal, cloud sync, export, and import all carry it with no changes beyond `FIELD_KEYS`.

---

## 4. Global constraints

Read these before Task 1. They apply to every task.

1. **Offline first.** No network call, no external font, no CDN, no new dependency. Everything must work from `dist/bundle.js`.
2. **View-only stays view-only.** Every new mutating action must be blocked by `guardReadonly()`. Every read-only action must be added to `READONLY_SAFE_ACTIONS`, or the board becomes unusable in a share-code session. Drag and keyboard moves also need the explicit `isReadonly()` guards that `dragCard` and `dropCard` already carry, because those listeners are document-level and bypass delegation.
3. **No new inline script with logic.** Adding a file to the dev-fallback array changes the inline script, so run `node tools/regen-csp-hashes.cjs` and commit the `worker.js` + `serve.cjs` changes in the same commit.
4. **CSP-safe DOM.** No `innerHTML` with unescaped project data. Card names, assignees, notes, and lane labels go through `U.escapeHtml` or `textContent`. The local ESLint rule `no-unsanitized-html` treats violations as errors.
5. **No emoji, no em or en dashes in served copy.** Use plain hyphens, commas, or full stops. This applies to toasts, labels, aria-labels, and field-guide prose.
6. **Prettier owns JS and CSS.** `npm run verify` includes `verify:prettier`. Run `npx prettier --write` on every touched `.js` and `.css` file before committing. HTML is excluded on purpose (reformatting it would break CSP hashes).
7. **ESLint warning ceiling.** The repo runs with a frozen warning ceiling (about 4600, roughly 81 spare). New code must add **zero** warnings. Avoid unused vars, `==`, and missing braces.
8. **Rebuild before browser QA.** `node build.js` after any `js/` change. The browser loads `dist/bundle.js`, not the source.
9. **Bump the service worker on every task.** After the build, bump `CACHE = 'mmgr-shell-v471'` to the next number in `sw.js`. `npm run verify:sw` fails if a shell asset is newer than `sw.js` beyond a 30 second grace window. Each task below builds, bumps, then verifies; include `sw.js` in that task's commit. Task 8 bumps it one last time after the final build.

**Build ritual for every task:**

```bash
node build.js
# bump CACHE in sw.js by one integer
npm run verify
```

Running `npm run verify` without the bump may pass inside the 30 second grace window and then fail on the next run, which looks like a flake. Always bump, then verify.
10. **Every new `data-action` needs a handler in `ACTION_MAP`.** `tools/verify-actions.cjs` fails on unanswered actions. It is not part of `npm run verify`, so run it explicitly.
11. **Every new select or text input action needs a whitelist entry.** Change events are whitelisted around `js/mmgr-app.js:5395`, input events around `:5458`. A missing entry means the handler silently never fires.
12. **Keep render exports stable.** `js/render/kanban.js` must keep exporting exactly `kanbanCard`, `kanbanLeadtimeCard`, and `renderKanban`. `tools/verify-render-exports.cjs` and the `mmgr-render.js` wrapper depend on that shape. Put new board DOM code in `mmgr-app.js`, not in a fourth render export.
13. **One commit per task.** Conventional Commits, no AI attribution, no `Co-Authored-By`.

**Baseline before starting:**

```bash
npm ci
node build.js
npm run verify
node tools/verify-actions.cjs
node tools/verify-render-exports.cjs
```

All four must pass on a clean tree. If they do not, stop and report; do not build this plan on a red baseline.

---

## 5. Definition of done

- [ ] `node --test test/kanban-model.test.mjs` passes (new file, 12 tests).
- [ ] `node tools/qa-kanban.cjs` passes against `node serve.cjs` on port 8765 (new file, 16 gates).
- [ ] `npm run verify` passes.
- [ ] `node tools/verify-actions.cjs` passes.
- [ ] `node tools/verify-render-exports.cjs` passes.
- [ ] A 390 px wide viewport still shows one readable column at a time with no horizontal page scroll.
- [ ] A view-only share session can open cards and filters but cannot move, add, or edit anything.
- [ ] `docs/CI-TEST-COVERAGE.md` lists the new harness and `.github/workflows/ci.yml` runs it in T4.
- [ ] `mymanager-field-guide.html` A-05 describes the new board in plain language.
- [ ] `docs/DEVELOPER-GUIDE.md` module map lists `js/mmgr-kanban.js`.

---

## Task 1: Board model and schema v23

**Files:**
- Create: `js/mmgr-kanban.js`
- Create: `test/kanban-model.test.mjs`
- Modify: `js/mmgr-state.js` (default state, typedef block, migration 23, `SCHEMA_VERSION`, `FIELD_KEYS`)
- Modify: `build.js` (`APP_MODULES`)
- Modify: `project.html` (dev-fallback list)
- Modify: `js/mmgr-tasks.js` (`addTask` seeds `createdDate` and `boardPosition`)
- Modify: `js/render/kanban.js` (delegate `isWorkItem` and ordering to the model)
- Modify: `docs/DEVELOPER-GUIDE.md` (module map row)

**Why:** Every later task needs the same definitions of "a card", "the order", and "the limit". Putting them in one pure module keeps the renderer dumb and makes the rules testable without a browser.

### Step 1: Extend the default state

In `js/mmgr-state.js`, `getDefaultState()`, next to the existing `kbShowLeadtime: false,` line (around line 308), add:

```js
      // Kanban board mechanics (schema v23). Shared, persisted board
      // configuration only: per-column WIP limits and the lane grouping.
      // 0 means "no limit", matching Kanboard's task_limit convention.
      kanban: {
        wip: { todo: 0, inprogress: 0, blocked: 0, completed: 0 },
        swimlane: 'none'
      },
```

Keep `kbShowLeadtime` where it is. It stays the on/off switch for the Lead-Time lane; do not fold it into `kanban`.

The typedef block at the top of the same file is the canonical state shape, so keep it true. In the `Task` typedef, add:

```js
 * @property {string} [createdDate]   - YYYY-MM-DD, set when the card is created
 * @property {number} [boardPosition] - explicit Kanban slot inside the status column
```

Add a board-settings typedef next to it:

```js
/**
 * @typedef {Object} KanbanSettings
 * @property {Object} wip - per-column soft limits; 0 means unlimited
 * @property {number} wip.todo
 * @property {number} wip.inprogress
 * @property {number} wip.blocked
 * @property {number} wip.completed
 * @property {string} swimlane - 'none'|'assignee'|'parent'
 */
```

### Step 2: Add migration 23

In `js/mmgr-state.js`, change `const SCHEMA_VERSION = 22;` to `23`.

In the `migrations` object (starts around line 419), add the new migration **above** the `22:` entry so the file stays in descending order:

```js
    23: function (state) {
      // V22 -> V23: Kanban board mechanics. Additive and lossless:
      // - state.kanban carries column WIP limits and the lane mode.
      // - task.boardPosition gives every existing card a stable slot,
      //   seeded from the current WBS array order so no board reshuffles
      //   on the upgrade.
      // No task is deleted, renamed, or re-statused.
      if (!state.kanban || typeof state.kanban !== 'object') {
        state.kanban = {};
      }
      if (!state.kanban.wip || typeof state.kanban.wip !== 'object') {
        state.kanban.wip = {};
      }
      const columns = ['todo', 'inprogress', 'blocked', 'completed'];
      columns.forEach(function (key) {
        const n = parseInt(state.kanban.wip[key], 10);
        state.kanban.wip[key] = n > 0 ? n : 0;
      });
      if (state.kanban.swimlane !== 'assignee' && state.kanban.swimlane !== 'parent') {
        state.kanban.swimlane = 'none';
      }
      if (Array.isArray(state.tasks)) {
        const next = {};
        state.tasks.forEach(function (t) {
          if (!t || typeof t !== 'object') {
            return;
          }
          const st = t.status || 'todo';
          if (typeof t.boardPosition === 'number' && isFinite(t.boardPosition)) {
            next[st] = Math.max(next[st] === undefined ? -1 : next[st], t.boardPosition);
          }
        });
        state.tasks.forEach(function (t) {
          if (!t || typeof t !== 'object') {
            return;
          }
          const st = t.status || 'todo';
          if (typeof t.boardPosition !== 'number' || !isFinite(t.boardPosition)) {
            next[st] = (next[st] === undefined ? -1 : next[st]) + 1;
            t.boardPosition = next[st];
          }
        });
      }
      return state;
    },
```

**Why two passes:** the first pass records the highest existing position per status, the second gives every card without one the next free slot. That keeps the migration idempotent and collision-free even if a future import already carries positions.

### Step 3: Register the new state key for sync

In `js/mmgr-state.js`, `FIELD_KEYS` (around line 1110), add `'kanban'` directly after `'tasks'`:

```js
    'tasks',
    'kanban',
    'meetings',
```

`FIELD_KEYS` is what field-level cloud merge uses to decide which top-level keys can be merged independently. Without this entry, a cloud pull could drop the board settings.

### Step 4: Wire the module into the build and the dev fallback

In `build.js`, inside `APP_MODULES`, add the file after `js/mmgr-utils.js` and before `js/mmgr-net.js`:

```js
  'js/mmgr-state.js',
  'js/mmgr-utils.js',
  // Kanban board model. Must load before the renderer and the domain
  // modules, because both read MMGR.Kanban at call time.
  'js/mmgr-kanban.js',
  'js/mmgr-net.js',
```

In `project.html`, inside the dev-fallback inline array (around line 2042), add the same path in the same position:

```js
  ['js/mmgr-state.js','js/mmgr-utils.js','js/mmgr-kanban.js','js/mmgr-net.js','js/consent.js',
```

That edit changes an inline `<script>` block. After it, run:

```bash
node tools/regen-csp-hashes.cjs
node tools/verify-csp-hashes.cjs
```

Commit the regenerated `worker.js` and `serve.cjs` in this task's commit.

### Step 5: Seed new tasks

In `js/mmgr-tasks.js`, `addTask()`, add `createdDate` and `boardPosition` to the pushed object. `createdDate` is needed by Task 7; `boardPosition` keeps a new card at the bottom of its column.

```js
      s.tasks.push({
        id: U.genId('t'),
        name: 'New Task',
        level: 0,
        indent: 0,
        isPhase: false,
        status: 'todo',
        startDate: '',
        endDate: '',
        duration: '',
        assignee: '',
        critical: false,
        leadTime: false,
        recurring: false,
        weatherExposed: false,
        confidence: 'high',
        predecessors: [],
        notes: '',
        weatherSensitive: false,
        // V23: cards sort by an explicit slot, and flow metrics need a
        // creation date that is not guessed later.
        createdDate: U.todayStr(),
        boardPosition: ns.Kanban ? ns.Kanban.nextPosition(s.tasks, 'todo') : 0
      });
```

Then rebuild and confirm the module is in the bundle:

```bash
node build.js --app
node -e "const fs=require('fs');const b=fs.readFileSync('dist/bundle.js','utf8');console.log(b.includes('MMGR.Kanban'));"
```

Expected: `true`.

### Step 6: Create the pure model module

Create `js/mmgr-kanban.js`. The module must not touch the DOM, `localStorage`, or `IndexedDB` at load, so the Node test can run it in a `vm` sandbox. This is the whole file:

```js
/* ============================================================
   My MaNaGeR, Kanban board model
   ------------------------------------------------------------
   The board rules live here, once:
     - card membership and order inside a status column
     - WIP limits (0 = unlimited, warnings never block a move)
     - the ephemeral filter set
     - derived swimlanes
     - lead and cycle time

   Every function takes the state object it should read, so this
   file is pure enough to load in Node without a browser. The only
   module-level mutable value is the filter set, which is
   deliberately ephemeral: filters must never become a storage key.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const COLUMNS = ['todo', 'inprogress', 'blocked', 'completed'];
  const LABELS = {
    todo: 'To Do',
    inprogress: 'In Progress',
    blocked: 'Blocked',
    completed: 'Completed'
  };
  const DAY = 86400000;

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function todayStr() {
    if (ns.Utils && ns.Utils.todayStr) {
      return ns.Utils.todayStr();
    }
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function dayDiff(a, b) {
    if (!a || !b) {
      return null;
    }
    const da = new Date(a + 'T00:00:00');
    const db = new Date(b + 'T00:00:00');
    if (isNaN(da.getTime()) || isNaN(db.getTime())) {
      return null;
    }
    return Math.round((da - db) / DAY);
  }

  function defaultSettings() {
    return {
      wip: { todo: 0, inprogress: 0, blocked: 0, completed: 0 },
      swimlane: 'none'
    };
  }

  function ensureSettings(state) {
    if (!state) {
      return defaultSettings();
    }
    if (!state.kanban || typeof state.kanban !== 'object') {
      state.kanban = defaultSettings();
    }
    if (!state.kanban.wip || typeof state.kanban.wip !== 'object') {
      state.kanban.wip = {};
    }
    COLUMNS.forEach(function (key) {
      const n = parseInt(state.kanban.wip[key], 10);
      state.kanban.wip[key] = n > 0 ? n : 0;
    });
    if (state.kanban.swimlane !== 'assignee' && state.kanban.swimlane !== 'parent') {
      state.kanban.swimlane = 'none';
    }
    return state.kanban;
  }

  function wipLimit(state, status) {
    const wip = state && state.kanban && state.kanban.wip;
    const n = wip ? parseInt(wip[status], 10) : 0;
    return n > 0 ? n : 0;
  }

  // A "card" is a work item. Phases and rollup parents are schedule
  // scaffolding, not work, and the old renderer already excluded them.
  function isWorkItem(task, rollups) {
    if (!task) {
      return false;
    }
    if (task.isPhase) {
      return false;
    }
    return !((task.level || 0) === 0 && rollups && rollups[task.name]);
  }

  function workItems(state) {
    const tasks = (state && state.tasks) || [];
    const rollups = {};
    tasks.forEach(function (t) {
      if (t && t.parentName) {
        rollups[t.parentName] = 1;
      }
    });
    return tasks.filter(function (t) {
      return isWorkItem(t, rollups);
    });
  }

  function positionOf(task) {
    if (task && typeof task.boardPosition === 'number' && isFinite(task.boardPosition)) {
      return task.boardPosition;
    }
    return Number.MAX_SAFE_INTEGER;
  }

  function nextPosition(tasks, status) {
    let max = -1;
    (tasks || []).forEach(function (t) {
      if (!t || (t.status || 'todo') !== status) {
        return;
      }
      const p = positionOf(t);
      if (p !== Number.MAX_SAFE_INTEGER && p > max) {
        max = p;
      }
    });
    return max + 1;
  }

  function normalizePositions(state) {
    const tasks = (state && state.tasks) || [];
    const next = {};
    tasks.forEach(function (t) {
      if (!t) {
        return;
      }
      const st = t.status || 'todo';
      if (typeof t.boardPosition === 'number' && isFinite(t.boardPosition)) {
        next[st] = Math.max(next[st] === undefined ? -1 : next[st], t.boardPosition);
      }
    });
    tasks.forEach(function (t) {
      if (!t) {
        return;
      }
      const st = t.status || 'todo';
      if (typeof t.boardPosition !== 'number' || !isFinite(t.boardPosition)) {
        next[st] = (next[st] === undefined ? -1 : next[st]) + 1;
        t.boardPosition = next[st];
      }
    });
    return state;
  }

  function sortedColumn(state, status) {
    const indexed = [];
    workItems(state).forEach(function (t, i) {
      if ((t.status || 'todo') === status) {
        indexed.push({ t: t, i: i });
      }
    });
    indexed.sort(function (a, b) {
      const pa = positionOf(a.t);
      const pb = positionOf(b.t);
      if (pa !== pb) {
        return pa - pb;
      }
      return a.i - b.i;
    });
    return indexed.map(function (x) {
      return x.t;
    });
  }

  function renumber(tasks, status) {
    tasks
      .filter(function (t) {
        return t && (t.status || 'todo') === status;
      })
      .sort(function (a, b) {
        return positionOf(a) - positionOf(b);
      })
      .forEach(function (t, i) {
        t.boardPosition = i;
      });
  }

  function moveTo(state, id, status, beforeId) {
    if (!state || !Array.isArray(state.tasks) || COLUMNS.indexOf(status) === -1) {
      return { changed: false };
    }
    const task = state.tasks.find(function (t) {
      return t && t.id === id;
    });
    if (!task) {
      return { changed: false };
    }
    const from = task.status || 'todo';
    const original = sortedColumn(state, status);
    const originalIndex = original.findIndex(function (t) {
      return t.id === id;
    });
    const siblings = original.filter(function (t) {
      return t.id !== id;
    });
    let at = siblings.length;
    if (beforeId) {
      const found = siblings.findIndex(function (t) {
        return t.id === beforeId;
      });
      if (found > -1) {
        at = found;
      }
    }
    siblings.splice(at, 0, task);
    siblings.forEach(function (t, i) {
      t.boardPosition = i;
    });
    task.status = status;
    if (from !== status) {
      renumber(state.tasks, from);
    }
    return {
      changed: from !== status || at !== originalIndex,
      from: from,
      to: status,
      index: at
    };
  }

  // Move one slot inside the current column. delta -1 is up, +1 is down.
  // Returns changed:false at the edges so a keyboard handler can stay quiet.
  function moveBy(state, id, delta) {
    if (!state || !Array.isArray(state.tasks)) {
      return { changed: false };
    }
    const task = state.tasks.find(function (t) {
      return t && t.id === id;
    });
    if (!task) {
      return { changed: false };
    }
    const status = task.status || 'todo';
    const column = sortedColumn(state, status);
    const at = column.findIndex(function (t) {
      return t.id === id;
    });
    const target = at + delta;
    if (at < 0 || target < 0 || target >= column.length) {
      return { changed: false };
    }
    column.splice(at, 1);
    column.splice(target, 0, task);
    column.forEach(function (t, i) {
      t.boardPosition = i;
    });
    return { changed: true, from: status, to: status, index: target };
  }

  // Status transitions own their date stamps. One helper, so a drag, a
  // select, a keyboard move, and a WBS edit can never disagree.
  function stampStatus(task, status, today) {
    if (!task) {
      return task;
    }
    const day = today || todayStr();
    task.status = status;
    task.statusSince = day;
    if (status === 'inprogress' && !task.startedDate) {
      task.startedDate = day;
    }
    if (status === 'completed') {
      if (!task.completedDate) {
        task.completedDate = day;
      }
    } else if (task.completedDate) {
      delete task.completedDate;
    }
    return task;
  }

  function wip(state, status) {
    const limit = wipLimit(state, status);
    const count = workItems(state).filter(function (t) {
      return (t.status || 'todo') === status;
    }).length;
    return {
      count: count,
      limit: limit,
      over: limit > 0 && count > limit,
      remaining: limit > 0 ? Math.max(0, limit - count) : null
    };
  }

  // ---- Filters (ephemeral: module memory only, never persisted) ----
  const FILTER_DEFAULTS = { text: '', assignee: '', due: '', flag: '' };
  let filters = { text: '', assignee: '', due: '', flag: '' };

  function getFilters() {
    return {
      text: filters.text,
      assignee: filters.assignee,
      due: filters.due,
      flag: filters.flag
    };
  }

  function setFilters(patch) {
    if (!patch) {
      return getFilters();
    }
    if (patch.text !== undefined) {
      filters.text = String(patch.text);
    }
    if (patch.assignee !== undefined) {
      filters.assignee = String(patch.assignee);
    }
    if (patch.due !== undefined) {
      filters.due = String(patch.due);
    }
    if (patch.flag !== undefined) {
      filters.flag = String(patch.flag);
    }
    return getFilters();
  }

  function clearFilters() {
    filters = { text: '', assignee: '', due: '', flag: '' };
    return getFilters();
  }

  function filtersActive() {
    return !!(filters.text || filters.assignee || filters.due || filters.flag);
  }

  function matchTask(task, f, today) {
    if (!task) {
      return false;
    }
    const set = f || FILTER_DEFAULTS;
    const day = today || todayStr();
    if (set.text) {
      const hay = (
        (task.name || '') +
        ' ' +
        (task.assignee || '') +
        ' ' +
        (task.notes || '') +
        ' ' +
        (task.id || '')
      ).toLowerCase();
      if (hay.indexOf(set.text.toLowerCase()) === -1) {
        return false;
      }
    }
    if (set.assignee && (task.assignee || '') !== set.assignee) {
      return false;
    }
    if (set.flag === 'critical' && !task.critical) {
      return false;
    }
    if (set.flag === 'lead' && !task.leadTime) {
      return false;
    }
    if (set.flag === 'milestone' && !task.milestone) {
      return false;
    }
    if (set.flag === 'recurring' && !task.recurring) {
      return false;
    }
    if (set.due === 'overdue') {
      if (task.status === 'completed' || !task.endDate) {
        return false;
      }
      const d = dayDiff(task.endDate, day);
      if (d === null || d >= 0) {
        return false;
      }
    }
    if (set.due === 'week') {
      const d = dayDiff(task.endDate, day);
      if (d === null || d < 0 || d > 7) {
        return false;
      }
    }
    if (set.due === 'none' && task.endDate) {
      return false;
    }
    return true;
  }

  function columnTasks(state, status, override, today) {
    const set = override || getFilters();
    const day = today || todayStr();
    return sortedColumn(state, status).filter(function (t) {
      return matchTask(t, set, day);
    });
  }

  function counts(state) {
    const out = { todo: 0, inprogress: 0, blocked: 0, completed: 0 };
    workItems(state).forEach(function (t) {
      const st = t.status || 'todo';
      if (out[st] !== undefined) {
        out[st] += 1;
      }
    });
    return out;
  }

  // ---- Derived swimlanes ----
  // A lane is a view over the same cards, never a second copy. `mode` is
  // persisted in state.kanban.swimlane; the grouping itself is derived.
  function laneGroups(tasks, mode) {
    if (!mode || mode === 'none') {
      return [{ key: 'all', label: '', tasks: (tasks || []).slice() }];
    }
    const map = {};
    const order = [];
    (tasks || []).forEach(function (t) {
      const key = mode === 'assignee' ? t.assignee || 'Unassigned' : t.parentName || 'No phase';
      if (!map[key]) {
        map[key] = [];
        order.push(key);
      }
      map[key].push(t);
    });
    order.sort(function (a, b) {
      const aLast = a === 'Unassigned' || a === 'No phase';
      const bLast = b === 'Unassigned' || b === 'No phase';
      if (aLast !== bLast) {
        return aLast ? 1 : -1;
      }
      return a.localeCompare(b);
    });
    return order.map(function (key) {
      return { key: key, label: key, tasks: map[key] };
    });
  }

  // ---- Flow metrics ----
  // Same definitions as Kanboard's TaskAnalyticModel:
  //   lead  = createdDate  -> completedDate
  //   cycle = startedDate  -> completedDate
  // Tasks missing a date are skipped, not guessed, and the sample count is
  // returned so the UI can say what the average is based on.
  function flow(state) {
    const done = workItems(state).filter(function (t) {
      return (t.status || 'todo') === 'completed';
    });
    let lead = 0;
    let leadN = 0;
    let cycle = 0;
    let cycleN = 0;
    done.forEach(function (t) {
      // Only a recorded completion counts. Guessing "today" for a migrated
      // card would quietly inflate the average it is supposed to report.
      const end = t.completedDate || '';
      if (t.createdDate && end) {
        const d = dayDiff(end, t.createdDate);
        if (d !== null) {
          lead += d;
          leadN += 1;
        }
      }
      if (t.startedDate && end) {
        const d = dayDiff(end, t.startedDate);
        if (d !== null) {
          cycle += d;
          cycleN += 1;
        }
      }
    });
    return {
      completed: done.length,
      leadSamples: leadN,
      cycleSamples: cycleN,
      avgLead: leadN ? Math.round(lead / leadN) : null,
      avgCycle: cycleN ? Math.round(cycle / cycleN) : null
    };
  }

  // ---- Quick add ----
  // "Fix door @Sam due:2026-11-01" -> name, assignee, endDate.
  // Everything is optional; an empty or whitespace-only line returns null.
  function parseQuickAdd(text) {
    let raw = String(text == null ? '' : text).trim();
    if (!raw) {
      return null;
    }
    let assignee = '';
    let endDate = '';
    const dueMatch = raw.match(/\bdue:(\d{4}-\d{2}-\d{2})\b/i);
    if (dueMatch) {
      endDate = dueMatch[1];
      raw = raw.replace(dueMatch[0], ' ');
    }
    const whoMatch = raw.match(/(?:^|\s)@([^\s]+)/);
    if (whoMatch) {
      assignee = whoMatch[1];
      raw = raw.replace(whoMatch[0], ' ');
    }
    const name = raw.replace(/\s+/g, ' ').trim();
    if (!name) {
      return null;
    }
    return { name: name, assignee: assignee, endDate: endDate };
  }

  ns.Kanban = {
    COLUMNS: COLUMNS,
    LABELS: LABELS,
    defaultSettings: defaultSettings,
    ensureSettings: ensureSettings,
    normalizePositions: normalizePositions,
    isWorkItem: isWorkItem,
    workItems: workItems,
    positionOf: positionOf,
    nextPosition: nextPosition,
    sortedColumn: sortedColumn,
    columnTasks: columnTasks,
    counts: counts,
    wip: wip,
    moveTo: moveTo,
    moveBy: moveBy,
    stampStatus: stampStatus,
    getFilters: getFilters,
    setFilters: setFilters,
    clearFilters: clearFilters,
    filtersActive: filtersActive,
    matchTask: matchTask,
    laneGroups: laneGroups,
    flow: flow,
    parseQuickAdd: parseQuickAdd
  };
})(MMGR);
window.MMGR = MMGR;
```

### Step 7: Prove the model in Node

Create `test/kanban-model.test.mjs`. The file loads the production module in a `vm` sandbox with a tiny `MMGR.Utils` stub, so it tests the shipped code rather than a copy.

```js
/* Kanban model unit tests. No browser, no storage: js/mmgr-kanban.js is
   loaded into a vm sandbox with a minimal MMGR namespace. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'js', 'mmgr-kanban.js'), 'utf8');

const sandbox = { window: {}, console };
sandbox.window.MMGR = {
  Utils: {
    todayStr: () => '2026-10-25',
    isOverdue: d => !!d && d < '2026-10-25'
  }
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const K = sandbox.window.MMGR.Kanban;
const task = (id, status, pos, extra) =>
  Object.assign({ id, name: id, status, boardPosition: pos }, extra || {});
const state = tasks => ({
  tasks,
  kanban: {
    wip: { todo: 0, inprogress: 0, blocked: 0, completed: 0 },
    swimlane: 'none'
  }
});

// The model runs inside a vm realm, so the arrays and objects it creates
// carry that realm's prototypes. Strict deepEqual compares prototypes and
// would fail on structurally identical values. Norm through JSON first:
// the model output is plain data (strings, numbers, booleans, null), so
// this also proves it stays serialisable.
const plain = value => JSON.parse(JSON.stringify(value));

test('columnTasks sorts by boardPosition, not WBS array order', () => {
  const s = state([task('c', 'todo', 2), task('a', 'todo', 0), task('b', 'todo', 1)]);
  assert.deepEqual(
    plain(K.columnTasks(s, 'todo').map(t => t.id)),
    ['a', 'b', 'c']
  );
});

test('workItems drops phases and rollup parents', () => {
  const s = state([
    { id: 'p', name: 'Phase', isPhase: true, status: 'todo', boardPosition: 0 },
    { id: 'r', name: 'Parent', level: 0, status: 'todo', boardPosition: 1 },
    { id: 'c', name: 'Child', parentName: 'Parent', level: 1, status: 'todo', boardPosition: 2 }
  ]);
  assert.deepEqual(
    plain(K.workItems(s).map(t => t.id)),
    ['c']
  );
});

test('moveTo renumbers the target column and closes the old gap', () => {
  const s = state([task('a', 'todo', 0), task('b', 'todo', 1), task('c', 'inprogress', 0)]);
  const r = K.moveTo(s, 'a', 'inprogress', 'c');
  assert.equal(r.changed, true);
  assert.equal(r.from, 'todo');
  assert.deepEqual(
    plain(K.sortedColumn(s, 'inprogress').map(t => t.id)),
    ['a', 'c']
  );
  assert.deepEqual(
    plain(K.sortedColumn(s, 'todo').map(t => t.id)),
    ['b']
  );
  assert.equal(s.tasks.find(t => t.id === 'b').boardPosition, 0);
  assert.equal(s.tasks.find(t => t.id === 'c').boardPosition, 1);
});

test('moveBy moves one slot and refuses at the edges', () => {
  const s = state([task('a', 'todo', 0), task('b', 'todo', 1)]);
  assert.equal(K.moveBy(s, 'b', -1).changed, true);
  assert.deepEqual(
    plain(K.sortedColumn(s, 'todo').map(t => t.id)),
    ['b', 'a']
  );
  assert.equal(K.moveBy(s, 'b', -1).changed, false);
  assert.equal(K.moveBy(s, 'a', 1).changed, false);
});

test('stampStatus owns completedDate, startedDate, statusSince', () => {
  const t = task('a', 'todo', 0);
  K.stampStatus(t, 'inprogress', '2026-10-20');
  assert.equal(t.startedDate, '2026-10-20');
  assert.equal(t.statusSince, '2026-10-20');
  K.stampStatus(t, 'completed', '2026-10-24');
  assert.equal(t.completedDate, '2026-10-24');
  K.stampStatus(t, 'blocked', '2026-10-25');
  assert.equal('completedDate' in t, false);
  assert.equal(t.startedDate, '2026-10-20');
});

test('wip counts work items, 0 means unlimited, over is a warning flag', () => {
  const s = state([
    task('a', 'inprogress', 0),
    task('b', 'inprogress', 1),
    { id: 'p', isPhase: true, status: 'inprogress' }
  ]);
  assert.deepEqual(plain(K.wip(s, 'inprogress')), {
    count: 2,
    limit: 0,
    over: false,
    remaining: null
  });
  s.kanban.wip.inprogress = 1;
  const w = K.wip(s, 'inprogress');
  assert.equal(w.count, 2);
  assert.equal(w.over, true);
  assert.equal(w.remaining, 0);
});

test('matchTask covers text, assignee, overdue and flag', () => {
  const t = task('a', 'todo', 0, {
    name: 'Pour slab',
    assignee: 'Sam',
    endDate: '2026-10-20',
    critical: true
  });
  assert.equal(K.matchTask(t, { text: 'slab' }, '2026-10-25'), true);
  assert.equal(K.matchTask(t, { assignee: 'Sam' }, '2026-10-25'), true);
  assert.equal(K.matchTask(t, { due: 'overdue' }, '2026-10-25'), true);
  assert.equal(K.matchTask(t, { flag: 'critical' }, '2026-10-25'), true);
  assert.equal(K.matchTask(t, { assignee: 'Alex' }, '2026-10-25'), false);
  assert.equal(K.matchTask(t, { due: 'week' }, '2026-10-25'), false);
});

test('laneGroups puts Unassigned last and keeps every card once', () => {
  const tasks = [
    task('a', 'todo', 0, { assignee: 'Sam' }),
    task('b', 'todo', 1, { assignee: '' }),
    task('c', 'todo', 2, { assignee: 'Alex' })
  ];
  const lanes = K.laneGroups(tasks, 'assignee');
  assert.deepEqual(
    plain(lanes.map(l => l.key)),
    ['Alex', 'Sam', 'Unassigned']
  );
  assert.equal(
    lanes.reduce((n, l) => n + l.tasks.length, 0),
    3
  );
});

test('flow averages only cards with both dates', () => {
  const s = state([
    task('a', 'completed', 0, {
      createdDate: '2026-10-01',
      startedDate: '2026-10-11',
      completedDate: '2026-10-21'
    }),
    task('b', 'completed', 1, { createdDate: '2026-10-05', completedDate: '2026-10-25' }),
    task('c', 'completed', 2, {})
  ]);
  const f = K.flow(s, '2026-10-25');
  assert.equal(f.completed, 3);
  assert.equal(f.leadSamples, 2);
  assert.equal(f.avgLead, 20);
  assert.equal(f.cycleSamples, 1);
  assert.equal(f.avgCycle, 10);
});

test('parseQuickAdd reads @assignee and due:date', () => {
  assert.deepEqual(plain(K.parseQuickAdd('Fix door @Sam due:2026-11-01')), {
    name: 'Fix door',
    assignee: 'Sam',
    endDate: '2026-11-01'
  });
  assert.equal(K.parseQuickAdd('   '), null);
  assert.deepEqual(plain(K.parseQuickAdd('Order rebar')), {
    name: 'Order rebar',
    assignee: '',
    endDate: ''
  });
});

test('ensureSettings clamps negative limits and unknown lane modes', () => {
  const s = { kanban: { wip: { todo: -3, inprogress: '4' }, swimlane: 'nope' } };
  const k = K.ensureSettings(s);
  assert.equal(k.wip.todo, 0);
  assert.equal(k.wip.inprogress, 4);
  assert.equal(k.swimlane, 'none');
});

test('normalizePositions fills gaps without moving existing cards', () => {
  const s = state([task('a', 'todo', 3), { id: 'b', status: 'todo' }, { id: 'c', status: 'todo' }]);
  K.normalizePositions(s);
  assert.equal(s.tasks[1].boardPosition, 4);
  assert.equal(s.tasks[2].boardPosition, 5);
});
```

Run it:

```bash
node --test test/kanban-model.test.mjs
```

Expected: 12 tests pass, 0 fail.

### Step 8: Make the renderer read the model

In `js/render/kanban.js`, add one model accessor near the top, after `const $ = U.$;`:

```js
  // Load-order guard: the model must exist before any board render.
  function boardModel() {
    if (!ns.Kanban) {
      throw new Error('mmgr-kanban.js must load before js/render/kanban.js');
    }
    return ns.Kanban;
  }
```

Then replace the duplicated work-item block and the per-column filter in `renderKanban()`.

Remove this block:

```js
    const noTasksAtAll = s.tasks.length === 0;
    const rollupParents = new Set();
    s.tasks.forEach(t => {
      if (t.parentName) {
        rollupParents.add(t.parentName);
      }
    });
    const isWorkItem = t => !t.isPhase && !((t.level || 0) === 0 && rollupParents.has(t.name));
```

Replace it with:

```js
    const K = boardModel();
    const noTasksAtAll = K.workItems(s).length === 0;
```

Inside the column loop, replace:

```js
      const tasks = s.tasks.filter(t => (t.status || 'todo') === status && isWorkItem(t));
```

with:

```js
      // Order and filtering are model concerns. The renderer only draws.
      const tasks = K.columnTasks(s, status);
```

Replace the lead-time filter:

```js
      const ltTasks = (s.tasks || []).filter(t => t.leadTime && isWorkItem(t));
```

with:

```js
      const ltTasks = K.workItems(s)
        .filter(t => t.leadTime)
        .sort((a, b) => K.positionOf(a) - K.positionOf(b));
```

Leave `kanbanCard`, `kanbanLeadtimeCard`, and the export block unchanged in this task. The card markup changes in Tasks 3 and 5.

### Step 9: Document the module

In `docs/DEVELOPER-GUIDE.md`, module map, add a row directly after `mmgr-utils.js`:

```md
| `mmgr-kanban.js` | ~430 | `Kanban` | Kanban board model: card membership and order, WIP limits, ephemeral filters, derived swimlanes, lead and cycle time. Pure functions over the state object, no DOM. Loads before the renderer and the domain modules. |
```

### Step 10: Checkpoint and commit

Do not continue until all of these pass:

```bash
node build.js
node --test test/kanban-model.test.mjs
npm run verify
node tools/verify-actions.cjs
node tools/verify-render-exports.cjs
```

Then confirm the bundle carries the model:

```bash
node -e "const fs=require('fs');const b=fs.readFileSync('dist/bundle.js','utf8');console.log('model:',b.includes('MMGR.Kanban'),'schema:',b.includes('23: function (state)'));"
```

Expected: `model: true schema: true`.

Commit:

```bash
git add js/mmgr-kanban.js js/mmgr-state.js js/mmgr-tasks.js js/render/kanban.js test/kanban-model.test.mjs build.js project.html worker.js serve.cjs docs/DEVELOPER-GUIDE.md sw.js
git commit -m "feat(kanban): add board model and schema v23"
```

**Manual smoke check before moving on:** open the board with a project that has tasks in all four columns. The cards must appear in the same order as the WBS table within each status, and no card may be duplicated or lost. Phases must still be absent.

---

## Task 2: Soft WIP limits

**Files:**
- Modify: `project.html` (header button + limits modal)
- Modify: `js/render/kanban.js` (counter text, over-limit classes)
- Modify: `js/mmgr-app.js` (`ACTION_MAP`, handlers, exports, read-only allow-list, change whitelist)
- Modify: `css/mmgr.css` (counter, column, modal)
- Modify: `mymanager-field-guide.html` (A-05 card)

**Why:** A count without a target is decoration. Kanboard's `task_limit` is a **soft** limit: it shows `count / limit` and marks the column when the limit is exceeded, but it never refuses a move. That is the right behaviour for construction, where an urgent card must still be allowed to enter a full column.

### Step 1: Add the limits button and modal

In `project.html`, inside the Kanban header `.g6` (around line 631), add this button **before** the Lead-Time toggle:

```html
          <button class="btn btn-n btn-s" data-action="kbWip"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-target"></use></svg> Column Limits</button>
```

Then add the modal immediately **after** the closing `</div>` of the Kanban panel (after line 666), next to the other top-level modals:

```html
<!-- Kanban column limits. Soft targets only: a limit warns, never blocks. -->
<div id="kbwip-modal">
  <div class="mb">
    <div class="mh">
      <span class="mt">Column Limits</span>
      <button class="dc" data-action="kbWipClose" aria-label="Close"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg></button>
    </div>
    <div class="mbody">
      <p class="modal-txt">A limit warns when a column holds more cards than you planned. It never blocks a move. Leave 0 for no limit.</p>
      <div class="kbwip-grid">
        <label class="kbwip-l" for="kbwip-todo">To Do</label>
        <input class="kbwip-in" id="kbwip-todo" type="number" min="0" max="99" step="1" inputmode="numeric" data-action="saveKbWip" data-kb-wip="todo">
        <label class="kbwip-l" for="kbwip-inprogress">In Progress</label>
        <input class="kbwip-in" id="kbwip-inprogress" type="number" min="0" max="99" step="1" inputmode="numeric" data-action="saveKbWip" data-kb-wip="inprogress">
        <label class="kbwip-l" for="kbwip-blocked">Blocked</label>
        <input class="kbwip-in" id="kbwip-blocked" type="number" min="0" max="99" step="1" inputmode="numeric" data-action="saveKbWip" data-kb-wip="blocked">
        <label class="kbwip-l" for="kbwip-completed">Completed</label>
        <input class="kbwip-in" id="kbwip-completed" type="number" min="0" max="99" step="1" inputmode="numeric" data-action="saveKbWip" data-kb-wip="completed">
      </div>
    </div>
    <div class="mf">
      <button class="btn btn-n btn-s" data-action="kbWipClose">Done</button>
    </div>
  </div>
</div>
```

The modal uses the same `.mb` / `.mh` / `.mbody` / `.mf` shell as `#cfm-modal`, so it already inherits the glass surface, title, and footer styles.

### Step 2: Draw the limit in the column header

In `js/render/kanban.js`, extend the column table so each entry also names its outer column:

```js
    const cols = [
      ['todo', 'kc-todo', 'w-todo', 'col-todo'],
      ['inprogress', 'kc-ip', 'w-ip', 'col-ip'],
      ['blocked', 'kc-bl', 'w-bl', 'col-bl'],
      ['completed', 'kc-dn', 'w-dn', 'col-dn']
    ];
```

Replace the counter block:

```js
      const wip = $(col[2]);
      if (wip) {
        wip.textContent = tasks.length;
      }
```

with:

```js
      const info = K.wip(s, status);
      const wip = $(col[2]);
      if (wip) {
        wip.textContent = info.limit ? info.count + ' / ' + info.limit : String(info.count);
        wip.classList.toggle('over', info.over);
        wip.setAttribute(
          'title',
          info.limit
            ? info.count + ' cards, limit ' + info.limit
            : info.count + ' cards, no limit'
        );
      }
      const colEl = $(col[3]);
      if (colEl) {
        colEl.classList.toggle('kcol-over', info.over);
        const visible = tasks.length !== info.count ? ', ' + tasks.length + ' shown by filter' : '';
        colEl.setAttribute(
          'aria-label',
          K.LABELS[status] +
            ', ' +
            info.count +
            (info.limit ? ' of ' + info.limit + ' planned' : ' cards') +
            visible
        );
      }
```

**Important:** `tasks.length` is the filtered count and `info.count` is the unfiltered count. The header badge must use `info.count`, so a filter never makes a column look under its limit. Task 4 adds the "shown by filter" part to the visible label.

### Step 3: Add the handlers

In `js/mmgr-app.js`, next to `tglLeadtimeLane` (around line 2896), add:

```js
  // ---- Kanban column limits (soft) ----
  // Kanboard semantics: task_limit = 0 means unlimited, and exceeding a
  // limit is a warning, never a hard block. A site manager must still be
  // able to drag the one urgent card into a full column.
  function kbWip() {
    const s = S();
    const k = (s && s.kanban) || ns.Kanban.defaultSettings();
    const readOnly = isReadonly();
    ns.Kanban.COLUMNS.forEach(function (key) {
      const el = document.getElementById('kbwip-' + key);
      if (el) {
        el.value = String((k.wip && k.wip[key]) || 0);
        // The sheet still opens in view-only so the limits can be read, but
        // the inputs cannot be edited into a misleading unsaved value.
        el.disabled = readOnly;
      }
    });
    const modal = document.getElementById('kbwip-modal');
    if (modal) {
      modal.classList.add('on');
    }
    const first = document.getElementById('kbwip-todo');
    if (first) {
      first.focus();
    }
  }

  function kbWipClose() {
    const modal = document.getElementById('kbwip-modal');
    if (modal) {
      modal.classList.remove('on');
    }
  }

  function saveKbWip(el) {
    if (!el || isReadonly()) {
      if (isReadonly()) {
        showToast('View-only access: the board can be read but not changed.', 'err');
      }
      return;
    }
    const status = el.getAttribute('data-kb-wip');
    if (ns.Kanban.COLUMNS.indexOf(status) === -1) {
      return;
    }
    const raw = parseInt(el.value, 10);
    const n = isNaN(raw) ? 0 : Math.max(0, Math.min(99, raw));
    el.value = String(n);
    ns.State.updateState(function (s) {
      ns.Kanban.ensureSettings(s);
      s.kanban.wip[status] = n;
    });
    R.renderKanban();
    const info = ns.Kanban.wip(S(), status);
    if (info.over) {
      showToast(
        ns.Kanban.LABELS[status] +
          ' is over its limit (' +
          info.count +
          ' of ' +
          n +
          '). The limit is a warning, not a block.',
        'warn'
      );
    }
  }
```

### Step 4: Answer the new actions

In `js/mmgr-app.js`, `ACTION_MAP`, next to the other Kanban entries (around line 4717):

```js
    kbWip: () => window.MMGR.App.kbWip(),
    kbWipClose: () => window.MMGR.App.kbWipClose(),
    saveKbWip: el => window.MMGR.App.saveKbWip(el),
```

In the `window.MMGR.App` export object (around line 3631), add:

```js
    kbWip: kbWip,
    kbWipClose: kbWipClose,
    saveKbWip: saveKbWip,
```

### Step 5: Allow the modal in view-only mode

In `READONLY_SAFE_ACTIONS` (around line 5056), add:

```js
    // Reading or closing the column-limit sheet mutates nothing. The inputs
    // themselves stay blocked by saveKbWip's own guard.
    kbWip: 1,
    kbWipClose: 1,
```

Do **not** add `saveKbWip`. It writes state.

### Step 6: Whitelist the change event

The counter inputs fire `change`, not `click`. In the change whitelist (around line 5395), add near `updTaskField`:

```js
        action === 'saveKbWip' ||
```

Do not add it to the `input` whitelist: clamping a half-typed number on every keystroke fights the user. `change` fires on blur, Enter, or the spinner commit.

### Step 7: Style the states

In `css/mmgr.css`, directly after the existing `.wip` rule (around line 5193), add:

```css
.wip.over {
  background: rgba(239, 68, 68, 0.12);
  border-color: var(--danger);
  color: var(--danger);
  font-weight: 700;
}
.kcol-over {
  border-color: var(--danger);
  box-shadow: inset 0 3px 0 var(--danger);
}
```

Then add the modal styles next to the confirm modal block (around line 4651):

```css
/* Kanban column limits. Same overlay shell as #cfm-modal. */
#kbwip-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  z-index: 9999;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
#kbwip-modal.on {
  display: flex;
}
#kbwip-modal .mb {
  width: 420px;
  max-width: 100%;
  max-height: 82vh;
}
.kbwip-grid {
  display: grid;
  grid-template-columns: 1fr 90px;
  gap: 10px 14px;
  align-items: center;
  margin-top: 14px;
}
.kbwip-l {
  font-size: 0.78rem;
  font-weight: 600;
}
.kbwip-in {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--ink);
  font: inherit;
}
body.dark-mode .kbwip-in {
  background: rgba(0, 0, 0, 0.25);
}
```

### Step 8: Field guide

In `mymanager-field-guide.html`, A-05, Kanban tab, add a third card to the existing `grid grid-2`:

```html
          <div class="card"><span class="cnum">LIMIT</span><h4>Column Limits</h4><p>Set a target for each column. The counter shows cards against the target and turns red when the column is over. A limit is a warning, never a block, so an urgent card can still move.</p></div>
```

### Step 9: Verify

```bash
node build.js
npm run verify
node tools/verify-actions.cjs
```

Manual checks in the browser (`node serve.cjs`, then `http://127.0.0.1:8765/project.html`):

1. Open Kanban, click **Column Limits**. The four inputs show the saved values.
2. Set In Progress to 1 with two cards in it. The badge reads `2 / 1`, is red, and the column has a red top edge.
3. Set it back to 0. The badge reads `2`.
4. Reload the page. The value persists.
5. Open a view-only share link. **Column Limits** opens with every input disabled, so a limit can be read but not edited. The generic view-only toast still covers any programmatic attempt.

### Step 10: Commit

```bash
git add project.html js/render/kanban.js js/mmgr-app.js css/mmgr.css mymanager-field-guide.html sw.js
git commit -m "feat(kanban): add soft WIP limits per column"
```

---

## Task 3: Real ordering, drag insertion, completion stamping, quick add, keyboard moves

**Files:**
- Modify: `js/mmgr-app.js` (shared move helper, `dropCard`, drop/dragover listeners, keyboard handler)
- Modify: `js/mmgr-tasks.js` (`createTask`, `addTask`, `updTaskField` status branch)
- Modify: `js/render/kanban.js` (focusable cards, quick-add row)
- Modify: `project.html` (no markup change: the quick-add row is rendered)
- Modify: `js/mmgr-shortcuts.js` (two rows)
- Modify: `css/mmgr.css` (drop marker, focus ring, quick add)
- Modify: `mymanager-field-guide.html` (A-05 cards)

**Why:** Ordering is what turns a status list into a board. Kanboard stores an explicit position and renumbers on every move (`TaskPositionModel`). This task also fixes a real bug: dropping a card into Completed never stamped `completedDate`, so completion metrics and the Daily Field snapshot missed it.

### Step 1: Add one shared move path

In `js/mmgr-app.js`, next to the existing `dragTaskId` declaration (around line 2916), add:

```js
  // Every board move, whatever triggered it (drag, keyboard, future touch
  // controls), goes through here. Ordering, status stamping, lead-time exit,
  // WIP warnings, and the three affected renders stay in one place.
  function warnWip(status, info) {
    showToast(
      ns.Kanban.LABELS[status] +
        ' is over its limit (' +
        info.count +
        ' of ' +
        info.limit +
        '). The move is kept.',
      'warn'
    );
  }

  function applyMove(id, status, beforeId) {
    let moved = null;
    let info = null;
    ns.State.updateState(function (s) {
      const task = (s.tasks || []).find(function (t) {
        return t && t.id === id;
      });
      if (!task) {
        return;
      }
      const result = ns.Kanban.moveTo(s, id, status, beforeId);
      if (!result.changed) {
        return;
      }
      // A same-column reorder must NOT clear leadTime. The card only leaves
      // the Lead-Time lane when it actually changes status column.
      if (result.from !== result.to) {
        task.leadTime = false;
        ns.Kanban.stampStatus(task, status);
      }
      moved = result;
      info = ns.Kanban.wip(s, status);
    });
    if (!moved) {
      return false;
    }
    R.renderKanban();
    R.renderWbs();
    R.renderDash();
    if (info && info.over) {
      warnWip(status, info);
    }
    return true;
  }
```

**Do not** call `stampStatus` on a reorder. `moveTo` owns `status` and `boardPosition`; `stampStatus` owns the date fields, and only a real transition runs it.

### Step 2: Rewrite `dropCard`

Replace the whole `dropCard` body (current `js/mmgr-app.js:2945-2988`) with:

```js
  function dropCard(ev, status, beforeId) {
    ev.preventDefault();
    // Second guard (defense in depth): the drop is the state mutation.
    if (isReadonly()) {
      showToast('View-only access: the board can be read but not changed.', 'err');
      dragTaskId = null;
      document.querySelectorAll('.kcol').forEach(c => c.classList.remove('dov'));
      return;
    }
    if (dragTaskId) {
      const task = (S().tasks || []).find(t => t.id === dragTaskId);
      // Lead-time cards belong in the Lead-Time lane. Reordering one inside
      // its current status column is fine; moving it into a different work
      // column is not.
      if (task && task.leadTime && (task.status || 'todo') !== status) {
        showToast(
          'Lead-time cards belong in the Lead-Time lane. WIP columns are for crew-driven work.',
          'err'
        );
        dragTaskId = null;
        document.querySelectorAll('.kcol').forEach(c => c.classList.remove('dov'));
        return;
      }
      applyMove(dragTaskId, status, beforeId || null);
    }
    dragTaskId = null;
    endBoardDrag();
    document.querySelectorAll('.kcol').forEach(c => c.classList.remove('dov'));
    document.querySelectorAll('.kc.drop-before').forEach(c => c.classList.remove('drop-before'));
  }
```

This removes the old direct `task.status = status` write and the unconditional `task.leadTime = false`. Both were the source of the missing `completedDate` and of a reorder silently removing a card from the lane.

### Step 3: Work out where the card lands

In `js/mmgr-app.js`, above `dropCard`, add:

```js
  // The card the dragged card should be inserted BEFORE, or null to append.
  // Uses the pointer's Y against each card's midpoint, so dropping on the top
  // half of a card inserts above it and the bottom half inserts below it.
  function dropBeforeId(colEl, clientY) {
    const cards = Array.prototype.slice.call(colEl.querySelectorAll('.kc'));
    for (let i = 0; i < cards.length; i++) {
      // Never treat the card being dragged as its own insertion point.
      if (cards[i].getAttribute('data-id') === dragTaskId) {
        continue;
      }
      const rect = cards[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return cards[i].getAttribute('data-id');
      }
    }
    return null;
  }
```

Update the document `drop` listener (around line 5615) to pass the insertion point:

```js
  document.addEventListener('drop', function (e) {
    const col = e.target.closest('[data-drop-status]');
    if (!col) {
      return;
    }
    e.preventDefault();
    const status = col.getAttribute('data-drop-status');
    if (status === 'leadtime') {
      window.MMGR.App.dropCardLeadtime(e);
    } else {
      window.MMGR.App.dropCard(e, status, dropBeforeId(col, e.clientY));
    }
  });
```

`dropCard` is exported on `MMGR.App`, so its new third argument is part of that internal contract. No other caller passes it; the `beforeId || null` guard keeps old callers safe.

### Step 4: Show where the card will land

Update the `dragover` listener (around line 5600):

```js
  document.addEventListener('dragover', function (e) {
    const col = e.target.closest('[data-drop-status]');
    if (!col) {
      return;
    }
    e.preventDefault();
    col.classList.add('dov');
    const before = dropBeforeId(col, e.clientY);
    document.querySelectorAll('.kc.drop-before').forEach(c => c.classList.remove('drop-before'));
    if (before) {
      const target = col.querySelector('.kc[data-id="' + before + '"]');
      if (target) {
        target.classList.add('drop-before');
      }
    }
  });
```

Update `dragleave` so the marker clears with the column highlight:

```js
  document.addEventListener('dragleave', function (e) {
    const col = e.target.closest('[data-drop-status]');
    if (col) {
      col.classList.remove('dov');
      col.querySelectorAll('.kc.drop-before').forEach(c => c.classList.remove('drop-before'));
    }
  });
```

### Step 5: Keyboard moves

In `js/mmgr-app.js`, next to the other document-level key handling (after the drop listeners is fine), add:

```js
  // Kanban keyboard moves. The board must be usable without a mouse:
  //   Alt + Left / Right  move the focused card to the previous / next column
  //   Alt + Up / Down     reorder inside the current column
  //   Enter               open the card sheet (Task 5 wires the opener)
  // Plain arrows are left alone so page scrolling keeps working.
  document.addEventListener('keydown', function (e) {
    const card = e.target && e.target.closest ? e.target.closest('.kc[data-drag-id]') : null;
    if (!card) {
      return;
    }
    if (e.key === 'Enter' && !e.altKey) {
      if (window.MMGR.KanbanCard && window.MMGR.KanbanCard.open) {
        e.preventDefault();
        window.MMGR.KanbanCard.open(card.getAttribute('data-drag-id'));
      }
      return;
    }
    if (!e.altKey) {
      return;
    }
    if (
      e.key !== 'ArrowLeft' &&
      e.key !== 'ArrowRight' &&
      e.key !== 'ArrowUp' &&
      e.key !== 'ArrowDown'
    ) {
      return;
    }
    e.preventDefault();
    if (isReadonly()) {
      showToast('View-only access: the board can be read but not changed.', 'err');
      return;
    }
    const id = card.getAttribute('data-drag-id');
    const task = (S().tasks || []).find(t => t.id === id);
    if (!task) {
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const delta = e.key === 'ArrowUp' ? -1 : 1;
      let changed = false;
      ns.State.updateState(function (s) {
        changed = ns.Kanban.moveBy(s, id, delta).changed;
      });
      if (changed) {
        R.renderKanban();
        R.renderWbs();
        R.renderDash();
      } else {
        showToast('That card is already at the ' + (delta < 0 ? 'top' : 'bottom') + '.', 'warn');
      }
    } else {
      if (task.leadTime) {
        showToast(
          'Lead-time cards belong in the Lead-Time lane. WIP columns are for crew-driven work.',
          'err'
        );
        return;
      }
      const at = ns.Kanban.COLUMNS.indexOf(task.status || 'todo');
      const next = at + (e.key === 'ArrowLeft' ? -1 : 1);
      if (next < 0 || next >= ns.Kanban.COLUMNS.length) {
        showToast('That card is already in the ' + (next < 0 ? 'first' : 'last') + ' column.', 'warn');
        return;
      }
      applyMove(id, ns.Kanban.COLUMNS[next], null);
    }
    // The board re-rendered, so the old node is gone. Restore focus to the
    // same card, otherwise the next key press goes nowhere. In lane mode the
    // hidden status columns still hold stale nodes, so pick the visible one.
    const again = document.querySelectorAll('.kc[data-id="' + id + '"]');
    for (let i = 0; i < again.length; i++) {
      if (again[i].offsetParent !== null) {
        again[i].focus();
        break;
      }
    }
  });
```

`moveBy` is called inside `updateState`; the callback is synchronous in this repo (the existing `dropCard` relies on that), so reading `changed` immediately after is safe.

### Step 6: Stamp completion through one helper

In `js/mmgr-tasks.js`, `updTaskField`, replace:

```js
        task[field] = value;
        // C9: stamp completedDate when status changes to completed
        if (field === 'status' && value === 'completed' && !task.completedDate) {
          task.completedDate = U.todayStr();
        }
        // Clear completedDate if status changes away from completed
        if (field === 'status' && value !== 'completed' && task.completedDate) {
          delete task.completedDate;
        }
```

with:

```js
        if (field === 'status') {
          // One transition helper for drag, keyboard, select, and WBS edits.
          // It also records startedDate and statusSince.
          if (ns.Kanban) {
            const before = task.status || 'todo';
            ns.Kanban.stampStatus(task, value);
            // A real column change also leaves the Lead-Time lane. Reordering
            // inside the same column (applyMove) does not.
            if (before !== value) {
              task.leadTime = false;
            }
          } else {
            task.status = value;
          }
        } else {
          task[field] = value;
        }
```

Remove the now-duplicated C9 comment. `stampStatus` has exactly the old `completedDate` behaviour plus `startedDate` and `statusSince`.

### Step 7: Make cards focusable

In `js/render/kanban.js`, in `kanbanCard`, change the opening tag so the card can receive focus and announce itself:

```js
      '" draggable="true" tabindex="0" role="button" aria-label="' +
      U.escapeHtml(t.name + ', ' + (t.status || 'todo')) +
      '" data-drag-id="' +
```

The existing `data-id` attribute stays. Do the same in `kanbanLeadtimeCard`, using `t.name + ', lead time'` for the label.

### Step 8: Checkpoint

```bash
node build.js
npm run verify
node tools/verify-actions.cjs
```

Manual checks:

1. Drag a card from To Do to the **top half** of a card in In Progress. It lands above that card.
2. Drop it below the last card. It lands at the bottom.
3. Drag a card within In Progress from position 3 to position 1. The Lead-Time flag (if set) must survive the reorder.
4. Drag a To Do card to Completed. Reopen the WBS and confirm `completedDate` is today (the WBS completion column or the card sheet in Task 5).
5. Focus a card with Tab, press `Alt+ArrowRight`. It moves one column and keeps focus.
6. Press `Alt+ArrowUp` at the top of a column. A warning toast appears and nothing moves.
7. Enter view-only mode and repeat step 5. The card does not move and the view-only toast appears.

Do not commit yet. Task 3 continues below.

---

### Step 9: One task factory for every new card

In `js/mmgr-tasks.js`, replace `addTask()` with a reusable factory plus a thin wrapper:

```js
  // One shape for every new card, whatever created it: the WBS button, the
  // Kanban quick add, or a future import. Callers own the re-render.
  function createTask(fields) {
    const f = fields || {};
    const status = f.status || 'todo';
    let id = '';
    ns.State.updateState(function (s) {
      if (!s.tasks) {
        s.tasks = [];
      }
      const task = {
        id: U.genId('t'),
        name: f.name || 'New Task',
        level: 0,
        indent: 0,
        isPhase: false,
        status: status,
        startDate: f.startDate || '',
        endDate: f.endDate || '',
        duration: f.duration || '',
        assignee: f.assignee || '',
        critical: false,
        leadTime: false,
        recurring: false,
        weatherExposed: false,
        confidence: 'high',
        predecessors: [],
        notes: f.notes || '',
        weatherSensitive: false,
        // V23: explicit board slot and an honest creation date.
        createdDate: U.todayStr(),
        boardPosition:
          ns.Kanban && typeof ns.Kanban.nextPosition === 'function'
            ? ns.Kanban.nextPosition(s.tasks, status)
            : 0
      };
      s.tasks.push(task);
      id = task.id;
      if (ns.Kanban && ns.Kanban.stampStatus) {
        ns.Kanban.stampStatus(task, status);
      }
    });
    return id;
  }

  function addTask() {
    createTask({});
    R.renderWbs();
  }
```

Add `createTask: createTask,` to the `ns.Tasks` export block (next to `addTask`).

`createTask` deliberately does not render, so the quick-add caller can render the board, WBS, and dashboard once after the write.

### Step 10: Inline quick add

In `js/render/kanban.js`, define the row **inside** `renderKanban()`, directly before the column loop. It needs the local `K` handle, and keeping it inside avoids a second model accessor:

```js
    function quickAddMarkup(colStatus) {
      return (
        '<div class="kqa">' +
        '<button type="button" class="kqa-add" data-action="kbQuickAdd" data-status="' +
        colStatus +
        '">+ Add card</button>' +
        '<input class="kqa-in is-hide" type="text" maxlength="140" autocomplete="off" ' +
        'data-status="' +
        colStatus +
        '" placeholder="Name @who due:2026-11-01" aria-label="New card name for ' +
        U.escapeHtml(K.LABELS[colStatus]) +
        '">' +
        '</div>'
      );
    }
```

Then replace the column body assignment:

```js
      el.innerHTML = tasks.map(kanbanCard).join('');
```

with:

```js
      el.innerHTML = tasks.map(kanbanCard).join('') + quickAddMarkup(status);
```

The empty-board early return stays as it is. A board with no tasks already offers a clear "Add Task" path.

In `js/mmgr-app.js`, add the three quick-add functions next to `applyMove`:

```js
  // ---- Kanban quick add ----
  function kbQuickAdd(el) {
    if (!el) {
      return;
    }
    const wrap = el.closest('.kqa');
    const input = wrap && wrap.querySelector('.kqa-in');
    if (!input) {
      return;
    }
    input.classList.remove('is-hide');
    input.setAttribute('data-status', el.getAttribute('data-status') || 'todo');
    input.value = '';
    input.focus();
  }

  function hideQuickAdd(input) {
    if (!input) {
      return;
    }
    input.value = '';
    input.classList.add('is-hide');
  }

  function commitQuickAdd(input) {
    if (!input || input.classList.contains('is-hide')) {
      return;
    }
    if (isReadonly()) {
      showToast('View-only access: the board can be read but not changed.', 'err');
      hideQuickAdd(input);
      return;
    }
    const parsed = ns.Kanban.parseQuickAdd(input.value);
    const status = input.getAttribute('data-status') || 'todo';
    if (!parsed) {
      hideQuickAdd(input);
      return;
    }
    ns.Tasks.createTask({
      name: parsed.name,
      assignee: parsed.assignee,
      endDate: parsed.endDate,
      status: status
    });
    hideQuickAdd(input);
    R.renderKanban();
    R.renderWbs();
    R.renderDash();
    const info = ns.Kanban.wip(S(), status);
    if (info.over) {
      warnWip(status, info);
    }
    showToast('Card added to ' + ns.Kanban.LABELS[status] + '.', 'ok');
  }
```

Add one delegated keydown for Enter and Escape. Put it next to the keyboard-move listener:

```js
  document.addEventListener('keydown', function (e) {
    const input = e.target && e.target.closest ? e.target.closest('.kqa-in') : null;
    if (!input) {
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commitQuickAdd(input);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideQuickAdd(input);
    }
  });

  document.addEventListener('focusout', function (e) {
    const input = e.target && e.target.closest ? e.target.closest('.kqa-in') : null;
    if (input && !input.value.trim()) {
      hideQuickAdd(input);
    }
  });
```

### Step 11: Register the action

In `ACTION_MAP`, next to `kbWip`:

```js
    kbQuickAdd: el => window.MMGR.App.kbQuickAdd(el),
```

In the `MMGR.App` export block:

```js
    kbQuickAdd: kbQuickAdd,
```

Do **not** add `kbQuickAdd` to `READONLY_SAFE_ACTIONS`. Opening a write flow in a view-only session should be refused up front, not allowed until Enter.

### Step 12: Styles

In `css/mmgr.css`, after the `.kc` block (around line 5210), add:

```css
.kc:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}
.kc.drop-before {
  box-shadow: 0 -3px 0 var(--gold);
}
.kqa {
  margin-top: 4px;
}
.kqa-add {
  width: 100%;
  text-align: left;
  background: transparent;
  border: 1px dashed var(--border);
  border-radius: 4px;
  padding: 7px 8px;
  font: inherit;
  font-size: 0.74rem;
  color: var(--slate);
  cursor: pointer;
}
.kqa-add:hover {
  border-color: var(--gold);
  color: var(--gold-ink);
}
.kqa-in {
  width: 100%;
  margin-top: 6px;
  padding: 8px;
  border: 1px solid var(--gold);
  border-radius: 4px;
  font: inherit;
  font-size: 0.78rem;
  background: #fff;
  color: var(--ink);
}
body.dark-mode .kqa-in {
  background: rgba(0, 0, 0, 0.25);
}
```

### Step 13: Shortcut sheet and field guide

In `js/mmgr-shortcuts.js`, add two rows to the `app` table, after the RACI arrow row:

```js
      { keys: 'Alt + Left/Right', what: 'Move the focused Kanban card to another column' },
      { keys: 'Alt + Up/Down', what: 'Reorder the focused Kanban card inside its column' },
```

In `mymanager-field-guide.html`, A-05, Kanban tab, add:

```html
          <div class="card"><span class="cnum">MOVE</span><h4>Order and Quick Add</h4><p>Drag a card onto the top or bottom half of another card to place it exactly. Use the Add card row at the bottom of a column and type a name, an optional @assignee, and an optional due:2026-11-01. With a card focused, Alt plus an arrow moves or reorders it.</p></div>
```

### Step 14: Verify and commit

```bash
node build.js
node --test test/kanban-model.test.mjs
npm run verify
node tools/verify-actions.cjs
```

Manual checks, in addition to Step 8:

1. Click **+ Add card** in To Do, type `Fix door @Sam due:2026-11-01`, press Enter. A card appears with the name, assignee, and due date. The WBS table shows the same row.
2. Press Escape while the input is open. No card is created.
3. Add a card to a column whose limit is already exceeded. The card is created and the over-limit warning appears.
4. In view-only mode, **+ Add card** is refused with the view-only toast.
5. `?` opens the shortcut sheet and lists both Alt+arrow rows.

Commit:

```bash
git add js/mmgr-app.js js/mmgr-tasks.js js/render/kanban.js js/mmgr-shortcuts.js css/mmgr.css mymanager-field-guide.html sw.js
git commit -m "feat(kanban): add card ordering, keyboard moves, and quick add"
```

---

## Task 4: Board filters

**Files:**
- Modify: `project.html` (filter bar inside the Kanban card, above `.kb`)
- Modify: `js/mmgr-app.js` (`kbFilter`, `kbFilterClear`, action map, exports, allow-list, change and input whitelists)
- Modify: `js/render/kanban.js` (sync controls, assignee options, filtered-empty state)
- Modify: `css/mmgr.css`
- Modify: `mymanager-field-guide.html`

**Why:** Kanboard's board is filtered by a query string (`app/Filter/*`, `ProjectHeaderHelper`). My MaNaGeR does not need a query language, but it does need the four filters a site manager actually uses: text, assignee, due date, and flag. Filters are **ephemeral** on purpose: they are a lens, not project data, so they never enter the state object and never sync to another device.

### Step 1: Markup

In `project.html`, inside `#panel-kan .card`, directly after the opening `<div class="card mb0" >` and before the `.card-title`, add:

```html
      <div class="kbf" id="kb-filters">
        <input class="kbf-in kbf-text" type="search" id="kb-f-text" data-action="kbFilter" data-kb-filter="text" placeholder="Filter cards" aria-label="Filter cards by text" autocomplete="off">
        <select class="kbf-in" id="kb-f-who" data-action="kbFilter" data-kb-filter="assignee" aria-label="Filter cards by assignee">
          <option value="">Anyone</option>
        </select>
        <select class="kbf-in" id="kb-f-due" data-action="kbFilter" data-kb-filter="due" aria-label="Filter cards by due date">
          <option value="">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="week">Next 7 days</option>
          <option value="none">No due date</option>
        </select>
        <select class="kbf-in" id="kb-f-flag" data-action="kbFilter" data-kb-filter="flag" aria-label="Filter cards by flag">
          <option value="">Any flag</option>
          <option value="critical">Critical path</option>
          <option value="lead">Lead time</option>
          <option value="milestone">Milestone</option>
          <option value="recurring">Recurring</option>
        </select>
        <button class="btn btn-n btn-s" data-action="kbFilterClear" id="kb-f-clear">Clear</button>
        <span class="kbf-count is-hide" id="kb-f-count" role="status" aria-live="polite"></span>
      </div>
```

Placing it above the title keeps the title row (and its buttons) unchanged. The bar is static markup, so typing in it is never destroyed by a board render.

### Step 2: Handlers

In `js/mmgr-app.js`, next to `kbQuickAdd`, add:

```js
  // ---- Kanban filters (ephemeral) ----
  let kbFilterTimer = null;

  function kbFilter(el, e) {
    if (!el) {
      return;
    }
    const key = el.getAttribute('data-kb-filter');
    if (!key) {
      return;
    }
    const apply = function () {
      ns.Kanban.setFilters({ [key]: el.value });
      R.renderKanban();
    };
    // Text is debounced: a 300-card board should not rebuild four columns on
    // every keystroke. Selects apply immediately.
    if (key === 'text') {
      clearTimeout(kbFilterTimer);
      kbFilterTimer = setTimeout(apply, 120);
    } else {
      apply();
    }
  }

  function kbFilterClear() {
    clearTimeout(kbFilterTimer);
    ns.Kanban.clearFilters();
    R.renderKanban();
  }
```

The computed property name `{ [key]: el.value }` is ES6, already used elsewhere in the repo.

### Step 3: Answer the actions

In `ACTION_MAP`:

```js
    kbFilter: (el, e) => window.MMGR.App.kbFilter(el, e),
    kbFilterClear: () => window.MMGR.App.kbFilterClear(),
```

In the `MMGR.App` export block:

```js
    kbFilter: kbFilter,
    kbFilterClear: kbFilterClear,
```

### Step 4: Whitelists and view-only

- Add `action === 'kbFilter' ||` to **both** the change whitelist (line ~5395) and the input whitelist (line ~5458). The text box fires `input`; the selects fire `change`.
- Add `kbFilter: 1,` and `kbFilterClear: 1,` to `READONLY_SAFE_ACTIONS`. Filtering reads state and mutates only module memory.

`kbFilterClear` is a click action, so it needs no whitelist entry.

### Step 5: Sync the controls from the model

In `js/render/kanban.js`, add this inside `renderKanban()`, after `const K = boardModel();`:

```js
    const f = K.getFilters();

    function syncFilters() {
      const text = $('kb-f-text');
      if (text && text.value !== f.text) {
        text.value = f.text;
      }
      const who = $('kb-f-who');
      if (who) {
        const names = {};
        K.workItems(s).forEach(function (t) {
          if (t.assignee) {
            names[t.assignee] = 1;
          }
        });
        const list = Object.keys(names).sort();
        const signature = list.join('\n');
        // Rebuild only when the set changed, so an open select is not
        // replaced while the user is choosing.
        if (who.getAttribute('data-sig') !== signature) {
          who.innerHTML = '<option value="">Anyone</option>';
          list.forEach(function (name) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            who.appendChild(opt);
          });
          who.setAttribute('data-sig', signature);
        }
        who.value = f.assignee;
      }
      const due = $('kb-f-due');
      if (due) {
        due.value = f.due;
      }
      const flag = $('kb-f-flag');
      if (flag) {
        flag.value = f.flag;
      }
      const clear = $('kb-f-clear');
      if (clear) {
        clear.disabled = !K.filtersActive();
      }
      const count = $('kb-f-count');
      if (count) {
        const total = K.workItems(s).length;
        let shown = 0;
        K.COLUMNS.forEach(function (status) {
          shown += K.columnTasks(s, status).length;
        });
        count.textContent = K.filtersActive() ? shown + ' of ' + total + ' cards' : '';
        count.classList.toggle('is-hide', !K.filtersActive());
      }
    }
```

Call it once, before the column loop:

```js
    syncFilters();
```

`who.innerHTML` is assigned only static option markup. Project data goes in through `opt.textContent`, so the local `no-unsanitized-html` rule stays green.

### Step 6: Show a filtered-empty column

Inside the column loop, after the `noTasksAtAll` early return and before the final `el.innerHTML` assignment, add:

```js
      if (!tasks.length && info.count > 0 && K.filtersActive()) {
        el.innerHTML =
          '<div class="es kbf-empty">No cards match the filter.</div>' + quickAddMarkup(status);
        continue;
      }
```

This is the difference between "this column is empty" and "your filter hides everything here". Without it, a filter makes the board look broken.

### Step 7: Styles

In `css/mmgr.css`, after the `#kbwip-modal` block, add:

```css
.kbf {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 0 0 12px;
}
.kbf-in {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--ink);
  font: inherit;
  font-size: 0.78rem;
}
body.dark-mode .kbf-in {
  background: rgba(0, 0, 0, 0.25);
}
.kbf-text {
  flex: 1 1 180px;
  min-width: 140px;
}
.kbf select.kbf-in {
  flex: 0 1 150px;
}
.kbf-count {
  font-size: 0.72rem;
  color: var(--slate);
}
.kbf-empty {
  padding: 16px 10px;
  font-size: 0.74rem;
}
```

In the `@media (max-width: 520px)` block (around line 7266), add:

```css
  .kbf-in,
  .kbf select.kbf-in {
    flex: 1 1 100%;
  }
```

### Step 8: Field guide

In `mymanager-field-guide.html`, A-05, Kanban tab, add:

```html
          <div class="card"><span class="cnum">FILTER</span><h4>Focus the Board</h4><p>Filter by text, assignee, due date, or flag. The counter tells you how many cards are showing. Filters are a lens for this visit only and are not saved into the project.</p></div>
```

### Step 9: Verify and commit

```bash
node build.js
npm run verify
node tools/verify-actions.cjs
```

Manual checks:

1. Type part of a card name. Only matching cards remain, and the counter reads `X of Y cards`.
2. Choose an assignee. The assignee list is populated from the current tasks, sorted, and survives a board re-render.
3. Choose **Overdue**. Completed cards never appear, even with a past end date.
4. Choose **Next 7 days**. Cards due today through seven days out appear; yesterday and eight days out do not.
5. Clear. Every card returns and the counter hides.
6. Filter to a combination that hides a whole column. That column shows "No cards match the filter" rather than an empty box.
7. Filter, switch to WBS, then back to Kanban. The filter is still applied (module memory), which is expected; Clear resets it.
8. View-only mode: filters work.

Commit:

```bash
git add project.html js/mmgr-app.js js/render/kanban.js css/mmgr.css mymanager-field-guide.html sw.js
git commit -m "feat(kanban): add board filters"
```

---

## Task 5: Card detail sheet

**Files:**
- Modify: `js/mmgr-kanban.js` (export `daysBetween`)
- Modify: `project.html` (card sheet markup)
- Modify: `js/mmgr-app.js` (`kbCardOpen`, `kbCardClose`, `kbCardWbs`, action map, exports, allow-list)
- Modify: `js/render/kanban.js` (cards open the sheet)
- Modify: `css/mmgr.css`
- Modify: `mymanager-field-guide.html`

**Why:** Kanboard's board is editable in place: clicking a card opens the task modal over the board (`app/Template/task/show.php`). My MaNaGeR currently forces a tab switch to the WBS table for every edit. This task closes that gap without duplicating the field logic: every input goes through one small adapter, `kbCardField`, which calls the existing `ns.Tasks.updTaskField` function.

Why the adapter instead of `data-action="updTaskField"` on the sheet inputs? `updTaskField` re-renders the WBS through `rerenderPreservingFocus`, which finds a replacement by `[data-action][data-id][data-field]`. The WBS row comes first in the document, so a bare `updTaskField` sheet input would lose the caret to the WBS twin after every commit. A distinct action keeps that selector on the sheet input, which carries the same `data-id` and `data-field`.

### Step 1: Export the day helper

In `js/mmgr-kanban.js`, add `daysBetween: dayDiff,` to the `ns.Kanban` export object, next to `positionOf`.

### Step 2: Markup

In `project.html`, add this sheet next to `#kbwip-modal`:

```html
<!-- Kanban card sheet. Every field goes through kbCardField, which calls
     updTaskField: one write path, and the focused field is not stolen by
     the WBS twin the way a bare updTaskField action would be. -->
<div id="kbc-modal" role="dialog" aria-modal="true" aria-labelledby="kbc-title">
  <div class="mb kbc-box">
    <div class="mh">
      <span class="mt" id="kbc-title">Card</span>
      <button class="dc" data-action="kbCardClose" aria-label="Close"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg></button>
    </div>
    <div class="mbody">
      <label class="kbc-l" for="kbc-name">Name</label>
      <input class="kbc-in" id="kbc-name" type="text" maxlength="200" autocomplete="off" data-action="kbCardField" data-field="name">

      <div class="kbc-row">
        <div>
          <label class="kbc-l" for="kbc-status">Status</label>
          <select class="kbc-in" id="kbc-status" data-action="kbCardField" data-field="status">
            <option value="todo">To Do</option>
            <option value="inprogress">In Progress</option>
            <option value="blocked">Blocked</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <div>
          <label class="kbc-l" for="kbc-assignee">Assignee</label>
          <input class="kbc-in" id="kbc-assignee" type="text" maxlength="80" autocomplete="off" data-action="kbCardField" data-field="assignee">
        </div>
      </div>

      <div class="kbc-row kbc-row-3">
        <div>
          <label class="kbc-l" for="kbc-startDate">Start</label>
          <input class="kbc-in" id="kbc-startDate" type="date" data-action="kbCardField" data-field="startDate">
        </div>
        <div>
          <label class="kbc-l" for="kbc-endDate">End</label>
          <input class="kbc-in" id="kbc-endDate" type="date" data-action="kbCardField" data-field="endDate">
        </div>
        <div>
          <label class="kbc-l" for="kbc-duration">Days</label>
          <input class="kbc-in" id="kbc-duration" type="number" min="1" max="999" step="1" inputmode="numeric" data-action="kbCardField" data-field="duration">
        </div>
      </div>

      <label class="kbc-l" for="kbc-notes">Notes</label>
      <textarea class="kbc-in" id="kbc-notes" rows="6" data-action="kbCardField" data-field="notes"></textarea>

      <div class="kbc-meta" id="kbc-meta"></div>
    </div>
    <div class="mf">
      <button class="btn btn-n btn-s" data-action="kbCardClose">Close</button>
      <button class="btn btn-o btn-s" data-action="kbCardWbs" id="kbc-wbs">Open in WBS</button>
    </div>
  </div>
</div>
```

### Step 3: Open, fill, and guard the sheet

In `js/mmgr-app.js`, next to `kbFilterClear`, add:

```js
  // ---- Kanban card sheet ----
  const KB_CARD_FIELDS = [
    'name',
    'status',
    'assignee',
    'startDate',
    'endDate',
    'duration',
    'notes'
  ];

  function kbCardField(el, e) {
    if (!el || isReadonly()) {
      return;
    }
    const modal = document.getElementById('kbc-modal');
    const id = modal && modal.getAttribute('data-card-id');
    const field = el.getAttribute('data-field');
    if (!id || !field) {
      return;
    }
    // One write path: dates, duration, status stamps, and WBS sync all stay
    // in updTaskField. This adapter only supplies the card id and field name.
    ns.Tasks.updTaskField(id, field, el.value, e && e.type);
  }

  function renderCardMeta(task) {
    const el = document.getElementById('kbc-meta');
    if (!el || !task) {
      return;
    }
    const bits = [];
    if (task.createdDate) {
      bits.push('Created ' + U.fmtDate(task.createdDate));
    }
    if (task.startedDate) {
      bits.push('Started ' + U.fmtDate(task.startedDate));
    }
    if (task.completedDate) {
      bits.push('Completed ' + U.fmtDate(task.completedDate));
    }
    if (task.statusSince) {
      bits.push('In this column since ' + U.fmtDate(task.statusSince));
    }
    if (task.createdDate && task.completedDate) {
      const lead = ns.Kanban.daysBetween(task.completedDate, task.createdDate);
      if (lead !== null) {
        bits.push('Lead time ' + lead + ' days');
      }
    }
    if (task.startedDate && task.completedDate) {
      const cycle = ns.Kanban.daysBetween(task.completedDate, task.startedDate);
      if (cycle !== null) {
        bits.push('Cycle time ' + cycle + ' days');
      }
    }
    el.textContent = bits.length ? bits.join(' | ') : 'No dates recorded yet.';
  }

  function kbCardOpen(el) {
    const id = typeof el === 'string' ? el : el && el.getAttribute('data-id');
    const task = (S().tasks || []).find(function (t) {
      return t && t.id === id;
    });
    const modal = document.getElementById('kbc-modal');
    if (!task || !modal) {
      return;
    }
    KB_CARD_FIELDS.forEach(function (field) {
      const input = document.getElementById('kbc-' + field);
      if (!input) {
        return;
      }
      input.setAttribute('data-id', id);
      input.value = task[field] === undefined || task[field] === null ? '' : task[field];
    });
    const readOnly = isReadonly();
    modal.querySelectorAll('.kbc-in').forEach(function (input) {
      input.disabled = readOnly;
    });
    renderCardMeta(task);
    modal.setAttribute('data-card-id', id);
    modal.classList.add('on');
    if (!modal.getAttribute('data-bound')) {
      // The board re-renders on every field commit; the sheet does not.
      // Refresh its meta line after the write settles, without touching the
      // input the user is still in.
      modal.addEventListener('change', function () {
        const openId = modal.getAttribute('data-card-id');
        if (!openId) {
          return;
        }
        setTimeout(function () {
          const fresh = (S().tasks || []).find(function (t) {
            return t && t.id === openId;
          });
          renderCardMeta(fresh);
        }, 0);
      });
      modal.setAttribute('data-bound', '1');
    }
    const name = document.getElementById('kbc-name');
    if (name && !readOnly) {
      name.focus();
    }
  }

  function kbCardClose() {
    const modal = document.getElementById('kbc-modal');
    if (modal) {
      modal.classList.remove('on');
      modal.removeAttribute('data-card-id');
    }
  }

  function kbCardWbs() {
    const modal = document.getElementById('kbc-modal');
    const id = modal && modal.getAttribute('data-card-id');
    kbCardClose();
    showSec('wbs');
    if (id) {
      setTimeout(function () {
        const row = document.querySelector('#wbs-body tr.wbs-row[data-id="' + id + '"]');
        if (row) {
          row.scrollIntoView({ block: 'center' });
        }
      }, 0);
    }
  }

  // The Enter key and the empty-card keyboard handler both call this.
  window.MMGR.KanbanCard = { open: kbCardOpen, close: kbCardClose };
```

Read-only handling: fields are `disabled`, so `updTaskField` cannot fire. The sheet still opens and the meta line is readable.

### Step 4: Make cards open the sheet

In `js/render/kanban.js`, in `kanbanCard`, add the action and tab stop to the opening tag:

```js
      '" draggable="true" tabindex="0" role="button" data-action="kbCardOpen" aria-label="' +
      U.escapeHtml(t.name + ', ' + (t.status || 'todo')) +
      '" data-drag-id="' +
```

Do the same in `kanbanLeadtimeCard` with the label `t.name + ', lead time'`. The Task 3 `tabindex` and `role` are now joined by `data-action`, so there is one opening tag, not two.

### Step 5: Answer the actions

In `ACTION_MAP`:

```js
    kbCardOpen: el => window.MMGR.App.kbCardOpen(el),
    kbCardClose: () => window.MMGR.App.kbCardClose(),
    kbCardWbs: () => window.MMGR.App.kbCardWbs(),
    kbCardField: (el, e) => window.MMGR.App.kbCardField(el, e),
```

In the `MMGR.App` export block:

```js
    kbCardOpen: kbCardOpen,
    kbCardClose: kbCardClose,
    kbCardWbs: kbCardWbs,
    kbCardField: kbCardField,
```

### Step 6: Whitelist, view-only, and Escape

The sheet fields fire `change`, so add `action === 'kbCardField' ||` to the **change** whitelist (around line 5395), next to `updTaskField`. Do not add it to the `input` whitelist: saving notes on every keystroke would rebuild the board and fight the caret.

Add all three navigation actions to `READONLY_SAFE_ACTIONS`:

```js
    // Opening, closing, and jumping to the WBS row mutate nothing. The
    // sheet's inputs are disabled when isReadonly() is true.
    kbCardOpen: 1,
    kbCardClose: 1,
    kbCardWbs: 1,
```

Do **not** add `kbCardField`. It writes state, and the guard must refuse it even if a disabled control is triggered another way.

Add one Escape listener next to the quick-add keydown:

```js
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') {
      return;
    }
    const modal = document.getElementById('kbc-modal');
    if (modal && modal.classList.contains('on')) {
      kbCardClose();
    }
  });
```

### Step 7: Styles

In `css/mmgr.css`, after the `.kbf` block:

```css
/* Kanban card sheet. Wide enough for two date columns, never wider than
   the viewport, and scrollable on a phone. */
#kbc-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  z-index: 9999;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
#kbc-modal.on {
  display: flex;
}
#kbc-modal .mb {
  width: 560px;
  max-width: 100%;
  max-height: 86vh;
}
.kbc-box .mbody {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: auto;
}
.kbc-l {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--slate);
  margin-top: 8px;
}
.kbc-in {
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--ink);
  font: inherit;
  font-size: 0.82rem;
}
.kbc-in:disabled {
  background: #f1f5f9;
  color: var(--slate);
  cursor: not-allowed;
}
body.dark-mode .kbc-in {
  background: rgba(0, 0, 0, 0.25);
}
body.dark-mode .kbc-in:disabled {
  background: rgba(0, 0, 0, 0.35);
}
textarea.kbc-in {
  resize: vertical;
  min-height: 96px;
}
.kbc-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.kbc-row-3 {
  grid-template-columns: 1fr 1fr 90px;
}
.kbc-meta {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  font-size: 0.72rem;
  color: var(--slate);
  line-height: 1.5;
}
```

In `@media (max-width: 520px)`:

```css
  .kbc-row,
  .kbc-row-3 {
    grid-template-columns: 1fr;
  }
```

### Step 8: Field guide

In `mymanager-field-guide.html`, A-05, Kanban tab, add:

```html
          <div class="card"><span class="cnum">CARD</span><h4>Edit Without Leaving</h4><p>Click a card or press Enter on a focused card to open its sheet. Name, status, assignee, dates, days, and notes save as you go. The footer shows what the dates mean: lead time from created to completed, cycle time from started to completed.</p></div>
```

### Step 9: Verify and commit

```bash
node build.js
npm run verify
node tools/verify-actions.cjs
```

Manual checks:

1. Click a card. The sheet opens with the card's values, and focus is in the Name field.
2. Change the status to Completed. Close the sheet. The card is in Completed and the WBS row agrees. Reopen the sheet: `Completed` and `In this column since` show today.
3. Change the status back to In Progress. The completed date disappears from the meta line (it is deleted, not stale).
4. Edit notes. Type several characters without losing the caret.
5. Press Enter on a focused card. The sheet opens (same as click).
6. Press Escape. The sheet closes and focus returns to the page.
7. Click **Open in WBS**. The WBS tab opens and scrolls the row into view.
8. View-only mode: the sheet opens with every field disabled and no save is possible.

Commit:

```bash
git add js/mmgr-kanban.js project.html js/mmgr-app.js js/render/kanban.js css/mmgr.css mymanager-field-guide.html sw.js
git commit -m "feat(kanban): add an in-place card sheet"
```

---

## Task 6: Swimlanes

**Files:**
- Modify: `project.html` (lane selector, board id, lane container)
- Modify: `js/mmgr-app.js` (`kbLaneMode`, lane-aware drop, action map, export, allow-list, change whitelist)
- Modify: `js/render/kanban.js` (lane sections, summary chips)
- Modify: `css/mmgr.css`
- Modify: `mymanager-field-guide.html`

**Why:** A 60-card board is a wall. Kanboard splits the board into horizontal swimlanes, each with its own copy of the columns (`table_swimlane.php`). My MaNaGeR should do the same, but **derived**, not stored: a lane is a group of the same cards by `assignee` or by `parentName`. There is no lane entity, no new id, no migration, and no second copy of a task.

**Scope rule:** dropping a card into an assignee lane reassigns the card. Dropping into a phase lane only changes the status; it never reparents a WBS row, because reparenting changes the schedule and belongs in the WBS table.

### Step 1: Markup

In `project.html`:

1. Give the existing board grid an id. Change `<div class="kb">` to `<div class="kb" id="kb-board">`.
2. Add the lane mode selector to the Kanban header `.g6`, after the Column Limits button:

```html
          <select class="kbf-in kbsel" id="kb-lane-mode" data-action="kbLaneMode" aria-label="Group the board into lanes">
            <option value="none">No lanes</option>
            <option value="assignee">Lanes by assignee</option>
            <option value="parent">Lanes by phase</option>
          </select>
```

3. Directly after the closing `</div>` of the board grid (`#kb-board`), add:

```html
      <div class="kbsum is-hide" id="kb-summary" aria-label="Board totals"></div>
      <div class="kb-lanes is-hide" id="kb-lanes"></div>
```

The Lead-Time column stays inside `.kb`, after Completed. In lane mode the renderer hides the whole grid, so the dedicated lane is not shown twice; a lead-time card still appears in its status lane with its dashed border, and the dedicated lane returns when the lane mode is set back to No lanes.

### Step 2: Lane-aware drops

In `js/mmgr-app.js`, extend `applyMove` with a fourth argument:

```js
  function applyMove(id, status, beforeId, lane) {
```

Inside the `updateState` callback, after `stampStatus` and before assigning `moved`:

```js
      // Assignee lanes are editable: dropping Sam's card into Alex's lane
      // reassigns it. Phase lanes are informational: reparenting a WBS row
      // is a schedule change, so it stays in the WBS table.
      if (lane && lane.mode === 'assignee') {
        task.assignee = lane.key === 'Unassigned' ? '' : lane.key;
      }
```

Update `dropCard`'s signature and call:

```js
  function dropCard(ev, status, beforeId, lane) {
```

```js
      applyMove(dragTaskId, status, beforeId || null, lane || null);
```

Update the document `drop` listener:

```js
  document.addEventListener('drop', function (e) {
    const col = e.target.closest('[data-drop-status]');
    if (!col) {
      return;
    }
    e.preventDefault();
    const status = col.getAttribute('data-drop-status');
    if (status === 'leadtime') {
      window.MMGR.App.dropCardLeadtime(e);
      return;
    }
    const laneMode = col.getAttribute('data-lane-mode');
    const lane = laneMode
      ? { mode: laneMode, key: col.getAttribute('data-lane-key') || '' }
      : null;
    window.MMGR.App.dropCard(e, status, dropBeforeId(col, e.clientY), lane);
  });
```

### Step 3: Persist the lane mode

In `js/mmgr-app.js`, next to `kbWip`, add:

```js
  function kbLaneMode(el) {
    if (!el || isReadonly()) {
      if (isReadonly()) {
        showToast('View-only access: the board can be read but not changed.', 'err');
      }
      return;
    }
    const mode = el.value === 'assignee' || el.value === 'parent' ? el.value : 'none';
    ns.State.updateState(function (s) {
      ns.Kanban.ensureSettings(s);
      s.kanban.swimlane = mode;
    });
    R.renderKanban();
  }
```

This is a persisted setting, so it is **not** in `READONLY_SAFE_ACTIONS`.

Add to `ACTION_MAP`:

```js
    kbLaneMode: el => window.MMGR.App.kbLaneMode(el),
```

Add to the `MMGR.App` export block:

```js
    kbLaneMode: kbLaneMode,
```

Add `action === 'kbLaneMode' ||` to the **change** whitelist only. The select fires `change`.

### Step 4: Render lanes

In `js/render/kanban.js`, inside `renderKanban()`, after `syncFilters()` and before the column loop, add:

```js
    const mode = (s.kanban && s.kanban.swimlane) || 'none';
    const lanesEl = $('kb-lanes');
    const summaryEl = $('kb-summary');
    const boardEl = $('kb-board');
    const laneSelect = $('kb-lane-mode');
    if (laneSelect) {
      laneSelect.value = mode;
      // The app owns the read-only decision; the renderer mirrors it so a
      // blocked change cannot leave the select showing a mode the board is
      // not in.
      laneSelect.disabled = !!(
        window.MMGR.App &&
        window.MMGR.App.isReadonly &&
        window.MMGR.App.isReadonly()
      );
    }
    const useLanes = mode !== 'none' && !noTasksAtAll;
    if (boardEl) {
      // Lane mode hides the status board, Lead-Time column included. The
      // cards are still there: a lead-time card keeps its dashed border in
      // its status lane, and the dedicated lane returns with No lanes.
      boardEl.classList.toggle('is-hide', useLanes);
    }
    if (lanesEl) {
      lanesEl.classList.toggle('is-hide', !useLanes);
    }
    if (summaryEl) {
      summaryEl.classList.toggle('is-hide', !useLanes);
      if (useLanes) {
        summaryEl.innerHTML = K.COLUMNS.map(function (status) {
          const info = K.wip(s, status);
          return (
            '<span class="kbsum-c' +
            (info.over ? ' over' : '') +
            '">' +
            U.escapeHtml(K.LABELS[status]) +
            ' ' +
            info.count +
            (info.limit ? ' / ' + info.limit : '') +
            '</span>'
          );
        }).join('');
      }
    }

    function laneColumn(status, lane, laneMode) {
      const info = K.wip(s, status);
      const cls =
        { todo: 'col-todo', inprogress: 'col-ip', blocked: 'col-bl', completed: 'col-dn' }[
          status
        ] || '';
      const tasks = lane.tasks
        .filter(function (t) {
          return (t.status || 'todo') === status;
        })
        .sort(function (a, b) {
          return K.positionOf(a) - K.positionOf(b);
        });
      const over = info.over;
      return (
        '<div class="kcol ' +
        cls +
        (over ? ' kcol-over' : '') +
        '" data-drop-status="' +
        status +
        '" data-lane-mode="' +
        laneMode +
        '" data-lane-key="' +
        U.escapeHtml(lane.key) +
        '">' +
        '<div class="kch"><span class="kct">' +
        U.escapeHtml(K.LABELS[status]) +
        '</span><span class="wip">' +
        tasks.length +
        '</span></div>' +
        '<div class="kcc">' +
        (tasks.length
          ? tasks.map(kanbanCard).join('')
          : '<div class="es kbf-empty">No cards here.</div>') +
        '</div></div>'
      );
    }

    if (useLanes && lanesEl) {
      const visible = K.workItems(s).filter(function (t) {
        return K.matchTask(t, K.getFilters());
      });
      const lanes = K.laneGroups(visible, mode);
      lanesEl.innerHTML = lanes
        .map(function (lane) {
          return (
            '<section class="kblane" aria-label="' +
            U.escapeHtml(lane.label) +
            '">' +
            '<div class="kblane-h"><span class="kblane-t">' +
            U.escapeHtml(lane.label) +
            '</span><span class="kblane-n">' +
            lane.tasks.length +
            '</span></div>' +
            '<div class="kb kblane-grid">' +
            K.COLUMNS.map(function (status) {
              return laneColumn(status, lane, mode);
            }).join('') +
            '</div></section>'
          );
        })
        .join('');
    } else if (lanesEl) {
      lanesEl.innerHTML = '';
    }
```

**Important:** the static column loop must not run in lane mode, or it will draw a second, unfiltered board underneath. Wrap it:

```js
    if (!useLanes) {
      for (const col of cols) {
        // ... existing loop body unchanged ...
      }
    }
```

The Lead-Time block after the loop stays outside the `if`, so the lane still renders below the swimlanes.

Every over indicator, the column edge, the header badge, the summary chip, and the lane column, reads the same board-wide `info.over` flag. A lane badge is a count, not a separate limit; Kanboard's per-swimlane limits are deliberately not added, because a lane here is a derived view. The field guide wording says limits are board-wide targets.

Swimlanes do not offer the quick-add row: a new card needs an assignee or phase to know which lane it belongs to, and guessing would be worse than asking. Switch to **No lanes** to add a card; the plan's manual checks use the plain board for that reason.

### Step 5: Styles

In `css/mmgr.css`, after the `.kqa-in` block:

```css
.kbsel {
  flex: 0 1 170px;
}
.kbsum {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 0 12px;
}
.kbsum-c {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 3px 9px;
  border: 1px solid var(--border);
  border-radius: 100px;
  background: #f8fafc;
  color: var(--slate);
}
.kbsum-c.over {
  border-color: var(--danger);
  background: rgba(239, 68, 68, 0.12);
  color: var(--danger);
}
.kb-lanes {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.kblane {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.kblane-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  background: #f8fafc;
  border-bottom: 1px solid var(--border);
}
body.dark-mode .kbsum-c,
body.dark-mode .kblane-h {
  background: rgba(255, 255, 255, 0.05);
}
.kblane-t {
  font-size: 0.78rem;
  font-weight: 700;
}
.kblane-n {
  font-size: 0.68rem;
  color: var(--slate);
}
.kblane-grid {
  border: 0;
}
```

The lane grid reuses `.kb`, so the existing responsive rules (two columns at 768 px, one at 520 px) apply to every lane automatically.

### Step 6: Field guide

In `mymanager-field-guide.html`, A-05, Kanban tab, add:

```html
          <div class="card"><span class="cnum">LANE</span><h4>Swimlanes</h4><p>Group the board by assignee or by phase. A lane is a view of the same cards, not a copy. Drop a card into another assignee's lane to reassign it. Phase lanes are informational; move a task between phases in the WBS table.</p></div>
```

### Step 7: Verify and commit

```bash
node build.js
npm run verify
node tools/verify-actions.cjs
```

Manual checks:

1. Choose **Lanes by assignee**. The board splits into one lane per assignee, plus Unassigned last. Every card appears exactly once.
2. Drop a card from Sam's lane into Alex's lane. The card's assignee becomes Alex, it appears in Alex's lane, and the WBS row agrees.
3. Drop an Unassigned card into Sam's lane. It gains Sam.
4. Choose **Lanes by phase**. Dropping a card into another phase's lane changes its status only; its WBS parent does not change.
5. Apply a text filter in lane mode. Empty lanes disappear; a lane with no visible card in a status shows "No cards here."
6. Set In Progress to a limit below the total. The summary chip and each In Progress lane column turn red. Lane badges show lane counts, not the global limit.
7. Reload. The lane mode persists.
8. At 390 px wide, each lane stacks to one column per row and the page does not scroll sideways.
9. View-only: the lane selector is disabled, and the current lane view still renders.

Commit:

```bash
git add project.html js/mmgr-app.js js/render/kanban.js css/mmgr.css mymanager-field-guide.html sw.js
git commit -m "feat(kanban): add derived swimlanes"
```

---

## Task 7: Flow metrics under the board

**Files:**
- Modify: `js/mmgr-kanban.js` (`flow` returns throughput; export unchanged otherwise)
- Modify: `test/kanban-model.test.mjs` (throughput assertion)
- Modify: `project.html` (footer strip)
- Modify: `js/render/kanban.js` (render the strip)
- Modify: `css/mmgr.css`
- Modify: `mymanager-field-guide.html`

**Why:** A board should answer "how long does work take here". Kanboard computes lead time as `date_completed - date_creation` and cycle time as `date_completed - date_started` (`TaskAnalyticModel.php:22,34`). This task shows the same two averages, plus a simple seven-day throughput count, without adding a chart library or a server.

### Step 1: Add throughput to the model

In `js/mmgr-kanban.js`, `flow` currently takes only the state. Give it the date it needs and add a counter before `done.forEach`:

```js
  function flow(state, todayIso) {
    const today = todayIso || todayStr();
```

```js
    let recent = 0;
```

Inside the loop, after the cycle calculation:

```js
      if (t.completedDate) {
        const ago = dayDiff(today, t.completedDate);
        if (ago !== null && ago >= 0 && ago <= 6) {
          recent += 1;
        }
      }
```

Add `throughput: recent,` to the returned object, next to `completed`.

The definition is deliberately simple: completed cards whose `completedDate` falls in the last seven calendar days, today included. It is not a rolling velocity and it does not pretend to be.

### Step 2: Update the unit test

In `test/kanban-model.test.mjs`, in the `flow averages only cards with both dates` test, add:

```js
  assert.equal(f.throughput, 2);
```

With `2026-10-21` and `2026-10-25` completed and `today = 2026-10-25`, both fall inside the seven-day window. The third card has no date and is excluded.

### Step 3: Markup

In `project.html`, after the closing `</div>` of the board grid (`#kb-board`) and after `#kb-lanes`, add:

```html
      <div class="kbflow" id="kb-flow" aria-live="polite"></div>
```

Place it **before** the closing `</div>` of the card that contains the board, so it sits directly under the lanes and above the card edge.

### Step 4: Render the strip

In `js/render/kanban.js`, after the lane block and before the lead-time block, add:

```js
    const flowEl = $('kb-flow');
    if (flowEl) {
      const f = K.flow(s);
      if (!f.completed) {
        flowEl.innerHTML =
          '<span class="kbflow-empty">Flow metrics appear here after you complete cards.</span>';
      } else {
        const lead =
          f.avgLead === null
            ? '<b>No data</b> avg lead'
            : '<b>' + f.avgLead + 'd</b> avg lead';
        const cycle =
          f.avgCycle === null
            ? '<b>No data</b> avg cycle'
            : '<b>' + f.avgCycle + 'd</b> avg cycle';
        flowEl.innerHTML =
          '<span class="kbflow-c"><b>' +
          f.completed +
          '</b> completed</span>' +
          '<span class="kbflow-c" title="' +
          (f.leadSamples
            ? 'Based on ' + f.leadSamples + ' completed cards with a created date.'
            : 'No completed card has both a created date and a completed date yet.') +
          '">' +
          lead +
          '</span>' +
          '<span class="kbflow-c" title="' +
          (f.cycleSamples
            ? 'Based on ' + f.cycleSamples + ' completed cards with a started date.'
            : 'No completed card has both a started date and a completed date yet.') +
          '">' +
          cycle +
          '</span>' +
          '<span class="kbflow-c"><b>' +
          f.throughput +
          '</b> finished in 7 days</span>';
      }
    }
```

The tooltips are the honesty mechanism: an average with two samples must not look like a trend. Never hide the sample count.

### Step 5: Styles

In `css/mmgr.css`, after the `.kblane-grid` block:

```css
.kbflow {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  padding: 12px 2px 2px;
  border-top: 1px solid var(--border);
  margin-top: 14px;
  font-size: 0.72rem;
  color: var(--slate);
}
.kbflow-c b {
  color: var(--ink);
  font-size: 0.78rem;
}
.kbflow-empty {
  color: var(--slate);
}
```

At 520 px, the strip already wraps; no extra rule is needed.

### Step 6: Field guide

In `mymanager-field-guide.html`, A-05, Kanban tab, add:

```html
          <div class="card"><span class="cnum">FLOW</span><h4>Flow Metrics</h4><p>The strip under the board shows completed cards, average lead time from created to completed, average cycle time from started to completed, and how many cards finished in the last seven days. The averages are based only on cards that carry both dates, and the tooltip tells you the sample size.</p></div>
```

### Step 7: Verify and commit

```bash
node build.js
node --test test/kanban-model.test.mjs
npm run verify
```

Manual checks:

1. Complete a card today. The strip shows `1 completed`, `0d avg lead` (if created today), `0d avg cycle`, and `1 finished in 7 days`.
2. Complete a card with no `createdDate` (an older project migrated from v22). It counts as completed but not in the lead average. Its tooltip says the sample is based on fewer cards.
3. Filter the board. The metrics do not change, because they describe the project, not the current lens.
4. A project with no completed cards shows the plain "Flow metrics appear here after you complete cards." line.

Commit:

```bash
git add js/mmgr-kanban.js test/kanban-model.test.mjs project.html js/render/kanban.js css/mmgr.css mymanager-field-guide.html sw.js
git commit -m "feat(kanban): show flow metrics under the board"
```

---

## Task 8: Browser QA harness, CI wiring, and final verification

**Files:**
- Create: `tools/qa-kanban.cjs`
- Modify: `.github/workflows/ci.yml` (T4 step)
- Modify: `docs/CI-TEST-COVERAGE.md` (registry row)
- Modify: `sw.js` (cache bump)
- Modify: `docs/DEVELOPER-GUIDE.md` if the module row is missing

**Why:** The unit tests prove the model. They cannot prove that drag/drop, the delegated actions, the sheet, lanes, persistence, and the view-only guard still work in a real browser. This harness is the regression net for the whole feature.

### Step 1: Create the harness

Start from `tools/qa-procurement.cjs`. Keep its header style and copy the standard kit **unchanged**:

- `resolvePlaywright()` (around line 77)
- `absolutizeChrome()` (around line 99)
- `ensureServer()` (around line 138)

Then use this gate body. It is self-contained apart from those three helpers.

```js
#!/usr/bin/env node
/* ============================================================
   My MaNaGeR, Kanban board mechanics QA (qa-kanban)
   ------------------------------------------------------------
   Real browser (Playwright + the repo's chrome-launcher) against
   serve.cjs. Proves the board behaves as a board, not a list:

     K1  model + schema v23 are live
     K2  cards render in boardPosition order
     K3  WIP limit shows count/limit and the over state
     K4  Alt+Up reorders inside a column
     K5  Alt+Right changes status and stamps startedDate
     K6  a move to Completed stamps completedDate (the old bug)
     K7  quick add parses @assignee and due:date
     K8  a text filter narrows the board and Clear restores it
     K9  the card sheet opens, is modal, and saves a status change
     K10 assignee lanes appear, Unassigned last
     K11 flow metrics render
     K12 WIP limit and lane mode survive a reload
     K13 view-only blocks moves and disables sheet fields
     K14 zero page errors
     K15 390 px: no horizontal page scroll
     K16 the Lead-Time lane still toggles

   Usage:   node tools/qa-kanban.cjs
   Registry: docs/CI-TEST-COVERAGE.md (CI row) + ci.yml T4 step.
   ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const PORT = 8765;
const BASE = process.env.QA_BASE || process.argv[2] || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = s => process.stdout.write('[kanban] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) {
    passed++;
    log('PASS  ' + name);
  } else {
    failed++;
    log('FAIL  ' + name + '   <-- ' + JSON.stringify(detail === undefined ? null : detail));
  }
};

// ---- kit: copy resolvePlaywright / absolutizeChrome / ensureServer from
// ---- tools/qa-procurement.cjs unchanged.

(async () => {
  let srv = null;
  let browser = null;
  const { chromium } = resolvePlaywright();
  let executablePath;
  try {
    executablePath = require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {
    /* fall back to playwright's own browser */
  }
  executablePath = absolutizeChrome(executablePath);
  try {
    srv = await ensureServer();
    browser = await chromium.launch({ headless: true, executablePath });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pageErrors = [];
    const page = await ctx.newPage();
    page.on('pageerror', e => pageErrors.push(String((e && e.message) || e).slice(0, 160)));

    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('mmgr_unlocked_demo-project', '1');
        const scope = sessionStorage.getItem('qa_scope') || 'full';
        localStorage.setItem('mmgr_scope_demo-project', scope);
      } catch (e) {}
      // A stale journal can win the boot restore. The harness owns the
      // fixture, so drop the journal before every navigation.
      try {
        indexedDB.deleteDatabase('mmgr_journal');
      } catch (e) {}
    });

    const boot = async () => {
      await page.goto(BASE + '/project.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.MMGR && !!window.MMGR.Kanban, null, {
        timeout: 15000
      });
      await page.evaluate(() => window.MMGR.App.showSec('kan'));
      await page.waitForSelector('#panel-kan.active');
      await delay(120);
    };

    await boot();

    // Deterministic fixture. Written through the app's own state API so the
    // full default shape and every migration are already in place.
    await page.evaluate(() => {
      const T = (id, name, status, pos, extra) =>
        Object.assign(
          {
            id: id,
            name: name,
            level: 0,
            indent: 0,
            isPhase: false,
            status: status,
            startDate: '',
            endDate: '',
            duration: '',
            assignee: '',
            critical: false,
            leadTime: false,
            recurring: false,
            weatherExposed: false,
            confidence: 'high',
            predecessors: [],
            notes: '',
            weatherSensitive: false,
            boardPosition: pos,
            createdDate: '2026-10-01'
          },
          extra || {}
        );
      window.MMGR.State.updateState(function (s) {
        s.tasks = [
          T('t1', 'Alpha', 'todo', 0, { assignee: 'Sam', endDate: '2026-10-20' }),
          T('t2', 'Bravo', 'todo', 1, { assignee: 'Alex', endDate: '2026-11-30' }),
          T('t8', 'Hotel', 'todo', 2, {}),
          T('t9', 'India', 'todo', 3, { leadTime: true }),
          T('t3', 'Charlie', 'inprogress', 0, { assignee: 'Sam' }),
          T('t4', 'Delta', 'inprogress', 1, { assignee: 'Alex' }),
          T('t5', 'Echo', 'blocked', 0, { assignee: 'Sam' }),
          T('t6', 'Foxtrot', 'completed', 0, {
            assignee: 'Sam',
            startDate: '2026-10-05',
            completedDate: '2026-10-20'
          }),
          T('t7', 'Golf', 'completed', 1, { assignee: 'Alex', completedDate: '2026-10-24' })
        ];
        s.kanban = {
          wip: { todo: 0, inprogress: 1, blocked: 0, completed: 0 },
          swimlane: 'none'
        };
        s.kbShowLeadtime = false;
        s.flags = s.flags || {};
        s.flags.leadtimeLane = true;
      });
      window.MMGR.State.save(true);
      window.MMGR.Render.renderKanban();
    });
    await delay(150);

    const names = status =>
      page.$$eval('#kc-' + status + ' .kc .cn', els =>
        els.map(e => e.textContent.trim())
      );
    const state = () =>
      page.evaluate(() => JSON.parse(JSON.stringify(window.MMGR.State.getState())));
    const findTask = async id => (await state()).tasks.find(t => t.id === id);

    // K1
    const k1 = await page.evaluate(
      () =>
        !!window.MMGR.Kanban &&
        typeof window.MMGR.Kanban.moveTo === 'function' &&
        window.MMGR.State.SCHEMA_VERSION === 23
    );
    check('K1 model + schema v23', k1);

    // K2
    const todo = await names('todo');
    check('K2 cards render in boardPosition order', JSON.stringify(todo) === JSON.stringify(['Alpha', 'Bravo', 'Hotel', 'India']), todo);

    // K3
    const wipText = (await page.locator('#w-ip').innerText()).trim();
    const wipOver = await page.locator('#w-ip.over').count();
    const colOver = await page.locator('#col-ip.kcol-over').count();
    check('K3 WIP count/limit + over state', wipText === '2 / 1' && wipOver === 1 && colOver === 1, {
      wipText,
      wipOver,
      colOver
    });

    // K4
    await page.locator('#kc-todo .kc[data-id="t8"]').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await delay(80);
    const reordered = await names('todo');
    check('K4 Alt+Up reorders in column', reordered[1] === 'Hotel', reordered);

    // K5
    await page.locator('#kc-todo .kc[data-id="t2"]').focus();
    await page.keyboard.press('Alt+ArrowRight');
    await delay(100);
    const t2 = await findTask('t2');
    check('K5 Alt+Right changes status + startedDate', t2.status === 'inprogress' && !!t2.startedDate, {
      status: t2.status,
      startedDate: t2.startedDate
    });

    // K6 (the old drag-to-completed bug)
    await page.locator('#kc-ip .kc[data-id="t2"]').focus();
    await page.keyboard.press('Alt+ArrowRight');
    await delay(80);
    await page.locator('#kc-bl .kc[data-id="t2"]').focus();
    await page.keyboard.press('Alt+ArrowRight');
    await delay(120);
    const t2done = await findTask('t2');
    check('K6 move to Completed stamps completedDate', t2done.status === 'completed' && !!t2done.completedDate, {
      status: t2done.status,
      completedDate: t2done.completedDate
    });

    // K7
    await page.locator('#kc-todo .kqa-add').click();
    const qa = page.locator('#kc-todo .kqa-in');
    await qa.fill('Juliet @Sam due:2026-12-01');
    await qa.press('Enter');
    await delay(150);
    const all = await state();
    const juliet = all.tasks.find(t => t.name === 'Juliet');
    check('K7 quick add parses @who and due:', !!juliet && juliet.assignee === 'Sam' && juliet.endDate === '2026-12-01' && juliet.status === 'todo', juliet && { assignee: juliet.assignee, endDate: juliet.endDate, status: juliet.status });

    // K8
    await page.locator('#kb-f-text').fill('Alpha');
    await delay(220);
    const filtered = await names('todo');
    check('K8 text filter narrows the board', filtered.length === 1 && filtered[0] === 'Alpha', filtered);
    await page.locator('#kb-f-clear').click();
    await delay(120);

    // K9
    await page.locator('#kc-todo .kc[data-id="t1"]').click();
    const sheetOpen = await page.locator('#kbc-modal.on').count();
    const sheetModal = await page.getAttribute('#kbc-modal', 'aria-modal');
    const sheetName = await page.inputValue('#kbc-name');
    await page.selectOption('#kbc-status', 'completed');
    await delay(150);
    const t1 = await findTask('t1');
    check('K9 card sheet opens, is modal, and saves', sheetOpen === 1 && sheetModal === 'true' && sheetName === 'Alpha' && t1.status === 'completed' && !!t1.completedDate, {
      sheetOpen,
      sheetModal,
      sheetName,
      status: t1.status,
      completedDate: t1.completedDate
    });
    await page.keyboard.press('Escape');
    await delay(80);

    // K10
    await page.selectOption('#kb-lane-mode', 'assignee');
    await delay(180);
    const lanes = await page.$$eval('.kblane-t', els => els.map(e => e.textContent.trim()));
    check('K10 assignee lanes, Unassigned last', lanes.length >= 3 && lanes.includes('Sam') && lanes.includes('Alex') && lanes[lanes.length - 1] === 'Unassigned', lanes);

    // K11
    const flowText = await page.locator('#kb-flow').innerText();
    check('K11 flow metrics render', /completed/.test(flowText) && /avg lead/.test(flowText) && /avg cycle/.test(flowText), flowText);

    // K12
    await page.selectOption('#kb-lane-mode', 'none');
    await delay(120);
    // Force the debounced save before reloading, or the test reads a
    // pre-change localStorage copy.
    await page.evaluate(() => window.MMGR.State.save(true));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.MMGR && !!window.MMGR.Kanban, null, { timeout: 15000 });
    await page.evaluate(() => window.MMGR.App.showSec('kan'));
    await page.waitForSelector('#panel-kan.active');
    await delay(150);
    const ipText = (await page.locator('#w-ip').innerText()).trim();
    const laneValue = await page.inputValue('#kb-lane-mode');
    check('K12 WIP limit and lane mode persist', ipText.endsWith('/ 1') && laneValue === 'none', { ipText, laneValue });

    // K13
    await page.evaluate(() => sessionStorage.setItem('qa_scope', 'readonly'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.MMGR && !!window.MMGR.Kanban, null, { timeout: 15000 });
    await page.evaluate(() => window.MMGR.App.showSec('kan'));
    await page.waitForSelector('#panel-kan.active');
    await delay(150);
    const banner = await page.locator('#readonly-banner:not(.is-hide)').count();
    const before = await findTask('t8');
    await page.locator('#kc-todo .kc[data-id="t8"]').focus();
    await page.keyboard.press('Alt+ArrowRight');
    await delay(120);
    const after = await findTask('t8');
    await page.locator('#kc-todo .kc[data-id="t8"]').click();
    await delay(100);
    const disabled = await page.locator('#kbc-name').isDisabled();
    check('K13 view-only blocks moves + disables the sheet', banner === 1 && before.status === after.status && disabled === true, {
      banner,
      before: before.status,
      after: after.status,
      disabled
    });
    await page.keyboard.press('Escape');

    // restore edit scope
    await page.evaluate(() => sessionStorage.setItem('qa_scope', 'full'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.MMGR && !!window.MMGR.Kanban, null, { timeout: 15000 });
    await page.evaluate(() => window.MMGR.App.showSec('kan'));
    await delay(150);

    // K15
    await page.setViewportSize({ width: 390, height: 844 });
    await delay(150);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    check('K15 390 px: no horizontal page scroll', overflow <= 1, { overflow });
    await page.setViewportSize({ width: 1280, height: 900 });
    await delay(100);

    // K16
    await page.locator('[data-action="tglLeadtimeLane"]').click();
    await delay(150);
    const ltVisible = await page.locator('#col-leadtime:not(.is-hide)').count();
    const ltCards = await page.locator('#kc-lt .kc').count();
    check('K16 Lead-Time lane still toggles', ltVisible === 1 && ltCards === 1, { ltVisible, ltCards });

    // K14
    check('K14 zero page errors', pageErrors.length === 0, pageErrors);
  } catch (e) {
    failed++;
    log('FATAL ' + (e && e.stack ? e.stack : e));
  } finally {
    if (browser) {
      await browser.close();
    }
    if (srv) {
      srv.kill();
    }
    log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  }
})();
```

`os` and `spawn` are only needed by the copied kit. If the kit is copied as-is, the imports are used. If not, ESLint flags unused vars as warnings. Keep them only if the kit is copied.

### Step 2: Run it

In one terminal:

```bash
node build.js
node serve.cjs
```

In another:

```bash
node tools/qa-kanban.cjs
```

Expected: `16 passed, 0 failed`.

If K13 reports `before.status === after.status` but `banner !== 1`, the scope key is wrong. Confirm `mmgr_scope_demo-project` is `readonly`, not `view` (`js/mmgr-app.js:142`).

If K2 fails with a different order, Task 1's renderer change did not land or the bundle is stale. Rebuild before debugging.

---

### Step 3: Wire it into CI

In `.github/workflows/ci.yml`, find the T4 procurement step:

```yaml
      - name: "T4: Procurement pack (qa-procurement)"
        id: qa-procurement
        run: node tools/qa-procurement.cjs
```

Add this block directly after it:

```yaml
      # Kanban board mechanics (2026-10-25): card order, WIP limits,
      # filters, card sheet, lanes, flow metrics, persistence, view-only.
      - name: "T4: Kanban board mechanics (qa-kanban)"
        id: qa-kanban
        run: node tools/qa-kanban.cjs
```

In the job summary block near the end of the workflow (the `echo "| qa-..."` lines around line 663), add:

```yaml
            echo "| qa-kanban battery | ${{ steps.qa-kanban.outcome }} |" >> $GITHUB_STEP_SUMMARY
```

### Step 4: Register the harness

In `docs/CI-TEST-COVERAGE.md`, add this row to the harness table, next to the other `tools/qa-*.cjs` rows:

```md
| `tools/qa-kanban.cjs` | CI | Kanban board mechanics: model/schema v23, boardPosition order, WIP count/limit and over state, Alt+arrow reorder and status moves, completedDate stamping, quick add parsing, text filter and clear, card sheet open/save, assignee lanes, flow metrics, reload persistence, view-only refusal, 390 px overflow, Lead-Time lane toggle, zero page errors (16/16) |
```

Then run the registry gate:

```bash
node tools/verify-test-registry.cjs
```

Expected: `PASS` for `tools/qa-kanban.cjs`, with no orphan warnings.

The unit test needs no registry row: `npm run verify` runs `npm test`, which is `node --test test/*.test.mjs`, so `test/kanban-model.test.mjs` is picked up automatically.

### Step 5: Bump the service worker and run the full gate

All JS and CSS work is done, so this is the final cache bump:

1. In `sw.js`, bump `CACHE` once more to the next unused number. It will already be past `'mmgr-shell-v471'` because every earlier task bumped it; do not reuse a number.
2. Rebuild and verify:

```bash
node build.js
node tools/verify-csp-hashes.cjs
node --test test/kanban-model.test.mjs
npm run verify
node tools/verify-actions.cjs
node tools/verify-render-exports.cjs
node tools/verify-test-registry.cjs
```

3. Start the server and run the browser gate:

```bash
node serve.cjs
```

In a second terminal:

```bash
node tools/qa-kanban.cjs
```

4. Confirm the bundle really carries the new code:

```bash
node -e "const fs=require('fs');const b=fs.readFileSync('dist/bundle.js','utf8');for(const s of ['MMGR.Kanban','kbCardOpen','kbLaneMode','kbQuickAdd'])console.log(s, b.includes(s));"
```

Expected: four `true` lines.

### Step 6: Final commit

```bash
git add tools/qa-kanban.cjs .github/workflows/ci.yml docs/CI-TEST-COVERAGE.md sw.js
git commit -m "test(kanban): add board mechanics QA and register the harness"
```

---

## Final acceptance checklist

Run this from a clean checkout of the branch, not from a warm dev server.

- [ ] `npm ci` completes.
- [ ] `node build.js` completes without warnings.
- [ ] `npm run verify` passes, including `npm test`, ESLint, Prettier, CSP, service worker, CSS integrity, and the registry.
- [ ] `node tools/verify-actions.cjs` passes.
- [ ] `node tools/verify-render-exports.cjs` passes.
- [ ] `node tools/qa-kanban.cjs` reports 16 passed, 0 failed.
- [ ] A manual pass on a real project with at least 30 tasks and 5 assignees: order a card in each column, complete one by drag, filter by each control, open and edit a card, switch to assignee lanes and back, reload, and confirm the same order and limits.
- [ ] A view-only share session: board renders, filters work, sheet opens with disabled fields, no move or add is possible.
- [ ] 390 px viewport: one column per row, no sideways page scroll.
- [ ] No emoji and no em or en dashes in any new served copy.
- [ ] `git log --oneline` shows one Conventional Commit per task, with no AI attribution.

---

## Appendix A: Every file this plan touches

| File | Why |
|---|---|
| `js/mmgr-kanban.js` | New pure board model |
| `test/kanban-model.test.mjs` | Node tests for the model |
| `js/mmgr-state.js` | Default `state.kanban`, migration 23, `SCHEMA_VERSION`, `FIELD_KEYS` |
| `js/mmgr-tasks.js` | `createTask`, `addTask` wrapper, `stampStatus` in `updTaskField` |
| `js/render/kanban.js` | Order, WIP display, lanes, flow strip, quick-add row, focusable cards |
| `js/mmgr-app.js` | Move path, drop insertion, keyboard, filters, sheet, actions, allow-list, whitelists |
| `js/mmgr-shortcuts.js` | Alt+arrow rows in the shortcut sheet |
| `build.js` | Module load order |
| `project.html` | Filter bar, WIP modal, card sheet, lane selector, containers |
| `css/mmgr.css` | WIP states, modals, filters, quick add, lanes, flow strip, responsive |
| `mymanager-field-guide.html` | A-05 cards for every user-facing feature |
| `docs/DEVELOPER-GUIDE.md` | Module map row |
| `docs/CI-TEST-COVERAGE.md` | Harness registry row |
| `.github/workflows/ci.yml` | T4 step + summary line |
| `worker.js`, `serve.cjs` | Regenerated CSP hashes after the dev-fallback edit |
| `sw.js` | Cache version bump |
| `dist/bundle.js`, `dist/mmgr.min.css` | Build output, committed if the repo tracks them |

## Appendix B: Command sheet

```bash
# one-time
npm ci

# after any js/css edit
node build.js
npx prettier --write "js/**/*.js" "test/*.mjs" "tools/qa-kanban.cjs" "css/*.css"

# after an inline-script edit in project.html
node tools/regen-csp-hashes.cjs
node tools/verify-csp-hashes.cjs

# before every commit
node --test test/kanban-model.test.mjs
npm run verify
node tools/verify-actions.cjs
node tools/verify-render-exports.cjs
node tools/verify-test-registry.cjs

# browser gate
node serve.cjs            # terminal 1
node tools/qa-kanban.cjs  # terminal 2
```

## Appendix C: Rollback

Each task is one commit, so roll back at the granularity that broke:

- **Schema problem:** reverting Task 1 is safe only before any user has saved a v23 project. Once v23 exists in the wild, do not lower `SCHEMA_VERSION`. Fix forward with migration 24.
- **Ordering or move problem:** revert Task 3. Tasks 1 and 2 are independent and stay valid. Cards fall back to WBS array order.
- **WIP display problem:** revert Task 2. The persisted `state.kanban.wip` key is ignored by older renderers, so no data is lost.
- **Filter problem:** revert Task 4. Filters are memory only, so there is nothing to clean up.
- **Sheet problem:** revert Task 5. Editing returns to the WBS table.
- **Lane problem:** revert Task 6. Set `state.kanban.swimlane` to `'none'` in a hotfix if a user is stuck in a broken lane view; the renderer treats an unknown mode as `none` only after `ensureSettings` runs, so also reset the select.
- **Metrics problem:** revert Task 7. The footer disappears; no state changes.
- **QA only:** revert Task 8. The feature remains but loses its regression net.

Never revert `sw.js` alone: an old cache name with new assets is how users get a stale, half-broken board.

## Appendix D: Deliberately not built

These Kanboard features were considered and rejected for this codebase. Do not add them under this plan:

- **Column collapse and "close all tasks in a column"** (`table_column.php`). Collapse is a per-user preference with no strong workflow gain here; close-all is a bulk destructive action that needs its own confirm and undo design.
- **Per-swimlane WIP limits.** Our limits are board-wide. Per-lane limits need a lane entity, and lanes here are derived.
- **Subtasks, comments, file attachments, categories, task links, colours.** My MaNaGeR has notes and a separate comment system; duplicating Kanboard's task modal would fork the data model.
- **Users, groups, roles, projects, and permissions.** All of that is server-side in Kanboard. My MaNaGeR already has share codes and a view-only scope.
- **A query-language filter (`search=assignee:sam due:overdue`).** Four controls cover the real use cases without a parser, an error surface, and a help page.
- **A CFD or burndown chart.** A chart library would break the offline-first, zero-dependency rule. The three-number flow strip answers the common question; a canvas chart can be a separate plan.
- **Drag between swimlanes for phase lanes.** Reparenting a WBS row is a schedule change. It belongs in the WBS table, where dates and phase rollups are visible.

## Appendix E: Kanboard anchors used

| Concern | Kanboard file | What it establishes |
|---|---|---|
| WIP limit is a warning | `app/Model/BoardModel.php:40` (`task_limit => 0`), `app/Template/board/table_column.php:113-114`, `table_tasks.php:6` | `0` means unlimited; over-limit adds a class, never a refusal |
| Explicit order | `app/Model/TaskPositionModel.php:66` | position is stored and rewritten on move |
| Swimlanes | `app/Template/board/table_swimlane.php:18-19`, `SwimlaneModel` | lanes are rows over the same columns |
| Board filters | `app/Filter/TaskAssigneeFilter.php`, `TaskDueDateFilter` family, `ProjectHeaderHelper.php:24` | the board is a filtered projection |
| Lead and cycle time | `app/Model/TaskAnalyticModel.php:22,34`, `analytic/lead_cycle_time.php:9-10` | lead = created to completed; cycle = started to completed |
| Average time per column | `analytic/avg_time_columns.php:3` | time-in-column is a first-class metric (left for a later plan) |

**End of plan.**










