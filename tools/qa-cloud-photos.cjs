#!/usr/bin/env node
/* ============================================================
   qa-cloud-photos.cjs — T2: Project Photos (R2 blobs + D1 metadata)

   Runs against a wrangler dev server that already has migration 0025
   applied (CI starts one on :8787 and passes WRANGLER_DEV_URL, exactly
   like qa-cloud-phase1/phase2). It does NOT spawn its own server: a
   self-spawned dev did not serve the cloud routes and produced 20/29
   false failures when this path was first written.

   What it proves (the whole feature, not just the happy path):
     - a CODE-created cloud project (google_sub NULL) accepts photos
       while billing is dormant. This is the regression that mattered:
       the upload gate must key on the cloud_projects ROW, not on a
       linked Google account.
     - W10 (owner 2026-10-15): with billing configured, that same
       project has no paying account behind it, so its upload is
       refused 402 upgrade_required instead of silently filling R2.
       The harness branches on the response, so both contracts are
       asserted against the deployment that actually applies.
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

// The Worker keys its rate limiter on CF-Connecting-IP (src/lib/http.js). In
// production every client has its own address, but every suite in CI's T2
// chain reaches this one local server from 127.0.0.1, so phase1+phase2 spend
// the shared 30-per-minute budget and the viewer checks here answered 429
// instead of the 403 they assert. A TEST-NET-3 address (RFC 5737, never
// routed) gives this suite its own budget without switching any limit off -
// the same seam tools/qa-team-ui.cjs already uses.
const QA_IP = '203.0.113.13';
const _realFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const o = Object.assign({}, init || {});
  const h = new Headers(o.headers || undefined);
  if (!h.has('CF-Connecting-IP')) {
    h.set('CF-Connecting-IP', QA_IP);
  }
  o.headers = h;
  return _realFetch.call(globalThis, input, o);
};

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
  form.append('stage', 'before');
  form.append('capturedAt', '2026-11-05');
  res = await fetch(BASE + '/api/cloud/projects/' + pid + '/photos', {
    method: 'POST',
    headers: auth,
    body: form
  });
  data = await res.json().catch(function () {
    return {};
  });

  // W10 (owner 2026-10-15) REBASELINE. Uploading is now a PAID feature, and
  // this fixture is deliberately the case with no paying account behind it:
  // the project was created with no session, so cloud_projects.google_sub is
  // NULL, and the request carries only an owner code, so there is no session
  // on the upload either. There is therefore nobody to bill.
  //
  // Two deployments are legitimate and this branch proves the RIGHT one for
  // whichever it is talking to:
  //   billing NOT configured (CI, and any dev without Paddle secrets in
  //     .dev.vars) -> the gate is dormant, the upload must succeed and the
  //     full round trip below runs, exactly as before W10;
  //   billing configured -> the upload must be refused 402 upgrade_required,
  //     which is the new contract, and the round trip cannot be exercised
  //     against a fixture that has no account to pay for it.
  // Detection is the response itself, because /api/billing/status is
  // session-gated (403 anonymously) and could not be used to ask.
  const refusedForBilling = res.status === 402 && data.code === 'upgrade_required';

  if (refusedForBilling) {
    ok(
      'paid gate refuses an upload with no paying account (402 upgrade_required)',
      data.upgrade === true && /paid plan/.test(String(data.error || '')),
      res.status + '|' + JSON.stringify(data).slice(0, 200)
    );
    console.log(
      TAG +
        ' SKIP  upload/list/view/delete round trip - unreachable while billing is configured (the fixture has no subscription)'
    );
    return report();
  }

  const photoId = data.photo && data.photo.id;
  ok(
    'owner uploads a photo',
    res.status === 200 && data.ok === true && !!photoId,
    res.status + '|' + JSON.stringify(data).slice(0, 200)
  );

  // B11 (5.7): the uploader's identity is resolved SERVER-side (never sent by
  // the browser) and travels back on the photo so the panel can print it.
  ok(
    'the upload carries the owner identity and the stage it was given',
    !!data.photo &&
      data.photo.uploadedRole === 'Owner' &&
      !!data.photo.uploadedBy &&
      data.photo.stage === 'before' &&
      !!data.usage &&
      data.usage.usedBytes === PNG.length &&
      data.usage.limitBytes === 524288000,
    JSON.stringify({ photo: data.photo, usage: data.usage }).slice(0, 240)
  );

  // ---- 4. list shows it, with the caption ----
  res = await fetch(BASE + '/api/cloud/projects/' + pid + '/photos', { headers: auth });
  data = await res.json().catch(function () {
    return {};
  });
  ok(
    'list returns the uploaded photo with its caption, stage and uploader role',
    res.status === 200 &&
      data.ok === true &&
      Array.isArray(data.photos) &&
      data.photos.length === 1 &&
      data.photos[0].caption === 'Foundation pour' &&
      data.photos[0].stage === 'before' &&
      data.photos[0].uploadedRole === 'Owner' &&
      data.canUpload === true &&
      !!data.usage &&
      data.usage.usedBytes === PNG.length,
    JSON.stringify(data).slice(0, 260)
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
    // SEC-04: even a real photo is served inert.
    const csp = res.headers.get('content-security-policy') || '';
    const nosniff = (res.headers.get('x-content-type-options') || '').toLowerCase();
    ok(
      'served photo carries the sandbox CSP and nosniff (SEC-04)',
      /sandbox/.test(csp) && nosniff === 'nosniff',
      csp + '|' + nosniff
    );

    // SEC-04: a renamed HTML file must be refused by content sniffing, not by
    // its (attacker-controlled) Content-Type claim.
    const fakeForm = new FormData();
    fakeForm.append(
      'file',
      new Blob(['<!DOCTYPE html><script>alert(1)</script>'], { type: 'image/jpeg' }),
      'evil.jpg'
    );
    res = await fetch(BASE + '/api/cloud/projects/' + pid + '/photos', {
      method: 'POST',
      headers: auth,
      body: fakeForm
    });
    ok('a renamed HTML file is refused (SEC-04 sniffing)', res.status === 400, res.status);

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

    // ---- 7b. the quota endpoint the panel's bar reads ----
    res = await fetch(BASE + '/api/cloud/projects/' + pid + '/photos/usage', {
      headers: auth
    });
    data = await res.json().catch(function () {
      return {};
    });
    ok(
      'the usage endpoint reports the account quota and its used bytes',
      res.status === 200 &&
        data.ok === true &&
        !!data.usage &&
        data.usage.usedBytes === PNG.length &&
        data.usage.limitBytes === 524288000 &&
        data.usage.photos === 1 &&
        data.canUpload === true,
      res.status + '|' + JSON.stringify(data).slice(0, 200)
    );

    // ---- 7c. download disposition is the server's, not the page's ----
    res = await fetch(BASE + '/api/cloud/projects/' + pid + '/photos/' + photoId, {
      headers: auth
    });
    const inlineCd = res.headers.get('content-disposition') || '';
    try {
      await res.arrayBuffer();
    } catch (e) {
      /* drain */
    }
    res = await fetch(BASE + '/api/cloud/projects/' + pid + '/photos/' + photoId + '?download=1', {
      headers: auth
    });
    const attachCd = res.headers.get('content-disposition') || '';
    let dlLen = -1;
    try {
      dlLen = Buffer.from(await res.arrayBuffer()).length;
    } catch (e) {
      dlLen = -1;
    }
    ok(
      'the plain URL is inline and ?download=1 is an attachment with the same bytes',
      /^inline;/.test(inlineCd) &&
        /^attachment;/.test(attachCd) &&
        /filename="site\.png"/.test(attachCd) &&
        dlLen === PNG.length,
      { inline: inlineCd, attachment: attachCd, bytes: dlLen }
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

  // ---- 10b. an editor upload is stamped with ITS label, not the owner's ----
  res = await fetch(BASE + '/api/cloud/projects/' + pid + '/editors', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
    body: JSON.stringify({ label: 'QA Editor', role: 'editor', scope: ['photos'] })
  });
  data = await res.json().catch(function () {
    return {};
  });
  const editorCode = data.editorCode || data.code || (data.editor && data.editor.code);
  if (editorCode) {
    const eForm = new FormData();
    eForm.append('file', new Blob([PNG], { type: 'image/png' }), 'editor.png');
    eForm.append('caption', 'Editor shot');
    eForm.append('stage', 'after');
    res = await fetch(BASE + '/api/cloud/projects/' + pid + '/photos', {
      method: 'POST',
      headers: { 'X-Editor-Code': editorCode },
      body: eForm
    });
    data = await res.json().catch(function () {
      return {};
    });
    const editorPhotoId = data.photo && data.photo.id;
    ok(
      'an editor upload is stamped with the code label and the Editor role',
      res.status === 200 &&
        !!data.photo &&
        data.photo.uploadedBy === 'QA Editor' &&
        data.photo.uploadedRole === 'Editor' &&
        data.photo.stage === 'after' &&
        !!data.usage &&
        data.usage.usedBytes === PNG.length * 2,
      res.status + '|' + JSON.stringify(data).slice(0, 240)
    );
    if (editorPhotoId) {
      res = await fetch(
        BASE + '/api/cloud/projects/' + pid + '/photos/' + editorPhotoId + '/delete',
        { method: 'POST', headers: auth }
      );
      data = await res.json().catch(function () {
        return {};
      });
      ok(
        'the owner can remove the editor photo, returning the quota',
        res.status === 200 && data.ok === true,
        res.status + '|' + JSON.stringify(data).slice(0, 160)
      );
    }
  } else {
    skip(
      'editor upload identity',
      'no editor code returned: ' + JSON.stringify(data).slice(0, 140)
    );
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
