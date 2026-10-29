/* ============================================================
   My MaNaGeR, work package relations model (OpenProject-inspired)
   ------------------------------------------------------------
   The graph rules live here, once:
     - the typed relation table and its explicit reverse pairs
     - validation (self, duplicate, unknown type, scheduling loop)
     - symmetric add and remove
     - links and open blockers for the WBS, the Kanban card, and
       the board lens

   A relation is stored ONCE on each side:
     A blocks B  ->  A { type: 'blocks',  targetId: B }
                     B { type: 'blocked', targetId: A }
   That costs one extra object per link and removes every runtime
   type inversion. It also makes a one-sided legacy import fail
   visibly instead of rendering a half-link.

   Every function takes the state object it should read, so this
   file is pure enough to load in Node without a browser.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const TYPES = {
    relates: { label: 'Relates to', reverse: 'relates', group: 'relates' },
    blocks: { label: 'Blocks', reverse: 'blocked', group: 'blocks' },
    blocked: { label: 'Blocked by', reverse: 'blocks', group: 'blocks' },
    precedes: { label: 'Precedes', reverse: 'follows', group: 'schedule' },
    follows: { label: 'Follows', reverse: 'precedes', group: 'schedule' },
    duplicates: { label: 'Duplicates', reverse: 'duplicated', group: 'duplicates' },
    duplicated: { label: 'Duplicated by', reverse: 'duplicates', group: 'duplicates' },
    includes: { label: 'Includes', reverse: 'partof', group: 'structure' },
    partof: { label: 'Part of', reverse: 'includes', group: 'structure' },
    requires: { label: 'Requires', reverse: 'required', group: 'requires' },
    required: { label: 'Required by', reverse: 'requires', group: 'requires' }
  };

  const GROUPS = ['relates', 'blocks', 'schedule', 'duplicates', 'structure', 'requires'];
  const MAX_LAG = 2000;

  function relationList(task) {
    if (!task || !Array.isArray(task.relations)) {
      return [];
    }
    return task.relations.filter(function (r) {
      return r && TYPES[r.type] && r.targetId;
    });
  }

  function findTask(state, id) {
    const tasks = (state && state.tasks) || [];
    return (
      tasks.find(function (t) {
        return t && String(t.id) === String(id);
      }) || null
    );
  }

  function nextRelationId() {
    return ns.Utils && ns.Utils.genId ? ns.Utils.genId('rel') : 'rel-' + Date.now();
  }

  function clampLag(value) {
    const n = parseInt(value, 10);
    if (!isFinite(n)) {
      return 0;
    }
    return Math.max(-MAX_LAG, Math.min(MAX_LAG, n));
  }

  function hasRelation(task, type, targetId) {
    return relationList(task).some(function (r) {
      return r.type === type && String(r.targetId) === String(targetId);
    });
  }

  // Walk only the relations in the same group. "A blocks B" and "A precedes B"
  // are both directed, but a blocks edge must never be compared with a
  // precedes edge when looking for a loop.
  function reachable(state, startId, targetId, group, seen) {
    if (String(startId) === String(targetId)) {
      return true;
    }
    const visited = seen || {};
    if (visited[String(startId)]) {
      return false;
    }
    visited[String(startId)] = true;
    const task = findTask(state, startId);
    return relationList(task).some(function (r) {
      if (TYPES[r.type].group !== group) {
        return false;
      }
      return reachable(state, r.targetId, targetId, group, visited);
    });
  }

  function validate(state, fromId, type, toId) {
    const def = TYPES[type];
    if (!def) {
      return { ok: false, reason: 'Unknown relation type.' };
    }
    if (String(fromId) === String(toId)) {
      return { ok: false, reason: 'A task cannot relate to itself.' };
    }
    const from = findTask(state, fromId);
    const to = findTask(state, toId);
    if (!from || !to) {
      return { ok: false, reason: 'Both tasks must exist.' };
    }
    if (hasRelation(from, type, toId)) {
      return { ok: false, reason: 'That relation already exists.' };
    }
    if ((type === 'blocks' || type === 'precedes') && reachable(state, toId, fromId, def.group)) {
      return { ok: false, reason: 'That would create a ' + def.group + ' loop.' };
    }
    return { ok: true };
  }

  function addRelation(state, fromId, type, toId, lag) {
    const check = validate(state, fromId, type, toId);
    if (!check.ok) {
      return check;
    }
    const from = findTask(state, fromId);
    const to = findTask(state, toId);
    const def = TYPES[type];
    const id = nextRelationId();
    const days = clampLag(lag);
    from.relations = relationList(from);
    to.relations = relationList(to);
    const forward = { id: id, type: type, targetId: toId, lag: days };
    from.relations.push(forward);
    to.relations.push({ id: id + '-r', type: def.reverse, targetId: fromId, lag: days });
    return { ok: true, relation: forward };
  }

  function removeRelation(state, fromId, relationId) {
    const from = findTask(state, fromId);
    if (!from) {
      return false;
    }
    const list = relationList(from);
    const at = list.findIndex(function (r) {
      return String(r.id) === String(relationId);
    });
    if (at < 0) {
      return false;
    }
    const rel = list[at];
    list.splice(at, 1);
    from.relations = list;
    const to = findTask(state, rel.targetId);
    if (to) {
      const reverse = TYPES[rel.type] ? TYPES[rel.type].reverse : '';
      to.relations = relationList(to).filter(function (r) {
        return !(r.type === reverse && String(r.targetId) === String(fromId));
      });
    }
    return true;
  }

  function linksOf(state, taskId) {
    const task = findTask(state, taskId);
    return relationList(task)
      .map(function (r) {
        return {
          id: r.id,
          type: r.type,
          label: TYPES[r.type].label,
          reverse: TYPES[r.type].reverse,
          group: TYPES[r.type].group,
          lag: r.lag || 0,
          task: findTask(state, r.targetId)
        };
      })
      .filter(function (l) {
        return !!l.task;
      });
  }

  // Only an OPEN blocker blocks. A completed blocker is history, not a
  // reason to keep the card out of the board lens.
  function blockersOf(state, taskId) {
    return linksOf(state, taskId).filter(function (l) {
      return l.type === 'blocked' && l.task.status !== 'completed';
    });
  }

  function isBlocked(state, taskId) {
    return blockersOf(state, taskId).length > 0;
  }

  function isWorkItem(task, rollups) {
    if (!task || task.isPhase) {
      return false;
    }
    return !((task.level || 0) === 0 && rollups && rollups[task.name]);
  }

  function workItems(state) {
    if (ns.Kanban && ns.Kanban.workItems) {
      return ns.Kanban.workItems(state);
    }
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

  function boardLens(state) {
    if (state && (state.relLens === 'blocked' || state.relLens === 'ready')) {
      return state.relLens;
    }
    return 'all';
  }

  function setBoardLens(state, lens) {
    state.relLens = lens === 'blocked' || lens === 'ready' ? lens : 'all';
    return state.relLens;
  }

  function lensTasks(state, lens) {
    const mode = lens || boardLens(state);
    const items = workItems(state);
    if (mode === 'blocked') {
      return items.filter(function (t) {
        return isBlocked(state, t.id);
      });
    }
    if (mode === 'ready') {
      return items.filter(function (t) {
        return !isBlocked(state, t.id);
      });
    }
    return items;
  }

  function relationCount(state, taskId) {
    return linksOf(state, taskId).length;
  }

  ns.Relations = {
    TYPES: TYPES,
    GROUPS: GROUPS,
    MAX_LAG: MAX_LAG,
    relationList: relationList,
    findTask: findTask,
    validate: validate,
    addRelation: addRelation,
    removeRelation: removeRelation,
    linksOf: linksOf,
    blockersOf: blockersOf,
    isBlocked: isBlocked,
    workItems: workItems,
    boardLens: boardLens,
    setBoardLens: setBoardLens,
    lensTasks: lensTasks,
    relationCount: relationCount
  };
})(MMGR);
window.MMGR = MMGR;
