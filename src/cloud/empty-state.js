/* ============================================================
   My MaNaGeR - the empty project state (GENERATED)
   ============================================================
   DO NOT EDIT. Produced by tools/gen-empty-state.cjs from the app's
   own State.getDefaultState() in js/mmgr-state.js.

   Why it exists: a project created by the MCP server has no home
   device to save the first snapshot, so the launcher cannot open it
   and the admin panel sees a row that was never saved. Creating the
   row now seeds this snapshot, which is exactly what a fresh project
   on a device would have saved - so an MCP-created project opens,
   renders and syncs like any other.

   Keep it in sync: `node tools/gen-empty-state.cjs` after any schema
   bump; `npm run verify:empty-state` fails when the file is stale.
   ============================================================ */

export const EMPTY_STATE_SCHEMA = 32;

const BASE = {
    "schemaVersion": 32,
    "projectId": "default",
    "projectName": "",
    "status": "active",
    "methodology": "waterfall",
    "methodologyLocked": false,
    "workWeek": 5,
    "theme": "light",
    "crosshairOn": false,
    "userName": "",
    "charter": {
      "name": "",
      "sponsor": "",
      "objective": "",
      "scope": "",
      "deliverables": "",
      "constraints": "",
      "assumptions": "",
      "exclusions": "",
      "targetStart": "",
      "targetCompletion": "",
      "budgetEnvelope": 0,
      "kpis": [],
      "categories": {
        "financial": true,
        "schedule": true,
        "quality": true,
        "safety": true,
        "environmental": true
      }
    },
    "tasks": [],
    "ideas": [],
    "fields": [],
    "cfFilter": {
      "key": "",
      "value": ""
    },
    "meetings": [],
    "meetingPromises": {},
    "activeMeeting": null,
    "nmeetid": 1,
    "nspid": 1,
    "resources": [],
    "budgetLines": [],
    "budgetEnvelope": 0,
    "spendLog": [],
    "budgetBaselines": [],
    "budgetVariations": [],
    "nblid": 1,
    "stakeholders": [],
    "risks": [],
    "issues": [],
    "changes": [],
    "transitions": [],
    "cycles": [],
    "modules": [],
    "rules": [],
    "ruleLog": [],
    "trFilter": "all",
    "logEntries": [],
    "commsEntries": [],
    "documents": [],
    "pages": [],
    "docsView": "register",
    "pageSel": "",
    "pageUnfiled": false,
    "closure": {
      "items": [],
      "well": "",
      "imp": "",
      "rec": ""
    },
    "raci": {
      "tasks": [],
      "persons": [],
      "matrix": {}
    },
    "sprint": {
      "name": "Sprint 1",
      "start": "",
      "end": ""
    },
    "dailySnapshots": [],
    "defExpanded": {},
    "dmaic": {
      "active": false,
      "define": {
        "problem": "",
        "goal": "",
        "scope": "",
        "sponsor": "",
        "voice": "",
        "done": false
      },
      "measure": {
        "baseline": "",
        "defects": "",
        "unit": "",
        "opportunity": "",
        "dpmo": "",
        "sigmaNow": "",
        "done": false
      },
      "analyze": {
        "rootCauses": "",
        "fishbone": "",
        "paretoTop": "",
        "done": false
      },
      "improve": {
        "solutions": "",
        "pilot": "",
        "results": "",
        "done": false
      },
      "control": {
        "plan": "",
        "metrics": "",
        "handover": "",
        "done": false
      }
    },
    "baseline": null,
    "baselineAutoAt": null,
    "fieldReportNotes": [],
    "aiInbox": [],
    "weatherRegion": "northern-temperate",
    "projectDeadline": "",
    "siteLat": null,
    "siteLon": null,
    "sitePlace": "",
    "wxCache": null,
    "weatherLog": [],
    "ldRate": 0,
    "wxViewDays": 7,
    "wxWindow": {
      "start": "",
      "end": "",
      "bufferDays": 0
    },
    "kbShowLeadtime": false,
    "ideaView": "board",
    "ideaTag": "",
    "agendaDays": 30,
    "relLens": "all",
    "kanban": {
      "wip": {
        "todo": 0,
        "inprogress": 0,
        "blocked": 0,
        "completed": 0
      },
      "swimlane": "none"
    },
    "hlCritical": false,
    "dailySnapshot": null,
    "focusMode": false,
    "streak": {
      "count": 0,
      "lastDate": null
    },
    "sentimentHistory": [],
    "lastBackedUpAt": null,
    "flags": {
      "monteCarlo": true,
      "ganttExport": true,
      "leadtimeLane": true,
      "weatherForecast": true
    },
    "calcUnitFlag": true,
    "calcAiUnits": true,
    "calcStickyPanel": true,
    "calcSwitches": true,
    "calcRenderScheduler": true,
    "ganttExportV2": true,
    "procPo": true,
    "consentBanner": true,
    "ratebookApi": true,
    "dialogClickFix": true,
    "comboboxPicker": true,
    "settingRows": true,
    "itemisedMaterials": true,
    "goldBullion": true,
    "perfBoot": true,
    "sidebarGutter": true,
    "sameTabNav": true,
    "expiryWatcher": true,
    "finishWatcher": true,
    "ganttTidy": true,
    "aiDock": true,
    "localModel": false,
    "globeContinuous": true,
    "dotRailGhost": true,
    "errorLog": [],
    "config": {},
    "scheduleSlips": [],
    "slipCauses": {},
    "digestSnapshot": null,
    "aiOutputs": {},
    "aiChats": [],
    "fieldTs": {},
    "packs": {
      "schedule": false,
      "money": false,
      "governance": false,
      "field": false,
      "quality": false,
      "procurement": false
    },
    "packsCalloutDismissed": false,
    "packsEverEnabled": false,
    "supplierBook": {
      "vendors": [],
      "items": [],
      "nvendorid": 1,
      "nitemid": 1
    },
    "updatedAt": ""
  };

export function emptyProjectState(projectId, name, now) {
  const state = JSON.parse(JSON.stringify(BASE));
  state.schemaVersion = EMPTY_STATE_SCHEMA;
  state.projectId = String(projectId || '');
  state.projectName = String(name || '');
  if (state.charter && typeof state.charter === 'object') {
    state.charter.name = String(name || '');
  }
  state.createdAt = now;
  state.updatedAt = now;
  state.revision = 1;
  return state;
}
