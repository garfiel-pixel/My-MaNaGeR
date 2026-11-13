/* MCP-AGENT-FIRST addendum A3 (2026-11-13): cross-proposal dependencies.

   A key's proposals are validated against live state OVERLAID with that same
   key's still-pending ops, so a proposal may build on one it queued earlier.
   When a proposal targets a record that only exists because a pending
   proposal creates it, it records `dependsOn` so:
     - a single accept can refuse until its dependency lands
       (DEPENDS_ON_PENDING), and
     - withdrawing a depended-on proposal is refused (it would strand the
       dependent).
   Accept-all applies a change set in id order, so the dependency is applied
   first. */

import { applyOps } from '../cloud/apply-ops.js';

function parseOpsEnv(opsJson) {
  let env = null;
  try {
    env = opsJson ? JSON.parse(opsJson) : null;
  } catch (e) {
    env = null;
  }
  if (Array.isArray(env)) {
    return { ops: env, dependsOn: [] };
  }
  return {
    ops: env && Array.isArray(env.ops) ? env.ops : [],
    dependsOn: env && Array.isArray(env.dependsOn) ? env.dependsOn : []
  };
}

// Overlay the given pending rows' ops onto live state (via the same pure
// accept engine) and remember which proposal created each record id.
export function buildOverlay(liveState, pendingRows) {
  const proposals = [];
  const createdBy = Object.create(null);
  (pendingRows || []).forEach(function (row) {
    const parsed = parseOpsEnv(row.ops_json);
    if (!parsed.ops.length) {
      return;
    }
    let scope = [];
    try {
      scope = row.scope ? JSON.parse(row.scope) : [];
    } catch (e) {
      scope = [];
    }
    // Overlay ONLY the create ops. A pending record must be resolvable so a
    // later proposal can target it (the cross-proposal dependency), but a
    // pending SET must NOT be pre-applied here: doing so would make a re-sent
    // identical set look like a no-op and break the idempotent-retry contract
    // (R08/R08b - a retry returns the first proposal, a >10-minute resend
    // queues a new row). Creates are additive and never erase a change.
    const creates = parsed.ops.filter(function (op) {
      return op && op.op === 'create';
    });
    if (creates.length) {
      proposals.push({ id: row.id, scope: Array.isArray(scope) ? scope : [], ops: creates });
    }
    parsed.ops.forEach(function (op) {
      if (op && op.op === 'create' && op.record && op.record.id != null) {
        createdBy[String(op.record.id)] = row.id;
      }
    });
  });
  let state = liveState;
  if (proposals.length) {
    const applied = applyOps(liveState, proposals);
    if (applied && applied.next) {
      state = applied.next;
    }
  }
  return { state: state, createdBy: createdBy };
}

// Which pending proposals does this op list depend on? An op depends on a
// pending proposal when it targets (or deletes) a record that does not exist
// in live state but is created by that proposal.
export function computeDependsOn(ops, createdBy, liveState) {
  const deps = [];
  const seen = Object.create(null);
  const liveIds = Object.create(null);
  function liveHas(path, id) {
    if (!liveIds[path]) {
      const arr = liveState && Array.isArray(liveState[path]) ? liveState[path] : [];
      const set = Object.create(null);
      arr.forEach(function (r) {
        if (r && r.id != null) {
          set[String(r.id)] = true;
        }
      });
      liveIds[path] = set;
    }
    return !!liveIds[path][String(id)];
  }
  (ops || []).forEach(function (op) {
    if (!op || op.recordId == null) {
      return;
    }
    const id = String(op.recordId);
    const owner = createdBy[id];
    if (owner != null && !liveHas(op.path, id) && !seen[String(owner)]) {
      seen[String(owner)] = true;
      deps.push(owner);
    }
  });
  return deps;
}

export function dependsOnIds(opsJson) {
  return parseOpsEnv(opsJson).dependsOn;
}
