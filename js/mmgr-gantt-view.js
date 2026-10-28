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
     links   : 'all' | 'near' | 'critical' | 'gates'   (default 'gates' -
               the directive's default for exports: the critical chain
               plus the links between phase summaries and phase-gate
               milestones)
     tidy    : collapse finished phases and phases that start after the
               window, and reduce the displayed links to what still earns
               its line (transitive reduction) - default false
     groupBy : 'phase' (default) | 'trade' | 'assignee' - the swimlane
               axis. Phase mode draws phases with their children; the
               other two draw one band per value, tasks sorted by start
               date then WBS, and leave phases out (a phase is a
               different axis, not a band).
     window  : 'all' (default) | 'next90' | { from, to } - the visible
               time window. The scale unit is chosen automatically from
               its length so labels never overlap.
     today   : 'YYYY-MM-DD' for the tidy maths and 'next90' (default:
               the page's date)

   Returns:
     { rows, wbs, spans, links, milestones, scale, orphans, policy,
       tidy, collapsed, groupBy, window }

     rows       [{ row, kind:'phase'|'task'|'group', depth }] in draw
                order; `row` is the task itself (or the synthetic group
                header the export has always drawn). Rows inside a
                collapsed phase are absent - the phase row itself stays,
                showing its rolled-up span.
     wbs        { taskId: '1.2' } - numbered over the FULL phase order
                before any collapse or grouping, so hiding a child or
                switching the swimlane axis never renumbers the plan.
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

  // The export's rows are 26px; the live chart's rows are 34px (css .gr).
  // The 'near' policy is a ROW-COUNT measure ("no line longer than eight
  // rows"), so it uses one nominal height for both painters rather than
  // reading the DOM - a pure module must not measure the page.
  var ROW_H = 26;
  var PHASE_GAP = 7;
  var NEAR_ROWS = 8;

  // The directive's two extra link policies both rest on this reading of a
  // phase gate: a milestone that names itself a gate, a sign-off, an
  // inspection or a completion. Kept here (not in the painters) so the
  // screen, the PNG, the SVG and the PDF cannot disagree about it.
  var GATE_NAME = /gate|sign-?off|complete|milestone|certificat|inspection|handover|practical/i;

  // ---- date helpers. Utils.addDays returns a DATE, not a string (the chart's
  // day loop reads `.getDay()` off it), and Utils.fmtDate turns either back
  // into 'YYYY-MM-DD'. The builder promises STRING dates everywhere, so every
  // value that leaves these helpers is normalised - a Date leaking into
  // scale.to or into a window bound would make `'2026-05-01' > Date` silently
  // false and a "starts after the window" test would never fire.
  function toDL(d) {
    if (!d) {
      return '';
    }
    if (typeof d === 'string') {
      return d.slice(0, 10);
    }
    if (U && U.fmtDate) {
      return U.fmtDate(d) || '';
    }
    if (d instanceof Date && !isNaN(d.getTime())) {
      var m = String(d.getMonth() + 1);
      var dd = String(d.getDate());
      return (
        d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (dd.length < 2 ? '0' + dd : dd)
      );
    }
    return '';
  }

  function daysBetween(a, b) {
    if (U && U.daysBetween) {
      return U.daysBetween(a, b);
    }
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  }

  function addDays(d, n) {
    if (U && U.addDays) {
      return toDL(U.addDays(d, n));
    }
    var x = new Date(d);
    x.setDate(x.getDate() + n);
    return toDL(x);
  }

  function todayStr() {
    if (U && U.todayStr) {
      return toDL(U.todayStr());
    }
    return toDL(new Date());
  }

  /* G3's milestone rule, in ONE place: a diamond is a diamond by FLAG
     (t.milestone), by SHAPE (zero duration), or by NAME when a same-day
     row reads as a gate or sign-off. The export used to carry its own
     copy of this test - two copies of the same rule is how a screen and
     a picture start disagreeing.

     A PHASE is never a diamond: its duration is a rollup that can legitimately
     be zero (a phase whose children share one day), and a phase summary
     drawn as a diamond would say "this is a single date" about a whole
     body of work. Nor is a synthetic group header. */
  function isMilestone(t) {
    if (!t || t.isPhase || t.isGroupHeader) {
      return false;
    }
    return !!(
      t.milestone ||
      Number(t.duration) === 0 ||
      (t.startDate === t.endDate && GATE_NAME.test(t.name || ''))
    );
  }

  /* A phase gate is a milestone that names itself one. Used only by the
     'gates' policy: it is the line a reader needs, not a new data field. */
  function isGateMilestone(t) {
    return isMilestone(t) && GATE_NAME.test(t.name || '');
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

  /* ---- GANTT-1: the swimlane axis. A band is a VALUE (a trade, a
     person); tasks sort by start date then WBS inside it. Phases are not
     a value on either axis, so they are left out of these two modes -
     they are the default axis, not a row that fits every band. ---- */
  function groupKeyOf(t, groupBy) {
    var v =
      groupBy === 'trade'
        ? t.trade || t.category || t.discipline || t.workType
        : t.assignedTo || t.assignee || t.owner;
    v = String(v == null ? '' : v).trim();
    if (v) {
      return v;
    }
    return groupBy === 'trade' ? 'No trade' : 'Unassigned';
  }

  // '1.10' sorts after '1.9': WBS numbers are dotted, not strings.
  function wbsCmp(a, b) {
    var pa = String(a || '').split('.');
    var pb = String(b || '').split('.');
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var na = Number(pa[i] || 0);
      var nb = Number(pb[i] || 0);
      if (na !== nb) {
        return na - nb;
      }
    }
    return 0;
  }

  function orderGroupRows(tasks, groupBy, wbs) {
    var buckets = {};
    var order = [];
    tasks.forEach(function (t) {
      if (t.isPhase) {
        return;
      }
      var k = groupKeyOf(t, groupBy);
      if (!buckets[k]) {
        buckets[k] = [];
        order.push(k);
      }
      buckets[k].push(t);
    });
    order.sort(function (a, b) {
      return a < b ? -1 : a > b ? 1 : 0;
    });
    var rows = [];
    order.forEach(function (k) {
      rows.push({
        row: {
          id: '__group__' + k,
          name: k,
          isGroupHeader: true,
          groupKey: k
        },
        kind: 'group',
        depth: 0
      });
      buckets[k]
        .sort(function (a, b) {
          if (a.startDate !== b.startDate) {
            return a.startDate < b.startDate ? -1 : 1;
          }
          return wbsCmp(wbs[a.id], wbs[b.id]);
        })
        .forEach(function (t) {
          rows.push({ row: t, kind: 'task', depth: 1 });
        });
    });
    return rows;
  }

  /* ---- GANTT-1: the visible time window. 'all' is the whole project;
     'next90' runs from today (or the project's own start if that is
     later) for ninety days; a { from, to } pair is the owner's custom
     window. An unusable custom pair falls back to the whole project
     rather than drawing a zero-width chart. ---- */
  function resolveWindow(opt, min, max, today) {
    if (opt === 'next90') {
      var from = today > min ? today : min;
      return { from: from, to: addDays(today, 90), mode: 'next90' };
    }
    if (opt && typeof opt === 'object' && opt.from && opt.to) {
      if (opt.from <= opt.to) {
        return { from: opt.from, to: opt.to, mode: 'custom' };
      }
    }
    return { from: min, to: max, mode: 'all' };
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
    var groupBy = o.groupBy === 'trade' || o.groupBy === 'assignee' ? o.groupBy : 'phase';
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

    // ---- the project range (the window's default).
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
    var win = resolveWindow(o.window, min, max, today);
    var totalDays = daysBetween(win.from, win.to) + 1;
    if (totalDays < 1) {
      totalDays = 1;
    }
    // Labels never overlap: day ticks on a short window, week on a
    // medium one, month on the long ones.
    var unit = totalDays <= 45 ? 'day' : totalDays <= 200 ? 'week' : 'month';

    // ---- rows, WBS over the FULL phase order (a collapsed child or a
    // swimlane switch must never renumber the plan), then the tidy pass.
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

    var rows = groupBy === 'phase' ? phOrdered.rows : orderGroupRows(tasks, groupBy, wbs);
    var collapsed = {};
    if (tidy && groupBy === 'phase') {
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
        var afterWindow = sp.start > win.to;
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
    var seenLink = {};
    var pushLink = function (from, to, critical, derived) {
      var key = from + '>' + to;
      if (seenLink[key]) {
        return;
      }
      seenLink[key] = true;
      links.push({ from: from, to: to, critical: !!critical, derived: !!derived });
    };
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
        pushLink(from, to, rowTask[from].critical && t.critical);
      });
    });
    // GANTT-1: a phase-gate milestone is often parented to its phase but
    // not wired to the phase SUMMARY as a predecessor, so the gates view
    // used to draw no arrow at all on a plan whose gates live inside the
    // phase. The phase row is the summary the reader is following, so the
    // band is drawn phase -> its own gate milestone. It is marked
    // `derived`: it is a READING of the plan, not a row in it, so the
    // gates policy may draw it but nothing may offer to delete it.
    rows.forEach(function (r) {
      if (r.kind !== 'phase') {
        return;
      }
      var ph = r.row;
      rows.forEach(function (r2) {
        if (r2.kind !== 'task' || !isGateMilestone(r2.row)) {
          return;
        }
        if (!parentOf(r2.row, ph)) {
          return;
        }
        pushLink(String(ph.id), String(r2.row.id), r2.row.critical && ph.critical, true);
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
      if (l.derived) {
        // A derived summary line belongs to the gates reading and nowhere
        // else: 'all' promises the plan's own lines, and 'near'/'critical'
        // measure real edges.
        return policy === 'gates';
      }
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
      scale: { from: win.from, to: win.to, totalDays: totalDays, unit: unit },
      orphans: phOrdered.orphans,
      policy: policy,
      tidy: tidy,
      collapsed: collapsed,
      groupBy: groupBy,
      window: win.mode
    };
  }

  ns.GanttView = {
    build: build,
    reduceLinks: reduceLinks,
    isMilestone: isMilestone,
    isGateMilestone: isGateMilestone,
    groupKeyOf: groupKeyOf,
    ROW_H: ROW_H,
    PHASE_GAP: PHASE_GAP
  };
})((window.MMGR = MMGR));
