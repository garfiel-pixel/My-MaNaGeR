/* ============================================================
   My MaNaGeR — Meeting Agendas & Live Meeting Tracking
   Ported from the monolith (MEETING_TRACKING_SPEC.md).

   Two layers:
   1. Static template library — MEET_TEMPLATES / MEET_KICKOFF_ITEMS /
      MEET_RECURRING / MEET_SPECIALIZED / MEET_AGILE, rendered as
      copy-to-clipboard agenda cards (unchanged from the monolith).
   2. Live Start/End tracking — start a meeting, check items off with
      per-item notes, see elapsed time, end it to auto-log a Comms
      entry + permanent project record in S.meetings.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;
  const R = ns.Render;

  // ---- Template library (monolith lines 3713-3761) ----
  const MEET_KICKOFF_ITEMS = [
    'Welcome & Introductions + Roles/RACI Confirmation',
    'Project Charter Walkthrough (scope, sponsor, targets, budget)',
    'Assumptions & Constraints Log (documented explicitly, not implied)',
    'Formal Charter Sign-Off (sponsor + key stakeholders)',
    'Benefits & Success Criteria Confirmation',
    'Stakeholder Register & Engagement Plan',
    'WBS & Deliverables Review',
    'Resource & Procurement Plan (long-lead items)',
    'Budget Baseline & EVM Setup',
    'Risk Workshop (populate register live)',
    'Safety/HSE, Quality & Site Logistics',
    'Schedule Target + Weather Buffer Confirmation',
    'Change Control & Governance Agreement',
    'Action Items, Next Steps & Minutes Distribution'
  ];
  const MEET_RECURRING = [
    { k: 'weekly', t: 'Weekly Progress Review', d: 'Health Score, variances, blockers, next 7 days. Link to Dashboard.', dur: '30 min' },
    { k: 'risk', t: 'Risk Review', d: 'Re-score risks, retire closed, add emerging. Populates Risk panel.', dur: '45 min' },
    { k: 'ccb', t: 'Change Control Board', d: 'Review CRs — approve/reject with impact assessment.', dur: '30 min' },
    { k: 'daily', t: 'Daily Stand-up / Toolbox Talk', d: 'Yesterday / today / blockers + safety moment.', dur: '15 min' }
  ];
  const MEET_SPECIALIZED = [
    { k: 'steer', t: 'Steering Committee / Sponsor Review', d: 'Executive-level. Health, escalations, strategic decisions.', dur: '60 min' },
    { k: 'proc', t: 'Procurement / Vendor Selection', d: 'Bid review, scoring, award recommendation.', dur: '60 min' },
    { k: 'quality', t: 'Quality Review / DMAIC Check', d: 'Defects, root cause, corrective actions.', dur: '45 min' },
    { k: 'phase', t: 'Phase-Gate / Milestone Review', d: 'Go/no-go criteria before next phase.', dur: '60 min' },
    { k: 'scope', t: 'Scope Validation / Deliverable Acceptance', d: 'Formal sign-off on completed deliverables.', dur: '45 min' },
    { k: 'lessons', t: 'Lessons Learned (Mid-Project & Closeout)', d: 'What worked, what didn\'t, actions for next phase.', dur: '60 min' }
  ];
  const MEET_AGILE = [
    { k: 'sprintplan', t: 'Sprint Planning', d: 'Commit to sprint backlog with team capacity.', dur: '60 min' },
    { k: 'sprintrev', t: 'Sprint Review', d: 'Demo completed work to stakeholders.', dur: '45 min' },
    { k: 'retro', t: 'Retrospective', d: 'Continuous improvement — start/stop/continue.', dur: '45 min' }
  ];
  const MEET_TEMPLATES = {
    kickoff: { title: 'Project Kickoff', items: MEET_KICKOFF_ITEMS, dur: '60–90 min' },
    weekly: { title: 'Weekly Progress Review', items: ['Health Score & KPI trend', 'Schedule variance & critical path', 'Budget variance (EV/PV/AC)', 'Open risks & issues', 'Blockers requiring escalation', 'Priorities for next 7 days', 'Action items'], dur: '30 min' },
    risk: { title: 'Risk Review', items: ['Review existing risks (re-score P × I)', 'Retire closed risks', 'Identify emerging risks', 'Confirm response owners', 'Update contingency reserve'], dur: '45 min' },
    ccb: { title: 'Change Control Board', items: ['Review open change requests', 'Assess scope/cost/schedule impact', 'Approve / reject / defer', 'Update baselines', 'Communicate decisions'], dur: '30 min' },
    daily: { title: 'Daily Stand-up / Toolbox Talk', items: ['Safety moment / HSE topic', 'Yesterday accomplishments', 'Today priorities', 'Blockers & help needed'], dur: '15 min' },
    steer: { title: 'Steering Committee / Sponsor Review', items: ['Executive summary & Health Score', 'Milestones achieved / upcoming', 'Budget & schedule status', 'Strategic risks & escalations', 'Decisions required from sponsor'], dur: '60 min' },
    proc: { title: 'Procurement / Vendor Selection', items: ['Scope of work confirmation', 'Bid comparison matrix', 'Scoring & evaluation', 'Award recommendation', 'Contract award & next steps'], dur: '60 min' },
    quality: { title: 'Quality Review / DMAIC Check', items: ['Defect log review', 'Root cause analysis', 'Corrective / preventive actions', 'Process improvements', 'Metrics update'], dur: '45 min' },
    phase: { title: 'Phase-Gate / Milestone Review', items: ['Deliverables completeness', 'Quality acceptance criteria', 'Budget & schedule at gate', 'Risks going forward', 'Go / no-go decision'], dur: '60 min' },
    scope: { title: 'Scope Validation', items: ['Deliverable walkthrough', 'Acceptance criteria check', 'Formal sign-off', 'Update WBS status', 'Handover items'], dur: '45 min' },
    lessons: { title: 'Lessons Learned', items: ['What worked well', 'What did not work', 'Root causes', 'Actions for future phases/projects', 'Update knowledge base'], dur: '60 min' },
    sprintplan: { title: 'Sprint Planning', items: ['Review product backlog', 'Confirm team capacity', 'Commit to sprint backlog', 'Define sprint goal'], dur: '60 min' },
    sprintrev: { title: 'Sprint Review', items: ['Demo completed stories', 'Stakeholder feedback', 'Update product backlog'], dur: '45 min' },
    retro: { title: 'Retrospective', items: ['What went well', 'What to improve', 'Action items with owners'], dur: '45 min' }
  };

  // ---- Static template rendering (monolith renderMeetings) ----
  function renderMeetings() {
    const s = ns.State.getState();
    const ul = U.$('meet-kickoff-list');
    if (ul) ul.innerHTML = MEET_KICKOFF_ITEMS.map(i => '<li class="mk-item"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg> ' + U.escapeHtml(i) + '</li>').join('');
    const meetCard = (m) => `<div class="card meet-card">
    <div class="meet-t">${U.escapeHtml(m.t)}</div>
    <div class="meet-dur"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-clock"></use></svg> ${U.escapeHtml(m.dur)}</div>
    <div class="meet-d">${U.escapeHtml(m.d)}</div>
    <div class="g6"><button class="btn btn-n btn-s" data-action="startMeeting" data-kind="${m.k}"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-arrow-right"></use></svg> Start</button><button class="btn btn-n btn-s" data-action="copyMeetingTemplate" data-kind="${m.k}"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-clipboard"></use></svg> Copy</button></div>
  </div>`;
    const rg = U.$('meet-recurring-grid');
    if (rg) rg.innerHTML = MEET_RECURRING.map(meetCard).join('');
    const sg = U.$('meet-specialized-grid');
    if (sg) sg.innerHTML = MEET_SPECIALIZED.map(meetCard).join('');
    const ag = U.$('meet-agile-sec');
    const isAgile = s.methodology === 'agile' || s.methodology === 'hybrid';
    if (ag) {
      ag.classList.toggle('is-hide', !isAgile);
      const grid = U.$('meet-agile-grid');
      if (grid) grid.innerHTML = MEET_AGILE.map(meetCard).join('');
    }
    renderPromises();
    renderSentimentHistory();
    renderActiveMeeting();
    renderMeetingHistory();
  }

  // ---- ACTION-PLAN 3.2: Team Pulse (professional, non-emoji) ----
  // Optional one-tap pulse recorded during a live meeting. Stays out of the
  // way of meeting close: skipping it is always valid. History renders as a
  // quiet sparkline on the Meetings panel. Client-side only (localStorage
  // state) — simulated-backend note: swap for a server call on migration.
  const SENTIMENT_LABELS = { positive: 'Positive', neutral: 'Neutral', concerned: 'Concerned' };
  const SENTIMENT_COLORS = { positive: 'var(--green)', neutral: 'var(--amber)', concerned: 'var(--danger)' };
  const SENTIMENT_CAP = 60;

  function recordSentiment(val) {
    const s = ns.State.getState();
    const m = s.activeMeeting;
    const label = SENTIMENT_LABELS[val];
    if (!label) return;
    ns.State.updateState(function(st) {
      if (!st.sentimentHistory) st.sentimentHistory = [];
      st.sentimentHistory.push({
        date: new Date().toISOString(),
        value: val,
        label: label,
        meeting: m ? m.title : ''
      });
      if (st.sentimentHistory.length > SENTIMENT_CAP) {
        st.sentimentHistory = st.sentimentHistory.slice(-SENTIMENT_CAP);
      }
    });
    if (ns.App && ns.App.showToast) ns.App.showToast('Pulse recorded — ' + label, 'ok');
    renderSentimentHistory();
  }

  function renderSentimentHistory() {
    const wrap = U.$('meet-sentiment-wrap');
    const body = U.$('meet-sentiment-body');
    if (!wrap || !body) return;
    const s = ns.State.getState();
    const hist = s.sentimentHistory || [];
    if (!hist.length) { wrap.classList.add('is-hide'); body.innerHTML = ''; return; }
    wrap.classList.remove('is-hide');
    const recent = hist.slice(-12);
    const bars = recent.map(h => {
      const color = SENTIMENT_COLORS[h.value] || 'var(--slate)';
      const d = h.date ? h.date.slice(0, 10) : '';
      return '<div class="sent-bar" style="background:' + color + '" title="' + U.escapeHtml(d + ' — ' + h.label + (h.meeting ? ' (' + h.meeting + ')' : '')) + '"></div>';
    }).join('');
    const pos = hist.filter(h => h.value === 'positive').length;
    const neu = hist.filter(h => h.value === 'neutral').length;
    const con = hist.filter(h => h.value === 'concerned').length;
    const last = hist[hist.length - 1];
    body.innerHTML = '<div class="sent-row"><span class="sent-last">Last: ' + U.escapeHtml(last.label) + (last.meeting ? ' · ' + U.escapeHtml(last.meeting) : '') + '</span><span class="sent-bars">' + bars + '</span></div>' +
      '<div class="sent-counts"><span style="color:var(--green)">' + pos + ' positive</span><span style="color:var(--amber)">' + neu + ' neutral</span><span style="color:var(--danger)">' + con + ' concerned</span><span class="sent-n">last ' + hist.length + ' meetings</span></div>';
  }

  // ---- Last Meeting's Promises ribbon (ACTION-PLAN 1.2) ----
  // Renders the promises captured at the close of previous meetings, keyed
  // by template kind, so the next meeting of the same kind opens on "what
  // did we promise last time". Open items older than 7 days read as
  // overdue; tick a checkbox to mark it done (writes back to state).
  function tglPromise(kind, idx) {
    const s = ns.State.getState();
    if (!s.meetingPromises || !s.meetingPromises[kind] || !s.meetingPromises[kind][idx]) return;
    ns.State.updateState(function(st) {
      if (st.meetingPromises && st.meetingPromises[kind] && st.meetingPromises[kind][idx]) {
        st.meetingPromises[kind][idx].done = !st.meetingPromises[kind][idx].done;
      }
    });
    renderPromises();
  }

  function renderPromises() {
    const wrap = U.$('meet-promises-wrap');
    const body = U.$('meet-promises');
    if (!wrap || !body) return;
    const s = ns.State.getState();
    const all = s.meetingPromises || {};
    const kinds = Object.keys(all).filter(k => (all[k] || []).length);
    if (!kinds.length) { wrap.classList.add('is-hide'); body.innerHTML = ''; return; }
    wrap.classList.remove('is-hide');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    body.innerHTML = kinds.map(k => {
      const t = MEET_TEMPLATES[k];
      const list = all[k];
      const open = list.filter(p => !p.done).length;
      const doneCount = list.length - open;
      const rows = list.map((p, i) => {
        const daysSince = p.sourceDate ? Math.round((today - new Date(p.sourceDate)) / 86400000) : 0;
        const overdue = !p.done && daysSince > 7;
        const badge = p.done
          ? '<span class="badge bg">done</span>'
          : overdue ? '<span class="badge br">overdue</span>' : '<span class="badge ba">open</span>';
        return '<div class="meet-item' + (p.done ? ' done' : '') + '">' +
          '<input type="checkbox"' + (p.done ? ' checked' : '') + ' data-action="tglPromise" data-kind="' + U.escapeHtml(k) + '" data-idx="' + i + '">' +
          '<span class="meet-item-txt">' + U.escapeHtml(p.text) + '</span>' + badge +
          (p.sourceDate ? '<span class="meet-hist-meta">from ' + U.escapeHtml(p.sourceDate) + '</span>' : '') +
          '</div>';
      }).join('');
      return '<div class="rsec"><div class="rst"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check-circle"></use></svg> Last ' + U.escapeHtml(t ? t.title : k) + '</div>' +
        '<div class="meet-items">' + rows + '</div>' +
        '<div class="meet-hist-meta">' + doneCount + ' done · ' + open + ' open</div></div>';
    }).join('');
  }

  function copyMeetingTemplate(kind) {
    const t = MEET_TEMPLATES[kind];
    if (!t) return;
    const s = ns.State.getState();
    const proj = (s.charter && s.charter.name) || '[Project Name]';
    const hs = (ns.Health && ns.Health.get && ns.Health.get()) || '—';
    const ts = new Date().toLocaleString();
    let txt = `[${ts} | My MaNaGeR | ${(s.methodology || '').toUpperCase()}]\n\n`;
    txt += `${t.title.toUpperCase()} — AGENDA\n${'='.repeat(50)}\n`;
    txt += `Project: ${proj}\nHealth Score: ${hs}\nDuration: ${t.dur}\nDate: ____________  Time: ____________\nFacilitator: ____________\nAttendees: ____________\n\n`;
    txt += `AGENDA ITEMS\n${'-'.repeat(50)}\n`;
    t.items.forEach((it, i) => { txt += `${i + 1}. ${it}\n   Notes: \n\n`; });
    txt += `\nACTION ITEMS\n${'-'.repeat(50)}\n`;
    txt += `# | Action | Owner | Due Date | Status\n`;
    txt += `1 |  |  |  | Open\n2 |  |  |  | Open\n3 |  |  |  | Open\n\n`;
    txt += `DECISIONS MADE\n${'-'.repeat(50)}\n-\n\n`;
    txt += `NEXT MEETING\n${'-'.repeat(50)}\nDate: ____________  Focus: ____________\n\n`;
    txt += `→ Populate these panels next: Charter, WBS, RACI, Risks, Budget, Stakeholders\n`;
    U.copyToClipboard(txt);
    if (ns.App && ns.App.showToast) ns.App.showToast(t.title + ' template copied — ready for your meeting!', 'ok');
  }

  function openMeetPrompt() {
    const s = ns.State.getState();
    const proj = (s.charter && s.charter.name) || '[Unnamed]';
    const hs = (ns.Health && ns.Health.get && ns.Health.get()) || '—';
    const meth = (s.methodology || 'waterfall').toUpperCase();
    const nRisks = (s.risks || []).length, nStk = (s.stakeholders || []).length, nTasks = (s.tasks || []).length;
    const prompt = `# Custom Meeting Agenda Generator\n\n## Project Context\n- Name: ${proj}\n- Methodology: ${meth}\n- Current Health Score: ${hs}\n- WBS tasks: ${nTasks} | Risks: ${nRisks} | Stakeholders: ${nStk}\n\n## Request\nGenerate a fully structured meeting agenda for: [KICKOFF / WEEKLY / RISK REVIEW / STEERING COMMITTEE / PHASE-GATE / LESSONS LEARNED / OTHER — specify]\n\n## Required Sections\n1. Objective & expected outcomes\n2. Pre-work / materials to circulate in advance\n3. Sequential agenda items with time-boxes\n4. Discussion prompts for each item\n5. Decisions required\n6. Action item table (Owner / Due / Status)\n7. Links to which panels should be updated afterward (Charter, WBS, RACI, Risks, Budget, Stakeholders, Docs)\n8. Minutes template\n\nOptimize for: alignment, no gaps, actionable outputs, populating the project tool.`;
    const txt = U.$('om-txt');
    if (txt) txt.value = prompt;
    const title = U.$('om-title');
    if (title) title.textContent = 'Custom Meeting Agenda Prompt';
    const modal = U.$('om');
    if (modal) modal.classList.add('open');
  }

  // ---- Live meeting tracking (MEETING_TRACKING_SPEC §4) ----
  // Elapsed-time auto-refresh: while a meeting is live, a 15s interval
  // updates ONLY the elapsed badge (never the whole card, so typing in a
  // note input is never interrupted by a re-render). Cleared on end/cancel.
  let _elapsedTimer = null;
  function startElapsedTimer() {
    stopElapsedTimer();
    if (!ns.State.getState().activeMeeting) return;
    _elapsedTimer = setInterval(function() {
      const badge = U.$('meet-elapsed');
      const m = ns.State.getState().activeMeeting;
      if (!badge || !m) { stopElapsedTimer(); return; }
      const elapsedMin = Math.max(0, Math.round((Date.now() - new Date(m.startedAt)) / 60000));
      const hm = Math.floor(elapsedMin / 60), mm = elapsedMin % 60;
      badge.textContent = (hm ? hm + 'h ' : '') + mm + 'm elapsed';
    }, 15000);
  }
  function stopElapsedTimer() {
    if (_elapsedTimer) { clearInterval(_elapsedTimer); _elapsedTimer = null; }
  }

  function startMeeting(kind) {
    const t = MEET_TEMPLATES[kind];
    if (!t) return;
    const s = ns.State.getState();
    if (s.activeMeeting) {
      if (ns.App && ns.App.showToast) ns.App.showToast('A meeting is already in progress — end or cancel it first.', 'err');
      return;
    }
    ns.State.updateState(function(st) {
      if (!st.meetings) st.meetings = [];
      if (st.nmeetid === undefined) st.nmeetid = 1;
      const items = kind === 'kickoff' ? MEET_KICKOFF_ITEMS : t.items;
      st.activeMeeting = {
        id: st.nmeetid++,
        kind: kind,
        title: t.title,
        startedAt: new Date().toISOString(),
        endedAt: null,
        durationMin: null,
        items: items.map(text => ({ text: text, done: false, note: '' })),
        attendees: '',
        summary: '',
        // Rank 1.5: voice capture fields — transcript text (unified state),
        // recording indicator + tier, and the IndexedDB session id (audio
        // chunks live in IndexedDB only, never in this JSON blob).
        // transcribeState: null=idle, 'transcribing', 'done', 'failed'
        // (Tier 1 offline whisper, batch-on-stop).
        transcript: '',
        captureState: null,
        captureMethod: null,
        captureSession: null,
        transcribeState: null
      };
    });
    renderMeetings();
    startElapsedTimer();
    if (ns.App && ns.App.showToast) ns.App.showToast(t.title + ' started', 'ok');
  }

  function tglMeetItem(i) {
    const s = ns.State.getState();
    if (!s.activeMeeting) return;
    ns.State.updateState(function(st) {
      if (st.activeMeeting && st.activeMeeting.items[i]) st.activeMeeting.items[i].done = !st.activeMeeting.items[i].done;
    });
    renderActiveMeeting();
  }

  // NOTE: no renderActiveMeeting() here — this fires on every keystroke and
  // re-rendering would steal focus out of the note input being typed in.
  function updMeetItemNote(i, val) {
    const s = ns.State.getState();
    if (!s.activeMeeting) return;
    ns.State.updateState(function(st) {
      if (st.activeMeeting && st.activeMeeting.items[i]) st.activeMeeting.items[i].note = val;
    });
  }

  // Same focus discipline as updMeetItemNote — save only, don't re-render.
  function updMeetField(field, val) {
    const s = ns.State.getState();
    if (!s.activeMeeting) return;
    ns.State.updateState(function(st) {
      if (st.activeMeeting) st.activeMeeting[field] = val;
    });
  }

  function endMeeting() {
    const s = ns.State.getState();
    if (!s.activeMeeting) return;
    const m = s.activeMeeting;
    // Rank 1.5: if a voice recording is live, stop it FIRST so pending
    // captions flush into m.transcript before the meeting record is built.
    if (ns.Voice && ns.Voice.isCapturing && ns.Voice.isCapturing()) {
      ns.Voice.stopCapture();
    }
    const endedAt = new Date().toISOString();
    const durationMin = Math.max(1, Math.round((new Date(endedAt) - new Date(m.startedAt)) / 60000));
    ns.State.updateState(function(st) {
      const act = st.activeMeeting;
      if (!act) return;
      act.endedAt = endedAt;
      act.durationMin = durationMin;
      const doneCount = act.items.filter(i => i.done).length;
      const lines = act.items.map(i => (i.done ? '[x] ' : '[ ] ') + i.text + (i.note ? ' — ' + i.note : '')).join('\n');
      // ACTION-PLAN 1.2: meeting-to-action closed loop — unresolved agenda
      // items and noted actions become "promises" carried into the NEXT
      // meeting of the same kind (rendered as the Last Meeting's Promises
      // ribbon). Unresolved items also flow into the auto-logged Comms
      // entry's actionItems field so Copy All carries them. This simulates
      // a backend "meeting follow-up queue" — it's client-side state, so
      // migrating to a real server later is a clean swap of this block.
      const unresolved = act.items.filter(i => !i.done);
      const noted = act.items.filter(i => i.done && (i.note || '').trim());
      const promiseCap = 30;
      if (!st.meetingPromises) st.meetingPromises = {};
      if (!st.meetingPromises[act.kind]) st.meetingPromises[act.kind] = [];
      unresolved.forEach(it => {
        if (st.meetingPromises[act.kind].length >= promiseCap) return;
        st.meetingPromises[act.kind].push({
          id: U.genShortId('P'), text: it.text, done: false,
          sourceMeetingId: act.id, sourceDate: endedAt.slice(0, 10), createdAt: new Date().toISOString()
        });
      });
      noted.forEach(it => {
        if (st.meetingPromises[act.kind].length >= promiseCap) return;
        st.meetingPromises[act.kind].push({
          id: U.genShortId('P'), text: it.note, done: true,
          sourceMeetingId: act.id, sourceDate: endedAt.slice(0, 10), createdAt: new Date().toISOString()
        });
      });
      // Auto-generate a Comms Log entry so the meeting becomes a permanent
      // record (S.commsEntries shape from mmgr-closure.js addComms).
      if (!st.commsEntries) st.commsEntries = [];
      st.commsEntries.push({
        id: U.genShortId('C'),
        date: endedAt.slice(0, 10),
        type: 'Meeting',
        attendees: act.attendees || '',
        summary: act.title + ' (' + durationMin + ' min, ' + doneCount + '/' + act.items.length + ' items covered)\n' + lines
                 + (act.summary ? '\n\nSummary: ' + act.summary : ''),
        actionItems: unresolved.map(i => i.text).join('; '),
        followUp: '',
        sourceMeetingId: act.id // T6 (2026-08-16): lets delMeeting remove this auto-logged Comms entry with its meeting
      });
      if (!st.meetings) st.meetings = [];
      st.meetings.unshift(JSON.parse(JSON.stringify(act)));
      st.activeMeeting = null;
    });
    // Rank 1.5.4: rule-based extraction from the transcript (zero AI) —
    // writes decisions into the Decision Log and actions into the
    // Meeting-to-Action promises for the next meeting of the same kind.
    if (ns.Voice && ns.Voice.applyExtractionToState) {
      ns.Voice.applyExtractionToState(m);
    }
    R.renderLog();
    R.renderComms();
    renderMeetings();
    stopElapsedTimer();
    if (ns.App && ns.App.showToast) {
      ns.App.showToast(m.title + ' ended (' + durationMin + ' min, ' + m.items.filter(i => i.done).length + '/' + m.items.length + ' covered) — logged to Comms', 'ok');
    }
  }

  function cancelActiveMeeting() {
    const s = ns.State.getState();
    if (!s.activeMeeting) return;
    if (!window.confirm('Discard this in-progress meeting? Nothing will be saved.')) return;
    ns.State.updateState(function(st) { st.activeMeeting = null; });
    stopElapsedTimer();
    renderMeetings();
  }

  // ---- Copy Minutes export (gap: completed meetings had no export path) ----
  // Renders a Word-ready minutes block for any meeting (completed or live)
  // and copies it to the clipboard: header + attendees + items with notes
  // + closing summary + action-items table.
  function copyMeetingMinutes(id) {
    const s = ns.State.getState();
    const m = (s.meetings || []).find(x => x.id === id) || s.activeMeeting;
    if (!m) return;
    const proj = (s.charter && s.charter.name) || '[Project Name]';
    const ts = new Date().toLocaleString();
    let txt = `[${ts} | My MaNaGeR | ${(s.methodology || '').toUpperCase()}]\n\n`;
    txt += `${m.title.toUpperCase()} — MINUTES\n${'='.repeat(50)}\n`;
    txt += `Project: ${proj}\n`;
    txt += `Date: ${(m.endedAt || m.startedAt || '').slice(0, 10)}\n`;
    txt += `Started: ${m.startedAt ? new Date(m.startedAt).toLocaleString() : '—'}\n`;
    txt += `Duration: ${m.durationMin != null ? m.durationMin + ' min' : Math.max(0, Math.round((Date.now() - new Date(m.startedAt)) / 60000)) + ' min (in progress)'}\n`;
    txt += `Attendees: ${(m.attendees || '—')}\n\n`;
    txt += `AGENDA & NOTES\n${'-'.repeat(50)}\n`;
    (m.items || []).forEach((it, i) => {
      txt += `${i + 1}. ${it.done ? '[x]' : '[ ]'} ${it.text}${it.note ? ' — ' + it.note : ''}\n`;
    });
    if (m.summary) {
      txt += `\nCLOSING SUMMARY\n${'-'.repeat(50)}\n${m.summary}\n`;
    }
    txt += `\nACTION ITEMS\n${'-'.repeat(50)}\n# | Action | Owner | Due | Status\n`;
    const actions = (m.items || []).filter(i => i.done && i.note);
    actions.forEach((a, i) => { txt += `${i + 1} | ${a.text} |  |  | Complete\n`; });
    if (!actions.length) txt += '1 |  |  |  | Open\n';
    U.copyToClipboard(txt);
    if (ns.App && ns.App.showToast) ns.App.showToast('Minutes copied to clipboard — paste into your email or minutes doc.', 'ok');
  }

  // ---- Rendering (MEETING_TRACKING_SPEC §5) ----
  function renderActiveMeeting() {
    const s = ns.State.getState();
    const wrap = U.$('active-meeting-wrap');
    if (!wrap) return;
    const m = s.activeMeeting;
    if (!m) { wrap.innerHTML = ''; return; }
    const elapsedMin = Math.max(0, Math.round((Date.now() - new Date(m.startedAt)) / 60000));
    const hm = Math.floor(elapsedMin / 60), mm = elapsedMin % 60;
    const elapsedTxt = (hm ? hm + 'h ' : '') + mm + 'm';
    wrap.innerHTML = `<div class="card meet-live">
      <div class="card-title"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-zap"></use></svg> ${U.escapeHtml(m.title)} — LIVE<span class="badge br meet-live-badge" id="meet-elapsed">${elapsedTxt} elapsed</span></div>
      <div class="meet-started">Started ${new Date(m.startedAt).toLocaleString()}</div>
      <div class="meet-attendees">
        <label class="cf-label">Attendees</label><input class="cf-input" value="${U.escapeHtml(m.attendees || '')}" data-action="updMeetField" data-field="attendees" placeholder="Names, roles...">
      </div>
      <div class="meet-items">${m.items.map((item, i) => `<div class="meet-item ${item.done ? 'done' : ''}">
        <input type="checkbox" ${item.done ? 'checked' : ''} data-action="tglMeetItem" data-idx="${i}">
        <span class="meet-item-txt">${U.escapeHtml(item.text)}</span>
        <input type="text" value="${U.escapeHtml(item.note || '')}" data-action="updMeetItemNote" data-idx="${i}" placeholder="Note..." class="meet-item-note">
      </div>`).join('')}</div>
      <div class="meet-summary"><label class="cf-label">Closing Summary</label><textarea class="cf-ta" data-action="updMeetField" data-field="summary" placeholder="Summary of decisions, next steps...">${U.escapeHtml(m.summary || '')}</textarea></div>
      <div class="meet-pulse">
        <span class="meet-pulse-lbl">Team pulse (optional):</span>
        <button class="btn btn-s mp-btn mp-pos" data-action="meetSentiment" data-val="positive" title="Record a positive pulse for this meeting">Positive</button>
        <button class="btn btn-s mp-btn mp-neu" data-action="meetSentiment" data-val="neutral" title="Record a neutral pulse">Neutral</button>
        <button class="btn btn-s mp-btn mp-con" data-action="meetSentiment" data-val="concerned" title="Record a concerned pulse">Concerned</button>
      </div>
      <div class="g6">
        <button class="btn btn-g btn-s" data-action="endMeeting"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check-circle"></use></svg> End Meeting</button>
        <button class="btn btn-n btn-s" data-action="cancelActiveMeeting"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> Cancel</button>
      </div>
      <!-- Rank 1.5: meeting voice capture + transcription (rendered by mmgr-voice.js) -->
      <div id="meet-voice-wrap"></div>
    </div>`;
    if (ns.Voice && ns.Voice.renderCaptureSection) ns.Voice.renderCaptureSection();
  }

  function renderMeetingHistory() {
    const s = ns.State.getState();
    const body = U.$('meeting-history-body');
    if (!body) return;
    const meetings = s.meetings || [];
    if (!meetings.length) {
      body.innerHTML = '<div class="meet-empty">No completed meetings yet — start one above and it lands here as a permanent record.</div>';
      return;
    }
    body.innerHTML = meetings.map(m => {
      const covered = m.items.filter(i => i.done).length;
      return `<div class="meet-hist-row">
        <div><span class="meet-hist-name">${U.escapeHtml(m.title)}</span><span class="meet-hist-meta">${(m.endedAt || '').slice(0, 10)} · ${m.durationMin || '—'} min</span></div>
        <div class="meet-hist-actions">
          <span class="badge ${covered === m.items.length ? 'bg' : 'ba'} meet-hist-badge">${covered}/${m.items.length} covered</span>
          <button class="btn btn-n btn-s" data-action="copyMeetingMinutes" data-id="${m.id}" title="Copy a Word-ready minutes block to the clipboard"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-clipboard"></use></svg> Copy Minutes</button>
          <button class="btn btn-d btn-s" data-action="delMeeting" data-id="${m.id}" title="Delete this meeting record and its linked entries (undo offered)"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-trash"></use></svg> Delete</button>
        </div>
      </div>`;
    }).join('');
  }

  // ---- Delete + undo (T6, owner directive 2026-08-16) ---------------------
  // A concluded meeting is a permanent record today with NO way to remove it,
  // not even by mistake. delMeeting removes the meeting record plus every
  // linked artifact it created on end: the auto-logged Comms entry, the
  // Meeting-to-Action promises (st.meetingPromises[*] with sourceMeetingId),
  // and the Decision Log entries stamped with sourceMeetingId (transcript
  // extraction). A full snapshot is kept for a short UNDO window (~8s) so a
  // mistaken tap restores everything exactly — then the snapshot is dropped.
  let _delSnapshot = null;    // { at, meeting, comms, promises, logEntries, done }
  const DEL_UNDO_MS = 8000;
  function _dropDelSnapshot() { _delSnapshot = null; }

  function delMeeting(id) {
    const s = ns.State.getState();
    const idx = (s.meetings || []).findIndex(x => x.id === id);
    if (idx < 0) { if (ns.App && ns.App.showToast) ns.App.showToast('That meeting is no longer in this project.', 'warn'); return; }
    const meeting = s.meetings[idx];
    const doDelete = function() {
      // Snapshot BEFORE mutating so undo restores byte-identical records.
      const snap = { at: Date.now(), done: false, meeting: JSON.parse(JSON.stringify(meeting)), comms: [], promises: [], logEntries: [] };
      ns.State.updateState(function(st) {
        const keepPromises = {};
        Object.keys(st.meetingPromises || {}).forEach(function(k) {
          const kept = (st.meetingPromises[k] || []).filter(function(p) {
            const linked = p.sourceMeetingId === id;
            if (linked) snap.promises.push({ kind: k, p: JSON.parse(JSON.stringify(p)) });
            return !linked;
          });
          if (kept.length) keepPromises[k] = kept;
        });
        if (st.meetingPromises) st.meetingPromises = keepPromises;
        st.commsEntries = (st.commsEntries || []).filter(function(c) {
          const linked = c.sourceMeetingId === id;
          if (linked) snap.comms.push(JSON.parse(JSON.stringify(c)));
          return !linked;
        });
        st.logEntries = (st.logEntries || []).filter(function(e) {
          const linked = e.sourceMeetingId === id;
          if (linked) snap.logEntries.push(JSON.parse(JSON.stringify(e)));
          return !linked;
        });
        st.meetings = (st.meetings || []).filter(x => x.id !== id);
      });
      snap.done = true;
      _delSnapshot = snap;
      setTimeout(function() { if (_delSnapshot && _delSnapshot.at === snap.at) _dropDelSnapshot(); }, DEL_UNDO_MS);
      renderMeetings();
      renderPromises();
      if (R && R.renderLog) R.renderLog();
      if (R && R.renderComms) R.renderComms();
      if (ns.App && ns.App.showToast) {
        var n = function(v, s, p) { return v + ' ' + (v === 1 ? s : p); };
        ns.App.showToast('Meeting deleted. ' + n(snap.comms.length, 'Comms entry', 'Comms entries') + ', ' + n(snap.logEntries.length, 'decision', 'decisions') + ', ' + n(snap.promises.length, 'promise', 'promises') + ' removed.', 'warn', {
          label: 'Undo',
          onClick: function() { undoDelMeeting(snap.at); }
        });
      }
    };
    if (ns.App && ns.App.askConfirm) {
      ns.App.askConfirm({
        title: 'Delete meeting',
        message: 'Delete "' + meeting.title + '" and its linked Comms, decisions and meeting-to-action entries? You can undo right after.',
        danger: true,
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        onOk: doDelete
      });
    } else {
      doDelete();
    }
  }

  function undoDelMeeting(at) {
    const snap = _delSnapshot;
    if (!snap || (at != null && snap.at !== at) || !snap.done || Date.now() - snap.at > DEL_UNDO_MS) {
      if (ns.App && ns.App.showToast) ns.App.showToast('The undo window for that meeting has passed.', 'warn');
      return;
    }
    ns.State.updateState(function(st) {
      if (!st.meetings) st.meetings = [];
      st.meetings.unshift(JSON.parse(JSON.stringify(snap.meeting)));
      if (!st.commsEntries) st.commsEntries = [];
      snap.comms.forEach(function(c) { st.commsEntries.push(JSON.parse(JSON.stringify(c))); });
      if (!st.meetingPromises) st.meetingPromises = {};
      snap.promises.forEach(function(e) {
        if (!st.meetingPromises[e.kind]) st.meetingPromises[e.kind] = [];
        st.meetingPromises[e.kind].push(JSON.parse(JSON.stringify(e.p)));
      });
      if (!st.logEntries) st.logEntries = [];
      snap.logEntries.forEach(function(e) { st.logEntries.push(JSON.parse(JSON.stringify(e))); });
    });
    snap.done = true; // mark restored so the timeout can't double-handle
    _dropDelSnapshot();
    renderMeetings();
    renderPromises();
    if (R && R.renderLog) R.renderLog();
    if (R && R.renderComms) R.renderComms();
    if (ns.App && ns.App.showToast) ns.App.showToast('Meeting restored.', 'ok');
  }

  // ---- API ----
  ns.Meetings = {
    MEET_TEMPLATES: MEET_TEMPLATES,
    MEET_KICKOFF_ITEMS: MEET_KICKOFF_ITEMS,
    MEET_RECURRING: MEET_RECURRING,
    MEET_SPECIALIZED: MEET_SPECIALIZED,
    MEET_AGILE: MEET_AGILE,
    renderMeetings: renderMeetings,
    copyMeetingTemplate: copyMeetingTemplate,
    openMeetPrompt: openMeetPrompt,
    startMeeting: startMeeting,
    tglMeetItem: tglMeetItem,
    updMeetItemNote: updMeetItemNote,
    updMeetField: updMeetField,
    endMeeting: endMeeting,
    cancelActiveMeeting: cancelActiveMeeting,
    copyMeetingMinutes: copyMeetingMinutes,
    renderActiveMeeting: renderActiveMeeting,
    renderMeetingHistory: renderMeetingHistory,
    // T6 (2026-08-16): delete a concluded meeting + its linked entries with
    // an undo window (delMeeting / undoDelMeeting).
    delMeeting: delMeeting,
    undoDelMeeting: undoDelMeeting,
    tglPromise: tglPromise,
    renderPromises: renderPromises,
    recordSentiment: recordSentiment,
    renderSentimentHistory: renderSentimentHistory,
    SENTIMENT_LABELS: SENTIMENT_LABELS,
    startElapsedTimer: startElapsedTimer,
    stopElapsedTimer: stopElapsedTimer
  };

})(MMGR);
window.MMGR = MMGR;
