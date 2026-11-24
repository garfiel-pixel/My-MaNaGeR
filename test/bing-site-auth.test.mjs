/* ============================================================
   BING WEBMASTER TOOLS VERIFICATION FILE
   ------------------------------------------------------------
   The 2026-11-24 incident: BingSiteAuth.xml existed in the working
   tree but was untracked, so it never reached the staging copy or
   the asset upload. Live /BingSiteAuth.xml answered 404 on both
   domains while every local check was green. These tests run in
   CI from a clean checkout, so the file must be committed; they
   also pin the Worker route and the XML shape Bing expects.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEO_FILES, isPrivatePath } from '../worker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERIFICATION_FILE = path.join(ROOT, 'BingSiteAuth.xml');

test('BingSiteAuth.xml is present in a clean checkout with a valid auth shape', () => {
  assert.ok(
    fs.existsSync(VERIFICATION_FILE),
    'BingSiteAuth.xml must be committed - an untracked file is never deployed'
  );
  const xml = fs.readFileSync(VERIFICATION_FILE, 'utf8');
  assert.match(xml, /^<\?xml\s+version=["']1\.0["']\s*\?>/, 'XML declaration missing');
  const users = /<users>([\s\S]*?)<\/users>/.exec(xml);
  assert.ok(users, 'a single <users> element is required');
  const tokens = [...users[1].matchAll(/<user>\s*([0-9A-Fa-f]+)\s*<\/user>/g)].map(m => m[1]);
  assert.equal(tokens.length, 1, 'exactly one <user> token is required');
  assert.match(tokens[0], /^[0-9A-Fa-f]{16,64}$/, 'Bing token must be hexadecimal');
});

test('Bing verification route is pinned to XML and stays public', () => {
  assert.equal(SEO_FILES['/BingSiteAuth.xml'], 'application/xml; charset=utf-8');
  assert.equal(isPrivatePath('/BingSiteAuth.xml'), false);
});
