'use strict';
/* Regex-free HTML stripping for the static gates.
   The gates read repository files, never untrusted input, but CodeQL cannot
   tell a QA harness from a sanitizer. These helpers avoid multi-character
   replace patterns and handle spaced end tags such as "</script >" so the
   security scan stays clean without weakening either gate. */

function stripComments(html) {
  const s = String(html || '');
  let out = '';
  let i = 0;
  for (;;) {
    const a = s.indexOf('<!--', i);
    if (a < 0) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, a);
    const b = s.indexOf('-->', a + 4);
    if (b < 0) {
      // Unterminated comment: nothing after it is visible.
      break;
    }
    i = b + 3;
  }
  return out;
}

function stripScripts(html) {
  const s = String(html || '');
  const lower = s.toLowerCase();
  let out = '';
  let i = 0;
  for (;;) {
    const a = lower.indexOf('<script', i);
    if (a < 0) {
      out += s.slice(i);
      break;
    }
    // A tag boundary only: "<script" followed by space, tab, CR, LF, > or /.
    const next = s.charAt(a + 7);
    if (next && !/[\s>/]/.test(next)) {
      out += s.slice(i, a + 7);
      i = a + 7;
      continue;
    }
    out += s.slice(i, a);
    const close = lower.indexOf('</script', a + 7);
    if (close < 0) {
      break;
    }
    const gt = s.indexOf('>', close + 8);
    if (gt < 0) {
      break;
    }
    i = gt + 1;
  }
  return out;
}

module.exports = { stripComments, stripScripts };
