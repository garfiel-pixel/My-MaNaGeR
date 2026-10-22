/* ============================================================
   test/no-unsanitized-html.test.mjs
   ------------------------------------------------------------
   Regression tests for the S-5 rule
   (tools/eslint-rules/no-unsanitized-html.js).

   The rule is the only thing standing between a project name and
   the page's innerHTML, so it needs both directions pinned:

     - it FIRES on a value that reaches innerHTML unescaped
     - it stays QUIET on the values that are provably safe
       (numbers, escaped values, literals from a constant table,
       a line carrying `// ok: <reason>`)

   The second direction matters just as much: a rule that cries
   wolf gets switched off, and a rule that stays silent on
   anything it cannot parse is worse than no rule at all.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import rule from '../tools/eslint-rules/no-unsanitized-html.js';

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      languageOptions: { ecmaVersion: 'latest', sourceType: 'script' },
      plugins: { mmgr: { rules: { 'no-unsanitized-html': rule } } },
      rules: { 'mmgr/no-unsanitized-html': 'error' }
    }
  ]
});

async function findings(code) {
  const [res] = await eslint.lintText(code, { filePath: 'probe.js' });
  return res.messages.filter(m => m.ruleId === 'mmgr/no-unsanitized-html');
}

// ---- it must fire -------------------------------------------------

test('fires on an unescaped identifier from the function arguments', async () => {
  const out = await findings(`
function paint(el, name) {
  el.innerHTML = '<b>' + name + '</b>';
}
`);
  assert.equal(out.length, 1);
  assert.match(out[0].message, /innerHTML/);
});

test('fires on an unescaped template interpolation', async () => {
  const out = await findings(`
function paint(el, task) {
  el.innerHTML = \`<div class="tf-name">\${task.name}</div>\`;
}
`);
  assert.equal(out.length, 1);
});

test('fires inside a map callback that builds a row', async () => {
  const out = await findings(`
function paint(el, rows) {
  el.innerHTML = rows
    .map(function (r) {
      return '<li>' + r.title + '</li>';
    })
    .join('');
}
`);
  assert.equal(out.length, 1);
});

test('fires through insertAdjacentHTML and outerHTML', async () => {
  const out = await findings(`
function paint(el, note) {
  el.insertAdjacentHTML('beforeend', '<p>' + note + '</p>');
  el.outerHTML = '<p>' + note + '</p>';
}
`);
  assert.equal(out.length, 2);
});

// ---- it must stay quiet -------------------------------------------

test('quiet once the value is escaped', async () => {
  const out = await findings(`
function paint(el, name) {
  el.innerHTML = '<b>' + esc(name) + '</b>';
  el.innerHTML = \`<b>\${U.escapeHtml(name)}</b>\`;
}
`);
  assert.deepEqual(out, []);
});

test('quiet on numbers: Number(), Math.round() and toLocaleString()', async () => {
  const out = await findings(`
function paint(el, n) {
  el.innerHTML = '<b>' + Number(n) + '</b>';
  el.innerHTML = '<b>' + Math.round(n) + '</b>';
  el.innerHTML = '<b>' + n.toLocaleString() + '</b>';
}
`);
  assert.deepEqual(out, []);
});

test('quiet on a value read out of a constant table', async () => {
  const out = await findings(`
var TABS = [
  { id: 'general', label: 'General' },
  { id: 'pct', label: 'Percent' }
];
function paint(el) {
  el.innerHTML = TABS.map(function (t) {
    return '<button data-tab="' + t.id + '">' + t.label + '</button>';
  }).join('');
}
`);
  assert.deepEqual(out, []);
});

test('quiet on a literal array element', async () => {
  const out = await findings(`
function paint(el) {
  el.innerHTML = ['n', 's', 'e', 'w'].map(function (d) {
    return '<div class="handle handle-' + d + '"></div>';
  }).join('');
}
`);
  assert.deepEqual(out, []);
});

test('quiet on a builder that escapes everything it emits', async () => {
  const out = await findings(`
function row(title) {
  return '<li>' + esc(title) + '</li>';
}
function paint(el, rows) {
  el.innerHTML = rows.map(row).join('');
}
`);
  assert.deepEqual(out, []);
});

// ---- the marker ---------------------------------------------------

test('an `// ok:` marker on the line suppresses the finding', async () => {
  const out = await findings(`
function paint(el, f) {
  el.innerHTML = '<b>' + f.totalFloat + 'd</b>'; // ok: float is a day count
}
`);
  assert.deepEqual(out, []);
});

test('a bare `// ok` is not an allowance', async () => {
  const out = await findings(`
function paint(el, name) {
  el.innerHTML = '<b>' + name + '</b>'; // ok
}
`);
  assert.equal(out.length, 1);
});

test('a marker on the statement line covers a multi-line template', async () => {
  const out = await findings(`
function paint(el, t) {
  el.innerHTML = // ok: fields are escaped numbers from the engine
    '<b>' + t.days + '</b>';
}
`);
  assert.deepEqual(out, []);
});
