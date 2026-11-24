#!/usr/bin/env node
/* ============================================================
   IndexNow submission - tell Bing (and its partners) what changed.

   WHY THIS EXISTS
   Sitemaps are a hint. IndexNow is a push: one HTTP POST and Bing,
   Yandex, Seznam and Naver fetch the new URLs within minutes instead of
   waiting for the next crawl cycle. Google does NOT participate in
   IndexNow - Google still needs Search Console's "Request indexing" or a
   fresh sitemap read - so this tool is a supplement, never a replacement.

   PRE-FLIGHT
   The key file must already be live at the site root before a ping is
   accepted. This tool verifies that first and refuses to submit otherwise,
   because a 403 from the endpoint looks like "indexing failed" when the
   real cause is a deploy that never uploaded the key file.

   USAGE
     node tools/indexnow.cjs                 # every URL in sitemap.xml
     node tools/indexnow.cjs --dry-run       # print the payload, send nothing
     node tools/indexnow.cjs /pricing /about # only these paths
     SITE=https://example.com node tools/indexnow.cjs
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = (process.env.SITE || 'https://mymanagerworkspace.com').replace(/\/+$/, '');
const KEY = '9eb430e3e584f68c0d737443027b8625';
const KEY_LOCATION = SITE + '/' + KEY + '.txt';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const DRY_RUN = process.argv.includes('--dry-run');

function sitemapUrls() {
  const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1]);
}

function wantedUrls() {
  const args = process.argv.slice(2).filter(a => a && a.charAt(0) !== '-');
  if (!args.length) {
    return sitemapUrls();
  }
  return args.map(a => (a.charAt(0) === '/' ? SITE + a : a));
}

async function assertKeyIsLive() {
  const res = await fetch(KEY_LOCATION, { headers: { 'user-agent': 'mmgr-indexnow/1.0' } });
  if (!res.ok) {
    throw new Error(
      'key file is not live: ' +
        KEY_LOCATION +
        ' answered HTTP ' +
        res.status +
        '. Deploy first - .assetsignore, worker.js SEO_FILES and tools/deploy.cjs' +
        ' COPY_BACK must all list the key file.'
    );
  }
  const body = (await res.text()).trim();
  if (body !== KEY) {
    throw new Error(
      'key file content does not match the key. Expected "' +
        KEY +
        '", got "' +
        body.slice(0, 64) +
        '".'
    );
  }
}

async function main() {
  const urlList = wantedUrls();
  if (!urlList.length) {
    throw new Error('no URLs to submit - sitemap.xml has no <loc> entries');
  }

  const payload = {
    host: new URL(SITE).host,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList
  };

  if (DRY_RUN) {
    console.log('DRY RUN - nothing sent.');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  await assertKeyIsLive();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  });

  // IndexNow answers 200 (accepted) or 202 (accepted, key pending validation).
  // Anything else means the submission was rejected; print the body because the
  // endpoint explains which URL or which key field it objected to.
  if (res.status !== 200 && res.status !== 202) {
    const detail = await res.text().catch(() => '');
    throw new Error('IndexNow rejected the submission: HTTP ' + res.status + ' ' + detail);
  }
  console.log('IndexNow accepted ' + urlList.length + ' URL(s) - HTTP ' + res.status + '.');
  urlList.forEach(u => console.log('  ' + u));
}

main().catch(err => {
  console.error('\nIndexNow submission failed: ' + err.message);
  process.exit(1);
});
