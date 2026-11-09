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

  function treeRow(row, selected, context) {
    const p = row.page;
    const title = p.title || 'Untitled page';
    return (
      '<div class="pg-row' +
      (selected ? ' is-on' : '') +
      (context ? ' is-ctx' : '') +
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

  function filterSelect(attrs, key, value, options, allLabel, label) {
    return (
      '<label class="pg-fl">' +
      esc(label) +
      '</label>' +
      '<select class="ctl-in pg-f" ' +
      attrs +
      ' data-key="' +
      esc(key) +
      '" data-action="setBlockFilter" aria-label="' +
      esc(label) +
      '">' +
      '<option value="">' +
      esc(allLabel) +
      '</option>' +
      options
        .map(function (o) {
          const v = typeof o === 'string' ? o : o.key !== undefined ? o.key : o.id;
          const l = typeof o === 'string' ? o : o.label !== undefined ? o.label : o.name;
          return (
            '<option value="' +
            esc(v) +
            '"' +
            (String(value) === String(v) ? ' selected' : '') +
            '>' +
            esc(l) +
            '</option>'
          );
        })
        .join('') +
      '</select>'
    );
  }

  function liveRow(section, id, title, meta, extra) {
    return (
      '<button class="pg-lr" data-action="pageJump" data-section="' +
      esc(section) +
      '" data-id="' +
      esc(id) +
      '" title="Open this record in its own panel">' +
      '<span class="pg-lt">' +
      esc(title) +
      '</span>' +
      (meta ? '<span class="pg-lm">' + esc(meta) + '</span>' : '') +
      (extra ? '<span class="pg-le">' + esc(extra) + '</span>' : '') +
      '</button>'
    );
  }

  // A viewer reads the filter in words. A disabled select is still a control,
  // and a page is a lens: the viewer gets the same rows, nothing to operate.
  function filterSummary(s, block) {
    const f = block.filter || {};
    const bits = [];
    if (block.type === 'taskList') {
      if (f.phase) {
        const hit = ns.Pages.filterOptions(s).phases.find(function (p) {
          return p.id === f.phase;
        });
        bits.push('phase ' + (hit ? hit.name : f.phase));
      }
      if (f.status) {
        bits.push(ns.Pages.TASK_STATUS_LABEL[f.status] || f.status);
      }
      if (f.assignee) {
        bits.push('assigned to ' + f.assignee);
      }
      if (f.window) {
        const w = ns.Pages.TASK_WINDOWS.find(function (x) {
          return x.days === Number(f.window);
        });
        bits.push(w ? w.label.toLowerCase() : 'in the next ' + f.window + ' days');
      }
      return bits.length ? 'Showing ' + bits.join(' \u00b7 ') : 'Showing every task in the project';
    }
    if (f.type) {
      bits.push(f.type);
    }
    if (f.status) {
      bits.push(f.status);
    }
    return bits.length
      ? 'Showing ' + bits.join(' \u00b7 ')
      : 'Showing every document in the register';
  }

  // A page is a LENS, not a second surface: a live block draws the records
  // the owning panel holds and links out. It never edits one.
  function liveBlockMarkup(s, page, block) {
    const pid = esc(page.id);
    const bid = esc(block.id);
    const base = 'data-page="' + pid + '" data-block="' + bid + '"';
    const f = block.filter || {};
    const opts = ns.Pages.filterOptions(s);
    const ro = !!(ns.App && ns.App.isReadonly && ns.App.isReadonly());
    let filters = '';
    let rows = [];
    let empty = '';
    if (block.type === 'taskList') {
      filters = ro
        ? '<div class="pg-fnote">' + esc(filterSummary(s, block)) + '</div>'
        : filterSelect(base, 'phase', f.phase, opts.phases, 'All phases', 'Phase') +
          filterSelect(base, 'status', f.status, opts.statuses, 'Any status', 'Status') +
          filterSelect(base, 'assignee', f.assignee, opts.assignees, 'Anyone', 'Assignee') +
          filterSelect(
            base,
            'window',
            String(f.window || 0),
            opts.windows.map(function (w) {
              return { key: String(w.days), label: w.label };
            }),
            'Any date',
            'Date'
          );
      rows = ns.Pages.resolveTasks(s, f);
      empty = ns.Pages.emptyFilterText(s, 'taskList', f);
    } else {
      filters = ro
        ? '<div class="pg-fnote">' + esc(filterSummary(s, block)) + '</div>'
        : filterSelect(base, 'type', f.type, opts.docTypes, 'Any type', 'Type') +
          filterSelect(base, 'status', f.status, opts.docStatuses, 'Any status', 'Status');
      rows = ns.Pages.resolveDocs(s, f);
      empty = ns.Pages.emptyFilterText(s, 'docList', f);
    }
    const list = rows.length
      ? '<div class="pg-live">' +
        rows
          .map(function (r) {
            if (block.type === 'taskList') {
              return liveRow(
                'wbs',
                r.id,
                r.name,
                ns.Pages.TASK_STATUS_LABEL[r.status] || r.status,
                r.endDate
              );
            }
            return liveRow('docs', r.docNo || r.title, r.title, r.type, r.status);
          })
          .join('') +
        '</div>'
      : '<div class="pg-empty">' + esc(empty) + '</div>';
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
      '<div class="pg-filters">' +
      filters +
      '</div>' +
      list +
      '</div>'
    );
  }

  function blockMarkup(s, page, block) {
    if (ns.Pages.LIVE_TYPES[block.type]) {
      return liveBlockMarkup(s, page, block);
    }
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
      '<button class="btn btn-n btn-s pg-print" data-action="printPack" data-id="' +
      esc(page.id) +
      '" title="Print this branch as a handover pack">' +
      ICON('i-printer') +
      ' Print pack</button>' +
      '</div>' +
      '<div class="pg-blocks">' +
      (blocks.length
        ? blocks
            .map(function (b) {
              return blockMarkup(s, page, b);
            })
            .join('')
        : '<div class="es es-row">This page has no blocks yet. Add one below.</div>') +
      '</div>' +
      addRow
    );
  }

  function treeBar(s) {
    return (
      '<div class="pg-tbar">' +
      '<label class="pg-tgl"><input type="checkbox" data-action="setPageUnfiled"' +
      (s.pageUnfiled ? ' checked' : '') +
      '> Only pages with no register link</label>' +
      '</div>'
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
    const rows = s.pageUnfiled ? ns.Pages.unfiledRows(s) : ns.Pages.flatten(s);
    if (!rows.length) {
      body.innerHTML =
        treeBar(s) +
        '<div class="es es-row"><div>' +
        (s.pageUnfiled
          ? 'Every page is linked to a register row.'
          : 'No pages yet. A page can hold the reasoning, method statements and ' +
            'handover notes that do not belong in a task row.') +
        '</div><div class="es-actions">' +
        (s.pageUnfiled
          ? ''
          : '<button class="btn btn-g btn-s" data-action="addPage">Create the first page</button>') +
        '</div></div>';
      return;
    }
    let page = s.pageSel ? ns.Pages.find(s, s.pageSel) : null;
    const visible = rows.some(function (r) {
      return page && r.page.id === page.id;
    });
    if (!page || !visible) {
      page = rows[0].page;
    }
    body.innerHTML =
      treeBar(s) +
      '<div class="pg-tree" role="tree" aria-label="Page tree">' +
      rows
        .map(function (r) {
          return treeRow(r, page && r.page.id === page.id, r.context);
        })
        .join('') +
      '</div>' +
      (page ? '<div class="pg-body">' + bodyMarkup(s, page) + '</div>' : '');
  }

  // ---- The handover pack -------------------------------------------------
  // Assembled at print time from the model, painted here. Nothing on the
  // screen changes: the pack lives in #pg-pack, which print CSS alone shows.
  function packBlockMarkup(b) {
    if (b.live) {
      const head =
        b.type === 'taskList'
          ? '<tr><th>Task</th><th>Status</th><th>Due</th></tr>'
          : '<tr><th>Doc No.</th><th>Title</th><th>Status</th></tr>';
      const rows = b.rows.length
        ? b.rows
            .map(function (r) {
              return b.type === 'taskList'
                ? '<tr><td>' +
                    esc(r.name) +
                    '</td><td>' +
                    esc(ns.Pages.TASK_STATUS_LABEL[r.status] || r.status) +
                    '</td><td>' +
                    esc(r.endDate || '-') +
                    '</td></tr>'
                : '<tr><td>' +
                    esc(r.docNo || '-') +
                    '</td><td>' +
                    esc(r.title) +
                    '</td><td>' +
                    esc(r.status || '-') +
                    '</td></tr>';
            })
            .join('')
        : '<tr><td colspan="3" class="pk-mute">Nothing matches this filter.</td></tr>';
      return (
        '<div class="pk-live"><div class="pk-lt">' +
        esc(b.label) +
        '</div><table class="pk-t">' +
        head +
        rows +
        '</table></div>'
      );
    }
    if (b.type === 'divider') {
      return '<hr class="pk-hr">';
    }
    if (b.type === 'heading') {
      return b.text ? '<h3 class="pk-h3">' + esc(b.text) + '</h3>' : '';
    }
    if (b.type === 'bullet') {
      return b.text
        ? '<div class="pk-li"><span class="pk-dot" aria-hidden="true"></span>' +
            esc(b.text) +
            '</div>'
        : '';
    }
    if (b.type === 'checklist') {
      return (
        '<div class="pk-li pk-chk">' +
        (b.done
          ? '<svg class="ico pk-ck" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg>'
          : '<span class="pk-box" aria-hidden="true"></span>') +
        esc(b.text) +
        '</div>'
      );
    }
    if (b.type === 'callout') {
      return b.text ? '<div class="pk-call">' + esc(b.text) + '</div>' : '';
    }
    return b.text ? '<p class="pk-p">' + esc(b.text) + '</p>' : '';
  }

  function renderPack(pack) {
    const host = $('pg-pack');
    if (!host) {
      return false;
    }
    if (!pack) {
      host.innerHTML = '';
      return false;
    }
    const pages = pack.pages
      .map(function (p) {
        return (
          '<section class="pk-page" style="--pk-depth:' +
          p.depth +
          '"><h2 class="pk-h2">' +
          esc(p.title) +
          '</h2>' +
          p.blocks.map(packBlockMarkup).join('') +
          '</section>'
        );
      })
      .join('');
    const groups = pack.docs.length
      ? pack.docs
          .map(function (g) {
            return (
              '<div class="pk-group"><h3 class="pk-h3">' +
              esc(g.type) +
              '</h3><table class="pk-t"><tr><th>Doc No.</th><th>Title</th><th>Status</th></tr>' +
              g.rows
                .map(function (r) {
                  return (
                    '<tr><td>' +
                    esc(r.docNo || '-') +
                    '</td><td>' +
                    esc(r.title) +
                    '</td><td>' +
                    esc(r.status || '-') +
                    '</td></tr>'
                  );
                })
                .join('') +
              '</table></div>'
            );
          })
          .join('')
      : '<p class="pk-p pk-mute">No register rows are linked from this branch.</p>';
    host.innerHTML =
      '<div class="pk"><header class="pk-head">' +
      '<div class="pk-kicker">Handover pack</div>' +
      '<h1 class="pk-title">' +
      esc(pack.project) +
      '</h1>' +
      '<div class="pk-sub">' +
      esc(pack.rootTitle) +
      ' &middot; assembled ' +
      esc(pack.assembled) +
      '</div></header>' +
      '<div class="pk-body">' +
      pages +
      '</div>' +
      '<section class="pk-docs"><h2 class="pk-h2">Register documents</h2>' +
      groups +
      '</section>' +
      '<footer class="pk-foot">' +
      esc(pack.project) +
      ' &middot; assembled ' +
      esc(pack.assembled) +
      '</footer></div>';
    return true;
  }

  ns.RenderPages = { renderPages: renderPages, renderPack: renderPack };
})(MMGR);
window.MMGR = MMGR;
