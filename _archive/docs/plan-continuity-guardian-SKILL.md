---
name: plan-continuity-guardian
description: Load this at the START and END of every work session on My MaNaGeR, before touching any other skill or any code. It maintains the single canonical registry of every plan/directive document that is supposed to govern this project, verifies each one actually exists in the repo (not just in someone's memory of a past chat), enforces that only ONE plan is being actively worked at a time — driven to 100% completion, verified against real code, before starting the next — and updates CONTINUATION-DIRECTIVE.md before the session ends. Use this whenever the user asks "what's next," "where are we," "update the continuation directive," references a plan by name, or when a session is about to end.
---

# plan-continuity-guardian

## Why this skill exists

This project has, at different points, had planning work happen in at least two
places that don't know about each other: **file-based plans committed to this
repo** (tracked in `CONTINUATION-DIRECTIVE.md`) and **plans that only ever
existed inside a chat conversation** and were never written to a file. The
second kind is invisible to any agent that only reads the repo — it silently
disappears the moment that chat session ends. That already happened once (see
§2, Registry). This skill exists to make that failure mode structurally
impossible going forward.

**Two rules this skill exists to enforce, non-negotiably:**

1. **Every plan that is supposed to govern this project must be a file in this
   repo.** A plan that lives only in a conversation is not a plan this project
   has — it's an idea that hasn't been committed yet. If the user references a
   plan by name and it is not in §2's registry with a ✅, stop and say so
   before doing anything else.
2. **Work one plan to 100%, verified, before starting the next.** Not "make
   progress on three things." One plan, driven to a state where every item in
   it is checked off AND independently verified against the actual shipped
   code (not taken on the plan document's word) — then, and only then, move
   to the next plan in priority order.

---

## 1. What to do at the START of a session

1. Read `CONTINUATION-DIRECTIVE.md` in full — its STATUS LOG section (most
   recent entry at top) is the source of truth for where things stand, not
   this skill file and not memory of a past conversation.
2. Read the Registry in §2 below. For every plan marked ✅ *tracked*, confirm
   it's also referenced somewhere in `CONTINUATION-DIRECTIVE.md`'s own
   "Referenced Files" table or Parts A–E. If a ✅ *tracked* plan is missing
   from that table, that's drift — add it to `CONTINUATION-DIRECTIVE.md`
   before doing anything else, don't just note it and move on.
3. Identify the CURRENT plan — the one in-progress, per the priority order in
   §3. Confirm no other plan is "in progress" at the same time. If more than
   one shows partial completion, that's a violation of rule 2 above — surface
   it to the user rather than silently picking one.
4. State plainly, before any other work: which plan is active, what % of its
   items are checked off, and what the next concrete unchecked item is.

## 2. Registry — every plan that is supposed to govern this project

**This table is the canonical list. Update it the moment a plan is created,
finished, or found to be missing — don't let it go stale.**

| Plan | Status as of 2026-08-12 | Notes |
|---|---|---|
| `FULL-GAP-AUDIT.md` | ✅ tracked, ✅ in repo, marked complete in CONTINUATION-DIRECTIVE.md Part A | Security/UX/a11y/code-quality gap audit |
| `CLOUD-BACKEND-ARCHITECTURE-PLAN.md` | ✅ tracked, ✅ in repo, marked complete, Part B | D1/R2/Workers cloud sync architecture |
| `MARKETING-AND-ACCESS-GATE-UPDATE-PLAN.md` | ✅ tracked, ✅ in repo, verified complete, Part D | Marketing copy + access-gate UX |
| `MINOR-UI-MODERNIZATION-POLISH-DIRECTIVE.json` | ✅ tracked, ✅ in repo, verified complete, Part D | Radius/select/focus/scrollbar polish |
| `AI-CLOUD-CONNECT-UI-AND-KEY-SECURITY-DIRECTIVES.json` | ✅ tracked, ✅ in repo, verified complete, Part D | AI key handling + connect UI |
| `ADMIN-PUBLISH-SYNC-AND-PROJECT-SELECT-POLISH-DIRECTIVES.json` | ✅ tracked, ✅ in repo, verified complete, Part D | Local-first creator access |
| `GEMINI-MODEL-FALLBACK-LADDER-DIRECTIVE.json` | ✅ tracked, ✅ in repo | Model fallback ladder for `/api/ai/chat` |
| `PROJECT-UX-NAV-WEATHER-EXPORT-DIRECTIVE.json` | ✅ tracked per CONTINUATION-DIRECTIVE.md, **not seen in the root file listing checked 2026-08-12 — reconfirm it's actually committed, don't assume** | Nav/weather/export UX (Part C1–C7) |
| `FINAL-PRE-DEPLOY-DIRECTIVE.json` | ✅ tracked per CONTINUATION-DIRECTIVE.md, **not seen in the root file listing checked 2026-08-12 — reconfirm** | Pre-deploy checklist (Part C8–C9) |
| `FIELD-GUIDE-UPDATE-PLAN.md` | ✅ tracked per CONTINUATION-DIRECTIVE.md, **not seen in the root file listing checked 2026-08-12 — reconfirm** | Field-guide sheet rewrite |
| `SIDEBAR-HAMBURGER-TOGGLE-PLAN.md` | ✅ **in the repo (untracked) as of 2026-08-12 PART-E session — confirmed by direct file check**; executed in full (2026-08-12 session log) | Desktop sidebar + hamburger |
| `BACKLOG.md` | ✅ in repo | General backlog — check against Registry entries above before adding anything here that duplicates a named plan. B-N (email preset) marked IMPLEMENTED + re-verified 2026-08-12 (qa-ai AI23_GATE PASS) |
| **`MASTER-ACTION-PLAN-v3-STRICT.md`** | ✅ **in the repo (untracked) as of 2026-08-12 — NOT committed; still needs a decision: commit-as-is or reconcile before execution** | 10-rank competitive plan. Rank 1 = Evidence/Claim Pack. Highest-priority plan per §3 — see §4 note (it exists now, unlike when this row was written) |
| `ACTION-PLAN-COMPETITIVE-GAPS.md` + `-v2-ADDENDUM.md` | ✅ both in repo as of 2026-08-12 — base RECONSTRUCTED as a faithful record (flagged as such) from the addendum's phase cross-refs + MASTER-ACTION-PLAN Rank 10 absorption notes | 25-gap competitive analysis vs. Asana/P6/Procore, superseded in ranking by MASTER-ACTION-PLAN |
| `STRUCTURAL-IA-FIXES-SPEC.md` | ✅ in repo + **FULLY VERIFIED IMPLEMENTED 2026-08-12** (§1 empty states on all 12+ panels incl. ring/N3/budget quieting; §2 nav groups ×12 + active-pill clarity; §3 session timer gone; §4 tier1 has-danger/tier3 quieting; §5 per-panel emptyStateRow with direct actions; §6 copy pass; §8 browser-verified on a brand-new project — ring "No tasks yet", budget "—", health-empty, zero sess-t) | Empty-state / nav-density fixes (CLOSED) |
| `_archive/` (2026-08-12) | 📦 moved out of the root: `new update do everything…` folder (CLAUDE-BUG-AUDIT + THEME-SYSTEM + UI-REDESIGN — all executed; §7 decisions formally closed below) + both stray session txts. Keep accessible, never delete. Excluded from deploy staging (`--exclude='_archive'`). | Housekeeping archive |
| `GLASS-UI-DESIGN-SPEC.md` | ✅ **in the repo (untracked) as of 2026-08-12** | Its content was built (glass tokens in `css/mmgr.css`); the file now exists as reference |
| `STRUCTURAL-IA-FIXES-SPEC.md` | ✅ **in the repo (untracked) as of 2026-08-12** | Empty-state / nav-density fixes — execution status still unconfirmed, trackable for real now |
| `MONOLITH-PORTING-GUIDE.md` | ✅ **in the repo (untracked) as of 2026-08-12** | Feature-porting guide from the old monolith build |
| `DASHBOARD-UI-REFRESH-SPEC.md` | ✅ **in the repo (untracked) + IMPLEMENTED + VERIFIED 100% (2026-08-12 PART-E session: qa-dashboard-spec 58/58, npm run verify green, browser @320/@1000 incl. no-h-scroll gate, renderMetrics from real rank() data, light mode untouched, zero console errors)** — §0 scope owner-confirmed in-file | Dark-dashboard color/layout spec for `app.html` (CLOSED) |

**Any time a plan is discussed in chat and it isn't in this table, add it to
this table in the same turn — don't let a new one start the cycle over
again.**

## 3. Priority order — work exactly one at a time, in this order

Per the user's explicit instruction: finish the competitive-differentiation
track to 100% before treating anything past it as anything other than a
future "update."

1. **Reconstruct and commit `MASTER-ACTION-PLAN-v3-STRICT.md` itself** —
   before its content can be executed, it has to exist as a file. Source it
   from the chat history that produced it (10 ranks; rank 1 = Evidence/Claim
   Pack, rank 2 = Weekly/Daily Digest Engine, rank 3 = Progressive
   Disclosure/Anti-Bloat, etc. — see the full rank list in prior chat
   summaries). Flag clearly in the committed file that it's a reconstruction
   from a chat summary, not the original verbatim document, since some
   specifics may not have survived summarization.
2. **Rank 1 — Evidence/Claim Pack** (claim/delay package, baseline-vs-actual
   delta with cause tags, LD exposure rollup) — drive to 100%, verified
   against shipped code, before starting rank 2.
3. **Rank 2 — Weekly/Daily Digest Engine + grounded AI presets.**
4. **Rank 3 — Progressive Disclosure/Anti-Bloat** (Core mode vs. Advanced
   packs, <60s time-to-first-task).
5. Ranks 4–10 in the order MASTER-ACTION-PLAN-v3-STRICT.md specifies, once
   reconstructed.
6. Only after rank 1–3 (the ranks the user singled out as "must be 100%
   before anything else is even discussed") — resume any open items from
   `CONTINUATION-DIRECTIVE.md`'s own remaining optional items (deploy, live
   OAuth round-trip) and the not-yet-reconfirmed files flagged in §2.
7. `DASHBOARD-UI-REFRESH-SPEC.md` and any other pure-polish work is explicitly
   an "update," per the user's own framing — it does not get worked on until
   1–5 above are 100% complete. If asked to work on it earlier, say so and
   confirm the user actually wants to jump the queue before proceeding.

## 4. Handling a plan that turns out to be missing (like §2's ❌ rows)

When this skill or any session discovers a plan is referenced but not
committed:

1. **Do not silently recreate it from scratch as if it were new work** — that
   erases the fact that planning work already happened. Reconstruct it from
   whatever record exists (chat history, prior session summaries) and say
   explicitly in the committed file that it's a reconstruction, noting what
   might be lossy about that.
2. **Commit it as an actual file in the repo root**, matching this project's
   existing naming convention (`ALL-CAPS-WITH-DASHES.md` or `.json` for
   machine-directives, per the existing files in §2).
3. **Add it to `CONTINUATION-DIRECTIVE.md`'s "Referenced Files" table**
   immediately, not at the end of the session.
4. **Add it to this skill's §2 Registry**, changing its row from ❌ to ✅ the
   moment it's actually committed — not when it's merely drafted.

## 5. What to do at the END of a session

This mirrors `CONTINUATION-DIRECTIVE.md`'s own existing STATUS LOG discipline
— this skill doesn't replace that mechanism, it makes sure it actually gets
used consistently and that the Registry above stays synced with it.

1. Update `CONTINUATION-DIRECTIVE.md`'s STATUS LOG with a new entry: what was
   completed (with file/line specifics — the level of precision already
   established throughout that file), what's in-progress and exactly where
   it stopped, what's next. A vague entry is not acceptable — match the
   precision of the existing log entries.
2. Update this skill's §2 Registry if any plan's status changed (created,
   completed, or found to be missing).
3. Re-state which single plan is next in §3's priority order, so the next
   session doesn't have to reconstruct that from scratch.
4. Run `npm run verify` and whatever `qa-*.cjs` harnesses are relevant to what
   was touched — per `AGENTS.md` rule 5 — before considering the session's
   work "done," not just "written."
5. Never mark a plan 100% complete on the strength of the plan document's own
   checklist alone — confirm against the actual shipped code, the same
   discipline `CONTINUATION-DIRECTIVE.md` already uses ("VERIFIED COMPLETE
   against actual shipped pages," not just "done per the plan").

## 6. Relationship to other skills

- Load `skeptical-code-audit` alongside this skill whenever verifying a plan
  item's "done" claim against actual code — this skill tracks *what* to
  verify and *in what order*; `skeptical-code-audit` is *how* to verify it.
- Load `universal-ui-architect` for any plan item that touches design tokens,
  contrast, or the glass system.
- This skill does not replace `AGENTS.md` — it's the layer above it that
  decides which plan's items are in scope for the current session, so
  `AGENTS.md`'s skill-loading table can be applied to the right task.
