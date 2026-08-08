# vendor/whisper — Offline transcription runtime (Rank 1.5 Tier 1)

Bundled in-repo per the user's bundling decision (PLAN-OF-ACTION-AI-VOICE-SYNC-v1
1.5.2): fully offline from first run, zero network, zero API keys. Loaded lazily
by js/mmgr-voice.js (Tier 1), warm-started when a meeting recording begins and
run batch-on-stop in a module worker.

## Contents

| File | Role | Size |
|---|---|---|
| `index.js` | Browser entry — `initWhisper` / `configureWasm` (ESM) | 52 KB |
| `worker.js` | Module worker that keeps transcription off the UI thread | 7 KB |
| `wasm/whisper-node.js` | Single-thread emscripten glue (whisper.cpp) | 132 KB |
| `wasm/whisper-node.wasm` | Single-thread WASM binary | 4.0 MB |
| `wasm/whisper-node.threads.js` | pthread glue (used only with COOP/COEP isolation) | 149 KB |
| `wasm/whisper-node.threads.wasm` | pthread WASM binary | 4.2 MB |
| `ggml-tiny.en-q5_1.bin` | whisper **tiny English q5_1** model | 32,166,155 B |
| `samples/jfk.wav` | Reference sample for the opt-in real-pipeline QA check | 352 KB |

Total ≈ 40 MB.

## Provenance

- **Runtime** — `@fugood/node-whisper-wasm` **v1.1.1** (MIT), published from
  https://github.com/mybigday/whisper.node. Downloaded from
  https://cdn.jsdelivr.net/npm/@fugood/node-whisper-wasm@1.1.1/ and vendored
  byte-identical (all sizes verified against the registry listing).
- **Model** — `ggml-tiny.en-q5_1.bin`, originally published by
  ggml-org/whisper.cpp (MIT). Vendored from
  github.com/bnosac/audio.whisper (`inst/repo/`), byte-verified at
  32,166,155 bytes with ggml magic `0x67676d6c` ("lmgg" LE) and header values
  n_vocab=51864, n_audio_ctx=1500, n_audio_state=384 — a genuine whisper tiny.
- **Sample** — `samples/jfk.wav` from
  https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/samples/jfk.wav

## CSP requirement

The page CSP (`project.html`) includes `script-src 'wasm-unsafe-eval'` — the
narrow allowance required for WebAssembly compilation. It enables **no**
`eval()` / string-to-code; remove it only if this bundle is ever dropped.

## QA

`RUN_WHISPER=1 node qa-voice.cjs` runs the real end-to-end offline pipeline
(worker + WASM + model + decode + transcribe + unified-state write) using the
bundled jfk.wav sample. The default gate keeps Tier 1 coverage to the
deterministic circuit-break / DSP checks so CI stays fast and offline.
