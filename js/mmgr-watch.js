/* ============================================================
   My MaNaGeR - Background Assistant (watchers + mailbox)
   ------------------------------------------------------------
   Task 6 (owner directive 2026-09-19): deterministic watchers
   over live state. Every notice's text is derived from real
   fields - traceable, never invented. Notices persist on the
   local machine in s.aiInbox until the user deletes them
   (deleting silences the current occurrence, not the
   condition - a persistent condition resurfaces later, by
   design). Premium gate comes LATER via the Entitlements seam;
   ships ungated. Zero network. Zero-throw.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';
  const U = ns.Utils;

  // Lead-time watchdog: a lead-time task whose Expected date is within 2
  // days (or past) and not delivered. Owner's example: "steel fixing lead
  // time - two days left, signal the PM."
  function watchLeadTimes(s, today) {
    const out = [];
    for (const t of s.tasks || []) {
      if (!t.leadTime || !t.expectedDate || t.delivered) {
        continue;
      }
      const d = U.daysBetween(today, t.expectedDate); // negative = overdue
      if (d <= 2) {
        out.push({
          kind: 'leadtime',
          severity: d < 0 ? 'attention' : 'caution',
          text:
            t.name +
            ' lead time: ' +
            (d < 0 ? Math.abs(d) + ' day(s) past' : d + ' day(s) left') +
            ' (expected ' +
            t.expectedDate +
            '). Check on the vendor.'
        });
      }
    }
    return out;
  }

  // Budget watchdog: any category running >=10% over planned.
  // Severity tiers (owner 2026-09-28): 'attention' = red dot, money or dates
  // already hurt; 'caution' = yellow dot, act before it hurts; 'info' = blue
  // dot, opportunity or context. Dot colors come from the theme-aware
  // --dot-* status tokens (never raw hex here).
  function watchBudget(s) {
    const out = [];
    const byCat = {};
    for (const b of s.budgetLines || []) {
      const cat = b.category || 'Uncategorized';
      if (!byCat[cat]) {
        byCat[cat] = { planned: 0, actual: 0 };
      }
      byCat[cat].planned += +b.planned || 0;
      byCat[cat].actual += (+b.actual || 0) + (+b.committed || 0);
    }
    for (const cat in byCat) {
      const c = byCat[cat];
      if (c.planned > 0 && c.actual > c.planned * 1.1) {
        out.push({
          kind: 'budget',
          severity: 'caution',
          text:
            cat +
            ' is running ' +
            Math.round((c.actual / c.planned - 1) * 100) +
            '% over plan (' +
            Math.round(c.actual).toLocaleString() +
            ' of ' +
            Math.round(c.planned).toLocaleString() +
            ').'
        });
      }
    }
    return out;
  }

  // Resource watchdog: any resource allocated above 100%.
  function watchResources(s) {
    const out = [];
    for (const r of s.resources || []) {
      if ((+r.allocation || 0) > 100) {
        out.push({
          kind: 'resource',
          severity: 'info',
          text:
            r.name + ' is allocated ' + r.allocation + '% - over capacity. Consider rebalancing.'
        });
      }
    }
    return out;
  }

  // Weather-aware scheduling hint (Task 9): weather-EXPOSED tasks whose
  // window contains a forecast risk day. Reads ONLY the forecast module's
  // cached days through its own riskDays() - same thresholds (precip 60%,
  // heat 32C, cold 0C), same source of truth; this never invents weather.
  // Offline (no/expired cache) it silently returns nothing.
  function watchWeather(s) {
    if (!ns.Forecast || !ns.Forecast.riskDays) {
      return [];
    }
    const risky = ns.Forecast.riskDays(s);
    if (!risky || !risky.length) {
      return [];
    }
    const out = [];
    for (const t of s.tasks || []) {
      if (!t.weatherExposed || !t.startDate || !t.endDate) {
        continue;
      }
      for (const d of risky) {
        if (d.date >= t.startDate && d.date <= t.endDate) {
          const why = d.alerts && d.alerts.length ? d.alerts.join(', ') : 'weather risk';
          out.push({
            kind: 'weather',
            severity: 'info',
            text:
              t.name +
              ' runs ' +
              t.startDate +
              ' to ' +
              t.endDate +
              ' - forecast flags ' +
              d.date +
              ' (' +
              why +
              '). Check the window.'
          });
          break; // one notice per task, not per day
        }
      }
    }
    return out;
  }

  // Schedule-health watcher (owner 2026-09-26): the assistant reads the
  // plan like a consultant and recommends changes - NEVER edits, and never
  // more than one notice per condition (the run() dedup handles repeats).
  // Grounded strictly in stored state: no invention, no model calls.
  function watchSchedule(s) {
    const out = [];
    const tasks = (s.tasks || []).filter(t => t.startDate && t.endDate && !t.isPhase);
    if (tasks.length < 3) {
      return out;
    }
    // 1. Phase gates with zero slack: a failed inspection cascades into the
    // next phase. Gates on the critical path with no float deserve reserve.
    const gates = (s.tasks || []).filter(t => /gate/i.test(t.name || '') && !t.isPhase);
    gates.forEach(g => {
      if (
        g.critical &&
        (g.totalFloat === 0 || g.totalFloat === null || g.totalFloat === undefined)
      ) {
        out.push({
          kind: 'schedule',
          severity: 'info',
          text:
            g.name +
            ' sits on the critical path with no slack. Best practice is 2-3 days of management reserve before a gate so one failed inspection does not cascade into the next phase.'
        });
      }
    });
    // 2. Long-lead items that finish well before their successor needs them:
    // front-loaded cash with no schedule benefit - stagger the order.
    const byId = new Map((s.tasks || []).map(t => [t.id, t]));
    for (const t of tasks) {
      if (!t.leadTime || !t.expectedDate) {
        continue;
      }
      let minSuccessorStart = null,
        succName = '';
      for (const c of tasks) {
        if (!(c.predecessors || []).some(p => String(p) === String(t.id))) {
          continue;
        }
        if (minSuccessorStart === null || c.startDate < minSuccessorStart) {
          minSuccessorStart = c.startDate;
          succName = c.name;
        }
      }
      if (!minSuccessorStart) {
        continue;
      }
      const slack = U.daysBetween(t.expectedDate, minSuccessorStart);
      if (slack >= 7) {
        out.push({
          kind: 'schedule',
          severity: 'info',
          text:
            t.name +
            ' is expected ' +
            t.expectedDate +
            ' but its first successor (' +
            succName +
            ') does not start until ' +
            minSuccessorStart +
            ' - ' +
            slack +
            ' days of idle lead time. Staggering this order frees cash without moving the schedule.'
        });
      }
    }
    // 3. Weather-sensitive tasks with zero buffer: resequence or add float
    // so one rain day does not land on the critical chain.
    for (const t of tasks) {
      if (!t.weatherSensitive) {
        continue;
      }
      const dur = parseInt(t.duration) || 0;
      if (t.critical && dur >= 3 && !t._schedPad) {
        out.push({
          kind: 'schedule',
          severity: 'info',
          text:
            t.name +
            ' is weather-sensitive, critical, and runs ' +
            dur +
            ' working days with no buffer. Check the window against the rainy season or resequence it off the chain.'
        });
      }
    }
    // 4. Early drift: completed/started tasks that ended after their plan
    // (or are running past their end date) - catch slip before it compounds.
    const today = U.todayStr();
    for (const t of tasks) {
      if (t.status === 'completed' && t.completedDate && t.endDate && t.completedDate > t.endDate) {
        out.push({
          kind: 'schedule',
          severity: 'attention',
          text:
            t.name +
            ' finished ' +
            t.completedDate +
            ' but was planned to finish ' +
            t.endDate +
            ' - actual slip already on the record. Check whether its successors absorbed it or inherited it.'
        });
      } else if (t.status === 'inprogress' && t.endDate && t.endDate < today) {
        out.push({
          kind: 'schedule',
          severity: 'attention',
          text:
            t.name +
            ' is still in progress past its ' +
            t.endDate +
            ' end date. Update the plan or the end date before the slip cascades.'
        });
      }
    }
    return out;
  }

  // Parallel-work spotter (owner 2026-09-28): the PM kicks off one task and
  // the assistant points at work that could start alongside it instead of
  // queueing behind it. Two honest signals, both derived from the same
  // data the WBS parallel badges use (Schedule.parallelGroups):
  //   1. KICKOFF NUDGE: the user starts task A (status inprogress) while a
  //      non-adjacent peer shares its window - name the peer, cite the
  //      shared window, and say what both need before starting (resource
  //      names when they overlap, otherwise predecessor readiness).
  //   2. CLUSTER SUMMARY: an upcoming window with N>=3 same-day starts
  //      that have NO predecessors between them (independent starts) - one
  //      blue notice naming the window and the trades, capped at 1 per run.
  // Never invents tasks, never chatters: dedup handles repeats.
  function watchParallel(s) {
    const out = [];
    const tasks = (s.tasks || []).filter(t => !t.isPhase && t.startDate && t.endDate);
    if (tasks.length < 2) {
      return out;
    }
    const groups =
      ns.Schedule && ns.Schedule.parallelGroups ? ns.Schedule.parallelGroups(s.tasks) : null;
    if (!groups) {
      return out;
    }
    const byId = new Map((s.tasks || []).map(t => [t.id, t]));
    const nameOf = id => {
      const t = byId.get(id);
      return t ? t.name || id : id;
    };

    // 1. Kickoff nudges: in-progress tasks with ready-to-run peers.
    const running = tasks.filter(t => t.status === 'inprogress');
    for (const a of running) {
      const g = groups.get(a.id);
      if (!g || !g.peers.length) {
        continue;
      }
      const peers = g.peers.map(id => byId.get(id)).filter(p => p && p.status === 'todo');
      if (!peers.length) {
        continue;
      }
      const peer = peers[0];
      // Shared-resource read: if both name the same assignee, say so -
      // starting both needs a crew decision, which is the actionable point.
      const sameCrew = a.assignee && peer.assignee && a.assignee === peer.assignee;
      const need = sameCrew
        ? 'Both name ' +
          peer.assignee +
          ' - split the crew or sequence them before kicking off both.'
        : 'Different crews, no shared predecessor - it can start alongside.';
      out.push({
        kind: 'parallel',
        severity: 'info',
        text:
          nameOf(a.id) +
          ' is running, and ' +
          nameOf(peer.id) +
          ' shares its window (' +
          peer.startDate +
          ' to ' +
          peer.endDate +
          '). ' +
          need
      });
      break; // one kickoff nudge per run - the mailbox must stay quiet
    }

    // 2. One cluster summary: >=3 independent same-window starts ahead.
    //    Independent = no predecessor links between any two members, so the
    //    owner could parallelize the whole group if crews allow.
    const byStart = new Map();
    for (const t of tasks) {
      if (t.status !== 'todo') {
        continue;
      }
      if (!byStart.has(t.startDate)) {
        byStart.set(t.startDate, []);
      }
      byStart.get(t.startDate).push(t);
    }
    const today = U.todayStr();
    const starts = Array.from(byStart.keys())
      .filter(d => d >= today)
      .sort();
    for (const day of starts) {
      const group = byStart.get(day);
      if (group.length < 3) {
        continue;
      }
      const ids = new Set(group.map(t => t.id));
      const linked = group.some(t => (t.predecessors || []).some(p => ids.has(p)));
      if (linked) {
        continue;
      } // a dependency inside the group = not independent
      const names = group.slice(0, 4).map(t => t.name);
      const more = group.length > 4 ? ' and ' + (group.length - 4) + ' more' : '';
      out.push({
        kind: 'parallel',
        severity: 'info',
        text:
          group.length +
          ' tasks can start together on ' +
          day +
          ' with no handoffs between them: ' +
          names.join(', ') +
          more +
          '. Worth a crew check before they queue single-file.'
      });
      break; // one cluster notice per run
    }
    return out;
  }

  /* EXP-1 (REFINEMENT-DIRECTIVE-2026-10-24): compliance expiries reach the
     notice box. COI, licensing and permits were visible on a dashboard card
     and nowhere else, so nothing warned before a certificate lapsed. This
     reads the SAME rollup the card draws (ns.Compliance.getExpiryRollup), so
     the two can never list different items.

     One notice per item per band, not per day: the text names the expiry DATE
     and the band ("due within 30 days"), never a live day count, so the
     existing kind+text dedupe raises each band exactly once and the next band
     is a genuinely new notice. Bands: overdue, 7, 14, 30, 60 days. */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function findStakeholder(s, label) {
    const sts = (s && s.stakeholders) || [];
    for (const st of sts) {
      const n = String(st.name || '').trim();
      if (n && String(label || '').indexOf(n) === 0) {
        return st;
      }
    }
    return null;
  }

  function watchExpiries(s) {
    if (s.expiryWatcher === false) {
      return [];
    }
    if (!ns.Compliance || !ns.Compliance.getExpiryRollup) {
      return [];
    }
    const items = ns.Compliance.getExpiryRollup(120) || [];
    const out = [];
    for (const it of items) {
      const d = it.daysLeft;
      // Null = the rollup knows the item but has no date to band (EMR
      // re-verification). A notice needs a date to name, so it stays on the
      // dashboard card rather than inventing one here.
      if (d === null || d === undefined || d > 60) {
        continue;
      }
      let band, sev, phrase;
      if (d < 0) {
        band = 'overdue';
        sev = 'attention';
        phrase = 'is overdue (was due ' + it.date + ')';
      } else if (d <= 7) {
        band = '7';
        sev = 'attention';
        phrase = 'is due within 7 days (' + it.date + ')';
      } else if (d <= 14) {
        band = '14';
        sev = 'caution';
        phrase = 'is due within 14 days (' + it.date + ')';
      } else if (d <= 30) {
        band = '30';
        sev = 'caution';
        phrase = 'is due within 30 days (' + it.date + ')';
      } else {
        band = '60';
        sev = 'info';
        phrase = 'is due within 60 days (' + it.date + ')';
      }
      const st = findStakeholder(s, it.label);
      const contact = st && st.contact ? String(st.contact).trim() : '';
      const email = EMAIL_RE.test(contact) ? contact : '';
      const action = /licen[cs]e/i.test(it.kind + ' ' + it.label)
        ? 'renewed licence'
        : 'renewed insurance certificate';
      const docWord =
        it.kind === 'Permit'
          ? 'permit'
          : it.kind === 'Warranty'
            ? 'warranty document'
            : 'certificate';
      const advice = email
        ? 'Ask ' + contact + ' for the ' + action + ' before ' + it.date + '.'
        : 'Add a contact for ' +
          (st && st.name ? st.name : 'this item') +
          ' so a reminder can go out before ' +
          it.date +
          '.';
      const subject = 'Renewed ' + action + ' needed';
      const body =
        'Please send the ' +
        action +
        ' for ' +
        it.label.replace(/\s*,\s*/g, ', ') +
        ', which ' +
        phrase +
        '. Thank you.';
      out.push({
        kind: 'expiry',
        band: band,
        severity: sev,
        text: it.label.replace(/\s*,\s*/g, ', ') + ' ' + phrase + ' - ' + docWord + '.',
        advice: advice,
        remind: email
          ? 'mailto:' +
            encodeURIComponent(email) +
            '?subject=' +
            encodeURIComponent(subject) +
            '&body=' +
            encodeURIComponent(body)
          : ''
      });
    }
    // Block the risk: a task handed to a subcontractor whose cover lapses
    // before that task ends. Same fields, same dates - no invention.
    const today = U.todayStr();
    for (const t of s.tasks || []) {
      if (!t.endDate || t.status === 'completed' || t.endDate < today) {
        continue;
      }
      const who = String(t.assignee || '').trim();
      if (!who) {
        continue;
      }
      for (const st of s.stakeholders || []) {
        const n = String(st.name || '').trim();
        if (!n || (who !== n && who.indexOf(n) === -1 && n.indexOf(who) === -1)) {
          continue;
        }
        const pairs = [
          ['COI', st.coiExpiry],
          ['licence', st.licenseExpiry]
        ];
        for (const [kind, date] of pairs) {
          if (date && date < t.endDate) {
            out.push({
              kind: 'expiry',
              band: 'task',
              severity: 'caution',
              text:
                t.name +
                ' is assigned to ' +
                n +
                ', whose ' +
                kind +
                ' expires ' +
                date +
                ', before this task ends on ' +
                t.endDate +
                '.',
              advice: 'Ask ' + n + ' for the renewed ' + kind + ' before the task starts.'
            });
          }
        }
      }
    }
    return out;
  }

  /* RISK-1 (REFINEMENT-DIRECTIVE-2026-10-24): the finish target speaks.
     The dashboard used to show "At Risk, 1d over target" with no reason and
     no advice, and nothing raised it as a notice. Every cause below is traced
     to a real stored field, and every suggestion states the number it rests
     on. Never promises an outcome: each line is labelled a suggestion. */
  function watchFinishTarget(s, today) {
    if (s.finishWatcher === false) {
      return [];
    }
    if (!ns.Schedule || !ns.Schedule.projectedFinish) {
      return [];
    }
    const pf = ns.Schedule.projectedFinish(s);
    if (!pf || pf.overrunDays <= 0) {
      return [];
    }
    const todayStr = today || U.todayStr();
    const tasks = (s.tasks || []).filter(t => !t.isPhase);
    const crit = tasks.filter(t => t.critical);
    const byId = new Map(tasks.map(t => [String(t.id), t]));
    const over = pf.overrunDays;
    const dayWord = over === 1 ? 'day' : 'days';

    // ---- Causes. Ranked by the days each one can explain. ----
    const causes = [];
    for (const t of crit) {
      const dur = parseInt(t.duration, 10) || 0;
      if (t.status !== 'completed' && t.endDate && t.endDate < todayStr) {
        const late = U.daysBetween(t.endDate, todayStr);
        if (late > 0) {
          causes.push({
            days: late,
            text: t.name + ' is ' + late + ' day(s) past its ' + t.endDate + ' end date'
          });
        }
      }
      if (t.leadTime && t.expectedDate && !t.delivered) {
        causes.push({
          days: dur,
          text: t.name + ' waits on a lead time expected ' + t.expectedDate
        });
      }
      if (t.weatherSensitive && dur >= 3) {
        causes.push({
          days: Math.max(1, Math.round(dur * 0.2)),
          text: t.name + ' is weather-sensitive on the critical path (' + dur + ' days)'
        });
      }
      const res = (s.resources || []).find(r => r.name && r.name === t.assignee);
      if (res && (+res.allocation || 0) > 100) {
        causes.push({
          days: Math.max(1, Math.round(dur * 0.25)),
          text: t.name + ' is held by ' + res.name + ', allocated ' + res.allocation + '%'
        });
      }
      if (dur >= 5) {
        causes.push({
          days: Math.max(1, Math.round(dur * 0.1)),
          text: t.name + ' is the longest critical task at ' + dur + ' days'
        });
      }
    }
    causes.sort((a, b) => b.days - a.days);
    const top = [];
    for (const c of causes) {
      if (top.length >= 3) {
        break;
      }
      if (!top.some(x => x.text === c.text)) {
        top.push(c);
      }
    }
    const causeText = top.length
      ? 'Main causes: ' + top.map(c => c.text).join('; ') + '.'
      : 'No single task explains it: the latest planned end date is simply past the target.';

    // ---- Suggestions. At most three, ranked by the days each can recover. ----
    const sugg = [];
    const reserve = tasks.find(
      t => /reserve|contingency|buffer/i.test(t.name || '') && (parseInt(t.duration, 10) || 0) >= 1
    );
    if (reserve) {
      const rDur = parseInt(reserve.duration, 10) || 0;
      if (rDur >= over) {
        sugg.push({
          save: over,
          text:
            'Use the management reserve (' +
            rDur +
            ' ' +
            (rDur === 1 ? 'day' : 'days') +
            ') to cover the ' +
            over +
            ' ' +
            dayWord +
            ' slip.'
        });
      }
    }
    for (const b of crit) {
      for (const p of b.predecessors || []) {
        const a = byId.get(String(p));
        if (!a || !a.critical) {
          continue;
        }
        const aDur = parseInt(a.duration, 10) || 0;
        if (aDur >= 3) {
          sugg.push({
            save: Math.max(1, Math.round(aDur * 0.3)),
            text: 'Start ' + b.name + ' when ' + a.name + ' is about 70 percent done.'
          });
        }
      }
    }
    for (const t of crit) {
      const dur = parseInt(t.duration, 10) || 0;
      if (dur >= 2) {
        sugg.push({
          save: Math.max(1, Math.round(dur * 0.4)),
          text: 'Add a second crew to ' + t.name + ' (' + dur + ' days).'
        });
      }
    }
    for (const t of tasks) {
      if (t.critical || !t.assignee) {
        continue;
      }
      const floatDays = parseInt(t.totalFloat !== undefined ? t.totalFloat : t.float, 10);
      const shares = crit.some(c => c.assignee && c.assignee === t.assignee);
      if (shares && !isNaN(floatDays) && floatDays >= over) {
        sugg.push({
          save: Math.min(over, floatDays),
          text:
            t.name +
            ' has ' +
            floatDays +
            ' days of float: move it after ' +
            crit.find(c => c.assignee === t.assignee).name +
            ' to free the crew.'
        });
      }
    }
    if (over <= 3) {
      sugg.push({
        save: over,
        text: 'Agree a ' + over + ' day extension with the client.'
      });
    }
    const ldRate = +s.ldRate || 0;
    if (ldRate > 0) {
      sugg.push({
        save: 0,
        text: 'Each day costs about ' + ldRate.toLocaleString() + ' in the claim rate.'
      });
    }
    sugg.sort((a, b) => b.save - a.save);
    const seen = new Set();
    const picked = [];
    for (const g of sugg) {
      if (picked.length >= 3) {
        break;
      }
      if (!seen.has(g.text)) {
        seen.add(g.text);
        picked.push(g);
      }
    }
    return [
      {
        kind: 'finish',
        severity: over <= 14 ? 'caution' : 'attention',
        text:
          'Projected finish ' +
          pf.projected +
          ' is ' +
          over +
          ' ' +
          dayWord +
          ' past the target ' +
          pf.target +
          '. ' +
          causeText,
        advice: picked.length
          ? 'Suggestion: ' + picked.map(g => g.text).join(' ')
          : 'Suggestion: pull the latest critical task forward before agreeing a new date.',
        ask:
          'Explain this finish-target slip and what to do first: ' +
          'projected finish ' +
          pf.projected +
          ', target ' +
          pf.target +
          ', ' +
          over +
          ' ' +
          dayWord +
          ' over. ' +
          causeText
      }
    ];
  }

  // Signed-in gate (Task 9): the assistant is part of the signed-in
  // experience. Signed-out, run() is a no-op and the mailbox shows the
  // plain-language card. The Entitlements seam is the only rule source.
  function assistantActive() {
    return !!(ns.Entitlements && ns.Entitlements.aiAssistant && ns.Entitlements.aiAssistant());
  }

  // Dedup: a (kind + text) pair already in the inbox (read or unread) is
  // not re-added. Dismissed notices are removed from the array entirely,
  // so a persistent condition resurfaces as a NEW notice later - by design.
  function run() {
    try {
      if (!assistantActive()) {
        renderBell();
        return;
      }
      const s = ns.State.getState();
      if (!s || !s.tasks) {
        return;
      }
      const today = U.todayStr();
      const found = [].concat(
        watchLeadTimes(s, today),
        watchBudget(s),
        watchResources(s),
        watchWeather(s),
        watchSchedule(s),
        watchParallel(s),
        watchExpiries(s),
        watchFinishTarget(s, today)
      );
      if (!found.length) {
        return;
      }
      let added = 0;
      ns.State.updateState(function (st) {
        if (!Array.isArray(st.aiInbox)) {
          st.aiInbox = [];
        }
        const seen = new Set(st.aiInbox.map(n => n.kind + '|' + n.text));
        for (const f of found) {
          if (seen.has(f.kind + '|' + f.text)) {
            continue;
          }
          st.aiInbox.unshift({
            id: U.genId('n'),
            at: new Date().toISOString(),
            kind: f.kind,
            severity: f.severity,
            text: f.text,
            // EXP-1 / RISK-1: optional richer fields. advice is the plain
            // next step; remind is a ready mailto built ONLY from the
            // stakeholder's own contact; ask is the prompt the assistant
            // button opens with. Absent fields simply do not render.
            advice: f.advice || '',
            remind: f.remind || '',
            ask: f.ask || '',
            band: f.band || '',
            read: false
          });
          added++;
        }
        st.aiInbox = st.aiInbox.slice(0, 50); // hard cap, newest first
      });
      if (added > 0 && ns.App && ns.App.showToast) {
        ns.App.showToast('Assistant spotted ' + added + ' thing(s) - check the bell.', 'ok');
      }
      renderBell();
    } catch (e) {
      /* zero-throw: a watcher must never break the app */
    }
  }

  function unreadCount() {
    const s = ns.State.getState();
    return s && Array.isArray(s.aiInbox) ? s.aiInbox.filter(n => !n.read).length : 0;
  }

  function renderBell() {
    const bell = document.getElementById('ai-bell');
    if (!bell) {
      return;
    }
    const n = unreadCount();
    const dot = bell.querySelector('[data-bell-dot]');
    if (dot) {
      dot.hidden = n === 0;
    }
    bell.setAttribute('aria-label', 'Assistant notices' + (n ? ', ' + n + ' unread' : ''));
  }

  function openMailbox() {
    const box = document.getElementById('ai-mailbox');
    if (!box) {
      return;
    }
    const list = box.querySelector('[data-mailbox-list]');
    // Task 9: locked card for signed-out users - plain language, one route
    // to the existing sign-in sheet. No notices are computed or shown.
    if (!assistantActive()) {
      if (list) {
        list.innerHTML =
          '<div class="ai-note"><div class="ai-note-tx">The background assistant is part of the signed-in experience. Sign in and it starts watching lead times, budget and resources on this project - everything stays on this machine either way.</div>' +
          '<div style="margin-top:6px"><button class="btn btn-g btn-s" data-action="openSignIn">Sign in</button></div></div>';
      }
      renderBell();
      box.classList.add('on');
      return;
    }
    const s = ns.State.getState();
    if (list) {
      // Severity classes (owner 2026-09-28): every notice carries a colored
      // status dot from the theme-aware --dot-* tokens. attention = red
      // (money/dates hurt), caution = yellow (act before it hurts), info =
      // blue (opportunity). Legacy 'attention' notices keep their hot class.
      const SEV = { attention: 'ai-note-hot', caution: 'ai-note-caution', info: 'ai-note-info' };
      // Severity first, recency within tier (owner 2026-09-28): the newest
      // notice can be a blue info ping while a red money/date notice sits
      // below it. aiInbox is stored newest-first, so a stable sort keeps
      // recency order inside each tier; unknown severities sort last.
      const SEV_ORDER = { attention: 0, caution: 1, info: 2 };
      const sorted = (s.aiInbox || [])
        .slice()
        .sort(
          (a, b) =>
            (SEV_ORDER[a.severity] !== undefined ? SEV_ORDER[a.severity] : 99) -
            (SEV_ORDER[b.severity] !== undefined ? SEV_ORDER[b.severity] : 99)
        );
      const items =
        sorted
          .map(
            n =>
              '<div class="ai-note ' +
              (SEV[n.severity] || 'ai-note-info') +
              '">' +
              '<div class="ai-note-tx"><svg class="ico ai-sev-dot" aria-hidden="true"><use href="css/mmgr-icons.svg#i-dot"></use></svg>' +
              U.escapeHtml(n.text) +
              '</div>' +
              (n.advice ? '<div class="ai-note-advice">' + U.escapeHtml(n.advice) + '</div>' : '') +
              '<div class="ai-note-actions">' +
              (n.remind
                ? '<a class="btn btn-s btn-n" href="' +
                  U.escapeHtml(n.remind) +
                  '">Draft reminder</a>'
                : '') +
              (n.ask
                ? '<button class="btn btn-s btn-n" data-action="askAboutNotice" data-id="' +
                  U.escapeHtml(n.id) +
                  '">Ask the assistant</button>'
                : '') +
              '<button class="btn btn-s btn-n" data-action="dismissAiNote" data-id="' +
              U.escapeHtml(n.id) +
              '">Dismiss</button>' +
              '</div>' +
              '<div class="ai-note-meta">' +
              U.escapeHtml((n.at || '').slice(0, 10)) +
              '</div>'
          )
          .join('') ||
        '<div class="ai-note ai-note-empty">Nothing right now - the assistant pings you here when it spots something.</div>';
      list.innerHTML = items;
    }
    // Opening the mailbox reads everything: unread dot clears.
    ns.State.updateState(function (st) {
      (st.aiInbox || []).forEach(n => {
        n.read = true;
      });
    });
    renderBell();
    box.classList.add('on');
  }

  function closeMailbox() {
    const box = document.getElementById('ai-mailbox');
    if (box) {
      box.classList.remove('on');
    }
  }

  function dismissNote(id) {
    ns.State.updateState(function (st) {
      st.aiInbox = (st.aiInbox || []).filter(n => n.id !== id);
    });
    openMailbox(); // re-render open panel
  }

  function clearMailbox() {
    ns.State.updateState(function (st) {
      st.aiInbox = [];
    });
    openMailbox();
  }

  // RISK-1: Ask the assistant about a notice. Opens the AI window with the
  // traced facts already in the composer - the numbers stay from the watcher,
  // the assistant explains and elaborates. Nothing is sent automatically.
  function askAboutNotice(id) {
    const s = ns.State.getState();
    const note = s && Array.isArray(s.aiInbox) ? s.aiInbox.find(n => n.id === id) : null;
    if (!note || !note.ask) {
      return;
    }
    if (!(ns.AiWin && ns.AiWin.open)) {
      return;
    }
    closeMailbox();
    ns.AiWin.open();
    const input = document.getElementById('ai-q');
    if (input) {
      input.value = note.ask;
      input.focus();
    }
  }

  ns.Watch = {
    run: run,
    openMailbox: openMailbox,
    closeMailbox: closeMailbox,
    dismissNote: dismissNote,
    clearMailbox: clearMailbox,
    unreadCount: unreadCount,
    renderBell: renderBell,
    askAboutNotice: askAboutNotice,
    watchLeadTimes: watchLeadTimes,
    watchBudget: watchBudget,
    watchResources: watchResources,
    watchWeather: watchWeather,
    watchExpiries: watchExpiries,
    watchFinishTarget: watchFinishTarget
  };
})(MMGR);
window.MMGR = MMGR;
