/* ============================================================
   My MaNaGeR , Project Photos UI (B11, 5.7)
   ------------------------------------------------------------
   Renders the whole Project Photos panel into #photos-body on the project
   page's Photos section. Before this rewrite the module painted only a bare
   list, into a #sec-photos that does not exist, and never fetched anything
   on open: the panel was permanently empty and the server route it talks to
   had no caller.

   What the panel shows:
     - the account's storage bar (per-plan allowance, server-owned numbers)
     - an upload form: file, description, date taken, stage (before / after /
       in progress)
     - each photo with a real thumbnail, description, stage, size, date, the
       UPLOADER NAME AND ROLE, plus Download and Remove

   Auth: every request carries the credential header the cloud module already
   resolved (owner code, editor code, view code, client code), or the session
   cookie when there is no code. Blobs are fetched with those same headers
   because a <img src> cannot send them.

   The server (src/cloud/photos.js) is the real gate. This module mirrors the
   rule so the form is never offered to a role the server would refuse, and
   shows the server's own sentence when it refuses anyway (paid plan, quota).
   ============================================================ */
var MMGR = window.MMGR || {};
(function (ns) {
  'use strict';

  var C = ns.Cloud;
  if (!C) {
    return;
  } // page does not load the cloud module

  var $ = function (id) {
    return document.getElementById(id);
  };
  var esc =
    C._esc ||
    function (v) {
      return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    };

  var ICON =
    '<svg class="ico photo-placeholder-ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-image"></use></svg>';

  var _photos = null; // null = never loaded
  var _usage = null;
  var _role = '';
  var _canUpload = null; // null = not known until the first list response
  var _loading = false;
  var _uploading = false;
  var _confirmId = ''; // two-step remove: the photo awaiting confirmation
  var _note = { text: '', kind: '' };
  var _thumbs = {}; // photoId -> object URL (revoked when the photo goes)
  var _built = false;
  // I-12 bundle / multi-select state.
  var _roleCanUpload = false; // the role may add and remove
  var _upgradeRequired = false; // the role may upload, the plan may not
  var _upgradeMessage = '';
  var _upgradeOpen = false; // the upgrade card is showing
  var _selected = []; // File[] from the current picker
  var _previews = []; // object URLs for the preview strip
  var _progress = null; // { done, total, name, pct }
  var _bundleOpen = ''; // bundle id in the dialog
  var _bundleEdit = ''; // draft description in the dialog
  var _bundleConfirm = false; // two-step bundle delete
  var _queueCount = 0;
  var _flushing = false;

  function pid() {
    return C._pid ? C._pid() : 'default';
  }

  function apiUrl(suffix) {
    return '/api/cloud/projects/' + encodeURIComponent(pid()) + '/photos' + (suffix || '');
  }

  function credHeaders(json) {
    var cred = C._activeCredential ? C._activeCredential() : null;
    var headers = json ? { 'Content-Type': 'application/json' } : {};
    if (cred && cred.header && cred.code) {
      headers[cred.header] = cred.code;
    }
    return headers;
  }

  // ---- gates ---------------------------------------------------------------

  // A project can hold photos when the cloud module says it is cloud-linked,
  // by ANY route: stored id, owner session, or a held code. The old check also
  // required isSessionOwner, which hid the panel from every editor code user
  // even though the server lets editors upload.
  function isCloudProject() {
    if (!C._hasCloudLink) {
      return false;
    }
    return !!C._hasCloudLink();
  }

  // The ROLE decides whether the controls exist; the PLAN decides whether an
  // upload can actually land. Keeping them apart matters: a free owner must
  // still be able to remove a photo to free quota, while the Add button stays
  // visible and explains the upgrade instead of disappearing.
  function roleCanEdit() {
    if (_roleCanUpload) {
      return true;
    }
    if (_canUpload === false) {
      return false;
    }
    var cred = C._activeCredential ? C._activeCredential() : null;
    if (!cred) {
      return false;
    }
    if (cred.header === 'X-View-Code' || cred.header === 'X-Client-Code') {
      return false;
    }
    return true;
  }

  function canUpload() {
    return roleCanEdit() && !_upgradeRequired;
  }

  function uploadGateMessage() {
    if (!isCloudProject()) {
      return 'This project is not linked to the cloud, so it cannot hold photos. Link it from Cloud Backup first.';
    }
    var cred = C._activeCredential ? C._activeCredential() : null;
    if (!cred) {
      return 'Sign in, or open this project with a code, to use photos.';
    }
    if (cred.header === 'X-View-Code') {
      return 'Viewer codes are read-only: they can see photos but not add them.';
    }
    if (cred.header === 'X-Client-Code') {
      return 'Client codes are read-only: they can see photos but not add them.';
    }
    if (_upgradeRequired) {
      return (
        _upgradeMessage ||
        'Project photos are part of every paid plan. Upgrade to add photos to this project.'
      );
    }
    return 'Only the project owner or an editor can add photos.';
  }

  // ---- formatting ----------------------------------------------------------

  function humanSize(bytes) {
    if (bytes == null || isNaN(bytes)) {
      return '';
    }
    var n = Number(bytes);
    if (n < 1024) {
      return n + ' B';
    }
    if (n < 1024 * 1024) {
      return (n / 1024).toFixed(1) + ' KB';
    }
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function stageLabel(stage) {
    if (stage === 'before') {
      return 'Before';
    }
    if (stage === 'after') {
      return 'After';
    }
    if (stage === 'progress') {
      return 'In progress';
    }
    return '';
  }

  function dayOf(photo) {
    var raw = (photo && (photo.capturedAt || photo.createdAt)) || '';
    return raw ? String(raw).slice(0, 10) : '';
  }

  function photoUrlFor(photo) {
    if (!photo || !photo.id) {
      return '';
    }
    return apiUrl('/' + encodeURIComponent(photo.id));
  }

  // ---- data ----------------------------------------------------------------

  function errorSentence(raw, fallback) {
    if (raw === 'code_revoked' || raw === 'code_expired') {
      return 'This code was revoked, so photos are not available.';
    }
    if (raw === 'project_deleted') {
      return 'This project was deleted, so its photos are gone.';
    }
    if (raw === 'forbidden') {
      return 'You do not have access to this project\u2019s photos.';
    }
    return raw || fallback;
  }

  /* A status code is not a sentence. The owner's rule: a genuine failure says
     what happened in words and offers the next step, and an empty project is
     never dressed up as an error. */
  function loadFailureSentence(status) {
    if (status === 401 || status === 403) {
      return 'You do not have access to this project\u2019s photos.';
    }
    if (status === 404) {
      return 'This project is not on the server yet. Upload it from the launcher, then try again.';
    }
    if (status >= 500) {
      return 'The server could not answer just now. Nothing was lost, try again in a moment.';
    }
    return 'Photos could not be loaded. Check the connection and try again.';
  }

  async function fetchPhotos() {
    if (_loading) {
      return false;
    }
    if (!isCloudProject()) {
      _photos = [];
      _canUpload = false;
      paint();
      return false;
    }
    _loading = true;
    paint();
    try {
      var res = await fetch(apiUrl(''), {
        method: 'GET',
        credentials: 'same-origin',
        headers: credHeaders(false)
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data || !data.ok) {
        var msg = errorSentence(data && data.error, loadFailureSentence(res.status));
        _photos = [];
        _canUpload = false;
        _note = { text: msg, kind: 'warn', retry: true };
        if (C._setStatus) {
          C._setStatus(msg, 'err');
        }
        return false;
      }
      _photos = Array.isArray(data.photos) ? data.photos : [];
      _usage = data.usage || null;
      _role = data.role || '';
      _roleCanUpload = data.roleCanUpload === true || data.canUpload === true;
      _upgradeRequired = !!data.upgradeRequired;
      _upgradeMessage = data.upgradeMessage || '';
      _canUpload = data.canUpload !== false && !_upgradeRequired;
      queuedCount();
      if (!roleCanEdit()) {
        _note = { text: uploadGateMessage(), kind: '' };
      } else if (_upgradeRequired) {
        _note = { text: '', kind: '' };
      } else if (_note.text && _note.kind === 'warn') {
        _note = { text: '', kind: '' };
      }
      return true;
    } catch (e) {
      var detail = (e && (e.message || e.name || String(e))) || 'unknown';
      _photos = [];
      _canUpload = false;
      _note = {
        text: 'Cloud is unavailable on this host, so photos cannot load. [' + detail + ']',
        kind: 'warn'
      };
      return false;
    } finally {
      _loading = false;
      paint();
    }
  }

  // ---- paint ---------------------------------------------------------------

  function quotaText() {
    if (_loading && !_usage) {
      return 'Checking storage\u2026';
    }
    if (!_usage) {
      return '';
    }
    return humanSize(_usage.usedBytes) + ' of ' + humanSize(_usage.limitBytes) + ' used';
  }

  function quotaPercent() {
    if (!_usage || !_usage.limitBytes) {
      return 0;
    }
    var pct = (Number(_usage.usedBytes) / Number(_usage.limitBytes)) * 100;
    if (isNaN(pct) || pct < 0) {
      return 0;
    }
    return Math.min(100, Math.round(pct));
  }

  function scaffold() {
    var body = $('photos-body');
    if (!body || _built) {
      return body;
    }
    body.innerHTML =
      '<div class="photos-head">' +
      '<div class="photos-quota">' +
      '<div class="photos-quota-track" id="photos-quota-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Photo storage used">' +
      '<span class="photos-quota-fill" id="photos-quota-fill"></span>' +
      '</div>' +
      '<div class="photo-meta" id="photos-quota-text">Checking storage\u2026</div>' +
      '</div>' +
      '<button class="btn btn-g btn-s is-hide" id="photos-add-btn" type="button">Add photos</button>' +
      '</div>' +
      '<div class="photos-upgrade is-hide" id="photos-upgrade" role="note">' +
      '<p class="photos-upgrade-text" id="photos-upgrade-text"></p>' +
      '<a class="btn btn-g btn-s" href="pricing.html">See plans</a>' +
      '</div>' +
      '<form class="photos-form is-hide" id="photos-form" novalidate>' +
      '<input type="file" id="photos-upload-input" accept="image/*" multiple>' +
      '<div class="photos-form-actions">' +
      '<button class="btn btn-n btn-s" id="photos-pick-btn" type="button">Choose photos</button>' +
      '<span class="photo-meta" id="photos-file-name">No photos chosen</span>' +
      '</div>' +
      '<div class="photos-preview" id="photos-preview" aria-live="polite"></div>' +
      '<input class="in" type="text" id="photos-caption-input" maxlength="200" placeholder="Description for this set (what and where)" aria-label="Description for this set of photos">' +
      '<input class="in" type="date" id="photos-date-input" aria-label="Date taken">' +
      '<select class="in" id="photos-stage-input" aria-label="Stage">' +
      '<option value="">Stage (optional)</option>' +
      '<option value="before">Before</option>' +
      '<option value="after">After</option>' +
      '<option value="progress">In progress</option>' +
      '</select>' +
      '<div class="photos-progress is-hide" id="photos-progress">' +
      '<div class="photos-progress-track"><span class="photos-progress-fill" id="photos-progress-fill"></span></div>' +
      '<div class="photo-meta" id="photos-progress-text"></div>' +
      '</div>' +
      '<div class="photos-form-actions">' +
      '<button class="btn btn-g btn-s" id="photos-submit-btn" type="submit">Upload</button>' +
      '<button class="btn btn-n btn-s" id="photos-cancel-btn" type="button">Cancel</button>' +
      '</div>' +
      '</form>' +
      '<div class="txt-sl t-xs is-hide" id="photos-note" role="status"></div>' +
      '<div id="photos-list"></div>' +
      '<dialog class="photo-dialog" id="photos-bundle-dialog" aria-labelledby="photos-bundle-title">' +
      '<div class="photo-dialog-head">' +
      '<h3 id="photos-bundle-title">Photo bundle</h3>' +
      '<button class="btn btn-n btn-s" type="button" data-bundle-close="1">Close</button>' +
      '</div>' +
      '<p class="photo-meta" id="photos-bundle-caption"></p>' +
      '<div class="photo-dialog-edit is-hide" id="photos-bundle-edit">' +
      '<input class="in" type="text" id="photos-bundle-caption-input" maxlength="200" placeholder="Description for this bundle" aria-label="Bundle description">' +
      '<button class="btn btn-g btn-s" type="button" data-bundle-save="1">Save description</button>' +
      '</div>' +
      '<div class="photo-dialog-body" id="photos-bundle-body"></div>' +
      '<div class="photo-dialog-actions" id="photos-bundle-actions"></div>' +
      '</dialog>';
    bind();
    _built = true;
    return body;
  }

  function bind() {
    var note = $('photos-note');
    if (note) {
      note.addEventListener('click', function (e) {
        var t = e.target;
        if (t && t.closest && t.closest('[data-photo-retry]')) {
          e.preventDefault();
          fetchPhotos();
        }
      });
    }
    var addBtn = $('photos-add-btn');
    var form = $('photos-form');
    var pick = $('photos-pick-btn');
    var input = $('photos-upload-input');
    var cancel = $('photos-cancel-btn');
    var list = $('photos-list');

    var upgrade = $('photos-upgrade');
    var dialog = $('photos-bundle-dialog');

    function openComposer() {
      if (!roleCanEdit()) {
        return;
      }
      if (_upgradeRequired) {
        _upgradeOpen = true;
        if (upgrade) {
          var txt = $('photos-upgrade-text');
          if (txt) {
            txt.textContent = uploadGateMessage();
          }
          upgrade.classList.remove('is-hide');
        }
        if (form) {
          form.classList.add('is-hide');
        }
        return;
      }
      if (upgrade) {
        upgrade.classList.add('is-hide');
      }
      if (form) {
        form.classList.remove('is-hide');
      }
      if (input) {
        input.focus();
      }
    }

    if (addBtn) {
      addBtn.addEventListener('click', openComposer);
    }
    // File inputs cannot be styled, so the visible button opens the hidden one.
    if (pick && input) {
      pick.addEventListener('click', function () {
        input.click();
      });
      input.addEventListener('change', function () {
        setSelection(input.files);
      });
    }
    if (cancel && form) {
      cancel.addEventListener('click', function () {
        resetForm();
        _upgradeOpen = false;
        form.classList.add('is-hide');
        if (upgrade) {
          upgrade.classList.add('is-hide');
        }
        if (addBtn) {
          addBtn.classList.remove('is-hide');
          addBtn.focus();
        }
      });
    }
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        submitUpload();
      });
    }
    if (list) {
      list.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) {
          return;
        }
        var open = t.closest('[data-bundle-open]');
        if (open) {
          openBundle(open.getAttribute('data-bundle-open'));
          return;
        }
        var dl = t.closest('[data-photo-download]');
        if (dl) {
          downloadPhoto(dl.getAttribute('data-photo-download'));
          return;
        }
        var rm = t.closest('[data-photo-remove]');
        if (rm) {
          _confirmId = rm.getAttribute('data-photo-remove');
          paint();
          return;
        }
        var yes = t.closest('[data-photo-remove-confirm]');
        if (yes) {
          var id = yes.getAttribute('data-photo-remove-confirm');
          _confirmId = '';
          removePhoto(id);
          return;
        }
        var keep = t.closest('[data-photo-keep]');
        if (keep) {
          _confirmId = '';
          paint();
        }
      });
    }
    if (dialog) {
      dialog.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) {
          return;
        }
        if (t.closest('[data-bundle-close]')) {
          closeBundle();
          return;
        }
        if (t.closest('[data-bundle-save]')) {
          saveBundleCaption();
          return;
        }
        if (t.closest('[data-bundle-delete]')) {
          _bundleConfirm = true;
          renderBundleDialog();
          return;
        }
        if (t.closest('[data-bundle-delete-confirm]')) {
          removeBundle(_bundleOpen);
          return;
        }
        if (t.closest('[data-bundle-delete-cancel]')) {
          _bundleConfirm = false;
          renderBundleDialog();
          return;
        }
        var dl = t.closest('[data-photo-download]');
        if (dl) {
          downloadPhoto(dl.getAttribute('data-photo-download'));
          return;
        }
        var rm = t.closest('[data-photo-remove]');
        if (rm) {
          var photoId = rm.getAttribute('data-photo-remove');
          removePhoto(photoId).then(function (r) {
            if (r && r.ok && _bundleOpen) {
              refreshBundleDialog(_bundleOpen);
            }
          });
        }
      });
    }
    window.addEventListener('online', function () {
      flushQueue();
    });
  }

  function clearPreviews() {
    for (var i = 0; i < _previews.length; i++) {
      if (_previews[i]) {
        try {
          URL.revokeObjectURL(_previews[i]);
        } catch (e) {
          /* ignore */
        }
      }
    }
    _previews = [];
  }

  function renderPreview() {
    var box = $('photos-preview');
    if (!box) {
      return;
    }
    var html = '';
    for (var i = 0; i < _previews.length; i++) {
      html +=
        '<span class="photos-preview-item">' +
        (_previews[i] ? '<img src="' + esc(_previews[i]) + '" alt="" loading="lazy">' : '') +
        '</span>';
    }
    box.innerHTML = html;
    box.classList.toggle('is-hide', !_previews.length);
  }

  function setSelection(fileList) {
    clearPreviews();
    _selected = [];
    var files = fileList ? Array.prototype.slice.call(fileList) : [];
    for (var i = 0; i < files.length; i++) {
      _selected.push(files[i]);
      try {
        _previews.push(URL.createObjectURL(files[i]));
      } catch (e) {
        _previews.push('');
      }
    }
    var name = $('photos-file-name');
    if (name) {
      if (!files.length) {
        name.textContent = 'No photos chosen';
      } else if (files.length === 1) {
        name.textContent = files[0].name + ' (' + humanSize(files[0].size) + ')';
      } else {
        name.textContent = files.length + ' photos selected';
      }
    }
    renderPreview();
  }

  function resetForm() {
    var input = $('photos-upload-input');
    var cap = $('photos-caption-input');
    var date = $('photos-date-input');
    var stage = $('photos-stage-input');
    var name = $('photos-file-name');
    if (input) {
      input.value = '';
    }
    if (cap) {
      cap.value = '';
    }
    if (date) {
      date.value = '';
    }
    if (stage) {
      stage.value = '';
    }
    if (name) {
      name.textContent = 'No photos chosen';
    }
    clearPreviews();
    _selected = [];
    _progress = null;
    var preview = $('photos-preview');
    if (preview) {
      preview.innerHTML = '';
      preview.classList.add('is-hide');
    }
    var progress = $('photos-progress');
    if (progress) {
      progress.classList.add('is-hide');
    }
  }

  function noteHtml() {
    if (!_note.text) {
      return '';
    }
    var out = esc(_note.text);
    if (_note.retry) {
      out +=
        ' <button class="btn btn-n btn-s" type="button" data-photo-retry="1">Try again</button>';
    }
    return out;
  }

  function cardHtml(p) {
    var caption = p.caption || p.filename || 'Untitled photo';
    var stage = stageLabel(p.stage);
    var who = p.uploadedBy || '';
    var role = p.uploadedRole || '';
    var meta = [];
    if (stage) {
      meta.push('<span class="photo-stage">' + esc(stage) + '</span>');
    }
    if (p.sizeBytes != null) {
      meta.push(esc(humanSize(p.sizeBytes)));
    }
    if (dayOf(p)) {
      meta.push(esc(dayOf(p)));
    }
    var by = who ? esc(who) + (role ? ' (' + esc(role) + ')' : '') : '';
    var actions =
      _confirmId === p.id
        ? '<span class="photo-confirm">Remove this photo?</span>' +
          '<button class="btn btn-n btn-s" type="button" data-photo-remove-confirm="' +
          esc(p.id) +
          '">Yes, remove</button>' +
          '<button class="btn btn-n btn-s" type="button" data-photo-keep="' +
          esc(p.id) +
          '">Keep</button>'
        : '<button class="btn btn-n btn-s" type="button" data-photo-download="' +
          esc(p.id) +
          '">Download</button>' +
          (roleCanEdit()
            ? '<button class="btn btn-n btn-s" type="button" data-photo-remove="' +
              esc(p.id) +
              '">Remove</button>'
            : '');
    return (
      '<figure class="photo-item" data-photo="' +
      esc(p.id) +
      '">' +
      '<div class="photo-thumb-link"><div class="photo-thumb" data-photo-thumb="' +
      esc(p.id) +
      '">' +
      ICON +
      '</div></div>' +
      '<figcaption class="photo-info">' +
      '<div class="photo-caption">' +
      esc(caption) +
      '</div>' +
      (meta.length ? '<div class="photo-meta">' + meta.join(' \u00b7 ') + '</div>' : '') +
      (by ? '<div class="photo-meta">Uploaded by ' + by + '</div>' : '') +
      '<div class="photo-actions">' +
      actions +
      '</div>' +
      '</figcaption>' +
      '</figure>'
    );
  }

  // Photos that share a bundleId are one card. A bundle keeps its own
  // description on every row, so the card survives a single-photo delete.
  function groupsOf(photos) {
    var groups = [];
    var by = {};
    for (var i = 0; i < photos.length; i++) {
      var p = photos[i];
      var key = p.bundleId || '';
      if (!key) {
        groups.push({ type: 'photo', key: '', photos: [p] });
        continue;
      }
      if (!by[key]) {
        by[key] = { type: 'bundle', key: key, photos: [] };
        groups.push(by[key]);
      }
      by[key].photos.push(p);
    }
    return groups;
  }

  function bundleCardHtml(b) {
    var n = b.photos.length;
    var first = b.photos[0];
    var caption = first.bundleCaption || first.caption || 'Photo bundle';
    var layers = '';
    var shown = Math.min(3, n);
    for (var i = 0; i < shown; i++) {
      layers +=
        '<span class="photo-bundle-layer l' +
        (i + 1) +
        '" data-photo-thumb="' +
        esc(b.photos[i].id) +
        '">' +
        ICON +
        '</span>';
    }
    var meta = [n + (n === 1 ? ' photo' : ' photos')];
    var stage = stageLabel(first.stage);
    if (stage) {
      meta.push('<span class="photo-stage">' + esc(stage) + '</span>');
    }
    if (dayOf(first)) {
      meta.push(esc(dayOf(first)));
    }
    var who = first.uploadedBy || '';
    var role = first.uploadedRole || '';
    var by = who ? esc(who) + (role ? ' (' + esc(role) + ')' : '') : '';
    return (
      '<figure class="photo-item photo-bundle" data-photo-bundle="' +
      esc(b.key) +
      '">' +
      '<button class="photo-bundle-open" type="button" data-bundle-open="' +
      esc(b.key) +
      '" aria-label="Open bundle of ' +
      n +
      ' photos">' +
      '<span class="photo-bundle-stack">' +
      layers +
      '<span class="photo-bundle-count">' +
      n +
      '</span>' +
      '</span>' +
      '</button>' +
      '<figcaption class="photo-info">' +
      '<div class="photo-caption">' +
      esc(caption) +
      '</div>' +
      '<div class="photo-meta">' +
      meta.join(' \u00b7 ') +
      '</div>' +
      (by ? '<div class="photo-meta">Uploaded by ' + by + '</div>' : '') +
      '<div class="photo-actions">' +
      '<button class="btn btn-n btn-s" type="button" data-bundle-open="' +
      esc(b.key) +
      '">Open bundle</button>' +
      '</div>' +
      '</figcaption>' +
      '</figure>'
    );
  }

  function listHtml() {
    if (_loading && _photos === null) {
      return '<div class="photo-empty">Loading photos\u2026</div>';
    }
    if (!_photos || !_photos.length) {
      if (!isCloudProject()) {
        return '<div class="photo-empty">' + esc(uploadGateMessage()) + '</div>';
      }
      return '<div class="photo-empty">No photos yet. Add before and after shots so the record shows how the work changed.</div>';
    }
    var groups = groupsOf(_photos);
    var html = '';
    for (var g = 0; g < groups.length; g++) {
      html +=
        groups[g].type === 'bundle' ? bundleCardHtml(groups[g]) : cardHtml(groups[g].photos[0]);
    }
    return html;
  }

  function paint() {
    var body = scaffold();
    if (!body) {
      return;
    }
    var addBtn = $('photos-add-btn');
    var canEdit = roleCanEdit() && isCloudProject();
    if (addBtn) {
      addBtn.classList.toggle('is-hide', !canEdit);
      addBtn.textContent = _queueCount ? 'Add photos (' + _queueCount + ' waiting)' : 'Add photos';
    }
    var form = $('photos-form');
    if (form && (!canEdit || _upgradeRequired)) {
      form.classList.add('is-hide');
    }
    var upgrade = $('photos-upgrade');
    if (upgrade) {
      upgrade.classList.toggle('is-hide', !(_upgradeRequired && _upgradeOpen));
      var upgradeText = $('photos-upgrade-text');
      if (upgradeText && _upgradeRequired) {
        upgradeText.textContent = uploadGateMessage();
      }
    }
    var bar = $('photos-quota-bar');
    var fill = $('photos-quota-fill');
    var text = $('photos-quota-text');
    var pct = quotaPercent();
    if (bar) {
      bar.setAttribute('aria-valuenow', String(pct));
    }
    if (fill) {
      fill.style.width = pct + '%';
    }
    if (text) {
      text.textContent = quotaText();
    }
    var note = $('photos-note');
    if (note) {
      var noteText = _note.text;
      var noteKind = _note.kind;
      if (!noteText && _queueCount) {
        noteText =
          _queueCount +
          ' photo' +
          (_queueCount === 1 ? '' : 's') +
          ' saved on this device, waiting to upload.';
        noteKind = '';
      }
      var noteOut = noteText ? esc(noteText) : '';
      if (noteOut && _note.retry) {
        noteOut +=
          ' <button class="btn btn-n btn-s" type="button" data-photo-retry="1">Try again</button>';
      }
      note.innerHTML = noteOut;
      note.classList.toggle('is-hide', !noteOut);
      note.classList.toggle('note-warn', noteKind === 'warn');
    }
    var list = $('photos-list');
    if (list) {
      list.innerHTML = listHtml();
      for (var i = 0; i < (_photos || []).length; i++) {
        loadThumb(_photos[i]);
      }
    }
    paintProgress();
    var submit = $('photos-submit-btn');
    if (submit) {
      submit.disabled = !!_uploading;
      submit.textContent = _uploading ? 'Uploading\u2026' : 'Upload';
    }
  }

  // Progress repaints only the bar, never the list: XHR fires this many times
  // per photo, and re-rendering every card on each tick would fight the
  // thumbnails and the scroll position.
  function paintProgress() {
    var progress = $('photos-progress');
    if (!progress) {
      return;
    }
    var showProgress = !!(_progress && _progress.total);
    progress.classList.toggle('is-hide', !showProgress);
    if (!showProgress) {
      return;
    }
    var done = Number(_progress.done) || 0;
    var fraction = Number(_progress.pct) || 0;
    var pctDone = Math.round(((done + fraction) / _progress.total) * 100);
    var progressFill = $('photos-progress-fill');
    if (progressFill) {
      progressFill.style.width = Math.min(100, Math.max(0, pctDone)) + '%';
    }
    var progressText = $('photos-progress-text');
    if (progressText) {
      progressText.textContent =
        'Uploading ' +
        Math.min(done + 1, _progress.total) +
        ' of ' +
        _progress.total +
        (_progress.name ? ' \u00b7 ' + _progress.name : '');
    }
  }

  // Thumbnails need the credential header, so each one is fetched as a blob
  // and shown through an object URL. Cached per photo id for the session and
  // revoked when the photo is removed.
  // A blob: URL from URL.createObjectURL is browser-generated, not user text,
  // but it still goes through the DOM API rather than innerHTML so the
  // no-unsanitized-html gate keeps its meaning for real markup.
  function showThumb(slot, src) {
    var img = document.createElement('img');
    img.className = 'photo-img';
    img.alt = '';
    img.src = src;
    slot.innerHTML = '';
    slot.appendChild(img);
  }

  function fillThumbs(id, src) {
    var slots = document.querySelectorAll('[data-photo-thumb="' + id + '"]');
    for (var i = 0; i < slots.length; i++) {
      showThumb(slots[i], src);
    }
  }

  function loadThumb(photo) {
    var slots = document.querySelectorAll('[data-photo-thumb="' + photo.id + '"]');
    if (!slots.length) {
      return;
    }
    if (_thumbs[photo.id]) {
      fillThumbs(photo.id, _thumbs[photo.id]);
      return;
    }
    var url = photoUrlFor(photo);
    if (!url) {
      return;
    }
    fetch(url, { method: 'GET', credentials: 'same-origin', headers: credHeaders(false) })
      .then(function (res) {
        if (!res.ok) {
          throw new Error('HTTP ' + res.status);
        }
        return res.blob();
      })
      .then(function (blob) {
        var obj = URL.createObjectURL(blob);
        _thumbs[photo.id] = obj;
        fillThumbs(photo.id, obj);
      })
      .catch(function () {
        /* the sprite placeholder stays, which is the honest state */
      });
  }

  function forgetThumb(id) {
    if (_thumbs[id]) {
      try {
        URL.revokeObjectURL(_thumbs[id]);
      } catch (e) {
        /* ignore */
      }
      delete _thumbs[id];
    }
  }

  // ---- device compression, progress and the offline queue (I-12) ---------

  function newBundleId() {
    try {
      if (window.crypto && crypto.randomUUID) {
        return crypto.randomUUID().replace(/-/g, '').slice(0, 32);
      }
    } catch (e) {
      /* fall through */
    }
    return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); // ok: non-secret
  }

  function blobToFile(blob, name, type) {
    try {
      return new File([blob], name, { type: type });
    } catch (e) {
      blob.name = name;
      return blob;
    }
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      try {
        canvas.toBlob(
          function (b) {
            resolve(b);
          },
          type,
          quality
        );
      } catch (e) {
        resolve(null);
      }
    });
  }

  // Long edge about 1600 px, WebP where the browser can encode it, JPEG
  // otherwise. A small file and an animated GIF are left alone: re-encoding
  // either costs quality or kills the animation for no useful saving.
  async function compressPhoto(file) {
    if (!file || !/^image\//.test(file.type || '')) {
      return file;
    }
    if (file.type === 'image/gif') {
      return file;
    }
    if (file.size <= 350 * 1024) {
      return file;
    }
    if (!window.createImageBitmap || !document.createElement('canvas').getContext) {
      return file;
    }
    try {
      var bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      var max = 1600;
      var scale = Math.min(1, max / Math.max(bmp.width || 1, bmp.height || 1));
      var w = Math.max(1, Math.round((bmp.width || 1) * scale));
      var h = Math.max(1, Math.round((bmp.height || 1) * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
      if (bmp.close) {
        bmp.close();
      }
      var blob = await canvasBlob(canvas, 'image/webp', 0.82);
      var type = 'image/webp';
      if (!blob) {
        blob = await canvasBlob(canvas, 'image/jpeg', 0.85);
        type = 'image/jpeg';
      }
      if (!blob) {
        return file;
      }
      var base = String(file.name || 'photo').replace(/\.[^.]+$/, '');
      return blobToFile(blob, base + (type === 'image/webp' ? '.webp' : '.jpg'), type);
    } catch (e) {
      return file;
    }
  }

  // XHR, not fetch, because only XHR reports upload progress per photo.
  function uploadOne(file, meta, onProgress) {
    return new Promise(function (resolve, reject) {
      var form = new FormData();
      form.append('file', file);
      if (meta.caption) {
        form.append('caption', meta.caption);
      }
      if (meta.bundleId) {
        form.append('bundleId', meta.bundleId);
      }
      if (meta.bundleCaption) {
        form.append('bundleCaption', meta.bundleCaption);
      }
      if (meta.capturedAt) {
        form.append('capturedAt', meta.capturedAt);
      }
      if (meta.stage) {
        form.append('stage', meta.stage);
      }
      var xhr = new XMLHttpRequest();
      xhr.open('POST', apiUrl(''), true);
      xhr.withCredentials = true;
      var cred = C._activeCredential ? C._activeCredential() : null;
      if (cred && cred.header && cred.code) {
        xhr.setRequestHeader(cred.header, cred.code);
      }
      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = function (ev) {
          if (ev.lengthComputable) {
            onProgress(ev.loaded / ev.total);
          }
        };
      }
      xhr.onload = function () {
        var data = {};
        try {
          data = JSON.parse(xhr.responseText || '{}');
        } catch (e) {
          /* an empty or non-JSON refusal still has a status */
        }
        resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data: data });
      };
      xhr.onerror = function () {
        reject(new Error('network'));
      };
      xhr.onabort = function () {
        reject(new Error('aborted'));
      };
      xhr.send(form);
    });
  }

  // IndexedDB, not localStorage: a phone photo is far past the 5 MB string
  // limit. The record keeps the credential the upload was made with so a
  // queued photo can still authenticate after a reload.
  var QDB = 'mmgr-photo-queue';
  function qOpen() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('no-indexeddb'));
        return;
      }
      var req = indexedDB.open(QDB, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('queue')) {
          db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }
  function qAdd(record) {
    return qOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('queue', 'readwrite');
        tx.objectStore('queue').add(record);
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }
  function qAll() {
    return qOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('queue', 'readonly');
        var req = tx.objectStore('queue').getAll();
        req.onsuccess = function () {
          resolve(req.result || []);
        };
        req.onerror = function () {
          reject(req.error);
        };
      });
    });
  }
  function qDelete(id) {
    return qOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('queue', 'readwrite');
        tx.objectStore('queue').delete(id);
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  async function queueFiles(files, meta) {
    var cred = C._activeCredential ? C._activeCredential() : null;
    for (var i = 0; i < files.length; i++) {
      await qAdd({
        projectId: pid(),
        file: files[i],
        name: files[i].name || 'photo',
        bundleId: meta.bundleId || '',
        bundleCaption: meta.bundleCaption || '',
        caption: meta.caption || '',
        capturedAt: meta.capturedAt || '',
        stage: meta.stage || '',
        header: cred && cred.header ? cred.header : '',
        code: cred && cred.code ? cred.code : '',
        createdAt: new Date().toISOString()
      });
    }
  }

  async function queuedCount() {
    try {
      var all = await qAll();
      var n = 0;
      for (var i = 0; i < all.length; i++) {
        if (all[i].projectId === pid()) {
          n++;
        }
      }
      _queueCount = n;
    } catch (e) {
      _queueCount = 0;
    }
    return _queueCount;
  }

  async function flushQueue() {
    if (_flushing || !navigator.onLine || !window.indexedDB) {
      return;
    }
    _flushing = true;
    try {
      var all = await qAll();
      var mine = all.filter(function (r) {
        return r.projectId === pid();
      });
      if (!mine.length) {
        _queueCount = 0;
        return;
      }
      for (var i = 0; i < mine.length; i++) {
        var item = mine[i];
        try {
          var r = await uploadOne(item.file, item, null);
          if (r.ok) {
            await qDelete(item.id);
            _queueCount = Math.max(0, _queueCount - 1);
          } else if (r.status === 402 || r.status === 403 || r.status === 413) {
            // A refusal that will not change by waiting: drop it and say why.
            await qDelete(item.id);
            _queueCount = Math.max(0, _queueCount - 1);
            _note = {
              text: errorSentence(r.data && r.data.error, 'A queued photo was refused.'),
              kind: 'warn'
            };
            if (r.status === 402) {
              _upgradeRequired = true;
              _upgradeMessage = (r.data && r.data.error) || '';
            }
          } else {
            break; // server or network trouble: keep the rest for the next try
          }
        } catch (e) {
          break;
        }
      }
      if (_queueCount === 0 && !_note.text) {
        _note = { text: 'Queued photos uploaded.', kind: '' };
      }
      paint();
      if (_photos !== null) {
        await fetchPhotos();
      }
    } finally {
      _flushing = false;
    }
  }

  // ---- actions -------------------------------------------------------------

  async function submitUpload() {
    var input = $('photos-upload-input');
    var files = _selected.length
      ? _selected.slice()
      : input && input.files
        ? Array.prototype.slice.call(input.files)
        : [];
    if (!files.length) {
      _note = { text: 'Choose at least one photo first.', kind: 'warn' };
      paint();
      return { ok: false, error: 'No photo selected.' };
    }
    if (files.length > 30) {
      _note = { text: 'Choose up to 30 photos in one bundle.', kind: 'warn' };
      paint();
      return { ok: false, error: 'too many photos' };
    }
    var cap = $('photos-caption-input');
    var date = $('photos-date-input');
    var stage = $('photos-stage-input');
    var caption = cap ? String(cap.value || '').slice(0, 200) : '';
    var capturedAt = date ? String(date.value || '') : '';
    var stageValue = stage ? String(stage.value || '') : '';
    // One file stays an individual photo (the old behaviour); two or more
    // become one bundle with one description.
    var bundleId = files.length > 1 ? newBundleId() : '';
    var bundleCaption = files.length > 1 ? caption : '';
    var meta = {
      caption: files.length > 1 ? '' : caption,
      bundleId: bundleId,
      bundleCaption: bundleCaption,
      capturedAt: capturedAt,
      stage: stageValue
    };

    _uploading = true;
    _note = { text: '', kind: '' };
    _progress = { done: 0, total: files.length, name: '', pct: 0 };
    paint();

    // No connection: park the selection in IndexedDB and say so plainly.
    if (!navigator.onLine) {
      try {
        await queueFiles(files, meta);
        _queueCount += files.length;
        _note = {
          text:
            files.length +
            ' photo' +
            (files.length === 1 ? '' : 's') +
            ' saved on this device. They will upload when you are back online.',
          kind: ''
        };
        resetForm();
        var offlineForm = $('photos-form');
        if (offlineForm) {
          offlineForm.classList.add('is-hide');
        }
        _uploading = false;
        _progress = null;
        paint();
        return { ok: true, queued: true, total: files.length };
      } catch (e) {
        _uploading = false;
        _progress = null;
        _note = { text: 'This device could not save the photos for later.', kind: 'warn' };
        paint();
        return { ok: false, error: 'queue unavailable' };
      }
    }

    var uploaded = 0;
    for (var i = 0; i < files.length; i++) {
      var original = files[i];
      _progress.done = i;
      _progress.name = original.name || '';
      _progress.pct = 0;
      paintProgress();
      var file = await compressPhoto(original);
      if (file.size > 8 * 1024 * 1024) {
        _note = {
          text: 'This photo is still larger than 8 MB after resizing. Try a smaller one.',
          kind: 'warn'
        };
        break;
      }
      var r;
      try {
        r = await uploadOne(file, meta, function (p) {
          _progress.pct = p;
          paintProgress();
        });
      } catch (e) {
        // A network failure is what the queue is for: keep this photo and
        // every one after it, and send them when the connection returns.
        var rest = files.slice(i);
        try {
          await queueFiles(rest, meta);
          _queueCount += rest.length;
          _note = {
            text:
              rest.length +
              ' photo' +
              (rest.length === 1 ? '' : 's') +
              ' saved on this device. They will upload when you are back online.',
            kind: ''
          };
        } catch (qe) {
          _note = {
            text: 'The upload failed and could not be saved on this device.',
            kind: 'warn'
          };
        }
        break;
      }
      if (!r.ok) {
        // The server owns the refusal sentence (paid plan, quota, role), and
        // it is shown verbatim: rewriting it here is how upgrade copy drifts.
        var msg = errorSentence(r.data && r.data.error, 'Upload failed (HTTP ' + r.status + ').');
        _note = { text: msg, kind: 'warn' };
        if (r.status === 402) {
          _upgradeRequired = true;
          _upgradeMessage = (r.data && r.data.error) || '';
          _upgradeOpen = true;
        }
        break;
      }
      uploaded++;
    }

    _uploading = false;
    _progress = null;
    if (uploaded) {
      resetForm();
      var form = $('photos-form');
      if (form) {
        form.classList.add('is-hide');
      }
      _note = {
        text:
          files.length > 1 ? uploaded + ' of ' + files.length + ' photos added.' : 'Photo added.',
        kind: ''
      };
      await fetchPhotos();
      return { ok: uploaded === files.length, uploaded: uploaded, total: files.length };
    }
    paint();
    return { ok: false, error: _note.text };
  }

  async function removePhoto(photoId) {
    if (!photoId) {
      return { ok: false, error: 'No photo selected.' };
    }
    try {
      var res = await fetch(apiUrl('/' + encodeURIComponent(photoId) + '/delete'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: credHeaders(true)
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data || !data.ok) {
        var msg = errorSentence(
          data && data.error,
          'The photo was not removed (HTTP ' + res.status + ').'
        );
        _note = { text: msg, kind: 'warn' };
        paint();
        return { ok: false, error: msg };
      }
      forgetThumb(photoId);
      if (_usage && data.photo && data.photo.sizeBytes) {
        _usage.usedBytes = Math.max(0, Number(_usage.usedBytes) - Number(data.photo.sizeBytes));
      }
      _note = { text: 'Photo removed.', kind: '' };
      await fetchPhotos();
      return { ok: true, deleted: photoId };
    } catch (e) {
      var detail = (e && (e.message || e.name || String(e))) || 'unknown';
      var errMsg =
        'Cloud is unavailable on this host, so the photo was not removed. [' + detail + ']';
      _note = { text: errMsg, kind: 'warn' };
      paint();
      return { ok: false, error: errMsg };
    }
  }

  // Download goes through fetch + blob so the credential header rides along
  // (a plain link cannot send it) and the filename is the server's.
  async function downloadPhoto(photoId) {
    var photo = null;
    for (var i = 0; i < (_photos || []).length; i++) {
      if (_photos[i].id === photoId) {
        photo = _photos[i];
      }
    }
    if (!photo) {
      return;
    }
    try {
      var res = await fetch(photoUrlFor(photo) + '?download=1', {
        method: 'GET',
        credentials: 'same-origin',
        headers: credHeaders(false)
      });
      if (!res.ok) {
        throw new Error('HTTP ' + res.status);
      }
      var blob = await res.blob();
      var obj = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = obj;
      a.download = photo.filename || 'photo.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        URL.revokeObjectURL(obj);
      }, 4000);
      _note = { text: 'Downloading ' + (photo.filename || 'photo') + '.', kind: '' };
      paint();
    } catch (e) {
      _note = { text: 'The download failed. Check the connection and try again.', kind: 'warn' };
      paint();
    }
  }

  // ---- bundle dialog -------------------------------------------------------

  function findBundle(id) {
    var groups = groupsOf(_photos || []);
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].type === 'bundle' && groups[i].key === id) {
        return groups[i];
      }
    }
    return null;
  }

  function openBundle(id) {
    var b = findBundle(id);
    if (!b) {
      return;
    }
    _bundleOpen = id;
    _bundleConfirm = false;
    renderBundleDialog();
    var dialog = $('photos-bundle-dialog');
    if (dialog && dialog.showModal && !dialog.open) {
      dialog.showModal();
    }
  }

  function closeBundle() {
    _bundleOpen = '';
    _bundleConfirm = false;
    var dialog = $('photos-bundle-dialog');
    if (dialog && dialog.open) {
      dialog.close();
    }
  }

  function renderBundleDialog() {
    var b = findBundle(_bundleOpen);
    if (!b) {
      closeBundle();
      return;
    }
    var n = b.photos.length;
    var first = b.photos[0];
    var description = first.bundleCaption || first.caption || '';
    var title = $('photos-bundle-title');
    if (title) {
      title.textContent = n + (n === 1 ? ' photo' : ' photos');
    }
    var caption = $('photos-bundle-caption');
    if (caption) {
      caption.textContent = description || 'No description yet.';
    }
    var edit = $('photos-bundle-edit');
    if (edit) {
      edit.classList.toggle('is-hide', !roleCanEdit());
    }
    var input = $('photos-bundle-caption-input');
    if (input) {
      input.value = description;
    }
    var body = $('photos-bundle-body');
    if (body) {
      var html = '';
      for (var i = 0; i < b.photos.length; i++) {
        var p = b.photos[i];
        var meta = [];
        if (p.sizeBytes != null) {
          meta.push(esc(humanSize(p.sizeBytes)));
        }
        if (dayOf(p)) {
          meta.push(esc(dayOf(p)));
        }
        html +=
          '<figure class="photo-dialog-item">' +
          '<div class="photo-dialog-thumb" data-photo-thumb="' +
          esc(p.id) +
          '">' +
          ICON +
          '</div>' +
          '<figcaption class="photo-info">' +
          '<div class="photo-caption">' +
          esc(p.caption || p.filename || 'Photo') +
          '</div>' +
          '<div class="photo-meta">' +
          meta.join(' \u00b7 ') +
          '</div>' +
          '<div class="photo-actions">' +
          '<button class="btn btn-n btn-s" type="button" data-photo-download="' +
          esc(p.id) +
          '">Download</button>' +
          (roleCanEdit()
            ? '<button class="btn btn-n btn-s" type="button" data-photo-remove="' +
              esc(p.id) +
              '">Remove</button>'
            : '') +
          '</div>' +
          '</figcaption>' +
          '</figure>';
      }
      body.innerHTML = html;
      for (var j = 0; j < b.photos.length; j++) {
        loadThumb(b.photos[j]);
      }
    }
    var actions = $('photos-bundle-actions');
    if (actions) {
      if (!roleCanEdit()) {
        actions.innerHTML = '';
      } else if (_bundleConfirm) {
        actions.innerHTML =
          '<span class="photo-confirm">Remove all ' +
          n +
          ' photos in this bundle?</span>' +
          '<button class="btn btn-n btn-s" type="button" data-bundle-delete-confirm="1">Yes, remove bundle</button>' +
          '<button class="btn btn-n btn-s" type="button" data-bundle-delete-cancel="1">Keep</button>';
      } else {
        actions.innerHTML =
          '<button class="btn btn-n btn-s" type="button" data-bundle-delete="1">Remove bundle</button>';
      }
    }
  }

  function refreshBundleDialog(id) {
    var b = findBundle(id);
    if (!b) {
      closeBundle();
      return;
    }
    _bundleOpen = id;
    renderBundleDialog();
  }

  async function saveBundleCaption() {
    if (!_bundleOpen) {
      return;
    }
    var input = $('photos-bundle-caption-input');
    var caption = input ? String(input.value || '').slice(0, 200) : '';
    try {
      var res = await fetch(apiUrl('/bundle/' + encodeURIComponent(_bundleOpen)), {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: credHeaders(true),
        body: JSON.stringify({ caption: caption })
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data || !data.ok) {
        _note = {
          text: errorSentence(data && data.error, 'The description was not saved.'),
          kind: 'warn'
        };
        paint();
        return;
      }
      for (var i = 0; i < (_photos || []).length; i++) {
        if (_photos[i].bundleId === _bundleOpen) {
          _photos[i].bundleCaption = caption;
        }
      }
      _note = { text: 'Bundle description saved.', kind: '' };
      renderBundleDialog();
      paint();
    } catch (e) {
      _note = {
        text: 'The description was not saved. Check the connection and try again.',
        kind: 'warn'
      };
      paint();
    }
  }

  async function removeBundle(id) {
    if (!id) {
      return;
    }
    try {
      var res = await fetch(apiUrl('/bundle/' + encodeURIComponent(id) + '/delete'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: credHeaders(true)
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data || !data.ok) {
        _note = {
          text: errorSentence(data && data.error, 'The bundle was not removed.'),
          kind: 'warn'
        };
        paint();
        return;
      }
      var b = findBundle(id);
      if (b) {
        for (var i = 0; i < b.photos.length; i++) {
          forgetThumb(b.photos[i].id);
        }
      }
      closeBundle();
      _note = { text: 'Photo bundle removed.', kind: '' };
      await fetchPhotos();
    } catch (e) {
      _note = {
        text: 'The bundle was not removed. Check the connection and try again.',
        kind: 'warn'
      };
      paint();
    }
  }

  // ---- section entry -------------------------------------------------------

  function renderPhotosPanel() {
    var body = $('photos-body');
    if (!body) {
      return;
    }
    scaffold();
    // A queued photo from an earlier offline session is sent as soon as the
    // panel opens with a connection. The count paints immediately either way.
    queuedCount().then(function () {
      paint();
    });
    if (navigator.onLine) {
      flushQueue();
    }
    // The cloud module also calls this at boot. Painting then is harmless and
    // keeps the section ready, but fetching is not: no network for a panel
    // nobody opened. Only an active Photos panel (or an explicit refresh)
    // reads the list.
    var panel = $('panel-photos');
    if (!panel || !panel.classList.contains('active')) {
      paint();
      return;
    }
    if (!isCloudProject()) {
      _photos = _photos || [];
      _canUpload = false;
      paint();
      return;
    }
    if (_photos === null) {
      // First open: paint the shell, then fill it. The nav switch must not
      // wait on the network.
      paint();
      fetchPhotos();
      return;
    }
    // Re-entering the section re-reads the list: another device may have
    // added or removed photos since the last visit.
    fetchPhotos();
  }

  // ---- public API ----------------------------------------------------------

  ns.CloudPhotos = {
    cloudPhotosIsCloudProject: isCloudProject,
    cloudPhotosCanUpload: canUpload,
    cloudPhotosCanEdit: roleCanEdit,
    cloudPhotosUploadGateMessage: uploadGateMessage,
    cloudPhotosFetchPhotos: fetchPhotos,
    cloudPhotosOpenBundle: openBundle,
    cloudPhotosCloseBundle: closeBundle,
    cloudPhotosQueuedCount: queuedCount,
    cloudPhotosFlushQueue: flushQueue,
    cloudPhotosRenderPhotoList: function (container, opts) {
      if (!container) {
        return null;
      }
      var empty = opts && opts.emptyNote;
      container.innerHTML = empty && !(_photos || []).length ? esc(empty) : listHtml();
      return container;
    },
    cloudPhotosDoUpload: function (file, caption) {
      var cap = $('photos-caption-input');
      if (cap) {
        cap.value = caption || '';
      }
      var input = $('photos-upload-input');
      if (input && file) {
        try {
          var dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
        } catch (e) {
          /* older browsers: the _selected fallback below still works */
        }
      }
      _selected = file ? [file] : [];
      return submitUpload();
    },
    cloudPhotosDoDelete: removePhoto,
    cloudPhotosHumanSize: humanSize,
    cloudPhotosPhotoUrlFor: photoUrlFor,
    cloudPhotosPhotosUrl: function () {
      return apiUrl('');
    },
    cloudPhotosUploadUrl: function () {
      return apiUrl('');
    },
    cloudPhotosGetPhotos: function () {
      return _photos || [];
    },
    _renderPhotosPanel: renderPhotosPanel
  };
})(MMGR);
