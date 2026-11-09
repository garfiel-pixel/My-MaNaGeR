/* ============================================================
   My MaNaGeR , Template Library Module (C24)
   Reusable project templates: save current state as template,
   apply template to new/existing project.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const S = () => ns.State.getState();
  const U = ns.Utils;
  const R = ns.Render;

  // ---- Built-in templates ----
  // Placeholder-shaped pages, not finished prose: a template gives the
  // project book a spine to fill in. Every built-in build type can reuse it.
  function pageSkeleton() {
    return [
      {
        key: 'scope',
        parent: '',
        title: 'Scope',
        blocks: [
          { type: 'paragraph', text: 'What this project covers, and what it does not.' },
          { type: 'bullet', text: 'In scope:' },
          { type: 'bullet', text: 'Out of scope:' }
        ]
      },
      {
        key: 'method',
        parent: '',
        title: 'Method statements',
        blocks: [
          { type: 'heading', text: 'Sequence' },
          { type: 'paragraph', text: 'How the work is staged, in the order it happens.' },
          { type: 'checklist', text: 'Method statement issued and accepted' }
        ]
      },
      {
        key: 'inspections',
        parent: '',
        title: 'Inspection register',
        blocks: [
          {
            type: 'paragraph',
            text: 'Every task the WBS holds, so an inspection can be raised against one.'
          },
          { type: 'taskList', filter: { phase: '', status: '', assignee: '', window: 0 } }
        ]
      },
      {
        key: 'handover',
        parent: '',
        title: 'Handover index',
        blocks: [
          { type: 'heading', text: 'What the client receives' },
          { type: 'docList', filter: { type: '', status: '' } },
          { type: 'paragraph', text: 'Sign-off, keys and the operating pack.' }
        ]
      }
    ];
  }

  const BUILT_IN = [
    {
      id: 'tpl-residential',
      name: 'Residential Construction',
      builtin: true,
      pages: pageSkeleton(),
      tasks: [
        { name: 'Site Preparation', indent: 0, isPhase: true },
        { name: 'Excavation & Grading', indent: 1, duration: '5' },
        { name: 'Foundation', indent: 1, duration: '10' },
        { name: 'Framing', indent: 0, isPhase: true },
        { name: 'Structural Framing', indent: 1, duration: '15' },
        { name: 'Roofing', indent: 1, duration: '5' },
        { name: 'MEP Rough-In', indent: 0, isPhase: true },
        { name: 'Electrical Rough-In', indent: 1, duration: '7' },
        { name: 'Plumbing Rough-In', indent: 1, duration: '7' },
        { name: 'HVAC Installation', indent: 1, duration: '5' },
        { name: 'Interior Finish', indent: 0, isPhase: true },
        { name: 'Insulation', indent: 1, duration: '5' },
        { name: 'Drywall', indent: 1, duration: '7' },
        { name: 'Painting', indent: 1, duration: '5' },
        { name: 'Flooring', indent: 1, duration: '5' },
        { name: 'Cabinetry & Trim', indent: 1, duration: '7' },
        { name: 'Final MEP', indent: 0, isPhase: true },
        { name: 'Electrical Trim-Out', indent: 1, duration: '3' },
        { name: 'Plumbing Trim-Out', indent: 1, duration: '3' },
        { name: 'HVAC Commissioning', indent: 1, duration: '2' },
        { name: 'Closeout', indent: 0, isPhase: true },
        { name: 'Punch List', indent: 1, duration: '5' },
        { name: 'Final Inspection', indent: 1, duration: '2' },
        { name: 'Handover', indent: 1, duration: '1' }
      ],
      budgetLines: [
        { category: 'Site Work', description: 'Excavation & Foundation', planned: 25000 },
        { category: 'Framing', description: 'Structural & Roofing', planned: 45000 },
        { category: 'MEP', description: 'Electrical, Plumbing, HVAC', planned: 35000 },
        { category: 'Interior', description: 'Insulation to Flooring', planned: 30000 },
        { category: 'Finish', description: 'Cabinetry, Trim, Paint', planned: 25000 },
        { category: 'Closeout', description: 'Punch List & Handover', planned: 5000 }
      ]
    },
    {
      id: 'tpl-commercial',
      name: 'Commercial Build',
      builtin: true,
      pages: pageSkeleton(),
      tasks: [
        { name: 'Pre-Construction', indent: 0, isPhase: true },
        { name: 'Permitting', indent: 1, duration: '20' },
        { name: 'Mobilization', indent: 1, duration: '5' },
        { name: 'Structural', indent: 0, isPhase: true },
        { name: 'Foundation & Slab', indent: 1, duration: '15' },
        { name: 'Steel Erection', indent: 1, duration: '20' },
        { name: 'Core & Shell', indent: 0, isPhase: true },
        { name: 'Exterior Envelope', indent: 1, duration: '15' },
        { name: 'Roofing', indent: 1, duration: '10' },
        { name: 'MEP', indent: 0, isPhase: true },
        { name: 'Mechanical', indent: 1, duration: '20' },
        { name: 'Electrical', indent: 1, duration: '20' },
        { name: 'Plumbing', indent: 1, duration: '15' },
        { name: 'Interior Fit-Out', indent: 0, isPhase: true },
        { name: 'Drywall & Ceilings', indent: 1, duration: '10' },
        { name: 'Flooring & Finishes', indent: 1, duration: '10' },
        { name: 'FF&E', indent: 1, duration: '5' },
        { name: 'Commissioning & Closeout', indent: 0, isPhase: true },
        { name: 'Systems Commissioning', indent: 1, duration: '10' },
        { name: 'Punch List', indent: 1, duration: '7' },
        { name: 'Final Inspection & Handover', indent: 1, duration: '3' }
      ],
      budgetLines: [
        { category: 'Pre-Construction', description: 'Permits & Mobilization', planned: 30000 },
        { category: 'Structural', description: 'Foundation & Steel', planned: 120000 },
        { category: 'Shell', description: 'Envelope & Roofing', planned: 80000 },
        { category: 'MEP', description: 'Mechanical, Electrical, Plumbing', planned: 150000 },
        { category: 'Interior', description: 'Fit-Out & Finishes', planned: 60000 },
        { category: 'Closeout', description: 'Commissioning & Handover', planned: 15000 }
      ]
    },
    {
      id: 'tpl-renovation',
      name: 'Renovation',
      builtin: true,
      pages: pageSkeleton(),
      tasks: [
        { name: 'Assessment & Planning', indent: 0, isPhase: true },
        { name: 'Existing Conditions Survey', indent: 1, duration: '3' },
        { name: 'Design & Permits', indent: 1, duration: '10' },
        { name: 'Demolition', indent: 0, isPhase: true },
        { name: 'Selective Demolition', indent: 1, duration: '5' },
        { name: 'Structural Modifications', indent: 1, duration: '7' },
        { name: 'Build Back', indent: 0, isPhase: true },
        { name: 'Framing & Rough-In', indent: 1, duration: '10' },
        { name: 'MEP Updates', indent: 1, duration: '7' },
        { name: 'Finishes', indent: 1, duration: '7' },
        { name: 'Closeout', indent: 0, isPhase: true },
        { name: 'Punch List', indent: 1, duration: '3' },
        { name: 'Final Inspection', indent: 1, duration: '1' }
      ],
      budgetLines: [
        { category: 'Assessment', description: 'Survey & Design', planned: 8000 },
        { category: 'Demolition', description: 'Selective Demo & Structural', planned: 12000 },
        { category: 'Build Back', description: 'Framing, MEP, Finishes', planned: 35000 },
        { category: 'Closeout', description: 'Punch List & Inspection', planned: 3000 }
      ]
    }
  ];

  // ---- CRUD ----
  function saveAsTemplate(name) {
    const s = S();
    if (!s) {
      return;
    }
    ns.State.updateState(function (st) {
      if (!st.projectTemplates) {
        st.projectTemplates = [];
      }
      // Remove built-in with same name if re-saving
      st.projectTemplates = st.projectTemplates.filter(function (t) {
        return !t.builtin || t.name !== name;
      });
      st.projectTemplates.push({
        id: U.genShortId('TPL'),
        name: name || 'My Template',
        builtin: false,
        createdAt: new Date().toISOString(),
        tasks: JSON.parse(JSON.stringify(s.tasks || [])),
        budgetLines: JSON.parse(JSON.stringify(s.budgetLines || [])),
        resources: JSON.parse(JSON.stringify(s.resources || [])),
        pages: ns.Pages ? ns.Pages.captureTree(s) : []
      });
    });
  }

  function deleteTemplate(tplId) {
    ns.State.updateState(function (st) {
      if (!st.projectTemplates) {
        return;
      }
      st.projectTemplates = st.projectTemplates.filter(function (t) {
        return t.id !== tplId;
      });
    });
  }

  function applyTemplate(tplId) {
    const s = S();
    if (!s) {
      return;
    }
    const allTemplates = BUILT_IN.concat(s.projectTemplates || []);
    const tpl = allTemplates.find(function (t) {
      return t.id === tplId;
    });
    if (!tpl) {
      return;
    }
    // Confirm before overwriting
    if (s.tasks && s.tasks.length > 0) {
      const carriesPages = !!(tpl.pages && tpl.pages.length);
      if (
        !confirm(
          'Apply "' +
            tpl.name +
            '"? This will add template tasks' +
            (carriesPages ? ', pages' : '') +
            ' and budget lines to your current project.'
        )
      ) {
        return;
      }
    }
    ns.State.updateState(function (st) {
      // Merge tasks (add template tasks after existing)
      if (tpl.tasks && tpl.tasks.length) {
        if (!st.tasks) {
          st.tasks = [];
        }
        let maxId = 0;
        st.tasks.forEach(function (t) {
          const num = parseInt(String(t.id).replace(/\D/g, ''));
          if (num > maxId) {
            maxId = num;
          }
        });
        tpl.tasks.forEach(function (t) {
          maxId++;
          st.tasks.push({
            id: 't' + maxId,
            name: t.name,
            indent: t.indent || 0,
            level: t.indent || 0,
            isPhase: t.isPhase || false,
            status: 'todo',
            duration: t.duration || '',
            startDate: '',
            endDate: '',
            assignee: '',
            confidence: 'high'
          });
        });
      }
      // Merge budget lines
      if (tpl.budgetLines && tpl.budgetLines.length) {
        if (!st.budgetLines) {
          st.budgetLines = [];
        }
        tpl.budgetLines.forEach(function (b) {
          st.budgetLines.push({
            id: U.genShortId('BL'),
            category: b.category,
            description: b.description,
            planned: b.planned || 0,
            actual: 0
          });
        });
      }
      // Pages last: a live block resolves against the tasks just added.
      if (tpl.pages && tpl.pages.length && ns.Pages) {
        ns.Pages.applyTree(st, tpl.pages);
      }
    });
    R.renderWbs();
    R.renderBudget();
    R.renderDash();
    if (R.renderPages) {
      R.renderPages();
    }
  }

  function getAllTemplates() {
    const s = S();
    return BUILT_IN.concat((s && s.projectTemplates) || []);
  }

  // ---- API ----
  ns.Templates = {
    saveAsTemplate: saveAsTemplate,
    deleteTemplate: deleteTemplate,
    applyTemplate: applyTemplate,
    getAllTemplates: getAllTemplates,
    BUILT_IN: BUILT_IN
  };
})(MMGR);
window.MMGR = MMGR;
