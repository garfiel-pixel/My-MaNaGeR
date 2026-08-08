/* ============================================================
   RANK 1.5 GATE — Meeting Voice Capture + Transcription
   (PLAN-OF-ACTION-AI-VOICE-SYNC-v1)
   Drives headless Chrome against http://127.0.0.1:8765.
   Headless Chrome has no microphone, so MediaRecorder and
   getUserMedia are MOCKED in-page; the module reads them from
   the window at capture time, so the fakes exercise the real
   capture/IndexedDB/extraction code paths end to end.
   Exit 0 only when every contract holds.
   Usage: node qa-voice.cjs  (server must be on :8765)
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const CHROME = 'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe';
const PORT = 9231;
const BASE = 'http://127.0.0.1:8765';
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-voice-' + Date.now());
let ws, msgId = 0;
const pending = new Map();
const results = [];
const log = (s) => { process.stdout.write('[voice] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG'); try { ws && ws.close(); } catch (e) {} process.exit(2); }, 300000);
function send(method, params) { return new Promise(res => { const id = ++msgId; pending.set(id, m => { pending.delete(id); res(m.result || {}); }); ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
async function ev(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text }; return r.result && r.result.value; }

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) break; } catch (e) {} await delay(300); }
  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: BASE + '/seed-test.html' }); await delay(4000);

  const check = (name, val, detail) => { results.push({ name, val, detail }); log((val ? 'PASS' : 'FAIL') + ' ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail))); };

  // ---- 0. boot: Voice module present + boot gate satisfied ----
  await ev('document.querySelector(".sec-btn[data-section=meet]").click()'); await delay(300);
  const boot = await ev('(function(){return {v: !!window.MMGR.Voice, t: !!window.MMGR.Voice.TIERS, tier0: window.MMGR.Voice.TIERS.tier0.label};})()');
  check('V01 boot: MMGR.Voice + TIERS registered', !!(boot.v && boot.t), boot);

  // ---- 1. mock MediaRecorder + getUserMedia in-page ----
  // NOTE (skeptical-audit finding): headless Chrome here exposes NATIVE
  // MediaRecorder, SpeechRecognition and navigator.mediaDevices. Plain
  // `navigator.mediaDevices = {...}` assignment silently fails (the native
  // getUserMedia then rejects — no mic), and SpeechRecognition is present
  // but can't actually run headless. So: force-override mediaDevices via
  // defineProperty and explicitly disable SpeechRecognition so the Tier 0
  // circuit-break path is exercised deterministically.
  const mocked = await ev(`(function(){
    window.__voiceChunks = [];
    window.__voiceRec = null;
    window.__fakeStream = { getTracks: function(){ return [{ stop: function(){} }]; } };
    try {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: function(){ return Promise.resolve(window.__fakeStream); } },
        configurable: true, writable: true
      });
    } catch(e) { return { err: String(e) }; }
    // Deterministic Tier 0 circuit-break: force the "unavailable" path
    // (headless cannot run real speech recognition regardless).
    window.SpeechRecognition = undefined;
    window.webkitSpeechRecognition = undefined;
    window.MediaRecorder = function FakeMediaRecorder(stream, opts){
      var self = this;
      self.stream = stream; self.state = 'inactive'; self._opts = opts || {};
      window.__voiceRec = self;
      self.start = function(ts){ self._ts = ts; self.state = 'recording'; };
      self.stop = function(){ if (self.state === 'inactive') return; self.state = 'inactive'; if (self.onstop) self.onstop(); };
    };
    window.__voiceRecStartTimeslice = function(){ return window.__voiceRec ? window.__voiceRec._ts : null; };
    window.__voiceRecEmit = function(byte){
      var rec = window.__voiceRec;
      if (!rec || !rec.ondataavailable) return false;
      rec.ondataavailable({ data: new Blob([new Uint8Array([byte||1,2,3])], {type:'audio/webm'}) });
      return true;
    };
    return { rec: typeof window.MediaRecorder === 'function', gum: typeof navigator.mediaDevices.getUserMedia === 'function' };
  })()`);
  check('V02 mock: fake MediaRecorder + getUserMedia installed', mocked.rec === true && mocked.gum === true, mocked);

  // ---- 2. start a meeting + start capture ----
  await ev('MMGR.Meetings.startMeeting("weekly");'); await delay(300);
  const started = await ev('(async function(){ return await MMGR.Voice.startCapture(); })()');
  await delay(600);
  check('V03 capture: startCapture returns true', started === true, started);
  const recState = await ev('(function(){var m=MMGR.State.getState().activeMeeting;return {state:m.captureState, method:m.captureMethod, sid:!!m.captureSession};})()');
  check('V04 capture: state=recording + tier0 + session id', recState.state === 'recording' && recState.method === 'tier0' && recState.sid, recState);
  const ui = await ev('(function(){return {rec: !!document.querySelector(".voice-rec"), dot: !!document.querySelector(".voice-dot"), timer: !!document.getElementById("voice-timer"), meter: !!document.getElementById("voice-meter-fill"), chunks: document.getElementById("voice-chunks") ? document.getElementById("voice-chunks").textContent : null, ts: window.__voiceRecStartTimeslice()};})()');
  check('V05 UI: REC indicator + timer + level meter visible (consent surface)', !!(ui.rec && ui.dot && ui.timer && ui.meter), ui);
  check('V06 capture: 10s chunk window (5-10s per plan)', ui.ts === 10000, ui.ts);

  // ---- 3. chunk persistence + abrupt-kill durability (1.5.1 acceptance) ----
  await ev('window.__voiceRecEmit(1);'); await delay(200);
  await ev('window.__voiceRecEmit(2);'); await delay(200);
  await ev('window.__voiceRecEmit(3);'); await delay(200);
  const chunksUI = await ev('document.getElementById("voice-chunks") ? document.getElementById("voice-chunks").textContent : null');
  check('V07 chunks: 3 emitted -> UI counter shows 3', chunksUI === '3 chunks saved', chunksUI);
  const sid = await ev('MMGR.State.getState().activeMeeting.captureSession');
  const cnt = await ev('MMGR.Voice.countChunks("' + sid + '")');
  check('V08 chunks: 3 persisted to IndexedDB (each flushed on arrival)', cnt === 3, cnt);
  // Abrupt kill simulation: do NOT stop/finalize — session must be detected
  // as pending, and all emitted chunks must survive (at most one un-flushed
  // chunk is the in-flight 10s window, never the full meeting).
  const pend = await ev('(async function(){ var list = await MMGR.Voice.pendingSessions(); return { n: list.length, finalized: list.length ? list[0].finalized : null }; })()');
  check('V09 crash-safety: kill leaves non-finalized pending session detected', pend.n === 1 && pend.finalized === false, pend);
  const cntAfter = await ev('MMGR.Voice.countChunks("' + sid + '")');
  check('V10 crash-safety: zero emitted chunks lost on abrupt kill', cntAfter === 3, cntAfter);

  // ---- 4. Tier 0 circuit-break (SpeechRecognition disabled in the mock) ----
  const sr = await ev('typeof window.SpeechRecognition + "|" + typeof window.webkitSpeechRecognition');
  check('V11 tier0: SpeechRecognition disabled for deterministic circuit-break test', sr === 'undefined|undefined', sr);
  const tierNoteRaw = await ev('(function(){ var n=document.getElementById("voice-tier-note"); return { found: !!n, text: n ? n.textContent : null }; })()');
  const tierNote = tierNoteRaw && tierNoteRaw.text;
  check('V12 tier0: circuit-broken gracefully — capture continues, note shown', !!tierNote && tierNote.indexOf('unavailable') > -1, tierNoteRaw);
  const noChipLive = await ev('document.querySelectorAll(".voice-recover").length');
  check('V12b no-spam: no "interrupted session" chip while recording (live session excluded)', noChipLive === 0, noChipLive);

  // ---- 5. stop -> finalize -> transcript editable ----
  const stopped = await ev('MMGR.Voice.stopCapture();');
  await delay(300);
  check('V13 stop: stopCapture returns true', stopped === true, stopped);
  const afterStop = await ev('(function(){var m=MMGR.State.getState().activeMeeting;return {state:m.captureState, editable: !!document.querySelector(".voice-captions[data-action=updMeetField]")};})()');
  check('V14 stop: state=stopped + transcript editable (no readonly lock)', afterStop.state === 'stopped' && afterStop.editable, afterStop);
  const fin = await ev('(async function(){ var list = await MMGR.Voice.pendingSessions(); return { n: list.length }; })()');
  check('V15 stop: session finalized (no longer pending)', fin.n === 0, fin);

  // ---- 6. rule-based extraction (1.5.4) — zero AI, zero network ----
  const xr = await ev('MMGR.Voice.extractFromTranscript("I\'ll send the steel order by Friday. We agreed on the glazing spec. The crane is fine.")');
  check('V16 extract: action detected with due date', xr.actions.length === 1 && String(xr.actions[0].due).toLowerCase() === 'friday' && xr.actions[0].text.toLowerCase().indexOf('send the steel order') > -1, xr);
  check('V17 extract: decision detected', xr.decisions.length === 1 && xr.decisions[0].text.indexOf('glazing spec') > -1, xr);
  check('V18 extract: unrelated sentence ignored (no false positive)', xr.actions.length === 1 && xr.decisions.length === 1, xr);

  // endMeeting -> applyExtractionToState -> Decision Log + meeting promises
  await ev('(function(){ MMGR.State.updateState(function(s){ s.activeMeeting.transcript = "I\'ll chase the drawings by tomorrow. We decided to use the alternate supplier."; }); return true; })()');
  await ev('(function(){ window.__fetchCalls = 0; var orig = window.fetch; window.fetch = function(){ window.__fetchCalls++; return orig.apply(window, arguments); }; return true; })()');
  const ended = await ev('MMGR.Meetings.endMeeting();');
  await delay(400);
  const zeroNet = await ev('window.__fetchCalls');
  check('V19 extraction: zero network calls (zero AI, pure rules)', zeroNet === 0, zeroNet);
  const state = await ev('(function(){ var s = MMGR.State.getState(); return { log: s.logEntries, prom: s.meetingPromises, hist: s.meetings[0] ? { t: s.meetings[0].transcript, k: s.meetings[0].kind } : null }; })()');
  const logHit = (state.log || []).filter(l => (l.decision || '').indexOf('alternate supplier') > -1).length;
  const promHit = (state.prom && state.prom.weekly || []).filter(p => (p.text || '').indexOf('drawings') > -1).length;
  const histHit = state.hist && state.hist.t && state.hist.t.indexOf('alternate supplier') > -1 && state.hist.k === 'weekly';
  check('V20 end: decision written to Decision Log from transcript', logHit === 1, state.log);
  check('V21 end: action written to meeting promises (Meeting-to-Action)', promHit === 1, state.prom);
  check('V22 end: transcript persisted on the meeting record (unified state)', histHit === true, state.hist);

  // ---- 7. discard path + recovery chip ----
  await ev('MMGR.Meetings.startMeeting("risk");'); await delay(200);
  const d1 = await ev('(async function(){ await MMGR.Voice.startCapture(); return true; })()'); await delay(300);
  await ev('window.__voiceRecEmit(9);'); await delay(200);
  const d2 = await ev('MMGR.Voice.discardCapture(false);'); await delay(400);
  const dState = await ev('(function(){var m=MMGR.State.getState().activeMeeting;return {state:m.captureState, t:m.transcript};})()');
  check('V23 discard: clears recording state + transcript', d2 === true && dState.state === null && dState.t === '', dState);
  // interrupted session -> recovery chip appears once
  await ev('(async function(){ var sid2 = await MMGR.Voice.newSession(MMGR.State.getState().activeMeeting.id, "risk"); await MMGR.Voice.appendChunk(sid2, new Blob([new Uint8Array([7])], {type:"audio/webm"})); await MMGR.Voice.renderCaptureSection(); return true; })()'); await delay(400);
  const chip1 = await ev('document.querySelectorAll(".voice-recover").length');
  check('V24 recovery: interrupted session surfaces a dismissible chip', chip1 === 1, chip1);
  await ev('MMGR.Voice.dismissRecovery();');
  await ev('MMGR.Voice.renderCaptureSection();'); await delay(300);
  const chip2 = await ev('document.querySelectorAll(".voice-recover").length');
  check('V25 recovery: dismissed once, not re-prompted (no spam)', chip2 === 0, chip2);

  // ---- 8. Tier 1: offline whisper WASM (bundled in-repo) ----
  const t1reg = await ev('MMGR.Voice.TIERS.tier1');
  check('T01 tier1: registry ungated (ships with the build)', t1reg && t1reg.gated === false, t1reg);
  const t1math = await ev('(function(){ try { var ac = new AudioContext(); var b = ac.createBuffer(2, 48000, 48000); var d0 = b.getChannelData(0), d1 = b.getChannelData(1); for (var i = 0; i < d0.length; i++) { d0[i] = 0.5; d1[i] = 1.0; } var mono = MMGR.Voice.mixToMono16k(b); ac.close(); if (!mono) return { err: "null" }; var ok = mono.length === 16000; for (var j = 0; ok && j < mono.length; j++) { if (Math.abs(mono[j] - 0.75) > 1e-3) ok = false; } return { len: mono.length, ok: ok, first: mono[0] }; } catch (e) { return { err: String(e) }; } })()');
  check('T02 tier1: mixToMono16k -> 1s stereo 48k downmixes to 16k mono avg', t1math.ok === true && t1math.len === 16000, t1math);
  const t1cb = await ev('(async function(){ var ok = await MMGR.Voice.initTier1("vendor/whisper/NO-SUCH-MODEL.bin"); return { ok: ok, err: MMGR.Voice.tier1Status().error }; })()');
  check('T03 tier1: circuit-break — bad model path resolves false, no throw', t1cb.ok === false && !!t1cb.err, t1cb);
  const t1no = await ev('MMGR.Voice.transcribeOffline();');
  check('T04 tier1: transcribeOffline with no session returns false gracefully', t1no === false, t1no);
  // Dedupe regression (review fix): the same meeting extracted twice (e.g.
  // endMeeting from partial captions, then whisper completion from the full
  // text) must not duplicate Decision Log / promise entries.
  const dd = await ev('(function(){ var m = { id: 999, kind: "weekly", transcript: "I\'ll send the rebar by Friday. We agreed on the sealant brand." }; MMGR.Voice.applyExtractionToState(m); MMGR.Voice.applyExtractionToState(m); var s = MMGR.State.getState(); return { log: (s.logEntries || []).filter(function(e){ return e.sourceMeetingId === 999; }).length, prom: ((s.meetingPromises || {}).weekly || []).filter(function(p){ return p.sourceMeetingId === 999; }).length }; })()');
  check('T05 dedupe: double extraction of one meeting adds no duplicates', dd.log === 1 && dd.prom === 1, dd);

  if (process.env.RUN_WHISPER === '1') {
    // ---- 9. REAL offline pipeline (opt-in): bundled whisper WASM end-to-end ----
    // Proves the full Tier 1 stack: module worker + WASM + bundled model +
    // decode + transcribe + unified-state write. Uses the bundled reference
    // jfk.wav sample staged through the REAL IndexedDB chunk path.
    log('RUN_WHISPER=1 — running the real offline whisper pipeline (may take a minute)...');
    await ev('MMGR.Meetings.startMeeting("weekly");'); await delay(300);
    await ev('(async function(){ await MMGR.Voice.startCapture(); return true; })()'); await delay(500);
    const wsid = await ev('MMGR.State.getState().activeMeeting.captureSession');
    const jfk = await ev('(async function(){ var b = await (await fetch("vendor/whisper/samples/jfk.wav")).blob(); await MMGR.Voice.appendChunk("' + wsid + '", b); return b.size; })()');
    check('T10 real: jfk.wav staged as a session chunk via IndexedDB', jfk > 300000, jfk);
    // Stop + immediately end: exercises the race where the meeting record is
    // built BEFORE whisper finishes — the result must still land on the
    // stored record and extract.
    await ev('MMGR.Voice.stopCapture(); MMGR.Meetings.endMeeting();');
    let done = false, tx = '', cm = null;
    for (let i = 0; i < 150 && !done; i++) {
      await delay(2000);
      const st = await ev('(function(){ var s = MMGR.State.getState(); var m = (s.meetings || [])[0]; var t1 = MMGR.Voice.tier1Status(); return { t: m ? m.transcript : "", cm: m ? m.captureMethod : null, busy: t1.transcribing, ts: m ? m.transcribeState : null }; })()');
      if (st && st.t && st.t.length > 15) { done = true; tx = st.t; cm = st.cm; }
      else if (st && !st.busy && st.ts === 'failed') break;
    }
    check('T11 real: whisper transcribes jfk offline -> transcript on stored meeting', done === true && tx.length > 15, { done, tx: tx.slice(0, 120), cm });
    check('T12 real: captureMethod=tier1 on the stored meeting record', cm === 'tier1', cm);
  } else {
    log('RUN_WHISPER=1 to execute the real offline whisper end-to-end check (worker + wasm + model).');
  }

  // cleanly cancel the meeting (stub confirm so the discard proceeds)
  await ev('(function(){ var o = window.confirm; window.confirm = function(){ return true; }; MMGR.Meetings.cancelActiveMeeting(); window.confirm = o; return true; })()'); await delay(200);

  const failed = results.filter(r => !r.val);
  log('VOICE_GATE ' + (failed.length === 0 ? 'PASS' : 'FAIL (' + failed.length + ' broken)'));
  proc.kill(); process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
