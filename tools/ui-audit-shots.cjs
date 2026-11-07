// I-0 UI audit screenshot capture.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.MMGR_BASE || 'http://127.0.0.1:8799';
const OUT = path.join(__dirname, 'shots', 'ui-audit');
const WIDTHS = [390, 768, 1280, 1920];

const PAGES = [
  ['landing', '/index.html'],
  ['signin', '/signin.html'],
  ['pricing', '/pricing.html'],
  ['features', '/features.html'],
  ['about', '/about.html'],
  ['calculator', '/calculator.html'],
  ['app-shell', '/app.html'],
  ['project-dashboard', '/project.html']
];

// Pages we also want a full-page capture of (to read lower sections).
const FULL = new Set(['landing', 'project-dashboard']);

const CONSENT = JSON.stringify({ v: 1, iv: 3, analytics: false, ts: new Date().toISOString() });

(async () => {
  const browser = await chromium.launch();
  let total = 0;
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: Math.round(w * 0.7) },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      prefersReducedMotion: 'no-preference'
    });
    // Accept cookies before any page script runs so the banner never covers UI.
    await ctx.addInitScript(c => {
      try {
        localStorage.setItem('mmgr_consent', c);
      } catch (e) {}
    }, CONSENT);
    const page = await ctx.newPage();
    for (const [name, url] of PAGES) {
      const file = path.join(OUT, `${name}-${w}.png`);
      try {
        await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 20000 });
        await page.waitForTimeout(900);
        await page.screenshot({ path: file, fullPage: false });
        total++;
        if (FULL.has(name)) {
          const full = path.join(OUT, `${name}-${w}-full.png`);
          await page.screenshot({ path: full, fullPage: true });
          total++;
        }
        console.log('OK', name, w);
      } catch (e) {
        console.log('FAIL', name, w, e.message);
      }
    }
    await ctx.close();
  }
  await browser.close();
  console.log('TOTAL', total);
})();
