// AI-2 spike worker: runs transformers.js off the main thread so the page stays
// responsive (acceptance: no main-thread freeze). Throwaway, not shipped.
import { pipeline } from 'https://esm.sh/@huggingface/transformers@4.3.2?target=es2022';

let total = 0;
const realFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  const res = await realFetch(input, init);
  try {
    const url = typeof input === 'string' ? input : input.url;
    const len = Number(res.headers.get('content-length') || 0);
    if (len && /onnx|\.wasm|safetensors|huggingface/i.test(url)) total += len;
  } catch (e) {}
  return res;
};

self.onmessage = async ev => {
  const { model, prompt, maxTokens } = ev.data || {};
  const out = { loadMs: 0, ttftMs: 0, genMs: 0, tokens: 0, text: '', bytes: 0, error: null };
  try {
    const t0 = performance.now();
    let pipe = null;
    try {
      pipe = await pipeline('text-generation', model, { dtype: 'q4', device: 'wasm' });
      out.dtype = 'q4';
    } catch (e) {
      out.dtype = 'q8';
      out.note = 'dtype q4 refused: ' + String(e && e.message ? e.message : e);
      pipe = await pipeline('text-generation', model, { dtype: 'q8', device: 'wasm' });
    }
    out.loadMs = Math.round(performance.now() - t0);
    out.bytes = total;
    const t1 = performance.now();
    const res = await pipe([{ role: 'user', content: prompt }], {
      max_new_tokens: maxTokens,
      do_sample: false,
      return_full_text: false
    });
    const t2 = performance.now();
    const g = res && res[0] ? res[0].generated_text : null;
    let text = '';
    if (typeof g === 'string') {
      text = g;
    } else if (Array.isArray(g)) {
      const last =
        g
          .slice()
          .reverse()
          .find(x => x && x.role === 'assistant') || g[g.length - 1];
      text = typeof last === 'string' ? last : (last && (last.content || last.text)) || '';
    } else if (g) {
      text = JSON.stringify(g);
    }
    out.text = text.slice(0, 400);
    out.genMs = Math.round(t2 - t1);
    out.ttftMs = out.genMs;
    try {
      const tok = pipe.tokenizer(text);
      out.tokens = tok.input_ids.length;
    } catch (e) {
      out.tokens = (text.match(/\S+/g) || []).length;
    }
    out.bytes = total;
  } catch (e) {
    out.error = String(e && e.message ? e.message : e);
  }
  self.postMessage(out);
};
