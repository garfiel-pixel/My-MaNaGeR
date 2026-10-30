# CLAUDE.md

**Read `CONTINUATION-DIRECTIVE.md` first, then `EXECUTION-PLAN.md` for the build
order, then the newest `AUDIT-DIRECTIVE-*.md`. Do not open `docs/history/` unless a
task cites it.**

Then read **`AGENTS.md`** at the repository root - it is the single source of
truth for this project: mandatory skill loading from `.agents/skills/`,
project-critical rules (CSP hash regeneration, staging-copy deploys,
offline-first), and the editing/verification workflow.

Skills live in `.agents/skills/<name>/SKILL.md` and are locked via
`skills-lock.json`.
