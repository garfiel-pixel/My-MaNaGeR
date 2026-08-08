# My MaNaGeR — QA Runbook

The app is a pure client-side SPA (localStorage + optional Open-Meteo), so all
verification is done by driving headless Chrome against a local static server.
Chrome must be installed at `C:\Program Files\Google\Chrome\Application\chrome.exe`
(the path is hard-coded in each `qa-*.cjs` harness).

## 1. Start the dev server

```bash
node serve.cjs        # serves the project on http://localhost:8765
```

Zero-dependency static server; dev tooling only. Keep it running while the
batteries run (each harness launches its own headless Chrome profile).

## 2. The gates (run after every phase)

```bash
node qa-p0.cjs     # PHASE 0 gate — date-edit fighting bug (13 checks)
node qa-p1.cjs     # PHASE 1 gate — tab-switch / def / persist / kanban / import (5)
node qa-v11.cjs    # PHASE 2/3 gate — flags / error log / Net retry / idempotent import / Config / AI dump (23)
node qa-ai.cjs     # RANK 2.3 gate — real model wiring: config tier toggle
                   #   (no schema change), local zero-key engine with per-line
                   #   trace (zero-fabrication), cloud OpenAI/Anthropic payloads
                   #   via mocked fetch, circuit-break, readonly gating (15)
node qa-r3.cjs     # RANK 3 gate — Core Mode vs Advanced Packs (3.1): new projects
                   #   Core-only, single-action pack toggles, readonly gate;
                   #   Viewport detection (3.4): one dismissible prompt per
                   #   device, simplified view + escape hatch, no re-prompt (13)
node qa-pwa.cjs    # RANK 4 gate — PWA manifest + cache-first SW registration,
                   #   IndexedDB crash journal (4.2: wiped-LS restore), and
                   #   100% offline core CRUD with network disabled (4.3) (9)
node qa-voice.cjs  # RANK 1.5 gate — voice capture: chunked IndexedDB persistence,
                   #   abrupt-kill durability, Tier 0 circuit-break, zero-AI
                   #   transcript extraction into Decision Log + promises,
                   #   Tier 1 offline whisper: DSP, circuit-break, retry (29)
                   # OPT-IN real offline pipeline (worker+wasm+model+decode):
RUN_WHISPER=1 node qa-voice.cjs   # ~1-2 min; proves the bundled whisper
                   #   runtime transcribes the reference jfk.wav end to end
                   #   through the real IndexedDB chunk path (T10-T12)
node qa-full.cjs   # full 148-check battery (schema v10 features + regressions)
```

Legacy probes (superseded by qa-p0, kept as focused regression probes):

```bash
node qa-focus.cjs  # focus/rebuild behavior on change-triggered re-renders
node qa-typing.cjs # WBS typing survives updTaskField re-render
```

Every harness exits 0 only when every check passes and prints a `PASS` line
(`P0_GATE PASS`, `QA SUMMARY: 148 passed / 0 failed of 148`, ...).

## 3. Phase gates

- **Phase 0 (P0 — date-edit fighting):** qa-p0.cjs installs render spies and
  drives REAL click events on WBS date inputs, selects and text fields to prove
  a date edit never rebuilds the WBS row, never recreates the input, never
  preventDefaults the native picker, and leaves adjacent fields editable.
- **Phase 1 (interaction correctness):** qa-p1.cjs covers Charter repaint on tab
  switch, Definitions panel paint, theme+crosshair persistence across a hard
  refresh, Kanban Completed drop visibility, and full-surface import refresh.
- **Phase 2/3:** qa-v11.cjs covers feature flags (state + gating + persistence),
  the client error log (20-entry cap, hooks, clear), MMGR.Net retry/backoff
  semantics, idempotent WBS/dates import, MMGR.Config, and the AI context dump
  contract (CONTEXT_SCHEMA).
- **Rank 2.3:** qa-ai.cjs covers the real model wiring — the settings toggle
  (tier switch is config-only, no schema bump), the local zero-key engine
  (every output writes state.aiOutputs[type] with a trace array of the state
  fields used; free-form lookups answer from state; no network touches the
  local tier), the cloud tier (OpenAI + Anthropic payload shapes against a
  mocked fetch, circuit-break on failure returns ok:false with state intact),
  and view-only gating (run/settings blocked, open/copy allowed).

## 4. Shipping rules

- No file ships until `qa-p0.cjs` is green.
- Every completed task is re-run through its gate before the next task starts.
- Zero new inline styles or inline handlers;  CSP intact; no emojis; all new UI
  uses the existing design tokens (css/mmgr.css); every destructive mutation
  goes through `State.updateState` + `pushUndo`.

## 5. Rank 1.5 Tier 1 (offline whisper WASM) notes

- Runtime + model are bundled in-repo under `vendor/whisper/` (provenance and
  sizes in `vendor/whisper/README.md`). Model: ggml-tiny.en-q5_1 (32 MB).
- The page CSP includes `script-src 'wasm-unsafe-eval'` — the narrow WASM
  allowance; it enables no eval().
- `serve.cjs` maps `.wasm` -> application/wasm and `.bin` -> octet-stream.
- Tier 1 is batch-on-stop, runs in a module worker, and is circuit-broken:
  any failure keeps the hand-editable Tier 0 captions and never blocks
  ending a meeting.
