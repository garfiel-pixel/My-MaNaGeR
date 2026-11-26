/* ============================================================
   MCP project health + structural lint
   ------------------------------------------------------------
   One pure pass over a stored project state that answers the
   question an agent actually asks before it plans: "is this
   project executable yet?" Without it a caller has to read six
   tables and infer the answer, and an unlinked WBS reads as a
   perfectly good plan.

   Two exports:
     buildHealth(state, ctx)  readiness gates for get_project_health
     buildLint(state)         structural problems for validate_changes

   Both are pure and deterministic: same state in, same report out.
   Neither writes, queues or mutates anything.
   ============================================================ */

import { computeSchedule, parseDL } from './schedule.js';

function gate(status, detail, count) {
  const out = { status: status, detail: detail };
  if (count !== undefined) {
    out.count = count;
  }
  return out;
}

/**
 * Turn the same facts the gates use into a short, ranked fix list. A gate
 * answer of "warn" is not actionable on its own: on a 29-record WBS an agent
 * needs to know the FIRST thing to fix and which records carry it. Every
 * action is scoped to the sections the caller can see, so a scoped API key
 * never receives advice about a budget it cannot read.
 */
function buildActions(s, schedule, workItems, c, scope) {
  const tasks = Array.isArray(s.tasks) ? s.tasks : [];
  const resources = Array.isArray(s.resources) ? s.resources : [];
  const lint = buildLint(s, schedule);
  const ids = Object.create(null);
  tasks.forEach(function (t) {
    if (t && t.id != null) {
      const k = String(t.id);
      ids[k] = (ids[k] || 0) + 1;
    }
  });
  const duplicates = Object.keys(ids).filter(function (k) {
    return ids[k] > 1;
  });
  const canSee = function (section) {
    return !scope || scope.indexOf(section) !== -1;
  };
  // Gate names are not scope keys: the schedule gate lives in the "wbs"
  // section, the data gate is always visible, and the rest are 1:1.
  const scopeKey = { schedule: 'wbs', data: null, res: 'res', bud: 'bud' };
  const actions = [];
  const add = function (code, severity, section, priority, count, list, action) {
    const key = scopeKey[section];
    if (key && !canSee(key)) {
      return;
    }
    actions.push({
      code: code,
      severity: severity,
      gate: section,
      count: count,
      ids: list || [],
      action: action,
      priority: priority
    });
  };
  const matching = function (pattern) {
    return lint
      .filter(function (l) {
        return pattern.test(l.detail);
      })
      .map(function (l) {
        return l.id;
      });
  };

  if (schedule.cycles.length) {
    add(
      'break-cycle',
      'fail',
      'schedule',
      10,
      schedule.cycles.length,
      schedule.cycles,
      'Break the predecessor cycle through ' +
        schedule.cycles.join(', ') +
        '; no schedule can be computed while it remains.'
    );
  }
  const dangling = lint
    .filter(function (l) {
      return /predecessor .* does not exist/.test(l.detail);
    })
    .map(function (l) {
      const m = /predecessor (.*) does not exist/.exec(l.detail);
      return m ? m[1] : l.id;
    });
  if (dangling.length) {
    add(
      'fix-dangling',
      'fail',
      'schedule',
      11,
      dangling.length,
      dangling,
      'Replace or remove the predecessor ids that point at tasks which do not exist.'
    );
  }
  if (duplicates.length) {
    add(
      'duplicate-ids',
      'fail',
      'data',
      12,
      duplicates.length,
      duplicates,
      'Give each task a unique id: ' + duplicates.join(', ') + ' is used more than once.'
    );
  }

  if (!schedule.links.edges && workItems.length > 1) {
    add(
      'link-network',
      'warn',
      'schedule',
      20,
      workItems.length,
      workItems.slice(0, 5).map(function (t) {
        return t.id;
      }),
      'Link the ' +
        workItems.length +
        ' work items with real predecessors before trusting the critical path or Monte Carlo.'
    );
  }
  const noDuration = matching(/has dates but no duration/);
  if (noDuration.length) {
    add(
      'set-duration',
      'warn',
      'schedule',
      21,
      noDuration.length,
      noDuration,
      'Set a duration on ' +
        noDuration.length +
        ' dated task(s); the schedule engine skips them until then.'
    );
  }
  const reversed = matching(/end date is before the start date/);
  if (reversed.length) {
    add(
      'fix-dates',
      'warn',
      'schedule',
      22,
      reversed.length,
      reversed,
      'Correct the reversed start/end dates on ' + reversed.length + ' task(s).'
    );
  }
  if (schedule.deadlineMissed) {
    add(
      'deadline',
      'warn',
      'schedule',
      23,
      1,
      schedule.criticalTasks.slice(0, 5),
      'Compress the longest chain or move the deadline from ' +
        schedule.deadline +
        ' to ' +
        schedule.projectEnd +
        ' - the computed finish is past it.'
    );
  }
  const idle = resources.filter(function (r) {
    return resourceUtil(r, s.workWeek) === 0;
  });
  if (resources.length && idle.length === resources.length) {
    add(
      'effort-link',
      'warn',
      'res',
      30,
      resources.length,
      resources.slice(0, 5).map(function (r) {
        return r.id;
      }),
      'Tie the role allocations to task effort: every resource currently has zero utilisation.'
    );
  }
  if (
    resources.some(function (r) {
      return +r.availability === 0;
    })
  ) {
    add(
      'capacity',
      'warn',
      'res',
      31,
      1,
      resources
        .filter(function (r) {
          return +r.availability === 0;
        })
        .slice(0, 5)
        .map(function (r) {
          return r.id;
        }),
      'Set a real availability for the role with zero availability before reading utilisation.'
    );
  }
  if (!c.baseline) {
    add(
      'freeze-baseline',
      'warn',
      'bud',
      40,
      1,
      [],
      'Freeze a budget baseline so variance and change control have something to compare against.'
    );
  }
  const badBudgetLink = matching(/linked task .* does not exist/);
  if (badBudgetLink.length) {
    add(
      'fix-budget-link',
      'warn',
      'bud',
      41,
      badBudgetLink.length,
      badBudgetLink,
      'Point the listed budget lines at existing tasks so cost can be earned against progress.'
    );
  }

  actions.sort(function (a, b) {
    if (a.severity !== b.severity) {
      return a.severity === 'fail' ? -1 : 1;
    }
    return a.priority - b.priority;
  });
  const ranked = actions.slice(0, 6).map(function (a) {
    const copy = Object.assign({}, a);
    delete copy.priority;
    return copy;
  });
  const first = ranked[0];
  const verdict = !first
    ? 'Executable: no blocking problems found in the sections you can read.'
    : first.severity === 'fail'
      ? 'Not executable: ' + first.action
      : 'Manageable but not executable yet: ' + first.action + ' Then re-check health.';
  return { verdict: verdict, nextActions: ranked };
}

function rollup(checks) {
  if (
    checks.some(function (c) {
      return c.status === 'fail';
    })
  ) {
    return 'fail';
  }
  if (
    checks.some(function (c) {
      return c.status === 'warn';
    })
  ) {
    return 'warn';
  }
  return 'ok';
}

function money(n) {
  const v = Math.round((+n || 0) * 100) / 100;
  return v;
}

// js/mmgr-resources.js resUtil - the same capacity basis (workWeek x 4 x 8h).
export function resourceUtil(r, workWeek) {
  const ww = +(workWeek || 5) || 5;
  const cap = ((+r.availability || 100) / 100) * (ww * 4 * 8);
  return cap ? Math.round(((+r.hoursAllocated || 0) / cap) * 100) : 0;
}

function riskIsOpen(r) {
  const st = String((r && r.status) || 'open').toLowerCase();
  return st !== 'closed' && st !== 'resolved';
}

/**
 * Readiness gates.
 *
 * @param {object} state  project state
 * @param {object} [ctx]  { pendingProposals, baseline, scope, revision }
 * @returns {object} { overall, gates, summary }
 */
export function buildHealth(state, ctx) {
  const s = state || {};
  const c = ctx || {};
  const scope = Array.isArray(c.scope) ? c.scope : null;
  const canSee = function (section) {
    return !scope || scope.indexOf(section) !== -1;
  };
  const tasks = Array.isArray(s.tasks) ? s.tasks : [];
  const workItems = tasks.filter(function (t) {
    return t && !t.isPhase;
  });
  const schedule = computeSchedule(s);
  const gates = {};

  // ---- Schedule ---------------------------------------------------------
  const schedChecks = [];
  if (!tasks.length) {
    schedChecks.push(gate('fail', 'no tasks: there is no WBS to schedule'));
  } else {
    if (schedule.cycles.length) {
      schedChecks.push(
        gate(
          'fail',
          'predecessor cycle through ' +
            schedule.cycles.join(', ') +
            ' - the schedule cannot be computed',
          schedule.cycles.length
        )
      );
    }
    if (schedule.links.danglingPredecessors) {
      schedChecks.push(
        gate(
          'fail',
          schedule.links.danglingPredecessors +
            ' predecessor link(s) point at a task that does not exist',
          schedule.links.danglingPredecessors
        )
      );
    }
    if (!schedule.links.edges) {
      schedChecks.push(
        gate(
          'warn',
          'no dependency links: this is a dated task list, not a network - critical path and Monte Carlo are not meaningful'
        )
      );
    } else if (schedule.links.unlinkedTasks) {
      schedChecks.push(
        gate(
          'warn',
          schedule.links.unlinkedTasks +
            ' task(s) have no predecessor and no successor: ' +
            schedule.links.unlinked.slice(0, 5).join(', '),
          schedule.links.unlinkedTasks
        )
      );
    }
    if (schedule.missingDuration) {
      schedChecks.push(
        gate(
          'warn',
          schedule.missingDuration +
            ' task(s) have dates but no duration - the engine skips them until a duration is set',
          schedule.missingDuration
        )
      );
    }
    if (schedule.deadlineMissed) {
      schedChecks.push(
        gate(
          'warn',
          'the computed finish ' +
            schedule.projectEnd +
            ' is past the project deadline ' +
            schedule.deadline
        )
      );
    }
    const late = schedule.rows.filter(function (r) {
      return r.late;
    });
    if (late.length) {
      schedChecks.push(
        gate(
          'warn',
          late.length +
            ' task(s) finish later than their stored end date: ' +
            late
              .slice(0, 5)
              .map(function (r) {
                return r.id;
              })
              .join(', '),
          late.length
        )
      );
    }
    const undated = schedule.rows.filter(function (r) {
      return !r.isPhase && !r.es;
    });
    if (undated.length) {
      schedChecks.push(
        gate(
          'warn',
          undated.length + ' task(s) cannot be scheduled (no start date or no duration)',
          undated.length
        )
      );
    }
  }
  if (
    schedule.links.edges &&
    !schedule.criticalTasks.length &&
    schedule.deadline &&
    !schedule.deadlineMissed &&
    schedule.projectEnd
  ) {
    const slack = Math.round(
      (parseDL(schedule.deadline) - parseDL(schedule.projectEnd)) / 86400000
    );
    schedChecks.push(
      gate(
        'ok',
        'the longest chain finishes ' +
          schedule.projectEnd +
          ', ' +
          slack +
          ' day(s) before the deadline ' +
          schedule.deadline +
          '; no zero-float tasks, so the critical set is empty by definition'
      )
    );
  }
  if (!schedChecks.length) {
    schedChecks.push(
      gate(
        'ok',
        schedule.links.edges +
          ' link(s), ' +
          schedule.scheduledCount +
          ' scheduled row(s), finish ' +
          schedule.projectEnd
      )
    );
  }
  gates.schedule = { status: rollup(schedChecks), checks: schedChecks };

  // ---- Budget -----------------------------------------------------------
  if (canSee('bud')) {
    const lines = Array.isArray(s.budgetLines) ? s.budgetLines : [];
    const spend = Array.isArray(s.spendLog) ? s.spendLog : [];
    const planned = lines.reduce(function (sum, l) {
      return sum + (+l.planned || 0);
    }, 0);
    const envelope = s.budgetEnvelope == null ? null : +s.budgetEnvelope || 0;
    const bChecks = [];
    if (!lines.length) {
      bChecks.push(gate('fail', 'no budget lines'));
    } else {
      bChecks.push(gate('ok', lines.length + ' line(s), planned ' + money(planned), lines.length));
      if (envelope && planned > envelope) {
        bChecks.push(
          gate('fail', 'planned ' + money(planned) + ' exceeds the envelope ' + money(envelope))
        );
      }
      const unlinked = lines.filter(function (l) {
        return !l.linkedTaskId && !l.taskId;
      });
      if (unlinked.length) {
        bChecks.push(
          gate(
            'warn',
            unlinked.length +
              ' line(s) are not linked to a task, so cost cannot be earned against progress',
            unlinked.length
          )
        );
      }
      if (!spend.length) {
        bChecks.push(
          gate('warn', 'no deliveries or spend entries: EVM stays null until actuals exist')
        );
      }
    }
    if (!c.baseline) {
      bChecks.push(
        gate(
          'warn',
          'no frozen budget baseline: variance and change control have nothing to compare against'
        )
      );
    }
    gates.budget = { status: rollup(bChecks), checks: bChecks };
  }

  // ---- Resources --------------------------------------------------------
  if (canSee('res')) {
    const resources = Array.isArray(s.resources) ? s.resources : [];
    const rChecks = [];
    if (!resources.length) {
      rChecks.push(
        gate('warn', 'no resources: nobody owns the work and no labour cost is planned')
      );
    } else {
      const idle = resources.filter(function (r) {
        return resourceUtil(r, s.workWeek) === 0;
      });
      const cost = resources.reduce(function (sum, r) {
        return sum + (+r.rate || 0) * (+r.hoursAllocated || 0);
      }, 0);
      const planned = (Array.isArray(s.budgetLines) ? s.budgetLines : []).reduce(function (sum, l) {
        return sum + (+l.planned || 0);
      }, 0);
      if (idle.length === resources.length) {
        rChecks.push(
          gate(
            'warn',
            'every resource has zero utilisation: allocation is not tied to task effort',
            resources.length
          )
        );
      } else if (idle.length) {
        rChecks.push(gate('warn', idle.length + ' resource(s) have zero utilisation', idle.length));
      }
      if (cost > 0 && planned === 0) {
        rChecks.push(
          gate('fail', 'resource cost ' + money(cost) + ' is not represented in any budget line')
        );
      } else if (cost > 0 && planned > 0 && cost > planned) {
        rChecks.push(
          gate(
            'warn',
            'resource cost ' +
              money(cost) +
              ' exceeds the planned budget ' +
              money(planned) +
              ' - the estimate is not effort-based'
          )
        );
      }
      if (!rChecks.length) {
        rChecks.push(gate('ok', resources.length + ' resource(s), labour cost ' + money(cost)));
      }
    }
    gates.resources = { status: rollup(rChecks), checks: rChecks };
  }

  // ---- Risk -------------------------------------------------------------
  if (canSee('risk')) {
    const risks = Array.isArray(s.risks) ? s.risks : [];
    const open = risks.filter(riskIsOpen);
    const kChecks = [];
    if (!risks.length) {
      kChecks.push(gate('warn', 'no risks recorded'));
    } else {
      const severe = open.filter(function (r) {
        return r.probability === 'High' && r.impact === 'High';
      });
      const unowned = open.filter(function (r) {
        return !r.owner && !r.mitigation;
      });
      kChecks.push(gate('ok', risks.length + ' risk(s), ' + open.length + ' open', open.length));
      if (severe.length) {
        kChecks.push(
          gate(
            'warn',
            severe.length +
              ' open high-probability/high-impact risk(s): ' +
              severe
                .slice(0, 3)
                .map(function (r) {
                  return r.id;
                })
                .join(', '),
            severe.length
          )
        );
      }
      if (unowned.length) {
        kChecks.push(
          gate(
            'warn',
            unowned.length + ' open risk(s) have neither an owner nor a mitigation',
            unowned.length
          )
        );
      }
    }
    gates.risk = { status: rollup(kChecks), checks: kChecks };
  }

  // ---- Data -------------------------------------------------------------
  const dChecks = [];
  const badStatus = tasks.filter(function (t) {
    return (
      t && ['todo', 'inprogress', 'blocked', 'completed'].indexOf(String(t.status || 'todo')) === -1
    );
  });
  if (badStatus.length) {
    dChecks.push(
      gate(
        'warn',
        badStatus.length + ' task(s) carry a status outside todo|inprogress|blocked|completed',
        badStatus.length
      )
    );
  }
  if (c.pendingProposals) {
    dChecks.push(
      gate(
        'warn',
        c.pendingProposals +
          ' proposal(s) are waiting for the owner: the live project does not include them yet',
        c.pendingProposals
      )
    );
  }
  if (!s.charter || !s.charter.name) {
    dChecks.push(gate('warn', 'the charter has no project name'));
  }
  if (!workItems.length) {
    dChecks.push(gate('warn', 'no work items (phases alone do not count as work)'));
  }
  if (!dChecks.length) {
    dChecks.push(gate('ok', workItems.length + ' work item(s)'));
  }
  gates.data = { status: rollup(dChecks), checks: dChecks };

  const order = ['schedule', 'budget', 'resources', 'risk', 'data'];
  const statuses = order
    .filter(function (k) {
      return gates[k];
    })
    .map(function (k) {
      return gates[k].status;
    });
  const overall =
    statuses.indexOf('fail') !== -1 ? 'fail' : statuses.indexOf('warn') !== -1 ? 'warn' : 'ok';
  const failing = order.filter(function (k) {
    return gates[k] && gates[k].status === 'fail';
  });
  const warning = order.filter(function (k) {
    return gates[k] && gates[k].status === 'warn';
  });

  const actions = buildActions(s, schedule, workItems, c, scope);
  return {
    overall: overall,
    // "Executable" means the plan can be managed against: no gate fails, no
    // cycle, and the work is either linked or small enough that a network adds
    // nothing (a single work item is a valid plan).
    executable:
      overall !== 'fail' &&
      schedule.cycles.length === 0 &&
      (schedule.links.edges > 0 || workItems.length <= 1),
    verdict: actions.verdict,
    nextActions: actions.nextActions,
    gates: gates,
    failingGates: failing,
    warningGates: warning,
    schedule: {
      taskCount: schedule.taskCount,
      scheduledCount: schedule.scheduledCount,
      edges: schedule.links.edges,
      unlinkedTasks: schedule.links.unlinkedTasks,
      cycles: schedule.cycles,
      projectStart: schedule.projectStart,
      projectEnd: schedule.projectEnd,
      deadline: schedule.deadline,
      deadlineMissed: schedule.deadlineMissed,
      criticalTasks: schedule.criticalTasks
    }
  };
}

/**
 * Structural lint for a candidate state (the submitted map applied onto base).
 * Returns a list of {severity, id, detail}. It never blocks a write - it tells
 * the agent what will still be wrong after the owner accepts.
 *
 * @param {object} state
 * @returns {Array<object>}
 */
export function buildLint(state, schedule) {
  const s = state || {};
  const tasks = Array.isArray(s.tasks) ? s.tasks : [];
  const out = [];
  const sch = schedule || computeSchedule(s);
  const ids = Object.create(null);
  const childCount = Object.create(null);
  const phaseNames = Object.create(null);
  const phaseIds = Object.create(null);
  tasks.forEach(function (t) {
    if (t && t.isPhase) {
      if (t.name) {
        phaseNames[String(t.name)] = true;
      }
      if (t.id != null) {
        phaseIds[String(t.id)] = true;
      }
    }
  });
  tasks.forEach(function (t) {
    if (t && t.id != null) {
      const k = String(t.id);
      ids[k] = (ids[k] || 0) + 1;
    }
    if (t && (t.parentId || t.parentName)) {
      if (t.parentId) {
        childCount['id:' + t.parentId] = (childCount['id:' + t.parentId] || 0) + 1;
      }
      if (t.parentName) {
        childCount['name:' + t.parentName] = (childCount['name:' + t.parentName] || 0) + 1;
      }
    }
  });

  tasks.forEach(function (t) {
    if (!t) {
      return;
    }
    const label = t.id || t.name || '(no id)';
    const start = parseDL(t.startDate);
    const end = parseDL(t.endDate);
    if (start && end && end < start) {
      out.push({
        severity: 'warn',
        id: t.id,
        detail: label + ': end date is before the start date'
      });
    }
    if (t.id != null && ids[String(t.id)] > 1) {
      out.push({
        severity: 'fail',
        id: t.id,
        detail: label + ': duplicate task id ' + t.id
      });
    }
    if (t.parentName && !phaseNames[String(t.parentName)] && phaseIds[String(t.parentName)]) {
      out.push({
        severity: 'warn',
        id: t.id,
        detail: label + ': parentName ' + t.parentName + ' is a phase id, not a phase name'
      });
    }
    const deadline = parseDL(s.projectDeadline);
    if (deadline) {
      if (start && start > deadline) {
        out.push({
          severity: 'warn',
          id: t.id,
          detail: label + ': starts after the project deadline ' + s.projectDeadline
        });
      } else if (end && end > deadline) {
        out.push({
          severity: 'warn',
          id: t.id,
          detail: label + ': finishes after the project deadline ' + s.projectDeadline
        });
      }
    }
    if (t.isPhase) {
      const kids =
        (t.id ? childCount['id:' + t.id] || 0 : 0) +
        (t.name ? childCount['name:' + t.name] || 0 : 0);
      if (!kids) {
        out.push({ severity: 'warn', id: t.id, detail: label + ': phase has no child tasks' });
      }
    } else {
      if ((t.startDate || t.endDate) && !t.duration) {
        out.push({
          severity: 'warn',
          id: t.id,
          detail: label + ': has dates but no duration, so the schedule engine skips it'
        });
      }
      if (t.milestone && !t.endDate) {
        out.push({ severity: 'warn', id: t.id, detail: label + ': milestone has no date' });
      }
      if (t.milestone && t.duration) {
        out.push({
          severity: 'warn',
          id: t.id,
          detail: label + ': milestone carries a duration; use the date instead'
        });
      }
    }
    (Array.isArray(t.predecessors) ? t.predecessors : []).forEach(function (p) {
      if (!ids[String(p)]) {
        out.push({
          severity: 'fail',
          id: t.id,
          detail: label + ': predecessor ' + p + ' does not exist'
        });
      }
      if (String(p) === String(t.id)) {
        out.push({ severity: 'fail', id: t.id, detail: label + ': depends on itself' });
      }
    });
  });

  const lines = Array.isArray(s.budgetLines) ? s.budgetLines : [];
  lines.forEach(function (l) {
    if (!l) {
      return;
    }
    if ((+l.planned || 0) <= 0) {
      out.push({
        severity: 'warn',
        id: l.id,
        detail: (l.name || l.category || l.id) + ': budget line has no planned amount'
      });
    }
    const link = l.linkedTaskId || l.taskId;
    if (link && !ids[String(link)]) {
      out.push({
        severity: 'warn',
        id: l.id,
        detail: (l.name || l.category || l.id) + ': linked task ' + link + ' does not exist'
      });
    }
  });

  const resources = Array.isArray(s.resources) ? s.resources : [];
  resources.forEach(function (r) {
    if (!r) {
      return;
    }
    if (!(+r.rate > 0)) {
      out.push({ severity: 'warn', id: r.id, detail: (r.name || r.id) + ': resource has no rate' });
    }
  });
  if (sch.cycles.length) {
    out.push({
      severity: 'fail',
      id: sch.cycles[0],
      detail: 'predecessor cycle through ' + sch.cycles.join(', ')
    });
  }

  return out;
}
