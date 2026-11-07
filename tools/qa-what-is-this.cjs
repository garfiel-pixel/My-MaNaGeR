// T-WHAT gate (Wave I, I-13 three "what is this" controls).
//   (a) Pin: both Pin controls are present AND wired to a live handler
//       (the behavioural coverage lives in qa-ai-float F6 and qa-full 70g).
//   (b) the Advanced Packs animation is gone: no canvas, no MMGR.ParticleLine,
//       and no source/CI/registry reference to it.
//   (c) signed out, no "Delete my account" control is visible anywhere - in
//       the launcher (rail Customize accordion) or on any served page.
// Runs against the shared QA server (:8765 by default, MMGR_BASE to override).

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.MMGR_BASE || 'http://127.0.0.1:8765';
const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
const fails = [];
function ok(n) {
  pass++;
  console.log('  PASS', n);
}
function bad(n, d) {
  fail++;
  fails.push(n + ': ' + d);
  console.log('  FAIL', n, '-', d);
}

// ---- (b) static sweep: the removed control leaves no code behind ----------
function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'tmp') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(html|js|css|yml|json|md|cjs)$/.test(name)) out.push(p);
  }
  return out;
}
const TOKENS = ['adv-particle-line', 'ParticleLine', 'qa-particle-line', 'particle-line.js'];
const hits = [];
for (const file of walk(ROOT, [])) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  // History/removal records may name the thing; this gate's own token list is
  // not a live reference either.
  if (rel.startsWith('docs/history/') || rel === 'EXECUTION-PLAN.md') continue;
  if (rel === 'tools/qa-what-is-this.cjs') continue;
  let txt = '';
  try {
    txt = fs.readFileSync(file, 'utf8');
  } catch (e) {
    continue;
  }
  for (const t of TOKENS) {
    if (txt.indexOf(t) > -1) hits.push(rel + ' -> ' + t);
  }
}
if (!hits.length) ok('removed-control-no-references');
else bad('removed-control-no-references', hits.slice(0, 6).join('; '));

const launchOpts = {
  headless: true,
  ...(function () {
    try {
      const cp = require('./chrome-launcher.cjs').chromePath;
      return cp ? { executablePath: cp } : {};
    } catch (e) {
      return {};
    }
  })()
};

(async () => {
  const browser = await chromium.launch(launchOpts);

  // ---- (c) signed out: launcher rail never offers Delete my account ------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('mmgr_theme', 'dark');
      localStorage.setItem('mmgr_rail_nudge', '1');
      localStorage.setItem(
        'mmgr_consent',
        JSON.stringify({ v: 1, iv: 3, analytics: false, ts: new Date().toISOString() })
      );
    } catch (e) {}
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);

  const railHidden = await page.evaluate(() => {
    const b = document.getElementById('del-account-open');
    if (!b) return { exists: false };
    return {
      exists: true,
      hidden: b.hidden,
      display: getComputedStyle(b).display,
      visible: !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length)
    };
  });
  if (railHidden.exists && railHidden.hidden && !railHidden.visible)
    ok('rail-delete-hidden-signed-out');
  else bad('rail-delete-hidden-signed-out', JSON.stringify(railHidden));

  // Open the Customize accordion (where the row lives) and confirm it stays out.
  await page.evaluate(() => {
    const t = document.querySelector('[data-rail-toggle="rail-customize"]');
    if (t) t.click();
  });
  await page.waitForTimeout(250);
  const afterOpen = await page.evaluate(() => {
    const b = document.getElementById('del-account-open');
    if (!b) return { exists: false };
    return { visible: !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length) };
  });
  if (!afterOpen.visible) ok('rail-delete-hidden-when-accordion-open');
  else bad('rail-delete-hidden-when-accordion-open', JSON.stringify(afterOpen));

  // Signed in, the same row must come back: the auth module drives it with
  // the mmgr:user-changed event, so the reveal path is testable without a
  // live server session.
  const revealed = await page.evaluate(() => {
    document.dispatchEvent(
      new CustomEvent('mmgr:user-changed', { detail: { email: 'qa@example.com' } })
    );
    const b = document.getElementById('del-account-open');
    return {
      hidden: b.hidden,
      visible: !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length)
    };
  });
  if (!revealed.hidden && revealed.visible) ok('rail-delete-shown-signed-in');
  else bad('rail-delete-shown-signed-in', JSON.stringify(revealed));

  // ---- (c) every served page: no visible delete-account control ----------
  const pages = [
    'app.html',
    'project.html',
    'index.html',
    'features.html',
    'about.html',
    'contact.html',
    'pricing.html',
    'signin.html',
    'privacy.html',
    'terms.html',
    'refund.html',
    'reviews.html',
    'calculator.html'
  ];
  const offenders = [];
  for (const p of pages) {
    const pg = await ctx.newPage();
    try {
      await pg.goto(BASE + '/' + p, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await pg.waitForTimeout(p === 'app.html' || p === 'project.html' ? 900 : 200);
      const found = await pg.evaluate(() => {
        const re = /delete\s+my\s+account/i;
        const nodes = Array.from(
          document.querySelectorAll('button, a, [role="button"], [data-action]')
        );
        return nodes
          .filter(n => re.test((n.textContent || '').trim()))
          .filter(n => !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length))
          .map(
            n =>
              (n.id || n.getAttribute('data-action') || n.tagName) +
              ':' +
              (n.textContent || '').trim().slice(0, 40)
          );
      });
      if (found.length) offenders.push(p + ' -> ' + found.join(', '));
    } catch (e) {
      offenders.push(p + ' -> load error ' + e.message.split('\n')[0]);
    }
    await pg.close();
  }
  if (!offenders.length) ok('no-visible-delete-anywhere-signed-out');
  else bad('no-visible-delete-anywhere-signed-out', offenders.join(' | '));
  await ctx.close();

  // ---- (a) Pin controls are wired; (b) the animation is gone -------------
  const pctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await pctx.addInitScript(() => {
    try {
      localStorage.setItem('mmgr_theme', 'dark');
      localStorage.setItem(
        'mmgr_consent',
        JSON.stringify({ v: 1, iv: 3, analytics: false, ts: new Date().toISOString() })
      );
    } catch (e) {}
  });
  const ppage = await pctx.newPage();
  // seed-test.html is the QA seam that opens an unlocked workspace; project.html
  // redirects to the launcher when no project is selected.
  await ppage.goto(BASE + '/seed-test.html', { waitUntil: 'networkidle', timeout: 45000 });
  await ppage.waitForFunction(() => window.MMGR && window.MMGR.AiWin, null, { timeout: 45000 });
  await ppage.waitForTimeout(700);

  const wiring = await ppage.evaluate(() => {
    const pin = document.getElementById('ai-pin-btn');
    const digest = document.querySelector('[data-action="digestPin"]');
    return {
      aiPin: !!pin && pin.getAttribute('data-action') === 'aiPinToggle',
      aiHandler: !!(
        window.MMGR &&
        window.MMGR.AiWin &&
        typeof window.MMGR.AiWin.togglePin === 'function'
      ),
      digestPin: !!digest,
      digestHandler: !!(
        window.MMGR &&
        window.MMGR.Digest &&
        typeof window.MMGR.Digest.pin === 'function'
      ),
      canvas: !!document.getElementById('adv-particle-line'),
      ns: !!(window.MMGR && window.MMGR.ParticleLine)
    };
  });
  if (wiring.aiPin && wiring.aiHandler) ok('ai-pin-wired');
  else bad('ai-pin-wired', JSON.stringify(wiring));
  if (wiring.digestPin && wiring.digestHandler) ok('digest-pin-wired');
  else bad('digest-pin-wired', JSON.stringify(wiring));
  if (!wiring.canvas && !wiring.ns) ok('animation-removed');
  else bad('animation-removed', JSON.stringify(wiring));
  await pctx.close();

  await browser.close();
  console.log('\nT-WHAT: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) {
    console.log('FAILURES:\n - ' + fails.join('\n - '));
    process.exit(1);
  }
  console.log('T-WHAT PASS');
})().catch(e => {
  console.error('T-WHAT harness error:', e);
  process.exit(2);
});
