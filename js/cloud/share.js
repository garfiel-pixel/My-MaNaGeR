/* ============================================================
   My MaNaGeR , Cloud Share UI
   Owner code, editor-code manager, scope display.
   Extracted from mmgr-cloud.js.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const C = ns.Cloud;
  const $ = function(id) { return document.getElementById(id); };
  function esc(v) { return C._esc(v); }

  function getPendingEditorCode() {
    try {
      const raw = localStorage.getItem('mmgr_cloud_pending_ecode_' + C._pid());
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function sectionLabel(key) {
    const sections = C._getSections();
    if (!sections) return key;
    for (let i = 0; i < sections.length; i++) {
      if (sections[i].key === key) return sections[i].label || key;
    }
    return key;
  }

  function pendingBannerHtml(pendingCode) {
    if (!pendingCode) return '';
    const isView = pendingCode.role === 'view';
    return '<div class="sr cloud-new-code" style="border:1px solid var(--gold);background:rgba(var(--gold-rgb),.1);border-radius:var(--radius);padding:8px 10px;margin:10px 0 4px" role="status">' +
      '<div class="sr-hint" style="margin:0 0 4px"><strong>NEW ' + (isView ? 'viewer' : 'editor') + ' code for \u201C' + esc(pendingCode.label || (isView ? 'viewer' : 'editor')) + '\u201D \u2014 copy it now, it is shown once:</strong></div>' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<code style="font-family:ui-monospace,monospace;letter-spacing:.05em;color:var(--gold);font-size:1rem;font-weight:700">' + esc(pendingCode.code) + '</code>' +
      '<button class="btn btn-g btn-s" data-action="cloudCopyEditorCode" data-code="' + esc(pendingCode.code) + '"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-clipboard"></use></svg> Copy code</button>' +
      '<button class="btn btn-n btn-s" data-action="cloudEditorCodeDone">Done</button>' +
      '</div></div>';
  }

  function renderShare() {
    const wrap = $('ctrl-share');
    if (!wrap) return;
    const code = C.getCode();
    const ecode = C.getECode();
    const escope = C.getEScope();
    const pendingCode = getPendingEditorCode();
    let body = '';
    if (!code && !ecode) {
      body =
        '<div class="share-card">' +
        '<div class="sr" style="border:none;padding:0 0 6px"><span class="sl" style="font-size:.8rem;font-weight:800">Link this project to the cloud to share it</span></div>' +
        '<div class="sr-hint" style="margin:0 0 10px">Sharing runs through the cloud backend: link the project once, get an <strong>owner code</strong>, then hand out <strong>editor codes</strong> that can only edit the sections you tick (view-only, budget-only, etc.). Codes work on any device \u2014 a colleague just opens this project and enters the code.</div>' +
        '<div class="exp-row"><button class="btn btn-g btn-s" data-action="cloudCreate"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-upload"></use></svg> Create Cloud Project</button></div>' +
        '<div class="sr-hint" style="margin:8px 0 0">Already have a code from someone? Open <strong>Cloud &amp; Sync \u2518 Cloud Backup</strong> and enter it under \u201cOn another device?\u201d.</div>' +
        '</div>';
    } else if (ecode && !code) {
      const isView = !!(escope && escope.role === 'view');
      const scopeTxt = escope && escope.sections && escope.sections.length
        ? escope.sections.map(sectionLabel).join(', ')
        : 'unknown';
      body =
        '<div class="share-card">' +
        '<div class="sr" style="border:none;padding:0 0 6px"><span class="sl" style="font-size:.8rem;font-weight:800">' + (isView ? 'You are a viewer' : 'You are an editor') + '</span></div>' +
        '<div class="sr-hint" style="margin:0">' + (isView
          ? 'Viewer code active: <code class="share-code">' + esc(escope && escope.label || 'viewer') + '</code>. You can see: <strong>' + esc(scopeTxt) + '</strong>. Read-only: nothing here can be edited. Ask the admin for an editor or owner code to change things.'
          : 'Editor code active: <code class="share-code">' + esc(escope && escope.label || 'editor') + '</code>. You can edit: <strong>' + esc(scopeTxt) + '</strong>. Codes can only touch what the owner granted; generating and revoking codes is owner-only.') + '</div>' +
        '</div>';
    } else {
      body =
        '<div class="share-card">' +
        '<div class="sr" style="border:none;padding:0 0 6px"><span class="sl" style="font-size:.8rem;font-weight:800"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-lock"></use></svg> Owner code</span><button class="btn btn-n btn-s" data-action="cloudCopyCode"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-clipboard"></use></svg> Copy code</button></div>' +
        '<div class="sr-hint" style="margin:0 0 8px">Anyone with this code opens the project as <strong>owner</strong> on any device. Keep it safe \u2014 if lost, only the linked Google account can recover it.</div>' +
        '<code class="share-code">' + esc(code) + '</code>' +
        pendingBannerHtml(pendingCode) +
        '<div class="sr" style="margin-top:12px;padding:0 0 4px"><span class="sl" style="font-size:.72rem;font-weight:700">Codes: edit or view only what you tick</span><button class="btn btn-n btn-s" data-action="cloudEditorList" style="margin-left:auto"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-refresh"></use></svg> List</button></div>' +
        '<div class="sr-hint" style="margin:0 0 6px">Give someone a code that can edit ONLY the sections you tick (e.g. Budget only), or a viewer code that can only SEE them (read-only, nothing touchable). Scope is enforced server-side on every save, so a shared or leaked code cannot touch anything else.</div>' +
        '<div class="exp-row" style="flex-wrap:wrap">' +
        '<input type="text" id="cloud-editor-label-in" class="ctl-in" placeholder="Label, e.g. Site Super \u2014 Riverside" style="min-width:200px" autocomplete="off">' +
        '<select id="cloud-editor-role" class="ctl-in" style="width:auto" aria-label="Code type">' +
        '<option value="editor">Editor \u2014 can edit the sections below</option>' +
        '<option value="view">Viewer \u2014 can see them, read-only</option>' +
        '</select>' +
        '<button class="btn btn-g btn-s" data-action="cloudEditorCreate"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-plus"></use></svg> Create Code</button>' +
        '</div>' +
        '<div id="cloud-editor-scope-box" class="share-scope">' +
        '<span class="sr-hint" style="margin:0">Sections this code may edit (or see, for a viewer):</span>' +
        '<span id="cloud-editor-scope-load" class="sr-hint" style="margin:0">loading\u2026</span>' +
        '</div>' +
        '<div id="cloud-editor-list"></div>' +
        '</div>';
    }
    wrap.innerHTML = body;
  }

  ns.CloudShare = {
    renderShare: renderShare,
    pendingBannerHtml: pendingBannerHtml,
    sectionLabel: sectionLabel
  };
})(MMGR);
window.MMGR = MMGR;
