/* ============================================================
   SEO TEXT FILES - llms.txt and the IndexNow key
   ------------------------------------------------------------
   Both are root-level *.txt files. Three separate mechanisms must
   agree or the file exists on disk and 404s on the internet:
     1. .assetsignore must NEGATE the '*.txt' rule for the file
     2. tools/deploy.cjs COPY_BACK must stage it past the skip rules
     3. worker.js SEO_FILES + PUBLIC_ROOT_FILES must route it
   The 2026-11-24 BingSiteAuth.xml incident proved that a green
   local suite does not catch a missing link in that chain, so this
   test runs in CI from a clean checkout.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEO_FILES, isPrivatePath } from '../worker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEXNOW_KEY = '9eb430e3e584f68c0d737443027b8625';
const INDEXNOW_FILE = path.join(ROOT, INDEXNOW_KEY + '.txt');
const LLMS_FILE = path.join(ROOT, 'llms.txt');

test('llms.txt is committed, plain text, and routed', () => {
  assert.ok(fs.existsSync(LLMS_FILE), 'llms.txt must be committed');
  assert.equal(SEO_FILES['/llms.txt'], 'text/plain; charset=utf-8');
  assert.equal(isPrivatePath('/llms.txt'), false, 'PRIVATE_ROOT_EXT must not 404 llms.txt');
  const body = fs.readFileSync(LLMS_FILE, 'utf8');
  assert.match(body, /^# /, 'llms.txt must open with an H1 title');
  assert.match(body, /https:\/\/mymanagerworkspace\.com\//, 'llms.txt must link the live site');
});

test('IndexNow key file name and body are the same key', () => {
  assert.ok(fs.existsSync(INDEXNOW_FILE), INDEXNOW_KEY + '.txt must be committed');
  assert.equal(
    fs.readFileSync(INDEXNOW_FILE, 'utf8').trim(),
    INDEXNOW_KEY,
    'the key file body must equal the key in its own filename'
  );
  assert.equal(SEO_FILES['/' + INDEXNOW_KEY + '.txt'], 'text/plain; charset=utf-8');
  assert.equal(isPrivatePath('/' + INDEXNOW_KEY + '.txt'), false);
});

test('upload and staging rules let both files through', () => {
  const assets = fs.readFileSync(path.join(ROOT, '.assetsignore'), 'utf8');
  assert.match(assets, /^!llms\.txt$/m, '.assetsignore must negate llms.txt');
  assert.match(
    assets,
    new RegExp('^!' + INDEXNOW_KEY + '\\.txt$', 'm'),
    '.assetsignore must negate the IndexNow key file'
  );
  const deploy = fs.readFileSync(path.join(ROOT, 'tools', 'deploy.cjs'), 'utf8');
  assert.match(deploy, /'llms\.txt'/, 'tools/deploy.cjs COPY_BACK must stage llms.txt');
  assert.match(
    deploy,
    new RegExp("'" + INDEXNOW_KEY + "\\.txt'"),
    'tools/deploy.cjs COPY_BACK must stage the IndexNow key file'
  );
});
