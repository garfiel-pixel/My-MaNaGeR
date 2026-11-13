/* H-5 budget access switches (BUDGET-BOQ directive 2026-11-05).
   Two switches, separate from the section scope and both OFF until the owner
   turns them on. The section decides what a key can see at all; these decide
   what it can do with money. An owner-code caller is not an API key and is
   never limited by them.

   Shared by the read tools (server.js) and the proposal planner (plan.js) so
   a key can never read through one surface what the other refuses. */

export const BUDGET_READ_REFUSAL =
  'This API key may not read the budget. The project owner can turn on "Read budget" for this key in Cloud, Share, API Keys. No budget figures are included in this answer.';

export const BUDGET_WRITE_REFUSAL =
  'This API key may not propose budget changes. The owner can turn on "Propose budget changes" for this key in Cloud, Share, API Keys. A proposal never changes a live figure - the owner approves it inside the project.';

export function budgetReadAllowed(auth) {
  return !auth || auth.role !== 'api' || auth.budgetRead === true;
}

export function budgetWriteAllowed(auth) {
  return !auth || auth.role !== 'api' || (auth.budgetRead === true && auth.budgetWrite === true);
}
