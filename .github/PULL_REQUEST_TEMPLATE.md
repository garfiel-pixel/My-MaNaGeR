## What changed

<!-- Describe the change in plain language. Link the issue if there is one. -->

## Why

<!-- The problem this solves, or the user-visible effect. -->

## Verification

<!-- Commands run and their outcome, e.g. `npm run verify`, `qa-ai.cjs`. -->

## Checklist

- [ ] All work is on a feature branch; `main` was not used as the working branch.
- [ ] The PR title is a valid Conventional Commit (`type(scope): subject`).
- [ ] `npm run verify` passes locally, plus the relevant `qa-*.cjs` / `tools/qa-*.cjs` harnesses.
- [ ] PR CI is green before merge; a red branch is fixed on the branch, never merged.
- [ ] No AI-assistant credit footer (`Co-Authored-By`, `Generated with`) in any commit.
- [ ] Served pages contain no emoji; icons are SVG sprite symbols only.
- [ ] If an inline `<script>` changed, the CSP SHA-256 hashes in `worker.js` and `serve.cjs` were regenerated.
- [ ] If a shell asset changed, `sw.js` `CACHE` version was bumped.
- [ ] Offline-first behaviour is preserved and cloud sync stays opt-in per project.
- [ ] Any new or re-baselined harness is registered in `docs/CI-TEST-COVERAGE.md` and wired into CI.
- [ ] No secrets, credentials or personal data are included in the diff.

## Screenshots

<!-- For UI changes: light and dark mode, narrow and wide viewport. Delete this section if not applicable. -->
