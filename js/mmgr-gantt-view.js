/* ============================================================
   My MaNaGeR - THE GANTT VIEW BUILDER (GANTT-1)
   REFINEMENT-DIRECTIVE-2026-10-24 section "Wide dialog, tidy chart,
   same output everywhere".

   ONE pure function - build(state, options) - answers the only question
   a Gantt picture may ask: which rows, over which span, joined by which
   links, at which scale. The live chart and the PNG / SVG / PDF exports
   all draw from it, so what the owner sees is what is exported.

   PURITY: it READS the state object and returns data. No DOM, no
   network, no writes. The Tidy control changes only this VIEW - the
   plan, its dates and its links are never touched (owner rule: tidy
   changes the view, never the data).

   Options (all optional):
     links : 'all' | 'near' | 'critical' | 'gates'   (default 'gates' -
             the directive's default for exports: the critical chain plus
             the links between phase summaries and phase-gate milestones)
     tidy  : collapse finished phases and phases that start after the
             window, and reduce the displayed links to what still earns
             its line (transitive reduction) - default false
     today : 'YYYY-MM-DD' for the tidy maths (default: the page's date)

   Returns:
     { rows, wbs, spans, links, milestones, scale, orphans, policy, tidy }

     rows       [{ row, kind:'phase'|'task'|'group', depth }] in draw
                order; `row` is the task itself (or the synthetic
                "Unassigned tasks" header the export has always drawn).
                Rows inside a collapsed phase are absent - the phase row
                itself stays, showing its rolled-up span.
     wbs        { taskId: '1.2' } - numbered over the FULL order before
                any collapse, so hiding a child never renumbers the rest.
     spans      { taskId: { start, end } } - a phase spans its CHILDREN,
                derived at read time through Schedule.phaseSpan: a static
                image must never trust a stored date a stale rollup left
                behind.
     links      [{ from, to, critical }] - visible rows only, already
                filtered by the policy, already reduced when tidy is on.
     milestones [taskId...] - the G3 rule (flag, shape or name), once.
     scale      { from, to, totalDays, unit: 'day'|'week'|'month' }.
     orphans    [task...] - tasks whose parent cannot be resolved. Never
                dropped, never invented: the caller decides what to say.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  var U = ns.Utils;

  // Both painters use these numbers: the chart's rows are 26px and a phase
  // row breathes 7px before it. The link policy measures row distance with
  // them, so a policy answer means the same thing on screen and on paper.
  var ROW_H = 26;
  var PHASE_GAP = 7;
  var NEAR_ROWS = 8;

  function daysBetween(a, b) {
    if (U && U.daysBetween) {
      return U.daysBetween(a, b);
    }
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  }

  function addDays(d, n) {
    if (U && U.addDays) {
      return U.addDays(d, n);
    }
    var x = new Date(d);
    x.setDate(x.getDate() + n);
    return x.toISOString().slice(0, 10);
  }

  function todayStr() {
    if (U && U.todayStr) {
      return U.todayStr();
    }
    return new Date().toISOString().slice(0, 10);
  }

  /* G3's milestone rule, in ONE place: a diamond is a diamond by FLAG
     (t.milestone), by SHAPE (zero duration), or by NAME when a same-day
     row reads as a gate or sign-off. The export used to carry its own
     copy of this test - two copies of the same rule is how a screen and
     a picture start disagreeing. */
  function isMilestone(t) {
    return !!(
      t.milestone ||
      Number(t.duration) === 0 ||
      (t.startDate === t.endDate &&
        /gate|sign-?off|complete|milestone|certificate/i.test(t.name || ''))
    );
  }

  /* Directive algorithm: transitive reduction of DISPLAYED links. If A
     leads to B and A also leads to C which leads to B, the A-to-B line
     earns nothing - it is drawn only when the reader asked for the wall
     of spaghetti ('all' still shows every raw line; reduction runs when
     Tidy is on). Parallel tasks with no real constraint between them
     draw no arrow at all: an edge is dropped when the same two rows are
     already connected through another path. */
  function reduceLinks(links) {
    var next = {};
    links.forEach(function (l) {
      (next[l.from] = next[l.from] || []).push(l.to);
    });
    var reach = function (a, b, skipDirect) {
      var seen = {};
      var stack = (next[a] || []).filter(function (x) {
        return !(skipDirect && x === b);
      });
      while (stack.length) {
        var n = stack.pop();
        if (n === b) {
          return true;
        }
        if (seen[n]) {
          continue;
        }
        seen[n] = true;
        (next[n] || []).forEach(function (x) {
          stack.push(x);
        });
      }
      return false;
    };
    return links.filter(function (l) {
      return !reach(l.from, l.to, true);
    });
  }

  function parentOf(c, p) {
    return String(c.parentId) === String(p.id) || c.parentName === p.name;
  }

  /* G2 row order, unchanged in spirit: phases in state order, each
     followed by its children sorted by start date then position, recursion
     into grandchildren; tasks whose parent cannot be resolved collect
     under an "Unassigned tasks" group at the END - an orphan must never
     print above P0 again. No task is ever dropped. */
  function orderPhaseRows(tasks) {
    var ordered = [];
    var placed = {};
    var emitKids = function (parent) {
      var kids = tasks.filter(function (c) {
        return !c.isPhase && !placed[c.id] && parentOf(c, parent);
      });
      kids.sort(function (a, b) {
        return a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0;
      });
      kids.forEach(function (k) {
        ordered.push({ row: k, kind: 'task', depth: parent.isPhase ? 1 : 2 });
        placed[k.id] = true;
        emitKids(k);
      });
    };
    tasks
      .filter(function (t) {
        return t.isPhase;
      })
      .forEach(function (ph) {
        ordered.push({ row: ph, kind: 'phase', depth: 0 });
        placed[ph.id] = true;
        emitKids(ph);
      });
    var orphans = tasks.filter(function (t) {
      return !placed[t.id];
    });
    if (orphans.length) {
      ordered.push({
        row: {
          id: '__unassigned__',
          name: 'Unassigned tasks (' + orphans.length + ')',
          isGroupHeader: true
        },
        kind: 'group',
        depth: 0
      });
      orphans.forEach(function (t) {
        ordered.push({ row: t, kind: 'task', depth: 1 });
      });
    }
    return { rows: ordered, orphans: orphans };
  }

  function build(state, options) {
    var o = options || {};
    var s = state || {};
    var all = s.tasks || [];
    var tasks = all.filter(function (t) {
      return t.startDate && t.endDate;
    });
    var policy =
      o.links === 'all' || o.links === 'near' || o.links === 'critical' ? o.links : 'gates';
    var tidy = o.tidy === true;
    var today = typeof o.today === 'string' && o.today ? o.today : todayStr();

    // ---- spans: every row's bar comes from here, phases from their kids.
    var spans = {};
    tasks.forEach(function (t) {
      var span = null;
      if (t.isPhase && ns.Schedule && ns.Schedule.phaseSpan) {
        span = ns.Schedule.phaseSpan(t, all);
      }
      spans[t.id] = span || { start: t.startDate, end: t.endDate };
    });

    // ---- the whole-project range (the title block and the day ladder).
    var min = null;
    var max = null;
    tasks.forEach(function (t) {
      var sp = spans[t.id];
      if (!min || sp.start < min) {
        min = sp.start;
      }
      if (!max || sp.end > max) {
        max = sp.end;
      }
    });
    if (!min) {
      min = today;
      max = today;
    }
    var totalDays = daysBetween(min, max) + 1;
    // Labels never overlap: day ticks on a short window, week on a
    // medium one, month on the long ones.
    var unit = totalDays <= 45 ? 'day' : totalDays <= 200 ? 'week' : 'month';

    // ---- rows, WBS over the FULL order (a collapsed child must never
    // renumber the ones still on screen), then the tidy pass.
    var phOrdered = orderPhaseRows(tasks);
    var wbs = {};
    var phNum = 0;
    var chNum = 0;
    phOrdered.rows.forEach(function (r) {
      var t = r.row;
      if (t.isGroupHeader) {
        return;
      }
      if (t.isPhase) {
        phNum++;
        chNum = 0;
        wbs[t.id] = String(phNum);
      } else if (phNum > 0) {
        chNum++;
        wbs[t.id] = phNum + '.' + chNum;
      }
    });

    var rows = phOrdered.rows;
    var collapsed = {};
    if (tidy) {
      // Collapse what is FINISHED (every child done, or the rolled-up span
      // already behind us) and what starts after the visible window. Active
      // phases stay open - the owner is reading the live end of the plan.
      rows.forEach(function (r) {
        if (r.kind !== 'phase') {
          return;
        }
        var ph = r.row;
        var kids = tasks.filter(function (c) {
          return !c.isPhase && parentOf(c, ph);
        });
        var sp = spans[ph.id];
        var finished =
          sp.end < today ||
          (kids.length > 0 &&
            kids.every(function (k) {
              return k.status === 'completed';
            }));
        var afterWindow = sp.start > max;
        if (finished || afterWindow) {
          collapsed[ph.id] = true;
        }
      });
      if (Object.keys(collapsed).length) {
        var kept = [];
        var skipUnder = null;
        rows.forEach(function (r) {
          if (r.kind === 'phase') {
            skipUnder = collapsed[r.row.id] ? r.row.id : null;
            kept.push(r);
            return;
          }
          if (r.row.isGroupHeader) {
            // The orphan group sits after every phase: it has no collapsed
            // parent, so the skip rule must stop here.
            skipUnder = null;
            kept.push(r);
            return;
          }
          if (skipUnder && r.depth > 0) {
            return;
          }
          kept.push(r);
        });
        rows = kept;
      }
    }

    // ---- geometry pass (same 26px rows + 7px phase gaps the painters
    // use), so the 'near' policy measures row distance exactly as the
    // drawing does.
    var rowY = {};
    var rowTask = {};
    var y = 0;
    var seenAny = false;
    rows.forEach(function (r) {
      var id = r.row.id;
      if (r.row.isGroupHeader) {
        if (seenAny) {
          y += PHASE_GAP;
        }
        rowY[id] = y;
        y += ROW_H;
        return;
      }
      if (r.row.isPhase && seenAny) {
        y += PHASE_GAP;
      }
      rowY[id] = y;
      rowTask[id] = r.row;
      seenAny = true;
      y += ROW_H;
    });

    // ---- links: visible rows only, then the policy, then (tidy) the
    // reduction. The critical chain survives every policy - it is the
    // one line a reader can never be allowed to lose.
    var links = [];
    rows.forEach(function (r) {
      var t = r.row;
      if (t.isGroupHeader) {
        return;
      }
      (t.predecessors || []).forEach(function (pid) {
        var from = String(pid);
        var to = String(t.id);
        if (!rowTask[from] || !rowTask[to]) {
          return;
        }
        links.push({
          from: from,
          to: to,
          critical: !!(rowTask[from].critical && t.critical)
        });
      });
    });
    var isGateLink = function (l) {
      // The directive's "gates" policy: links between phase summaries and
      // phase-gate milestones, plus (below) the critical chain. Nothing
      // else - a task-to-task line is not a gate.
      var a = rowTask[l.from];
      var b = rowTask[l.to];
      return (a.isPhase && isMilestone(b)) || (isMilestone(a) && b.isPhase);
    };
    var shown = links.filter(function (l) {
      if (l.critical) {
        return true;
      }
      if (policy === 'all') {
        return true;
      }
      if (policy === 'critical') {
        return false;
      }
      if (policy === 'gates') {
        return isGateLink(l);
      }
      // 'near': the critical chain plus links spanning at most 8 rows.
      var y1 = rowY[l.from];
      var y2 = rowY[l.to];
      if (y1 === undefined || y2 === undefined) {
        return false;
      }
      return Math.abs(y2 - y1) / ROW_H <= NEAR_ROWS;
    });
    if (tidy) {
      shown = reduceLinks(shown);
    }

    var milestones = rows
      .filter(function (r) {
        return !r.row.isGroupHeader && isMilestone(r.row);
      })
      .map(function (r) {
        return r.row.id;
      });

    return {
      rows: rows,
      wbs: wbs,
      spans: spans,
      links: shown,
      milestones: milestones,
      scale: { from: min, to: max, totalDays: totalDays, unit: unit },
      orphans: phOrdered.orphans,
      policy: policy,
      tidy: tidy,
      collapsed: collapsed
    };
  }

  ns.GanttView = {
    build: build,
    reduceLinks: reduceLinks,
    isMilestone: isMilestone,
    ROW_H: ROW_H,
    PHASE_GAP: PHASE_GAP
  };
})((window.MMGR = MMGR));
