# UI & UX wave — canonical checklist (2026-11-20)

Single tickable list for every plan the owner placed in the codebase. Tick a box
only when verified (build + gate + manual pass) and append the commit hash + gate
result, following `docs/history/REFINEMENT-PROGRESS.md:23-28`.

## Status legend
`- [ ]` OPEN · `- [~]` IN PROGRESS · `- [x]` DONE (commit hash + gate) · `- [?]` NEEDS OWNER DECISION · `- [-]` PLANNING ONLY (no code)

Source plans:
- `docs/UI-POLISH-WAVE-PLAN-2026-11-20.md` (areas A-P) — **this wave's active work**
- `UX-REFINEMENT-DIRECTIVE-2026-11-19.md` (Parts A-D) — **shipped**
- `master_ui_spatial_theme_parity_specification.md` (Phases 1-4) — **shipped**
- `docs/MCP-CONTRACT.md` "Connector compatibility research" (gaps G1-G6) — **planning only**

---

## 1. UI polish wave (A-P) — ACTIVE

- [x] **A. Sparkle → My Manager brand icon** (full audit) — `:36` — `792adaa` (`npm run verify` green; `qa-full` 196/196; `verify-icons` ARM 3: 0 generic `i-sparkle` across 205 served files)
- [x] **B. Definition pills / methodology popup** — `:42` — `0fcb4d8` (`npm run verify` green; group pill dropped from tooltip + glossary, hover card click-through)
- [x] **C. AI panel "Disconnected" chip** — `:47` — `0fcb4d8` (`qa-ai` AI23_GATE PASS 0 fails, `qa-ai-polish` 13/13; harnesses re-baselined onto banner + canonical state + Send gate)
- [x] **D. Old-project ring** — per-main-task equal-width segments — `:51` — `c8c9270` (`node --test test/major-groups.test.mjs` 15/15 incl. 4 flat cases; `tools/qa-dashboard-ring.cjs` 52/52 incl. D1-D7; `qa-full` 196/196; `npm run verify` green)
- [x] **E. Tours** — remove gold ring, full-target spotlight, smooth scroll, centred intro — `:57` — `7bed291` (`qa-tour` 61/61; `qa-first-project-tour` 13/13; `qa-calculator-page` 256/256; `qa-ux-landscape` 58/58; `qa-full` 196/196; `npm run verify` green)
- [x] **F. Theme available without sign-in** — `:64` — `0fcb4d8` (`npm run verify` green; signed-out Customize probe PASS, modal opens with no redirect; CSP hashes regenerated)
- [x] **G. Gantt chart** — today legend, sticky header, drag-to-pan, auto-cascade — `:69` — `67f60ae` (`qa-gantt-cascade` 9/9 new; `qa-full` 196/196; `verify-gantt-view` 125/125; `qa-date-wiring` 13/13; `npm run verify` green; registry + `ci.yml` T4 wired, `verify-ci-coverage` 12/12)
- [x] **H. Sidebar active-section highlight** — `:79` — `2660d78` (`qa-full` 196/196; check 39f: `#app-sidebar .sec-btn.active` after `showSec('chg')`)
- [x] **I. RACI matrix UI pass** — `:83` — `c217e53` (`qa-raci-matrix` 11/11 new; `qa-full` 196/196; `npm run verify` green; registry + `ci.yml` T4 wired)
- [ ] **J. Photo description + undersized inputs** — `:93`
- [x] **K. Status-chip outline** — remove border, keep arrow — `:101` — `0fcb4d8` (`npm run verify` green; CSS source + dist rebuilt)
- [x] **L. Project on-hold notice** — in-app banner + finalize gate — `:106` — `7a6f293` (`qa-onhold-gate` 8/8 new; `qa-full` 196/196; `npm run verify` green; registry + `ci.yml` T4 wired; acknowledgement is per-project localStorage, front-end only)
- [x] **M. Perf-mode + dark sidebar transparency** — `:114` — `0fcb4d8` (`npm run verify` green; opaque fallback on `.db-side`)
- [x] **N. Cookie-consent polish** — remove gold outline — `:119` — `0fcb4d8` (`npm run verify` green; neutral hover/currentColor focus, marketing.css kept under its byte cap)
- [ ] **P. Admin MCP panel + chrome-free controls** — `:129`
- [x] **Q. Pricing copy: 33% off code + trials on all plans** — owner addition 2026-11-22 — `6f810c2` (`npm run verify` green; promo code `KRAFO0TJEO`, 33% until June 2027, free trial on every paid plan; text only, no billing logic)

## 2. UX refinement directive (Parts A-D) — SHIPPED

All steps PASS in `docs/UX-DIRECTIVE-LOG.md`; merged to `main` in `a97838a`
(and the per-step commits below). Do not re-implement.

- [x] **Part A** — landscape/short-screen, tour card, 44px targets, sign-out confirm, view-only AI, landing copy, theme check — `1898da3`, `d27f133`, `232a67f`, `75ac0c7`, `b561da9`, `f3d1d10`, `0e5729c`
- [x] **Part B** — major-task module, stable colors, segmented ring, contributors list, nav helper + links, color carry-through — `6857909`, `f5e3a15`, `44ebcc8`, `f7e3536`, `9ca5c8a`, `36b5f8a`
- [x] **Part C** — seam wave, card motion, 3D role cards + SVG fallback — `38cc45f`, `317863e`, `a97838a`
- [x] **Part D** — harnesses wired to CI, docs + final report — `9fc4b59`, `a97838a`

## 3. Theme/spatial parity spec (Phases 1-4) — SHIPPED

- [x] **Phase 1-4** — skin polarity + `--sidebar` token parity, tokenised spacing, rail 272px, anti-slop cleanup — `1b0da2f`, PR #26 (`f70dc1c`)

## 4. MCP connector compatibility research — PLANNING ONLY

`docs/MCP-CONTRACT.md` "Connector compatibility research: ChatGPT and Gemini
(2026-11-20)". No code changed. Gaps to action only after a real vendor probe:

- [-] **G1** Refresh-token rotation (Gemini silent reconnect) — High
- [-] **G2** DCR request shape unverified (Gemini secret) — Blocker until observed
- [-] **G3** `offline_access` not advertised/accepted (ChatGPT) — Medium
- [-] **G4** No revocation endpoint — Low
- [-] **G5** No CIMD support — Low (future)
- [-] **G6** `resource`/audience ignored — Low

> Note: section P's admin copy change names ChatGPT/Gemini with their real plan
> limits from this research; that copy change is part of this wave, the server
> gaps G1-G6 are not.

---

## Verification gates (this wave)

- [ ] `node build.js` → `npm run verify` (CSP + SW + registry + size gates)
- [ ] Targeted harnesses: `qa-full`, tour harnesses, `verify-gantt-view`, `qa-date-wiring`, `qa-project-photos`, `qa-consent`, `verify-perf-boot`, `qa-glass`, `qa-mcp-admin-panel`, `qa-billing-orphan`, major-groups unit test, sidebar + RACI checks
- [ ] Manual browser pass (owner decisions already recorded in the plan file)
- [ ] Conventional commits (no AI credit), push branch, PR → CI GREEN → merge to `main` (AGENTS #10)
