# Directive — scheduled Calculator plan-v2 phases + billing book work

Standing backlog for phases still to come. Each block names the owner of the
next session, the phase's plan scope, and what's blocking it.

---

## PLAN V2 — phases (per `Calculator_Trade_Expansion_Plan_v2.pdf`)

### Phase 0 — Golden-case baseline for all trades (DONE)
- 52 gates / 49 cases; CI green; deployed; production-verified.
- Commit: `30285d0`.

### Phase 1 — E1–E6 foundations (DONE)
- Currency honesty, variants, unit adapter + unit-slip guard, rate books, labour mode, golden extension.
- Commit: `1e8b7b1`. CI green. Deployed (Version `6d7666d6` at that time).

### Phase 2 — Concrete chain G1/G4/G5/G7/B1 (DONE)
- Formwork 8 variants (inherited), rebar-size per lb, stirrups per dozen, fabric-mesh per yd2,
  concrete-labour labour-only, excav 10 soils, blockwall 3 blocks, picker 38 trades.
- Commit: `6527a99`. CI green. Deployed.

### Phase 3 — Access and metal (SCHEDULED)
- G2 scaffolding: 8 height-band variants ("to 10 ft unbraced; 10-20, 20-30, 30-40, 40-50,
  50-60, 60-70, 70-80 ft tied to building"), unit ft2 (JIC ft2-denominated), runit 'ft2'.
- G3 welding and metal cutting: 9 variants by method+thickness
  ("torch 1/8, 1/4, 3/8, 1/2, 5/8, 3/4, 1 in; CPSAW 1/16 and 1/8 in"), per-cut quantity,
  runit null (count each); cost scales by thickness.
- New family **Temporary and metal works** in WORK_FAMILY + picker group; must show in the
  family filter and hide no old item (DoD #1).
- Exit gates: every height band and thickness passes; new family shows in the filter and
  hides no old item; every variant has a passing golden case (metric; the phase table's
  "metric and imperial" rule applies to the new height/thickness bands as the sheet speaks ft/in).
- DoD items: dimension labels correct metric and imperial; rate book/family/order per the sheet;
  waste default where the work has waste; companion suggestions (scaffolding with high walls);
  save/recall/history/bill/estimate round-trip; print/CSV/quote layout; light+dark, no inline
  scripts, no emoji.
- Audit catch applied here: all rates now entered through the corrected entry-per-engine
  `RATE_UNITS` (fix f90d597: yd2 1.19599005, ft2 10.7639104, ft run 3.2808399, kg 1000).

### Later phases (per the PDF)
- Phase 4 (Finishes G6 tiling/terrazzo, G8 painting, G11 skirting, B6/B5) ...
- Phase 5 (Services G9 plumbing ft run, G10 conduit) ...
- Remaining trades B2/B3/B4/B7/C1–C5/C8/C9 ...
- Section 7 (X1 estimate linter — already shipped as the X1 directive), X2 uncertainty ranges,
  X3 provenance/share link ...
- Section 8 (X5 quick-add parser, X6 measure-on-plan, X7 assemblies) ...
- Section 9 (X8 estimate-to-project handoff) ...
- Section 10 (X4 learn-from-actuals, X10 Jamaica intelligence, X11 carbon optional) ...
- Section 11 (X12 self-updating offline install, X13 accessibility/language, final regression) ...

---

## BILLING
### Paddle sandbox walkthrough (SCHEDULED — owner is executing)
- Saved to `docs/superpowers/specs/2026-10-02-paddle-sandbox-walkthrough.md`.
- Framework complete and verified at 83/83 gates. Awaiting: product + price IDs, webhook
  destination secret key, API key (from the owner's Paddle account).
- Incorporate once the secrets are set; verify the full sandbox round-trip (checkout → payment
  → signature → entitlement) before retiring LemonSqueezy.

### JMD rate book keying (SCHEDULED — BLOCKED)
- Owner: drop the JIC extract in the repo (expected PDF/xlsx/csv at the repo root or in
  Downloads). Status: not in the repo yet (git clean except the owner's scheduled-phases file).
- Schema is ready: `importBooks` validates `{books:[{name, currency:'JMD', effective_from/to,
  rates:{workKey:{variantIdOr'*':{mat,lab,unit}}}}]}` with a djb2 checksum; unknown keys,
  negative rates, and checksum mismatches are rejected and counted. Guardrails: golden cases
  + the BOOK gates in the harnesses.
- Until it lands: managed-rates research bands (2026, sources cited in code comments) are in
  the JMD book placeholder and the rate defaults on the new trades.

---

## How to continue
Each phase is a self-contained wave: harness gates (add/re-baseline) + registry + execution
record + commit (Conventional Commits, no AI footer) + push + CI poll + deploy + production
smoke. No session ever mixes a blocked item into a shipped wave.
