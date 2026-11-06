-- H-5 (BUDGET-BOQ-MCP-DIRECTIVE-2026-11-05): two budget switches per API key,
-- and the owner's reason on a review decision.
--
-- The section scope already says WHICH tables a key may touch. It cannot say
-- whether the key may see money or propose a change to it, so those are two
-- separate switches, both OFF until the owner turns them on (Q4). A key with
-- the budget section but neither switch can still read the other granted
-- sections - it just cannot read the budget or queue a budget change.
--
-- decision_note is what the owner typed when rejecting (or accepting with a
-- note). get_proposal_status hands it back to the AI client, so a rejected
-- proposal can explain itself instead of failing silently.
--
-- decision_edited records that the owner changed a value before approving
-- (H-6). The changelog keeps what was proposed and what was approved; this
-- flag lets the queue say "edited and accepted" in one word.
ALTER TABLE cloud_api_keys ADD COLUMN budget_read INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cloud_api_keys ADD COLUMN budget_write INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cloud_reviews ADD COLUMN decision_note TEXT;
ALTER TABLE cloud_reviews ADD COLUMN decision_edited INTEGER NOT NULL DEFAULT 0;
-- The validated, server-built budget proposal: kind, before, after, the amount
-- the SERVER computed, a plain one-line summary per change, and a flag for a
-- large change (Q5). The approval preview (H-6) reads this instead of trying
-- to reconstruct intent from a raw state diff.
ALTER TABLE cloud_reviews ADD COLUMN proposal_json TEXT;
