/* ============================================================
 My MaNaGeR, Cloud Review Queue
 Owner review list, accept/reject, editor status.
 Extracted from mmgr-cloud.js.
 ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const C = ns.Cloud;
  const $ = function (id) {
    return document.getElementById(id);
  };
  function pid() {
    return C._pid();
  }
  function esc(v) {
    return C._esc(v);
  }
  function getCode() {
    return C.getCode();
  }
  function getECode() {
    return C.getECode();
  }
  function setStatus(msg, kind) {
    C._setStatus(msg, kind);
  }
  function fieldLabel(f) {
    return ns.Approval && ns.Approval.fieldLabel ? ns.Approval.fieldLabel(f) : String(f || '');
  }
  function pathLabel(p) {
    return ns.Approval && ns.Approval.pathLabel ? ns.Approval.pathLabel(p) : String(p || '');
  }
  function diffKey(d) {
    const rec = d.recordId || (d.index === null || d.index === undefined ? '' : '#' + d.index);
    return d.path + '|' + rec + '|' + d.field;
  }
  function valText(v, absent, absentWord) {
    if (absent) {
      return absentWord;
    }
    if (v === null || v === undefined || v === '') {
      return 'blank';
    }
    if (typeof v === 'object') {
      try {
        return JSON.stringify(v);
      } catch (e) {
        return String(v);
      }
    }
    return String(v);
  }
  // One group per record (or per scalar key): the owner asked to see WHICH
  // task changes, how many of its fields move, and which screens those fields
  // reach - not a flat list of "tasks[0].status".
  function groupDiffs(diffs) {
    const groups = [];
    const index = {};
    (Array.isArray(diffs) ? diffs : []).forEach(function (d) {
      const key = diffKey(d).split('|').slice(0, 2).join('|');
      let g = index[key];
      if (!g) {
        g = {
          key: key,
          path: d.path,
          recordId: d.recordId || '',
          recordName: d.recordName || '',
          index: d.index === undefined ? null : d.index,
          rows: [],
          surfaces: []
        };
        index[key] = g;
        groups.push(g);
      }
      if (!g.recordName && d.recordName) {
        g.recordName = d.recordName;
      }
      g.rows.push(d);
      (Array.isArray(d.surfaces) ? d.surfaces : []).forEach(function (s) {
        if (g.surfaces.indexOf(s) === -1) {
          g.surfaces.push(s);
        }
      });
    });
    return groups;
  }
  function groupTitle(g) {
    if (!g.recordId && (g.index === null || g.index === undefined)) {
      return pathLabel(g.path);
    }
    if (g.recordName) {
      return g.recordName;
    }
    if (g.recordId) {
      return g.recordId;
    }
    return 'Item ' + (g.index + 1);
  }
  function renderGroups(groups) {
    return groups
      .map(function (g) {
        const scalar = !g.recordId && (g.index === null || g.index === undefined);
        const rows = g.rows
          .map(function (d) {
            const label = d.field ? fieldLabel(d.field) : 'Value';
            return (
              '<div class="rv-row">' +
              '<span class="rv-f">' +
              esc(label) +
              '</span>' +
              '<span class="rv-b">' +
              esc(valText(d.before, d.beforeAbsent === true, 'not set')) +
              '</span>' +
              '<span class="rv-arrow" aria-hidden="true">&rarr;</span>' +
              '<span class="rv-a">' +
              esc(valText(d.after, d.afterAbsent === true, 'removed')) +
              '</span>' +
              '</div>'
            );
          })
          .join('');
        const surf = g.surfaces.length
          ? '<div class="rv-surf"><span class="rv-surf-k">Affects</span>' +
            g.surfaces
              .map(function (s) {
                return '<em>' + esc(s) + '</em>';
              })
              .join('') +
            '</div>'
          : '';
        return (
          '<div class="rv-g">' +
          '<div class="rv-g-head">' +
          (scalar
            ? '<span class="rv-name">' + esc(pathLabel(g.path)) + '</span>'
            : '<span class="rv-kind">' +
              esc(pathLabel(g.path)) +
              '</span><span class="rv-name">' +
              esc(groupTitle(g)) +
              '</span>') +
          '</div>' +
          '<div class="rv-rows">' +
          rows +
          '</div>' +
          surf +
          '</div>'
        );
      })
      .join('');
  }

  // OWNER FIX 2026-09-24 (session-owner review gate): owner identity is
  // either-auth (code OR session). A signed-in owner with no code held on the
  // device used to get "Owner code required." and never saw their own review
  // queue. The credential read is sync, so probe the session flag the module
  // already maintains (_sessOwner, set by render's probeOwnerSession).
  function hasOwnerAccess() {
    return !!getCode() || !!C._sessOwner;
  }
  function ownerHeaders() {
    const h = {};
    const code = getCode();
    if (code) {
      h['X-Owner-Code'] = code;
    } // session owner: headerless, cookie authenticates
    return h;
  }

  async function cloudReviewList() {
    const wrap = $('cloud-review-list');
    if (!wrap) {
      return;
    }
    if (!hasOwnerAccess()) {
      wrap.innerHTML = '<div class="sr-hint">Owner access required.</div>';
      return;
    }
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/reviews', {
        method: 'GET',
        credentials: 'same-origin',
        headers: ownerHeaders()
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        wrap.innerHTML = '<div class="sr-hint">Could not load proposals.</div>';
        return;
      }
      const props = data.proposals || [];
      if (!props.length) {
        wrap.innerHTML =
          '<div class="sr-hint">Nothing waiting for review - edits from editor codes and AI imports land here until you accept them.</div>';
        return;
      }
      wrap.innerHTML = props
        .map(function (p) {
          // E2E-PROBE FIX 2026-09-25: the MCP server inserts proposal_type='mcp'
          // with source_type='api' (src/mcp/server.js), so the old sourceType-only
          // check never matched - MCP proposals rendered as "MCP AI (editor)"
          // without the sparkle badge. Match the proposal type the server writes.
          const isMCP = p.proposalType === 'mcp' || p.sourceType === 'mcp';
          const src = isMCP
            ? '<span class="badge-ai"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-sparkle"></use></svg> MCP AI</span> ' +
              esc(p.sourceLabel || 'AI edit')
            : '<strong>' + esc(p.sourceLabel || 'Editor') + '</strong> (editor)';
          const when = String(p.proposedAt || '')
            .slice(0, 19)
            .replace('T', ' ');
          const badge =
            MMGR.Components && MMGR.Components.reviewBadge
              ? MMGR.Components.reviewBadge(p.status)
              : '<span class="badge" style="color:var(--amber);border:1px solid rgba(var(--amber-rgb),.35);background:rgba(var(--amber-rgb),.12)">' +
                (p.status || 'pending') +
                '</span>';
          let actions = '';
          if (p.status === 'pending') {
            // H-6 (BUDGET-BOQ directive 2026-11-05): View is the front door -
            // a full-width preview with the real panels, per-change ticks and
            // editable values. Accept/Reject stay for the plain one-press
            // path (and for older harnesses); the preview is where an edit
            // or a partial approval happens.
            actions =
              '<button class="btn btn-g btn-s" data-action="cloudReviewView" data-id="' +
              p.id +
              '"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-eye"></use></svg> View</button>' +
              '<button class="btn btn-n btn-s" data-action="cloudReviewAccept" data-id="' +
              p.id +
              '"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg> Accept</button>' +
              '<button class="btn btn-o btn-s" data-action="cloudReviewReject" data-id="' +
              p.id +
              '"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> Reject</button>';
          } else {
            const decided =
              (p.status === 'accepted' ? 'Accepted ' : 'Rejected ') +
              String(p.decidedAt || '')
                .slice(0, 19)
                .replace('T', ' ');
            actions =
              '<span class="sr-hint" style="margin:0">' +
              esc(decided) +
              (p.decidedBy ? ' by ' + esc(p.decidedBy) : '') +
              '</span>';
          }
          const diffs = Array.isArray(p.diffs) ? p.diffs : [];
          const nDiffs = diffs.length;
          const groups = groupDiffs(diffs);
          const nRecords = groups.length;
          // Long proposals start collapsed; the summary line still states the
          // full scope, so the owner knows what Accept will apply.
          const collapsed = nDiffs > 8;
          const diffsToggle = collapsed
            ? '<button type="button" class="cl-toggle rv-toggle" data-action="cloudReviewToggleDiffs" data-id="' +
              p.id +
              '" data-count="' +
              nDiffs +
              '" aria-expanded="false" aria-controls="rv-diffs-' +
              p.id +
              '" title="Show every field change">Show all ' +
              nDiffs +
              ' changes</button>'
            : '';
          const diffsPanel = nDiffs
            ? '<div class="rv-groups' +
              (collapsed ? ' is-hide' : '') +
              '" id="rv-diffs-' +
              p.id +
              '">' +
              renderGroups(groups) +
              '</div>'
            : '<div class="sr-hint">This proposal carries no field changes.</div>';
          const meta =
            nDiffs +
            ' field change' +
            (nDiffs === 1 ? '' : 's') +
            ' across ' +
            nRecords +
            ' record' +
            (nRecords === 1 ? '' : 's') +
            (p.diffTruncated ? ' (showing the first ' + nDiffs + ')' : '');
          return (
            '<div class="rv-card">' +
            '<div class="rv-head">' +
            '<span class="rv-src">' +
            src +
            '</span>' +
            badge +
            diffsToggle +
            '</div>' +
            '<div class="rv-meta">' +
            esc(meta) +
            ' &middot; proposed ' +
            esc(when) +
            '</div>' +
            diffsPanel +
            '<div class="rv-actions">' +
            actions +
            '</div>' +
            '</div>'
          );
        })
        .join('');
    } catch (e) {
      wrap.innerHTML = '<div class="sr-hint">Cloud unavailable here.</div>';
    }
  }

  async function cloudReviewMine() {
    const wrap = $('cloud-review-mine');
    if (!wrap) {
      return;
    }
    try {
      const res = await fetch(
        '/api/cloud/projects/' + encodeURIComponent(pid()) + '/reviews?mine=1',
        {
          method: 'GET',
          credentials: 'same-origin',
          headers: { 'X-Editor-Code': getECode() }
        }
      );
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        wrap.innerHTML = '';
        return;
      }
      const props = data.proposals || [];
      if (!props.length) {
        wrap.innerHTML =
          '<div class="sr-hint">Your edits wait for the admin\u2019s review before reaching the cloud - status appears here after you save.</div>';
        return;
      }
      const latest = props[0];
      const when = String(latest.proposedAt || '')
        .slice(0, 19)
        .replace('T', ' ');
      const statusTxt =
        latest.status === 'pending'
          ? 'pending the admin\u2019s review (proposed ' + when + ')'
          : latest.status === 'accepted'
            ? 'accepted on ' +
              String(latest.decidedAt || '')
                .slice(0, 19)
                .replace('T', ' ') +
              ' - it is now in the cloud project'
            : 'rejected on ' +
              String(latest.decidedAt || '')
                .slice(0, 19)
                .replace('T', ' ') +
              ' - it did not reach the project';
      wrap.innerHTML =
        '<div class="sr-hint" style="margin-top:6px">Your last change: <strong>' +
        esc(statusTxt) +
        '</strong>.</div>';
    } catch (e) {
      wrap.innerHTML = '';
    }
  }

  function reviewToggleDiffs(id) {
    const panel = $('rv-diffs-' + id);
    if (!panel) {
      return;
    }
    const show = panel.classList.contains('is-hide');
    panel.classList.toggle('is-hide');
    const btn = document.querySelector(
      '#cloud-review-list [data-action="cloudReviewToggleDiffs"][data-id="' +
        String(id).replace(/"/g, '&quot;') +
        '"]'
    );
    if (btn) {
      btn.classList.toggle('open', show);
      btn.setAttribute('aria-expanded', show ? 'true' : 'false');
      const n = btn.getAttribute('data-count') || '';
      btn.textContent = show ? 'Hide changes' : 'Show all ' + n + ' changes';
    }
  }

  // H-6: open the full-width approval preview. The preview module owns the
  // dialog; this is only the door from the review list.
  function cloudReviewView(id) {
    if (ns.Approval && ns.Approval.open) {
      ns.Approval.open(id);
    }
  }

  async function cloudReviewAccept(id) {
    if (!hasOwnerAccess() || !id) {
      setStatus('Owner access required.', 'warn');
      return;
    }
    if (
      !window.confirm(
        'Accept this change? It is applied to the cloud project now and logged in the changelog (and offline copies refresh).'
      )
    ) {
      return;
    }
    setStatus('Accepting\u2026', 'busy');
    try {
      const res = await fetch(
        '/api/cloud/projects/' +
          encodeURIComponent(pid()) +
          '/reviews/' +
          encodeURIComponent(id) +
          '/accept',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: Object.assign({ 'Content-Type': 'application/json' }, ownerHeaders()),
          body: JSON.stringify({})
        }
      );
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        // Prefer the server's sentence ("This proposal no longer matches the
        // project. Refresh the project and review it again.") over its error
        // code ("stale") - the code is not something an owner can act on.
        setStatus(
          (data && (data.message || data.error)) || 'Accept failed (HTTP ' + res.status + ').',
          'err'
        );
        return;
      }
      // FAILURE-SURFACE AUDIT 2026-09-25: the server answers ok:true with NO
      // savedAt when the merge applied zero diffs - the same values already
      // landed another way (an earlier accept, a parallel save, or an MCP
      // re-propose of an applied change). The old message claimed the change
      // "is now in the cloud project" for that case. Say what actually happened.
      if (!data.savedAt) {
        setStatus(
          'Accepted, but there was nothing left to apply - the cloud project already had these values (an earlier accept or save got there first). The proposal is closed.',
          'warn'
        );
        cloudReviewList();
        return;
      }
      // OWNER 2026-11-12: accepting must SHOW the change. Pull the cloud
      // snapshot into the open workspace (per-field merge, no reload) and say
      // how many updates landed.
      setStatus('Accepted - refreshing this project\u2026', 'busy');
      let pull = null;
      try {
        pull = C.cloudPullMerge ? await C.cloudPullMerge() : null;
      } catch (e) {
        pull = null;
      }
      setStatus(
        'Accepted - the change is now in the cloud project' +
          (pull && pull.ok && pull.adopted
            ? ' and ' +
              pull.adopted +
              ' update' +
              (pull.adopted === 1 ? '' : 's') +
              ' were pulled into this workspace'
            : '') +
          '.',
        'ok'
      );
      cloudReviewList();
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  async function cloudReviewReject(id) {
    if (!hasOwnerAccess() || !id) {
      setStatus('Owner access required.', 'warn');
      return;
    }
    if (
      !window.confirm(
        'Reject this change? It is discarded - the cloud project stays as it is, and the source device sees it was rejected.'
      )
    ) {
      return;
    }
    setStatus('Rejecting\u2026', 'busy');
    try {
      const res = await fetch(
        '/api/cloud/projects/' +
          encodeURIComponent(pid()) +
          '/reviews/' +
          encodeURIComponent(id) +
          '/reject',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: Object.assign({ 'Content-Type': 'application/json' }, ownerHeaders()),
          body: JSON.stringify({})
        }
      );
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        setStatus((data && data.error) || 'Reject failed (HTTP ' + res.status + ').', 'err');
        return;
      }
      setStatus('Rejected - the change was discarded. The cloud project is unchanged.', 'ok');
      cloudReviewList();
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  async function copyEditorCode(code) {
    if (!code) {
      setStatus('No code to copy.', 'warn');
      return;
    }
    let copied = false;
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
    } catch (e) {
      window.prompt('Editor code (select + copy):', code);
      copied = true;
    }
    C._render();
    setStatus(
      copied
        ? 'Editor code copied to the clipboard.'
        : 'Editor code shown - copy it from the prompt.',
      'ok'
    );
  }

  // OWNER 2026-09-15: the old Done button only re-rendered (the banner came
  // straight back - it did nothing). Confirm now: copies the code one last
  // time, clears the shown-once banner, refreshes the key/code lists, closes
  // the settings drawer, and says so. The code is saved in localStorage by
  // setPendingEditorCode until this point, so confirming is always safe.
  async function editorCodeDone() {
    var code = '';
    try {
      var pending =
        ns.CloudShare && ns.CloudShare.getPendingEditorCode
          ? ns.CloudShare.getPendingEditorCode()
          : null;
      if (pending && pending.code) {
        code = pending.code;
      }
    } catch (e) {
      /* banner already gone */
    }
    var copied = false;
    if (code && navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(code);
        copied = true;
      } catch (e) {
        copied = false;
      }
    }
    C.clearPendingEditorCode();
    C._render();
    try {
      if (ns.Cloud.listEditors) {
        ns.Cloud.listEditors();
      }
    } catch (e) {}
    try {
      if (ns.Cloud.listClientCodes) {
        ns.Cloud.listClientCodes();
      }
    } catch (e) {}
    try {
      if (ns.Cloud.listApiKeys) {
        ns.Cloud.listApiKeys();
      }
    } catch (e) {}
    try {
      if (ns.App && ns.App.closeDrw) {
        ns.App.closeDrw();
      }
    } catch (e) {}
    if (ns.App && ns.App.showToast) {
      ns.App.showToast(
        copied
          ? 'Code copied and saved. The banner is dismissed - the code stays valid until revoked or it expires.'
          : 'Saved. The banner is dismissed - the code stays valid until revoked or it expires.',
        'ok'
      );
    }
  }

  ns.CloudReview = {
    cloudReviewList: cloudReviewList,
    cloudReviewMine: cloudReviewMine,
    reviewToggleDiffs: reviewToggleDiffs,
    cloudReviewView: cloudReviewView,
    cloudReviewAccept: cloudReviewAccept,
    cloudReviewReject: cloudReviewReject,
    copyEditorCode: copyEditorCode,
    editorCodeDone: editorCodeDone
  };
})(MMGR);
window.MMGR = MMGR;
