/* ============================================================
   My MaNaGeR — Definitions Glossary Module
   Plain-language PM glossary rendered into the Definitions panel
   (#def-container). This is static reference content: no state,
   no persistence. The DEFINITIONS array is the single source of
   truth — adding or editing a term touches data only, and the
   render function stays unchanged.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;

  // ---- Glossary data ----
  // Each entry: { term, group, meaning, why }
  //   term    — the concept, named exactly as it appears in the UI
  //             where the app exposes one
  //   group   — short category badge (uppercased by CSS)
  //   meaning — one-line plain-English definition
  //   why     — one sentence on why it matters inside this tool
  const DEFINITIONS = [
    // ---- Initiating ----
    { term: 'Project Sponsor', group: 'Initiating',
      meaning: 'The person or organization that funds the project, owns the business case, and has final authority over scope and budget changes.',
      why: 'The Charter records the sponsor so the escalation and approval path exists before it is needed.' },
    { term: 'Project Charter', group: 'Initiating',
      meaning: 'The formal, approved document that fixes the project purpose, scope, budget, KPIs, and constraints before work starts.',
      why: 'The Charter tab is the single source of truth that the rest of the tool reads from.' },

    // ---- Planning ----
    { term: 'Stakeholders', group: 'Planning',
      meaning: 'Anyone who can affect, be affected by, or think they are affected by the project — clients, regulators, neighbors, vendors.',
      why: 'The Stakeholder Register tracks them so engagement is planned instead of reactive.' },
    { term: 'Stakeholder Influence / Interest', group: 'Planning',
      meaning: 'Two ratings that decide how much attention a stakeholder needs: high influence means they can block or enable you, high interest means they care about the outcome.',
      why: 'The register\u2019s Influence and Interest columns are the basis for the engagement strategy you assign to each person.' },
    { term: 'Resources', group: 'Planning',
      meaning: 'The people, equipment, materials, and money needed to do the work.',
      why: 'The Resources tab tracks availability, rate, and allocation so over-commitment is visible before it becomes a delay.' },
    { term: 'Requirements', group: 'Planning',
      meaning: 'The conditions that must be met for the project to start, progress, or be accepted as complete.',
      why: 'Charter scope, deliverables, and constraints pin requirements down before mobilization.' },
    { term: 'Deliverable', group: 'Planning',
      meaning: 'A tangible, verifiable output handed to the client or sponsor — a pour, a floor, a signed inspection.',
      why: 'The Charter\u2019s Key Deliverables field defines what success looks like before the WBS exists.' },
    { term: 'Quantifiable Outcome', group: 'Planning',
      meaning: 'The measurable business benefit a deliverable produces — a percentage, a dollar figure, a time saving.',
      why: 'Charter KPIs turn outcomes into numbers the Health Score and reports can track.' },
    { term: 'Project Scope', group: 'Planning',
      meaning: 'The defined boundary of the work: what is included and, just as importantly, what is excluded.',
      why: 'The Charter Scope field plus the Change register are how the tool protects that boundary.' },
    { term: 'Work Package', group: 'Planning',
      meaning: 'The smallest unit of work in the WBS that can be assigned, tracked, and delivered on its own.',
      why: 'WBS tasks are effectively work packages — each gets an owner, dates, status, and flags.' },
    { term: 'Work Breakdown Structure (WBS)', group: 'Planning',
      meaning: 'A hierarchical decomposition of the project into manageable pieces of work.',
      why: 'The WBS tab is where that hierarchy is built; dates, predecessors, and weather flags hang off it.' },
    { term: 'Baseline', group: 'Planning',
      meaning: 'The formally approved version of the plan (schedule, cost, scope) used as the fixed reference for measuring performance.',
      why: 'Save Baseline in Settings snapshots the plan, and every Baseline Variance card compares against it.' },

    // ---- Scheduling ----
    { term: 'Milestone', group: 'Scheduling',
      meaning: 'A zero-duration checkpoint that marks completion of a phase or a key event.',
      why: 'Tick Milestone on a WBS task and it appears on the Dashboard Milestone Timeline.' },
    { term: 'Predecessor', group: 'Scheduling',
      meaning: 'A task that must finish (or start) before another can begin — the dependency link between two tasks.',
      why: 'Predecessors drive the Gantt arrows, Cascade Dates, and the critical path.' },
    { term: 'Critical Path', group: 'Scheduling',
      meaning: 'The longest chain of dependent tasks; any slip on it pushes the project finish date.',
      why: 'Highlight Critical on the Gantt paints these tasks so you can see where delays hurt most.' },
    { term: 'Float (Slack)', group: 'Scheduling',
      meaning: 'How many days a task can slip before it delays the project (total float) or its successor (free float).',
      why: 'Float Watch lists critical, near-critical, and slack-consumed tasks the moment you Cascade Dates.' },
    { term: 'Cascade Dates', group: 'Scheduling',
      meaning: 'Recomputes every task\u2019s start and end from its predecessor links and durations, applying weather padding where tagged.',
      why: 'The Cascade Dates button on the Gantt toolbar is the single action that makes the schedule self-consistent.' },
    { term: 'Gantt Chart', group: 'Scheduling',
      meaning: 'A bar chart showing tasks against a calendar, with dependencies drawn as arrows.',
      why: 'The Gantt tab is the visual schedule — drag bars to reschedule and click an arrow to remove a dependency.' },
    { term: 'Today\u2019s Focus View', group: 'Scheduling',
      meaning: 'A dashboard list of what needs you now, ranked into Overdue, Due Today, Due This Week, and In Progress.',
      why: 'Change a task\u2019s status right from the list — it writes through the same WBS status field.' },
    { term: 'Lead-Time Task', group: 'Scheduling',
      meaning: 'A task tracked by Submitted and Expected dates instead of percent complete — typically a vendor wait or permit.',
      why: 'The Lead-Time Tracker and the Kanban lead-time lane flag when an expected date is near or past due.' },
    { term: 'Timeline Target Variance', group: 'Scheduling',
      meaning: 'The gap between the Charter\u2019s Target Completion Date and the current planned finish of the schedule.',
      why: 'The Dashboard Timeline Target card and the header badge surface this gap before it becomes a surprise.' },
    { term: 'Schedule Confidence', group: 'Scheduling',
      meaning: 'A one-glance dashboard card combining simulation probability, the weather-buffer check, and the biggest crash candidate.',
      why: 'If you only look at one schedule number, this card tells you whether the plan still fits the target.' },
    { term: 'Monte Carlo Simulation', group: 'Scheduling',
      meaning: 'Runs hundreds of simulated schedules with varied task durations and reports the probability of hitting your target date.',
      why: 'The Monte Carlo panel on the Gantt tab produces the P10/P50/P90 spread and feeds Schedule Confidence.' },
    { term: 'Critical Path Method (CPM)', group: 'Scheduling',
      meaning: 'The scheduling technique that computes early and late dates and float by passing calculations forward and backward through the task network.',
      why: 'The schedule engine runs this math on every cascade — you see the result as dates, float, and critical bars.' },

    // ---- Execution ----
    { term: 'Deliverable Check', group: 'Execution',
      meaning: 'Confirming that a completed task actually produced the required output before it is counted as done.',
      why: 'The WBS status and Closure checklist keep the definition of done visible per task.' },
    { term: 'Procurement', group: 'Execution',
      meaning: 'The process of sourcing and contracting goods or services from external suppliers.',
      why: 'Vendor waits are where schedules quietly die — Lead-Time Tasks make those waits visible.' },
    { term: 'RFI — Request for Information', group: 'Execution',
      meaning: 'A formal written request for information or clarification sent to the owner, designer, or authorities.',
      why: 'Log it in the Comms Log with a follow-up date so open questions do not stall the schedule silently.' },
    { term: 'RFP — Request for Proposal', group: 'Execution',
      meaning: 'A formal document inviting suppliers to bid on defined work so bids come back comparable.',
      why: 'Lead-time tracking starts here — once an RFP goes out, the vendor wait clock is running.' },
    { term: 'Weather-Sensitive Task', group: 'Execution',
      meaning: 'A task tagged to receive selective schedule padding because regional weather windows (winter, monsoon, hurricane) can stop it.',
      why: 'Use the cloud button on a WBS row; exposed tasks then show up in Weather Variance and on the Gantt.' },
    { term: 'Weather Float (Distributed)', group: 'Execution',
      meaning: 'Weather padding added per task during cascade — counted only for working days the task actually sits inside a hostile window — instead of one blanket buffer at the end.',
      why: 'Float Watch shows each task\u2019s padding and baseline so you can see exactly where the weather risk lives.' },

    // ---- Governance ----
    { term: 'Change Control', group: 'Governance',
      meaning: 'The formal process for requesting, assessing, approving, and documenting any change to scope, schedule, or budget.',
      why: 'The Change register is that process — every request records its schedule and cost impact before approval.' },
    { term: 'Change Order / Variation Order', group: 'Governance',
      meaning: 'A formally approved instruction that alters the original contract scope, price, or dates.',
      why: 'Approved changes become the new reality the Budget and schedule then measure against.' },
    { term: 'Change Impact (Ripple)', group: 'Governance',
      meaning: 'The knock-on effect of a change: which tasks move, how many days are added, which budget lines are touched.',
      why: 'Each change request\u2019s Schedule and Cost Impact fields capture the ripple, and the Change Impact Assessment prompt walks it through before you approve.' },
    { term: 'Decision Log', group: 'Governance',
      meaning: 'A dated record of decisions made, who made them, and the action items that follow.',
      why: 'The Decision Log tab keeps commitments searchable so \u201cwe discussed it\u201d becomes a tracked action item.' },
    { term: 'RACI Matrix', group: 'Governance',
      meaning: 'A grid mapping each task to the people involved using four roles: Responsible, Accountable, Consulted, Informed.',
      why: 'Click any cell to cycle R\u2192A\u2192C\u2192I; the matrix renders live from your tasks, resources, and stakeholders.' },
    { term: 'RACI Conflict Check', group: 'Governance',
      meaning: 'Automatic warnings for matrix problems — a task with no Accountable owner, or a person Accountable for too many tasks.',
      why: 'The RACI panel shows these alerts so accountability gaps surface instead of hiding in the grid.' },

    // ---- Risk & Contract ----
    { term: 'Risk', group: 'Risk Mgmt',
      meaning: 'An uncertain event that has not happened yet but could affect the project if it does.',
      why: 'The Risk table scores each risk by probability and impact so mitigation is planned before the event lands.' },
    { term: 'Issue', group: 'Risk Mgmt',
      meaning: 'A risk that has materialized into a current problem with an owner and a resolution target.',
      why: 'Issues get their own live list and feed the Health Score — they demand action, not monitoring.' },
    { term: 'Contingency Reserve', group: 'Risk Mgmt',
      meaning: 'Money or time held aside specifically for identified risks and weather, kept separate from the base plan.',
      why: 'The Charter Target Dates prompt sizes weather contingency separately, and the Risk Review agenda keeps it on the table.' },
    { term: 'Liquidated Damages', group: 'Risk Mgmt',
      meaning: 'A contract rate the owner can charge per day if completion is late — the financial teeth behind the schedule.',
      why: 'When a contract has an LD rate, every day of slip costs money, which is why the tool surfaces float, delays, and weather exposure before final completion.' },
    { term: 'Schedule Reliability Index', group: 'Risk Mgmt',
      meaning: 'The share of scheduled project days not lost to logged weather delays, shown as a percentage of the whole schedule window.',
      why: 'It sits beside LD exposure in the weather strip, so a weather-hit schedule shows its reliability number and its contract cost side by side.' },

    // ---- Monitoring ----
    { term: 'KPI — Key Performance Indicator', group: 'Monitoring',
      meaning: 'A pre-agreed, measurable metric used to judge how well the project is performing against its objectives.',
      why: 'The Charter\u2019s KPI list can link to live data such as EVM indices, Health Score, or Defects at Handover.' },
    { term: 'Baseline Variance', group: 'Monitoring',
      meaning: 'The difference between the captured baseline plan and the current plan, in schedule days and cost.',
      why: 'The Dashboard Baseline Variance cards and table show which tasks moved and by how much since the baseline was saved.' },
    { term: 'Earned Value Metrics (CPI & SPI)', group: 'Monitoring',
      meaning: 'Earned value compares planned value, earned value, and actual cost to measure schedule and cost health in one number each.',
      why: 'SPI above 1 means ahead of schedule and CPI below 1 means over budget — both live on the Dashboard EVM card, with EAC, ETC, VAC, and TCPI forecasts beside them.' },
    { term: 'Health Score', group: 'Monitoring',
      meaning: 'A weighted 0\u2013100 score (Completion 30% / Schedule 25% / Budget 20% / Risk 15% / Change 10%) computed only from factors that have real data.',
      why: 'The Dashboard health card shows the score and its per-factor breakdown, and it can be linked as a Charter KPI.' },
    { term: 'Health Score Narrative', group: 'Monitoring',
      meaning: 'The plain-English note under the score that explains which factors are driving it and which are still waiting for data.',
      why: 'It stops the score being a mystery number — an early project is told \u201cthis is mostly completion % for now\u201d rather than being flagged.' },
    { term: 'Today\u2019s Decision Engine', group: 'Monitoring',
      meaning: 'The Dashboard list that scores every overdue, stalled, high-risk, or over-budget item by impact and ranks it, so the top of the list is what needs you most right now.',
      why: 'Each row shows the live reasons behind its rank, and the list re-ranks itself on every data change.' },

    // ---- Methodology ----
    { term: 'Scrum', group: 'Methodology',
      meaning: 'An Agile framework that delivers work in fixed-length iterations (sprints) with a sprint goal and a backlog.',
      why: 'Set the methodology to Agile and the Sprint bar plus the agile meeting ceremonies appear.' },
    { term: 'Kanban', group: 'Methodology',
      meaning: 'A visual workflow method that limits work in progress by pulling tasks through columns.',
      why: 'The Kanban tab is the board — drag cards between To Do, In Progress, Blocked, and Completed.' },
    { term: 'Lean', group: 'Methodology',
      meaning: 'A methodology focused on eliminating waste and maximizing value in the workflow.',
      why: 'Lean\u2019s waste lens is why the tool flags blocked tasks and over-allocation instead of leaving them hidden.' },
    { term: 'DMAIC', group: 'Methodology',
      meaning: 'A Six Sigma improvement cycle — Define, Measure, Analyze, Improve, Control — five phases for structured problem-solving.',
      why: 'The DMAIC tab (available in Hybrid methodology) walks each phase with its own fields and a dashboard progress signal.' },

    // ---- Closeout ----
    { term: 'Punch List', group: 'Closeout',
      meaning: 'The list of defects and unfinished items to fix before the client accepts the work.',
      why: 'Closeout checklist items and the Defects at Handover KPI are where punch-list reality gets tracked to zero.' },
    { term: 'Lessons Learned', group: 'Closeout',
      meaning: 'What went well and what should change, captured at the end so the next project starts smarter.',
      why: 'The Closure tab\u2019s Lessons Learned fields feed the handover record and Copy All.' }
  ];

  // ---- Render ----
  // Static, data-driven output into the existing Definitions panel
  // container (#def-container). Uses the def-* card classes already
  // defined in css/mmgr.css; no inline styles, no new ids.
  function renderDefs() {
    const el = document.getElementById('def-container');
    if (!el) return;
    el.innerHTML = DEFINITIONS.map(function(d) {
      return '<div class="def-card">' +
        '<div class="def-term">' + U.escapeHtml(d.term) +
        (d.group ? '<span class="def-badge">' + U.escapeHtml(d.group) + '</span>' : '') +
        '</div>' +
        '<div class="def-body">' + U.escapeHtml(d.meaning) + '</div>' +
        (d.why ? '<div class="def-why">Why it matters: ' + U.escapeHtml(d.why) + '</div>' : '') +
        '</div>';
    }).join('');
  }

  // ---- API ----
  ns.Defs = {
    DATA: DEFINITIONS,
    render: renderDefs
  };
})(MMGR);
window.MMGR = MMGR;
