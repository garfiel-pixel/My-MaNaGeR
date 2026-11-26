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

  return {
    overall: overall,
    // "Executable" means the plan can be managed against: no gate fails, no
    // cycle, and the work is either linked or small enough that a network adds
    // nothing (a single work item is a valid plan).
    executable:
      overall !== 'fail' &&
      schedule.cycles.length === 0 &&
      (schedule.links.edges > 0 || workItems.length <= 1),
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
export function buildLint(state) {
  const s = state || {};
  const tasks = Array.isArray(s.tasks) ? s.tasks : [];
  const out = [];
  const ids = Object.create(null);
  const childCount = Object.create(null);
  tasks.forEach(function (t) {
    if (t && t.id != null) {
      ids[String(t.id)] = true;
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

  return out;
}
