/* ============================================================
   My MaNaGeR , AI Prompt Generation Module
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const S = () => ns.State ? ns.State.getState() : null;
  const U = ns.Utils;

  function buildTaskList() {
    const s = S();
    if (!s || !s.tasks) return '(No tasks)';
    return s.tasks.map(t => {
      const flags = [
        t.critical ? '[CRITICAL PATH]' : '',
        t.leadTime ? '[LEAD-TIME]' : '',
        t.recurring ? '[RECURRING]' : '',
        t.weatherExposed ? '[WEATHER-EXPOSED]' : '',
        t.status === 'blocked' ? '[BLOCKED]' : '',
        U.isOverdue(t.endDate) && t.status !== 'completed' ? '[OVERDUE]' : ''
      ].filter(Boolean).join(' ');
      return `- ${t.name} (ID:${t.id}) ${flags} | ${t.status || 'todo'} | ${t.startDate || '?'} → ${t.endDate || '?'} | ${t.duration || '?'}d | ${t.assignee || 'unassigned'}`;
    }).join('\n');
  }

  function buildRiskList() {
    const s = S();
    if (!s || !s.risks) return '(No risks)';
    return s.risks.map(r => `- ${r.description} | P:${r.probability} I:${r.impact} | ${r.mitigation || 'No mitigation'}`).join('\n');
  }

  function buildIssueList() {
    const s = S();
    if (!s || !s.issues) return '(No issues)';
    return s.issues.map(i => `- ${i.description} | Owner:${i.owner || 'unassigned'} | Target:${i.targetDate || '?'} | Status:${i.status}`).join('\n');
  }

  function buildCharterSummary() {
    const s = S();
    if (!s || !s.charter) return '(No charter)';
    const c = s.charter;
    return [
      `Project: ${c.name || 'Unnamed'}`,
      `Sponsor: ${c.sponsor || '-'}`,
      `Objective: ${c.objective || '-'}`,
      `Target: ${c.targetStart || '?'} → ${c.targetCompletion || '?'}`,
      `Budget: $${(c.budgetEnvelope || 0).toLocaleString()}`,
      `KPIs: ${(c.kpis || []).map(k => `${k.name}: ${k.target}`).join(', ') || 'None'}`
    ].join('\n');
  }

  function buildBudgetSummary() {
    const s = S();
    if (!s) return '(No budget)';
    const lines = s.budgetLines || [];
    const envelope = s.budgetEnvelope || 0;
    const planned = lines.reduce((sum, l) => sum + (+l.planned || 0), 0);
    const actual = lines.reduce((sum, l) => sum + (+l.actual || 0), 0);
    return `Envelope: $${envelope.toLocaleString()}\nPlanned: $${planned.toLocaleString()}\nActual: $${actual.toLocaleString()}\nRemaining: $${(envelope - actual).toLocaleString()}`;
  }

  function buildResourceSummary() {
    const s = S();
    if (!s || !s.resources) return '(No resources)';
    return s.resources.map(r => `- ${r.name} (${r.type}) | ${r.role || '-'} | ${r.availability || 100}% avail | $${r.rate || 0}/hr | ${r.hoursAllocated || 0}h allocated | ${r.utilization || 0}% util`).join('\n');
  }

  function buildRaciSummary() {
    const s = S();
    if (!s || !s.raci) return '(No RACI)';
    const raci = s.raci;
    if (!raci.tasks || !raci.persons || !raci.matrix) return '(No RACI data)';
    const lines = [];
    for (const t of raci.tasks) {
      const assignments = [];
      for (const p of raci.persons) {
        const key = `${t.id || t.name || t}_${p.id || p.name || p}`;
        const val = raci.matrix[key];
        if (val) assignments.push(`${p.name || p}:${val}`);
      }
      if (assignments.length) lines.push(`- ${t.name || t}: ${assignments.join(', ')}`);
    }
    return lines.join('\n') || '(No RACI assignments)';
  }

  function buildChangeSummary() {
    const s = S();
    if (!s || !s.changes) return '(No changes)';
    const pending = s.changes.filter(c => c.status === 'submitted' || c.status === 'review');
    if (!pending.length) return '(No pending changes)';
    return pending.map(c => `- ${c.title} | ${c.requester || '?'} | Sched:${c.schedImpact || '?'} | Cost:${c.costImpact || '?'}`).join('\n');
  }

  function buildLogSummary() {
    const s = S();
    if (!s || !s.logEntries) return '(No log entries)';
    const recent = s.logEntries.slice(-5);
    return recent.map(e => `- ${e.date || e.timestamp || '?'}: ${e.decision || e.text || '?'} (${e.by || e.person || '?'})`).join('\n');
  }

  function buildContext() {
    const s = S();
    if (!s) return '';
    const tasks = s.tasks || [];
    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'completed').length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const overdue = tasks.filter(t => U.isOverdue(t.endDate) && t.status !== 'completed').length;
    const blocked = tasks.filter(t => t.status === 'blocked').length;
    const critical = tasks.filter(t => t.critical).length;
    return [
      `Project: ${s.charter && s.charter.name ? s.charter.name : 'Unnamed'}`,
      `Methodology: ${s.methodology || 'waterfall'}`,
      `Overall completion: ${pct}% (${done}/${total} tasks)`,
      `Overdue: ${overdue} | Blocked: ${blocked} | Critical path tasks: ${critical}`,
      `Budget envelope: $${(s.budgetEnvelope || 0).toLocaleString()}`,
      `Active issues: ${(s.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed').length}`,
      `Pending changes: ${(s.changes || []).filter(c => c.status === 'submitted' || c.status === 'review').length}`
    ].join('\n');
  }

  // ---- Prompt Templates ----
  const prompts = {
    report: function() {
      return `PROJECT STATUS REPORT , GENERATED FROM My MaNaGeR DATA

=== PROJECT CONTEXT ===
${buildContext()}

=== CHARTER ===
${buildCharterSummary()}

=== TASK BREAKDOWN ===
${buildTaskList()}

=== RISKS ===
${buildRiskList()}

=== ISSUES ===
${buildIssueList()}

=== BUDGET ===
${buildBudgetSummary()}

=== RESOURCES ===
${buildResourceSummary()}

=== RACI ===
${buildRaciSummary()}

=== DECISION LOG (recent) ===
${buildLogSummary()}

=== INSTRUCTIONS ===
Generate a formal, print-ready project status report with:
1. Executive Summary
2. Schedule Overview (% complete, critical path status, variance)
3. Budget Performance (planned vs actual, variance analysis)
4. Risk & Issue Register (ranked by severity)
5. Resource Utilization
6. Next Period Priorities (next 7 days)
7. Decisions Required from Sponsor
8. Sign-off section

Format as a professional document with sections, tables, and a header.`;
    },

    forecast: function() {
      return `PROJECT FORECAST , GENERATED FROM My MaNaGeR DATA

${buildContext()}

=== TASK LIST ===
${buildTaskList()}

=== RISKS ===
${buildRiskList()}

=== BUDGET ===
${buildBudgetSummary()}

=== INSTRUCTIONS ===
Based on the above project data, provide:
1. Projected completion date (based on current progress rate)
2. Projected final cost (based on burn rate)
3. Confidence rating (Low/Medium/High) for both date and cost
4. Key assumptions behind your forecast
5. Top 3 things that could improve the forecast
6. A plain-English summary for the sponsor`;
    },

    risk: function() {
      return `RISK ANALYSIS , GENERATED FROM My MaNaGeR DATA

${buildContext()}

=== RISK REGISTER ===
${buildRiskList()}

=== ISSUES ===
${buildIssueList()}

=== TASK LIST (focus on critical path) ===
${buildTaskList()}

=== INSTRUCTIONS ===
Analyze the risks and provide:
1. Prioritized risk assessment (rank by probability × impact)
2. For each top risk: specific mitigation actions with owner and timeline
3. Risk correlation analysis , which risks compound each other?
4. Risk response strategy recommendation (Avoid/Transfer/Mitigate/Accept) for each
5. Top 3 risks requiring immediate attention
6. Escalation criteria , when does each risk become an issue?`;
    },

    digest: function() {
      return `WEEKLY DIGEST , GENERATED FROM My MaNaGeR DATA

${buildContext()}

=== TASK LIST ===
${buildTaskList()}

=== RISKS ===
${buildRiskList()}

=== ISSUES ===
${buildIssueList()}

=== CHANGES ===
${buildChangeSummary()}

=== INSTRUCTIONS ===
Generate a clean weekly briefing covering:
1. What was completed this week
2. What's planned for next week (next 7 days)
3. Overdue items requiring attention
4. Blocked items and what's needed to unblock them
5. New or escalated risks
6. Resource capacity concerns
7. Open decisions required from the team
8. A one-paragraph summary suitable for a stand-up`;
    },

    health: function() {
      return `PROJECT HEALTH SUMMARY , GENERATED FROM My MaNaGeR DATA

${buildContext()}

=== TASK LIST ===
${buildTaskList()}

=== RISKS ===
${buildRiskList()}

=== ISSUES ===
${buildIssueList()}

=== BUDGET ===
${buildBudgetSummary()}

=== INSTRUCTIONS ===
Provide an executive-level project health summary:
1. Overall health rating (Green/Amber/Red) with justification
2. Key metrics: schedule, budget, quality, safety, resources
3. Top 3 blockers
4. Top 3 risks
5. Decisions needed from leadership
6. A single plain-English status paragraph for the sponsor`;
    },

    audit: function() {
      const s = S();
      const tasks = (s && s.tasks) || [];
      const issues = [];
      // Check for date logic issues
      for (const t of tasks) {
        if (t.startDate && t.endDate && t.startDate > t.endDate) {
          issues.push(`Task ${t.id} (${t.name}): end date ${t.endDate} is before start date ${t.startDate}`);
        }
        // Check parent/child containment
        if (t.parentId) {
          const parent = tasks.find(p => p.id === t.parentId);
          if (parent && parent.startDate && t.startDate && parent.startDate > t.startDate) {
            issues.push(`Task ${t.id} (${t.name}): starts before parent ${parent.id} (${parent.name})`);
          }
          if (parent && parent.endDate && t.endDate && t.endDate > parent.endDate) {
            issues.push(`Task ${t.id} (${t.name}): ends after parent ${parent.id} (${parent.name})`);
          }
        }
        // Check predecessor chronology
        if (t.predecessors) {
          for (const predId of t.predecessors) {
            const pred = tasks.find(p => p.id === predId);
            if (pred && pred.endDate && t.startDate && pred.endDate > t.startDate) {
              issues.push(`Task ${t.id} (${t.name}): starts before predecessor ${pred.id} (${pred.name}) finishes`);
            }
          }
        }
      }
      const auditBlock = issues.length ? issues.map(i => `- ${i}`).join('\n') : '(No date logic issues found)';
      return `SCHEDULE LOGIC AUDIT , GENERATED FROM My MaNaGeR DATA

${buildContext()}

=== AUDIT RESULTS ===
${auditBlock}

=== TASK LIST ===
${buildTaskList()}

=== INSTRUCTIONS ===
Review the schedule audit results above and the full task list. For each issue found:
1. Describe the impact in plain English
2. Suggest a specific fix per task
3. Flag any cascade effects on related tasks
4. Recommend a corrected sequence

If no issues were found, confirm the schedule logic is sound and note any areas where float is tight.

## WEATHER EXPOSURE
${(() => {
  const st = S();
  const w = (st && st.wxWindow) || {};
  const wxTasks = ((st && st.tasks) || []).filter(t => t.weatherExposed && t.startDate && t.endDate);
  let wxDur = 0;
  const winSt = U.parseDL(w.start), winEn = U.parseDL(w.end);
  wxTasks.forEach(t => {
    const ts = U.parseDL(t.startDate), te = U.parseDL(t.endDate);
    if (!ts || !te || !winSt || !winEn) return;
    const ovStart = new Date(Math.max(ts, winSt));
    const ovEnd = new Date(Math.min(te, winEn));
    if (ovStart <= ovEnd) wxDur += Math.round((ovEnd - ovStart) / 86400000) + 1;
  });
  return `Hurricane window: ${w.start || 'not set'} → ${w.end || 'not set'} | Charter buffer: ${w.bufferDays || 0} days | Weather-exposed duration in window: ${wxDur} days.\n**If weather-exposed duration exceeds the stated Charter buffer, flag it in your output as a schedule risk.**`;
})()}`;
    },

    visual: function() {
      return `VISUAL OUTPUT , GENERATED FROM My MaNaGeR DATA

${buildContext()}

=== TASK LIST ===
${buildTaskList()}

=== RISKS ===
${buildRiskList()}

=== BUDGET ===
${buildBudgetSummary()}

${buildRaciSummary() !== '(No RACI data)' ? `\n=== RACI ===\n${buildRaciSummary()}` : ''}

=== INSTRUCTIONS ===
Generate a self-contained HTML page with:
1. A progress dashboard card (completion %, ring chart)
2. A bar chart showing planned vs actual budget by category
3. A risk heat map (probability × impact matrix)
4. A simple Gantt-style timeline (text-based, using █ characters)
5. A RACI accountability grid (if RACI data exists)
6. Key metrics in a summary row

Make it readable with a clean, high-contrast theme, and use inline CSS.`;
    },

    change: function() {
      return `CHANGE IMPACT ASSESSMENT , GENERATED FROM My MaNaGeR DATA

${buildContext()}

=== PENDING CHANGES ===
${buildChangeSummary()}

=== TASK LIST (with critical path) ===
${buildTaskList()}

=== RISKS ===
${buildRiskList()}

=== BUDGET ===
${buildBudgetSummary()}

=== RESOURCES ===
${buildResourceSummary()}

=== INSTRUCTIONS ===
For each pending change request, provide:
1. Schedule impact assessment (which tasks, critical path affected?)
2. Cost impact estimate
3. Resource impact (new or reallocated resources needed?)
4. Risk impact (new risks introduced?)
5. Recommendation: Approve / Approve with conditions / Reject
6. Justification for recommendation
7. Alternative if rejected`;
    },

    client: function() {
      return `CLIENT-FACING STATUS UPDATE , GENERATED FROM My MaNaGeR DATA

${buildContext()}

=== TASK LIST ===
${buildTaskList()}

=== ISSUES ===
${buildIssueList()}

=== INSTRUCTIONS ===
Generate a client-facing status update in plain language (no PM jargon):
1. What we've accomplished (since last update)
2. What we're working on now
3. What's coming next
4. Any decisions needed from the client
5. Overall status: On track / Minor concerns / Needs attention
6. Keep it professional but accessible , this is for the paying client`;
    },

    email: function() {
      // BACKLOG B-N (2026-08-12): richer stakeholder-email draft through the
      // AI window , an upgrade layered ON TOP of the static App.emailTpl
      // templates, never a replacement. The local tier returns the static
      // template verbatim; the Cloud tier drafts a polished version.
      const s = S();
      const f = (s && s.charter) || {};
      const pn = f.name || '[Project Name]';
      const sp = f.sponsor || '[Sponsor]';
      const tasks = (s && s.tasks) || [];
      const dn = tasks.filter(t => t.status === 'completed').length;
      const pct = tasks.length ? Math.round(dn / tasks.length * 100) : 0;
      const ip = tasks.filter(t => t.status === 'inprogress').length;
      const bl = tasks.filter(t => t.status === 'blocked').length;
      const od = tasks.filter(t => t.endDate && new Date(t.endDate) < new Date() && t.status !== 'completed').length;
      const issues = ((s && s.issues) || []).filter(i => i.status !== 'resolved' && i.status !== 'closed');
      const high = ((s && s.risks) || []).filter(r => !r.issueId && (/high/i.test(r.probability || '') || /high/i.test(r.impact || '')));
      const next = tasks.filter(t => t.status !== 'completed').slice(0, 3).map(t => '- ' + (t.name || t.id));
      const planned = ((s && s.budgetLines) || []).reduce((n, l) => n + (+l.planned || 0), 0);
      const actual = ((s && s.budgetLines) || []).reduce((n, l) => n + (+l.actual || 0), 0);
      return ['# DRAFT A POLISHED STAKEHOLDER EMAIL', '',
        'You are a construction project manager writing a professional stakeholder email for ' + pn + '. Use ONLY the facts below , never invent dates, amounts, task names, or people.',
        '',
        'Project: ' + pn,
        'Sponsor: ' + sp,
        'Progress: ' + pct + '% complete (' + dn + '/' + tasks.length + ' tasks) | In progress: ' + ip + ' | Blocked: ' + bl + ' | Overdue: ' + od,
        'Budget: $' + Math.round(actual || 0).toLocaleString() + ' actual / $' + Math.round(planned || 0).toLocaleString() + ' planned',
        'Open issues: ' + (issues.length ? issues.map(i => '- ' + (i.description || '(untitled)') + (i.owner ? ' (' + i.owner + ')' : '')).join('\n') : '(none)'),
        'High risks: ' + (high.length ? high.map(r => '- ' + (r.description || '(untitled)')).join('\n') : '(none)'),
        'Next priorities: ' + (next.length ? next.join('\n') : '(none)'),
        '',
        '=== INSTRUCTIONS ===',
        'Write ONE complete, send-ready email:',
        '1. A clear subject line naming the project and the update period',
        '2. A short greeting to ' + sp,
        '3. Status highlights in plain, confident language (no PM jargon)',
        '4. Anything needing attention (blocked work, open issues, high risks, budget overrun) , only what the data shows',
        '5. The specific asks / decisions needed from the sponsor',
        '6. Next steps for the coming period',
        '7. A professional closing with a sign-off name placeholder ([PM])',
        'If the project has no data yet, say so honestly and draft a short introductory note instead , never fabricate progress.'].join('\n');
    },

    charterdates: function() {
      // Exact port of the monolith promptCharterDates() , this deliberately
      // runs BEFORE WBS dating: commit to a realistic Target Start/Completion
      // (informed by weather season + work week + management reserve), THEN
      // generate the WBS to fit inside that committed window.
      const s = S();
      const f = (s && s.charter) || {};
      const scope = [f.objective, f.scope, f.deliverables].filter(Boolean).join(' | ') || '(no scope description entered yet in Charter , reason from the project name alone, and say so)';
      const w = (s && s.wxWindow) || {};
      const ww = (s && s.workWeek) || 5;
      const fmt$ = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(+n || 0)).toLocaleString();
      return ['# ESTABLISH CHARTER TARGET DATES',
        '',
        'You are a senior construction scheduler helping set the FIRST real commitment on this project , the Target Start Date and Target Completion Date that will go in the Project Charter. This happens BEFORE the detailed task-by-task schedule exists. Your job is to propose one realistic pair of dates, with your reasoning shown plainly, not to build a task list.',
        '',
        `Project name: ${f.name || '(unnamed)'}`,
        `Sponsor: ${f.sponsor || '(not set)'}`,
        `Scope described so far: ${scope}`,
        `Approved budget envelope: ${s && s.budgetEnvelope ? fmt$(s.budgetEnvelope) : '(not set)'}`,
        `Work week: ${ww} day(s)/week`,
        (w.start && w.end) ? `A Weather/hurricane-season window is already set: ${w.start} to ${w.end}, Charter buffer ${w.bufferDays || 0} days , use this as given.` : 'No weather/hurricane-season window has been set yet , propose one based on the project\'s general region and construction type if you can infer it, or state plainly that you need the location to do this properly.',
        '',
        '## IF YOU HAVE WEB/LIVE SEARCH ACCESS',
        'Search for the current hurricane/wet-season outlook and typical historical storm-day frequency for the relevant region, and today\'s actual date, before proposing dates. Cite what you found. If you do NOT have live search access, say so explicitly at the top of your answer rather than silently reasoning from older training knowledge as if it were current.',
        '',
        '## WHAT TO PROPOSE',
        '1. A realistic TOTAL PROJECT DURATION for a project of this described scope and budget, reasoned from construction-industry benchmarks , show your reasoning, not just a number.',
        '2. A WEATHER CONTINGENCY, stated as its own separate number of days (not silently folded into the base duration) , how much of that duration is genuinely at risk from the season, and how many days of cushion that risk realistically warrants.',
        '3. A MANAGEMENT RESERVE, also stated as its own separate number of days , general schedule risk buffer beyond weather specifically (permitting delays, minor rework, etc.). A common planning-level guideline is 5-10% of total duration; use your judgment and say why.',
        '4. A proposed TARGET START DATE and TARGET COMPLETION DATE, in YYYY-MM-DD format, ready to paste directly into the Charter\'s Start/End fields.',
        '5. Break down the finish date as: base duration + weather contingency + management reserve = total, so the reasoning is auditable, not a black box.',
        '',
        '## OUTPUT FORMAT',
        '```',
        'Target Start Date: YYYY-MM-DD',
        'Target Completion Date: YYYY-MM-DD',
        '',
        'Breakdown: <base duration>d base + <N>d weather contingency + <N>d management reserve = <total>d',
        '',
        'Reasoning: <2-4 sentences on the base duration estimate>',
        'Weather: <2-3 sentences on the season risk and why this contingency amount>',
        'Reserve: <1-2 sentences on why this reserve amount>',
        '```',
        '',
        'Once you accept these dates and lock them into the Charter, the next step is generating the detailed WBS schedule to fit inside this committed window , that\'s a separate prompt (Generate Dates for WBS Outline), which already reads these Charter dates back out automatically.'
      ].filter(x => x !== '').join('\n');
    },

    gendates: function() {
      // Exact port of the monolith promptGenerateDates() , returns the SAME
      // WBS outline with [YYYY-MM-DD → YYYY-MM-DD] and [conf:high|low]
      // appended to every line, weather-aware and envelope-checked against
      // the committed Charter Target Completion Date.
      const s = S();
      const f = (s && s.charter) || {};
      const wx = (s && s.wxWindow) || {};
      const ww = (s && s.workWeek) || 5;
      const wxTasks = ((s && s.tasks) || []).filter(t => t.weatherExposed).map(t => t.name);
      const outline = ((s && s.tasks) || []).map(t => {
        const ind = '  '.repeat(t.indent !== undefined ? t.indent : (t.level || 0));
        const wxTag = t.weatherExposed ? ' [weather-exposed]' : '';
        return `${ind}${t.name}${wxTag}`;
      }).join('\n') || '(no tasks yet , add tasks in the WBS first)';
      return ['# GENERATE DATES FOR WBS OUTLINE',
        '',
        'You are a senior construction scheduler. Your job: take the WBS outline below and return the SAME outline, unchanged in structure, with realistic date ranges and confidence tags appended to every line.',
        '',
        `Project start date: ${f.targetStart || f.start || '(not set in charter , assume today)'}`,
        `Project target completion: ${f.targetCompletion || f.end || '(not set)'}`,
        `Project name: ${f.name || '(unnamed)'}`,
        `Work week: ${ww} day(s)/week , count durations in these working days, not plain calendar days.`,
        (wx.start && wx.end) ? `Hurricane/wet-season window: ${wx.start} to ${wx.end}${wx.bufferDays ? ' (Charter buffer: ' + wx.bufferDays + ' days)' : ''} , tasks marked [weather-exposed] below that fall inside this window should get extra duration padding to absorb likely weather delays; say so in your assumptions note.` : 'No hurricane/wet-season window has been set yet in this project , if any [weather-exposed] tasks below fall in a rainy season based on general regional knowledge, flag that as a risk in your assumptions note.',
        wxTasks.length ? `Tasks tagged [weather-exposed] (${wxTasks.length}): ${wxTasks.join(', ')}` : '',
        '',
        '## RULES',
        '1. Assign realistic per-task DURATIONS using standard construction industry benchmarks, IN WORKING DAYS per the work week stated above. Reason per task , do NOT use a flat default.',
        '2. Sequence dates respecting parent/child nesting and trade logic. Envelope subtasks cannot start before Frame\'s engineer sign-off, etc. , unless the outline explicitly shows overlap.',
        '3. Append [YYYY-MM-DD → YYYY-MM-DD] to EVERY line (main tasks AND subtasks). Use the → arrow. Zero reformatting must be needed by the user to paste this back into WBS Text Import.',
        '4. Append a confidence tag AFTER the date: [conf:high] for well-established construction processes with low variance (e.g. "pour foundation concrete"), [conf:low] for tasks that depend on external parties or high-variance work (e.g. "confirm anchor tenant lease terms").',
        '5. For any line marked [weather-exposed] that falls inside the hurricane/wet-season window given above, pad its duration to account for likely weather delays, and drop it to [conf:low] even if it would otherwise be high-confidence , weather risk overrides normal confidence.',
        '6. DO NOT invent tasks not in the input. DO NOT drop any tasks. The output must be a 1:1 match to the input outline , dates and confidence tags added only, preserving the exact indentation. Do not carry the "[weather-exposed]" marker itself into your output , that\'s input context only, not part of the outline format.',
        '7. At the top of your response, include a short plain-English NOTE (3-6 lines) listing sequencing assumptions you made and which weather-exposed tasks got padding and why, so the user can sanity-check before pasting back.',
        (f.targetCompletion || f.end) ? `8. This project already has a committed Target Completion Date (${f.targetCompletion || f.end}) locked in the Charter. After dating every task, check whether your generated schedule's actual finish date fits inside that commitment. State clearly in your NOTE whether it fits, and if it runs over, say by how many days and which phase is driving the overrun , don't silently let it slip past without flagging it.` : '',
        '',
        '## EXPECTED OUTPUT FORMAT',
        '```',
        'NOTE: <assumptions here>',
        '',
        'Preconstruction & Mobilization [2026-01-05 → 2026-02-28] [conf:high]',
        '  Site survey [2026-01-05 → 2026-01-12] [conf:high]',
        '  Confirm anchor tenant lease terms [2026-01-08 → 2026-02-15] [conf:low]',
        '```',
        '',
        '## INPUT , CURRENT WBS OUTLINE',
        '```',
        outline,
        '```',
        '',
        '## AUDIT-CORRECT-REIMPORT LOOP (optional second-pass input)',
        'If the user is running the Audit-Correct-Reimport Loop, they will paste the Schedule Logic Audit findings below this line. Read those findings and fix the specific sequencing/date issues they raise in your regenerated output.',
        '',
        '<PASTE SCHEDULE AUDIT FINDINGS HERE IF REGENERATING>',
        ''
      ].filter(x => x !== '').join('\n');
    },

    daily: function() {
      // Exact port of the monolith promptDailyField() , a same-day field
      // digest that diffs against the last Daily Snapshot (Snapshot Now) so
      // "completed today" is real, not a current-state dump.
      const s = S();
      const f = (s && s.charter) || {};
      const tasks = (s && s.tasks) || [];
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const prevSnap = (s && s.dailySnapshot) || null;
      let completedToday = [];
      if (prevSnap && prevSnap.taskStates) {
        tasks.forEach(t => {
          const prev = prevSnap.taskStates[t.id];
          if (prev && prev !== 'completed' && t.status === 'completed') completedToday.push(t);
        });
      }
      const blocked = tasks.filter(t => t.status === 'blocked');
      const inprog = tasks.filter(t => t.status === 'inprogress');
      const leadtimeNear = tasks.filter(t => {
        if (!t.leadTime || !t.expectedDate) return false;
        const days = Math.round((U.parseDL(t.expectedDate) - today) / 86400000);
        return days <= 7;
      });
      const nearCrit = tasks.filter(t => {
        if (t.totalFloat === null || t.totalFloat === undefined) return false;
        if (t.totalFloat <= 0) return false;
        if (t.totalFloat <= 10) return true;
        if (t.floatBaseline && t.floatBaseline > 0 && (t.floatBaseline - t.totalFloat) / t.floatBaseline > 0.30) return true;
        return false;
      });
      const crit = tasks.filter(t => t.totalFloat === 0);
      // Monolith timelineLine(): Charter Target vs current planned finish.
      let tlLine = '';
      const target = f.targetCompletion || f.end;
      const dated = tasks.filter(t => t.endDate || t.end);
      if (target && dated.length) {
        const tDate = new Date(target);
        const projected = new Date(Math.max.apply(null, dated.map(t => new Date(t.endDate || t.end).getTime())));
        const over = Math.round((projected - tDate) / 86400000);
        tlLine = '## TIMELINE TARGET\nTarget Completion: ' + target + ' | Current Planned Finish: ' + projected.toISOString().slice(0, 10) + ' | ' + (over > 0 ? (over <= 14 ? 'At Risk , ' : 'Over target , ') + over + 'd over' : 'On or ahead of target') + '\n';
      }
      return ['# DAILY FIELD STATUS REPORT PROMPT',
        `Project: ${f.name || '-'}`,
        `Date: ${new Date().toISOString().split('T')[0]}`,
        '',
        'You are the Project Manager writing a same-day field status digest, following a site walk. The PM has just updated task statuses in the app. Produce:',
        '',
        '1. **Completed today** , recognize what got done (vs. the prior snapshot).',
        '2. **Blocked tasks** , each with a one-line reason (pull from notes if present, otherwise say "reason not captured , needs entry").',
        '3. **Lead-time tasks nearing expected date** , flag any within 7 days.',
        '4. **Float consumption flags** , call out near-critical and critical tasks.',
        '5. **One-paragraph "Where We Stand"** , plain-English summary suitable for pasting into a daily sponsor update (2-4 sentences, no jargon).',
        '',
        prevSnap ? `## COMPLETED SINCE LAST SNAPSHOT (${prevSnap.date})` : '## COMPLETED TODAY (no prior snapshot , showing current completed state)',
        (prevSnap && completedToday.length) ? completedToday.map(t => `- [${t.id}] ${t.name}`).join('\n')
          : (!prevSnap ? tasks.filter(t => t.status === 'completed').slice(0, 10).map(t => `- [${t.id}] ${t.name}`).join('\n') || '(none)' : '(nothing new since last snapshot)'),
        '',
        '## BLOCKED TASKS (' + blocked.length + ')',
        blocked.length ? blocked.map(t => `- [${t.id}] ${t.name} , reason: ${t.notes || '(not captured)'}`).join('\n') : '(none blocked)',
        '',
        '## IN PROGRESS (' + inprog.length + ')',
        inprog.length ? inprog.map(t => `- [${t.id}] ${t.name}${t.endDate ? ' | Target end: ' + t.endDate : ''}${(t.done !== undefined && t.done !== null && t.done !== '') ? ' | ' + t.done + '% Completed' : ''}`).join('\n') : '(nothing in progress)',
        '',
        '## LEAD-TIME NEARING EXPECTED DATE',
        leadtimeNear.length ? leadtimeNear.map(t => {
          const days = Math.round((U.parseDL(t.expectedDate) - today) / 86400000);
          return `- [${t.id}] ${t.name} , expected ${t.expectedDate} (${days < 0 ? 'OVERDUE by ' + Math.abs(days) + 'd' : days + 'd out'})`;
        }).join('\n') : '(none , no leadtime tasks close to expected date)',
        '',
        '## CRITICAL / NEAR-CRITICAL (float watch)',
        'Critical (zero float): ' + (crit.length ? crit.map(t => `[${t.id}] ${t.name}`).join(', ') : 'none'),
        'Near-critical: ' + (nearCrit.length ? nearCrit.map(t => `[${t.id}] ${t.name} (float ${t.totalFloat}d)`).join(', ') : 'none'),
        '',
        tlLine,
        '## OUTPUT',
        'Use short sections with the same headings above, then close with the "Where We Stand" paragraph.',
        '',
        '_Tip: click **Snapshot Now** below and re-run tomorrow , you\'ll get a real completed-today diff instead of a current-state dump._'
      ].filter(x => x !== '').join('\n');
    },

    claim: function() {
      // Rank 1 companion: grounds the LLM in the actual claim-pack
      // evidence already assembled in the app , schedule slips with cause
      // tags, LD rollup, weather log, pending changes, decision log.
      const s = S();
      const f = (s && s.charter) || {};
      let slipsBlock = '(no schedule slips detected , project is on or ahead of baseline)';
      let ldBlock = '(no LD exposure data , set an LD rate in the Budget panel)';
      try {
        if (ns.Claim && ns.Claim.computeSlips) {
          const slips = ns.Claim.computeSlips(s) || [];
          if (slips.length) {
            slipsBlock = slips.map(x => `- [${x.taskId}] ${x.taskName}: ${x.days}d slip (baseline ${x.baselineEnd || '?'} → current ${x.currentEnd || '?'}) | cause: ${x.cause || 'unknown'}`).join('\n');
          }
        }
        if (ns.Claim && ns.Claim.ldRollup) {
          const ld = ns.Claim.ldRollup(s);
          if (ld) {
            ldBlock = `LD rate: $${(+s.ldRate || 0).toLocaleString()}/day | Weather-caused (avoidable/defensible): $${(ld.avoidedLd || 0).toLocaleString()} | All other causes (exposure): $${(ld.incurredLd || 0).toLocaleString()}`;
          }
        }
      } catch (e) { /* grounding is best-effort , never block the prompt */ }
      return `CLAIM / DELAY PACKAGE EVIDENCE , GENERATED FROM My MaNaGeR DATA

${buildContext()}

=== CHARTER ===
${buildCharterSummary()}

=== SCHEDULE SLIPS (baseline vs actual, cause-tagged) ===
${slipsBlock}

=== LIQUIDATED DAMAGES EXPOSURE ===
${ldBlock}

=== WEATHER DELAY LOG ===
${(() => {
  const wl = (s && s.weatherLog) || [];
  if (!wl.length) return '(no weather delays logged)';
  return wl.map(e => `- ${e.date}: ${e.condition || 'weather'}${e.note ? ' , ' + e.note : ''}${(e.affectedTaskIds || []).length ? ' | affected tasks: ' + e.affectedTaskIds.join(', ') : ''}`).join('\n');
})()}

=== PENDING CHANGES ===
${buildChangeSummary()}

=== DECISION LOG (recent) ===
${buildLogSummary()}

=== INSTRUCTIONS ===
Using ONLY the evidence above (do not invent facts, dates, or amounts):
1. Draft the claim narrative: what happened, which baseline dates were missed, and the cause for each slip
2. Lay out the LD exposure: weather-caused days (defensible) vs non-weather days (exposure)
3. List the supporting evidence , which weather-log entries and change orders back each slip
4. Flag evidence gaps: what is still missing before this package is submission-ready
5. End with a plain-English executive summary for the client/insurer

Be precise with dates and amounts from the data. Where evidence is missing, say so explicitly rather than assuming.`;
    },

    complianceCheck: function() {
      // MARKET-FEATURE-ROADMAP A7: AI-drafted clause-compliance check , the
      // lighter VisibleThread: review the assembled claim package against a
      // standard element checklist. Grounded in the SAME evidence sources as
      // the claim preset so the two can never disagree.
      const s = S();
      const f = (s && s.charter) || {};
      let slipsBlock = '(no schedule slips detected , project is on or ahead of baseline)';
      let ldBlock = '(no LD exposure data , set an LD rate in the Budget panel)';
      try {
        if (ns.Claim && ns.Claim.computeSlips) {
          const slips = ns.Claim.computeSlips(s) || [];
          if (slips.length) {
            slipsBlock = slips.map(x => `- [${x.taskId}] ${x.taskName}: ${x.days}d slip (baseline ${x.baselineEnd || '?'} → current ${x.currentEnd || '?'}) | cause: ${x.cause || 'unknown'}`).join('\n');
          }
        }
        if (ns.Claim && ns.Claim.ldRollup) {
          const ld = ns.Claim.ldRollup(s);
          if (ld) {
            ldBlock = `LD rate: $${(+s.ldRate || 0).toLocaleString()}/day | Weather-caused (avoidable/defensible): $${(ld.avoidedLd || 0).toLocaleString()} | All other causes (exposure): $${(ld.incurredLd || 0).toLocaleString()}`;
          }
        }
      } catch (e) { /* grounding is best-effort , never block the prompt */ }
      return `CLAIM PACKAGE COMPLIANCE CHECK , GENERATED FROM My MaNaGeR DATA

Project: ${f.name || '(unnamed)'} | Sponsor: ${f.sponsor || '(not set)'}

${buildContext()}

=== SCHEDULE SLIPS (baseline vs actual, cause-tagged) ===
${slipsBlock}

=== LIQUIDATED DAMAGES EXPOSURE ===
${ldBlock}

=== WEATHER DELAY LOG ===
${(() => {
  const wl = (s && s.weatherLog) || [];
  if (!wl.length) return '(no weather delays logged)';
  return wl.map(e => `- ${e.date}: ${e.condition || 'weather'}${e.note ? ' , ' + e.note : ''}${(e.affectedTaskIds || []).length ? ' | affected tasks: ' + e.affectedTaskIds.join(', ') : ''}`).join('\n');
})()}

=== PENDING CHANGES ===
${buildChangeSummary()}

=== DECISION LOG (recent) ===
${buildLogSummary()}

=== INSTRUCTIONS ===
Review this claim package against a standard submission checklist and report, element by element, whether each is PRESENT, MISSING, or UNCLEAR , using ONLY the data above, never inventing content:
1. DELAY NARRATIVE , is there a plain-language story of what happened, which baseline dates were missed, and the cause for each slip?
2. SUPPORTING EVIDENCE REFERENCES , do the slips point to concrete evidence (weather-log entries, change orders, decision-log entries)?
3. COST IMPACT BREAKDOWN , is the LD exposure / cost impact quantified and separated by cause (defensible vs exposure)?
4. CONTRACTUAL BASIS , is there a stated basis for relief (which contract terms, notices, or obligations apply)?
5. REQUESTED RELIEF , is the ask explicit (extension of time, LD waiver, amount)?
End with: a one-line verdict on submission readiness, and a short list of exactly what to add before submitting. Where a required element is genuinely absent from the data, say "MISSING , add ..." rather than assuming it exists.`;
    }
  };

  function generatePrompt(type) {
    const generator = prompts[type];
    if (!generator) return `No prompt template for "${type}".`;
    try {
      return generator();
    } catch(e) {
      console.warn('Prompt generation failed:', e);
      return `Error generating prompt: ${e.message}`;
    }
  }

  function getPromptList() {
    return Object.keys(prompts);
  }

  // ---- API ----
  ns.Prompts = {
    generate: generatePrompt,
    list: getPromptList
  };
})(MMGR);
window.MMGR = MMGR;