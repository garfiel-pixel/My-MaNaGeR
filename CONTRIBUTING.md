# Contributing

Thanks for working on **My MaNaGeR**. This is an offline-first construction
project-management workspace: a front-end monolith deployed as Cloudflare
Workers static assets (see `worker.js`, `wrangler.jsonc`, `migrations/`).

Before touching any code, read **`AGENTS.md`** - it is the single source of
truth: mandatory skill loading from `.agents/skills/`, the project-critical
rules (CSP hash regeneration, staging-copy deploys, offline-first), and the
editing/verification workflow.

## Commit messages

All commits follow the **Conventional Commits** style - the full history was
normalized to this format, and every new commit should match it.

### Format

```
type(optional scope): short imperative subject
```

- **Types:** `feat`, `fix`, `chore`, `test`, `docs`, `refactor`, `perf`,
  `build`, `ci`, `revert`
- **Subject:** imperative mood, ≤ 72 characters, no trailing period, no emoji,   no SCREAMING-CASE titles. Say what the change does, briefly - this is a
  task title, not a changelog dump.
- **Body (optional):** a blank line, then the detail. Keep specifics (file
  lists, QA harnesses, version bumps) out of the subject line.
- **Breaking changes:** add `!` after the type/scope (`feat!:` or
  `feat(cloud)!:`) and/or a `BREAKING CHANGE:` footer.

### Examples

| Good | Bad |
|---|---|
| `fix: clear AI question input after successful send` | `Push complete My MaNaGeR application codebase updates` |
| `feat: theme system, mobile nav drawer, and changelog UI sweep` | `Update codebase with live health check, mouse glow, and AI window integration` |
| `test: prefs round-trip E2E harness for /api/cloud/prefs/theme` | `more stuff` |   | `docs: add conventional commit convention` | `feat: THEME-SYSTEM + MOBILE-DRAWER + CHANGELOG-UI SWEEP - huge one-line dump of every detail` |

### Enforcement hook

A zero-dependency `commit-msg` hook lives at `.githooks/commit-msg`. Enable it
once per clone:

```bash
git config core.hooksPath .githooks
```

It rejects subjects that aren't valid conventional commits: unknown/missing
type, missing `: ` separator, trailing period, or over 72 characters. Merge,
revert, `fixup!` and `squash!` subjects are allowed through. For a rare
one-off, bypass with:

```bash
git commit --no-verify
```

## Workflow

1. Load the skills `AGENTS.md` requires and follow them.
2. Make minimal, convention-respecting changes.
3. Verify before pushing: `npm run verify` plus the relevant `qa-*.cjs` /
   `tools/qa-*.cjs` harnesses.
4. Commit with a conventional message (the hook checks it). Don't rewrite
   history that already exists on `origin` without a force-push plan - and if
   you do force-push, only change what you intended (e.g. commit messages),
   never files or infrastructure.

## Extraction refactors (splitting monolith files into modules)

The app's rendering, app, and cloud logic is being split from monolith files
(`mmgr-render.js`, `mmgr-app.js`, `mmgr-cloud.js`) into per-domain modules
(`js/render/*.js`, `js/app/*.js`, `js/cloud/*.js`). Every extraction follows
the same pattern:

1. **Move the real implementation** into the new module file.
2. **Replace the original** with a one-line delegating wrapper:
   ```js
   function extractedName() {
     if (ns.RenderXxx) ns.RenderXxx.extractedName();
   }
   ```
3. **The final `ns.Render = { ... }` (or `ns.App`/`ns.Cloud`) export object
   must still reference the wrapper's name** -- it should already be there.

The static gate `node tools/verify-render-exports.cjs` (wired into `npm run
verify`) catches any function that was extracted but never got a wrapper. Run
it before committing any extraction-style refactor.
