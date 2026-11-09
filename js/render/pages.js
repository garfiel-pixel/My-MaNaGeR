/* ============================================================
   My MaNaGeR, project book renderer (AppFlowy-inspired)
   ------------------------------------------------------------
   The Documents panel has two views: the Register (unchanged) and
   Pages (the tree + the body of typed blocks). The model owns the
   rules; this file owns markup only. Every control is a data-action,
   so the read-only fence covers the whole surface with no new logic.

   A page is a lens on the project, never a second surface: nothing
   here writes a task or a register row.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const S = () => (ns.State ? ns.State.getState() : null);
  const U = ns.Utils;
  const $ = U.$;
  const esc = U.escapeHtml;

  const ICON = function (id) {
    return (
      '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#' + id + '"></use></svg>'
    );
  };

  function iconBtn(action, attrs, icon, label) {
    return (
      '<button class="pg-ib" data-action="' +
      action +
      '" ' +
      attrs +
      ' title="' +
      esc(label) +
      '" aria-label="' +
      esc(label) +
      '">' +
      ICON(icon) +
      '</button>'
    );
  }

  function syncSwitcher(s) {
    const btns = document.querySelectorAll('[data-action="setDocsView"]');
    const pages = s.docsView === 'pages';
    btns.forEach(function (b) {
      const on = b.getAttribute('data-view') === (pages ? 'pages' : 'register');
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const reg = $('docs-register');
    const pg = $('docs-pages');
    if (reg) {
      reg.hidden = pages;
    }
    if (pg) {
      pg.hidden = !pages;
    }
  }

  function treeRow(row, selected) {
    const p = row.page;
    const title = p.title || 'Untitled page';
    return (
      '<div class="pg-row' +
      (selected ? ' is-on' : '') +
      '" data-page-row="' +
      esc(p.id) +
      '" draggable="true" style="--pg-depth:' +
      row.depth +
      '">' +
      '<button class="pg-tw" data-action="selectPage" data-id="' +
      esc(p.id) +
      '"' +
      (selected ? ' aria-current="true"' : '') +
      '>' +
      esc(title) +
      '</button>' +
      '<span class="pg-rowacts">' +
      iconBtn(
        'addPage',
        'data-parent="' + esc(p.id) + '"',
        'i-plus',
        'Add a child page under ' + title
      ) +
      iconBtn(
        'movePageSibling',
        'data-id="' + esc(p.id) + '" data-dir="up"',
        'i-arrow-up',
        'Move ' + title + ' up'
      ) +
      iconBtn(
        'movePageSibling',
        'data-id="' + esc(p.id) + '" data-dir="down"',
        'i-arrow-down',
        'Move ' + title + ' down'
      ) +
      iconBtn('delPage', 'data-id="' + esc(p.id) + '"', 'i-trash', 'Delete ' + title) +
      '</span></div>'
    );
  }

  function parentSelect(s, page) {
    const rows = ns.Pages.flatten(s).filter(function (r) {
      return r.page.id !== page.id && ns.Pages.descendantIds(s, page.id).indexOf(r.page.id) < 0;
    });
    const opts = ['<option value="">Top level</option>'].concat(
      rows.map(function (r) {
        return (
          '<option value="' +
          esc(r.page.id) +
          '"' +
          (r.page.parentId === page.id ? '' : '') +
          '>' +
          esc(new Array(r.depth + 1).join('\u00a0\u00a0') + r.page.title) +
          '</option>'
        );
      })
    );
    return (
      '<label class="pg-pl" for="pg-parent">Parent</label>' +
      '<select id="pg-parent" class="ctl-in pg-parent" data-action="movePage" data-id="' +
      esc(page.id) +
      '">' +
      opts.join('') +
      '</select>'
    );
  }

  function blockMarkup(page, block) {
    const pid = esc(page.id);
    const bid = esc(block.id);
    const base = 'data-page="' + pid + '" data-block="' + bid + '"';
    let body = '';
    if (block.type === 'divider') {
      body = '<hr class="pg-hr">';
    } else if (block.type === 'checklist') {
      body =
        '<div class="pg-chk">' +
        '<input type="checkbox" class="pg-cb" data-action="toggleBlock" ' +
        base +
        (block.done ? ' checked' : '') +
        ' aria-label="Done: ' +
        esc(block.text || 'checklist item') +
        '">' +
        '<textarea class="pg-in" rows="1" data-action="setBlockText" ' +
        base +
        ' aria-label="Checklist item text" placeholder="Checklist item">' +
        esc(block.text) +
        '</textarea></div>';
    } else if (block.type === 'callout') {
      body =
        '<div class="pg-callout"><textarea class="pg-in" rows="2" data-action="setBlockText" ' +
        base +
        ' aria-label="Callout text" placeholder="Read this before you price it">' +
        esc(block.text) +
        '</textarea></div>';
    } else if (block.type === 'heading') {
      body =
        '<textarea class="pg-in pg-in-h" rows="1" data-action="setBlockText" ' +
        base +
        ' aria-label="Heading text" placeholder="Heading">' +
        esc(block.text) +
        '</textarea>';
    } else if (block.type === 'bullet') {
      body =
        '<div class="pg-bul"><span class="pg-bul-dot" aria-hidden="true"></span>' +
        '<textarea class="pg-in" rows="1" data-action="setBlockText" ' +
        base +
        ' aria-label="Bullet text" placeholder="Bullet">' +
        esc(block.text) +
        '</textarea></div>';
    } else {
      body =
        '<textarea class="pg-in" rows="2" data-action="setBlockText" ' +
        base +
        ' aria-label="Paragraph text" placeholder="Write here">' +
        esc(block.text) +
        '</textarea>';
    }
    return (
      '<div class="pg-b pg-b-' +
      esc(block.type) +
      '" data-block-row="' +
      bid +
      '">' +
      '<div class="pg-bbar"><span class="pg-bt">' +
      esc(ns.Pages.blockLabel(block.type)) +
      '</span>' +
      iconBtn('moveBlock', base + ' data-dir="up"', 'i-arrow-up', 'Move this block up') +
      iconBtn('moveBlock', base + ' data-dir="down"', 'i-arrow-down', 'Move this block down') +
      iconBtn('delBlock', base, 'i-x', 'Remove this block') +
      '</div>' +
      body +
      '</div>'
    );
  }

  function bodyMarkup(s, page) {
    const blocks = page.blocks || [];
    const addRow =
      '<div class="pg-add"><span class="pg-add-l">Add block</span>' +
      ns.Pages.BLOCK_TYPES.map(function (t) {
        return (
          '<button class="btn btn-n btn-s" data-action="addBlock" data-page="' +
          esc(page.id) +
          '" data-type="' +
          esc(t.key) +
          '">' +
          esc(t.label) +
          '</button>'
        );
      }).join('') +
      '</div>';
    return (
      '<div class="pg-head">' +
      '<label class="pg-pl" for="pg-title">Page title</label>' +
      '<input id="pg-title" class="ctl-in pg-title" type="text" maxlength="' +
      ns.Pages.MAX_TITLE +
      '" data-action="renamePage" data-id="' +
      esc(page.id) +
      '" value="' +
      esc(page.title) +
      '" aria-label="Page title">' +
      parentSelect(s, page) +
      '</div>' +
      '<div class="pg-blocks">' +
      (blocks.length
        ? blocks
            .map(function (b) {
              return blockMarkup(page, b);
            })
            .join('')
        : '<div class="es es-row">This page has no blocks yet. Add one below.</div>') +
      '</div>' +
      addRow
    );
  }

  function renderPages() {
    const s = S();
    if (!s) {
      return;
    }
    syncSwitcher(s);
    if (s.docsView !== 'pages') {
      return;
    }
    const body = $('pages-body');
    if (!body) {
      return;
    }
    const rows = ns.Pages.flatten(s);
    if (!rows.length) {
      body.innerHTML =
        '<div class="es es-row"><div>No pages yet. A page can hold the reasoning, ' +
        'method statements and handover notes that do not belong in a task row.</div>' +
        '<div class="es-actions"><button class="btn btn-g btn-s" data-action="addPage">' +
        'Create the first page</button></div></div>';
      return;
    }
    let page = s.pageSel ? ns.Pages.find(s, s.pageSel) : null;
    if (!page) {
      page = rows[0].page;
    }
    body.innerHTML =
      '<div class="pg-tree" role="tree" aria-label="Page tree">' +
      rows
        .map(function (r) {
          return treeRow(r, page && r.page.id === page.id);
        })
        .join('') +
      '</div>' +
      (page ? '<div class="pg-body">' + bodyMarkup(s, page) + '</div>' : '');
  }

  ns.RenderPages = { renderPages: renderPages };
})(MMGR);
window.MMGR = MMGR;
