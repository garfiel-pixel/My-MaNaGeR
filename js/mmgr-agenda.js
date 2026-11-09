/* ============================================================
   My MaNaGeR, merged agenda model (Leantime-inspired)
   ------------------------------------------------------------
   One chronological feed over records the project already holds:
     tasks (from endDate), milestones, meetings, open issues, open
     change requests, and live ideas.

   The rules live here, once:
     - one window rule (7 days, 30 days, or every dated record)
     - past-dated open work stays visible and is flagged overdue
     - past meetings and past ideas drop out (they are history)
     - deterministic sort and day grouping
     - iCalendar text for the download button

   No DOM, no storage, no timers.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const DAY = 86400000;
  const WINDOWS = [7, 30, 0];
  const KIND_ORDER = { task: 0, milestone: 1, meeting: 2, issue: 3, change: 4, idea: 5 };
  const KIND_LABEL = {
    task: 'Task',
    milestone: 'Milestone',
    meeting: 'Meeting',
    issue: 'Issue',
    change: 'Change',
    idea: 'Idea'
  };
  const SECTIONS = {
    task: 'wbs',
    milestone: 'gantt',
    meeting: 'meet',
    issue: 'risk',
    change: 'chg',
    idea: 'ideas'
  };
  // Deliberately local: the agenda must not depend on MMGR.Ideas being
  // loaded first. The two terminal stages are the same keys.
  const TERMINAL_IDEA = { implemented: true, deferred: true };

  function parseISO(value) {
    if (typeof value !== 'string') {
      return null;
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!m) {
      return null;
    }
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    const t = Date.UTC(y, mo - 1, d);
    const chk = new Date(t);
    if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) {
      return null;
    }
    return t;
  }

  function isoOf(t) {
    return new Date(t).toISOString().slice(0, 10);
  }

  function addDays(t, n) {
    return t + n * DAY;
  }

  function todayMs(opts) {
    let raw = opts && opts.today ? opts.today : '';
    if (!raw && ns.Utils && typeof ns.Utils.todayStr === 'function') {
      raw = ns.Utils.todayStr();
    }
    if (!raw) {
      raw = isoOf(Date.now());
    }
    const t = parseISO(raw);
    return t === null ? parseISO(isoOf(Date.now())) : t;
  }

  function statusLabel(status) {
    const key = String(status || 'todo');
    const map = {
      todo: 'To do',
      inprogress: 'In progress',
      blocked: 'Blocked',
      completed: 'Completed',
      leadtime: 'Lead time'
    };
    return map[key] || key;
  }

  function stageLabel(stage) {
    const map = {
      idea: 'Idea',
      research: 'Research',
      prototype: 'Prototype',
      validation: 'Validation',
      implemented: 'Implemented',
      deferred: 'Deferred'
    };
    return map[stage] || 'Idea';
  }

  function titleCase(v) {
    const s = String(v || '').trim();
    if (!s) {
      return '';
    }
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function build(state, opts) {
    const o = opts || {};
    const days = WINDOWS.indexOf(o.days) === -1 ? 30 : o.days;
    const start = todayMs(o);
    const end = days === 0 ? Infinity : addDays(start, days);
    const events = [];
    const seen = {};

    function push(kind, key, dateStr, title, detail) {
      const t = parseISO(dateStr);
      if (t === null) {
        return;
      }
      const past = t < start;
      // Past meetings and past ideas are history, not agenda. Past-dated
      // open work stays: an overdue task is exactly what the feed is for.
      if (past && (kind === 'meeting' || kind === 'idea')) {
        return;
      }
      if (!past && t > end) {
        return;
      }
      const id = kind + ':' + String(key);
      if (seen[id]) {
        return;
      }
      seen[id] = 1;
      const delta = Math.round((t - start) / DAY);
      events.push({
        id: id,
        kind: kind,
        title: String(title || ''),
        detail: String(detail || ''),
        date: isoOf(t),
        tone: past ? 'late' : delta <= 2 ? 'now' : 'later',
        section: SECTIONS[kind],
        targetId: String(key),
        overdue: past && kind !== 'meeting' && kind !== 'idea'
      });
    }

    (state && Array.isArray(state.tasks) ? state.tasks : []).forEach(function (t) {
      if (!t || t.status === 'completed' || t.isPhase) {
        return;
      }
      const due = t.endDate || t.startDate;
      if (!due) {
        return;
      }
      if (t.milestone) {
        push('milestone', t.id, due, t.name || 'Untitled milestone', 'Milestone');
        return;
      }
      push(
        'task',
        t.id,
        due,
        t.name || 'Untitled task',
        t.assignee ? t.assignee + ', ' + statusLabel(t.status) : statusLabel(t.status)
      );
    });

    (state && Array.isArray(state.meetings) ? state.meetings : []).forEach(function (m, idx) {
      if (!m) {
        return;
      }
      const date = m.date || (typeof m.startedAt === 'string' ? m.startedAt.slice(0, 10) : '');
      push(
        'meeting',
        m.id === undefined ? 'm' + idx : m.id,
        date,
        m.title || 'Meeting',
        m.kind ? titleCase(m.kind) + ' meeting' : 'Meeting'
      );
    });

    (state && Array.isArray(state.issues) ? state.issues : []).forEach(function (it, idx) {
      if (!it) {
        return;
      }
      const status = String(it.status || 'open').toLowerCase();
      if (status === 'resolved' || status === 'closed') {
        return;
      }
      push(
        'issue',
        it.id === undefined ? 'i' + idx : it.id,
        it.targetDate || it.raisedDate || '',
        it.description || 'Issue',
        it.owner ? 'Owner: ' + it.owner : 'Open issue'
      );
    });

    (state && Array.isArray(state.changes) ? state.changes : []).forEach(function (c, idx) {
      if (!c) {
        return;
      }
      const status = String(c.status || 'submitted').toLowerCase();
      if (status === 'approved' || status === 'rejected') {
        return;
      }
      push(
        'change',
        c.id === undefined ? 'c' + idx : c.id,
        c.date || c.raisedDate || '',
        c.title || 'Change request',
        titleCase(status) + ' change request'
      );
    });

    (state && Array.isArray(state.ideas) ? state.ideas : []).forEach(function (idea) {
      if (!idea || TERMINAL_IDEA[idea.stage]) {
        return;
      }
      const created = typeof idea.createdAt === 'string' ? idea.createdAt.slice(0, 10) : '';
      push('idea', idea.id, created, idea.title || 'Idea', stageLabel(idea.stage) + ' stage');
    });

    events.sort(function (a, b) {
      if (a.date !== b.date) {
        return a.date < b.date ? -1 : 1;
      }
      const ka = KIND_ORDER[a.kind];
      const kb = KIND_ORDER[b.kind];
      if (ka !== kb) {
        return ka - kb;
      }
      return a.title.localeCompare(b.title);
    });
    return events;
  }

  function group(events) {
    const out = [];
    const index = {};
    (events || []).forEach(function (ev) {
      if (!ev || !ev.date) {
        return;
      }
      if (!index[ev.date]) {
        index[ev.date] = { date: ev.date, events: [] };
        out.push(index[ev.date]);
      }
      index[ev.date].events.push(ev);
    });
    return out;
  }

  function windowLabel(days) {
    if (days === 7) {
      return 'Next 7 days';
    }
    if (days === 0) {
      return 'Every dated record';
    }
    return 'Next 30 days';
  }

  function summary(state, events, opts) {
    const list = events || build(state, opts);
    const counts = {};
    Object.keys(KIND_LABEL).forEach(function (k) {
      counts[k] = 0;
    });
    let late = 0;
    list.forEach(function (ev) {
      counts[ev.kind] = (counts[ev.kind] || 0) + 1;
      if (ev.overdue) {
        late += 1;
      }
    });
    const days = opts && WINDOWS.indexOf(opts.days) !== -1 ? opts.days : 30;
    return {
      total: list.length,
      counts: counts,
      overdue: late,
      days: days,
      window: windowLabel(days)
    };
  }

  const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTH = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
  ];

  function dayLabel(dateStr, opts) {
    const t = parseISO(dateStr);
    if (t === null) {
      return String(dateStr || '');
    }
    const start = todayMs(opts);
    const delta = Math.round((t - start) / DAY);
    if (delta === 0) {
      return 'Today';
    }
    if (delta === 1) {
      return 'Tomorrow';
    }
    if (delta === -1) {
      return 'Yesterday';
    }
    const d = new Date(t);
    return WEEKDAY[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTH[d.getUTCMonth()];
  }

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  // RFC 5545: content lines longer than 75 octets fold with CRLF + one
  // space. Count UTF-16 units here; every string the app writes is ASCII
  // once escaped, so units and octets agree.
  function fold(line) {
    let out = '';
    let rest = String(line);
    while (rest.length > 73) {
      out += rest.slice(0, 73) + '\r\n ';
      rest = rest.slice(73);
    }
    return out + rest;
  }

  function stamp(now) {
    // new Date(x), not `x instanceof Date`: a Date built in another realm
    // (tests, a future worker) fails instanceof and would silently stamp
    // the wall clock instead of the supplied instant.
    const d = now && typeof now.getTime === 'function' ? new Date(now.getTime()) : new Date();
    function p(n) {
      return n < 10 ? '0' + n : String(n);
    }
    return (
      d.getUTCFullYear() +
      p(d.getUTCMonth() + 1) +
      p(d.getUTCDate()) +
      'T' +
      p(d.getUTCHours()) +
      p(d.getUTCMinutes()) +
      p(d.getUTCSeconds()) +
      'Z'
    );
  }

  function ics(state, opts) {
    const o = opts || {};
    const events = build(state, o);
    const calName = o.calendarName || 'Project agenda';
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//My MaNaGeR//Agenda//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + esc(calName)
    ];
    const dtstamp = stamp(o.now);
    events.forEach(function (ev) {
      const start = parseISO(ev.date);
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + esc(ev.id + '@mymanager'));
      lines.push('DTSTAMP:' + dtstamp);
      lines.push('DTSTART;VALUE=DATE:' + ev.date.replace(/-/g, ''));
      lines.push('DTEND;VALUE=DATE:' + isoOf(addDays(start, 1)).replace(/-/g, ''));
      lines.push('SUMMARY:' + esc(ev.title));
      if (ev.detail) {
        lines.push('DESCRIPTION:' + esc(ev.detail));
      }
      lines.push('CATEGORIES:' + esc(KIND_LABEL[ev.kind] || ev.kind));
      lines.push('TRANSP:TRANSPARENT');
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  ns.Agenda = {
    WINDOWS: WINDOWS,
    KIND_LABEL: KIND_LABEL,
    parseISO: parseISO,
    build: build,
    group: group,
    summary: summary,
    windowLabel: windowLabel,
    dayLabel: dayLabel,
    ics: ics
  };
})(MMGR);
