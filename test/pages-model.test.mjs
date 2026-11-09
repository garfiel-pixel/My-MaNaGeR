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
sandbox.window.MMGR = { Utils: { todayStr: () => '2026-10-26' } };
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

// ---- Phase 2: live blocks -------------------------------------------------

const taskBase = () => ({
  pages: [],
  tasks: [
    { id: 'p1', name: 'Groundworks', isPhase: true, level: 0, status: 'todo' },
    {
      id: 't1',
      name: 'Excavate',
      level: 1,
      status: 'todo',
      assignee: 'Ana',
      endDate: '2026-10-28'
    },
    {
      id: 't2',
      name: 'Pour',
      level: 1,
      status: 'completed',
      assignee: 'Bo',
      endDate: '2026-10-30'
    },
    { id: 'p2', name: 'Frame', isPhase: true, level: 0, status: 'todo' },
    { id: 't3', name: 'Studs', level: 1, status: 'todo', assignee: 'Ana', endDate: '2026-12-01' }
  ],
  documents: [
    { id: 'D1', docNo: 'A-101', title: 'Plan', type: 'Drawing', status: 'current' },
    { id: 'D2', docNo: 'C-001', title: 'Contract', type: 'Contract', status: 'outstanding' }
  ]
});

test('resolveTasks filters by phase, status, assignee and window', () => {
  const s = taskBase();
  assert.deepEqual(plain(P.resolveTasks(s, { phase: 'p1' }).map(t => t.id)), ['t1', 't2']);
  assert.deepEqual(plain(P.resolveTasks(s, { status: 'completed' }).map(t => t.id)), ['t2']);
  assert.deepEqual(plain(P.resolveTasks(s, { assignee: 'Ana' }).map(t => t.id)), ['t1', 't3']);
  assert.deepEqual(plain(P.resolveTasks(s, { window: 7 }).map(t => t.id)), ['t1', 't2']);
  // Phases are headings, never rows.
  assert.equal(
    P.resolveTasks(s, {}).some(t => t.id === 'p1'),
    false
  );
});

test('resolveDocs filters by type and status', () => {
  const s = taskBase();
  assert.deepEqual(plain(P.resolveDocs(s, { type: 'Drawing' }).map(d => d.id)), ['D1']);
  assert.deepEqual(plain(P.resolveDocs(s, { status: 'outstanding' }).map(d => d.id)), ['D2']);
  assert.equal(P.resolveDocs(s, {}).length, 2);
});

test('a live block stores a filter, never resolved rows', () => {
  const s = taskBase();
  const page = P.newPage(s, { title: 'Live' });
  const block = P.addBlock(s, page.id, 'taskList', '');
  assert.deepEqual(plain(block.filter), {
    phase: '',
    status: '',
    assignee: '',
    window: 0
  });
  assert.equal('rows' in block, false);
  assert.equal('data' in block, false);
  P.setFilter(s, page.id, block.id, 'status', 'todo');
  P.setFilter(s, page.id, block.id, 'window', '7');
  const saved = P.find(s, page.id).blocks.find(b => b.type === 'taskList');
  assert.equal(saved.filter.status, 'todo');
  assert.equal(saved.filter.window, 7);
  // An unknown key is refused, not invented.
  assert.equal(P.setFilter(s, page.id, block.id, 'nope', 'x'), false);
});

test('an empty live result names the filter', () => {
  const s = taskBase();
  const page = P.newPage(s, { title: 'Live' });
  const block = P.addBlock(s, page.id, 'docList', '');
  P.setFilter(s, page.id, block.id, 'type', 'Permit');
  const text = P.emptyFilterText(
    s,
    'docList',
    P.find(s, page.id).blocks.find(b => b.type === 'docList').filter
  );
  assert.match(text, /No documents match/);
  assert.match(text, /Permit/);
  assert.doesNotMatch(text, /No data/);
});

test('capturing a template strips ids and keeps the tree', () => {
  const s = base();
  const a = P.newPage(s, { title: 'Scope' });
  const b = P.newPage(s, { parentId: a.id, title: 'Method' });
  P.setBlockText(s, b.id, b.blocks[0].id, 'Sequence');
  const tree = P.captureTree(s);
  assert.deepEqual(plain(tree.map(t => [t.title, t.parent])), [
    ['Scope', ''],
    ['Method', 'k1']
  ]);
  assert.equal(JSON.stringify(tree).indexOf(a.id), -1);
  assert.equal(JSON.stringify(tree).indexOf(b.id), -1);
  assert.equal(tree[1].blocks[0].text, 'Sequence');
});

test('capture, apply and capture again is the same tree', () => {
  const s = base();
  const a = P.newPage(s, { title: 'Scope' });
  P.setBlockText(s, a.id, a.blocks[0].id, 'What this covers.');
  P.addBlock(s, a.id, 'checklist');
  const first = P.captureTree(s);
  const s2 = base();
  P.applyTree(s2, first);
  assert.deepEqual(plain(P.captureTree(s2)), plain(first));
});

test('applying a template twice creates two independent branches', () => {
  const s = base();
  const a = P.newPage(s, { title: 'Scope' });
  P.newPage(s, { parentId: a.id, title: 'Method' });
  const tree = P.captureTree(s);
  s.pages = [];
  assert.equal(P.applyTree(s, tree), 2);
  assert.equal(P.applyTree(s, tree), 2);
  const rows = P.flatten(s);
  assert.deepEqual(plain(rows.map(r => [r.page.title, r.depth])), [
    ['Scope', 0],
    ['Method', 1],
    ['Scope', 0],
    ['Method', 1]
  ]);
  assert.equal(new Set(rows.map(r => r.page.id)).size, 4);
  assert.notEqual(rows[0].page.id, rows[2].page.id);
  assert.equal(rows[3].page.parentId, rows[2].page.id);
});

test('a template page carries live filters, never rows', () => {
  const s = base();
  const p = P.newPage(s, { title: 'Inspections' });
  p.blocks.length = 0;
  const blk = P.addBlock(s, p.id, 'taskList');
  P.setFilter(s, p.id, blk.id, 'status', 'completed');
  const tree = P.captureTree(s);
  assert.deepEqual(plain(tree[0].blocks[0]), {
    type: 'taskList',
    filter: { phase: '', status: 'completed', assignee: '', window: 0 }
  });
  const s2 = taskBase();
  P.applyTree(s2, tree);
  const live = P.flatten(s2)[0].page.blocks.find(b => b.type === 'taskList');
  assert.equal(live.filter.status, 'completed');
  assert.equal('rows' in live, false);
  assert.deepEqual(plain(P.resolveTasks(s2, live.filter).map(t => t.id)), ['t2']);
});

test('an out-of-order template still attaches children to their parent', () => {
  const s = base();
  assert.equal(
    P.applyTree(s, [
      { key: 'child', parent: 'root', title: 'Child', blocks: [] },
      { key: 'root', parent: '', title: 'Root', blocks: [] }
    ]),
    2
  );
  assert.deepEqual(plain(P.flatten(s).map(r => [r.page.title, r.depth])), [
    ['Root', 0],
    ['Child', 1]
  ]);
});

test('a template with no pages applies nothing', () => {
  const s = base();
  assert.equal(P.applyTree(s, []), 0);
  assert.equal(P.applyTree(s, null), 0);
  assert.deepEqual(plain(s.pages), []);
});
