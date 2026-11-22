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

- [ ] **A. Sparkle → My Manager brand icon** (full audit) — `docs/UI-POLISH-WAVE-PLAN-2026-11-20.md:36`
- [ ] **B. Definition pills / methodology popup** — `:42`
- [ ] **C. AI panel "Disconnected" chip** — `:47`
- [ ] **D. Old-project ring** — per-main-task equal-width segments — `:51`
- [ ] **E. Tours** — remove gold ring, full-target spotlight, smooth scroll, centred intro — `:57`
- [ ] **F. Theme available without sign-in** — `:64`
- [ ] **G. Gantt chart** — today legend, sticky header, drag-to-pan, auto-cascade — `:69`
- [ ] **H. Sidebar active-section highlight** — `:79`
- [ ] **I. RACI matrix UI pass** — `:83`
- [ ] **J. Photo description + undersized inputs** — `:93`
- [ ] **K. Status-chip outline** — remove border, keep arrow — `:101`
- [ ] **L. Project on-hold notice** — in-app banner + finalize gate — `:106`
- [ ] **M. Perf-mode + dark sidebar transparency** — `:114`
- [ ] **N. Cookie-consent polish** — remove gold outline — `:119`
- [ ] **P. Admin MCP panel + chrome-free controls** — `:129`

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
