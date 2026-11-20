/* ============================================================
   MCP TIER LIMITS (MCP-FINAL F2.1, 2026-11-16)
   ------------------------------------------------------------
   One frozen table, one lookup. Every MCP limit follows the PROJECT
   OWNER's plan - never the caller's - and the app-wide server uses the
   account owner's plan. An unrecognised paid tier is treated as
   contractor (the billing code treats an unknown paid tier as paid,
   never as free); an empty/absent tier is free.

   Values are the owner's published plan matrix. This table is the ONLY
   place they are written down: pricing.html is checked against it by
   tools/qa-pricing-parity.cjs, so a plan change edits this file and the
   page together.
   ============================================================ */

const FREE = Object.freeze({
  tier: 'free',
  mcp: false,
  activeApiKeys: 2,
  pendingPerKey: 0,
  dailyOpsPerKey: 0,
  maxOpsPerCall: 0,
  largeBudgetPerDay: 0,
  reportRetentionDays: 30
});

const ESTIMATOR = Object.freeze({
  tier: 'estimator',
  mcp: true,
  activeApiKeys: 2,
  pendingPerKey: 10,
  dailyOpsPerKey: 300,
  maxOpsPerCall: 100,
  largeBudgetPerDay: 5,
  reportRetentionDays: 30
});

const CONTRACTOR = Object.freeze({
  tier: 'contractor',
  mcp: true,
  activeApiKeys: 5,
  pendingPerKey: 25,
  dailyOpsPerKey: 1000,
  maxOpsPerCall: 250,
  largeBudgetPerDay: 10,
  reportRetentionDays: 60
});

const COMPANY = Object.freeze({
  tier: 'company',
  mcp: true,
  activeApiKeys: 10,
  pendingPerKey: 50,
  dailyOpsPerKey: 3000,
  maxOpsPerCall: 500,
  largeBudgetPerDay: 20,
  reportRetentionDays: 90
});

const ENTERPRISE = Object.freeze({
  tier: 'enterprise',
  mcp: true,
  activeApiKeys: 25,
  pendingPerKey: 100,
  dailyOpsPerKey: 10000,
  maxOpsPerCall: 500,
  largeBudgetPerDay: 50,
  reportRetentionDays: 180
});

// Frozen so a handler cannot mutate the table a later request reads.
export const TIER_LIMITS = Object.freeze({
  free: FREE,
  estimator: ESTIMATOR,
  contractor: CONTRACTOR,
  company: COMPANY,
  enterprise: ENTERPRISE
});

export const PAID_TIERS = Object.freeze(['estimator', 'contractor', 'company', 'enterprise']);

// The upsell sentence is for the three plans that have a step above them.
// Enterprise gets none.
export function upsellFor(tier) {
  const t = String(tier || '').toLowerCase();
  if (t === 'estimator' || t === 'contractor' || t === 'company') {
    return ' A higher plan raises this limit (see /pricing).';
  }
  return '';
}

export function limitsFor(tier) {
  const t = String(tier || '')
    .trim()
    .toLowerCase();
  if (!t) {
    return FREE;
  }
  if (TIER_LIMITS[t]) {
    return TIER_LIMITS[t];
  }
  // A paid tier the table does not name yet (a legacy plan id, a new one
  // before this file catches up) is paid: contractor, never free.
  return CONTRACTOR;
}

// Close-out 3b (owner decision): raising low-risk auto-accept is a
// Company/Enterprise feature. Estimator and Contractor may still use MCP and
// the owner-reviewed proposal queue, but an agent may not land changes without
// the owner's click on those plans. The policy itself stays OFF by default on
// EVERY plan; this gate only decides whether an owner may turn it ON.
// An unknown paid tier reads as contractor (see limitsFor), so it is refused.
export function autoAcceptPlanAllowed(tier) {
  const t = limitsFor(tier).tier;
  return t === 'company' || t === 'enterprise';
}

// Effective per-call ceiling: the array's own cap, bounded by the tier's
// total-across-arrays cap.
export function perCallCap(arrayCap, limits) {
  const max = limits && Number(limits.maxOpsPerCall) >= 0 ? Number(limits.maxOpsPerCall) : 0;
  return Math.min(arrayCap, max);
}
