/* ============================================================
   PROJECT PHOTOS — R2 blob storage + D1 metadata
   ------------------------------------------------------------
   Photos are cloud-only. Every entry point verifies:
     1. the project exists in cloud_projects — the row's existence IS the
        definition of "cloud-linked" (handleCloudCreate is its only writer, and
        a local-only project has no row, so it is refused before any role
        check). Deliberately NOT keyed on google_sub: a project created with a
        code instead of a signed-in Google account has google_sub NULL and is
        still a valid cloud project.
     2. the caller is authenticated for this project by the existing cloud auth
        paths (owner code, session owner, editor/code, viewer/code, client code,
        adoption, team, or api key — mirrors handleCloudMeta / handleCloudLoad),
     3. the caller's role permits the requested action.

   Upload: owner + editors only.
   View list / single photo: owner, editor, viewer, client (read-only through
   the client-code section grant), adoption, team member with read access.
   Delete: owner + editors only.

   Blobs: R2 prefix photos/<project_id>/<photo_id>.<ext>
   Metadata: cloud_project_photos (migration 0025)
   ============================================================ */

import { json, cloudForbidden, cloudProjectDeleted, cloudTimingSink } from '../lib/http.js';

// Shared access gate used by upload / list / single / delete. Kept in one
// place so the timing-safe auth path is not duplicated across handlers.

const PHOTO_R2_PREFIX = 'photos/';
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB per photo
const MAX_PHOTOS_PER_PROJECT = 200; // soft cap, enforced at upload
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif'
]);
function extForContentType(type) {
  if (type === 'image/jpeg') {
    return '.jpg';
  }
  if (type === 'image/png') {
    return '.png';
  }
  if (type === 'image/webp') {
    return '.webp';
  }
  if (type === 'image/gif') {
    return '.gif';
  }
  if (type === 'image/avif') {
    return '.avif';
  }
  return null;
}

function photoR2Key(projectId, photoId, ext) {
  return PHOTO_R2_PREFIX + projectId + '/' + photoId + ext;
}

function rolesWithUpload(role) {
  return role === 'owner' || role === 'editor';
}

function rolesWithView(role) {
  return role === 'owner' || role === 'editor' || role === 'view' || role === 'client';
}

// ---- helpers: project row + auth resolution (mirrors handleCloudMeta) ----

async function projectRow(env, projectId) {
  const row = await env.DB.prepare(
    'SELECT owner_code_salt, owner_code_hash, google_sub, google_name, owner_label, latest_r2_key, updated_at, deleted_at FROM cloud_projects WHERE project_id = ?'
  )
    .bind(projectId)
    .first();
  return row;
}

async function resolvePhotoAccess(request, env, projectId) {
  // Mirrors handleCloudMeta / handleCloudLoad: resolve who is calling and
  // what they can do. Returns { ok, role, label, scope } or throws a Response.
  const ownerCode = String(request.headers.get('X-Owner-Code') || '').trim();
  const ecode = String(request.headers.get('X-Editor-Code') || '').trim();
  const vcode = String(request.headers.get('X-View-Code') || '').trim();
  const ccode = String(request.headers.get('X-Client-Code') || '').trim();
  const apiKeyHeader = String(request.headers.get('X-API-Key') || '').trim();

  // API-key reads are read-only and scope-projected (same as /load/api-key).
  if (apiKeyHeader && !ownerCode && !ecode && !vcode && !ccode) {
    const { cloudAuthApiKey } = await import('../lib/http.js');
    const ka = await cloudAuthApiKey(request, env, projectId, apiKeyHeader);
    if (!ka) {
      return { ok: false };
    }
    return { ok: true, role: 'api', label: ka.label, scope: ka.scope };
  }

  let sessionOwner = null;
  let adopt = null;
  let team = null;

  if (!ownerCode && !ecode && !vcode && !ccode) {
    const { cloudAuthOwnerSession, cloudAuthAdoption, cloudAuthWithRole } =
      await import('../lib/http.js');
    sessionOwner = await cloudAuthOwnerSession(request, env, projectId);
    if (!sessionOwner) {
      adopt = await cloudAuthAdoption(request, env, projectId);
      if (!adopt) {
        const ta = await cloudAuthWithRole(request, env, projectId);
        if (ta && ta.source === 'team') {
          team = ta;
        }
      }
    }
  }

  let ownerAuth = false;
  let editorAuth = null;
  let viewerAuth = null;
  let clientAuth = null;

  if (ownerCode) {
    const { cloudAuthOwnerByCode } = await import('../lib/http.js');
    const a = await cloudAuthOwnerByCode(request, env, projectId, ownerCode);
    if (!a) {
      return { ok: false };
    }
    ownerAuth = true;
  } else if (ecode) {
    const { cloudAuthEditor } = await import('../lib/http.js');
    editorAuth = await cloudAuthEditor(request, env, projectId, ecode);
    if (!editorAuth) {
      return { ok: false };
    }
  } else if (vcode) {
    const { cloudAuthViewer } = await import('../lib/http.js');
    viewerAuth = await cloudAuthViewer(request, env, projectId, vcode);
    if (!viewerAuth) {
      return { ok: false };
    }
  } else if (ccode) {
    const { verifyClientCode } = await import('./client-codes.js');
    const ca = await verifyClientCode(ccode, projectId, env);
    if (!ca) {
      return { ok: false };
    }
    if (ca.expired) {
      return { ok: 'expired', expiresAt: ca.expiresAt };
    }
    if (ca.deleted) {
      return { ok: 'deleted' };
    }
    clientAuth = { sections: ca.sections };
  } else if (sessionOwner) {
    ownerAuth = true;
  } else if (adopt) {
    if (adopt.revoked) {
      return { ok: 'revoked' };
    }
    if (adopt.deleted) {
      return { ok: 'deleted' };
    }
    if (adopt.role === 'view') {
      viewerAuth = { label: adopt.label || 'Viewer', scope: adopt.scope, role: 'view' };
    } else {
      editorAuth = { label: adopt.label || 'Editor', scope: adopt.scope, role: 'editor' };
    }
  } else if (team) {
    const { teamScopeForRole } = await import('../lib/http.js');
    if (team.role === 'manager') {
      ownerAuth = true;
    } else if (team.role === 'client') {
      clientAuth = { sections: team.scope || [] };
    } else if (team.role === 'supervisor' || team.role === 'contractor') {
      editorAuth = {
        label: 'Team ' + team.role,
        scope: teamScopeForRole(team.role, team.scope),
        role: 'editor'
      };
    } else {
      return { ok: false };
    }
  } else {
    await cloudTimingSink();
    return { ok: false };
  }

  let role = 'unknown';
  let label = '';
  let scope = [];

  if (ownerAuth) {
    role = 'owner';
  } else if (editorAuth) {
    role = editorAuth.role || 'editor';
    label = editorAuth.label || '';
    scope = editorAuth.scope || [];
  } else if (viewerAuth) {
    role = 'view';
    label = viewerAuth.label || '';
    scope = viewerAuth.scope || [];
  } else if (clientAuth) {
    role = 'client';
  }

  return { ok: true, role, label, scope };
}

// ---- upload ----

export async function handlePhotoUpload(request, env, projectId) {
  const proj = await projectRow(env, projectId);
  if (!proj) {
    return cloudForbidden();
  }
  if (proj.deleted_at) {
    return cloudProjectDeleted();
  }

  // Cloud-only gate: reaching this point already proves the project is
  // cloud-linked — projectRow() above returns cloudForbidden() when there is no
  // cloud_projects row, and only handleCloudCreate ever writes one. Testing
  // google_sub here would be WRONG: a project created with a code rather than a
  // Google sign-in carries google_sub NULL and must still accept photos.

  // Auth + role.
  const access = await resolvePhotoAccess(request, env, projectId);
  if (!access.ok) {
    if (access.ok === 'expired') {
      return json({ ok: false, error: 'code_expired', expiresAt: access.expiresAt }, 403);
    }
    if (access.ok === 'revoked' || access.ok === 'deleted') {
      return cloudForbidden();
    }
    await cloudTimingSink();
    return cloudForbidden();
  }
  if (!rolesWithUpload(access.role)) {
    return json({ ok: false, error: 'only the project owner or an editor can upload photos' }, 403);
  }

  // Body: multipart form with one file field "file".
  if (!request.body) {
    return json({ ok: false, error: 'no file' }, 400);
  }
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return json({ ok: false, error: 'send a multipart form with one file field named file' }, 400);
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || typeof file.size !== 'number') {
    return json({ ok: false, error: 'no file in the form field named file' }, 400);
  }
  if (file.size === 0) {
    return json({ ok: false, error: 'the uploaded file is empty' }, 400);
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return json({ ok: false, error: 'photo is too large — keep it under 8 MB' }, 413);
  }

  const type = (file.type || '').trim().toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(type)) {
    // Keep this generic: do not enumerate allowed types in the public message.
    return json(
      {
        ok: false,
        error: 'that file type is not accepted here — use a photo (JPG, PNG, WebP, GIF, AVIF)'
      },
      400
    );
  }
  const ext = extForContentType(type);
  if (!ext) {
    return json({ ok: false, error: 'that file type is not accepted here' }, 400);
  }

  // Count current active photos for the cap.
  const countRow = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM cloud_project_photos WHERE project_id = ? AND deleted_at IS NULL'
  )
    .bind(projectId)
    .first();
  const count = Number(countRow && countRow.c) || 0;
  if (count >= MAX_PHOTOS_PER_PROJECT) {
    return json(
      {
        ok: false,
        error: 'this project already has the most photos it can hold — delete an older photo first'
      },
      413
    );
  }

  // Build the photo metadata.
  const photoId = crypto.randomUUID();
  const caption = String(formData.get('caption') || '')
    .slice(0, 200)
    .trim();
  const capturedAt = String(formData.get('capturedAt') || '').trim();
  const uploadedBy = access.label || (access.role === 'owner' ? 'Owner' : 'Editor');

  // Persist metadata first, then the blob. If the blob write fails we leave a
  // dangling metadata row; the list path hides deleted_at rows and a delete path
  // cleans up both, so this is acceptable and avoids losing the upload that
  // already crossed the network.
  const now = new Date().toISOString();
  const orderRow = await env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM cloud_project_photos WHERE project_id = ? AND deleted_at IS NULL'
  )
    .bind(projectId)
    .first();
  const sortOrder = Number(orderRow && orderRow.n) || 1;

  let metaId;
  try {
    const ins = await env.DB.prepare(
      'INSERT INTO cloud_project_photos (project_id, photo_id, filename, caption, captured_at, uploaded_by, content_type, size_bytes, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
    )
      .bind(
        projectId,
        photoId,
        file.name.slice(0, 255),
        caption,
        capturedAt,
        uploadedBy,
        type,
        file.size,
        sortOrder,
        now
      )
      .run();
    metaId = ins.meta.last_row_id;
  } catch (e) {
    // Duplicate photo_id is astronomically unlikely (UUID), but treat any
    // constraint failure as a retry-safe upload refusal.
    return json({ ok: false, error: 'could not record this photo — try again' }, 409);
  }

  // Write the blob.
  const r2Key = photoR2Key(projectId, photoId, ext);
  try {
    const blob = await file.arrayBuffer();
    await env.R2.put(r2Key, blob, {
      httpMetadata: { contentType: type }
    });
  } catch (e) {
    // Best-effort cleanup of the metadata row we just wrote.
    try {
      await env.DB.prepare('DELETE FROM cloud_project_photos WHERE id = ?').bind(metaId).run();
    } catch (_) {}
    return json({ ok: false, error: 'could not store this photo — try again' }, 500);
  }

  const meta = await env.DB.prepare(
    'SELECT id, photo_id, filename, caption, captured_at, uploaded_by, content_type, size_bytes, sort_order, created_at FROM cloud_project_photos WHERE id = ?'
  )
    .bind(metaId)
    .first();

  return json({
    ok: true,
    photo: {
      id: meta.photo_id,
      filename: meta.filename,
      caption: meta.caption,
      capturedAt: meta.captured_at,
      uploadedBy: meta.uploaded_by,
      contentType: meta.content_type,
      sizeBytes: meta.size_bytes,
      sortOrder: meta.sort_order,
      createdAt: meta.created_at
    }
  });
}

// ---- list ----

export async function handlePhotoList(request, env, projectId) {
  const proj = await projectRow(env, projectId);
  if (!proj) {
    return cloudForbidden();
  }
  if (proj.deleted_at) {
    return cloudProjectDeleted();
  }

  const access = await resolvePhotoAccess(request, env, projectId);
  if (!access.ok) {
    if (access.ok === 'expired') {
      return json({ ok: false, error: 'code_expired', expiresAt: access.expiresAt }, 403);
    }
    if (access.ok === 'revoked' || access.ok === 'deleted') {
      return cloudForbidden();
    }
    await cloudTimingSink();
    return cloudForbidden();
  }
  if (!rolesWithView(access.role)) {
    return json({ ok: false, error: 'you do not have access to this project\u2019s photos' }, 403);
  }

  // Client codes are read-only and scope-bound. If the caller is a client code,
  // the photos panel must be in the granted sections for the list to be visible.
  if (access.role === 'client') {
    const hasPhotosSection = access.scope && access.scope.includes('photos');
    if (!hasPhotosSection) {
      // Not forbidden — the client simply has no visibility here. Return an
      // empty list so the UI can show the "no photos" state honestly instead of
      // pretending the panel is broken.
      return json({
        ok: true,
        photos: [],
        role: 'client',
        note: 'this code does not include the project photos'
      });
    }
  }

  const rows = await env.DB.prepare(
    'SELECT id, photo_id, filename, caption, captured_at, uploaded_by, content_type, size_bytes, sort_order, created_at FROM cloud_project_photos WHERE project_id = ? AND deleted_at IS NULL ORDER BY sort_order DESC, created_at DESC'
  )
    .bind(projectId)
    .all();

  const photos = ((rows && rows.results) || []).map(function (r) {
    return {
      id: r.photo_id,
      filename: r.filename,
      caption: r.caption,
      capturedAt: r.captured_at,
      uploadedBy: r.uploaded_by,
      contentType: r.content_type,
      sizeBytes: r.size_bytes,
      sortOrder: r.sort_order,
      createdAt: r.created_at,
      url:
        '/api/cloud/projects/' +
        encodeURIComponent(projectId) +
        '/photos/' +
        encodeURIComponent(r.photo_id)
    };
  });

  return json({ ok: true, photos: photos, role: access.role });
}

// ---- single photo (blob + metadata) ----

export async function handlePhotoGet(request, env, projectId, photoId) {
  const proj = await projectRow(env, projectId);
  if (!proj) {
    return cloudForbidden();
  }
  if (proj.deleted_at) {
    return cloudProjectDeleted();
  }

  const access = await resolvePhotoAccess(request, env, projectId);
  if (!access.ok) {
    if (access.ok === 'expired') {
      return json({ ok: false, error: 'code_expired', expiresAt: access.expiresAt }, 403);
    }
    if (access.ok === 'revoked' || access.ok === 'deleted') {
      return cloudForbidden();
    }
    await cloudTimingSink();
    return cloudForbidden();
  }
  if (!rolesWithView(access.role)) {
    return json({ ok: false, error: 'you do not have access to this project\u2019s photos' }, 403);
  }

  const meta = await env.DB.prepare(
    'SELECT id, photo_id, filename, caption, captured_at, uploaded_by, content_type, size_bytes, sort_order, created_at FROM cloud_project_photos WHERE project_id = ? AND photo_id = ? AND deleted_at IS NULL'
  )
    .bind(projectId, photoId)
    .first();
  if (!meta) {
    return json({ ok: false, error: 'photo not found' }, 404);
  }

  // The R2 key carries the file extension the upload derived from the stored
  // content type, so it must be reconstructed the SAME way. Building it with an
  // empty extension misses every blob (the bytes live at <photoId>.png, not
  // <photoId>), which would 404 every single-photo view.
  const ext = extForContentType(meta.content_type);
  if (!ext) {
    // Unknown content type on the row: never guess a key, just report gone.
    return json({ ok: false, error: 'photo not found' }, 404);
  }
  const obj = await env.R2.get(photoR2Key(projectId, photoId, ext));
  if (!obj) {
    // Metadata exists but the blob is missing. Report the photo as gone rather
    // than serving a broken image; the row is soft-deleted so a transient R2
    // error can never destroy the record permanently.
    try {
      await env.DB.prepare(
        'UPDATE cloud_project_photos SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'
      )
        .bind(new Date().toISOString(), meta.id)
        .run();
    } catch (_) {}
    return json({ ok: false, error: 'photo not found' }, 404);
  }

  const body = await obj.arrayBuffer();
  return new Response(body, {
    headers: {
      'Content-Type': meta.content_type,
      'Content-Length': String(meta.size_bytes),
      'Cache-Control': 'public, max-age=86400, immutable',
      'Content-Disposition': 'inline; filename="' + meta.filename.replace(/"/g, '') + '"'
    }
  });
}

// ---- delete ----

export async function handlePhotoDelete(request, env, projectId, photoId) {
  const proj = await projectRow(env, projectId);
  if (!proj) {
    return cloudForbidden();
  }
  if (proj.deleted_at) {
    return cloudProjectDeleted();
  }

  const access = await resolvePhotoAccess(request, env, projectId);
  if (!access.ok) {
    if (access.ok === 'expired') {
      return json({ ok: false, error: 'code_expired', expiresAt: access.expiresAt }, 403);
    }
    if (access.ok === 'revoked' || access.ok === 'deleted') {
      return cloudForbidden();
    }
    await cloudTimingSink();
    return cloudForbidden();
  }
  if (!rolesWithUpload(access.role)) {
    return json({ ok: false, error: 'only the project owner or an editor can remove photos' }, 403);
  }

  // Confirm the photo belongs to this project and is not already deleted.
  const meta = await env.DB.prepare(
    'SELECT id, photo_id, content_type FROM cloud_project_photos WHERE project_id = ? AND photo_id = ? AND deleted_at IS NULL'
  )
    .bind(projectId, photoId)
    .first();
  if (!meta) {
    return json({ ok: false, error: 'photo not found' }, 404);
  }

  // Soft-delete the metadata row first (so repeat deletes are idempotent and the
  // blob delete below is best-effort). Then remove the R2 blob.
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE cloud_project_photos SET deleted_at = ? WHERE id = ?')
    .bind(now, meta.id)
    .run();

  const r2Key = photoR2Key(projectId, photoId, extForContentType(meta.content_type) || '');
  try {
    await env.R2.delete(r2Key);
  } catch (e) {
    // Blob delete is best-effort; the metadata soft-delete already hides it from
    // the list and the single-photo path.
  }

  return json({ ok: true, deleted: photoId, deletedAt: now });
}

// ---- light metadata-only endpoint for the panel to render captions/titles ----
// Not required for correctness (handlePhotoList already returns enough), but it
// keeps the single-photo panel render from fetching the blob just to read its
// caption. Read-only, same access rules as handlePhotoList.

export async function handlePhotoMeta(request, env, projectId, photoId) {
  const proj = await projectRow(env, projectId);
  if (!proj) {
    return cloudForbidden();
  }
  if (proj.deleted_at) {
    return cloudProjectDeleted();
  }

  const access = await resolvePhotoAccess(request, env, projectId);
  if (!access.ok) {
    if (access.ok === 'expired') {
      return json({ ok: false, error: 'code_expired', expiresAt: access.expiresAt }, 403);
    }
    if (access.ok === 'revoked' || access.ok === 'deleted') {
      return cloudForbidden();
    }
    await cloudTimingSink();
    return cloudForbidden();
  }
  if (!rolesWithView(access.role)) {
    return json({ ok: false, error: 'you do not have access to this project\u2019s photos' }, 403);
  }

  const meta = await env.DB.prepare(
    'SELECT id, photo_id, filename, caption, captured_at, uploaded_by, content_type, size_bytes, sort_order, created_at FROM cloud_project_photos WHERE project_id = ? AND photo_id = ? AND deleted_at IS NULL'
  )
    .bind(projectId, photoId)
    .first();
  if (!meta) {
    return json({ ok: false, error: 'photo not found' }, 404);
  }

  return json({
    ok: true,
    photo: {
      id: meta.photo_id,
      filename: meta.filename,
      caption: meta.caption,
      capturedAt: meta.captured_at,
      uploadedBy: meta.uploaded_by,
      contentType: meta.content_type,
      sizeBytes: meta.size_bytes,
      sortOrder: meta.sort_order,
      createdAt: meta.created_at
    }
  });
}
