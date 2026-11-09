/* Pages model unit tests. js/mmgr-pages.js is loaded into a vm sandbox so the
   tree, block and repair rules are deterministic without a browser. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'js', 'mmgr-pages.js'), 'utf8');

const sandbox = { window: {}, console };
sandbox.window.MMGR = { Utils: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const P = sandbox.window.MMGR.Pages;
const plain = value => JSON.parse(JSON.stringify(value));
const base = () => ({ pages: [] });

test('a new page starts with one paragraph block', () => {
  const s = base();
  const page = P.newPage(s, { title: 'Project book' });
  assert.ok(page && page.id);
  assert.equal(page.title, 'Project book');
  assert.equal(page.parentId, '');
  assert.equal(page.blocks.length, 1);
  assert.equal(page.blocks[0].type, 'paragraph');
  assert.equal(page.blocks[0].text, '');
});

test('pages nest three deep and flatten in tree order', () => {
  const s = base();
  const a = P.newPage(s, { title: 'A' });
  const b = P.newPage(s, { parentId: a.id, title: 'B' });
  const c = P.newPage(s, { parentId: b.id, title: 'C' });
  const rows = P.flatten(s);
  assert.deepEqual(plain(rows.map(r => [r.page.title, r.depth])), [
    ['A', 0],
    ['B', 1],
    ['C', 2]
  ]);
  assert.equal(c.parentId, b.id);
  assert.equal(P.descendantCount(s, a.id), 2);
});

test('move refuses a page into its own descendant', () => {
  const s = base();
  const a = P.newPage(s, { title: 'A' });
  const b = P.newPage(s, { parentId: a.id, title: 'B' });
  const res = P.move(s, a.id, b.id, null);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'descendant');
  // The tree is unchanged.
  assert.equal(P.find(s, a.id).parentId, '');
  assert.equal(P.find(s, b.id).parentId, a.id);
});

test('move reparents and moveSibling reorders', () => {
  const s = base();
  const a = P.newPage(s, { title: 'A' });
  const b = P.newPage(s, { title: 'B' });
  const c = P.newPage(s, { title: 'C' });
  assert.equal(P.move(s, c.id, a.id, null).ok, true);
  assert.equal(P.find(s, c.id).parentId, a.id);
  assert.equal(P.move(s, c.id, '', null).ok, true);
  assert.equal(P.find(s, c.id).parentId, '');
  // Root order is A, B, C. Move C up once -> A, C, B.
  P.moveSibling(s, c.id, 'up');
  assert.deepEqual(plain(P.flatten(s).map(r => r.page.title)), ['A', 'C', 'B']);
  assert.equal(b.id.length > 0, true);
});

test('remove deletes every descendant and reports the ids', () => {
  const s = base();
  const a = P.newPage(s, { title: 'A' });
  const b = P.newPage(s, { parentId: a.id, title: 'B' });
  const c = P.newPage(s, { parentId: b.id, title: 'C' });
  const out = P.remove(s, a.id);
  assert.equal(out.removed.length, 3);
  assert.equal(P.list(s).length, 0);
  assert.equal(P.find(s, c.id), null);
});

test('blocks add, edit, toggle, reorder and remove', () => {
  const s = base();
  const page = P.newPage(s, { title: 'Method' });
  const first = page.blocks[0];
  const bullet = P.addBlock(s, page.id, 'bullet', first.id);
  const check = P.addBlock(s, page.id, 'checklist', bullet.id);
  assert.deepEqual(plain(P.find(s, page.id).blocks.map(b => b.type)), [
    'paragraph',
    'bullet',
    'checklist'
  ]);
  assert.equal(P.setBlockText(s, page.id, bullet.id, 'Lay the kerb'), true);
  assert.equal(P.find(s, page.id).blocks[1].text, 'Lay the kerb');
  assert.equal(P.toggleBlock(s, page.id, check.id), true);
  assert.equal(P.find(s, page.id).blocks[2].done, true);
  assert.equal(P.toggleBlock(s, page.id, check.id), true);
  assert.equal(P.find(s, page.id).blocks[2].done, false);
  assert.equal(P.moveBlock(s, page.id, check.id, 'up'), true);
  assert.deepEqual(plain(P.find(s, page.id).blocks.map(b => b.type)), [
    'paragraph',
    'checklist',
    'bullet'
  ]);
  assert.equal(P.removeBlock(s, page.id, check.id), true);
  assert.deepEqual(plain(P.find(s, page.id).blocks.map(b => b.type)), ['paragraph', 'bullet']);
});

test('an unknown block type and missing fields are repaired on read', () => {
  const s = {
    pages: [
      {
        id: 'pg1',
        parentId: 'ghost',
        blocks: [{ id: 'b1', type: 'rich-html', text: '<b>x</b>' }]
      }
    ]
  };
  const page = P.list(s)[0];
  assert.equal(page.parentId, '', 'an orphan parent is lifted to the root');
  assert.equal(page.title, '');
  assert.equal(page.blocks[0].type, 'paragraph');
  assert.equal(page.blocks[0].text, '<b>x</b>', 'text is stored as plain text');
  assert.equal('html' in page.blocks[0], false);
  assert.equal('html' in page, false);
});

test('empty trailing blocks collapse but a single blank block stays', () => {
  const s = base();
  const page = P.newPage(s, { title: 'Body' });
  P.addBlock(s, page.id, 'paragraph', '');
  P.addBlock(s, page.id, 'paragraph', '');
  const raw = s.pages[0];
  assert.equal(raw.blocks.length, 3);
  assert.equal(P.collapseTrailing(raw), true);
  assert.equal(raw.blocks.length, 1);
  // A page with one empty block keeps it so the writer still has a cursor.
  assert.equal(P.collapseTrailing(raw), false);
});

test('newPage under a missing parent is refused', () => {
  const s = base();
  assert.equal(P.newPage(s, { parentId: 'nope', title: 'X' }), null);
  assert.equal(P.list(s).length, 0);
});

test('the model never stores HTML', () => {
  const s = base();
  const page = P.newPage(s, { title: '<img onerror=alert(1)>' });
  P.setBlockText(s, page.id, page.blocks[0].id, '<script>alert(1)</script>');
  const raw = plain(s.pages[0]);
  assert.equal(raw.title, '<img onerror=alert(1)>', 'title is text, escaped at render time');
  assert.equal(raw.blocks[0].text, '<script>alert(1)</script>');
  assert.equal(Object.keys(raw.blocks[0]).sort().join(','), 'done,id,text,type');
});
