/* ============================================================
   My MaNaGeR , Project Photos UI (B11, 5.7)
   ------------------------------------------------------------
   Renders the whole Project Photos panel into #photos-body on the project
   page's Photos section. Before this rewrite the module painted only a bare
   list, into a #sec-photos that does not exist, and never fetched anything
   on open: the panel was permanently empty and the server route it talks to
   had no caller.

   What the panel shows:
     - the account's storage bar (500 MB per account, server-owned numbers)
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

  function canUpload() {
    if (_canUpload !== null) {
      return _canUpload;
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
        var msg = errorSentence(
          data && data.error,
          loadFailureSentence(res.status)
        );
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
      _canUpload = data.canUpload !== false;
      if (!canUpload()) {
        _note = { text: uploadGateMessage(), kind: '' };
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
      '<button class="btn btn-g btn-s is-hide" id="photos-add-btn" type="button">Add photo</button>' +
      '</div>' +
      '<form class="photos-form is-hide" id="photos-form" novalidate>' +
      '<input type="file" id="photos-upload-input" accept="image/jpeg,image/png,image/webp,image/gif,image/avif">' +
      '<div class="photos-form-actions">' +
      '<button class="btn btn-n btn-s" id="photos-pick-btn" type="button">Choose photo</button>' +
      '<span class="photo-meta" id="photos-file-name">No photo chosen</span>' +
      '</div>' +
      '<input class="in" type="text" id="photos-caption-input" maxlength="200" placeholder="Description (what and where)" aria-label="Photo description">' +
      '<input class="in" type="date" id="photos-date-input" aria-label="Date taken">' +
      '<select class="in" id="photos-stage-input" aria-label="Stage">' +
      '<option value="">Stage (optional)</option>' +
      '<option value="before">Before</option>' +
      '<option value="after">After</option>' +
      '<option value="progress">In progress</option>' +
      '</select>' +
      '<div class="photos-form-actions">' +
      '<button class="btn btn-g btn-s" id="photos-submit-btn" type="submit">Upload</button>' +
      '<button class="btn btn-n btn-s" id="photos-cancel-btn" type="button">Cancel</button>' +
      '</div>' +
      '</form>' +
      '<div class="txt-sl t-xs is-hide" id="photos-note" role="status"></div>' +
      '<div id="photos-list"></div>';
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

    if (addBtn && form) {
      addBtn.addEventListener('click', function () {
        form.classList.remove('is-hide');
        addBtn.classList.add('is-hide');
        if (input) {
          input.focus();
        }
      });
    }
    // File inputs cannot be styled, so the visible button opens the hidden one.
    if (pick && input) {
      pick.addEventListener('click', function () {
        input.click();
      });
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        var name = $('photos-file-name');
        if (name) {
          name.textContent = file
            ? file.name + ' (' + humanSize(file.size) + ')'
            : 'No photo chosen';
        }
      });
    }
    if (cancel && form) {
      cancel.addEventListener('click', function () {
        resetForm();
        form.classList.add('is-hide');
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
      name.textContent = 'No photo chosen';
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
          (canUpload()
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
    var html = '';
    for (var i = 0; i < _photos.length; i++) {
      html += cardHtml(_photos[i]);
    }
    return html;
  }

  function paint() {
    var body = scaffold();
    if (!body) {
      return;
    }
    var addBtn = $('photos-add-btn');
    var can = canUpload() && isCloudProject();
    if (addBtn) {
      addBtn.classList.toggle('is-hide', !can);
    }
    if (!can) {
      var form = $('photos-form');
      if (form) {
        form.classList.add('is-hide');
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
      note.innerHTML = noteHtml();
      note.classList.toggle('is-hide', !_note.text);
      note.classList.toggle('note-warn', _note.kind === 'warn');
    }
    var list = $('photos-list');
    if (list) {
      list.innerHTML = listHtml();
      for (var i = 0; i < (_photos || []).length; i++) {
        loadThumb(_photos[i]);
      }
    }
    var submit = $('photos-submit-btn');
    if (submit) {
      submit.disabled = !!_uploading;
      submit.textContent = _uploading ? 'Uploading\u2026' : 'Upload';
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

  function loadThumb(photo) {
    var slot = document.querySelector('[data-photo-thumb="' + photo.id + '"]');
    if (!slot) {
      return;
    }
    if (_thumbs[photo.id]) {
      showThumb(slot, _thumbs[photo.id]);
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
        var again = document.querySelector('[data-photo-thumb="' + photo.id + '"]');
        if (again) {
          showThumb(again, obj);
        }
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

  // ---- actions -------------------------------------------------------------

  async function submitUpload() {
    var input = $('photos-upload-input');
    var file = input && input.files && input.files[0];
    if (!file) {
      _note = { text: 'Choose a photo first.', kind: 'warn' };
      paint();
      return { ok: false, error: 'No photo selected.' };
    }
    if (file.size > 8 * 1024 * 1024) {
      _note = { text: 'This photo is larger than 8 MB. Resize it, then try again.', kind: 'warn' };
      paint();
      return { ok: false, error: 'too large' };
    }
    var cap = $('photos-caption-input');
    var date = $('photos-date-input');
    var stage = $('photos-stage-input');
    var caption = cap ? String(cap.value || '').slice(0, 200) : '';
    var capturedAt = date ? String(date.value || '') : '';
    var stageValue = stage ? String(stage.value || '') : '';

    _uploading = true;
    _note = { text: '', kind: '' };
    paint();
    try {
      var form = new FormData();
      form.append('file', file);
      if (caption) {
        form.append('caption', caption);
      }
      if (capturedAt) {
        form.append('capturedAt', capturedAt);
      }
      if (stageValue) {
        form.append('stage', stageValue);
      }
      var res = await fetch(apiUrl(''), {
        method: 'POST',
        credentials: 'same-origin',
        headers: credHeaders(false),
        body: form
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data || !data.ok) {
        // The server owns the refusal sentence (paid plan, quota, role), and
        // it is shown verbatim: rewriting it here is how upgrade copy drifts.
        var msg = errorSentence(data && data.error, 'Upload failed (HTTP ' + res.status + ').');
        _note = { text: msg, kind: 'warn' };
        paint();
        return { ok: false, error: msg };
      }
      resetForm();
      var f = $('photos-form');
      if (f) {
        f.classList.add('is-hide');
      }
      _note = { text: 'Photo added.', kind: '' };
      await fetchPhotos();
      return { ok: true, photo: data.photo };
    } catch (e) {
      var detail = (e && (e.message || e.name || String(e))) || 'unknown';
      var errMsg =
        'Cloud is unavailable on this host, so the photo was not uploaded. [' + detail + ']';
      _note = { text: errMsg, kind: 'warn' };
      paint();
      return { ok: false, error: errMsg };
    } finally {
      _uploading = false;
      paint();
    }
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

  // ---- section entry -------------------------------------------------------

  function renderPhotosPanel() {
    var body = $('photos-body');
    if (!body) {
      return;
    }
    scaffold();
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
    cloudPhotosUploadGateMessage: uploadGateMessage,
    cloudPhotosFetchPhotos: fetchPhotos,
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
          /* older browsers: caller must use the form */
        }
      }
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
