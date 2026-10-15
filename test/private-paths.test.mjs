/* ============================================================
   PRIVATE-PATH GUARD (worker.js 8.4, 2026-10-15)
   ------------------------------------------------------------
   Verifies the guard that stops the backend source tree being
   served, and - more importantly - that it does NOT catch the
   real runtime assets. Both halves matter: a guard that 404s
   /dist/bundle.js would be a worse outage than the leak it fixed.

   Every path in the LEAKED list was observed serving real content
   on the live deployment on 2026-10-15 (200 + application/json,
   text/javascript, etc). Every path in the ASSETS list is loaded
   by a served page.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivatePath } from '../worker.js';

// Observed publicly downloadable on https://mymanagerworkspace.com.
const LEAKED = [
  '/worker.js',
  '/src/router.js',
  '/src/lib/http.js',
  '/src/auth/session.js',
  '/src/billing.js',
  '/src/ai-proxy.js',
  '/src/cloud/projects.js',
  '/src/lib/validate.js',
  '/mcp/server.mjs',
  '/package.json',
  '/wrangler.jsonc',
  '/build.js',
  '/eslint.config.js',
  '/test/billing.test.mjs',
  '/skills-lock.json',
  '/.dev.vars.example'
];

// Also internals, and previously answered 200 + the homepage (SPA fallback).
const ALSO_PRIVATE = [
  '/serve.cjs',
  '/AGENTS.md',
  '/CLAUDE.md',
  '/CONTINUATION-DIRECTIVE.md',
  '/reflection.txt',
  '/docs/DEVELOPER-GUIDE.md',
  '/migrations/0001_cloud_projects.sql',
  '/tools/deploy.cjs',
  '/tools/qa-cloud-phase2.cjs',
  '/.gitleaks.toml',
  '/.github/workflows/ci.yml',
  '/.githooks/commit-msg',
  '/.dev.vars',
  '/.git/config',
  '/_archive/executed-plans/x.md',
  '/node_modules/playwright/index.js',
  '/package-lock.json'
];

// Must keep working, or the app breaks.
const ASSETS = [
  '/',
  '/index',
  '/index.html',
  '/app.html',
  '/project.html',
  '/admin.html',
  '/calculator.html',
  '/pricing.html',
  '/privacy.html',
  '/terms.html',
  '/refund.html',
  '/contact.html',
  '/reviews.html',
  '/signin.html',
  '/reset.html',
  '/verify.html',
  '/seed-test.html',
  '/mymanager-field-guide.html',
  '/about.html',
  '/features.html',
  '/dashboard.html',
  '/dist/bundle.js',
  '/dist/app-bundle.js',
  '/dist/admin-bundle.js',
  '/dist/marketing-bundle.js',
  '/dist/mmgr.min.css',
  '/dist/marketing.min.css',
  '/js/mmgr-state.js',
  '/js/mmgr-ai-key.js',
  '/js/calculator-page.js',
  '/css/mmgr.css',
  '/css/marketing.css',
  '/css/mmgr-icons.svg',
  '/images/mpw-icon.png',
  '/favicon.png',
  '/icon.svg',
  '/manifest.webmanifest',
  '/sw.js',
  '/vendor/whisper/whisper.js',
  '/vendor/three/three.module.js',
  '/demo-data.js',
  '/projects-data.js'
];

test('backend and dev internals are refused', () => {
  const allowed = LEAKED.filter(p => !isPrivatePath(p));
  assert.deepEqual(allowed, [], 'these were publicly downloadable and must be refused');
});

test('every other internal path is refused too', () => {
  const allowed = ALSO_PRIVATE.filter(p => !isPrivatePath(p));
  assert.deepEqual(allowed, [], 'internal paths must not be servable');
});

test('no real runtime asset is caught by the guard', () => {
  const blocked = ASSETS.filter(p => isPrivatePath(p));
  assert.deepEqual(blocked, [], 'these are loaded by served pages and must pass through');
});

test('robots.txt and sitemap.xml stay public on their own merits', () => {
  assert.equal(isPrivatePath('/robots.txt'), false);
  assert.equal(isPrivatePath('/sitemap.xml'), false);
});

test('a root-level dev file added later is caught without editing a list', () => {
  assert.equal(isPrivatePath('/SOME-NEW-NOTES.md'), true);
  assert.equal(isPrivatePath('/new-tool.cjs'), true);
  assert.equal(isPrivatePath('/new-config.yml'), true);
});

test('nested paths are never caught by the root-extension rule', () => {
  // /dist/*.json and similar real nested assets must not be swept up.
  assert.equal(isPrivatePath('/dist/assets.json'), false);
  assert.equal(isPrivatePath('/js/some-data.json'), false);
});

test('traversal-normalised forms are still refused', () => {
  // worker.js normalises before calling, so these are the shapes that reach it.
  assert.equal(isPrivatePath('/src/router.js'), true);
  assert.equal(isPrivatePath('/a/../src/router.js'), false, 'raw form is normalised upstream');
});
