# In-browser model spike - October 2026

Measured report for `REFINEMENT-DIRECTIVE-2026-10-24.md` AI-2 (owner question 10: "run the spike").
Nothing here ships: the harness is `tools/spike-localllm.html` (plus `tools/spike-localllm-worker.js`
for the worker variant), both served from the repo but excluded from the deploy assets.

## 1. Method

- Harness: `tools/spike-localllm.html`, driven headless by `tmp/run-spike.mjs` (session scratch, not
  committed) against `serve.cjs`. Every candidate loads, then answers ONE prompt - "In three short
  bullets, list the main risks a site manager should check before concrete pours start" - with token
  timing measured around the generation, a warm repeat in the same page, `performance.memory` sampled
  for the peak heap, and a `PerformanceObserver` on `longtask` for main-thread freeze.
- Model (both candidates): **SmolLM2-360M instruct, 4-bit** - the directive's 0.3-0.5 B range.
- Machine: Windows 11 desktop Chrome 156, 12 cores, 16 GB, WebGPU adapter present,
  `crossOriginIsolated: false`. Not a mid-range laptop and not a phone - see the limits in section 5.

## 2. Candidate A - MLC WebLLM (WebGPU): PASSES the laptop thresholds

| Measure | Cold (first load) | Warm (second run, same page) | Acceptance | Verdict |
|---|---|---|---|---|
| Time to usable | 60.8 s load + 15.9 s to first token | **0.60 s load + 0.22 s to first token** | under 20 s after the first download | PASS warm |
| Generation | 78 tokens in 3.42 s | 77 tokens in 3.00 s | at least 8 tok/s | **22.8 / 25.7 tok/s PASS** |
| Peak JS heap | 60 MB | 60 MB | under 1 GB | PASS (weights live on the GPU, not the heap) |
| Main-thread freeze | longest task 0 ms | longest task 0 ms | none | PASS |
| Errors | none | none | - | - |

Notes:
- The cold 60.8 s is dominated by the one-time weight download and pipeline compile; the directive's
  bar is explicitly "after the first download", which the warm numbers clear by ~30x.
- The byte counter observed **0 downloaded** because the weights were already in this profile's cache
  from an earlier run of the same session. The download size was therefore **not measured** for
  WebLLM; the same model pulled through transformers.js measured **394 MB cold** (section 3), so the
  honest figure for the settings card is "about 350 MB, once" as the directive already drafts it.
- WebLLM ran on the **main thread** in this spike (0 long tasks at this size/speed, but that is a
  measurement on a fast desktop, not proof for slower machines). Worker isolation is still owed - see
  section 5.

## 3. Candidate B - transformers.js (WASM): FAILS

| Measure | Main thread | In a worker | Acceptance | Verdict |
|---|---|---|---|---|
| Bytes downloaded | 781 MB total (394 MB cold + 388 MB re-fetched) | cache counters reported 0 | ~350 MB once | FAIL |
| Time to usable | 112 s load, **204 s to first answer** | 119 s load, **284 s** to first answer | under 20 s | FAIL by ~10x |
| Warm repeat | 111 s load (the Cache API `put` failed: "Unexpected internal error", so the warm run re-downloaded everything) | same | - | FAIL |
| Tokens/second | not counted (non-streaming run) | not counted | at least 8 | unproven, too slow to matter |
| Peak JS heap | 462 MB | 1.2 MB in the page (work moved out) | under 1 GB | PASS |
| Main-thread freeze | **longest task 1437 ms** | 0 ms | none | main-thread FAIL, worker PASS |

The WASM path cannot get near the bar on this model class, and its Cache API caching failed outright
in headless Chrome, so even the "after the first download" warm case stayed at ~110 s. Moving it into
a worker fixed the freeze and the page heap but not the speed. This candidate is out.

## 4. Decision: do NOT ship in this wave; WebLLM is a GO for a dedicated follow-up wave

Three of the directive's five ship conditions are unmeasured or unimplemented today, so shipping now
would be shipping an untested promise:

1. **Phone behaviour: not measured.** The spike ran on desktop Chrome only.
2. **Worker isolation: not proven for WebLLM.** The one candidate that passes ran on the main thread.
   `navigator.gpu` is available in dedicated workers in current Chrome, so it is expected to work,
   "expected" is not "measured".
3. **Fallback when WebGPU or memory is missing: not built.** WebLLM has no adapter path; the app must
   keep its current deterministic engine as the default and offer it unchanged when the runtime is
   unavailable.

Plus the entire ship checklist is still to be built: the opt-in download card (size, Wi-Fi hint,
progress, Pause, Cancel, Delete), cache name `mmgr-localllm-v1` in the storage inventory and consent
gate, lazy "warming up" load, grammar-guided decoding for calculator `PROPOSAL`/`ASK` lines with the
page-side validator still authoritative, the "On this device" tier badge, the privacy-page line, and
the T-LOCALLLM gate.

**Flag:** `localModel` in `js/mmgr-state.js` is therefore `false` - nothing of this feature is
shipped, and a flag that says otherwise would be a lie a rollback could not fix.

**Recommendation for the follow-up wave:** implement against Candidate A only, keep the deterministic
engine as the default tier, measure the three open items (phone, worker, no-WebGPU fallback) as the
first task, and only then turn the flag on behind the opt-in download.

## 5. Limits of this report

- One fast desktop, not the directive's "mid-range laptop". Warm numbers would shrink on slower
  hardware; the warm margin (~30x) is large enough that the verdict should hold, but it is a
  projection, not a measurement.
- No phone run (no device attached, no DevTools emulation run) - emulation would not exercise WebGPU
  honestly anyway; a real device is needed.
- Download size for WebLLM not captured (section 2).
- One prompt, one generation per candidate. No long-context or streaming-quality assessment; quality
  expectations stay as the directive writes them (good at plain language, weak at maths - the engine
  keeps all money, quantity and date maths).

## 6. Raw artefacts (session scratch, `tmp/` is gitignored)

| File | Run |
|---|---|
| `tmp/spike-results-webllm.json` / `tmp/spike-webllm3.log` | Candidate A, final run |
| `tmp/spike-results-tf.json` / `tmp/spike-tf5.log` | Candidate B, main thread |
| `tmp/spike-results-tf-worker.json` / `tmp/spike-tf-worker5.log` | Candidate B, worker |

Reproduce: `node serve.cjs`, open `http://127.0.0.1:8765/tools/spike-localllm.html`, pick a
candidate, read `window.__SPIKE` (the page needs network access to the CDN-hosted runtime; that is
intentional for a spike and is one of the things shipping would replace with a cached, first-party
fetch like `mmgr-whisper-model-v1`).