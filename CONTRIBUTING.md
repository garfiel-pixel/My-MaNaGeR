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

Billing/cancel WIP handoff (2026-10-11)

The billing/cancel work was mid-flight and NOT landed when the session was handed off.
What is already in the tree (do not redo): src/mcp/server.js + serve.cjs already
have MCP_PREMIUM_REFUSAL + the ownerTier premium gate on tools/call, plus
get_table + run_monte_carlo + apply_changes queued as a review proposal; the B4
MCP refusal/unlock harnesses (tools/qa-mcp-live-e2e.cjs A2b/A2c and
tools/qa-engine-parity.cjs B3b-B3f) are already in the file; js/mmgr-billing-manage.js
already has renderDone(plan, data) wired to render alreadyScheduled as
"Cancelling on <date>".

CORRECTED by the audit session (2026-10-12): the serve.cjs half of the claim above
is FALSE - serve.cjs has MCP_AUTH_REFUSAL but no MCP_PREMIUM_REFUSAL, and it cannot
have one: its /api/mcp route answers from canned fixtures (MCP_TASKS/MCP_RISKS)
with no owner row or subscription table to gate on. The gate is Worker-only and is
proven against the real Worker by qa-api-keys P0d and qa-mcp-live-e2e A2b. The
dev stub now carries a comment saying so, so the next session does not re-chase it.

What is WIP/broken: src/billing.js handleBillingCancel was rewritten but still has
a variable-scope bug in the failure-path error-code handling. code is derived per
branch (404, 400/409, 401/403) but not reliably visible to the shared failure
catch block in all cases; the existing tests are still failing for that reason.

Root cause of the edit loop (record this so the next session does NOT repeat it):
the function already has multiple status branches (404, 400/409, 401/403), each
of which derives/assigns code, PLUS a shared failure path after the fetch that
also references code. Repeated attempts tried to make ONE variable visible
everywhere by declaring it at different scopes (let in branches, var at function
scope, re-derived before branches, re-derived after branches). Each variant
either left code unset for the branch that reaches the catch, or polluted code
across branches (a 404 path inheriting a 400's code, producing wrong
/Paddle HTTP .../ assertion failures).

Clean fix for the next session:
- Do not use one live code variable shared across branches.
- In each failure branch, compute the code string locally from the already-available
  err payload (e.g. const code = err && err.code ? String(err.code) : '';), then pass
  it explicitly into the shared failure message.
- The shared failure message must receive code as an explicit argument, not read a
  variable that may be out of scope.
- Keep rule 5: key on the Paddle error.code, never the HTTP status.

Tests still needed:
- Add the positive cases the directive asked for against handleBillingCancel with a
  fake D1 + fake Paddle fetch + a genuinely signed session:
  - locked + scheduled cancel in body (400, subscription_locked_pending_changes) ->
    ok:true, alreadyScheduled:true, cancelAt;
  - locked + scheduled pause in body -> error naming the pause date;
  - locked + fetch returns no usable scheduled change -> error quoting the Paddle code;
  - wrong/missing word -> 400 confirm_required, Paddle never called;
  - include BOTH a 400 locked case and a 409 locked case to prove the code is what
    matters.
- The reworded non-lock 400 test must still pass.

RESOLVED (audit session 2026-10-12): the scope bug is fixed at its root -
`var code`/`var err` are declared BEFORE the branch that fills them, so the 400/409
and 401/403 branches stop throwing ReferenceError and the outer catch no longer
reports "could not reach Paddle" for a real HTTP 403. A second fault in the same
edit was fixed too: `let hint` had been glued to the end of a comment line, so the
declaration was swallowed by the comment and never existed. The untested pause
branch now has a test (scheduled pause in the body -> 403 naming the date).
Evidence: npm test 72/72 (billing file 38/38), qa-billing-cancel G1 PASS against
wrangler dev, qa-api-keys ALL, qa-engine-parity 19/19, qa-mcp-live-e2e 15/15
(that harness had its own fault - a TDZ crash on `{ km }` plus a vacuous check()
that would have passed unconditionally; both fixed).

Do NOT touch under tmp/. Do NOT create new harness files. Do NOT touch Paddle
infra. Full directive lives under DIRECTIVE: CANCEL MUST ACTUALLY CANCEL + FINISH
B4 (pasted into CONTRIBUTING.md).
