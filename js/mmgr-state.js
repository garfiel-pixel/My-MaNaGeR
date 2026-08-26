/* ============================================================
   My MaNaGeR , State Management Module
   Schema versioning, persistence, and migration.
   ============================================================ */
var MMGR = window.MMGR || {};

/* ============================================================
   JSDoc Type Definitions — shared state shapes
   ============================================================
   These types document the canonical shapes used across all modules.
   Editors/AI tooling can catch wrong-field-name bugs at edit time.
   Every render module, CRUD module, and cloud-sync module references
   these shapes — keep this block current when fields are added.
   ============================================================ */

/**
 * @typedef {Object} Charter
 * @property {string} name
 * @property {string} sponsor
 * @property {string} objective
 * @property {string} scope
 * @property {string} deliverables
 * @property {string} constraints
 * @property {string} assumptions
 * @property {string} exclusions
 * @property {string} targetStart   — YYYY-MM-DD
 * @property {string} targetCompletion — YYYY-MM-DD
 * @property {number} budgetEnvelope
 * @property {Array<{name:string, target:string}>} kpis
 * @property {{financial:boolean, schedule:boolean, quality:boolean, safety:boolean, environmental:boolean}} categories
 */

/**
 * @typedef {Object} Task
 * @property {string|number} id
 * @property {string} text
 * @property {string} startDate     — YYYY-MM-DD
 * @property {string} endDate       — YYYY-MM-DD
 * @property {string} status        — 'not-started'|'in-progress'|'completed'
 * @property {string} [confidence]  — 'low'|'medium'|'high'
 * @property {number} [indent]      — WBS indent level (0 = top)
 * @property {number} [level]       — alias for indent
 * @property {boolean} [isPhase]    — true if this is a phase row
 * @property {Array<string|number>} [predecessors] — predecessor task ids
 * @property {string} [assignedTo]  — resource name
 */

/**
 * @typedef {Object} Risk
 * @property {string|number} id
 * @property {string} description
 * @property {string} impact        — 'low'|'medium'|'high'
 * @property {string} probability   — 'low'|'medium'|'high'
 * @property {string} [status]      — 'open'|'mitigated'|'closed'
 * @property {string} [owner]
 * @property {string} [mitigation]
 */

/**
 * @typedef {Object} BudgetLine
 * @property {string|number} id
 * @property {string} category
 * @property {string} description
 * @property {number} planned
 * @property {number} actual
 * @property {number} [committed]
 * @property {string} [phase]
 */

/**
 * @typedef {Object} Resource
 * @property {string|number} id
 * @property {string} name
 * @property {string} role
 * @property {number} [rate]        — hourly rate
 * @property {number} [allocation]  — percentage 0-100
 * @property {number} [utilization] — computed percentage
 */

/**
 * @typedef {Object} Stakeholder
 * @property {string|number} id
 * @property {string} name
 * @property {string} role
 * @property {string} [interest]    — 'low'|'medium'|'high'
 * @property {string} [influence]   — 'low'|'medium'|'high'
 * @property {string} [coiExpiry]   — YYYY-MM-DD
 * @property {string} [licenseExpiry] — YYYY-MM-DD
 * @property {string} [emr]
 * @property {string} [emrVerified]
 */

/**
 * @typedef {Object} Issue
 * @property {string|number} id
 * @property {string} description
 * @property {string} [status]      — 'open'|'resolved'
 * @property {string} [raisedDate]
 * @property {string} [owner]
 */

/**
 * @typedef {Object} Change
 * @property {string|number} id
 * @property {string} title
 * @property {string} description
 * @property {string} [status]      — 'submitted'|'review'|'approved'|'rejected'
 * @property {string} [raisedDate]
 * @property {string} [owner]
 */

/**
 * @typedef {Object} Meeting
 * @property {string|number} id
 * @property {string} title
 * @property {string} kind          — 'daily'|'weekly'|'sprint'|'stakeholder'|'review'
 * @property {string} [date]
 * @property {Array<{text:string, assignedTo?:string}>} [items]
 * @property {boolean} [closed]
 */

/**
 * @typedef {Object} SpendEntry
 * @property {string|number} id
 * @property {string} budgetLineId
 * @property {number} amount
 * @property {string} date          — YYYY-MM-DD
 * @property {string} [description]
 */

/**
 * @typedef {Object} WeatherLogEntry
 * @property {string|number} id
 * @property {string} date          — YYYY-MM-DD
 * @property {string} [condition]
 * @property {number} [tempHigh]
 * @property {number} [tempLow]
 * @property {string} [notes]
 */

/**
 * @typedef {Object} ScheduleSlip
 * @property {string|number} taskId
 * @property {number} daysSlipped
 * @property {string} cause         — 'weather'|'predecessor'|'change'|'unknown'
 * @property {string} [detectedAt]  — ISO timestamp
 */

/**
 * @typedef {Object} AppState
 * @property {number} schemaVersion
 * @property {string} projectId
 * @property {string} projectName
 * @property {string} methodology    — 'waterfall'|'agile'|'hybrid'
 * @property {number} workWeek       — hours per work week
 * @property {string} theme          — 'light'|'dark'
 * @property {string} userName
 * @property {Charter} charter
 * @property {Task[]} tasks
 * @property {Meeting[]} meetings
 * @property {Resource[]} resources
 * @property {BudgetLine[]} budgetLines
 * @property {number} budgetEnvelope
 * @property {SpendEntry[]} spendLog
 * @property {Stakeholder[]} stakeholders
 * @property {Risk[]} risks
 * @property {Issue[]} issues
 * @property {Change[]} changes
 * @property {ScheduleSlip[]} scheduleSlips
 * @property {Object} raci           — { tasks: string[], persons: string[], matrix: Object }
 * @property {Object} closure        — { items: Object[], well: string, imp: string, rec: string }
 * @property {Object} config         — per-project config overrides
 * @property {Object} fieldTs        — { fieldName: string } per-field write timestamps
 */

(function(ns) {
  'use strict';

  const STORAGE_KEY = 'mmgr_state';
  const SCHEMA_VERSION = 19;

  // ---- Default State ----
  /** @returns {AppState} */
  function getDefaultState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      projectId: ns.projectId || 'default',
      projectName: '',
      methodology: 'waterfall',
      methodologyLocked: false,
      workWeek: 5,
      theme: 'light',
      crosshairOn: false,
      userName: '',
      // Charter
      charter: {
        name: '', sponsor: '', objective: '', scope: '', deliverables: '',
        constraints: '', assumptions: '', exclusions: '', targetStart: '',
        targetCompletion: '', budgetEnvelope: 0, kpis: [],
        categories: { financial: true, schedule: true, quality: true, safety: true, environmental: true }
      },
      // WBS
      tasks: [],
      // Meetings (completed history + live session)
      meetings: [],
      // ACTION-PLAN 1.2: meeting-to-action closed loop , promises carried
      // from one meeting of a kind into the next (keyed by meeting kind).
      meetingPromises: {},
      activeMeeting: null,
      nmeetid: 1,
      // Spend log counter
      nspid: 1,
      // Resources
      resources: [],
      // Budget
      budgetLines: [],
      budgetEnvelope: 0,
      spendLog: [],
      // Stakeholders
      stakeholders: [],
      // Risks
      risks: [],
      // Issues
      issues: [],
      // Changes
      changes: [],
      // Log
      logEntries: [],
      // Comms
      commsEntries: [],
      // Documents
      documents: [],
      // Closure
      closure: { items: [], well: '', imp: '', rec: '' },
      // RACI
      raci: { tasks: [], persons: [], matrix: {} },
      // Sprint
      sprint: { name: 'Sprint 1', start: '', end: '' },
      // Daily snapshots
      dailySnapshots: [],
      // Definitions expansion
      defExpanded: {},
      // DMAIC
      dmaic: {
        active: false,
        define: { problem: '', goal: '', scope: '', sponsor: '', voice: '', done: false },
        measure: { baseline: '', defects: '', unit: '', opportunity: '', dpmo: '', sigmaNow: '', done: false },
        analyze: { rootCauses: '', fishbone: '', paretoTop: '', done: false },
        improve: { solutions: '', pilot: '', results: '', done: false },
        control: { plan: '', metrics: '', handover: '', done: false }
      },
      // Baseline
      baseline: null,
      // Weather region driving selective schedule padding
      weatherRegion: 'northern-temperate',
      // ACTION-PLAN 7: Open-Meteo forecast , one-time geocode + TTL cache,
      // plus the weather-delay daily log and the LD contract rate.
      siteLat: null,
      siteLon: null,
      sitePlace: '',
      wxCache: null,
      weatherLog: [],
      ldRate: 0,
      // ACTION-PLAN 7.1: forecast strip horizon (7-day default; 16 = max
      // Open-Meteo horizon, used as the "monthly rollup" approximation).
      wxViewDays: 7,
      // V3.3 port: hurricane/wet-season window + charter buffer (dashboard
      // Weather Exposure panel). Mirrors the monolith S.wxWindow shape.
      wxWindow: { start: '', end: '', bufferDays: 0 },
      // V3.3 port: dedicated Kanban lead-time swimlane toggle
      kbShowLeadtime: false,
      // Monolith Critical Path Highlighter: dim non-critical Gantt bars
      hlCritical: false,
      // Monolith Daily Field snapshot: { date, taskStates } , the state map
      // the Daily Field prompt diffs "completed since last snapshot" against.
      dailySnapshot: null,
      // Monolith focus mode: persists the F-key workspace across refreshes.
      focusMode: false,
      // ACTION-PLAN 3.3: quiet PM consistency streak , consecutive calendar
      // days with at least one edit. Informational only, never gates or nags.
      streak: { count: 0, lastDate: null },
      // ACTION-PLAN 3.2: stakeholder sentiment pulse , per-meeting team pulse
      // (positive/neutral/concerned), tracked over time as a sparkline.
      // Professional tone: no emoji, optional, never blocks meeting close.
      sentimentHistory: [],
      // File-backup watermark: set whenever the project is saved to a .json
      // file. The header dirty indicator compares this against updatedAt so
      // "Not backed up" is meaningful (not a 300ms flash during autosave).
      lastBackedUpAt: null,
      // Phase 2: client feature flags , all default-on; switching a flag off
      // hides the corresponding optional UI (Controls drawer > Features).
      // MERGED-AI-CONTROL (audit 1.2): aiWindow is NOT a flag anymore , the
      // AI assistant is controlled by state.config.ai.tier (the drawer switch
      // is its master on/off). Only the four real UI modules stay flags.
      flags: { monteCarlo: true, ganttExport: true, leadtimeLane: true, weatherForecast: true },
      // Phase 2: client-side error surface , last 20 errors, each with a
      // timestamp and the source action, surfaced in the Controls drawer.
      errorLog: [],
      // Phase 3: reserved per-project config (future API keys/endpoints).
      // Empty by default , see MMGR.Config in js/mmgr-net.js for the static
      // defaults every network call already routes through.
      config: {},
      // MASTER-ACTION-PLAN-v3-STRICT Rank 1.2: schedule slips as a
      // FIRST-CLASS object , which tasks slipped vs the baseline, by how
      // many days, each with a cause tag (weather / predecessor / change /
      // unknown), never silently blank. slipCauses holds explicit user
      // overrides keyed by taskId; computeSlips() in mmgr-claim.js derives
      // the rest from baseline-vs-current and the weather log.
      scheduleSlips: [],
      slipCauses: {},
      // MASTER-ACTION-PLAN-v3-STRICT Rank 2.1: digest reference point. When
      // the user pins the weekly/daily digest, a compact fingerprint of
      // digest-relevant state is captured here; the next generation diffs
      // live state against it so "what changed" is exact, never guessed.
      digestSnapshot: null,
      // PLAN-OF-ACTION-AI-VOICE-SYNC-v1 Rank 2.3: agent-style preset outputs.
      // Each generated preset result is stored here as a structured field
      // keyed by preset type , { at, tier, model, promptType, text, trace }.
      // Unified state only (constraint #1): no side-store. Every entry keeps
      // a `trace` of the exact state fields its text was drawn from, so the
      // zero-fabrication acceptance gate can be re-verified on every run.
      aiOutputs: {},
      // PLAN-OF-ACTION-AI-VOICE-SYNC-v1 Rank 4.4: per-field write timestamps.
      // { fieldName: iso-string } , stamped on every save for the TOP-LEVEL
      // fields (plus nested charter keys) whose JSON actually changed since
      // the previous save. This is the primitive the cross-device merge uses
      // for last-write-wins PER FIELD instead of whole-document overwrite.
      // Deliberately the lighter option over a CRDT rewrite (per the plan).
      fieldTs: {},
      // MASTER-ACTION-PLAN-v3-STRICT Rank 3.1 (PLAN-OF-ACTION-AI-VOICE-SYNC-v1
      // Rank 3.4 companion): Core Mode vs Advanced Packs , progressive
      // disclosure. New projects start in CORE ONLY (Dashboard + WBS +
      // Kanban + Charter + Definitions); each advanced pack is toggled on
      // explicitly, never by default. Existing saved projects are migrated
      // with all packs ON so nothing disappears for a user mid-project.
      packs: {
        schedule: false, // Schedule Science: Gantt / critical path / Monte Carlo
        money: false, // Money: Budget / EVM
        governance: false, // Governance: RACI / Risk / Changes / Stakeholders / Log / Comms / Docs / Closure / Claim
        field: false, // Field: Weather / Meetings / Claim
        quality: false     // Quality: DMAIC
      },
      // PROJECT-UX-NAV-WEATHER-EXPORT-DIRECTIVE DIR-3: Core-Mode onboarding
      // callout memory. packsCalloutDismissed , the user clicked "Not now"
      // and is never asked again; packsEverEnabled , any pack has been
      // toggled on at least once, so a later toggle-OFF must not resurrect
      // the nudge (the directive: "once any pack has ever been toggled on
      // for that project, never show this callout again").
      packsCalloutDismissed: false,
      packsEverEnabled: false,
      // Timestamp
      updatedAt: new Date().toISOString()
    };
  }

  // ---- Migrations ----
  // Each migration is keyed by the schema version it PRODUCES (the migrate()
  // loop applies migrations[mv] when the stored version < mv and then sets
  // schemaVersion = mv). Labels below read "V{from} -> V{to}" accordingly.
  const migrations = {
    1: function(state) {
      // V0 -> V1: Add spendLog and budgetEnvelope
      if (!state.spendLog) state.spendLog = [];
      if (!state.budgetEnvelope) state.budgetEnvelope = 0;
      return state;
    },
    2: function(state) {
      // V1 -> V2: Add dailySnapshots and dmaic
      if (!state.dailySnapshots) state.dailySnapshots = [];
      if (!state.dmaic) state.dmaic = { phases: [] };
      return state;
    },
    3: function(state) {
      // V2 -> V3: Add weatherRegion
      if (!state.weatherRegion) state.weatherRegion = 'northern-temperate';
      return state;
    },
    4: function(state) {
      // V3 -> V4: Port-completion fields (MONOLITH-PORTING-GUIDE features 1-12
      // + MEETING_TRACKING_SPEC). Every new field gets a back-fill here so old
      // saved projects load cleanly against the new renderers.

      // Tasks: milestone flag + confidence level (Monte Carlo uses
      // confidence; keep the old coarse `confidence` for backward compat).
      (state.tasks || []).forEach(t => {
        if (t.milestone === undefined) t.milestone = false;
        if (t.confidenceLevel === undefined) t.confidenceLevel = t.confidence || null;
      });

      // Budget lines: spend-window linking + curve shape (Feature 2).
      (state.budgetLines || []).forEach(b => {
        if (b.linkedTaskId === undefined) b.linkedTaskId = b.taskId || null;
        if (!b.curveShape) b.curveShape = b.curve || 'linear';
      });

      // KPIs: live-link fields (Feature 3).
      (state.charter && state.charter.kpis || []).forEach(k => {
        if (k.linkedMetric === undefined) k.linkedMetric = null;
        if (!k.dir) k.dir = 'higher';
        if (k.measure === undefined) k.measure = '';
      });

      // DMAIC: replace the old empty { phases: [] } stub with the structured
      // phase object the interactive renderer writes to (Feature 8).
      const dmaicDefaults = {
        active: false,
        define: { problem: '', goal: '', scope: '', sponsor: '', voice: '', done: false },
        measure: { baseline: '', defects: '', unit: '', opportunity: '', dpmo: '', sigmaNow: '', done: false },
        analyze: { rootCauses: '', fishbone: '', paretoTop: '', done: false },
        improve: { solutions: '', pilot: '', results: '', done: false },
        control: { plan: '', metrics: '', handover: '', done: false }
      };
      if (!state.dmaic || !state.dmaic.define) state.dmaic = dmaicDefaults;

      // Meetings (MEETING_TRACKING_SPEC): completed history + live session.
      if (!state.meetings) state.meetings = [];
      if (state.activeMeeting === undefined) state.activeMeeting = null;
      if (state.nmeetid === undefined) state.nmeetid = 1;
      if (state.nspid === undefined) state.nspid = 1;
      return state;
    },
    5: function(state) {
      // V4 -> V5: Monolith V3.3 dashboard panels (Lead-Time Tracker, Float
      // Watch, Weather Variance, Crash Candidates, Schedule Confidence) +
      // Critical Path Highlighter + Daily Field snapshot. Every field the new
      // renderers read gets a back-fill so old saved projects load cleanly.
      if (!state.wxWindow) state.wxWindow = { start: '', end: '', bufferDays: 0 };
      if (state.wxWindow.bufferDays === undefined) state.wxWindow.bufferDays = 0;
      if (state.kbShowLeadtime === undefined) state.kbShowLeadtime = false;
      if (state.hlCritical === undefined) state.hlCritical = false;
      if (state.dailySnapshot === undefined) state.dailySnapshot = null;
      if (state.focusMode === undefined) state.focusMode = false;
      if (state.lastBackedUpAt === undefined) state.lastBackedUpAt = null;
      (state.tasks || []).forEach(t => {
        if (t.submittedDate === undefined) t.submittedDate = '';
        if (t.expectedDate === undefined) t.expectedDate = '';
        if (t.floatBaseline === undefined) t.floatBaseline = null;
        if (t.weatherExposed === undefined) t.weatherExposed = false;
      });
      return state;
    },
    6: function(state) {
      // V5 -> V6: ACTION-PLAN 1.2 meeting-to-action closed loop , promises
      // carried from one meeting of a kind into the next meeting of the same
      // kind. Keyed by meeting kind (kickoff/weekly/risk/...).
      if (!state.meetingPromises) state.meetingPromises = {};
      return state;
    },
    7: function(state) {
      // V6 -> V7: ACTION-PLAN 2 cross-linking fields.
      // 2.1 risk-to-task link + 2.5 risk cost-impact estimate (expected value
      // feeds the Budget contingency comparison).
      (state.risks || []).forEach(r => {
        if (r.linkedTaskId === undefined) r.linkedTaskId = null;
        if (r.costImpactEstimate === undefined) r.costImpactEstimate = 0;
      });
      // 2.5 budget lines can be flagged as contingency (compared against
      // the summed expected value of risks).
      (state.budgetLines || []).forEach(b => {
        if (b.isContingency === undefined) b.isContingency = false;
      });
      return state;
    },
    8: function(state) {
      // V7 -> V8: ACTION-PLAN 3.3 quiet consistency streak.
      if (!state.streak || typeof state.streak !== 'object') {
        state.streak = { count: 0, lastDate: null };
      } else {
        if (state.streak.count === undefined) state.streak.count = 0;
        if (state.streak.lastDate === undefined) state.streak.lastDate = null;
      }
      return state;
    },
    9: function(state) {
      // V8 -> V9: ACTION-PLAN 7 weather forecast + delay log fields.
      if (state.siteLat === undefined) state.siteLat = null;
      if (state.siteLon === undefined) state.siteLon = null;
      if (state.sitePlace === undefined) state.sitePlace = '';
      if (state.wxCache === undefined) state.wxCache = null;
      if (!state.weatherLog) state.weatherLog = [];
      if (state.ldRate === undefined) state.ldRate = 0;
      return state;
    },
    10: function(state) {
      // V9 -> V10: ACTION-PLAN 3.2 sentiment pulse history + 7.3 manual
      // per-task weather float + item 23 rolling lead-time review stamps.
      // All additive back-fills , old saved projects load cleanly.
      if (!state.sentimentHistory) state.sentimentHistory = [];
      if (state.wxViewDays === undefined) state.wxViewDays = 7;
      (state.tasks || []).forEach(t => {
        // 7.3: extra buffer days a PM explicitly assigns to THIS task
        // (distributed weather float, added on top of the auto regional pad).
        if (t.wxFloatPad === undefined) t.wxFloatPad = 0;
        // 23: last time this lead-time item's rolling forecast was reviewed.
        if (t.leadtimeUpdatedAt === undefined) t.leadtimeUpdatedAt = null;
      });
      return state;
    },
    11: function(state) {
      // V10 -> V11: Phase 2/3 hardening , client feature flags, client-side
      // error surface, reserved config object, and a charter KPI back-fill
      // (older seeds stored no kpis array; renderers already guarded with
      // `|| []`, this just normalizes the shape). All additive.
      if (!state.flags || typeof state.flags !== 'object' || Array.isArray(state.flags)) {
        state.flags = {};
      }
      // MERGED-AI-CONTROL (audit 1.2): aiWindow is dropped from the backfill , 
      // the AI assistant now follows state.config.ai.tier, not a flag.
      ['monteCarlo', 'ganttExport', 'leadtimeLane', 'weatherForecast'].forEach(k => {
        if (state.flags[k] === undefined) state.flags[k] = true;
      });
      if (!Array.isArray(state.errorLog)) state.errorLog = [];
      if (!state.config || typeof state.config !== 'object' || Array.isArray(state.config)) state.config = {};
      if (state.charter && !Array.isArray(state.charter.kpis)) state.charter.kpis = [];
      return state;
    },
    12: function(state) {
      // V11 -> V12: MASTER-ACTION-PLAN-v3-STRICT Rank 1.2 , schedule slips
      // (baseline-vs-actual delta as a first-class object) + user cause-tag
      // overrides. Additive back-fill: old saved projects get empty arrays.
      if (!Array.isArray(state.scheduleSlips)) state.scheduleSlips = [];
      if (!state.slipCauses || typeof state.slipCauses !== 'object' || Array.isArray(state.slipCauses)) {
        state.slipCauses = {};
      }
      return state;
    },
    13: function(state) {
      // V12 -> V13: MASTER-ACTION-PLAN-v3-STRICT Rank 2.1 , digest reference
      // point. Additive: old projects simply have no snapshot yet, and the
      // digest falls back to the baseline until the user pins one.
      if (state.digestSnapshot === undefined) state.digestSnapshot = null;
      return state;
    },
    14: function(state) {
      // V13 -> V14: PLAN-OF-ACTION-AI-VOICE-SYNC-v1 Rank 1.5 , meeting
      // voice capture fields. Transcript text lives on the meeting record
      // (unified state, portable in the .json export); capture state/method
      // are the visible recording indicators. Audio chunks never touch this
      // path (IndexedDB only , see mmgr-voice.js). All additive back-fills.
      const vf = function(m) {
        if (!m) return;
        if (m.transcript === undefined) m.transcript = '';
        if (m.captureState === undefined) m.captureState = null;
        if (m.captureMethod === undefined) m.captureMethod = null;
        if (m.captureSession === undefined) m.captureSession = null;
      };
      vf(state.activeMeeting);
      (state.meetings || []).forEach(vf);
      return state;
    },
    15: function(state) {
      // V14 -> V15: PLAN-OF-ACTION-AI-VOICE-SYNC-v1 Rank 2.3 , agent-style
      // preset outputs. Additive: old projects simply have no outputs yet.
      if (!state.aiOutputs || typeof state.aiOutputs !== 'object' || Array.isArray(state.aiOutputs)) {
        state.aiOutputs = {};
      }
      return state;
    },
    16: function(state) {
      // V15 -> V16: MASTER-ACTION-PLAN-v3-STRICT Rank 3.1 , Core Mode vs
      // Advanced Packs. EXISTING saved projects migrate with ALL packs ON so
      // the surface they already use never disappears mid-project; brand-new
      // projects (getDefaultState) start Core-only. Additive back-fill.
      if (!state.packs || typeof state.packs !== 'object' || Array.isArray(state.packs)) {
        state.packs = {};
      }
      ['schedule', 'money', 'governance', 'field', 'quality'].forEach(function(k) {
        if (state.packs[k] === undefined) state.packs[k] = true;
      });
      return state;
    },
    17: function(state) {
      // V16 -> V17: PLAN-OF-ACTION-AI-VOICE-SYNC-v1 Rank 4.4 , per-field
      // timestamps. Additive back-fill: no map yet, the first save stamps it.
      if (!state.fieldTs || typeof state.fieldTs !== 'object' || Array.isArray(state.fieldTs)) {
        state.fieldTs = {};
      }
      return state;
    },
    18: function(state) {
      // V17 -> V18: PROJECT-UX-NAV-WEATHER-EXPORT-DIRECTIVE DIR-3 , Core-Mode
      // onboarding callout memory. Additive back-fill: pre-v16 saved projects
      // already migrated with all packs ON, so the callout stays hidden for
      // them; brand-new projects start at false and show the nudge once.
      if (state.packsCalloutDismissed === undefined) state.packsCalloutDismissed = false;
      if (state.packsEverEnabled === undefined) state.packsEverEnabled = false;
      return state;
    },
    19: function(state) {
      // V18 -> V19: ensure risks and issues arrays exist (seed-test fixture
      // and very old saved projects may lack them, triggering validation
      // warnings on every boot).
      if (!state.risks || !Array.isArray(state.risks)) state.risks = [];
      if (!state.issues || !Array.isArray(state.issues)) state.issues = [];
      return state;
    }
  };

  function migrate(state) {
    const v = state.schemaVersion || 0;
    if (v === SCHEMA_VERSION) return state;
    // Apply migrations sequentially
    const sortedMigrations = Object.keys(migrations).map(Number).sort((a,b) => a-b);
    for (const mv of sortedMigrations) {
      if (v < mv) {
        try {
          state = migrations[mv](state);
          state.schemaVersion = mv;
        } catch(e) {
          console.warn(`Migration ${mv} failed:`, e);
        }
      }
    }
    state.schemaVersion = SCHEMA_VERSION;
    return state;
  }

  // ---- State Container ----
  let _state = null;
  let _saveTimer = null;
  let _changeListeners = [];
  let _dirty = false;

  // ---- Undo / Redo command stack ----
  // Snapshot-based: each destructive operation (cascade, bulk import,
  // clear-all, baseline restore, external adopt) captures the full state
  // BEFORE it mutates, so undo can restore the exact previous plan.
  const UNDO_LIMIT = 20;
  let _undoStack = [];
  let _redoStack = [];

  function cloneState() {
    return JSON.parse(JSON.stringify(_state));
  }

  // Capture the current state as an undo point. Call BEFORE the destructive
  // write happens (i.e. while _state still holds the pre-change plan).
  function pushUndo() {
    if (!_state) return;
    _undoStack.push(cloneState());
    if (_undoStack.length > UNDO_LIMIT) _undoStack.shift();
    // Any new edit invalidates the redo branch
    _redoStack = [];
  }

  function undo() {
    if (!_undoStack.length) return false;
    _redoStack.push(cloneState());
    _state = _undoStack.pop();
    _dirty = false;
    save(true);
    _changeListeners.forEach(fn => fn('undo'));
    return true;
  }

  function redo() {
    if (!_redoStack.length) return false;
    _undoStack.push(cloneState());
    _state = _redoStack.pop();
    _dirty = false;
    save(true);
    _changeListeners.forEach(fn => fn('redo'));
    return true;
  }

  function canUndo() { return _undoStack.length > 0; }
  function canRedo() { return _redoStack.length > 0; }
  function undoDepth() { return _undoStack.length; }
  function redoDepth() { return _redoStack.length; }

  function getProjectKey() {
    return STORAGE_KEY + '_' + (ns.projectId || 'default');
  }

  // Adopt an externally supplied state (multi-tab "keep theirs" / import).
  // Re-migrates, replaces the in-memory state, and persists immediately.
  function adoptExternal(parsedState) {
    try {
      // Same secret strip as importState , an adopted blob (multi-tab
      // "keep theirs", storage-event handoff) must not carry a key into
      // this device's live state either.
      stripSecrets(parsedState);
      _state = migrate(parsedState);
      _dirty = false;
      markAllDirty();
      save(true);
      _changeListeners.forEach(fn => fn('adopt'));
      return true;
    } catch(e) {
      console.warn('State adopt failed:', e);
      return false;
    }
  }

  // ---- Rank 4.4: field-level last-write-wins merge ----
  // Merges an externally supplied state (another device, a teammate's
  // export) into the current state at FIELD granularity instead of the
  // all-or-nothing replace adoptExternal performs. Each tracked top-level
  // field keeps whichever side has the NEWER per-field timestamp
  // (state.fieldTs, written by stampFieldTs on every save); timestamps that
  // are missing defer to updatedAt, then to the LOCAL value , a tie never
  // loses local data. Returns a report of decisions (or null on invalid
  // input) so the caller can surface a human-readable summary.
  //
  // NOTE on exclusions: flags and config (including the AI provider key) are
  // deliberately NOT in FIELD_KEYS , those are per-device preferences that
  // must never leak across a merge. Do not "fix" that.
  function mergeExternal(parsedState) {
    const report = [];
    try {
      const incoming = migrate(parsedState);
      if (!incoming || typeof incoming !== 'object') return null;
      // Snapshot before mutating so a merge is undoable, like every other
      // destructive op (adopt, cascade, clear-all, baseline restore). Only
      // pushed once, at the first actual adoption , a pure no-op merge
      // (nothing adopted) doesn't waste an undo slot.
      let undoPushed = false;
      const localTs = (_state.fieldTs && typeof _state.fieldTs === 'object') ? _state.fieldTs : {};
      const incTs = (incoming.fieldTs && typeof incoming.fieldTs === 'object') ? incoming.fieldTs : {};
      const localTime = _state.updatedAt || '';
      const incTime = incoming.updatedAt || '';
      let adopted = 0;
      FIELD_KEYS.forEach(function(k) {
        const hasLocal = _state[k] !== undefined;
        const hasInc = incoming[k] !== undefined;
        if (!hasInc) return; // incoming lacks the field -> keep local
        const lt = localTs[k] || localTime;
        const it = incTs[k] || incTime;
        if (!hasLocal || (it > lt)) {
          if (!undoPushed) { pushUndo(); undoPushed = true; }
          _state[k] = incoming[k];
          if (_state.fieldTs) _state.fieldTs[k] = it;
          adopted++;
          report.push({ field: k, side: 'incoming', reason: hasLocal ? 'newer-timestamp' : 'missing-locally' });
        } else {
          report.push({ field: k, side: 'local', reason: 'local-equal-or-newer' });
        }
      });
      if (adopted > 0) {
        _state.updatedAt = new Date().toISOString();
        // CRITICAL: align the save-fingerprint with the POST-merge state so
        // the save's stampFieldTs pass sees no diff. Otherwise every adopted
        // field is re-stamped with the merge time, inflating its timestamp
        // and silently rejecting a genuinely-newer edit in the NEXT round
        // trip (device B edits 10:30, device A merged at 12:00 -> B's newer
        // edit loses to A's inflated 12:00 stamp). Keep the incoming stamp.
        // Rebuild the per-field cache to match the POST-merge state so
        // stampFieldTs sees no diff on the next save.
        _fieldJsonCache = null;
        _dirty = false;
        markAllDirty();
        save(true);
        _changeListeners.forEach(fn => fn('merge'));
      }
      return { report: report, adopted: adopted, total: report.length };
    } catch(e) {
      console.warn('State merge failed:', e);
      return null;
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(getProjectKey());
      if (raw) {
        const parsed = JSON.parse(raw);
        _state = migrate(parsed);
      } else {
        _state = getDefaultState();
      }
    } catch(e) {
      console.warn('State load failed, using defaults:', e);
      _state = getDefaultState();
    }
    _dirty = false;
    // Reset the per-field cache so the first save stamps everything.
    _fieldJsonCache = null;
    _dirtyFields = null;
    return _state;
  }

  // ---- Rank 4.4: per-field write timestamps ----
  // Top-level fields whose JSON changed since the LAST save get stamped with
  // the current updatedAt (plus nested charter keys , those are edited as
  // subfields). The merge module (MMGR.Merge) reads these to decide
  // last-write-wins per field instead of replacing the whole document.
  const FIELD_KEYS = ['projectName', 'methodology', 'workWeek', 'theme', 'crosshairOn', 'userName', 'charter', 'tasks', 'meetings', 'meetingPromises', 'activeMeeting', 'resources', 'budgetLines', 'budgetEnvelope', 'spendLog', 'stakeholders', 'risks', 'issues', 'changes', 'logEntries', 'commsEntries', 'documents', 'closure', 'raci', 'sprint', 'dailySnapshots', 'dmaic', 'baseline', 'weatherRegion', 'siteLat', 'siteLon', 'sitePlace', 'wxCache', 'weatherLog', 'ldRate', 'wxViewDays', 'wxWindow', 'kbShowLeadtime', 'hlCritical', 'dailySnapshot', 'focusMode', 'streak', 'sentimentHistory', 'scheduleSlips', 'slipCauses', 'digestSnapshot', 'aiOutputs', 'packs', 'packsCalloutDismissed', 'packsEverEnabled',
    // MARKET-FEATURE-ROADMAP Section C registries (C1/C2/C3 shipped in
    // batch 1 , these were missing from the whitelist, so their per-field
    // timestamps were never stamped and cloud-merge conflict resolution
    // could silently drop an editor's RFI/Submittal/Punch edits; C13/C16/
    // C17/C18/C26/C30/C11 registries ship in batch 2).
    'rfis', 'submittals', 'punchList', 'payApps', 'inspections', 'incidents',
    'handover', 'warrantyItems', 'permits', 'drawingLog',
    // MARKET-FEATURE-ROADMAP A3/A4 (T8 REBUILD 2026-08-16): bid packages +
    // Go/No-Go scorecards were missing from the whitelist, so their per-field
    // timestamps were never stamped and cloud-merge conflict resolution could
    // silently drop a teammate's bid leveling edits.
    'bidPackages', 'goNoGo'];
  let _fieldJsonCache = null; // { fieldName: jsonString } — cached per-field serialization.
  // Dirty-field tracking: updateState() marks fields whose top-level reference
  // changed; stampFieldTs() only re-serializes dirty fields instead of all 60+.
  let _dirtyFields = null; // null = all fields dirty (first save / full replace)

  function markAllDirty() { _dirtyFields = null; }

  // Stamp fieldTs for every tracked key whose serialized value changed since
  // the previous save (or all keys on the first save). Called once per save.
  function stampFieldTs(nowIso) {
    if (!_state) return;
    if (!_state.fieldTs || typeof _state.fieldTs !== 'object') _state.fieldTs = {};
    if (_fieldJsonCache === null) {
      // First save in this session: stamp everything once so old state has a
      // complete map; build the per-field cache for subsequent saves.
      _fieldJsonCache = {};
      FIELD_KEYS.forEach(function(k) {
        if (_state[k] !== undefined) {
          _state.fieldTs[k] = nowIso;
          _fieldJsonCache[k] = JSON.stringify(_state[k]);
        }
      });
      _dirtyFields = new Set();
      return;
    }
    // Only check dirty fields (or all fields on full-replace mutations).
    const keysToCheck = (_dirtyFields === null) ? FIELD_KEYS : Array.from(_dirtyFields);
    _dirtyFields = new Set();
    keysToCheck.forEach(function(k) {
      if (_state[k] === undefined) {
        if (_fieldJsonCache[k] !== undefined) {
          _state.fieldTs[k] = nowIso;
          delete _fieldJsonCache[k];
        }
        return;
      }
      const cur = JSON.stringify(_state[k]);
      if (cur !== _fieldJsonCache[k]) {
        _state.fieldTs[k] = nowIso;
      }
      _fieldJsonCache[k] = cur;
    });
  }

  function save(immediate, opts) {
    if (!_state) return;
    _state.updatedAt = new Date().toISOString();
    // Rank 4.4: stamp per-field timestamps BEFORE persisting so the saved
    // blob carries the same map the merge will read.
    stampFieldTs(_state.updatedAt);
    // File-backup watermark: stamping updatedAt and lastBackedUpAt with the
    // SAME timestamp keeps the dirty-indicator comparison exact (a backup is
    // only "clean" while no edit has landed after it).
    if (opts && opts.backup) _state.lastBackedUpAt = _state.updatedAt;
    _dirty = true;
    // Rank 4.2: mirror into the IndexedDB journal on every save (immediate
    // and debounced) , async fire-and-forget, never blocks or throws.
    journalPut(_state);
    if (immediate) {
      try {
        localStorage.setItem(getProjectKey(), JSON.stringify(_state));
        _dirty = false;
      } catch(e) {
        console.warn('State save failed:', e);
      }
      return;
    }
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(getProjectKey(), JSON.stringify(_state));
        _dirty = false;
        _changeListeners.forEach(fn => fn('save'));
      } catch(e) {
        console.warn('State save failed:', e);
      }
    }, 300);
  }

  // ---- Rank 4.2: persistent write-ahead journal (IndexedDB) ----
  // MASTER-ACTION-PLAN Rank 4.2: the debounced localStorage save + unload
  // flush cover CLEAN close; a hard process kill (task-manager kill, OS
  // crash, battery pull) never fires beforeunload, so the last 300ms of
  // edits could die with it. The journal mirrors every save into IndexedDB
  // (async, fire-and-forget, never throws). On boot the newest record wins:
  // if the journal holds a newer updatedAt than localStorage, the state is
  // restored from the journal , the crash case loses at most the in-flight
  // keystroke, never the last completed save. Audio chunks deliberately
  // stay out of this path (IndexedDB-only, see mmgr-voice.js); this journal
  // holds PROJECT STATE JSON only.
  const JDB = 'mmgr_journal';
  const JSTORE = 'states';
  // Journal records are keyed by the SAME project key as localStorage
  // (mmgr_state_<projectId>) so two projects never share a journal slot.
  function jkey() { return getProjectKey(); }

  function jdb() {
    return new Promise(function(resolve) {
      try {
        if (typeof indexedDB === 'undefined') { resolve(null); return; }
        const req = indexedDB.open(JDB, 1);
        req.onupgradeneeded = function() {
          const db = req.result;
          if (!db.objectStoreNames.contains(JSTORE)) db.createObjectStore(JSTORE);
        };
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }

  // Fire-and-forget mirror of the full state JSON into the journal. Never
  // throws , the journal is a durability net, not a dependency.
  function journalPut(state) {
    jdb().then(function(db) {
      if (!db) return;
      try {
        const tx = db.transaction(JSTORE, 'readwrite');
        tx.objectStore(JSTORE).put({ ts: state.updatedAt, json: JSON.stringify(state) }, jkey());
      } catch (e) { /* ignore */ }
    });
  }

  // Returns the journal record (or null) for the current project.
  function journalGet() {
    return new Promise(function(resolve) {
      jdb().then(function(db) {
        if (!db) { resolve(null); return; }
        try {
          const tx = db.transaction(JSTORE, 'readonly');
          const req = tx.objectStore(JSTORE).get(jkey());
          req.onsuccess = function() { resolve(req.result || null); };
          req.onerror = function() { resolve(null); };
        } catch (e) { resolve(null); }
      });
    });
  }

  // ---- Unload-safety flush (Phase 0 gate, MASTER-ACTION-PLAN-v3-STRICT) ----
  // A debounced save() can be lost when the tab dies mid-edit: the 300ms
  // timer never fires. This synchronous write runs on beforeunload /
  // pagehide / visibilitychange(hidden) and guarantees the last edit lands
  // in localStorage. It NEVER sets returnValue / preventDefault , the fix is
  // a silent flush, not a "leave site?" nag (no notification spam rule).
  function flushSave() {
    if (!_state || !_dirty) return;
    try {
      // NOTE: do NOT re-stamp updatedAt here. updateState/save already stamp
      // it at mutation time, so the pending state carries a fresh timestamp.
      // Re-stamping on every visibilitychange(hidden) would fire storage
      // events in other open tabs with a newer updatedAt and pop the
      // multi-tab conflict modal on a mere tab switch.
      localStorage.setItem(getProjectKey(), JSON.stringify(_state));
      _dirty = false;
    } catch (e) {
      console.warn('State flush on unload failed:', e);
    }
  }

  // Rank 4.2: on boot, check the journal for a state at least as new as
  // localStorage and adopt it (crash recovery). Async, best-effort , the app
  // already rendered with the localStorage copy; if the journal wins we swap
  // and re-render. Never throws.
  // Semantics: when localStorage has a record for this project, the journal
  // only wins on a STRICTLY newer updatedAt (normal case: journal == LS, no
  // swap). When localStorage has NO record (hard-kill wiped it, or a fresh
  // boot with a leftover journal), the journal record for this project key
  // restores the last completed save , this is exactly the crash case.
  function restoreFromJournal() {
    return journalGet().then(function(rec) {
      if (!rec || !rec.json || !_state) return false;
      try {
        const parsed = JSON.parse(rec.json);
        let lsRec = null;
        try {
          const raw = localStorage.getItem(getProjectKey());
          if (raw) lsRec = JSON.parse(raw);
        } catch (e) { lsRec = null; }
        if (lsRec) {
          // Both exist: journal wins only when strictly newer.
          if (!(parsed.updatedAt && parsed.updatedAt > (lsRec.updatedAt || ''))) return false;
        }
        // Either no localStorage record (crash case) or journal is newer.
        _state = migrate(parsed);
        _dirty = false;
        markAllDirty();
        save(true);
        _changeListeners.forEach(fn => fn('journal-restore'));
        return true;
      } catch (e) { /* ignore corrupt journal */ }
      return false;
    }).catch(function() { return false; });
  }

  function getState() {
    if (!_state) load();
    return _state;
  }

  // ACTION-PLAN 3.3: quiet consistency streak , a calendar day counts toward
  // the streak when at least one updateState lands on it. Informational only
  // (non-guilt): no toasts, no gating, no badges on the critical path.
  // Simulated-client note: pure localStorage, no server round-trip needed.
  function _touchStreak(s) {
    try {
      if (!s.streak) s.streak = { count: 0, lastDate: null };
      const today = new Date().toISOString().slice(0, 10); // UTC calendar day
      if (s.streak.lastDate === today) return; // already counted today
      const last = s.streak.lastDate ? new Date(s.streak.lastDate + 'T00:00:00Z') : null;
      const todayD = new Date(today + 'T00:00:00Z');
      const gap = last ? Math.round((todayD - last) / 86400000) : 999;
      s.streak.count = gap === 1 ? (s.streak.count || 0) + 1 : 1;
      s.streak.lastDate = today;
    } catch (e) { /* never throw from a cosmetic counter */ }
  }

  function updateState(updater) {
    const s = getState();
    // Snapshot top-level references BEFORE the updater to detect dirty fields.
    const refs = {};
    FIELD_KEYS.forEach(function(k) { refs[k] = s[k]; });
    updater(s);
    _touchStreak(s);
    _dirty = true;
    // Mark fields whose top-level reference changed as dirty.
    if (_dirtyFields === null) {
      // Full-replace pending (e.g. adopt/merge); keep it dirty.
    } else {
      if (!_dirtyFields || !(_dirtyFields instanceof Set)) _dirtyFields = new Set();
      FIELD_KEYS.forEach(function(k) { if (s[k] !== refs[k]) _dirtyFields.add(k); });
    }
    save();
    _changeListeners.forEach(fn => fn('update'));
  }

  function isDirty() { return _dirty; }

  function onChange(fn) {
    _changeListeners.push(fn);
    return function() {
      _changeListeners = _changeListeners.filter(f => f !== fn);
    };
  }

  // AI-CLOUD-CONNECT-UI (DIR-2): provider secrets are stripped from the
  // OUTGOING portable .json and never re-adopted on import/adopt. The BYO AI
  // key lives only in the session vault (js/mmgr-ai-key.js); this strip is
  // the load-bearing guarantee that a stale/legacy apiKey , e.g. one riding
  // in an old pre-session-vault export , can never leak through the app's
  // own designed "portable data, single .json export" path. Works on a
  // passed object; the caller decides whether it's a deep clone (export) or
  // a freshly parsed incoming blob (import/adopt). Never mutates live state.
  const SECRET_KEYS = ['apiKey'];

  function stripSecrets(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const cfg = obj.config;
    if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
      // state.config.ai , the AI provider block (apiKey is the only secret;
      // tier/provider/endpoint/model are benign prefs).
      if (cfg.ai && typeof cfg.ai === 'object' && !Array.isArray(cfg.ai)) {
        SECRET_KEYS.forEach(function(k) { delete cfg.ai[k]; });
      }
      // Config.api.keys , the reserved future provider/backup key object
      // (e.g. an eventual Google OAuth token / Cloudflare sync token per the
      // still-open Config.api.keys redesign). If present, never ship it.
      if (cfg.api && typeof cfg.api === 'object' && !Array.isArray(cfg.api) && cfg.api.keys && typeof cfg.api.keys === 'object') {
        delete cfg.api.keys;
      }
    }
    return obj;
  }

  function exportState() {
    // Deep-clone, strip secrets from the CLONE only, serialize. The live
    // in-memory state is never mutated as a side effect of exporting it.
    const out = JSON.parse(JSON.stringify(getState()));
    return JSON.stringify(stripSecrets(out), null, 2);
  }

  function importState(jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      // Strip any secret an old/incoming file may carry (post-fix exports
      // never include them, but a legacy file can). The session vault is the
      // only home for keys now , an import must never re-seed state with one.
      stripSecrets(parsed);
      const migrated = migrate(parsed);
      _state = migrated;
      markAllDirty();
      save(true);
      _changeListeners.forEach(fn => fn('import'));
      return true;
    } catch(e) {
      console.warn('State import failed:', e);
      return false;
    }
  }

  function clearProject() {
    try {
      localStorage.removeItem(getProjectKey());
    } catch(e) {}
    _state = getDefaultState();
    _dirty = false;
    markAllDirty();
    _changeListeners.forEach(fn => fn('clear'));
  }

  function saveBaseline() {
    const s = getState();
    s.baseline = JSON.parse(JSON.stringify({
      tasks: s.tasks,
      budgetLines: s.budgetLines,
      budgetEnvelope: s.budgetEnvelope,
      capturedAt: new Date().toISOString()
    }));
    // baseline is a top-level field; mark it dirty since we bypassed updateState.
    if (_dirtyFields instanceof Set) _dirtyFields.add('baseline');
    save(true);
  }

  // ---- Schema Validation ----
  function validate() {
    const s = getState();
    const issues = [];
    if (!s.tasks || !Array.isArray(s.tasks)) issues.push('Missing tasks array');
    if (!s.risks || !Array.isArray(s.risks)) issues.push('Missing risks array');
    if (s.schemaVersion !== SCHEMA_VERSION) issues.push(`Schema version ${s.schemaVersion} != expected ${SCHEMA_VERSION}`);
    // Check for circular references in predecessors
    try {
      const visited = new Set();
      function checkCycle(taskId, path) {
        if (path.has(taskId)) return true;
        path.add(taskId);
        const task = s.tasks.find(t => t.id === taskId);
        if (task && task.predecessors) {
          for (const pred of task.predecessors) {
            if (checkCycle(pred, new Set(path))) return true;
          }
        }
        path.delete(taskId);
        return false;
      }
      for (const task of s.tasks) {
        if (checkCycle(task.id, new Set())) {
          issues.push(`Circular predecessor chain detected involving task ${task.id}`);
          break;
        }
      }
    } catch(e) {}
    return issues;
  }

  // ---- API ----
  ns.State = {
    load: load,
    save: save,
    getState: getState,
    updateState: updateState,
    isDirty: isDirty,
    onChange: onChange,
    exportState: exportState,
    importState: importState,
    clearProject: clearProject,
    saveBaseline: saveBaseline,
    validate: validate,
    getDefaultState: getDefaultState,
    getProjectKey: getProjectKey,
    pushUndo: pushUndo,
    undo: undo,
    redo: redo,
    canUndo: canUndo,
    canRedo: canRedo,
    undoDepth: undoDepth,
    redoDepth: redoDepth,
    adoptExternal: adoptExternal,
    mergeExternal: mergeExternal,
    flushSave: flushSave,
    restoreFromJournal: restoreFromJournal,
    journalPut: journalPut,
    journalGet: journalGet,
    SCHEMA_VERSION: SCHEMA_VERSION
  };

  // Register the unload flush once at load time. Guarded so the module also
  // loads safely in non-browser harnesses (jsdom/node QA runs) that define
  // window/document but have no real unload lifecycle.
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeunload', flushSave);
    window.addEventListener('pagehide', flushSave);
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') flushSave();
    });
  }
})(MMGR);
window.MMGR = MMGR;