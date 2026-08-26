/* ============================================================
   My MaNaGeR — MARKETING SITE QA (Liquid Glass front door)
   Drives headless Chrome against http://127.0.0.1:8765 and
   verifies every Phase 1 checklist item with evidence:
   - all pages load with ZERO console errors
   - marketing homepage renders every required section
   - nav links + CTAs resolve (no 404s)
   - "Open App" reaches app.html (the relocated app entry)
   - "View Field Guide" reaches mymanager-field-guide.html
   - app.html still renders the project list + unlock modal
   - mobile menu toggles at phone width
   Usage: node qa-marketing.cjs  (server must be running on :8765)
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./tools/chrome-launcher.cjs');
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-qa-mkt-' + Date.now());
let ws, msgId = 0;
const pending = new Map();
const results = [];
let consoleErrors = [];
let pageErrors = [];
const log = (s) => { process.stdout.write(s + '\n'); };
const delay = (ms) => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG TIMEOUT'); try { ws && ws.close(); } catch (e) {} process.exit(2); }, 120000);

function send(method, params) {
  return new Promise(res => {
    const id = ++msgId;
    pending.set(id, m => { pending.delete(id); res(m.result || {}); });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
  return r.result && r.result.value;
}
async function check(name, expr, hint) {
  const v = await ev(expr);
  const ok = !!v && v.__err === undefined && v.val === true;
  results.push({ status: ok ? 'PASS' : 'FAIL', name, detail: v && v.__err ? v.__err : JSON.stringify(v) });
  log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${ok ? '' : '  <-- ' + results[results.length - 1].detail + (hint ? ' (' + hint + ')' : '')}`);
  return v;
}

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) break; } catch (e) {}
    await delay(300);
  }
  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  ws.onmessage = (evt) => {
    const m = JSON.parse(evt.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push((m.params.args || []).map(a => a.value || a.description || '').join(' '));
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || 'exception');
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  await send('Runtime.enable'); await send('Page.enable');

  // ---- 1. Marketing homepage ----
  await send('Page.navigate', { url: BASE + '/index.html' }); await delay(2200);
  consoleErrors = []; pageErrors = [];
  await check('mkt-01 homepage: glass header + brand render', `(function(){
    var h = document.querySelector('.site-header');
    var b = document.querySelector('.brand b');
    return {val: !!h && !!b && /MaNaGeR/.test(b.textContent) && getComputedStyle(h).position === 'sticky'};
  })()`);
  await check('mkt-02 homepage: hero + 2 CTAs', `(function(){
    var hero = document.querySelector('.hero');
    var cta = Array.prototype.slice.call(document.querySelectorAll('.hero-cta a')).map(a => a.textContent.trim());
    return {val: !!hero && cta.indexOf('Get Started') > -1 && cta.indexOf('View Field Guide') > -1};
  })()`);
  await check('mkt-03 homepage: 15 feature cards (solid content layer)', `(function(){
    // The auto-ticking feature bar CLONES the first 5 cards (aria-hidden) for
    // its seamless loop — count only the real (non-clone) cards.
    var cards = Array.prototype.filter.call(document.querySelectorAll('.fcard'), function(c){
      return c.getAttribute('aria-hidden') !== 'true';
    });
    // backdropFilter is the standard property; webkitBackdropFilter may be
    // undefined in some Chrome builds, which is NOT glass.
    var glass = function(el){ var v = getComputedStyle(el).backdropFilter || ''; return v !== '' && v !== 'none'; };
    var glassOnCards = cards.some(glass);
    // CARD-COUNT (2026-08-17): the BLUE-WHITE-UI wave turned the feature grid
    // into a horizontal auto-ticking bar and added SIX real (previously
    // undocumented) features — index.html now ships FIFTEEN distinct .fcard
    // articles (WBS+Gantt, Kanban, RACI, Risk+Monte Carlo, Budget/EVM,
    // Built-In AI, Voice→Notes, Weather-Aware, Offline-First, Health &
    // Portfolio, Meetings & Decisions, Claims & Digests, Registers &
    // Compliance, Bid Leveling & Go/No-Go, Lookahead & Field Metrics). The
    // old 9-count was the pre-2026-08-17 grid; cards must stay SOLID (the
    // owner's reduced-glass rule).
    return {val: cards.length === 15 && !glassOnCards, n: cards.length, glassOnCards: glassOnCards};
  })()`);
  await check('mkt-04 homepage: 4 how-it-works steps', `(function(){var s = document.querySelectorAll('.step');return {val: s.length === 4, n: s.length};})()`);
  await check('mkt-05 homepage: guide teaser band + FAQ + footer', `(function(){
    return {val: !!document.querySelector('.guide-band') && document.querySelectorAll('.faq details').length >= 3 && !!document.querySelector('.site-footer')};
  })()`);
  await check('mkt-06 homepage: header uses real glass (blur applied)', `(function(){
    var h = document.querySelector('.site-header');
    var cs = getComputedStyle(h);
    return {val: cs.backdropFilter.indexOf('blur') > -1 || cs.webkitBackdropFilter.indexOf('blur') > -1};
  })()`);
  await check('mkt-07 homepage: Open App links point at app.html', `(function(){
    var hrefs = Array.prototype.slice.call(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href'));
    return {val: hrefs.some(h => h === 'app.html')};
  })()`);

  // ---- 2. Header "Open App" actually lands on the app entry ----
  await ev(`document.querySelector('.header-cta-desktop a.btn').click()`); await delay(2200);
  await check('mkt-08 open-app: header CTA navigates to app.html (project list)', `(function(){
    return {val: location.pathname.indexOf('app.html') > -1 && document.querySelectorAll('.pcard').length > 0, path: location.pathname, cards: document.querySelectorAll('.pcard').length};
  })()`);

  // ---- 3. Unlock modal still intact on app.html ----
  await ev(`(function(){var c = document.querySelector('.pcard'); if(c) c.click(); return true;})()`); await delay(600);
  await check('mkt-09 app: click project card opens access-code modal', `(function(){
    var om = document.getElementById('om');
    return {val: !!om && om.classList.contains('open') && !!document.getElementById('unlock-btn')};
  })()`);
  await ev(`(function(){var m = document.getElementById('om'); if(m) m.classList.remove('open'); return true;})()`);

  // ---- 4. Inner pages ----
  for (const p of ['about.html', 'features.html', 'contact.html', 'reviews.html']) {
    consoleErrors = [];
    await send('Page.navigate', { url: BASE + '/' + p }); await delay(1600);
    await check('mkt-10 ' + p + ': renders header + hero + footer, zero console errors', `(function(){
      return {val: !!document.querySelector('.site-header') && !!document.querySelector('.page-hero h1') && !!document.querySelector('.site-footer')};
    })()`, 'console errors: ' + JSON.stringify(consoleErrors));
  }

  // ---- 5. Field guide ----
  await send('Page.navigate', { url: BASE + '/mymanager-field-guide.html' }); await delay(2200);
  consoleErrors = [];
  await check('mkt-11 guide: renders + has back-to-site link + Site footer column', `(function(){
    var exit = document.querySelector('.site-exit');
    var cols = Array.prototype.slice.call(document.querySelectorAll('.footer-col b')).map(b => b.textContent);
    return {val: !!exit && exit.getAttribute('href') === 'index.html' && cols.indexOf('Site') > -1};
  })()`);
  await ev(`(function(){var e = document.querySelector('.site-exit'); if(e) e.click(); return true;})()`); await delay(2000);
  await check('mkt-12 guide: back-to-site link returns to index.html', `(function(){return {val: location.pathname.indexOf('index.html') > -1 || location.pathname === '/'};})()`);

  // ---- 6. Mobile menu ----
  await send('Page.navigate', { url: BASE + '/index.html' }); await delay(1800);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await delay(500);
  await check('mkt-13 mobile: hamburger visible at 390px, menu opens on click', `(function(){
    var t = document.getElementById('nav-toggle');
    if (!t || getComputedStyle(t).display === 'none') return {val: false, why: 'toggle hidden'};
    t.click();
    var menu = document.getElementById('mobile-menu');
    var opened = menu && menu.classList.contains('open');
    var overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    return {val: opened && !overflow, opened: opened, overflowX: overflow};
  })()`);

  // ---- 6b. Mobile sign-in (OWNER 2026-08-14: "at the side of the hamburger") ----
  // Still at 390px: the header Sign-in button must sit beside the hamburger,
  // open the shared email-auth sheet within the viewport, and close on Escape
  // with aria-expanded reset. Then the same wiring on the field-guide's
  // mobile-bar (its own Sign-in button beside #menuBtn).
  await check('mkt-16 mobile: header Sign in beside hamburger, sheet opens + Escape closes', `(function(){
    var btn = document.querySelector('.signin-trigger');
    var tog = document.getElementById('nav-toggle');
    var cta = document.querySelector('.header-cta-desktop');
    if (!btn || getComputedStyle(btn).display === 'none') return {val: false, why: 'signin hidden'};
    if (!tog || getComputedStyle(tog).display === 'none') return {val: false, why: 'hamburger hidden'};
    if (!cta || getComputedStyle(cta).display !== 'none') return {val: false, why: 'desktop CTA not hidden'};
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) return {val: false, why: 'horizontal overflow'};
    btn.click();
    var sheet = document.getElementById('signin-sheet');
    var form = document.querySelector('#marketing-email-auth .email-auth-form');
    var toggle = document.querySelector('#marketing-email-auth .email-auth-toggle');
    var inViewport = sheet.getBoundingClientRect().right <= window.innerWidth + 1;
    if (sheet.hidden || !form || form.hidden || !toggle.hidden || !inViewport) {
      return {val: false, why: 'sheet did not open correctly', hidden: sheet.hidden, form: !!form, formHidden: form && form.hidden, toggleHidden: toggle && toggle.hidden, inViewport: inViewport};
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    var closed = sheet.hidden && btn.getAttribute('aria-expanded') === 'false';
    return {val: closed, closed: closed, aria: btn.getAttribute('aria-expanded')};
  })()`);
  await send('Page.navigate', { url: BASE + '/mymanager-field-guide.html' }); await delay(2400);
  await check('mkt-17 mobile guide: Sign in beside mobile-bar hamburger opens the sheet', `(function(){
    var bar = document.querySelector('.mobile-bar');
    var signin = bar ? bar.querySelector('.signin-trigger') : null;
    var menu = document.getElementById('menuBtn');
    if (!signin || getComputedStyle(signin).display === 'none') return {val: false, why: 'mobile-bar signin hidden'};
    if (!menu || getComputedStyle(menu).display === 'none') return {val: false, why: 'menuBtn hidden'};
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) return {val: false, why: 'horizontal overflow'};
    signin.click();
    var sheet = document.getElementById('signin-sheet');
    var form = document.querySelector('#marketing-email-auth .email-auth-form');
    var inViewport = sheet.getBoundingClientRect().right <= window.innerWidth + 1;
    return {val: !sheet.hidden && !!form && !form.hidden && inViewport, hidden: sheet.hidden, form: !!form, inViewport: inViewport};
  })()`);
  await send('Emulation.clearDeviceMetricsOverride');
  await delay(300);

  // ---- 7. Locked-project gate redirects to app.html (mmgr-app.js change) ----
  await send('Page.navigate', { url: BASE + '/project.html?id=locked-mkt' }); await delay(2600);
  await check('mkt-14 gate: locked project redirects to app.html?locked=', `(function(){
    return {val: location.href.indexOf('app.html?locked=') > -1, href: location.href};
  })()`);

  // ---- 8. Page-level console error audit (reload every page fresh) ----
  const audit = [];
  for (const p of ['index.html', 'about.html', 'features.html', 'contact.html', 'reviews.html', 'mymanager-field-guide.html', 'app.html']) {
    consoleErrors = []; pageErrors = [];
    await send('Page.navigate', { url: BASE + '/' + p }); await delay(2200);
    audit.push({ page: p, consoleErrors: consoleErrors.slice(), pageErrors: pageErrors.slice() });
  }
  const bad = audit.filter(a => a.consoleErrors.length || a.pageErrors.length);
  await check('mkt-15 audit: zero console errors across all 7 pages', `(function(){return {val: ${bad.length === 0}, bad: ${JSON.stringify(bad.length)}};})()`, JSON.stringify(bad));

  log('\n===== SUMMARY =====');
  const fails = results.filter(r => r.status === 'FAIL');
  log((results.length - fails.length) + ' passed, ' + fails.length + ' failed');
  if (bad.length) log('Console-error pages: ' + JSON.stringify(bad.map(b => b.page)));
  try { proc.kill(); } catch (e) {}
  process.exit(fails.length ? 1 : 0);
})().catch(e => { log('FATAL: ' + (e && e.stack || e)); try { ws && ws.close(); } catch (x) {} process.exit(3); });
