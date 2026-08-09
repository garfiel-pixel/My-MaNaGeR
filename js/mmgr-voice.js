/* ============================================================
   My MaNaGeR — Voice Capture & Transcription (Rank 1.5)
   ------------------------------------------------------------
   PLAN-OF-ACTION-AI-VOICE-SYNC-v1, RANK 1.5 — Meeting Voice
   Capture + Transcription infrastructure. Prerequisite plumbing
   for Rank 1.4 (Voice-to-Claim) and Rank 2.3 (model wiring).

   Sequenced per the plan:
   - 1.5.1 Capture layer — MediaRecorder, 10s chunked buffering,
     each chunk persisted to IndexedDB IMMEDIATELY on arrival
     (crash-safe: an abrupt tab kill loses at most the in-flight
     chunk, never the full meeting). Audio NEVER touches
     localStorage or the single-blob JSON path — IndexedDB only,
     per the plan's KNOWN CONFLICTS note (non-negotiable).
   - 1.5.2 Tier 0 (Web Speech API live captions) — network-dependent,
     circuit-broken: if speech recognition is unavailable or errors,
     capture continues silently and the transcript stays hand-editable.
     Tier 1 (whisper.cpp/WASM, TRUE OFFLINE) is LIVE in this build — the
     prebuilt runtime is bundled in-repo (vendor/whisper/), and the
     ggml-tiny.en-q5_1 model is fetched ONCE from a GitHub release URL and
     cached via the Cache API (mmgr-whisper-model-v1). If that fetch is
     impossible (CORS-blocked release host, offline), init falls back to
     the bundled local copy, so offline transcription works from first run
     with zero keys. Tier 1 is batch-on-stop: live captions stream during
     the meeting, then whisper produces the definitive transcript when
     recording stops.
     Tier 2 (cloud, BYO key) remains registered and gated.
   - 1.5.4 Rule-based extraction (NO AI dependency) — keyword
     patterns ("I'll", "by Friday", "we agreed") write straight
     into the existing Decision Log (logEntries) and the
     Meeting-to-Action promises (meetingPromises), reusing the
     exact shapes mmgr-render.js / mmgr-decisions.js already read.

   Five non-negotiables (master plan):
   1. Unified state only — transcript text lives on the meeting
      record (activeMeeting.transcript / meetings[].transcript);
      no side-store. Audio chunks are session evidence in
      IndexedDB, never a parallel project store.
   2. Zero mandatory server cost — Tier 0 is a browser API, not
      a hosted service; Tier 1/2 are opt-in.
   3. No notification spam — visible recording-state UI (REC
      indicator + timer + level meter) is the consent surface,
      per the plan's non-negotiable. Nothing pings off-page.
   4. Offline-first — capture + extraction + transcript editing
      work with zero network. Tier 0 degrades, never blocks.
   5. Portable data — the transcript is plain text inside the
      single .json export; nothing requires a server to read it.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;

  // ---- Tier registry (1.5.2) --------------------------------------------
  // tier0 is the only live tier in this build. tier1/tier2 are registered
  // here so the seam exists and the UI can state them accurately; both stay
  // gated per the plan's sequencing (Tier 1 ships after Tier 0 proves the
  // capture pipeline; Tier 2 is opt-in BYO-key, circuit-broken like weather).
  const TIERS = {
    tier0: { id: 'tier0', label: 'Live captions (browser speech)', offline: false, key: false, gated: false },
    tier1: { id: 'tier1', label: 'Offline transcription (whisper WASM)', offline: true, key: false, gated: false, model: 'ggml-tiny.en-q5_1 (31 MB, cached after first download)' },
    tier2: { id: 'tier2', label: 'Cloud transcription (BYO key)', offline: false, key: true, gated: true }
  };

  // ---- IndexedDB chunk store (crash-safe capture evidence) --------------
  // Two object stores: 'sessions' (one row per recording session) and
  // 'chunks' (one row per 10s MediaRecorder chunk, keyed session:idx).
  // Chunks are written the moment they arrive, so an abrupt kill only ever
  // loses the single chunk that was mid-capture. Session rows carry a
  // 'finalized' flag so interrupted sessions are recoverable/visible.
  const DB_NAME = 'mmgr_voice';
  const DB_VERSION = 1;
  const CHUNK_MS = 10000; // 5-10s per the plan; 10s is the chosen window
  let _dbPromise = null;
  const _queues = {}; // per-session promise chains (writes must not interleave)

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function(res, rej) {
      if (typeof window === 'undefined' || !window.indexedDB) {
        rej(new Error('IndexedDB unavailable'));
        return;
      }
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function(e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'sessionId' });
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: 'id' });
      };
      req.onsuccess = function() { res(req.result); };
      req.onerror = function() { _dbPromise = null; rej(req.error || new Error('IndexedDB open failed')); };
    });
    return _dbPromise;
  }

  // Serialize writes per session so chunk counts stay exact under bursts.
  function enqueue(sessionId, fn) {
    _queues[sessionId] = (_queues[sessionId] || Promise.resolve())
      .then(fn)
      .catch(function(err) {
        if (ns.Errors && ns.Errors.log) ns.Errors.log((err && err.message) || String(err), 'voice-db');
      });
    return _queues[sessionId];
  }
  function waitQueue(sessionId) {
    return _queues[sessionId] || Promise.resolve();
  }

  function newSession(meetingId, kind) {
    const sessionId = U.genShortId('V');
    // projectId is stored so recovery/cleanup never cross projects: meeting
    // ids are PER-PROJECT counters (nmeetid restarts at 1), but IndexedDB is
    // shared across every project on this origin — matching by meetingId
    // alone could surface or delete another project's session.
    const projectId = ns.projectId || 'default';
    return enqueue(sessionId, function() {
      return openDB().then(function(db) {
        return new Promise(function(res, rej) {
          const tx = db.transaction('sessions', 'readwrite');
          tx.objectStore('sessions').put({ sessionId: sessionId, projectId: projectId, meetingId: meetingId, kind: kind, chunkCount: 0, finalized: false, createdAt: new Date().toISOString() });
          tx.oncomplete = function() { res(sessionId); };
          tx.onerror = function() { rej(tx.error); };
        });
      });
    }).then(function() { return sessionId; });
  }

  function appendChunk(sessionId, blob) {
    return enqueue(sessionId, function() {
      return openDB().then(function(db) {
        return new Promise(function(res, rej) {
          const tx = db.transaction(['sessions', 'chunks'], 'readwrite');
          const sessStore = tx.objectStore('sessions');
          const getReq = sessStore.get(sessionId);
          getReq.onsuccess = function() {
            const sess = getReq.result;
            if (!sess) { res(false); return; }
            const idx = sess.chunkCount || 0;
            sess.chunkCount = idx + 1;
            sessStore.put(sess);
            tx.objectStore('chunks').put({ id: sessionId + ':' + idx, sessionId: sessionId, idx: idx, blob: blob, ts: new Date().toISOString() });
          };
          tx.oncomplete = function() { res(true); };
          tx.onerror = function() { rej(tx.error); };
        });
      });
    });
  }

  function finalizeSession(sessionId) {
    return enqueue(sessionId, function() {
      return openDB().then(function(db) {
        return new Promise(function(res, rej) {
          const tx = db.transaction('sessions', 'readwrite');
          const getReq = tx.objectStore('sessions').get(sessionId);
          getReq.onsuccess = function() {
            const sess = getReq.result;
            if (sess) { sess.finalized = true; tx.objectStore('sessions').put(sess); }
          };
          tx.oncomplete = function() { res(true); };
          tx.onerror = function() { rej(tx.error); };
        });
      });
    }).then(function() { pruneOldSessions(); });
  }

  // Bounded retention: audio chunks are session evidence, not eternal. After
  // a session finalizes, prune the OLDEST finalized sessions (and their
  // chunks) beyond SESSION_CAP for this project — the transcript already
  // lives in unified state, so nothing portable is ever lost. Never touches
  // non-finalized (recoverable/interrupted) sessions.
  const SESSION_CAP = 25;
  function pruneOldSessions() {
    const pid = ns.projectId || 'default';
    openDB().then(function(db) {
      return new Promise(function(res, rej) {
        const tx = db.transaction('sessions', 'readonly');
        const req = tx.objectStore('sessions').getAll();
        req.onsuccess = function() {
          const mine = (req.result || [])
            .filter(function(s) { return s.projectId === pid && s.finalized; })
            .sort(function(a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); });
          res(mine.slice(0, Math.max(0, mine.length - SESSION_CAP)));
        };
        req.onerror = function() { rej(req.error); };
      });
    }).then(function(oldOnes) {
      (oldOnes || []).forEach(function(s) { deleteSession(s.sessionId); });
    }).catch(function() {});
  }

  function deleteSession(sessionId) {
    return enqueue(sessionId, function() {
      return openDB().then(function(db) {
        return new Promise(function(res, rej) {
          const tx = db.transaction(['sessions', 'chunks'], 'readwrite');
          tx.objectStore('sessions').delete(sessionId);
          const chunkStore = tx.objectStore('chunks');
          const range = IDBKeyRange.bound(sessionId + ':', sessionId + ':\uffff');
          const keysReq = chunkStore.getAllKeys(range);
          keysReq.onsuccess = function() {
            (keysReq.result || []).forEach(function(k) { chunkStore.delete(k); });
          };
          tx.oncomplete = function() { res(true); };
          tx.onerror = function() { rej(tx.error); };
        });
      });
    }).then(function(ok) { delete _queues[sessionId]; return ok; });
  }

  // All non-finalized sessions — used for the single dismissible recovery
  // chip (no notification spam: shown once per boot, never re-prompted).
  function pendingSessions() {
    return openDB().then(function(db) {
      return new Promise(function(res, rej) {
        const tx = db.transaction('sessions', 'readonly');
        const req = tx.objectStore('sessions').getAll();
        req.onsuccess = function() {
          const all = req.result || [];
          res(all.filter(function(s) { return !s.finalized; }));
        };
        req.onerror = function() { rej(req.error); };
      });
    }).catch(function() { return []; });
  }

  function countChunks(sessionId) {
    return waitQueue(sessionId).then(function() {
      return openDB().then(function(db) {
        return new Promise(function(res, rej) {
          const tx = db.transaction('chunks', 'readonly');
          const range = IDBKeyRange.bound(sessionId + ':', sessionId + ':\uffff');
          const req = tx.objectStore('chunks').count(range);
          req.onsuccess = function() { res(req.result); };
          req.onerror = function() { rej(req.error); };
        });
      });
    });
  }

  // ---- Capture controller (1.5.1) ---------------------------------------
  let _cap = {
    active: false,
    sessionId: null,
    recorder: null,
    stream: null,
    audioCtx: null,
    rafId: null,
    timerId: null,
    startedAt: null,
    chunkCount: 0,
    captionBuf: '',
    lastStateFlush: 0,
    rec: null // tier0 SpeechRecognition instance
  };
  let _recoveryDismissed = false;

  function isCapturing() { return _cap.active; }

  function _toast(msg, type) {
    if (ns.App && ns.App.showToast) ns.App.showToast(msg, type || 'ok');
  }

  async function startCapture() {
    const s = ns.State.getState();
    const m = s.activeMeeting;
    if (!m) { _toast('Start a meeting first.', 'err'); return false; }
    if (_cap.active) { _toast('Already recording.', 'err'); return false; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof window.MediaRecorder === 'undefined') {
      _toast('Voice capture needs a browser with microphone support (HTTPS/localhost).', 'err');
      return false;
    }
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const sessionId = await newSession(m.id, m.kind || 'weekly');
      const recorder = new window.MediaRecorder(stream);
      recorder.ondataavailable = function(e) {
        // Every emitted chunk is persisted to IndexedDB immediately — the
        // crash-safety guarantee: a tab kill loses at most this in-flight
        // 10s chunk, never the meeting.
        if (e.data && e.data.size > 0) {
          _cap.chunkCount++;
          appendChunk(sessionId, e.data);
          const el = U.$('voice-chunks');
          if (el) el.textContent = _cap.chunkCount + ' chunk' + (_cap.chunkCount !== 1 ? 's' : '') + ' saved';
        }
      };
      recorder.onstop = function() {
        // Final dataavailable has already fired (and persisted) before
        // onstop; the session is finalized by stopCapture() itself.
      };
      recorder.start(CHUNK_MS);

      _cap.active = true;
      _cap.sessionId = sessionId;
      _cap.recorder = recorder;
      _cap.stream = stream;
      _cap.startedAt = Date.now();
      _cap.chunkCount = 0;
      _cap.captionBuf = '';
      _cap.lastStateFlush = 0;

      ns.State.updateState(function(st) {
        if (st.activeMeeting) {
          st.activeMeeting.captureState = 'recording';
          st.activeMeeting.captureMethod = 'tier0';
          st.activeMeeting.captureSession = sessionId;
          st.activeMeeting.transcribeState = null;
        }
      });

      // Render the recording UI FIRST so the Tier 0 circuit-break note has
      // a live #voice-tier-note element to write into.
      renderCaptureSection();
      startMeter(stream);
      startTimer();
      startTier0();
      // Tier 1 warm-up: start loading the bundled whisper runtime + model
      // NOW so it is usually ready by the time the user stops the
      // recording. Fire-and-forget and circuit-broken — a slow or failed
      // load never interrupts capture.
      warmTier1();
      _toast('Recording started — a live REC indicator stays on screen.', 'ok');
      return true;
    } catch (err) {
      // If getUserMedia succeeded but a later step failed, the mic must not
      // stay on — release the tracks before surfacing the error.
      if (stream) { try { stream.getTracks().forEach(function(t) { t.stop(); }); } catch (e) {} }
      if (ns.Errors && ns.Errors.log) ns.Errors.log((err && err.message) || String(err), 'voice-start');
      _toast('Microphone unavailable or permission denied.', 'err');
      return false;
    }
  }

  // Stop and SAVE: flushes captions into state synchronously (so a caller
  // like endMeeting can extract immediately), finalizes the IDB session,
  // and marks the meeting record captureState='stopped'.
  function stopCapture() {
    if (!_cap.active) return false;
    const sessionId = _cap.sessionId;
    _cap.active = false;
    stopMeter();
    stopTimer();
    stopTier0();
    flushCaptions(true);
    if (sessionId) {
      finalizeSession(sessionId);
      // Tier 1: transcribe the full recording OFFLINE (batch-on-stop). The
      // captured chunks are decoded to 16 kHz mono float and fed to the
      // bundled whisper WASM inside a module worker; once ready, the result
      // becomes the definitive transcript (replacing the partial live
      // captions). Every failure path degrades to the hand-editable text.
      kickTranscription(sessionId);
    }
    ns.State.updateState(function(st) {
      if (st.activeMeeting) {
        st.activeMeeting.captureState = 'stopped';
      }
    });
    if (_cap.recorder && _cap.recorder.state !== 'inactive') {
      try { _cap.recorder.stop(); } catch (e) { /* already stopped */ }
    }
    if (_cap.stream) { try { _cap.stream.getTracks().forEach(function(t) { t.stop(); }); } catch (e) {} }
    renderCaptureSection();
    _toast('Recording saved — captions are editable until you end the meeting.', 'ok');
    return true;
  }

  // Discard: delete the session + chunks, clear the meeting record fields.
  function discardCapture(silent) {
    const hadActive = _cap.active;
    if (_cap.active) {
      const sessionId = _cap.sessionId;
      _cap.active = false;
      stopMeter(); stopTimer(); stopTier0();
      if (_cap.recorder && _cap.recorder.state !== 'inactive') {
        try { _cap.recorder.stop(); } catch (e) {}
      }
      if (_cap.stream) { try { _cap.stream.getTracks().forEach(function(t) { t.stop(); }); } catch (e) {} }
      if (sessionId) deleteSession(sessionId);
    } else {
      // Nothing live — also clear any pending (interrupted) session for the
      // current meeting so the recovery chip doesn't linger after a cancel.
      clearPendingForMeeting();
    }
    ns.State.updateState(function(st) {
      if (st.activeMeeting) {
        st.activeMeeting.captureState = null;
        st.activeMeeting.captureMethod = null;
        st.activeMeeting.captureSession = null;
        st.activeMeeting.transcript = '';
      }
    });
    renderCaptureSection();
    if (!silent) _toast(hadActive ? 'Recording discarded.' : 'Nothing to discard.', hadActive ? 'ok' : 'err');
    return hadActive;
  }

  // Delete any non-finalized session rows attached to the current meeting.
  function clearPendingForMeeting() {
    const s = ns.State.getState();
    const mid = s.activeMeeting ? s.activeMeeting.id : null;
    const pid = ns.projectId || 'default';
    pendingSessions().then(function(list) {
      (list || []).forEach(function(sess) {
        if (mid != null && sess.projectId === pid && sess.meetingId === mid) deleteSession(sess.sessionId);
      });
    });
  }

  // ---- Level meter + elapsed timer (visible recording-state UI) ---------
  function startMeter(stream) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const el = U.$('voice-meter-fill');
      const tick = function() {
        if (!_cap.active) return;
        try { analyser.getByteTimeDomainData(data); } catch (e) { return; }
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / data.length);
        const pct = Math.min(100, Math.max(4, Math.round(rms * 320)));
        if (el) el.style.width = pct + '%';
        _cap.rafId = requestAnimationFrame(tick);
      };
      _cap.audioCtx = ctx;
      _cap.rafId = requestAnimationFrame(tick);
    } catch (e) { /* meter is decorative — never block capture on it */ }
  }
  function stopMeter() {
    if (_cap.rafId) { cancelAnimationFrame(_cap.rafId); _cap.rafId = null; }
    if (_cap.audioCtx) { try { _cap.audioCtx.close(); } catch (e) {} _cap.audioCtx = null; }
  }
  function startTimer() {
    _cap.timerId = setInterval(function() {
      const el = U.$('voice-timer');
      if (!el || !_cap.startedAt) return;
      const sec = Math.floor((Date.now() - _cap.startedAt) / 1000);
      el.textContent = Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
    }, 1000);
  }
  function stopTimer() {
    if (_cap.timerId) { clearInterval(_cap.timerId); _cap.timerId = null; }
  }

  // ---- Tier 0: Web Speech API live captions (circuit-broken) ------------
  function startTier0() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const note = U.$('voice-tier-note');
    if (!SR) {
      if (note) note.textContent = 'Live captions unavailable in this browser — recording continues; type notes below.';
      return; // circuit-broken: capture proceeds, transcript stays editable
    }
    try {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = 'en-US';
      rec.onresult = function(e) {
        let line = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) line += e.results[i][0].transcript;
        }
        if (line) appendCaption(line);
      };
      rec.onerror = function(ev) {
        if (ns.Errors && ns.Errors.log) ns.Errors.log((ev && ev.error) || 'speech error', 'voice-tier0');
        const n = U.$('voice-tier-note');
        if (n) n.textContent = 'Live captions interrupted (' + ((ev && ev.error) || 'error') + ') — type notes instead.';
        _cap.rec = null;
      };
      rec.onend = function() { /* no silent auto-restart loop */ };
      rec.start();
      _cap.rec = rec;
    } catch (err) {
      if (ns.Errors && ns.Errors.log) ns.Errors.log((err && err.message) || String(err), 'voice-tier0');
    }
  }
  function stopTier0() {
    if (_cap.rec) { try { _cap.rec.stop(); } catch (e) {} _cap.rec = null; }
  }

  // ---- Tier 1: offline whisper.cpp WASM transcription (1.5.2) -----------
  // Prebuilt @fugood/node-whisper-wasm runtime is bundled in-repo under
  // vendor/whisper/; the ggml-tiny.en-q5_1 model is fetched once from the
  // GitHub release URL and cached via the Cache API (remote-first, user
  // change), falling back to the bundled local copy when that fetch is
  // impossible. Batch-on-stop architecture: Tier 0 streams captions live;
  // on Stop, whisper transcribes the full recording in a module worker and
  // writes the definitive transcript into unified state. Circuit-broken
  // like Tier 0 — any failure leaves the captions intact and never blocks
  // ending the meeting.
  const TIER1_ENTRY = 'vendor/whisper/index.js';
  // Remote-first model hosting (SKEPTICAL-AUDIT FIX, Aug 2026): the
  // ggml-tiny.en-q5_1 binary is fetched ONCE from the CORS-enabled
  // HuggingFace mirror of the canonical whisper.cpp model and cached
  // locally via the Cache API (mmgr-whisper-model-v1) so repeat loads are
  // instant and offline.
  //
  // WHY the URL changed: the original GitHub release URL serves release
  // assets WITHOUT Access-Control-Allow-Origin, so a browser fetch is
  // CORS-blocked and ALWAYS fails; and the bundled local copy that used to
  // be the fallback was later removed to satisfy the 25MB Cloudflare Pages
  // per-file deploy limit. Together that made Tier 1 fail end-to-end
  // (verified: qa-voice RUN_WHISPER=1 T11/T12/T13). The HuggingFace mirror
  // serves with Access-Control-Allow-Origin: * (verified), so the browser
  // can fetch + cache it on first use, satisfying: zero mandatory server
  // cost (free mirror), offline-first after first fetch (Cache API),
  // no repo bloat (deploy limit holds), portable data (model is not
  // project data). The bundled path below remains ONLY as a fallback for
  // self-hosted deploys that ship the .bin themselves.
  const TIER1_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin';
  const TIER1_MODEL_FALLBACK = 'vendor/whisper/ggml-tiny.en-q5_1.bin';
  const TIER1_MODEL_CACHE = 'mmgr-whisper-model-v1';

  // Download the Tier 1 model exactly once and serve repeat loads from the
  // Cache API. Returns the model bytes as an ArrayBuffer. Throws when the
  // fetch fails (CORS-blocked release host, offline, no Cache API) or when
  // the host answers with an error status — callers fall back to the
  // bundled local model in that case. Throwing on !response.ok matters: an
  // error-page body must never be handed to whisper as "model bytes".
  async function getModelBytes() {
    if (typeof caches === 'undefined') throw new Error('Cache API unavailable (insecure context?)');
    const cache = await caches.open(TIER1_MODEL_CACHE);
    let response = await cache.match(TIER1_MODEL_URL);
    if (!response) {
      response = await fetch(TIER1_MODEL_URL);
      if (!response.ok) throw new Error('model download failed: HTTP ' + response.status);
      await cache.put(TIER1_MODEL_URL, response.clone());
    }
    return response.arrayBuffer();
  }

  let _t1 = {
    promise: null,     // memoized init promise (cleared on failure -> retry)
    ready: false,
    ctx: null,         // whisper context (module-worker backed)
    transcribing: false,
    progress: 0,
    lastErr: null,
    pendingKick: null, // newest session requested while one is still running
    modelSource: null  // 'remote-cache' | 'local-fallback' | 'hook' (diagnostic)
  };

  function _t1Url(p) { return new URL(p, document.baseURI).href; }

  // Load the whisper runtime and init a context against a model source.
  // Shared by the remote (Blob URL of cached bytes) and local-fallback
  // paths so both get identical single-thread configuration.
  async function _t1InitRuntime(modelPath, cacheModel) {
    const mod = await import(_t1Url(TIER1_ENTRY));
    // Force the single-thread artifact: static hosts (this dev server
    // included) do not send COOP/COEP, so SharedArrayBuffer is
    // unavailable — the loader would fall back anyway; forcing it keeps
    // the runtime path deterministic across hosts. configureWasm throws
    // once the runtime is already loaded (the module singleton is shared)
    // — that is fine: the first configure wins, later calls are no-ops.
    if (typeof mod.configureWasm === 'function') {
      try { mod.configureWasm({ threads: false }); } catch (e) { /* already configured */ }
    }
    return mod.initWhisper({ filePath: modelPath, cacheModel: cacheModel });
  }

  async function _initTier1Impl(forcedModelUrl) {
    // forcedModelUrl is a test/diagnostic hook: it MUST stay fully detached
    // from _t1 so a forced failure can never corrupt the real runtime state.
    const target = forcedModelUrl ? { ready: false, ctx: null, lastErr: null } : _t1;
    try {
      let modelPath, cacheModel, modelSource;
      if (forcedModelUrl) {
        // Diagnostic hook: deterministic, no network, no cache writes.
        modelPath = _t1Url(forcedModelUrl);
        cacheModel = true;
        modelSource = 'hook';
      } else {
      // Production: remote-first. Fetch (or read from Cache API) the
      // model bytes, wrap them in a Blob URL, and hand that URL to the
      // whisper runtime. initWhisper accepts a fetchable URL, not raw
      // bytes, so the Blob URL is the bridge. cacheModel=false here: the
      // Cache API already persists the model under TIER1_MODEL_CACHE,
      // and a Blob URL is not a stable Cache key for the runtime.
      try {
        const bytes = await getModelBytes();
        modelPath = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
        cacheModel = false;
        modelSource = 'remote-cache';
      } catch (remoteErr) {
        // Offline, or a host outage: fall back to the bundled copy for
        // self-hosted deploys that ship the .bin themselves. Record why.
        // (A plain CORS block no longer lands here — the primary URL is
        // the CORS-enabled HF mirror, verified at implementation time.)
        if (ns.Errors && ns.Errors.log) {
          ns.Errors.log('voice-tier1: remote model fetch failed (' + ((remoteErr && remoteErr.message) || String(remoteErr)) + ') — using bundled model', 'voice-tier1');
        }
        modelPath = _t1Url(TIER1_MODEL_FALLBACK);
        cacheModel = true; // bundled copy: runtime Cache Storage is fine
        modelSource = 'local-fallback';
      }
      }
      const ctx = await _t1InitRuntime(modelPath, cacheModel);
      target.ctx = ctx;
      target.ready = true;
      target.lastErr = null;
      target.modelSource = modelSource;
    } catch (err) {
      target.ready = false;
      target.ctx = null;
      target.lastErr = err;
      if (ns.Errors && ns.Errors.log) ns.Errors.log((err && err.message) || String(err), 'voice-tier1');
    }
    return target.ready;
  }

  // initTier1(forcedModelUrl) — forcedModelUrl is a test/diagnostic hook to
  // exercise the circuit-break deterministically; production calls it with
  // no argument. Failures are NOT memoized: a transient failure (e.g. the
  // model fetch hiccuping) can be retried by the next call.
  function initTier1(forcedModelUrl) {
    if (forcedModelUrl) return _initTier1Impl(forcedModelUrl);
    if (_t1.promise) return _t1.promise;
    _t1.promise = _initTier1Impl().then(function(ok) { if (!ok) _t1.promise = null; return ok; });
    return _t1.promise;
  }
  function warmTier1() { initTier1(); }
  function tier1Ready() { return _t1.ready && !!_t1.ctx; }
  function tier1Status() {
    return {
      ready: _t1.ready,
      transcribing: _t1.transcribing,
      progress: _t1.progress,
      error: _t1.lastErr ? String((_t1.lastErr && _t1.lastErr.message) || _t1.lastErr) : null,
      model: TIER1_MODEL_URL,
      modelSource: _t1.modelSource
    };
  }

  // Linear resample to whisper's fixed 16 kHz input rate.
  function resampleLinear(input, fromRate, toRate) {
    if (!input || !input.length || !fromRate || fromRate === toRate) return input;
    const outLen = Math.max(1, Math.round(input.length * toRate / fromRate));
    const out = new Float32Array(outLen);
    const ratio = fromRate / toRate;
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const l = Math.floor(pos);
      const r = Math.min(l + 1, input.length - 1);
      const w = pos - l;
      out[i] = input[l] * (1 - w) + input[r] * w;
    }
    return out;
  }
  // Mix all channels down to mono, then resample to 16 kHz.
  function mixToMono16k(audioBuffer) {
    if (!audioBuffer || !audioBuffer.length) return null;
    const chans = audioBuffer.numberOfChannels || 1;
    const len = audioBuffer.length;
    const mono = new Float32Array(len);
    for (let c = 0; c < chans; c++) {
      const d = audioBuffer.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += d[i] / chans;
    }
    return resampleLinear(mono, audioBuffer.sampleRate || 48000, 16000);
  }

  // Every persisted chunk for a session, in arrival order (waits for any
  // in-flight append — the queue guarantees nothing is missed on stop).
  function readChunks(sessionId) {
    return waitQueue(sessionId).then(function() {
      return openDB().then(function(db) {
        return new Promise(function(res, rej) {
          const tx = db.transaction('chunks', 'readonly');
          const range = IDBKeyRange.bound(sessionId + ':', sessionId + ':\uffff');
          const req = tx.objectStore('chunks').getAll(range);
          req.onsuccess = function() {
            const rows = (req.result || []).sort(function(a, b) { return (a.idx || 0) - (b.idx || 0); });
            res(rows.map(function(r) { return r.blob; }));
          };
          req.onerror = function() { rej(req.error); };
        });
      });
    });
  }

  // Decode the captured blob (webm/opus — or a WAV in tests) into whisper's
  // 16 kHz mono Float32Array. AudioContext lives on the main thread only;
  // the WASM worker itself never touches audio decoding.
  async function decodeForWhisper(blob) {
    const buf = await blob.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('AudioContext unavailable for offline transcription');
    const ac = new AC();
    try {
      const ab = await ac.decodeAudioData(buf.slice(0));
      return mixToMono16k(ab);
    } finally {
      try { ac.close(); } catch (e) {}
    }
  }

  // Write whisper's result onto the correct meeting record. If the meeting
  // is still live, extraction stays deferred to endMeeting (which reads the
  // live transcript). If the meeting already ended (stop+end in quick
  // succession), write to the stored record and extract immediately.
  function applyWhisperText(text, sessionId) {
    const clean = String(text || '').trim();
    ns.State.updateState(function(st) {
      const live = (st.activeMeeting && st.activeMeeting.captureSession === sessionId) ? st.activeMeeting : null;
      const stored = live ? null : (st.meetings || []).find(function(m) { return m.captureSession === sessionId; });
      const target = live || stored;
      if (!target) return;
      target.transcript = clean;
      target.captureMethod = 'tier1';
      target.transcribeState = 'done';
    });
    // Meeting already ended -> the stored record just got the text; run the
    // same zero-AI extraction against it that endMeeting would have.
    const s = ns.State.getState();
    const stillLive = s.activeMeeting && s.activeMeeting.captureSession === sessionId;
    if (!stillLive) {
      const stored = (s.meetings || []).find(function(m) { return m.captureSession === sessionId; });
      if (stored) applyExtractionToState(stored);
    }
  }

  // The batch-on-stop job: gather chunks -> decode -> whisper -> state.
  // If another session is still transcribing, remember the NEWEST request and
  // run it when the current job finishes (never silently drop a recording).
  async function transcribeSession(sessionId) {
    if (!sessionId) return;
    if (_t1.transcribing) { _t1.pendingKick = sessionId; return; }
    _t1.transcribing = true;
    _t1.progress = 0;
    const mark = function(field, val) {
      ns.State.updateState(function(st) {
        const live = (st.activeMeeting && st.activeMeeting.captureSession === sessionId) ? st.activeMeeting : null;
        const target = live || (st.meetings || []).find(function(m) { return m.captureSession === sessionId; });
        if (target) target[field] = val;
      });
    };
    mark('transcribeState', 'transcribing');
    renderCaptureSection();
    try {
      if (!tier1Ready()) await initTier1();
      if (!tier1Ready()) throw (_t1.lastErr || new Error('Offline transcription unavailable'));
      const chunks = await readChunks(sessionId);
      if (!chunks || !chunks.length) { mark('transcribeState', 'idle'); return; }
      const f32 = await decodeForWhisper(new Blob(chunks, { type: 'audio/webm' }));
      if (!f32 || !f32.length) { mark('transcribeState', 'idle'); return; }
      const op = _t1.ctx.transcribeData(f32, {
        language: 'en',
        onProgress: function(p) {
          // whisper.cpp reports percent (0-100); normalize defensively to 0-1.
          const v = typeof p === 'number' ? (p > 1 ? p / 100 : p) : 0;
          _t1.progress = Math.min(1, Math.max(0, v));
          const fill = U.$('voice-meter-fill');
          if (fill) fill.style.width = Math.round(_t1.progress * 100) + '%';
        }
      });
      const res = await op.promise;
      const text = String((res && res.result) || '').trim();
      applyWhisperText(text, sessionId);
      if (text) _toast('Offline transcription complete — transcript updated.', 'ok');
    } catch (err) {
      _t1.lastErr = err;
      mark('transcribeState', 'failed');
      if (ns.Errors && ns.Errors.log) ns.Errors.log((err && err.message) || String(err), 'voice-tier1');
      _toast('Offline transcription failed — captions kept; you can retry.', 'err');
    } finally {
      _t1.transcribing = false;
      renderCaptureSection();
      const next = _t1.pendingKick;
      _t1.pendingKick = null;
      if (next) transcribeSession(next);
    }
  }

  // Manual re-run from the stopped card (also the action behind the retry
  // button after a failure). Targets the ACTIVE meeting's own session only —
  // stored meetings carry their own captureSession, so there is no case where
  // a session belonging to a different record should be re-transcribed here.
  function transcribeOffline() {
    const s = ns.State.getState();
    const m = s.activeMeeting;
    const sid = m && m.captureSession;
    if (!sid) { _toast('No recorded session to transcribe.', 'err'); return false; }
    transcribeSession(sid);
    return true;
  }
  function kickTranscription(sessionId) { transcribeSession(sessionId); }

  // Caption lines accumulate in _cap.captionBuf and flush to state at most
  // every 5s — throttling keeps updatedAt churn (and thus multi-tab
  // storage-event conflict modals) off the hot path of live speech.
  function appendCaption(line) {
    const clean = String(line || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const ta = U.$('voice-captions');
    if (ta) {
      ta.value = (ta.value ? ta.value.replace(/\s+$/, '') + ' ' : '') + clean;
      ta.scrollTop = ta.scrollHeight;
    }
    _cap.captionBuf += (_cap.captionBuf ? ' ' : '') + clean;
    if (Date.now() - _cap.lastStateFlush > 5000) flushCaptions(false);
  }
  function flushCaptions(force) {
    if (!_cap.captionBuf && !force) return;
    const buf = _cap.captionBuf;
    _cap.captionBuf = '';
    if (!buf) return;
    _cap.lastStateFlush = Date.now();
    ns.State.updateState(function(st) {
      if (st.activeMeeting) {
        st.activeMeeting.transcript = ((st.activeMeeting.transcript || '').trim()
          ? st.activeMeeting.transcript.replace(/\s+$/, '') + ' ' : '') + buf;
      }
    });
  }

  // ---- Rule-based extraction (1.5.4) — pure, zero AI --------------------
  // Keyword patterns only, per the plan: "I'll", "by Friday", "we agree".
  // No AI call is ever made; the AI-refined upgrade path is gated behind
  // Rank 2's model wiring and is NOT a dependency here.
  const DECISION_RE = /\b(we|the team|i)\s+(agree|agreed|decide|decided|confirm|confirmed|approve|approved)\b|\b(we|the team)(?:'re| are)\s+(going|planning)\s+to\b/i;
  const ACTION_RE = /\b(i'?ll|i will|we'?ll|we will|you need to|someone needs to|can you|you should|we should|let'?s)\b/i;
  const DUE_RE = /\bby\s+(tomorrow|tonight|this week|next week|next month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})\b/i;
  const OWNER_RE = /\b(?:assign|to|for|with)\s+([A-Z][A-Za-z]{1,20})\b/;

  // Clause splitter (QA-STRESS DIR-2 finding, Aug 2026): real whisper
  // output is often punctuation-sparse — long run-on stretches with only
  // commas. The old per-sentence matcher treated a 600-char comma-only
  // transcript as ONE sentence, so first-match-wins collapsed it: the first
  // decision matched and the entire rest (every action item!) was skipped.
  // Now: split on sentence punctuation first, then sub-split any clause
  // longer than 140 chars at commas/semicolons into INDEPENDENT clauses.
  // Deliberately NO merging back: merging two comma-bits can glue an
  // action clause to a decision clause, and the per-clause first-match
  // rule would then drop the action again (verified by the stress run —
  // the merge step was the regression, not the split).
  function splitClauses(text) {
    const sentences = String(text || '').match(/[^.!?\n]+[.!?]*/g) || [];
    const out = [];
    sentences.forEach(function(raw) {
      const p = raw.trim();
      if (!p) return;
      if (p.length <= 140) { out.push(p); return; }
      p.split(/[,;]\s+/).forEach(function(b) {
        b = b.trim();
        if (b) out.push(b);
      });
    });
    return out;
  }

  function extractFromTranscript(text) {
    const src = String(text || '');
    const sentences = splitClauses(src);
    const decisions = [];
    const actions = [];
    const seen = {};
    sentences.forEach(function(raw) {
      const s = raw.trim();
      if (s.length < 4) return;
      if (DECISION_RE.test(s)) {
        const key = 'd:' + s.toLowerCase();
        if (seen[key]) return;
        seen[key] = 1;
        decisions.push({ text: s.replace(/[.!?]+$/, '') });
        return;
      }
      if (ACTION_RE.test(s)) {
        const dueM = s.match(DUE_RE);
        const ownM = s.match(OWNER_RE);
        const body = s
          .replace(/^[\s"'“”]*(?:i'?ll|i will|we'?ll|we will|you need to|someone needs to|can you|you should|we should|let'?s)\s+/i, '')
          .replace(/[.!?]+$/, '')
          .trim();
        let text = body ? body.charAt(0).toUpperCase() + body.slice(1) : s.replace(/[.!?]+$/, '');
        if (dueM) text += ' (due ' + dueM[1] + ')';
        if (ownM) text += ' — owner: ' + ownM[1];
        const key = 'a:' + text.toLowerCase();
        if (seen[key]) return;
        seen[key] = 1;
        actions.push({ text: text, due: dueM ? dueM[1] : null, owner: ownM ? ownM[1] : null });
      }
    });
    return { decisions: decisions, actions: actions };
  }

  // Writes extracted decisions/actions into unified state using the exact
  // shapes the existing renderers read: logEntries (Decision Log) and
  // meetingPromises[kind] (Meeting-to-Action ribbon). Zero AI.
  function applyExtractionToState(meeting) {
    const s = ns.State.getState();
    const m = meeting || s.activeMeeting;
    const src = m && m.transcript ? String(m.transcript).trim() : '';
    if (!src) return { decisions: [], actions: [] };
    const res = extractFromTranscript(src);
    if (!res.decisions.length && !res.actions.length) return res;
    ns.State.updateState(function(st) {
      if (!Array.isArray(st.logEntries)) st.logEntries = [];
      if (!st.meetingPromises) st.meetingPromises = {};
      const kind = m.kind || 'weekly';
      if (!st.meetingPromises[kind]) st.meetingPromises[kind] = [];
      const promiseCap = 30;
      const mid = m.id != null ? m.id : (st.meetings && st.meetings.length ? st.meetings[0].id : null);
      const today = new Date().toISOString().slice(0, 10);
      // Idempotency guard (review finding): when Tier 1 whisper completes
      // AFTER endMeeting already extracted from partial live captions, the
      // same meeting can be extracted twice. Dedupe on (meeting, text) so a
      // re-extraction adds only genuinely new decisions/actions.
      const alreadyLogged = function(text) {
        return st.logEntries.some(function(e) {
          return e.sourceMeetingId === mid && String(e.decision || e.text || '').trim().toLowerCase() === text.toLowerCase();
        });
      };
      const alreadyPromised = function(text) {
        return (st.meetingPromises[kind] || []).some(function(p) {
          return p.sourceMeetingId === mid && String(p.text || '').trim().toLowerCase() === text.toLowerCase();
        });
      };
      res.decisions.forEach(function(d) {
        if (alreadyLogged(d.text)) return;
        st.logEntries.push({
          id: U.genShortId('D'),
          date: new Date().toLocaleString(),
          decision: d.text,
          by: st.userName || 'Meeting',
          actionItems: '',
          sourceMeetingId: mid // used by the dedupe above; renderers ignore it
        });
      });
      res.actions.forEach(function(a) {
        if (st.meetingPromises[kind].length >= promiseCap || alreadyPromised(a.text)) return;
        st.meetingPromises[kind].push({
          id: U.genShortId('P'),
          text: a.text,
          done: false,
          sourceMeetingId: mid,
          sourceDate: today,
          createdAt: new Date().toISOString()
        });
      });
    });
    return res;
  }

  // ---- Rendering ---------------------------------------------------------
  // Renders into #meet-voice-wrap (a div inside the live meeting card,
  // created by mmgr-meetings.js renderActiveMeeting). Zero inline styles;
  // classes come from css/mmgr.css. REC state, timer and level meter stay
  // on screen the whole time — the consent-relevant recording indicator.
  function renderCaptureSection() {
    const wrap = U.$('meet-voice-wrap');
    if (!wrap) return;
    const s = ns.State.getState();
    const m = s.activeMeeting;
    if (!m) { wrap.innerHTML = ''; return; }
    const state = m.captureState;
    const isRec = state === 'recording';
    const isStopped = state === 'stopped';
    // Display continuity: un-flushed captions live in _cap.captionBuf while
    // state.transcript only receives them on the 5s throttle. A re-render
    // (e.g. tglMeetItem) must show BOTH, or the visible text drops lines.
    const transcript = (m.transcript || '') + (_cap.active && _cap.captionBuf ? ' ' + _cap.captionBuf : '');
    let html = '';
    if (isRec) {
      html = '<div class="voice-card voice-live">' +
        '<div class="voice-head">' +
          '<span class="voice-rec"><span class="voice-dot"></span> REC</span>' +
          '<span class="voice-timer" id="voice-timer">0m 0s</span>' +
          '<span class="voice-chunks" id="voice-chunks">0 chunks saved</span>' +
        '</div>' +
        '<div class="voice-meter"><div class="voice-meter-fill" id="voice-meter-fill"></div></div>' +
        '<div class="voice-tier-note" id="voice-tier-note">Live captions (Tier 0) stream here — on stop, bundled offline whisper (Tier 1) produces the full transcript.</div>' +
        '<textarea class="cf-ta voice-captions" id="voice-captions" readonly placeholder="Live captions appear here...">' + U.escapeHtml(transcript) + '</textarea>' +
        '<div class="g6"><button class="btn btn-g btn-s" data-action="voiceStopCapture"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check-circle"></use></svg> Stop &amp; Save</button>' +
        '<button class="btn btn-n btn-s" data-action="voiceDiscardCapture"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> Discard</button></div>' +
      '</div>';
    } else {
      // Tier 1 status row for the stopped state: transcribing (progress),
      // done, failed (retry), or idle (manual Transcribe Offline button).
      let t1row = '';
      if (m.captureSession) {
        if (m.transcribeState === 'transcribing') {
          const pct = Math.min(100, Math.round((tier1Status().progress || 0) * 100));
          t1row = '<div class="voice-t1 voice-t1-on"><span class="voice-t1-lbl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-cpu"></use></svg> Offline transcription (whisper, in-browser)...</span>' +
            '<div class="voice-meter"><div class="voice-meter-fill" id="voice-meter-fill" style="width:' + pct + '%"></div></div></div>';
        } else if (m.transcribeState === 'done') {
          t1row = '<div class="voice-t1 voice-t1-ok"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check-circle"></use></svg> Offline transcript ready — whisper WASM, no network.</div>';
        } else if (m.transcribeState === 'failed') {
          t1row = '<div class="voice-t1 voice-t1-err"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg> Offline transcription failed — captions kept. <button class="btn btn-n btn-s" data-action="voiceTranscribeOffline">Retry</button></div>';
        } else {
          t1row = '<div class="g6 voice-t1"><button class="btn btn-n btn-s" data-action="voiceTranscribeOffline"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-cpu"></use></svg> Transcribe Offline</button>' +
            '<span class="voice-sub">Runs fully in-browser via whisper — no key. First run downloads the 31 MB model once and caches it; if the download is blocked it uses the bundled copy.</span></div>';
        }
      }
      html = '<div class="voice-card">' +
        '<div class="voice-head"><span class="voice-title"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-zap"></use></svg> Voice Capture</span>' +
          (isStopped ? (m.captureMethod === 'tier1' ? '<span class="badge bg">offline transcript</span>' : '<span class="badge bg">saved</span>') : '<span class="badge ba">off</span>') + '</div>' +
        (isStopped ? '' : '<div class="voice-note">Record this meeting — mic access is requested only while recording, and a live REC indicator stays on screen for consent. Live captions (Tier 0) stream while recording; bundled offline whisper (Tier 1) finalizes the transcript when you stop. Everything stays editable until you end the meeting.</div>') +
        '<div class="g6"><button class="btn btn-g btn-s" data-action="voiceStartCapture"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-zap"></use></svg> Record Meeting</button></div>' +
        t1row +
        '<label class="cf-label voice-lbl">Transcript <span class="voice-sub">(typed or edited here; extracted into Decisions when the meeting ends)</span></label>' +
        '<textarea class="cf-ta voice-captions" data-action="updMeetField" data-field="transcript" placeholder="Type or edit the transcript here...">' + U.escapeHtml(transcript) + '</textarea>' +
      '</div>';
    }
    wrap.innerHTML = html;
    checkRecovery();
  }

  // Single dismissible recovery chip (once per boot, never re-prompted).
  // Only NON-finalized sessions that are NOT the live capture session and
  // NOT the current meeting's own session count as "interrupted" — a live
  // recording must never flash a false "interrupted session" alarm (the
  // plan's no-notification-spam rule).
  function checkRecovery() {
    if (_recoveryDismissed) return;
    const s = ns.State.getState();
    const curSession = _cap.active && _cap.sessionId ? _cap.sessionId : (s.activeMeeting && s.activeMeeting.captureSession) || null;
    const pid = ns.projectId || 'default';
    pendingSessions().then(function(list) {
      const interrupted = (list || []).filter(function(sess) {
        return sess.projectId === pid && sess.sessionId !== curSession;
      });
      if (!interrupted.length) return;
      const wrap = U.$('meet-voice-wrap');
      if (!wrap || wrap.querySelector('.voice-recover')) return; // one chip at a time
      const chip = document.createElement('div');
      chip.className = 'voice-recover';
      chip.innerHTML = '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg> ' +
        interrupted.length + ' interrupted recording session' + (interrupted.length !== 1 ? 's' : '') +
        ' found — audio chunks were saved safely. <button class="btn btn-n btn-s" data-action="voiceRecoverDismiss">Dismiss</button>';
      wrap.prepend(chip);
    }).catch(function() {});
  }
  function dismissRecovery() {
    _recoveryDismissed = true;
    const chip = document.querySelector('.voice-recover');
    if (chip) chip.remove();
  }

  function tierStatus() {
    return {
      active: tier1Ready() ? 'tier1' : 'tier0',
      tiers: TIERS,
      tier1: tier1Status(),
      note: 'Tier 1 (offline whisper WASM) is live with a bundled model — transcription runs fully in-browser with zero network. Tier 2 (cloud BYO key) stays gated per PLAN-OF-ACTION-AI-VOICE-SYNC-v1 1.5.2.'
    };
  }

  // ---- API ----
  ns.Voice = {
    TIERS: TIERS,
    tierStatus: tierStatus,
    isCapturing: isCapturing,
    startCapture: startCapture,
    stopCapture: stopCapture,
    discardCapture: discardCapture,
    clearPendingForMeeting: clearPendingForMeeting,
    extractFromTranscript: extractFromTranscript,
    applyExtractionToState: applyExtractionToState,
    renderCaptureSection: renderCaptureSection,
    checkRecovery: checkRecovery,
    dismissRecovery: dismissRecovery,
    // Tier 1: offline whisper WASM (remote-first model, local fallback)
    initTier1: initTier1,
    warmTier1: warmTier1,
    getModelBytes: getModelBytes,
    tier1Ready: tier1Ready,
    tier1Status: tier1Status,
    transcribeOffline: transcribeOffline,
    kickTranscription: kickTranscription,
    mixToMono16k: mixToMono16k,
    resampleLinear: resampleLinear,
    readChunks: readChunks,
    // IndexedDB store (public so recovery/tests can inspect it)
    newSession: newSession,
    appendChunk: appendChunk,
    finalizeSession: finalizeSession,
    deleteSession: deleteSession,
    pendingSessions: pendingSessions,
    countChunks: countChunks
  };
})(MMGR);
window.MMGR = MMGR;
