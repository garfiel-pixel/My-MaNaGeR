/* ============================================================
   MCP AUTO-ACCEPT POLICY — pure eligibility check
   ------------------------------------------------------------
   MCP-AGENT-FIRST 2026-11-12 6.2. Auto-accept is the ONE sanctioned way a
   proposal can reach live state without an owner click, so the rule that
   decides eligibility is a pure function that can be tested exhaustively
   without a database or R2.

   The policy is per API key (`cloud_api_keys.auto_accept`, OFF by default)
   and fixed: there is no per-project or per-field configuration, and the
   allowlist below is the whole of it. Anything not named here queues for the
   owner exactly as before.

   Two invariants matter more than the allowlist itself:
     1. A proposal is eligible only if EVERY op is eligible. One disallowed op
        sends the WHOLE proposal to the queue - auto-accept never applies a
        subset and leaves the rest behind, because the owner would then see a
        proposal whose applied half is already live and whose remaining half
        would be applied twice.
     2. Eligibility is decided from the op list alone. The accept engine still
        runs afterwards and can refuse (conflict, stale, busy); a refusal
        leaves the proposal pending, never half-applied.
   ============================================================ */

import { fieldSpec } from './model.js';

// The one value that turns the policy on. Stored as text so a future policy
// level is an additive value, not a boolean migration.
export const AUTO_ACCEPT_LOW_RISK = 'low-risk';
export const AUTO_ACCEPT_OFF = 'off';

// A proposal above this many ops always queues: a bulk edit is exactly the
// case an owner should see before it lands.
export const AUTO_ACCEPT_MAX_OPS = 50;

// Fixed allowlist: free-text fields whose worst case is a wrong sentence in a
// note, which the owner can edit or revert. Paths without the named field in
// the model are inert - the plan validator never produces such an op.
export const AUTO_ACCEPT_ALLOWLIST = {
  tasks: ['notes'],
  resources: ['notes'],
  meetings: ['notes'],
  documents: ['notes'],
  stakeholders: ['notes'],
  commsEntries: ['notes'],
  risks: ['mitigation', 'notes']
};

// A text field means a plain string: no enum (a status by another name), no
// date, no derived value the app recomputes.
function isFreeText(path, name) {
  const spec = fieldSpec(path, name);
  return !!spec && spec.type === 'string' && !spec.enum && !spec.date && !spec.derived;
}

function allowedField(path, name) {
  const fields = AUTO_ACCEPT_ALLOWLIST[path];
  return !!fields && fields.indexOf(name) !== -1;
}

// Returns { eligible: boolean, reason: string }. `reason` is for the directive
// log and tests, never shown to an agent: an agent must not be able to probe
// which of its ops would have auto-applied.
export function autoAcceptEligible(ops, auth) {
  if (!auth || auth.autoAccept !== AUTO_ACCEPT_LOW_RISK) {
    return { eligible: false, reason: 'policy off' };
  }
  if (!Array.isArray(ops) || !ops.length) {
    return { eligible: false, reason: 'no ops' };
  }
  if (ops.length > AUTO_ACCEPT_MAX_OPS) {
    return { eligible: false, reason: 'more than ' + AUTO_ACCEPT_MAX_OPS + ' ops' };
  }
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (!op || op.op !== 'set') {
      return { eligible: false, reason: 'op ' + i + ' is not a set' };
    }
    if (!op.path || !op.field) {
      return { eligible: false, reason: 'op ' + i + ' does not target one field' };
    }
    if (op.recordId == null || op.recordId === '') {
      return { eligible: false, reason: 'op ' + i + ' does not target one record' };
    }
    if (!allowedField(op.path, op.field)) {
      return { eligible: false, reason: 'op ' + i + ' targets ' + op.path + '.' + op.field };
    }
    if (!isFreeText(op.path, op.field)) {
      return { eligible: false, reason: 'op ' + i + ' is not a free-text field' };
    }
    if (typeof op.after !== 'string') {
      return { eligible: false, reason: 'op ' + i + ' is not a string value' };
    }
  }
  return { eligible: true, reason: 'low-risk' };
}
