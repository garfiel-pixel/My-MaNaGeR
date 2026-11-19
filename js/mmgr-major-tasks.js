/* ============================================================
   My MaNaGeR, major task groups
   ------------------------------------------------------------
   UX-2026-11-19 B1. The dashboard ring has always drawn ONE
   stroke: completed work items over total work items. The owner
   wants the same centre number, but built from the headline
   groups that make it up ("Site preparation" with site grading
   and temporary fences beneath it).

   This module is the ONE definition of what a major group is.
   The ring, the "What is driving completion" list, the Gantt
   accent and the Kanban stripe all read it, so they cannot
   disagree about which rows belong together or what a group is
   worth.

   Counting rule (the ring's existing rule, reused, never copied):
   a work item is whatever MMGR.Kanban.workItems() says it is -
   not a phase row and not a roll-up parent. Completed means
   status 'completed'. Because every work item lands in exactly
   one group (unassigned rows go to an honest "Unassigned"
   group), the sum of the groups' points equals the centre
   percentage exactly.

   Source order for the groups:
     1. rows with isPhase true, in plan order, with their
        descendants (by parentId or parentName, any depth) beneath;
     2. otherwise each task's `phase` label, in order of first
        appearance, capitalised;
     3. otherwise no groups - the dashboard keeps today's ring.

   Pure: takes the state it should read, returns a plain object.
   Loaded in Node by test/major-groups.test.mjs through a vm
   sandbox, exactly like js/mmgr-agenda.js.
   ============================================================ */
var MMGR = window.MMGR || {};
(function (ns) {
  'use strict';

  const UNASSIGNED_ID = 'group:unassigned';
  const UNASSIGNED_NAME = 'Unassigned';

  function pct(part, whole) {
    if (!whole) {
      return 0;
    }
    return (part / whole) * 100;
  }

  function capitalise(s) {
    const v = String(s == null ? '' : s).trim();
    if (!v) {
      return '';
    }
    return v.charAt(0).toUpperCase() + v.slice(1);
  }

  // The Kanban model owns the work-item rule. Without it there is no honest
  // count, so this module reports "no groups" rather than inventing one.
  function workItemsOf(state) {
    const K = ns.Kanban;
    if (!K || typeof K.workItems !== 'function') {
      return null;
    }
    return K.workItems(state);
  }

  function indexTasks(tasks) {
    const byId = Object.create(null);
    const byName = Object.create(null);
    (tasks || []).forEach(function (t) {
      if (!t) {
        return;
      }
      if (t.id != null && t.id !== '') {
        byId[String(t.id)] = t;
      }
      if (t.name) {
        byName[String(t.name)] = t;
      }
    });
    return { byId: byId, byName: byName };
  }

  // Walk up parentId / parentName (the same match rollupPhases uses) until a
  // phase row is reached. Deeper descendants therefore count toward their
  // top-level ancestor, as the directive requires.
  function phaseAncestor(task, idx) {
    let cur = task;
    for (let guard = 0; cur && guard < 32; guard++) {
      const pid = cur.parentId;
      const pname = cur.parentName;
      const parent =
        (pid != null && pid !== '' && idx.byId[String(pid)]) ||
        (pname && idx.byName[String(pname)]) ||
        null;
      if (!parent) {
        return null;
      }
      if (parent.isPhase) {
        return parent;
      }
      cur = parent;
    }
    return null;
  }

  function blank(name, id) {
    return { id: id, name: name, total: 0, completed: 0 };
  }

  function finish(group, totalWork) {
    const fraction = group.total ? group.completed / group.total : 0;
    return {
      id: group.id,
      name: group.name,
      total: group.total,
      completed: group.completed,
      fraction: fraction,
      share: totalWork ? group.total / totalWork : 0,
      points: pct(group.completed, totalWork)
    };
  }

  function getMajorGroups(state) {
    const s = state || {};
    const tasks = s.tasks || [];
    const items = workItemsOf(s);
    if (!items) {
      return { groups: [], total: 0, completed: 0, overall: 0, grouped: false };
    }
    const totalWork = items.length;
    const overallCompleted = items.filter(function (t) {
      return (t.status || '') === 'completed';
    }).length;
    const overall = pct(overallCompleted, totalWork);

    const idx = indexTasks(tasks);
    const phaseRows = tasks.filter(function (t) {
      return t && t.isPhase;
    });

    const groups = [];
    const byKey = Object.create(null);

    function add(key, name, id) {
      if (!byKey[key]) {
        const g = blank(name, id);
        byKey[key] = g;
        groups.push(g);
      }
      return byKey[key];
    }

    if (phaseRows.length) {
      // 1. Phase rows are the majors, in plan order.
      phaseRows.forEach(function (ph, i) {
        const key = 'p:' + String(ph.id != null && ph.id !== '' ? ph.id : ph.name || i);
        add(key, ph.name || 'Phase ' + (i + 1), 'group:' + key);
      });
      items.forEach(function (item) {
        const ph = phaseAncestor(item, idx);
        const key = ph
          ? 'p:' + String(ph.id != null && ph.id !== '' ? ph.id : ph.name)
          : UNASSIGNED_ID;
        const g = ph
          ? byKey[key] || add(key, ph.name || 'Phase', 'group:' + key)
          : add(UNASSIGNED_ID, UNASSIGNED_NAME, UNASSIGNED_ID);
        if (!g) {
          return;
        }
        g.total++;
        if ((item.status || '') === 'completed') {
          g.completed++;
        }
      });
    } else {
      // 2. No phase rows: group by the task's `phase` label, in order of
      // first appearance among the work items being counted.
      items.forEach(function (item) {
        const label = capitalise(item.phase);
        const key = label ? 'l:' + label.toLowerCase() : UNASSIGNED_ID;
        const g = label
          ? add(key, label, 'group:' + key)
          : add(UNASSIGNED_ID, UNASSIGNED_NAME, UNASSIGNED_ID);
        g.total++;
        if ((item.status || '') === 'completed') {
          g.completed++;
        }
      });
    }

    // A major with no work items beneath it is omitted: a 0/0 row is not a
    // contribution to anything.
    const kept = groups.filter(function (g) {
      return g.total > 0;
    });

    return {
      groups: kept.map(function (g) {
        return finish(g, totalWork);
      }),
      total: totalWork,
      completed: overallCompleted,
      overall: overall,
      grouped: kept.length > 1
    };
  }

  ns.MajorTasks = {
    getMajorGroups: getMajorGroups,
    UNASSIGNED_ID: UNASSIGNED_ID,
    UNASSIGNED_NAME: UNASSIGNED_NAME
  };
})(MMGR);
window.MMGR = MMGR;
