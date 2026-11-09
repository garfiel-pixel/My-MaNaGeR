-- 0034_budget_approver (H-7, BUDGET-BOQ-MCP-DIRECTIVE-2026-11-05).
--
-- Q3 default: the owner approves budget changes; editors propose; the owner
-- may name ONE budget approver in team settings. The flag lives on the
-- membership row so a role change or a revoke takes the approval right with
-- it, and the server reads this column on every decision - the UI toggle is
-- never the enforcement.
ALTER TABLE cloud_team_members ADD COLUMN budget_approver INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_team_budget_approver
  ON cloud_team_members (project_id, budget_approver, status);
