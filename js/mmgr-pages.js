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
    { key: 'divider', label: 'Divider' }
  ];
  const BLOCK_KEYS = BLOCK_TYPES.map(function (b) {
    return b.key;
  });
  const BLOCK_LABEL = {};
  BLOCK_TYPES.forEach(function (b) {
    BLOCK_LABEL[b.key] = b.label;
  });

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

  function normalizeBlock(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const type = isBlockType(src.type) ? src.type : 'paragraph';
    return {
      id: typeof src.id === 'string' && src.id ? src.id : genId('b'),
      type: type,
      text: text(src.text, MAX_TEXT),
      done: src.done === true
    };
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
    const block = {
      id: genId('b'),
      type: isBlockType(type) ? type : 'paragraph',
      text: '',
      done: false
    };
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

  ns.Pages = {
    BLOCK_TYPES: BLOCK_TYPES,
    MAX_TITLE: MAX_TITLE,
    MAX_TEXT: MAX_TEXT,
    isBlockType: isBlockType,
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
    collapseTrailing: collapseTrailing
  };
})(MMGR);
window.MMGR = MMGR;
