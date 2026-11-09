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

   Upload: owner + editors only, AND the project must be covered by an active
   paid subscription (W10, owner 2026-10-15) - see photoUploadPaid() below.
   View list / single photo: owner, editor, viewer, client (read-only through
   the client-code section grant), adoption, team member with read access.
   Delete: owner + editors only.

   Blobs: R2 prefix photos/<project_id>/<photo_id>.<ext>
   Metadata: cloud_project_photos (migration 0025)
   ============================================================ */

import {
  json,
  cloudForbidden,
  cloudProjectDeleted,
  cloudTimingSink,
  readSession
} from '../lib/http.js';
import { billingConfigured, billingStatusActive } from '../billing.js';
import { trackEvent } from '../lib/observe.js';

// Shared access gate used by upload / list / single / delete. Kept in one
// place so the timing-safe auth path is not duplicated across handlers.

const PHOTO_R2_PREFIX = 'photos/';
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB per photo
const MAX_PHOTOS_PER_PROJECT = 200; // soft cap, enforced at upload

// B11 (5.7): 500 MB per ACCOUNT, not per project. The account is the paying
// identity the photos are billed against: the project owner's google_sub when
// the project came from a signed-in account, and the project itself when it
// did not (a code-created project has no account to sum). Summing per project
// would let one account fill R2 through project after project, which is
// exactly the hole the paid gate exists to close.
const PHOTO_ACCOUNT_QUOTA_BYTES = 500 * 1024 * 1024;
const PHOTO_STAGES = new Set(['', 'before', 'after', 'progress']);
// I-12: a bundle is a client-generated id shared by every photo in one
// selection. The id is scoped by project_id in every query, so a collision
// across projects is harmless; the shape check only keeps it safe to put in a
// URL and a D1 column.
const BUNDLE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const PHOTO_UPGRADE_SENTENCE =
  'Project photos are part of every paid plan, Estimator included. Upgrade to add photos to this project.';
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

// ---- SEC-04 (audit 2026-11-01): the stored type must be TRUE --------------
// File.type is attacker-controlled, so a renamed HTML file can claim
// image/jpeg. Read the first bytes and require a real image signature; store
// the SNIFFED type, never the claim. EXIF is stripped before the blob reaches
// R2 so job-site GPS coordinates do not travel in every photo (owner decision:
// strip).
function asciiAt(bytes, offset, len) {
  let s = '';
  for (let i = 0; i < len; i++) {
    const b = bytes[offset + i];
    if (b === undefined) {
      return '';
    }
    s += String.fromCharCode(b);
  }
  return s;
}

export function sniffImageType(head) {
  const b = head || new Uint8Array(0);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (b.length >= 12 && asciiAt(b, 0, 4) === 'RIFF' && asciiAt(b, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  if (b.length >= 6) {
    const sig = asciiAt(b, 0, 6);
    if (sig === 'GIF87a' || sig === 'GIF89a') {
      return 'image/gif';
    }
  }
  if (b.length >= 12 && asciiAt(b, 4, 4) === 'ftyp') {
    const brand = asciiAt(b, 8, 4);
    if (brand === 'avif' || brand === 'avis') {
      return 'image/avif';
    }
  }
  return '';
}

// A real image can still carry markup after its signature (a polyglot). Reject
// anything whose first kilobyte reads like a document or a script.
export function looksLikeMarkup(bytes) {
  const head = asciiAt(bytes, 0, Math.min(1024, bytes.length)).toLowerCase();
  return (
    head.indexOf('<script') > -1 ||
    head.indexOf('<html') > -1 ||
    head.indexOf('<?php') > -1 ||
    head.indexOf('<svg') > -1
  );
}

function stripJpegExif(bytes) {
  const n = bytes.length;
  const out = [bytes[0], bytes[1]];
  let i = 2;
  while (i < n) {
    if (bytes[i] !== 0xff) {
      for (let k = i; k < n; k++) out.push(bytes[k]);
      break;
    }
    const marker = bytes[i + 1];
    if (marker === undefined) break;
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      out.push(0xff, marker);
      i += 2;
      if (marker === 0xd9) break;
      continue;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > n) {
      for (let k = i; k < n; k++) out.push(bytes[k]);
      break;
    }
    const segEnd = i + 2 + len;
    const isExif =
      marker === 0xe1 &&
      asciiAt(bytes, i + 4, 4) === 'Exif' &&
      bytes[i + 8] === 0 &&
      bytes[i + 9] === 0;
    if (!isExif) {
      for (let k = i; k < segEnd; k++) out.push(bytes[k]);
    }
    i = segEnd;
    if (marker === 0xda) {
      for (let k = i; k < n; k++) out.push(bytes[k]);
      break;
    }
  }
  return Uint8Array.from(out);
}

function stripPngExif(bytes) {
  const n = bytes.length;
  const out = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  let i = 8;
  while (i + 12 <= n) {
    const len =
      ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    const type = asciiAt(bytes, i + 4, 4);
    const chunkEnd = i + 12 + len;
    if (chunkEnd > n) break;
    if (type !== 'eXIf') {
      for (let k = i; k < chunkEnd; k++) out.push(bytes[k]);
    }
    i = chunkEnd;
    if (type === 'IEND') break;
  }
  return Uint8Array.from(out);
}

function stripWebpExif(bytes) {
  const n = bytes.length;
  if (n < 12) return bytes;
  const out = [];
  for (let k = 0; k < 12; k++) out.push(bytes[k]);
  let i = 12;
  while (i + 8 <= n) {
    const fourcc = asciiAt(bytes, i, 4);
    const size =
      (bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24)) >>> 0;
    const chunkEnd = i + 8 + size + (size % 2);
    if (chunkEnd > n) break;
    if (fourcc !== 'EXIF' && fourcc !== 'XMP ') {
      for (let k = i; k < chunkEnd; k++) out.push(bytes[k]);
    }
    i = chunkEnd;
  }
  const result = Uint8Array.from(out);
  const total = result.length - 8;
  result[4] = total & 0xff;
  result[5] = (total >>> 8) & 0xff;
  result[6] = (total >>> 16) & 0xff;
  result[7] = (total >>> 24) & 0xff;
  return result;
}

export function stripExif(type, bytes) {
  try {
    if (type === 'image/jpeg') return stripJpegExif(bytes);
    if (type === 'image/png') return stripPngExif(bytes);
    if (type === 'image/webp') return stripWebpExif(bytes);
  } catch (e) {
    // A malformed container must not become a 500; the signature already
    // proved the header, so fall back to the original bytes.
  }
  return bytes;
}

function photoR2Key(projectId, photoId, ext) {
  return PHOTO_R2_PREFIX + projectId + '/' + photoId + ext;
}

function rolesWithUpload(role) {
  return role === 'owner' || role === 'editor';
}

// Human-readable uploader identity, stored as name + role (B11: "uploader
// identity (name and role of whoever uploaded, including a scoped editor
// code's name)"). The label is the name the credential carries: a code's own
// label, the signed-in account's Google name, or the project owner's label.
function uploaderIdentity(access, proj) {
  const role = access.role === 'owner' ? 'Owner' : 'Editor';
  let name = String(access.label || '').trim();
  if (!name && access.role === 'owner' && proj) {
    name = String(proj.google_name || proj.owner_label || '').trim();
  }
  if (!name) {
    name = role;
  }
  return { name: name.slice(0, 120), role: role };
}

function rolesWithView(role) {
  return role === 'owner' || role === 'editor' || role === 'view' || role === 'client';
}

// ---- W10 (owner 2026-10-15): uploading is a PAID feature ------------------
// A photo writes bytes to R2, so a free account must not be able to fill the
// bucket. Two accounts can legitimately pay for one upload and EITHER is
// enough:
//   1. the project OWNER's account (cloud_projects.google_sub - the same
//      identity namespace as cloud_subscriptions.owner_sub, see migration
//      0007) - an editor or a client-code holder is spending storage the
//      owner bought, so the owner's plan covers them;
//   2. the uploader's OWN signed-in account - the owner's instruction was
//      "whoever is uploading ... has a subscription".
// With no billing subject at all (a project created while signed out, and no
// session on this request) the upload is REFUSED: there is no account to bill,
// which is precisely the hole a free tier would drive through.
//
// Dormant without billing, like every other entitlement check in this codebase
// (handleCloudCreate's free cap): with no Paddle secrets configured the gate
// changes nothing.
//
// Fail-closed on a database error, matching poolIsPaid in src/ai-proxy.js:
// the whole point of the check is to protect a finite paid resource, so an
// unreadable ledger must never read as "paid".
async function photoUploadPaid(env, proj, request) {
  if (!billingConfigured(env)) {
    return true;
  }
  const subjects = [];
  if (proj && proj.google_sub) {
    subjects.push(String(proj.google_sub));
  }
  if (request) {
    try {
      const session = await readSession(request, env);
      if (session && session.sub) {
        subjects.push(String(session.sub));
      }
    } catch (e) {
      /* no readable session - the owner's own account alone decides */
    }
  }
  if (!subjects.length) {
    return false;
  }
  for (let i = 0; i < subjects.length; i++) {
    try {
      const row = await env.DB.prepare('SELECT status FROM cloud_subscriptions WHERE owner_sub = ?')
        .bind(subjects[i])
        .first();
      if (row && billingStatusActive(row.status)) {
        return true;
      }
    } catch (e) {
      /* try the next subject before giving up */
    }
  }
  return false;
}

// ---- quota ---------------------------------------------------------------
// Used bytes for the ACCOUNT that pays for this project's photos. One query
// either way: joined on google_sub when the project has one, scoped to the
// project when it does not. Deleted photos stop counting the moment they are
// soft-deleted, because the row is what the bar and the cap read.
async function photoUsage(env, proj, projectId) {
  const subject = proj && proj.google_sub ? String(proj.google_sub) : '';
  let row = null;
  if (subject) {
    row = await env.DB.prepare(
      'SELECT COALESCE(SUM(p.size_bytes),0) AS used, COUNT(*) AS photos FROM cloud_project_photos p JOIN cloud_projects c ON c.project_id = p.project_id WHERE p.deleted_at IS NULL AND c.google_sub = ?'
    )
      .bind(subject)
      .first();
  } else {
    row = await env.DB.prepare(
      'SELECT COALESCE(SUM(size_bytes),0) AS used, COUNT(*) AS photos FROM cloud_project_photos WHERE project_id = ? AND deleted_at IS NULL'
    )
      .bind(projectId)
      .first();
  }
  const usedBytes = Number(row && row.used) || 0;
  const photos = Number(row && row.photos) || 0;
  const limitBytes = PHOTO_ACCOUNT_QUOTA_BYTES;
  return {
    usedBytes: usedBytes,
    limitBytes: limitBytes,
    remainingBytes: Math.max(0, limitBytes - usedBytes),
    photos: photos,
    accountScoped: !!subject
  };
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

  // W10: paid feature. Deliberately AFTER the role check (an unauthenticated
  // caller still gets the same plain 403 as before and learns nothing about
  // billing) and BEFORE the body is read (a refused upload never parses a
  // multipart payload it is not going to store).
  if (!(await photoUploadPaid(env, proj, request))) {
    return json(
      {
        ok: false,
        code: 'upgrade_required',
        upgrade: true,
        error: PHOTO_UPGRADE_SENTENCE
      },
      402
    );
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
  // SEC-04: the bytes must match the claim. Read the signature and reject a
  // mismatch (a renamed HTML file, or a polyglot that carries markup after a
  // real image header), then store the SNIFFED type and strip EXIF.
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniffed = sniffImageType(head);
  if (!sniffed || sniffed !== type) {
    return json({ ok: false, error: 'that file type is not accepted here' }, 400);
  }
  const originalBytes = new Uint8Array(await file.arrayBuffer());
  if (looksLikeMarkup(originalBytes)) {
    return json({ ok: false, error: 'that file type is not accepted here' }, 400);
  }
  const storedBytes = stripExif(sniffed, originalBytes);
  const storedType = sniffed;
  const storedSize = storedBytes.byteLength;
  const ext = extForContentType(storedType);
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
        error: 'this project already has the most photos it can hold , delete an older photo first'
      },
      413
    );
  }

  // B11 quota: 500 MB per account. Checked BEFORE the metadata row and the R2
  // write, so a refused upload leaves neither behind. The numbers travel with
  // the refusal so the panel can paint the bar it already shows at the truth.
  const usage = await photoUsage(env, proj, projectId);
  if (usage.usedBytes + storedSize > usage.limitBytes) {
    return json(
      {
        ok: false,
        code: 'quota_exceeded',
        upgrade: true,
        error:
          'this account has used its 500 MB of photo storage , delete a photo to free space, or upgrade for more',
        usage: usage
      },
      413
    );
  }

  // Build the photo metadata.
  const photoId = crypto.randomUUID();
  const caption = String(formData.get('caption') || '')
    .slice(0, 200)
    .trim();
  const capturedAt = String(formData.get('capturedAt') || '')
    .slice(0, 32)
    .trim();
  const stageRaw = String(formData.get('stage') || '')
    .trim()
    .toLowerCase();
  const stage = PHOTO_STAGES.has(stageRaw) ? stageRaw : '';
  // I-12: one description for the whole selection. The UI sends the same
  // bundleId and bundleCaption with every file in the set; an upload without
  // them is an individual photo, exactly as before.
  const bundleRaw = String(formData.get('bundleId') || '').trim();
  if (bundleRaw && !BUNDLE_ID_RE.test(bundleRaw)) {
    return json({ ok: false, error: 'that photo bundle is not valid' }, 400);
  }
  const bundleId = bundleRaw;
  const bundleCaption = bundleId
    ? String(formData.get('bundleCaption') || caption || '')
        .slice(0, 200)
        .trim()
    : '';
  // Name AND role, both resolved server-side: the browser is never trusted to
  // say who uploaded a photo, and a scoped editor code's label is the only
  // name that code has.
  const who = uploaderIdentity(access, proj);
  const uploadedBy = who.name;
  const uploadedRole = who.role;

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
      'INSERT INTO cloud_project_photos (project_id, photo_id, filename, caption, captured_at, uploaded_by, uploaded_role, stage, bundle_id, bundle_caption, content_type, size_bytes, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    )
      .bind(
        projectId,
        photoId,
        file.name.slice(0, 255),
        caption,
        capturedAt,
        uploadedBy,
        uploadedRole,
        stage,
        bundleId,
        bundleCaption,
        storedType,
        storedSize,
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
    await env.R2.put(r2Key, storedBytes, {
      httpMetadata: { contentType: storedType }
    });
  } catch (e) {
    // Best-effort cleanup of the metadata row we just wrote.
    try {
      await env.DB.prepare('DELETE FROM cloud_project_photos WHERE id = ?').bind(metaId).run();
    } catch (_) {}
    return json({ ok: false, error: 'could not store this photo — try again' }, 500);
  }

  const meta = await env.DB.prepare(
    'SELECT id, photo_id, filename, caption, captured_at, uploaded_by, uploaded_role, stage, bundle_id, bundle_caption, content_type, size_bytes, sort_order, created_at FROM cloud_project_photos WHERE id = ?'
  )
    .bind(metaId)
    .first();

  // B (2026-11-09): one identifier-free product event per stored photo. The
  // project id, photo id and filename never reach the data point.
  trackEvent(env, 'photo_uploaded', {}, request);
  return json({
    ok: true,
    photo: {
      id: meta.photo_id,
      filename: meta.filename,
      caption: meta.caption,
      capturedAt: meta.captured_at,
      uploadedBy: meta.uploaded_by,
      uploadedRole: meta.uploaded_role,
      stage: meta.stage,
      bundleId: meta.bundle_id || '',
      bundleCaption: meta.bundle_caption || '',
      contentType: meta.content_type,
      sizeBytes: meta.size_bytes,
      sortOrder: meta.sort_order,
      createdAt: meta.created_at
    },
    usage: await photoUsage(env, proj, projectId)
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
    'SELECT id, photo_id, filename, caption, captured_at, uploaded_by, uploaded_role, stage, bundle_id, bundle_caption, content_type, size_bytes, sort_order, created_at FROM cloud_project_photos WHERE project_id = ? AND deleted_at IS NULL ORDER BY sort_order DESC, created_at DESC'
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
      uploadedRole: r.uploaded_role || '',
      stage: r.stage || '',
      bundleId: r.bundle_id || '',
      bundleCaption: r.bundle_caption || '',
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

  // The panel needs the quota bar on the same round trip as the list: one
  // request per render, and the bar can never disagree with the rows it sits
  // above. roleCanUpload mirrors the server's role rule so the button is
  // never offered to a role the upload path would refuse; canUpload adds the
  // paid-plan rule, and upgradeRequired is the honest free-account state the
  // panel turns into an upgrade card instead of a dead click.
  const roleCanUpload = rolesWithUpload(access.role);
  const paid = roleCanUpload ? await photoUploadPaid(env, proj, request) : false;
  return json({
    ok: true,
    photos: photos,
    role: access.role,
    roleCanUpload: roleCanUpload,
    canUpload: roleCanUpload && paid,
    upgradeRequired: roleCanUpload && !paid,
    upgradeMessage: roleCanUpload && !paid ? PHOTO_UPGRADE_SENTENCE : '',
    usage: await photoUsage(env, proj, projectId)
  });
}

// ---- usage (quota bar; no rows, no blob reads) ----

export async function handlePhotoUsage(request, env, projectId) {
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

  const roleCanUpload = rolesWithUpload(access.role);
  const paid = roleCanUpload ? await photoUploadPaid(env, proj, request) : false;
  return json({
    ok: true,
    role: access.role,
    roleCanUpload: roleCanUpload,
    canUpload: roleCanUpload && paid,
    upgradeRequired: roleCanUpload && !paid,
    upgradeMessage: roleCanUpload && !paid ? PHOTO_UPGRADE_SENTENCE : '',
    usage: await photoUsage(env, proj, projectId)
  });
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
    'SELECT id, photo_id, filename, caption, captured_at, uploaded_by, uploaded_role, stage, content_type, size_bytes, sort_order, created_at FROM cloud_project_photos WHERE project_id = ? AND photo_id = ? AND deleted_at IS NULL'
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

  // ?download=1 turns the same authorised read into a saved file. The panel's
  // Download button cannot rely on the browser's own <a download>: a code
  // session authenticates with a header, which a plain link cannot send, so
  // the panel fetches the blob and saves it itself. This flag exists so the
  // filename and disposition are the SERVER's, not the page's guess.
  const wantsDownload = new URL(request.url).searchParams.get('download') === '1';
  const safeName = meta.filename.replace(/"/g, '');

  const body = await obj.arrayBuffer();
  return new Response(body, {
    headers: {
      'Content-Type': meta.content_type,
      'Content-Length': String(meta.size_bytes),
      'Cache-Control': 'public, max-age=86400, immutable',
      // SEC-04: even a byte-perfect image cannot act as a document. The
      // sandbox CSP plus nosniff keeps a stored photo inert if it is ever
      // opened directly.
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition':
        (wantsDownload ? 'attachment' : 'inline') + '; filename="' + safeName + '"'
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
    'SELECT id, photo_id, filename, caption, captured_at, uploaded_by, uploaded_role, stage, bundle_id, bundle_caption, content_type, size_bytes, sort_order, created_at FROM cloud_project_photos WHERE project_id = ? AND photo_id = ? AND deleted_at IS NULL'
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
      uploadedRole: meta.uploaded_role || '',
      stage: meta.stage || '',
      bundleId: meta.bundle_id || '',
      bundleCaption: meta.bundle_caption || '',
      contentType: meta.content_type,
      sizeBytes: meta.size_bytes,
      sortOrder: meta.sort_order,
      createdAt: meta.created_at
    }
  });
}

// ---- bundle edit / delete (I-12) -----------------------------------------
// A bundle has no row of its own: every photo carries the same bundle_id and
// bundle_caption. Editing therefore updates the set in one statement, and
// deleting soft-deletes the set first (so a retry is idempotent) then removes
// each blob best-effort, exactly like a single-photo delete.

async function resolveUploadable(request, env, projectId) {
  const proj = await projectRow(env, projectId);
  if (!proj) {
    return { error: cloudForbidden() };
  }
  if (proj.deleted_at) {
    return { error: cloudProjectDeleted() };
  }
  const access = await resolvePhotoAccess(request, env, projectId);
  if (!access.ok) {
    if (access.ok === 'expired') {
      return {
        error: json({ ok: false, error: 'code_expired', expiresAt: access.expiresAt }, 403)
      };
    }
    if (access.ok === 'revoked' || access.ok === 'deleted') {
      return { error: cloudForbidden() };
    }
    await cloudTimingSink();
    return { error: cloudForbidden() };
  }
  if (!rolesWithUpload(access.role)) {
    return {
      error: json(
        { ok: false, error: 'only the project owner or an editor can change photo bundles' },
        403
      )
    };
  }
  return { proj: proj, access: access };
}

export async function handlePhotoBundleUpdate(request, env, projectId, bundleId) {
  if (!BUNDLE_ID_RE.test(bundleId)) {
    return json({ ok: false, error: 'bundle not found' }, 404);
  }
  const gate = await resolveUploadable(request, env, projectId);
  if (gate.error) {
    return gate.error;
  }
  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    /* an empty body clears the description, which is a valid edit */
  }
  const caption = String((body && body.caption) || '')
    .slice(0, 200)
    .trim();
  const res = await env.DB.prepare(
    'UPDATE cloud_project_photos SET bundle_caption = ? WHERE project_id = ? AND bundle_id = ? AND deleted_at IS NULL'
  )
    .bind(caption, projectId, bundleId)
    .run();
  const changed = Number(res && res.meta && res.meta.changes) || 0;
  if (!changed) {
    return json({ ok: false, error: 'bundle not found' }, 404);
  }
  return json({ ok: true, bundleId: bundleId, caption: caption, photos: changed });
}

export async function handlePhotoBundleDelete(request, env, projectId, bundleId) {
  if (!BUNDLE_ID_RE.test(bundleId)) {
    return json({ ok: false, error: 'bundle not found' }, 404);
  }
  const gate = await resolveUploadable(request, env, projectId);
  if (gate.error) {
    return gate.error;
  }
  const rows = await env.DB.prepare(
    'SELECT id, photo_id, content_type FROM cloud_project_photos WHERE project_id = ? AND bundle_id = ? AND deleted_at IS NULL'
  )
    .bind(projectId, bundleId)
    .all();
  const list = (rows && rows.results) || [];
  if (!list.length) {
    return json({ ok: false, error: 'bundle not found' }, 404);
  }
  const now = new Date().toISOString();
  await env.DB.prepare(
    'UPDATE cloud_project_photos SET deleted_at = ? WHERE project_id = ? AND bundle_id = ? AND deleted_at IS NULL'
  )
    .bind(now, projectId, bundleId)
    .run();
  for (let i = 0; i < list.length; i++) {
    const ext = extForContentType(list[i].content_type);
    if (!ext) {
      continue;
    }
    try {
      await env.R2.delete(photoR2Key(projectId, list[i].photo_id, ext));
    } catch (e) {
      /* best-effort, matching the single-photo delete */
    }
  }
  return json({ ok: true, deleted: bundleId, photos: list.length, deletedAt: now });
}
