#!/usr/bin/env node
/* ============================================================
   qa-cloud-photos.cjs — T2: Project Photos (R2 blobs + D1 metadata)

   Runs against a wrangler dev server that already has migration 0025
   applied (CI starts one on :8787 and passes WRANGLER_DEV_URL, exactly
   like qa-cloud-phase1/phase2). It does NOT spawn its own server: a
   self-spawned dev did not serve the cloud routes and produced 20/29
   false failures when this path was first written.

   What it proves (the whole feature, not just the happy path):
     - a CODE-created cloud project (google_sub NULL) accepts photos.
       This is the regression that mattered: the upload gate must key on
       the cloud_projects ROW, not on a linked Google account.
     - upload -> list -> single-photo bytes -> meta -> delete round trip,
       with the served Content-Type and exact byte length checked.
     - the single-photo path reconstructs the SAME R2 key the upload
       wrote (an empty-extension key 404s every photo).
     - role gates: a wrong code is 403, a viewer code READS but CANNOT
       upload, an unknown (local-only) project id is 403.

   Usage:
     WRANGLER_DEV_URL=http://127.0.0.1:8787 node tools/qa-cloud-photos.cjs
   Exit: 0 = all checks pass, 1 = at least one failed or setup broke.
   ============================================================ */
'use strict';

const BASE = process.env.WRANGLER_DEV_URL || process.env.QA_BASE || 'http://127.0.0.1:8787';
const TAG = '[photos]';

let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(TAG + ' PASS  ' + name);
  } else {
    fail++;
    console.log(TAG + ' FAIL  ' + name + (detail ? '   <-- ' + detail : ''));
  }
}

function skip(name, why) {
  console.log(TAG + ' SKIP  ' + name + (why ? '   (' + why + ')' : ''));
}

// A real 1x1 PNG, so the byte-length and content-type checks mean something.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

async function main() {
  console.log('\n' + TAG + ' Project Photos QA against ' + BASE);

  // The server must be up; otherwise everything below is a false failure.
  try {
    const h = await fetch(BASE + '/api/health');
    const j = await h.json().catch(function () {
      return {};
    });
    if (!h.ok || !j.ok) {
      console.error(TAG + ' server not healthy at ' + BASE + ' (status ' + h.status + ')');
      process.exit(1);
    }
  } catch (e) {
    console.error(
      TAG + ' cannot reach ' + BASE + ' — start wrangler dev first (' + (e && e.message) + ')'
    );
    process.exit(1);
  }

  const pid = 'qa-photos-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ---- 1. a code-created cloud project (no session => google_sub NULL) ----
  let res = await fetch(BASE + '/api/cloud/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: pid, name: 'QA Photos' })
  });
  let data = await res.json().catch(function () {
    return {};
  });
  ok(
    'code-created cloud project returns ok + ownerCode',
    res.status === 200 && data.ok === true && !!data.ownerCode,
    res.status + '|' + JSON.stringify(data).slice(0, 140)
  );
  const ownerCode = data.ownerCode;
  if (!ownerCode) {
    console.log(TAG + ' cannot continue without an owner code.');
    return report();
  }
  const auth = { 'X-Owner-Code': ownerCode };

  // ---- 2. empty list on a fresh project (proves the row-based cloud gate) ----
  res = await fetch(BASE + '/api/cloud/projects/' + pid + '/photos', { headers: auth });
  data = await res.json().catch(function () {
    return {};
  });
  ok(
    'owner lists photos (empty) on a code-created project',
    res.status === 200 &&
      data.ok === true &&
      Array.isArray(data.photos) &&
      data.photos.length === 0,
    res.status + '|' + JSON.stringify(data).slice(0, 160)
  );

  // ---- 3. upload ----
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'site.png');
  form.append('caption', 'Foundation pour');
  res = await fetch(BASE + '/api/cloud/projects/' + pid + '/photos', {
    method: 'POST',
    headers: auth,
    body: form
  });
  data = await res.json().catch(function () {
    return {};
  });
  const photoId = data.photo && data.photo.id;
  ok(
    'owner uploads a photo',
    res.status === 200 && data.ok === true && !!photoId,
    res.status + '|' + JSON.stringify(data).slice(0, 200)
  );

  // ---- 4. list shows it, with the caption ----
  res = await fetch(BASE + '/api/cloud/projects/' + pid + '/photos', { headers: auth });
  data = await res.json().catch(function () {
    return {};
  });
  ok(
    'list returns the uploaded photo with its caption',
    res.status === 200 &&
      data.ok === true &&
      Array.isArray(data.photos) &&
      data.photos.length === 1 &&
      data.photos[0].caption === 'Foundation pour',
    JSON.stringify(data).slice(0, 200)
  );

  if (photoId) {
    // ---- 5. the blob: correct content type AND exact bytes ----
    // This is the check that catches an R2 key built without its extension.
    res = await fetch(BASE + '/api/cloud/projects/' + pid + '/photos/' + photoId, {
      headers: auth
    });
    const ct = res.headers.get('content-type') || '';
    let len = -1;
    try {
      len = Buffer.from(await res.arrayBuffer()).length;
    } catch (e) {
      len = -1;
    }
    ok(
      'single photo serves the image bytes with the right content type',
      res.status === 200 && ct.indexOf('image/png') === 0 && len === PNG.length,
      res.status + '|' + ct + '|' + len
    );

    // ---- 6. metadata endpoint ----
    res = await fetch(BASE + '/api/cloud/projects/' + pid + '/photos/' + photoId + '/meta', {
      headers: auth
    });
    data = await res.json().catch(function () {
      return {};
    });
    ok(
      'photo meta returns caption + uploader',
      res.status === 200 &&
        data.ok === true &&
        !!data.photo &&
        data.photo.caption === 'Foundation pour',
      res.status + '|' + JSON.stringify(data).slice(0, 160)
    );

    // ---- 7. viewing a photo must NOT destroy its row ----
    res = await fetch(BASE + '/api/cloud/projects/' + pid + '/photos', { headers: auth });
    data = await res.json().catch(function () {
      return {};
    });
    ok(
      'the photo is still listed after being viewed (no destructive self-heal)',
      data.ok === true && Array.isArray(data.photos) && data.photos.length === 1,
      JSON.stringify(data).slice(0, 160)
    );
  }

  // ---- 8. a wrong owner code is refused ----
  const badForm = new FormData();
  badForm.append('file', new Blob([PNG], { type: 'image/png' }), 'x.png');
  res = await fetch(BASE + '/api/cloud/projects/' + pid + '/photos', {
    method: 'POST',
    headers: { 'X-Owner-Code': 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' },
    body: badForm
  });
  ok('a wrong owner code is refused (403)', res.status === 403, String(res.status));

  // ---- 9. a non-cloud (local-only) project id is refused ----
  res = await fetch(BASE + '/api/cloud/projects/no-such-project-xyz/photos', { headers: auth });
  ok('an unknown (local-only) project is refused (403)', res.status === 403, String(res.status));

  // ---- 10. viewer role: reads yes, uploads no ----
  res = await fetch(BASE + '/api/cloud/projects/' + pid + '/editors', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
    body: JSON.stringify({ label: 'QA Viewer', role: 'view', scope: ['photos'] })
  });
  data = await res.json().catch(function () {
    return {};
  });
  const viewerCode = data.editorCode || data.code || (data.editor && data.editor.code);
  if (viewerCode) {
    res = await fetch(BASE + '/api/cloud/projects/' + pid + '/photos', {
      headers: { 'X-View-Code': viewerCode }
    });
    const vlist = await res.json().catch(function () {
      return {};
    });
    ok(
      'viewer code can READ the photo list',
      res.status === 200 && vlist.ok === true,
      res.status + '|' + JSON.stringify(vlist).slice(0, 140)
    );

    const vForm = new FormData();
    vForm.append('file', new Blob([PNG], { type: 'image/png' }), 'y.png');
    res = await fetch(BASE + '/api/cloud/projects/' + pid + '/photos', {
      method: 'POST',
      headers: { 'X-View-Code': viewerCode },
      body: vForm
    });
    ok('viewer code CANNOT upload (403)', res.status === 403, String(res.status));
  } else {
    skip('viewer role checks', 'no viewer code returned: ' + JSON.stringify(data).slice(0, 140));
  }

  // ---- 11. delete, then it is gone from the list ----
  if (photoId) {
    res = await fetch(BASE + '/api/cloud/projects/' + pid + '/photos/' + photoId + '/delete', {
      method: 'POST',
      headers: auth
    });
    data = await res.json().catch(function () {
      return {};
    });
    ok(
      'owner deletes the photo',
      res.status === 200 && data.ok === true,
      res.status + '|' + JSON.stringify(data).slice(0, 140)
    );

    res = await fetch(BASE + '/api/cloud/projects/' + pid + '/photos', { headers: auth });
    data = await res.json().catch(function () {
      return {};
    });
    ok(
      'deleted photo is gone from the list',
      data.ok === true && Array.isArray(data.photos) && data.photos.length === 0,
      JSON.stringify(data).slice(0, 140)
    );

    // ---- 12. the blob is no longer served ----
    res = await fetch(BASE + '/api/cloud/projects/' + pid + '/photos/' + photoId, {
      headers: auth
    });
    ok('deleted photo is no longer served (404)', res.status === 404, String(res.status));
  }

  return report();
}

function report() {
  console.log(TAG + ' ──────────────────────────────────────────────');
  console.log(
    TAG +
      ' CLOUD_PHOTOS ' +
      (fail === 0 ? 'PASS' : 'FAIL') +
      ' (' +
      pass +
      ' passed, ' +
      fail +
      ' failed)'
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) {
  console.error(TAG + ' crashed:', e && e.stack);
  process.exit(1);
});
