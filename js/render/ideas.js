/* ============================================================
   My MaNaGeR, Idea intake board and list (Leantime-inspired)
   ------------------------------------------------------------
   Two projections of one array:
     - the board: six stage columns, draggable cards
     - the list: one table row per idea, stage editable in place

   Every rule lives in MMGR.Ideas. This file only draws and delegates:
   every mutating control carries data-action, so the delegation in
   js/mmgr-app.js owns the read-only fence and the save.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const U = ns.Utils;
  const $ = U.$;

  function S() {
    return ns.State.getState();
  }

  function ic(name) {
    return (
      '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-' +
      name +
      '"></use></svg>'
    );
  }

  function scoreClass(n) {
    if (n >= 6) {
      return ' idc-hi';
    }
    if (n <= 0) {
      return ' idc-lo';
    }
    return '';
  }

  function tagChips(idea) {
    return (idea.tags || [])
      .map(function (t) {
        return '<span class="idtag">' + U.escapeHtml(t) + '</span>';
      })
      .join('');
  }

  // A card is the draggable unit. tabindex + role make it a keyboard stop;
  // the aria-label carries the three facts a reader needs before opening it.
  function card(idea, stageLabel) {
    const id = U.escapeHtml(idea.id);
    const score = ns.Ideas.score(idea);
    const label = U.escapeHtml(idea.title) + ', ' + U.escapeHtml(stageLabel) + ', score ' + score;
    const linked = idea.promotedTaskId
      ? '<span class="idc-ln" title="Linked to a WBS task">' + ic('link') + ' Linked</span>'
      : '<button class="btn btn-o btn-s" data-action="promoteIdea" data-id="' +
        id +
        '" title="Create a WBS task from this idea">' +
        ic('arrow-right') +
        ' Promote</button>';
    return (
      '<article class="idc" draggable="true" data-idea-id="' +
      id +
      '" data-idea-drag="' +
      id +
      '" tabindex="0" role="article" aria-label="' +
      label +
      '">' +
      '<div class="idc-top">' +
      '<span class="idc-sc' +
      scoreClass(score) +
      '" title="Priority score: impact x2 minus effort">S' +
      score +
      '</span>' +
      '<span class="idc-act">' +
      '<button class="dc" data-action="editIdea" data-id="' +
      id +
      '" aria-label="Edit ' +
      U.escapeHtml(idea.title) +
      '">' +
      ic('edit') +
      '</button>' +
      '<button class="dc" data-action="delIdea" data-id="' +
      id +
      '" aria-label="Delete ' +
      U.escapeHtml(idea.title) +
      '">' +
      ic('trash') +
      '</button>' +
      '</span>' +
      '</div>' +
      '<div class="idc-t">' +
      U.escapeHtml(idea.title) +
      '</div>' +
      (idea.summary ? '<div class="idc-s">' + U.escapeHtml(idea.summary) + '</div>' : '') +
      '<div class="idc-meta">' +
      '<span class="idchip" title="Impact 1 to 5">I' +
      idea.impact +
      '</span>' +
      '<span class="idchip" title="Effort 1 to 5">E' +
      idea.effort +
      '</span>' +
      tagChips(idea) +
      '</div>' +
      '<div class="idc-foot">' +
      linked +
      '</div>' +
      '</article>'
    );
  }

  function row(idea) {
    const id = U.escapeHtml(idea.id);
    const score = ns.Ideas.score(idea);
    const options = ns.Ideas.STAGES.map(function (st) {
      return (
        '<option value="' +
        st.key +
        '"' +
        (st.key === idea.stage ? ' selected' : '') +
        '>' +
        U.escapeHtml(st.label) +
        '</option>'
      );
    }).join('');
    return (
      '<tr data-idea-id="' +
      id +
      '">' +
      '<td><span class="idt-t">' +
      U.escapeHtml(idea.title) +
      '</span>' +
      (idea.summary ? '<span class="ids">' + U.escapeHtml(idea.summary) + '</span>' : '') +
      '</td>' +
      '<td><select class="idc-sel" data-action="setIdeaStage" data-id="' +
      id +
      '" aria-label="Stage for ' +
      U.escapeHtml(idea.title) +
      '">' +
      options +
      '</select></td>' +
      '<td class="idnum">' +
      idea.impact +
      '</td>' +
      '<td class="idnum">' +
      idea.effort +
      '</td>' +
      '<td class="idnum"><span class="idc-sc' +
      scoreClass(score) +
      '">' +
      score +
      '</span></td>' +
      '<td>' +
      tagChips(idea) +
      '</td>' +
      '<td>' +
      (idea.promotedTaskId
        ? '<span class="idc-ln">' + ic('link') + ' Linked</span>'
        : '<button class="btn btn-o btn-s" data-action="promoteIdea" data-id="' +
          id +
          '">Promote</button>') +
      '</td>' +
      '<td class="idrow-act">' +
      '<button class="dc" data-action="editIdea" data-id="' +
      id +
      '" aria-label="Edit ' +
      U.escapeHtml(idea.title) +
      '">' +
      ic('edit') +
      '</button>' +
      '<button class="dc" data-action="delIdea" data-id="' +
      id +
      '" aria-label="Delete ' +
      U.escapeHtml(idea.title) +
      '">' +
      ic('trash') +
      '</button>' +
      '</td>' +
      '</tr>'
    );
  }

  function visible(state, group) {
    const tag = state.ideaTag || '';
    if (!tag) {
      return group.ideas;
    }
    const needle = tag.toLowerCase();
    return group.ideas.filter(function (idea) {
      return (idea.tags || []).some(function (t) {
        return String(t).toLowerCase() === needle;
      });
    });
  }

  function renderIdeas() {
    const s = S();
    const host = $('ideas-body');
    if (!s || !host) {
      return;
    }
    // One repair pass per draw: an imported row keeps its data but gains the
    // shape the columns need. Idempotent, so the steady state writes nothing.
    // A repair is a storage concern, so it writes through save(): updateState
    // would announce a project edit from inside a draw and wake the change
    // listeners (dirty badge, cloud auto-save) for a shape fix.
    if (ns.Ideas.repair(s) > 0 && ns.State && typeof ns.State.save === 'function') {
      ns.State.save();
    }

    const view = s.ideaView === 'list' ? 'list' : 'board';
    const stats = ns.Ideas.stats(s);
    const tag = s.ideaTag || '';
    const statsEl = $('ideas-stats');
    if (statsEl) {
      statsEl.textContent =
        stats.total === 0
          ? 'No ideas yet'
          : (tag ? 'Tag ' + tag + '. ' : '') +
            stats.open +
            ' open, ' +
            stats.counts.implemented +
            ' implemented, ' +
            stats.promoted +
            ' linked to tasks';
    }

    const board = $('ideas-board');
    const list = $('ideas-list');
    if (board) {
      board.classList.toggle('is-hide', view !== 'board');
    }
    if (list) {
      list.classList.toggle('is-hide', view !== 'list');
    }
    document.querySelectorAll('[data-action="setIdeaView"]').forEach(function (btn) {
      const on = btn.getAttribute('data-view') === view;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    // Rebuild the tag filter only when its option set or selection changes:
    // rewriting a focused select closes its popup mid-interaction.
    const tagSel = $('ideas-tag');
    if (tagSel) {
      const tags = ns.Ideas.tags(s);
      const current = s.ideaTag || '';
      const sig = current + '|' + tags.join('\u0001');
      if (tagSel.getAttribute('data-sig') !== sig) {
        const opts = ['<option value="">All tags</option>'].concat(
          tags.map(function (t) {
            const on = t.toLowerCase() === current.toLowerCase();
            return (
              '<option value="' +
              U.escapeHtml(t) +
              '"' +
              (on ? ' selected' : '') +
              '>' +
              U.escapeHtml(t) +
              '</option>'
            );
          })
        );
        tagSel.innerHTML = opts.join(''); // ok: option text/value are U.escapeHtml'd; the rest is static markup
        tagSel.setAttribute('data-sig', sig);
      }
    }

    const groups = ns.Ideas.byStage(s);
    if (board && view === 'board') {
      board.innerHTML = groups
        .map(function (group) {
          const shown = visible(s, group);
          const cards = shown.length
            ? shown
                .map(function (idea) {
                  return card(idea, group.label);
                })
                .join('')
            : '<div class="ides">Drop an idea here</div>';
          return (
            '<div class="idcol" data-idea-col="' +
            group.key +
            '">' +
            '<div class="idch"><span class="idct">' +
            U.escapeHtml(group.label) +
            '</span><span class="idcn">' +
            shown.length +
            '</span></div>' +
            '<div class="idcc" id="idc-' +
            group.key + // ok: group.key is a fixed STAGES constant, never user input
            '" data-idea-drop="' +
            group.key + // ok: group.key is a fixed STAGES constant, never user input
            '" title="' +
            U.escapeHtml(group.hint) +
            '">' +
            cards +
            '</div>' +
            '</div>'
          );
        })
        .join('');
    }

    if (list && view === 'list') {
      const body = groups
        .map(function (group) {
          return visible(s, group)
            .map(function (idea) {
              return row(idea);
            })
            .join('');
        })
        .join('');
      list.innerHTML =
        '<div class="ox"><table class="dt idtable"><thead><tr>' +
        '<th>Idea</th><th>Stage</th><th title="Impact 1 to 5">I</th>' +
        '<th title="Effort 1 to 5">E</th><th title="Impact x2 minus effort">Score</th>' +
        '<th>Tags</th><th>Linked</th><th></th>' +
        '</tr></thead><tbody>' +
        (body ||
          '<tr><td colspan="8"><div class="es">No ideas yet. Add one to start the intake.</div></td></tr>') +
        '</tbody></table></div>';
    }
  }

  ns.RenderIdeas = {
    renderIdeas: renderIdeas
  };
})(MMGR);
