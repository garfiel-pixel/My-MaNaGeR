/* ============================================================
   My MaNaGeR , Daily Field Report Module
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;
  const S = () => ns.State ? ns.State.getState() : null;

  // ---- Snapshot Compare ----
  function takeSnapshot() {
    const s = S();
    if (!s) return null;
    const tasks = s.tasks || [];
    return {
      timestamp: new Date().toISOString(),
      date: U.todayStr(),
      tasks: tasks.map(t => ({
        id: t.id,
        name: t.name,
        status: t.status || 'todo',
        completed: t.status === 'completed'
      })),
      totalTasks: tasks.length,
      completedTasks: tasks.filter(t => t.status === 'completed').length,
      blockedTasks: tasks.filter(t => t.status === 'blocked').length,
      risks: (s.risks || []).length,
      issues: (s.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed').length,
      budgetEnvelope: s.budgetEnvelope || 0,
      budgetActual: (s.budgetLines || []).reduce((sum, l) => sum + (+l.actual || 0), 0)
    };
  }

  function saveSnapshot() {
    const s = S();
    if (!s) return;
    if (!s.dailySnapshots) s.dailySnapshots = [];
    const snap = takeSnapshot();
    if (snap) {
      s.dailySnapshots.push(snap);
      // Keep last 30 days
      if (s.dailySnapshots.length > 30) {
        s.dailySnapshots = s.dailySnapshots.slice(-30);
      }
      ns.State.save(true);
    }
    return snap;
  }

  function getSnapshots() {
    const s = S();
    return (s && s.dailySnapshots) || [];
  }

  function getLatestSnapshot() {
    const snaps = getSnapshots();
    return snaps.length > 0 ? snaps[snaps.length - 1] : null;
  }

  // ---- Daily Field snapshot (monolith snapshotDaily port) ----
  // Stores a { date, taskStates } record on state. The Daily Field prompt
  // diffs the CURRENT statuses against taskStates to report exactly what
  // completed since the snapshot was taken.
  function snapshotDaily() {
    const s = S();
    if (!s) return null;
    const states = {};
    (s.tasks || []).forEach(t => { states[t.id] = t.status || 'todo'; });
    s.dailySnapshot = { date: U.todayStr(), taskStates: states };
    ns.State.save(true);
    if (ns.App && ns.App.showToast) {
      ns.App.showToast('Daily snapshot saved , diff will show tomorrow.', 'ok');
    }
    return s.dailySnapshot;
  }

  // Reads the last snapshot back (null-safe for the prompt renderer).
  function getDailySnapshot() {
    const s = S();
    return (s && s.dailySnapshot) || null;
  }

  function diffSnapshots(snapA, snapB) {
    if (!snapA || !snapB) return null;
    const diff = {
      tasksCompleted: snapB.completedTasks - snapA.completedTasks,
      tasksBlocked: snapB.blockedTasks - snapA.blockedTasks,
      newRisks: snapB.risks - snapA.risks,
      newIssues: snapB.issues - snapA.issues,
      budgetChange: snapB.budgetActual - snapA.budgetActual,
      daysBetween: U.daysBetween(snapA.date, snapB.date)
    };
    return diff;
  }

  function generateFieldReportPrompt() {
    const s = S();
    if (!s) return '';
    const latest = getLatestSnapshot();
    const yesterday = getSnapshots().length > 1 ? getSnapshots()[getSnapshots().length - 2] : null;
    let diffText = '';
    if (latest && yesterday) {
      const d = diffSnapshots(yesterday, latest);
      if (d) {
        diffText = `\n=== SINCE LAST REPORT ===\nCompleted: ${d.tasksCompleted} tasks | Blocked: ${d.tasksBlocked} | New risks: ${d.newRisks} | New issues: ${d.newIssues} | Budget spent: $${d.budgetChange.toLocaleString()} | Days: ${d.daysBetween}`;
      }
    }
    const todayTasks = (s.tasks || []).filter(t => {
      if (t.status === 'completed') return false;
      const today = U.todayStr();
      return t.startDate <= today && t.endDate >= today;
    });
    return `DAILY FIELD REPORT , ${U.todayStr()}

=== PROJECT STATUS ===
Completion: ${s.tasks ? Math.round((s.tasks.filter(t => t.status === 'completed').length / s.tasks.length) * 100) : 0}%
Active issues: ${(s.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed').length}
Blocked tasks: ${(s.tasks || []).filter(t => t.status === 'blocked').length}${diffText}

=== TODAY'S TASKS ===
${todayTasks.map(t => `- ${t.name} | ${t.status} | ${t.assignee || 'unassigned'}${t.weatherExposed ? ' [WEATHER-EXPOSED]' : ''}`).join('\n') || '(None active today)'}

=== SITE CONDITIONS ===
Weather: (enter today's conditions)
Temperature: (enter)
Crew count: (enter)
Safety observations: (enter)
Materials received: (enter)

=== ISSUES ENCOUNTERED ===
${(s.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed').map(i => `- ${i.description} | Owner: ${i.owner || 'unassigned'}`).join('\n') || '(None)'}

=== PLAN FOR NEXT PERIOD ===
(enter planned work)

=== INSTRUCTIONS ===
Generate a structured field report suitable for email or print. Include a header with project name, date, and report number. Use clear sections.`;
  }

  // ---- Task 5 (2026-09-19): voice capture destination + quick action ----
  // The report text itself lives in the prompt modal (the daily prompt is
  // the report), so a field voice capture appends into state.fieldNotes for
  // the day and the prompt renderer includes it - plain text, hand-editable,
  // exactly the module's own convention.
  function insertTranscript(text) {
    if (!text) return;
    const s = S();
    if (!s) return;
    const today = U.todayStr();
    if (!Array.isArray(s.fieldReportNotes)) s.fieldReportNotes = [];
    let entry = s.fieldReportNotes.find(n => n.date === today);
    if (!entry) { entry = { date: today, text: '' }; s.fieldReportNotes.push(entry); }
    entry.text = (entry.text ? entry.text + '\n\n' : '') + '[Voice capture ' + new Date().toLocaleTimeString() + ']\n' + text;
    if (s.fieldReportNotes.length > 60) s.fieldReportNotes = s.fieldReportNotes.slice(-60);
    ns.State.save(true);
    if (ns.App && ns.App.showToast) ns.App.showToast('Transcript captured - it lands in the Daily Field Report prompt. Review before you trust it.', 'ok');
  }

  function getFieldNotes(date) {
    const s = S();
    if (!s || !Array.isArray(s.fieldReportNotes)) return '';
    const entry = s.fieldReportNotes.find(n => n.date === (date || U.todayStr()));
    return entry ? entry.text : '';
  }

  // Quick action item: the owner's "someone on site spots work that needs
  // doing" path. Lands in the Closure comms list (where the Decision Engine
  // already counts open actions) pre-filled with the report reference.
  function addFieldAction() {
    const s = S();
    if (!s) return;
    const ref = 'Field report ' + U.todayStr();
    ns.State.updateState(function(st) {
      if (!st.closure) st.closure = { items: [], well: '', imp: '', rec: '' };
      if (!st.closure.items) st.closure.items = [];
      st.closure.items.push({ text: '[' + ref + '] ', done: false });
    });
    if (ns.Render && ns.Render.renderClosure) ns.Render.renderClosure();
    if (ns.App && ns.App.showToast) ns.App.showToast('Action item added in Closure - it counts in the Decision Engine until done.', 'ok');
  }

  // ---- API ----
  ns.FieldReport = {
    takeSnapshot: takeSnapshot,
    saveSnapshot: saveSnapshot,
    getSnapshots: getSnapshots,
    getLatestSnapshot: getLatestSnapshot,
    diffSnapshots: diffSnapshots,
    generateFieldReportPrompt: generateFieldReportPrompt,
    snapshotDaily: snapshotDaily,
    getDailySnapshot: getDailySnapshot,
    insertTranscript: insertTranscript,
    getFieldNotes: getFieldNotes,
    addFieldAction: addFieldAction
  };
})(MMGR);
window.MMGR = MMGR;