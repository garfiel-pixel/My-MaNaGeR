/* ============================================================
   gen-messy-wav.cjs — build a realistically messy meeting
   recording for DIR-2 stress validation (no ffmpeg required).
   Mixes: PM speech (full) + foreman speech (slightly ducked) +
   background babble (low) + white noise (low) + slap echo.
   Output: vendor/whisper/samples/messy-meeting.wav (16-bit PCM)
   Usage: node tools/gen-messy-wav.cjs
   ============================================================ */
const fs = require('fs');
const path = require('path');

const SAMPLES_DIR = path.join(__dirname, '..', 'vendor', 'whisper', 'samples');

// ---- minimal WAV reader (RIFF, 16-bit PCM mono/stereo) ----
function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error(file + ': not RIFF');
  let off = 12;
  let fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(off + 8),
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        bits: buf.readUInt16LE(off + 22)
      };
    } else if (id === 'data') {
      data = buf.subarray(off + 8, off + 8 + sz);
    }
    off += 8 + sz + (sz % 2);
  }
  if (!fmt || !data) throw new Error(file + ': missing fmt/data');
  if (fmt.audioFormat !== 1) throw new Error(file + ': not PCM (fmt ' + fmt.audioFormat + ')');
  const bytesPerSample = fmt.bits / 8;
  const samples = new Float32Array(Math.floor(data.length / bytesPerSample));
  for (let i = 0; i < samples.length; i++) {
    const v = data.readInt16LE(i * bytesPerSample);
    samples[i] = v / 32768;
  }
  return { samples, channels: fmt.channels, rate: fmt.sampleRate, bits: fmt.bits };
}

function toMono(w) {
  if (w.channels === 1) return w.samples;
  const n = Math.floor(w.samples.length / w.channels);
  const m = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < w.channels; c++) s += w.samples[i * w.channels + c];
    m[i] = s / w.channels;
  }
  return m;
}

function resample(s, fromRate, toRate) {
  if (fromRate === toRate) return s;
  const out = new Float32Array(Math.max(1, Math.round(s.length * toRate / fromRate)));
  const ratio = fromRate / toRate;
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const l = Math.floor(pos);
    const r = Math.min(l + 1, s.length - 1);
    const w = pos - l;
    out[i] = s[l] * (1 - w) + s[r] * w;
  }
  return out;
}

function writeWav(file, samples, rate) {
  const n = samples.length;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

// ---- mix ----
const RATE = 44100;
const pm = resample(toMono(readWav(path.join(SAMPLES_DIR, 'tts-pm.wav'))), readWav(path.join(SAMPLES_DIR, 'tts-pm.wav')).rate, RATE);
const fm = resample(toMono(readWav(path.join(SAMPLES_DIR, 'tts-fm.wav'))), readWav(path.join(SAMPLES_DIR, 'tts-fm.wav')).rate, RATE);
const babble = resample(toMono(readWav(path.join(SAMPLES_DIR, 'tts-babble.wav'))), readWav(path.join(SAMPLES_DIR, 'tts-babble.wav')).rate, RATE);

const total = Math.max(pm.length, fm.length, babble.length) + Math.round(RATE * 1.5);
const mix = new Float32Array(total);

// Voice levels: PM full, foreman slightly ducked, babble as background
function add(dst, src, gain, startSample) {
  for (let i = 0; i < src.length; i++) {
    const j = startSample + i;
    if (j < dst.length) dst[j] += src[i] * gain;
  }
}
add(mix, pm, 0.9, 0);
add(mix, fm, 0.7, Math.round(RATE * 0.2));         // foreman starts as PM trails (overlap)
add(mix, babble, 0.18, Math.round(RATE * 0.45));    // background babble mid-meeting

// White noise (jobsite background) at low level
const noise = new Float32Array(total);
let state = 0x12345678;
for (let i = 0; i < total; i++) {
  state = (state * 1103515245 + 12345) & 0x7fffffff;
  noise[i] = ((state / 0x7fffffff) * 2 - 1) * 0.06;
  mix[i] += noise[i];
}

// Slap echo (short delay, decaying) — simulates a reverb-y site trailer
const delaySamples = Math.round(RATE * 0.09);
const echoGain = 0.25;
for (let i = delaySamples; i < total; i++) {
  mix[i] += mix[i - delaySamples] * echoGain;
}

// Soft clip to keep peaks in range
for (let i = 0; i < total; i++) {
  let v = mix[i];
  v = Math.tanh(v * 1.4) / 1.4;
  mix[i] = v;
}

const outFile = path.join(SAMPLES_DIR, 'messy-meeting.wav');
writeWav(outFile, mix, RATE);
console.log('WROTE ' + outFile + ' (' + fs.statSync(outFile).size + ' bytes, ' + (total / RATE).toFixed(1) + 's)');
