/* ============================================================
   MCP MODEL — the single source of truth for what an MCP client
   may read and write, and what a new record looks like.
   ============================================================
   MCP-AGENT-FIRST 2026-11-12 2.1: before this module the create
   defaults lived in server.js (CREATE_DEFAULTS) and had drifted
   from the app: an MCP-created task was missing createdDate,
   boardPosition, relations and custom, a risk was keyed on `name`
   while the app stores `description`, and a document was missing
   its whole register shape. Validation was spread across the diff,
   create and set loops, so `validate_changes` could not exist
   without a second copy of every rule.

   Every table below is DERIVED FROM THE CLIENT, not from guesses:
     tasks        js/mmgr-tasks.js createTask()
     resources    js/mmgr-resources.js addResource()
     risks        js/mmgr-risks.js addRisk()
     issues       js/mmgr-risks.js toggleRiskIssue()
     logEntries   js/mmgr-stakeholders.js addLog()
     meetings     js/mmgr-meetings.js startMeeting()
     stakeholders js/mmgr-stakeholders.js addStake()
     documents    js/mmgr-closure.js addDoc()
     changes      js/mmgr-stakeholders.js addChange()
     commsEntries js/mmgr-closure.js addComms()
     budgetLines  js/mmgr-resources.js addBudgetLine()
     spendLog     js/mmgr-resources.js addSpendEntry()

   test/mcp-model.test.mjs loads those modules in a vm sandbox, calls
   the real creators, and fails if a field set or an enum drifts.

   Each field records:
     type     string | number | boolean | array | object | null
     max      max length for strings (default STRING_MAX)
     enum     allowed values, or null when the client has no enum
     required the creator cannot produce the record without it
     derived  written by the app (schedule, stamps, rollups) - never
              writable through MCP
     alias    an input name that maps to this stored field
     date     a calendar date YYYY-MM-DD
     default  present only when the client creator writes a value
   ============================================================ */

// A generous ceiling for prose fields. The directive names 4000 as the
// default; shorter fields carry an explicit max.
export const STRING_MAX = 4000;
export const SHORT_MAX = 200;
export const ID_MAX = 80;

// Mirrors js/mmgr-kanban.js COLUMNS. The test asserts equality against the
// live client constant, so a new board column cannot silently skip the model.
export const TASK_STATUSES = ['todo', 'inprogress', 'blocked', 'completed'];

// Mirrors js/mmgr-process.js ISSUE_STATUSES / CHANGE_STATUSES.
export const ISSUE_STATUSES = ['open', 'resolved', 'closed'];
export const CHANGE_STATUSES = ['submitted', 'review', 'approved', 'rejected', 'cancelled'];

// Mirrors the client's Low/Medium/High selects (risks, stakeholders).
export const SCALE_3 = ['Low', 'Medium', 'High'];

// Mirrors the confidence values in js/mmgr-state.js and the schedule engine.
export const CONFIDENCE = ['high', 'medium', 'low'];

// Mirrors the resources type select in js/render/resources.js.
export const RESOURCE_TYPES = ['Labor', 'Equipment', 'Material', 'Subcontractor'];

// Mirrors the document type/status selects in js/render/documents.js.
export const DOCUMENT_TYPES = ['Drawing', 'Contract', 'Permit', 'Specification', 'Report', 'Other'];
export const DOCUMENT_STATUSES = ['current', 'pending-review', 'superseded', 'outstanding'];

// Mirrors the comms type select in js/render/people.js.
export const COMMS_TYPES = ['Meeting', 'Call', 'Email', 'Site Visit', 'Letter'];

// Mirrors the methodology values in js/mmgr-state.js.
export const METHODOLOGIES = ['waterfall', 'agile', 'hybrid'];

// Lists the accept engine may delete from (directive 3.4). Money tables are
// excluded: a line is retired through the budget proposal path, and a
// delivery is never deleted by an agent.
export const DELETABLE_LISTS = [
  'tasks',
  'resources',
  'risks',
  'issues',
  'logEntries',
  'meetings',
  'stakeholders',
  'documents',
  'changes',
  'commsEntries'
];

// Field spec helper. `default` is stored ONLY when the caller passes it, so
// "the client creator does not write this field" stays distinguishable from
// "the client creator writes an empty value".
function field(type, opts) {
  const o = opts || {};
  const spec = {
    type: type,
    max: o.max !== undefined ? o.max : type === 'string' ? STRING_MAX : null,
    enum: o.enum || null,
    required: !!o.required,
    derived: !!o.derived,
    alias: o.alias || null,
    date: !!o.date
  };
  if (Object.prototype.hasOwnProperty.call(o, 'default')) {
    spec.default = o.default;
  }
  if (o.derivedWhen) {
    spec.derivedWhen = o.derivedWhen;
  }
  if (o.nested) {
    spec.nested = o.nested;
  }
  return spec;
}

// A phase's dates are rolled up from its children (Schedule.rollupPhases),
// so they are derived only while isPhase is true.
function phaseDate(defaultValue) {
  return field('string', { date: true, default: defaultValue, derivedWhen: 'isPhase' });
}

export const MODEL = {
  lists: {
    tasks: {
      section: 'wbs',
      label: 'Tasks',
      titleField: 'name',
      deletable: true,
      fields: {
        id: field('string', { max: ID_MAX, derived: true, default: null }),
        name: field('string', { max: SHORT_MAX, default: 'New Task' }),
        level: field('number', { default: 0 }),
        indent: field('number', { default: 0 }),
        isPhase: field('boolean', { default: false }),
        status: field('string', { enum: TASK_STATUSES, default: 'todo' }),
        startDate: phaseDate(''),
        endDate: phaseDate(''),
        duration: field('string', { max: 20, default: '' }),
        assignee: field('string', { max: SHORT_MAX, default: '' }),
        // Schedule engine writes: js/mmgr-schedule.js markCritical / applyPlan.
        critical: field('boolean', { derived: true, default: false }),
        leadTime: field('boolean', { default: false }),
        recurring: field('boolean', { default: false }),
        // js/mmgr-schedule.js checkWeatherExposure / applyPlan.
        weatherExposed: field('boolean', { derived: true, default: false }),
        confidence: field('string', { enum: CONFIDENCE, default: 'high' }),
        predecessors: field('array', { of: 'string', default: [] }),
        notes: field('string', { default: '' }),
        weatherSensitive: field('boolean', { default: false }),
        // createTask stamps the creation date, the board slot and the
        // status stamp; the app then owns them.
        createdDate: field('string', { date: true, derived: true, default: '' }),
        boardPosition: field('number', { derived: true, default: 0 }),
        relations: field('array', { of: 'object', default: [] }),
        custom: field('object', { default: {} }),
        // js/mmgr-kanban.js stampStatus.
        statusSince: field('string', { date: true, derived: true, default: '' }),
        startedDate: field('string', { date: true, derived: true }),
        completedDate: field('string', { date: true, derived: true }),
        // js/mmgr-schedule.js markCritical / applyPlan.
        totalFloat: field('number', { derived: true }),
        freeFloat: field('number', { derived: true }),
        floatBaseline: field('number', { derived: true }),
        _schedPad: field('number', { derived: true }),
        // Present after the v4 state migration; not written by createTask.
        milestone: field('boolean'),
        confidenceLevel: field('string', { enum: CONFIDENCE }),
        parentName: field('string', { max: SHORT_MAX }),
        cycleId: field('string', { max: ID_MAX }),
        moduleId: field('string', { max: ID_MAX }),
        // js/mmgr-tasks.js tglLeadTime.
        submittedDate: field('string', { date: true }),
        expectedDate: field('string', { date: true })
      }
    },
    resources: {
      section: 'res',
      label: 'Resources',
      titleField: 'name',
      deletable: true,
      fields: {
        id: field('string', { max: ID_MAX, derived: true, default: null }),
        name: field('string', { max: SHORT_MAX, default: '' }),
        type: field('string', { enum: RESOURCE_TYPES, default: 'Labor' }),
        role: field('string', { max: SHORT_MAX, default: '' }),
        availability: field('number', { default: 100 }),
        rate: field('number', { default: 0 }),
        hoursAllocated: field('number', { default: 0 }),
        // js/mmgr-resources.js resUtil recomputes this from availability.
        utilization: field('number', { derived: true, default: 0 })
      }
    },
    risks: {
      section: 'risk',
      label: 'Risks',
      titleField: 'description',
      deletable: true,
      fields: {
        id: field('string', { max: ID_MAX, derived: true, default: null }),
        // The UI field is `description`; `name` is accepted on input only.
        description: field('string', { alias: 'name', default: '' }),
        probability: field('string', { enum: SCALE_3, default: 'Medium' }),
        impact: field('string', { enum: SCALE_3, default: 'Medium' }),
        mitigation: field('string', { default: '' }),
        // js/mmgr-risks.js toggleRiskIssue owns this link.
        issueId: field('string', { max: ID_MAX, derived: true, default: null }),
        status: field('string'),
        notes: field('string'),
        owner: field('string', { max: SHORT_MAX }),
        contingency: field('string'),
        linkedTaskId: field('string', { max: ID_MAX }),
        costImpactEstimate: field('number')
      }
    },
    issues: {
      section: 'risk',
      label: 'Issues',
      titleField: 'description',
      deletable: true,
      fields: {
        id: field('string', { max: ID_MAX, derived: true, default: null }),
        description: field('string', { alias: 'name', default: '' }),
        owner: field('string', { max: SHORT_MAX, default: '' }),
        targetDate: field('string', { date: true, default: '' }),
        status: field('string', { enum: ISSUE_STATUSES, default: 'open' }),
        sourceRiskId: field('string', { max: ID_MAX, derived: true, default: null }),
        resolution: field('string')
      }
    },
    logEntries: {
      section: 'log',
      label: 'Decision Log',
      titleField: 'decision',
      deletable: true,
      fields: {
        // The UI creator does not write an id; MCP assigns one so a record
        // can be addressed by recordId later. Read-only either way.
        id: field('string', { max: ID_MAX, derived: true, default: null }),
        date: field('string', { default: '' }),
        decision: field('string', { default: '' }),
        by: field('string', { max: SHORT_MAX, default: '' }),
        actionItems: field('string', { default: '' })
      }
    },
    meetings: {
      section: 'meet',
      label: 'Meetings',
      titleField: 'title',
      deletable: true,
      fields: {
        id: field('number', { derived: true, default: null }),
        kind: field('string', { default: '' }),
        title: field('string', { max: SHORT_MAX, default: '' }),
        startedAt: field('string', { default: '' }),
        endedAt: field('string', { default: null }),
        durationMin: field('number', { derived: true, default: null }),
        items: field('array', { of: 'object', default: [] }),
        attendees: field('string', { default: '' }),
        summary: field('string', { default: '' }),
        transcript: field('string', { default: '' }),
        captureState: field('string', { default: null }),
        captureMethod: field('string', { default: null }),
        captureSession: field('string', { default: null }),
        transcribeState: field('string', { default: null })
      }
    },
    stakeholders: {
      section: 'stk',
      label: 'Stakeholders',
      titleField: 'name',
      deletable: true,
      fields: {
        id: field('string', { max: ID_MAX, derived: true, default: null }),
        name: field('string', { max: SHORT_MAX, default: '' }),
        role: field('string', { max: SHORT_MAX, default: '' }),
        influence: field('string', { enum: SCALE_3, default: 'Medium' }),
        interest: field('string', { enum: SCALE_3, default: 'Medium' }),
        strategy: field('string', { default: '' }),
        contact: field('string', { max: SHORT_MAX, default: '' }),
        coiExpiry: field('string', { date: true, default: '' }),
        licenseExpiry: field('string', { date: true, default: '' }),
        emr: field('string', { max: 40, default: '' }),
        emrVerifiedAt: field('string', { date: true, default: '' })
      }
    },
    documents: {
      section: 'docs',
      label: 'Documents',
      titleField: 'title',
      deletable: true,
      fields: {
        id: field('string', { max: ID_MAX, derived: true, default: null }),
        docNo: field('string', { max: SHORT_MAX, default: '' }),
        title: field('string', { max: SHORT_MAX, default: '' }),
        type: field('string', { enum: DOCUMENT_TYPES, default: 'Drawing' }),
        version: field('string', { max: 20, default: '1' }),
        status: field('string', { enum: DOCUMENT_STATUSES, default: 'current' }),
        responsible: field('string', { max: SHORT_MAX, default: '' }),
        dateIssued: field('string', { date: true, default: '' }),
        notes: field('string', { default: '' })
      }
    },
    changes: {
      section: 'chg',
      label: 'Change Requests',
      titleField: 'title',
      deletable: true,
      fields: {
        id: field('string', { max: ID_MAX, derived: true, default: null }),
        date: field('string', { date: true, default: '' }),
        title: field('string', { max: SHORT_MAX, default: '' }),
        requester: field('string', { max: SHORT_MAX, default: '' }),
        schedImpact: field('string', { max: SHORT_MAX, default: '' }),
        costImpact: field('string', { max: SHORT_MAX, default: '' }),
        status: field('string', { enum: CHANGE_STATUSES, default: 'submitted' }),
        approvedBy: field('string', { max: SHORT_MAX, default: '' }),
        notes: field('string', { default: '' }),
        reason: field('string'),
        history: field('array', { of: 'object', derived: true })
      }
    },
    commsEntries: {
      section: 'comms',
      label: 'Comms Log',
      titleField: 'summary',
      deletable: true,
      fields: {
        id: field('string', { max: ID_MAX, derived: true, default: null }),
        date: field('string', { date: true, default: '' }),
        type: field('string', { enum: COMMS_TYPES, default: 'Meeting' }),
        attendees: field('string', { default: '' }),
        summary: field('string', { default: '' }),
        actionItems: field('string', { default: '' }),
        followUp: field('string', { default: '' }),
        // js/mmgr-meetings.js endMeeting links the auto-logged entry.
        sourceMeetingId: field('number', { derived: true })
      }
    },
    // Money tables. They are modelled so get_schema and validation agree,
    // but writes go through the budget array (buildBudgetProposal), never a
    // generic diff or create.
    budgetLines: {
      section: 'bud',
      label: 'Budget Lines',
      titleField: 'name',
      deletable: false,
      writeVia: 'budget',
      fields: {
        id: field('string', { max: ID_MAX, derived: true, default: null }),
        name: field('string', { max: SHORT_MAX }),
        category: field('string', { max: SHORT_MAX, default: '' }),
        planned: field('number', { default: 0 }),
        // js/mmgr-resources.js lineActual sums the spend log.
        actual: field('number', { derived: true, default: 0 }),
        committed: field('number', { default: null }),
        notes: field('string', { default: '' }),
        taskId: field('string', { max: ID_MAX, default: '' }),
        linkedTaskId: field('string', { max: ID_MAX }),
        curve: field('string', { max: 20, default: 'linear' }),
        waiverStatus: field('string', { max: 20, default: 'pending' }),
        waiverReceivedAt: field('string', { date: true, default: '' }),
        qty: field('number'),
        unit: field('string', { max: 40 }),
        rate: field('number'),
        boqRef: field('string', { max: SHORT_MAX }),
        source: field('string', { max: 20 }),
        isContingency: field('boolean')
      }
    },
    spendLog: {
      section: 'bud',
      label: 'Deliveries / Spend',
      titleField: 'id',
      deletable: false,
      writeVia: 'budget',
      fields: {
        id: field('string', { max: ID_MAX, derived: true, default: null }),
        date: field('string', { date: true, default: '' }),
        budgetLineId: field('string', { max: ID_MAX, default: '' }),
        amount: field('number', { default: 0 }),
        notes: field('string', { default: '' }),
        qty: field('number'),
        unitPrice: field('number'),
        unit: field('string', { max: 40 }),
        supplierRef: field('string', { max: SHORT_MAX }),
        status: field('string', { max: 20 })
      }
    }
  },

  // Object and scalar sections reachable through `sets`. Top-level keys are
  // modelled; `nested` carries the one level the client's own editors write.
  sections: {
    charter: {
      section: 'charter',
      label: 'Charter',
      type: 'object',
      fields: {
        name: field('string', { max: SHORT_MAX, default: '' }),
        sponsor: field('string', { max: SHORT_MAX, default: '' }),
        objective: field('string', { default: '' }),
        scope: field('string', { default: '' }),
        deliverables: field('string', { default: '' }),
        constraints: field('string', { default: '' }),
        assumptions: field('string', { default: '' }),
        exclusions: field('string', { default: '' }),
        targetStart: field('string', { date: true, default: '' }),
        targetCompletion: field('string', { date: true, default: '' }),
        budgetEnvelope: field('number', { default: 0 }),
        kpis: field('array', { of: 'object', default: [] }),
        categories: field('object', { default: {} })
      }
    },
    dmaic: {
      section: 'dmaic',
      label: 'DMAIC',
      type: 'object',
      fields: {
        active: field('boolean', { default: false }),
        define: field('object', {
          default: {},
          nested: {
            problem: 'string',
            goal: 'string',
            scope: 'string',
            sponsor: 'string',
            voice: 'string',
            done: 'boolean'
          }
        }),
        measure: field('object', {
          default: {},
          nested: {
            baseline: 'string',
            defects: 'string',
            unit: 'string',
            opportunity: 'string',
            dpmo: 'string',
            sigmaNow: 'string',
            done: 'boolean'
          }
        }),
        analyze: field('object', {
          default: {},
          nested: { rootCauses: 'string', fishbone: 'string', paretoTop: 'string', done: 'boolean' }
        }),
        improve: field('object', {
          default: {},
          nested: { solutions: 'string', pilot: 'string', results: 'string', done: 'boolean' }
        }),
        control: field('object', {
          default: {},
          nested: { plan: 'string', metrics: 'string', handover: 'string', done: 'boolean' }
        })
      }
    },
    closure: {
      section: 'close',
      label: 'Closure',
      type: 'object',
      fields: {
        items: field('array', { of: 'object', default: [] }),
        well: field('string', { default: '' }),
        imp: field('string', { default: '' }),
        rec: field('string', { default: '' })
      }
    },
    raci: {
      section: 'raci',
      label: 'RACI',
      type: 'object',
      fields: {
        tasks: field('array', { of: 'object', default: [] }),
        persons: field('array', { of: 'object', default: [] }),
        matrix: field('object', { default: {} })
      }
    },
    projectName: {
      section: 'charter',
      label: 'Project name',
      type: 'string',
      max: SHORT_MAX,
      fields: {}
    },
    projectDeadline: {
      section: 'wbs',
      label: 'Project deadline',
      type: 'string',
      date: true,
      fields: {}
    },
    budgetEnvelope: {
      section: 'bud',
      label: 'Budget envelope',
      type: 'number',
      fields: {}
    },
    methodology: {
      section: 'charter',
      label: 'Methodology',
      type: 'string',
      enum: METHODOLOGIES,
      fields: {}
    },
    methodologyLocked: {
      section: 'charter',
      label: 'Methodology locked',
      type: 'boolean',
      fields: {}
    }
  }
};

export const LIST_PATHS = Object.keys(MODEL.lists);
export const SECTION_PATHS = Object.keys(MODEL.sections);

export function getList(path) {
  return MODEL.lists[path] || null;
}

export function getSection(path) {
  return MODEL.sections[path] || null;
}

export function isListPath(path) {
  return !!MODEL.lists[path];
}

export function isSectionPath(path) {
  return !!MODEL.sections[path];
}

export function isDeletable(path) {
  const list = MODEL.lists[path];
  return !!(list && list.deletable);
}

// Resolve an input name to the stored field. Returns null when the field is
// not modelled. A custom key is accepted only when the client's own
// CustomFields.isCustomKey predicate accepts it (the prefix check lives in
// js/mmgr-custom-fields.js; the caller passes the predicate in).
export function canonicalField(path, name) {
  const list = MODEL.lists[path];
  if (!list || typeof name !== 'string' || !name) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(list.fields, name)) {
    return name;
  }
  const keys = Object.keys(list.fields);
  for (let i = 0; i < keys.length; i++) {
    const spec = list.fields[keys[i]];
    if (spec && spec.alias === name) {
      return keys[i];
    }
  }
  return null;
}

export function fieldSpec(path, name) {
  const list = MODEL.lists[path];
  if (!list) {
    return null;
  }
  return list.fields[name] || null;
}

// The record a create starts from. Exactly the fields the client creator
// writes at creation time, in the same shape. Dynamic stamps (today, board
// slot) are applied by stampCreated() so this function stays pure and the
// field-set test can compare it directly.
export function createDefaults(path) {
  const list = MODEL.lists[path];
  if (!list) {
    return null;
  }
  const out = {};
  Object.keys(list.fields).forEach(function (name) {
    const spec = list.fields[name];
    if (!Object.prototype.hasOwnProperty.call(spec, 'default')) {
      return;
    }
    const v = spec.default;
    out[name] = v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  });
  return out;
}

// The client stamps these at creation; the server must produce the same
// shape or an MCP-created task renders differently from a UI-created one.
export function stampCreated(path, rec, ctx) {
  if (!rec) {
    return rec;
  }
  if (path === 'tasks') {
    const today = ctx && ctx.today ? String(ctx.today) : '';
    rec.createdDate = today;
    rec.statusSince = today;
    rec.boardPosition =
      ctx && typeof ctx.boardPosition === 'number' && isFinite(ctx.boardPosition)
        ? ctx.boardPosition
        : 0;
  }
  return rec;
}

// The status enum for a list, or null. Used by get_schema and by validation.
export function statusValues(path) {
  const spec = fieldSpec(path, 'status');
  return spec && spec.enum ? spec.enum.slice() : null;
}

// JSON-serialisable view of one table or section for the get_schema tool.
// `scopeAllowed` is injected so this module never imports the HTTP layer.
export function describeSchema(path, scopeAllowed) {
  const list = MODEL.lists[path];
  const section = MODEL.sections[path];
  const entry = list || section;
  if (!entry) {
    return null;
  }
  if (typeof scopeAllowed === 'function' && !scopeAllowed(entry.section)) {
    return null;
  }
  if (list) {
    const fields = {};
    Object.keys(list.fields).forEach(function (name) {
      const f = list.fields[name];
      fields[name] = {
        type: f.type,
        max: f.max,
        enum: f.enum,
        required: f.required,
        derived: f.derived,
        alias: f.alias,
        date: f.date
      };
      if (f.derivedWhen) {
        fields[name].derivedWhen = f.derivedWhen;
      }
    });
    return {
      path: path,
      kind: 'list',
      label: list.label,
      section: list.section,
      titleField: list.titleField,
      deletable: !!list.deletable,
      writeVia: list.writeVia || 'diffs/creates',
      fields: fields
    };
  }
  const fields = {};
  Object.keys(section.fields).forEach(function (name) {
    const f = section.fields[name];
    fields[name] = {
      type: f.type,
      max: f.max,
      enum: f.enum,
      required: f.required,
      derived: f.derived,
      alias: f.alias,
      date: f.date
    };
    if (f.nested) {
      fields[name].nested = f.nested;
    }
  });
  return {
    path: path,
    kind: 'section',
    label: section.label,
    section: section.section,
    type: section.type,
    max: section.max === undefined ? null : section.max,
    enum: section.enum || null,
    date: !!section.date,
    fields: fields
  };
}
