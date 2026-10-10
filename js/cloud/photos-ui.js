/* ============================================================
   My MaNaGeR , Project Photos UI
   ------------------------------------------------------------
   Renders the Project Photos panel into the project page's section
   nav + content area. Cloud-only, login-gated, role-checked.

   Upload: owner + editor only.
   View / delete photo: owner, editor, viewer, client (read-only).
   The server is the real gate (src/cloud/photos.js); this module is
   UX defense-in-depth. If the project is not cloud-linked or there is
   no authenticated credential, the upload affordance is disabled with a
   plain explanation instead of silently no-op.

   Reuses ns.Cloud patterns:
     - pid(), getCode(), getECode(), getEScope(), activeCredential()
     - _sessOwner / probeOwnerSession()
     - hasCloudLink()
     - fetchSections() / sectionLabel()
     - setStatus()
     - escape helper

   Layout hook: the panel is mounted into #sec-photos (the page's section
   system). The section nav button is <button class="sec-btn" data-section="photos"
   data-action="showSec"> so the existing section switcher can open it, and the
   scope module can grey it out / hide it for editor clients the same way it
   does for every other section.
   ============================================================ */
var MMGR = window.MMGR || {};
(function (ns) {
  'use strict';

  var C = ns.Cloud;
  if (!C) {
    return;
  } // not on a page that loads the cloud module

  var $ = function (id) {
    return document.getElementById(id);
  };
  var esc =
    C.esc ||
    function (v) {
      return String(v == null ? '' : v).replace(/[&<>\"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c];
      });
    };

  var _photos = null; // last loaded photo list
  var _loading = false;
  var _uploading = false;

  // ---- cloud-only gate ----

  function isCloudProject() {
    // A cloud-linked project either carries a stored cloud id override, or
    // the cloud module already resolved one. hasCloudLink() is the same
    // predicate the rest of the cloud module uses for "can this project talk
    // to the cloud at all".
    if (!C.hasCloudLink) {
      return false;
    }
    if (!C.isSessionOwner) {
      return false;
    }
    if (!C.activeCredential) {
      return false;
    }
    // Defense-in-depth: a project with no stored cloud id is not cloud-linked
    // even if some local code slot is occupied (demo / code-based projects).
    try {
      var id = C.pid ? C.pid() : 'default';
      var stored = localStorage.getItem('mmgr_cloud_id_' + id);
      if (stored) {
        return true;
      }
    } catch (e) {
      /* storage blocked */
    }
    return false;
  }

  function canUpload() {
    // Upload is the part the owner explicitly called out: only owner + editor.
    // Viewer / client / api-key / read-only sessions cannot upload.
    var cred = C.activeCredential ? C.activeCredential() : null;
    if (!cred) {
      return false;
    }
    // viewer and client headers are read-only.
    if (cred.header === 'X-View-Code' || cred.header === 'X-Client-Code') {
      return false;
    }
    return true;
  }

  function uploadGateMessage() {
    if (!isCloudProject()) {
      return 'This project is not linked to the cloud , so it cannot receive photos. Cloud-linked projects only.';
    }
    var cred = C.activeCredential ? C.activeCredential() : null;
    if (!cred) {
      return 'Sign in or load this project with a code first , photos are only available to signed-in cloud sessions.';
    }
    if (cred.header === 'X-View-Code') {
      return 'Viewer codes are read-only , so they cannot upload photos. Ask for an editor or owner code to add photos.';
    }
    if (cred.header === 'X-Client-Code') {
      return 'Client codes are read-only , so they cannot upload photos. Ask for an editor or owner code to add photos.';
    }
    if (C.isClientSession && C.isClientSession()) {
      return 'Client access is read-only , so it cannot upload photos. Ask for editor or owner access to add photos.';
    }
    return 'Only the project owner or an editor can upload photos.';
  }

  // ---- photo list fetch ----

  function photosApiUrl() {
    return '/api/cloud/projects/' + encodeURIComponent(C.pid ? C.pid() : 'default') + '/photos';
  }

  async function fetchPhotos(renderErr) {
    if (_loading) {
      return;
    }
    _loading = true;
    try {
      var cred = C.activeCredential ? C.activeCredential() : null;
      var headers = { 'Content-Type': 'application/json' };
      if (cred && cred.header) {
        headers[cred.header] = cred.code;
      }
      var res = await fetch(photosApiUrl(), {
        method: 'GET',
        credentials: 'same-origin',
        headers: headers
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data || !data.ok) {
        var raw = (data && data.error) || '';
        var msg =
          raw === 'code_revoked'
            ? 'This code was revoked , photos may no longer be available.'
            : raw === 'project_deleted'
              ? 'This project was deleted , so its photos are gone.'
              : raw || 'Could not load photos (HTTP ' + res.status + ').';
        if (renderErr) {
          renderErr(msg);
        }
        if (C.setStatus) {
          C.setStatus(msg, 'err');
        }
        _photos = [];
        return;
      }
      _photos = Array.isArray(data.photos) ? data.photos : [];
    } catch (e) {
      var detail = (e && (e.message || e.name || String(e))) || 'unknown';
      var errMsg = 'Cloud is unavailable on this host (needs the Worker API). [' + detail + ']';
      if (renderErr) {
        renderErr(errMsg);
      }
      if (C.setStatus) {
        C.setStatus(errMsg, 'err');
      }
      _photos = [];
    } finally {
      _loading = false;
    }
  }

  function humanSize(bytes) {
    if (bytes == null || isNaN(bytes)) {
      return '';
    }
    bytes = Number(bytes);
    if (bytes < 1024) {
      return bytes + ' B';
    }
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function photoUrlFor(photo) {
    if (!photo || !photo.id) {
      return '';
    }
    return (
      '/api/cloud/projects/' +
      encodeURIComponent(C.pid ? C.pid() : 'default') +
      '/photos/' +
      encodeURIComponent(photo.id)
    );
  }

  function renderPhotoList(container, opts) {
    opts = opts || {};
    if (!container) {
      return;
    }
    if (_loading) {
      container.innerHTML = '<div class="sr-hint" style="margin:0">Loading photos…</div>';
      return;
    }
    if (!Array.isArray(_photos) || !_photos.length) {
      var emptyNote = opts.emptyNote || 'No photos yet.';
      container.innerHTML = '<div class="sr-hint" style="margin:0">' + esc(emptyNote) + '</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < _photos.length; i++) {
      var p = _photos[i];
      var thumbUrl = photoUrlFor(p);
      var caption = p.caption || '';
      var uploadedBy = p.uploadedBy || '';
      var when = p.createdAt ? p.createdAt.slice(0, 10) : '';
      html +=
        '<figure class="photo-item">' +
        '<a class="photo-thumb-link" href="' +
        esc(thumbUrl) +
        '" target="_blank" rel="noopener">' +
        '<div class="photo-thumb" data-photo-id="' +
        esc(p.id) +
        '" style="background:rgba(var(--gold-rgb),.06);border:1px solid var(--border)">' +
        '<svg class="ico photo-placeholder-ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-image"></use></svg>' +
        '</div>' +
        '</a>' +
        '<figcaption>' +
        (caption ? '<div class="photo-caption">' + esc(caption) + '</div>' : '') +
        (uploadedBy ? '<div class="photo-meta">' + esc(uploadedBy) + '</div>' : '') +
        (when ? '<div class="photo-meta t-xs">' + esc(when) + '</div>' : '') +
        '</figcaption>' +
        '</figure>';
    }
    container.innerHTML = html;
  }

  // ---- upload ----

  function uploadApiUrl() {
    return '/api/cloud/projects/' + encodeURIComponent(C.pid ? C.pid() : 'default') + '/photos';
  }

  async function doUpload(file, caption) {
    if (_uploading) {
      return { ok: false, error: 'A photo is already uploading.' };
    }
    if (!file) {
      return { ok: false, error: 'No photo selected.' };
    }
    if (!(file instanceof File)) {
      return { ok: false, error: 'That is not a photo file.' };
    }
    if (file.size === 0) {
      return { ok: false, error: 'That photo is empty.' };
    }
    if (file.size > 8 * 1024 * 1024) {
      return { ok: false, error: 'This photo is too large. Keep it under 8 MB.' };
    }

    _uploading = true;
    try {
      var form = new FormData();
      form.append('file', file);
      if (caption) {
        form.append('caption', String(caption).slice(0, 200));
      }

      var cred = C.activeCredential ? C.activeCredential() : null;
      var headers = {};
      if (cred && cred.header) {
        headers[cred.header] = cred.code;
      }

      var res = await fetch(uploadApiUrl(), {
        method: 'POST',
        credentials: 'same-origin',
        headers: headers,
        body: form
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data || !data.ok) {
        var raw = (data && data.error) || '';
        var msg =
          raw === 'code_revoked'
            ? 'This code was revoked , the upload was not accepted.'
            : raw === 'project_deleted'
              ? 'This project was deleted , so the upload was not accepted.'
              : raw || 'Upload failed (HTTP ' + res.status + ').';
        if (C.setStatus) {
          C.setStatus(msg, 'err');
        }
        return { ok: false, error: msg };
      }
      if (C.setStatus) {
        C.setStatus('Photo added.', 'ok');
      }
      return { ok: true, photo: data.photo };
    } catch (e) {
      var detail = (e && (e.message || e.name || String(e))) || 'unknown';
      var errMsg = 'Cloud is unavailable on this host (needs the Worker API). [' + detail + ']';
      if (C.setStatus) {
        C.setStatus(errMsg, 'err');
      }
      return { ok: false, error: errMsg };
    } finally {
      _uploading = false;
    }
  }

  // ---- delete ----

  function deleteApiUrl(photoId) {
    return (
      '/api/cloud/projects/' +
      encodeURIComponent(C.pid ? C.pid() : 'default') +
      '/photos/' +
      encodeURIComponent(photoId) +
      '/delete'
    );
  }

  async function doDelete(photoId, confirmMsg) {
    if (!photoId) {
      return { ok: false, error: 'No photo selected.' };
    }
    if (!confirmMsg) {
      confirmMsg = 'Remove this photo from the project? This cannot be undone.';
    }
    if (!window.confirm(confirmMsg)) {
      return { ok: false, error: 'cancelled' };
    }
    var cred = C.activeCredential ? C.activeCredential() : null;
    var headers = { 'Content-Type': 'application/json' };
    if (cred && cred.header) {
      headers[cred.header] = cred.code;
    }
    var res = await fetch(deleteApiUrl(photoId), {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers
    });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !data || !data.ok) {
      var raw = (data && data.error) || '';
      var msg =
        raw === 'code_revoked'
          ? 'This code was revoked , the photo was not removed.'
          : raw === 'project_deleted'
            ? 'This project was deleted , so the photo was not removed.'
            : raw || 'Delete failed (HTTP ' + res.status + ').';
      if (C.setStatus) {
        C.setStatus(msg, 'err');
      }
      return { ok: false, error: msg };
    }
    if (C.setStatus) {
      C.setStatus('Photo removed.', 'ok');
    }
    return { ok: true, deleted: photoId };
  }

  // ---- public API ----

  // Export keys follow the repo's domain-prefixed convention for extracted
  // cloud sub-modules (cloudReviewList, webhookList, ...): the key names match
  // the delegating wrappers in js/mmgr-cloud.js one-for-one, which is what the
  // export-completeness gate (tools/verify-render-exports.cjs) checks.
  ns.CloudPhotos = {
    cloudPhotosIsCloudProject: isCloudProject,
    cloudPhotosCanUpload: canUpload,
    cloudPhotosUploadGateMessage: uploadGateMessage,
    cloudPhotosFetchPhotos: fetchPhotos,
    cloudPhotosRenderPhotoList: renderPhotoList,
    cloudPhotosDoUpload: doUpload,
    cloudPhotosDoDelete: doDelete,
    cloudPhotosHumanSize: humanSize,
    cloudPhotosPhotoUrlFor: photoUrlFor,
    cloudPhotosPhotosUrl: photosApiUrl,
    cloudPhotosUploadUrl: uploadApiUrl,
    cloudPhotosGetPhotos: function () {
      return _photos;
    },
    // Paint-the-panel entry the cloud module calls after it renders. Kept on
    // the same object so a photos re-render needs no second lookup path.
    _renderPhotosPanel: function () {
      renderPhotosPanel();
    }
  };

  function photoBody() {
    if (!C.pid) {
      return;
    }
    var body = $('photos-body');
    if (!body) {
      return;
    }
    if (body.classList.contains('is-hide') && !body.dataset.photosRendered) {
      return;
    }
    renderPhotosPanel();
  }
  function renderPhotosPanel() {
    var body = $('photos-body');
    if (!body) {
      return;
    }
    renderPhotoList(body);
  }
  function enableUploadAffordance() {
    if (!C.pid) {
      return;
    }
    var uploadRow = $('photos-upload-row');
    if (!uploadRow) {
      return;
    }
    var gate = uploadGateMessage();
    var blocked = !C.isSessionOwner && !C.canUpload();
    uploadRow.classList.toggle('is-hide', blocked);
    var note = $('photos-upload-note');
    if (note) {
      note.textContent = gate;
    }
    var btn = $('photos-upload-btn');
    if (btn) {
      btn.disabled = !!blocked;
      btn.setAttribute('aria-disabled', blocked ? 'true' : 'false');
    }
  }
  function onSectionShow() {
    if (!C.pid) {
      return;
    }
    if (event && event.sections && event.sections.indexOf('photos') === -1) {
      return;
    }
    if (event && event.sections && event.sections.indexOf('photos') !== -1) {
      var wrap = $('photos-wrap');
      if (wrap) {
        wrap.classList.remove('is-hide');
        enableUploadAffordance();
      }
      photoBody();
    }
  }
  function bootPhotos() {
    if (!C.pid) {
      return;
    }
    if (document.activeElement && document.activeElement.id === 'photos-upload-input') {
      return;
    }
    var wrap = $('photos-wrap');
    if (!wrap) {
      return;
    }
    var active = $('sec-photos') && $('sec-photos').classList.contains('active');
    if (active) {
      wrap.classList.remove('is-hide');
      enableUploadAffordance();
    }
    photoBody();
  }
  function _bindLiveUpload() {
    var input = $('photos-upload-input');
    var btn = $('photos-upload-btn');
    if (!input || !btn) {
      return;
    }
    input.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) {
        return;
      }
      var cap = $('photos-caption-input');
      var caption = cap ? String(cap.value || '').slice(0, 200) : '';
      doUpload(file, caption).then(function (r) {
        if (r.ok) {
          $('photos-upload-input').value = '';
          $('photos-caption-input').value = '';
          fetchPhotos();
          renderPhotosPanel();
          enableUploadAffordance();
        } else if (r.error) {
          if (C.setStatus) {
            C.setStatus(r.error, 'err');
          }
        }
      });
    });
    btn.addEventListener('click', function () {
      input.focus();
      input.click();
    });
  }
  function _boot() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        if (C && C.pid) {
          bootPhotos();
          _bindLiveUpload();
          document.addEventListener('mmgr:sections-changed', onSectionShow);
        }
      });
    } else {
      if (C && C.pid) {
        bootPhotos();
        _bindLiveUpload();
        document.addEventListener('mmgr:sections-changed', onSectionShow);
      }
    }
  }
  _boot();

  // Keep the photos panel fresh after a cloud render cycle. Boot already
  // ran above; this is a no-op if the panel is already up to date.
  try {
    MMGR.Cloud._renderPhotosPanel();
  } catch (e) {
    /* guard */
  }
})(MMGR);
