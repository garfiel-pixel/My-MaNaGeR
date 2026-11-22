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
     3. otherwise each top-level main task: every work item is
        grouped under its highest ancestor, and a parentless item
        is its own main task. This is the flat/older-project path
        (UI-WAVE 2026-11-20 D).

   Weighting differs on purpose. Branches 1-2 weight a group by its
   share of the work items, so the centre percentage is the
   work-item completion rate. Branch 3 gives every main task an
   EQUAL arc (share = 1/N) and fills that arc by the main task's
   own subtask completion, so a completed task with many subtasks
   cannot dominate the ring or top the "what is driving
   completion" list. The centre percentage is then the mean of the
   main-task fractions, which is exactly the sum of the arc points.

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

  // Walk up parentId / parentName to the highest ancestor. That row is the
  // main task a flat (no phase row, no phase label) project is grouped by.
  // A parentless task is its own main task.
  function rootAncestor(task, idx) {
    let cur = task;
    let last = task;
    for (let guard = 0; cur && guard < 32; guard++) {
      const pid = cur.parentId;
      const pname = cur.parentName;
      const parent =
        (pid != null && pid !== '' && idx.byId[String(pid)]) ||
        (pname && idx.byName[String(pname)]) ||
        null;
      if (!parent) {
        return last;
      }
      last = parent;
      cur = parent;
    }
    return last;
  }

  function blank(name, id) {
    return { id: id, name: name, total: 0, completed: 0, members: [] };
  }

  function finish(group, totalWork, equalShare) {
    const fraction = group.total ? group.completed / group.total : 0;
    const share = equalShare != null ? equalShare : totalWork ? group.total / totalWork : 0;
    return {
      id: group.id,
      name: group.name,
      total: group.total,
      completed: group.completed,
      fraction: fraction,
      share: share,
      // Branches 1-2: the group's slice of the work-item completion rate.
      // Branch 3: its equal arc's contribution, so the points sum to the
      // centre percentage while no main task outranks another by size.
      points: equalShare != null ? share * fraction * 100 : pct(group.completed, totalWork),
      // UX-2026-11-19 B6: the work items behind the group, so the Gantt bar,
      // the WBS marker and the Kanban stripe can paint the same colour as the
      // ring slot without a second membership rule.
      members: (group.members || []).slice()
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

    // Branch 3 is the flat/older-project path: no phase rows AND no phase
    // labels anywhere. Every work item lands under its highest ancestor.
    const hasLabels = items.some(function (item) {
      return !!capitalise(item.phase);
    });
    const byMainTask = !phaseRows.length && !hasLabels;

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
        if (item.id != null && item.id !== '') {
          g.members.push(String(item.id));
        }
        if ((item.status || '') === 'completed') {
          g.completed++;
        }
      });
    } else if (!byMainTask) {
      // 2. No phase rows: group by the task's `phase` label, in order of
      // first appearance among the work items being counted.
      items.forEach(function (item) {
        const label = capitalise(item.phase);
        const key = label ? 'l:' + label.toLowerCase() : UNASSIGNED_ID;
        const g = label
          ? add(key, label, 'group:' + key)
          : add(UNASSIGNED_ID, UNASSIGNED_NAME, UNASSIGNED_ID);
        g.total++;
        if (item.id != null && item.id !== '') {
          g.members.push(String(item.id));
        }
        if ((item.status || '') === 'completed') {
          g.completed++;
        }
      });
    } else {
      // 3. No phase rows and no labels: the top-level main task is the major.
      // Group each work item under its highest ancestor; a parentless item is
      // its own main task. A main task is complete when all of its subtasks
      // are, because its fraction is completed / total.
      items.forEach(function (item) {
        const root = rootAncestor(item, idx) || item;
        const rid = root.id != null && root.id !== '' ? 'i:' + String(root.id) : '';
        const rname = root.name ? String(root.name) : '';
        const key = rid || (rname ? 'n:' + rname : '');
        const name = rname || capitalise(item.name) || UNASSIGNED_NAME;
        const gid = key ? 'group:main:' + key : UNASSIGNED_ID;
        const g = key ? add(gid, name, gid) : add(UNASSIGNED_ID, UNASSIGNED_NAME, UNASSIGNED_ID);
        g.total++;
        if (item.id != null && item.id !== '') {
          g.members.push(String(item.id));
        }
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

    // Branch 3 weights every main task equally. overall is the mean of their
    // fractions, which is exactly the sum of the arc points.
    const equalShare = byMainTask && kept.length ? 1 / kept.length : null;
    const overallOut =
      equalShare != null
        ? (100 *
            kept.reduce(function (acc, g) {
              return acc + (g.total ? g.completed / g.total : 0);
            }, 0)) /
          kept.length
        : overall;

    return {
      groups: kept.map(function (g) {
        return finish(g, totalWork, equalShare);
      }),
      total: totalWork,
      completed: overallCompleted,
      overall: overallOut,
      // Branches 1-2 keep today's "more than one major" rule. The flat branch
      // applies its main-task model even for a single main task, so the ring
      // fills by that task's subtasks instead of counting the container row.
      grouped: byMainTask ? kept.length > 0 : kept.length > 1
    };
  }

  // ---- B2: stable chart slots -------------------------------------------
  // Eight slots, one per --major-N token. A group's slot comes from a hash of
  // its id, so it does not move when tasks are reordered or renumbered; a
  // collision takes the next free slot (first-fit), so two groups never share
  // a colour while slots remain.
  const SLOTS = 8;
  const OTHER_ID = 'group:other';

  function hashId(id) {
    const s = String(id == null ? '' : id);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // More than eight majors: the seven largest keep a colour and everything
  // else merges into one neutral "Other" slot. Merging preserves the totals,
  // so the points still sum to the centre percentage.
  function mergeOther(groups) {
    if (groups.length <= SLOTS) {
      return groups;
    }
    const order = groups.map(function (g, i) {
      return { g: g, i: i };
    });
    order.sort(function (a, b) {
      return b.g.points - a.g.points || a.i - b.i;
    });
    const keep = order
      .slice(0, SLOTS - 1)
      .sort(function (a, b) {
        return a.i - b.i;
      })
      .map(function (x) {
        return x.g;
      });
    const rest = order.slice(SLOTS - 1).map(function (x) {
      return x.g;
    });
    const other = {
      id: OTHER_ID,
      name: 'Other',
      total: 0,
      completed: 0,
      fraction: 0,
      share: 0,
      points: 0,
      members: []
    };
    rest.forEach(function (g) {
      other.total += g.total;
      other.completed += g.completed;
      other.share += g.share;
      other.points += g.points;
      other.members = other.members.concat(g.members || []);
    });
    other.fraction = other.total ? other.completed / other.total : 0;
    return keep.concat([other]);
  }

  function withColors(groups) {
    const kept = mergeOther(groups || []);
    const used = Object.create(null);
    return kept.map(function (g) {
      if (g.id === OTHER_ID) {
        return Object.assign({}, g, { color: 0 });
      }
      let slot = hashId(g.id) % SLOTS;
      for (let n = 0; n < SLOTS && used[slot]; n++) {
        slot = (slot + 1) % SLOTS;
      }
      used[slot] = 1;
      return Object.assign({}, g, { color: slot + 1 });
    });
  }

  // ---- B6: the same colour everywhere -----------------------------------
  // A task id maps to the slot its major was given, so the ring arc, the
  // Gantt bar, the WBS marker and the Kanban stripe cannot disagree. Returns
  // null when the project has no groups - the callers then draw exactly what
  // they drew before.
  function assignments(state) {
    const out = getMajorGroups(state);
    if (!out || !out.grouped || !out.groups.length) {
      return null;
    }
    const colored = withColors(out.groups);
    const map = Object.create(null);
    colored.forEach(function (g) {
      (g.members || []).forEach(function (id) {
        map[String(id)] = g.color;
      });
    });
    return map;
  }

  ns.MajorTasks = {
    getMajorGroups: getMajorGroups,
    withColors: withColors,
    assignments: assignments,
    hashId: hashId,
    SLOTS: SLOTS,
    OTHER_ID: OTHER_ID,
    UNASSIGNED_ID: UNASSIGNED_ID,
    UNASSIGNED_NAME: UNASSIGNED_NAME
  };
})(MMGR);
window.MMGR = MMGR;
