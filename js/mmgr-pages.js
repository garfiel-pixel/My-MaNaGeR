/* ============================================================
   My MaNaGeR, project book model (AppFlowy-inspired)
   ------------------------------------------------------------
   A page is a tree node with a body of typed blocks:
     - pages are a FLAT array with a parentId (never nested), so a
       move is one write and a field-level merge cannot duplicate a
       subtree;
     - a body is an ordered list of blocks, each {id, type, text};
     - text is plain text, never HTML. Formatting IS the block type.

   No DOM, no storage, no timers. The Node test loads this file in a
   vm sandbox, so keep every dependency behind ns.Utils.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const BLOCK_TYPES = [
    { key: 'paragraph', label: 'Paragraph' },
    { key: 'heading', label: 'Heading' },
    { key: 'bullet', label: 'Bullet' },
    { key: 'checklist', label: 'Checklist item' },
    { key: 'callout', label: 'Callout' },
    { key: 'divider', label: 'Divider' },
    // Live blocks store a FILTER, never data. They read the same task array
    // and register the panels own; nothing is copied at insert time, so a
    // page cannot hold a snapshot that is wrong by Friday.
    { key: 'taskList', label: 'Task list', live: true },
    { key: 'docList', label: 'Document list', live: true }
  ];
  const BLOCK_KEYS = BLOCK_TYPES.map(function (b) {
    return b.key;
  });
  const BLOCK_LABEL = {};
  const LIVE_TYPES = {};
  BLOCK_TYPES.forEach(function (b) {
    BLOCK_LABEL[b.key] = b.label;
    if (b.live) {
      LIVE_TYPES[b.key] = 1;
    }
  });

  const TASK_STATUSES = ['todo', 'inprogress', 'blocked', 'completed'];
  const TASK_STATUS_LABEL = {
    todo: 'To do',
    inprogress: 'In progress',
    blocked: 'Blocked',
    completed: 'Completed'
  };
  const DOC_TYPES = ['Drawing', 'Contract', 'Permit', 'Specification', 'Report', 'Other'];
  const DOC_STATUSES = ['current', 'pending-review', 'superseded', 'outstanding'];
  const TASK_WINDOWS = [
    { days: 0, label: 'Any date' },
    { days: 7, label: 'Next 7 days' },
    { days: 30, label: 'Next 30 days' },
    { days: 90, label: 'Next 90 days' }
  ];

  const MAX_TITLE = 200;
  const MAX_TEXT = 20000;
  const MAX_BLOCKS = 5000;

  function text(v, max) {
    if (v === null || v === undefined) {
      return '';
    }
    return String(v).slice(0, max);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function genId(prefix) {
    if (ns.Utils && typeof ns.Utils.genId === 'function') {
      return ns.Utils.genId(prefix);
    }
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function isBlockType(key) {
    return Object.prototype.hasOwnProperty.call(BLOCK_LABEL, key);
  }

  function num(v, fallback) {
    const n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }

  function oneOf(v, list, fallback) {
    return list.indexOf(v) > -1 ? v : fallback;
  }

  function normalizeFilter(type, raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    if (type === 'taskList') {
      const w = parseInt(src.window, 10);
      return {
        phase: typeof src.phase === 'string' ? src.phase : '',
        status: oneOf(src.status, TASK_STATUSES, ''),
        assignee: typeof src.assignee === 'string' ? src.assignee : '',
        window: w === 7 || w === 30 || w === 90 ? w : 0
      };
    }
    if (type === 'docList') {
      return {
        type: oneOf(src.type, DOC_TYPES, ''),
        status: oneOf(src.status, DOC_STATUSES, '')
      };
    }
    return null;
  }

  function normalizeBlock(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const type = isBlockType(src.type) ? src.type : 'paragraph';
    const out = {
      id: typeof src.id === 'string' && src.id ? src.id : genId('b'),
      type: type,
      text: text(src.text, MAX_TEXT),
      done: src.done === true
    };
    if (LIVE_TYPES[type]) {
      out.filter = normalizeFilter(type, src.filter);
    }
    return out;
  }

  // One page, repaired on read. Missing fields get safe defaults; an
  // unknown block type becomes a paragraph so an older/newer build can
  // never blank a body.
  function normalizePage(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const blocks = Array.isArray(src.blocks)
      ? src.blocks.slice(0, MAX_BLOCKS).map(normalizeBlock)
      : [];
    return {
      id: typeof src.id === 'string' && src.id ? src.id : '',
      parentId: typeof src.parentId === 'string' && src.parentId ? src.parentId : '',
      title: text(src.title, MAX_TITLE),
      sort: num(src.sort, 0),
      blocks: blocks,
      createdAt: typeof src.createdAt === 'string' ? src.createdAt : '',
      updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : ''
    };
  }

  // All pages, repaired. A page whose parent is missing (or is itself)
  // is lifted to the root so a bad import cannot make it unreachable.
  function list(state) {
    const raw = state && Array.isArray(state.pages) ? state.pages : [];
    const out = raw.map(normalizePage);
    const byId = {};
    out.forEach(function (p) {
      if (p.id) {
        byId[p.id] = p;
      }
    });
    out.forEach(function (p) {
      if (p.parentId && (!byId[p.parentId] || p.parentId === p.id)) {
        p.parentId = '';
      }
    });
    return out;
  }

  function rawList(state) {
    if (!state) {
      return [];
    }
    if (!Array.isArray(state.pages)) {
      state.pages = [];
    }
    return state.pages;
  }

  function find(state, id) {
    if (typeof id !== 'string' || !id) {
      return null;
    }
    const pages = list(state);
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].id === id) {
        return pages[i];
      }
    }
    return null;
  }

  function rawFind(state, id) {
    const raw = rawList(state);
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] && raw[i].id === id) {
        return raw[i];
      }
    }
    return null;
  }

  function childrenOf(pages, parentId) {
    return pages
      .filter(function (p) {
        return p.parentId === parentId;
      })
      .sort(function (a, b) {
        return a.sort - b.sort || String(a.id).localeCompare(String(b.id));
      });
  }

  // Depth-first tree order with a depth for indentation.
  function flatten(state) {
    const pages = list(state);
    const out = [];
    function walk(parentId, depth) {
      childrenOf(pages, parentId).forEach(function (p) {
        out.push({ page: p, depth: depth });
        walk(p.id, depth + 1);
      });
    }
    walk('', 0);
    return out;
  }

  function descendantIds(state, id) {
    const pages = list(state);
    const out = [];
    function walk(parentId) {
      childrenOf(pages, parentId).forEach(function (p) {
        out.push(p.id);
        walk(p.id);
      });
    }
    walk(id);
    return out;
  }

  function descendantCount(state, id) {
    return descendantIds(state, id).length;
  }

  function nextSort(state, parentId) {
    const pages = list(state);
    const sibs = childrenOf(pages, parentId);
    if (!sibs.length) {
      return 1;
    }
    return sibs[sibs.length - 1].sort + 1;
  }

  function touch(page) {
    page.updatedAt = nowIso();
    if (!page.createdAt) {
      page.createdAt = page.updatedAt;
    }
  }

  function newPage(state, opts) {
    const o = opts || {};
    const raw = rawList(state);
    const parentId = typeof o.parentId === 'string' && o.parentId ? o.parentId : '';
    if (parentId && !find(state, parentId)) {
      return null;
    }
    const page = {
      id: genId('pg'),
      parentId: parentId,
      title: text(o.title, MAX_TITLE) || 'Untitled page',
      sort: nextSort(state, parentId),
      blocks: [
        {
          id: genId('b'),
          type: 'paragraph',
          text: '',
          done: false
        }
      ],
      createdAt: '',
      updatedAt: ''
    };
    touch(page);
    raw.push(page);
    return page;
  }

  function rename(state, id, title) {
    const page = rawFind(state, id);
    if (!page) {
      return false;
    }
    page.title = text(title, MAX_TITLE) || 'Untitled page';
    touch(page);
    return true;
  }

  // Removes the page and every descendant. Returns the ids removed so the
  // caller can report the cascade before it happens.
  function remove(state, id) {
    const ids = descendantIds(state, id);
    const all = [id].concat(ids);
    const raw = rawList(state);
    for (let i = raw.length - 1; i >= 0; i--) {
      if (raw[i] && all.indexOf(raw[i].id) > -1) {
        raw.splice(i, 1);
      }
    }
    return { removed: all };
  }

  // Reparent / reorder. Refuses a drop into the page's own descendant,
  // and refuses a drop onto itself.
  function move(state, id, parentId, beforeId) {
    const page = rawFind(state, id);
    if (!page) {
      return { ok: false, reason: 'missing' };
    }
    const parent = parentId || '';
    if (parent === id) {
      return { ok: false, reason: 'self' };
    }
    if (parent && descendantIds(state, id).indexOf(parent) > -1) {
      return { ok: false, reason: 'descendant' };
    }
    if (parent && !find(state, parent)) {
      return { ok: false, reason: 'missing-parent' };
    }
    page.parentId = parent;
    const pages = list(state);
    const sibs = childrenOf(pages, parent).filter(function (p) {
      return p.id !== id;
    });
    const idx = beforeId
      ? sibs.findIndex(function (p) {
          return p.id === beforeId;
        })
      : -1;
    if (idx > -1) {
      sibs.splice(idx, 0, page);
    } else {
      sibs.push(page);
    }
    sibs.forEach(function (p, i) {
      p.sort = i + 1;
    });
    // Persist the order back onto the raw records (list() is a copy).
    sibs.forEach(function (p) {
      const r = rawFind(state, p.id);
      if (r) {
        r.sort = p.sort;
        r.parentId = p.parentId;
      }
    });
    touch(page);
    return { ok: true };
  }

  function moveSibling(state, id, dir) {
    const page = find(state, id);
    if (!page) {
      return false;
    }
    const sibs = childrenOf(list(state), page.parentId);
    const at = sibs.findIndex(function (p) {
      return p.id === id;
    });
    const to = dir === 'up' ? at - 1 : at + 1;
    if (at < 0 || to < 0 || to >= sibs.length) {
      return false;
    }
    const before = dir === 'up' ? sibs[to].id : sibs[to + 1] && sibs[to + 1].id;
    return move(state, id, page.parentId, before || null).ok;
  }

  function blockList(state, pageId) {
    const page = rawFind(state, pageId);
    if (!page) {
      return null;
    }
    if (!Array.isArray(page.blocks)) {
      page.blocks = [];
    }
    return page.blocks;
  }

  function addBlock(state, pageId, type, afterId) {
    const blocks = blockList(state, pageId);
    if (!blocks) {
      return null;
    }
    const key = isBlockType(type) ? type : 'paragraph';
    const block = {
      id: genId('b'),
      type: key,
      text: '',
      done: false
    };
    if (LIVE_TYPES[key]) {
      block.filter = normalizeFilter(key, {});
    }
    const at = afterId
      ? blocks.findIndex(function (b) {
          return b && b.id === afterId;
        })
      : -1;
    if (at > -1) {
      blocks.splice(at + 1, 0, block);
    } else {
      blocks.push(block);
    }
    const page = rawFind(state, pageId);
    if (page) {
      touch(page);
    }
    return block;
  }

  function setBlockText(state, pageId, blockId, value) {
    const blocks = blockList(state, pageId);
    if (!blocks) {
      return false;
    }
    const block = blocks.find(function (b) {
      return b && b.id === blockId;
    });
    if (!block) {
      return false;
    }
    block.text = text(value, MAX_TEXT);
    const page = rawFind(state, pageId);
    if (page) {
      touch(page);
    }
    return true;
  }

  function toggleBlock(state, pageId, blockId) {
    const blocks = blockList(state, pageId);
    if (!blocks) {
      return false;
    }
    const block = blocks.find(function (b) {
      return b && b.id === blockId;
    });
    if (!block || block.type !== 'checklist') {
      return false;
    }
    block.done = !block.done;
    const page = rawFind(state, pageId);
    if (page) {
      touch(page);
    }
    return true;
  }

  function removeBlock(state, pageId, blockId) {
    const blocks = blockList(state, pageId);
    if (!blocks) {
      return false;
    }
    const at = blocks.findIndex(function (b) {
      return b && b.id === blockId;
    });
    if (at < 0) {
      return false;
    }
    blocks.splice(at, 1);
    const page = rawFind(state, pageId);
    if (page) {
      touch(page);
    }
    return true;
  }

  function moveBlock(state, pageId, blockId, dir) {
    const blocks = blockList(state, pageId);
    if (!blocks) {
      return false;
    }
    const at = blocks.findIndex(function (b) {
      return b && b.id === blockId;
    });
    const to = dir === 'up' ? at - 1 : at + 1;
    if (at < 0 || to < 0 || to >= blocks.length) {
      return false;
    }
    const tmp = blocks[at];
    blocks[at] = blocks[to];
    blocks[to] = tmp;
    const page = rawFind(state, pageId);
    if (page) {
      touch(page);
    }
    return true;
  }

  // ---- live blocks: read-only projections -------------------------------
  // A page is a lens, not a second surface: these functions only READ the
  // task array and the register. Nothing here writes, and no result is
  // stored - the block keeps its filter and re-resolves on every draw.

  function todayStr() {
    if (ns.Utils && typeof ns.Utils.todayStr === 'function') {
      return ns.Utils.todayStr();
    }
    return new Date().toISOString().slice(0, 10);
  }

  function addDays(iso, n) {
    const d = new Date(iso + 'T12:00:00');
    if (isNaN(d.getTime())) {
      return iso;
    }
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function isPhaseTask(t) {
    return !!t && (t.isPhase === true || (t.level || 0) === 0);
  }

  // The nearest preceding phase row owns each task, matching how the WBS
  // indents the outline.
  function taskPhaseMap(state) {
    const map = {};
    let current = '';
    const tasks = state && Array.isArray(state.tasks) ? state.tasks : [];
    tasks.forEach(function (t) {
      if (!t) {
        return;
      }
      if (isPhaseTask(t)) {
        current = t.id;
      }
      map[t.id] = current;
    });
    return map;
  }

  function resolveTasks(state, filter) {
    const f = normalizeFilter('taskList', filter);
    const tasks = state && Array.isArray(state.tasks) ? state.tasks : [];
    const phases = taskPhaseMap(state);
    const limit = f.window ? addDays(todayStr(), f.window) : '';
    return tasks
      .filter(function (t) {
        if (!t || isPhaseTask(t)) {
          return false;
        }
        if (f.phase && phases[t.id] !== f.phase) {
          return false;
        }
        if (f.status && t.status !== f.status) {
          return false;
        }
        if (f.assignee && String(t.assignee || '').trim() !== f.assignee) {
          return false;
        }
        if (limit) {
          const due = t.endDate || t.startDate || '';
          if (!due || due > limit) {
            return false;
          }
        }
        return true;
      })
      .map(function (t) {
        return {
          id: t.id,
          name: t.name || 'Untitled task',
          status: t.status || 'todo',
          assignee: String(t.assignee || '').trim(),
          endDate: t.endDate || ''
        };
      });
  }

  // Writes one filter key on a live block. The filter is the only thing a
  // live block stores; the rows are resolved at draw time and never saved.
  function setFilter(state, pageId, blockId, key, value) {
    const blocks = blockList(state, pageId);
    if (!blocks) {
      return false;
    }
    const block = blocks.find(function (b) {
      return b && b.id === blockId;
    });
    if (!block || !LIVE_TYPES[block.type]) {
      return false;
    }
    const current = normalizeFilter(block.type, block.filter);
    const next = {};
    Object.keys(current).forEach(function (k) {
      next[k] = current[k];
    });
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      return false;
    }
    next[key] = typeof next[key] === 'number' ? parseInt(value, 10) || 0 : String(value || '');
    block.filter = normalizeFilter(block.type, next);
    const page = rawFind(state, pageId);
    if (page) {
      touch(page);
    }
    return true;
  }

  function resolveDocs(state, filter) {
    const f = normalizeFilter('docList', filter);
    const docs = state && Array.isArray(state.documents) ? state.documents : [];
    return docs
      .filter(function (d) {
        if (!d) {
          return false;
        }
        if (f.type && d.type !== f.type) {
          return false;
        }
        if (f.status && d.status !== f.status) {
          return false;
        }
        return true;
      })
      .map(function (d, i) {
        return {
          id: d.id || 'D' + (i + 1),
          docNo: d.docNo || '',
          title: d.title || 'Untitled document',
          type: d.type || '',
          status: d.status || ''
        };
      });
  }

  function filterOptions(state) {
    const tasks = state && Array.isArray(state.tasks) ? state.tasks : [];
    const phases = [];
    const seenP = {};
    const assignees = [];
    const seenA = {};
    tasks.forEach(function (t) {
      if (!t) {
        return;
      }
      if (isPhaseTask(t) && !seenP[t.id]) {
        seenP[t.id] = 1;
        phases.push({ id: t.id, name: t.name || 'Untitled phase' });
      }
      const a = String(t.assignee || '').trim();
      if (a && !seenA[a]) {
        seenA[a] = 1;
        assignees.push(a);
      }
    });
    assignees.sort();
    return {
      phases: phases,
      assignees: assignees,
      statuses: TASK_STATUSES.map(function (s) {
        return { key: s, label: TASK_STATUS_LABEL[s] };
      }),
      windows: TASK_WINDOWS.slice(),
      docTypes: DOC_TYPES.slice(),
      docStatuses: DOC_STATUSES.slice()
    };
  }

  // An empty result names the filter: "No data" reads like a bug.
  function emptyFilterText(state, type, filter) {
    const f = normalizeFilter(type, filter);
    const bits = [];
    if (type === 'taskList') {
      if (f.phase) {
        const phases = filterOptions(state).phases;
        const hit = phases.find(function (p) {
          return p.id === f.phase;
        });
        bits.push('phase ' + (hit ? hit.name : f.phase));
      }
      if (f.status) {
        bits.push(TASK_STATUS_LABEL[f.status] || f.status);
      }
      if (f.assignee) {
        bits.push('assigned to ' + f.assignee);
      }
      if (f.window) {
        bits.push('in the next ' + f.window + ' days');
      }
      return 'No tasks match' + (bits.length ? ': ' + bits.join(', ') : ' this filter') + '.';
    }
    if (f.type) {
      bits.push(f.type);
    }
    if (f.status) {
      bits.push(f.status);
    }
    return 'No documents match' + (bits.length ? ': ' + bits.join(', ') : ' this filter') + '.';
  }

  // Empty trailing blocks are invisible weight. Collapse them when the
  // last block is blank and at least one earlier block exists.
  function collapseTrailing(page) {
    if (!page || !Array.isArray(page.blocks) || page.blocks.length < 2) {
      return false;
    }
    let changed = false;
    while (page.blocks.length > 1) {
      const last = page.blocks[page.blocks.length - 1];
      if (last && last.type !== 'divider' && !String(last.text || '').trim()) {
        page.blocks.pop();
        changed = true;
      } else {
        break;
      }
    }
    return changed;
  }

  function blockLabel(key) {
    return BLOCK_LABEL[key] || BLOCK_LABEL.paragraph;
  }

  // ---- Templates carry a page tree -------------------------------------
  // A template stores a page as a shape: a local `key`, the `parent` key, a
  // title and its blocks. Ids are stripped, so applying the same template
  // twice yields two independent branches.
  function blockShape(block) {
    const type = isBlockType(block && block.type) ? block.type : 'paragraph';
    if (LIVE_TYPES[type]) {
      return { type: type, filter: normalizeFilter(type, block && block.filter) };
    }
    return {
      type: type,
      text: text(block && block.text, MAX_TEXT),
      done: !!(block && block.done === true)
    };
  }

  function pageShape(page, parentKey, key) {
    const blocks = page && Array.isArray(page.blocks) ? page.blocks : [];
    return {
      key: String(key || (page && page.id) || ''),
      parent: String(parentKey || ''),
      title: text(page && page.title, MAX_TITLE),
      blocks: blocks.map(blockShape)
    };
  }

  function captureTree(state) {
    const rows = flatten(state);
    const keys = {};
    return rows.map(function (r, i) {
      const key = 'k' + (i + 1);
      keys[r.page.id] = key;
      return pageShape(r.page, r.page.parentId ? keys[r.page.parentId] || '' : '', key);
    });
  }

  // Parents first, source order otherwise. A cycle or a dangling parent
  // lifts the remaining pages to the root instead of dropping them.
  function orderShapes(list) {
    const out = [];
    const seen = {};
    let progress = true;
    while (out.length < list.length && progress) {
      progress = false;
      list.forEach(function (s) {
        if (seen[s.key]) {
          return;
        }
        if (!s.parent || seen[s.parent]) {
          seen[s.key] = 1;
          out.push(s);
          progress = true;
        }
      });
    }
    list.forEach(function (s) {
      if (!seen[s.key]) {
        seen[s.key] = 1;
        out.push(s);
      }
    });
    return out;
  }

  function applyTree(state, shapes) {
    const list = Array.isArray(shapes) ? shapes : [];
    if (!state || !list.length) {
      return 0;
    }
    if (!Array.isArray(state.pages)) {
      state.pages = [];
    }
    const used = {};
    const shapes2 = list.map(function (raw, i) {
      const shape = pageShape(raw, raw && raw.parent, raw && raw.key ? raw.key : 'k' + (i + 1));
      let key = shape.key;
      let n = 1;
      while (used[key]) {
        n += 1;
        key = shape.key + '~' + n;
      }
      shape.key = key;
      used[key] = 1;
      return shape;
    });
    const ids = {};
    let made = 0;
    orderShapes(shapes2).forEach(function (shape) {
      const parentId = shape.parent ? ids[shape.parent] || '' : '';
      const page = newPage(state, { parentId: parentId, title: shape.title });
      if (!page) {
        return;
      }
      ids[shape.key] = page.id;
      made += 1;
      if (!shape.blocks.length) {
        return;
      }
      page.blocks.length = 0;
      shape.blocks.forEach(function (b) {
        const block = addBlock(state, page.id, b.type);
        if (!block) {
          return;
        }
        if (LIVE_TYPES[block.type]) {
          Object.keys(b.filter || {}).forEach(function (k) {
            setFilter(state, page.id, block.id, k, b.filter[k]);
          });
        } else if (b.text) {
          setBlockText(state, page.id, block.id, b.text);
        }
        if (b.done === true && block.type === 'checklist') {
          toggleBlock(state, page.id, block.id);
        }
      });
    });
    return made;
  }

  // ---- The register link ------------------------------------------------
  // A register row may point at one page. The link lives on the document,
  // never on the page: deleting a page leaves the row, and the renderer
  // shows it as unlinked again.
  function docList(state) {
    return state && Array.isArray(state.documents) ? state.documents : [];
  }

  function linkDoc(state, docId, pageId) {
    const doc = docList(state).find(function (d) {
      return d && d.id === docId;
    });
    if (!doc) {
      return false;
    }
    const target = pageId || '';
    if (target && !find(state, target)) {
      return false;
    }
    doc.pageId = target;
    return true;
  }

  function unlinkDoc(state, docId) {
    return linkDoc(state, docId, '');
  }

  function linkedPageIds(state) {
    const out = {};
    docList(state).forEach(function (d) {
      if (d && d.pageId) {
        out[d.pageId] = 1;
      }
    });
    return out;
  }

  // The unfiled view keeps unlinked pages and the ancestors that hold them,
  // so the tree still reads; `context` marks the ancestor-only rows.
  function unfiledRows(state) {
    const rows = flatten(state);
    const linked = linkedPageIds(state);
    const unlinked = {};
    const byId = {};
    rows.forEach(function (r) {
      byId[r.page.id] = r.page;
      if (!linked[r.page.id]) {
        unlinked[r.page.id] = 1;
      }
    });
    const keep = {};
    Object.keys(unlinked).forEach(function (id) {
      keep[id] = 1;
    });
    Object.keys(unlinked).forEach(function (id) {
      let p = byId[id];
      while (p && p.parentId && !keep[p.parentId]) {
        keep[p.parentId] = 1;
        p = byId[p.parentId];
      }
    });
    return rows
      .filter(function (r) {
        return keep[r.page.id];
      })
      .map(function (r) {
        return { page: r.page, depth: r.depth, context: !unlinked[r.page.id] };
      });
  }

  // ---- The handover pack -------------------------------------------------
  // A pack is assembled, never stored: the branch order, every block, the
  // live rows as they stand today, and the register rows linked from this
  // branch grouped by type.
  function packBlock(state, block) {
    const type = block.type;
    if (LIVE_TYPES[type]) {
      return {
        type: type,
        label: blockLabel(type),
        live: true,
        filter: normalizeFilter(type, block.filter),
        rows:
          type === 'taskList' ? resolveTasks(state, block.filter) : resolveDocs(state, block.filter)
      };
    }
    return {
      type: type,
      label: blockLabel(type),
      text: text(block.text, MAX_TEXT),
      done: block.done === true
    };
  }

  function buildPack(state, rootId) {
    const root = find(state, rootId);
    if (!root) {
      return null;
    }
    const all = flatten(state);
    const rootDepth = all.reduce(function (depth, r) {
      return r.page.id === rootId ? r.depth : depth;
    }, 0);
    const branch = descendantIds(state, rootId);
    const rows = all.filter(function (r) {
      return r.page.id === rootId || branch.indexOf(r.page.id) > -1;
    });
    const inBranch = {};
    rows.forEach(function (r) {
      inBranch[r.page.id] = 1;
    });
    const groups = [];
    const byType = {};
    docList(state).forEach(function (d) {
      if (!d || !d.pageId || !inBranch[d.pageId]) {
        return;
      }
      const key = d.type || 'Other';
      if (!byType[key]) {
        byType[key] = { type: key, rows: [] };
        groups.push(byType[key]);
      }
      byType[key].rows.push({
        id: d.id || '',
        docNo: d.docNo || '',
        title: d.title || 'Untitled document',
        status: d.status || ''
      });
    });
    groups.sort(function (a, b) {
      return a.type.localeCompare(b.type);
    });
    return {
      project: text(state.projectName, MAX_TITLE) || 'Untitled project',
      assembled: todayStr(),
      rootId: root.id,
      rootTitle: root.title,
      pages: rows.map(function (r) {
        return {
          id: r.page.id,
          title: r.page.title,
          depth: r.depth - rootDepth,
          blocks: (r.page.blocks || []).map(function (b) {
            return packBlock(state, b);
          })
        };
      }),
      docs: groups
    };
  }

  ns.Pages = {
    BLOCK_TYPES: BLOCK_TYPES,
    LIVE_TYPES: LIVE_TYPES,
    TASK_STATUSES: TASK_STATUSES,
    TASK_STATUS_LABEL: TASK_STATUS_LABEL,
    DOC_TYPES: DOC_TYPES,
    DOC_STATUSES: DOC_STATUSES,
    TASK_WINDOWS: TASK_WINDOWS,
    MAX_TITLE: MAX_TITLE,
    MAX_TEXT: MAX_TEXT,
    isBlockType: isBlockType,
    normalizeFilter: normalizeFilter,
    setFilter: setFilter,
    resolveTasks: resolveTasks,
    resolveDocs: resolveDocs,
    filterOptions: filterOptions,
    emptyFilterText: emptyFilterText,
    blockLabel: blockLabel,
    normalizeBlock: normalizeBlock,
    normalizePage: normalizePage,
    list: list,
    find: find,
    flatten: flatten,
    childrenOf: childrenOf,
    descendantIds: descendantIds,
    descendantCount: descendantCount,
    newPage: newPage,
    rename: rename,
    remove: remove,
    move: move,
    moveSibling: moveSibling,
    addBlock: addBlock,
    setBlockText: setBlockText,
    toggleBlock: toggleBlock,
    removeBlock: removeBlock,
    moveBlock: moveBlock,
    collapseTrailing: collapseTrailing,
    pageShape: pageShape,
    captureTree: captureTree,
    applyTree: applyTree,
    linkDoc: linkDoc,
    unlinkDoc: unlinkDoc,
    linkedPageIds: linkedPageIds,
    unfiledRows: unfiledRows,
    buildPack: buildPack
  };
})(MMGR);
window.MMGR = MMGR;
