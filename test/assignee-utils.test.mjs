/* Assignee helpers: trimmed, case-insensitive matching plus the shared
   datalist population. js/mmgr-utils.js is loaded into a vm sandbox with the
   small browser surface it touches at module load. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'js', 'mmgr-utils.js'), 'utf8');

function makeSandbox() {
  const sandbox = { console };
  sandbox.window = {
    MMGR: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: fn => fn(),
    cancelAnimationFrame: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  };
  sandbox.document = {
    addEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => {
      let text = '';
      return {
        style: {},
        setAttribute: () => {},
        appendChild: () => {},
        set textContent(v) {
          text = v == null ? '' : String(v);
        },
        get innerHTML() {
          return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
      };
    },
    body: { appendChild: () => {}, classList: { add: () => {}, remove: () => {} } }
  };
  sandbox.localStorage = sandbox.window.localStorage;
  sandbox.navigator = { userAgent: '' };
  vm.createContext(sandbox);
  return sandbox;
}

const base = makeSandbox();
vm.runInContext(source, base);
const U = base.window.MMGR.Utils;

test('assigneeKey trims and lowercases', () => {
  assert.equal(U.assigneeKey('  Alice  '), 'alice');
  assert.equal(U.assigneeKey(null), '');
  assert.equal(U.assigneeKey(undefined), '');
});

test('sameAssignee matches case and surrounding space, rejects empty', () => {
  assert.equal(U.sameAssignee('Alice', ' alice '), true);
  assert.equal(U.sameAssignee('Alice', 'Alicia'), false);
  assert.equal(U.sameAssignee('', ''), false);
  assert.equal(U.sameAssignee('  ', '  '), false);
  assert.equal(U.sameAssignee(null, 'Alice'), false);
});

test('populateAssigneeOptions fills the datalist, deduped and trimmed', () => {
  let written = '';
  const list = {
    set innerHTML(v) {
      written = v;
    },
    get innerHTML() {
      return written;
    }
  };
  const s2 = makeSandbox();
  s2.document.getElementById = id => (id === 'wbs-assignee-options' ? list : null);
  vm.runInContext(source, s2);
  const U2 = s2.window.MMGR.Utils;
  U2.populateAssigneeOptions({
    resources: [
      { name: 'Alice' },
      { name: ' Bob ' },
      { name: 'Alice' },
      { name: '' },
      { name: null },
      null
    ]
  });
  assert.match(written, /<option value="Alice"><\/option>/);
  assert.match(written, /<option value="Bob"><\/option>/);
  assert.equal((written.match(/Alice/g) || []).length, 1);
});
