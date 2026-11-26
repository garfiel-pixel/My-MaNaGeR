#!/usr/bin/env node
/* ============================================================
   tools/gen-readme-art.cjs
   GATE: none - this is the generator behind images/readme/
   ------------------------------------------------------------
   WHY THIS FILE EXISTS
   The README showcase art (a hero banner, four feature cards and
   one live dashboard capture) was first drawn in a scratch script
   under tmp/, which is gitignored. That makes the art impossible to
   reproduce or correct later: a stale number in a card could only be
   fixed by redrawing it. This tool is the committed source of the
   cards, so the art can be regenerated from the repo alone.

   WHAT IT MAKES
     images/readme/mmgr-section-*.svg   the six feature cards (editable)
     images/readme/mmgr-section-*.png   2x renders of those cards
     images/readme/mmgr-project-dashboard.png
                                       a real capture of the demo
                                       project, not a mockup

   The hero banner (mmgr-hero.svg/png) is authored art, not generated:
   it is committed as-is and re-rendered from its own SVG when needed.

   USAGE
     node tools/gen-readme-art.cjs              # cards only
     node tools/gen-readme-art.cjs --cards      # same
     node tools/gen-readme-art.cjs --dashboard  # live capture (needs playwright)
     node tools/gen-readme-art.cjs --all        # cards + dashboard

   OUTPUT
     README_ART_OUT=/some/dir node tools/gen-readme-art.cjs --cards
   writes somewhere other than images/readme, so a dry run never
   touches the committed files.

   NOTE
     Embed the PNG in the README, not the SVG: GitHub renders SVG text
     with whatever fonts the viewer has, so a live-text card comes out
     in Arial on someone else's machine. The SVG is the editable source.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(ROOT, process.env.README_ART_OUT || 'images/readme');
const W = 1200;
const H = 400;
const DASH_PORT = Number(process.env.MMGR_ART_PORT || 8791);

const C = {
  bg: '#1c1a18',
  panel: '#221f1c',
  gold: '#d4af37',
  orange: '#e05624',
  white: '#f5efe6',
  green: '#7bb661'
};

const MONO = "'JetBrains Mono','SF Mono',Consolas,'Courier New',monospace";
const SANS = "Inter,'Segoe UI',system-ui,-apple-system,sans-serif";

/* Complete HTML escape: quotes are included because the escaped values also
   land in attributes (aria-label, pattern ids). Same set as the app's esc(). */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* One shared frame: eyebrow, title, lead lines, bullets on the left and a
   single panel on the right. Every card is a body inside this shell. */
function shell({ eyebrow, title, lead, bullets, body, footerRight }) {
  const leads = lead
    .map(
      (t, i) =>
        `<text x="64" y="${172 + i * 24}" font-family="${SANS}" font-size="13.5" fill="${C.white}" fill-opacity="0.6">${esc(t)}</text>`
    )
    .join('\n  ');
  const bl = bullets
    .map(
      (t, i) =>
        `<circle cx="68" cy="${252 + i * 26}" r="3" fill="${C.gold}"/><text x="82" y="${256 + i * 26}" font-family="${MONO}" font-size="10.5" letter-spacing="1.1" fill="${C.white}" fill-opacity="0.62">${esc(t)}</text>`
    )
    .join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title)}">
  <defs>
    <pattern id="g" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M32 0H0V32" fill="none" stroke="${C.white}" stroke-opacity="0.035"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="5" fill="none" stroke="${C.gold}" stroke-opacity="0.2"/>
  <path d="M18 40V18h22M${W - 18} 18h-22v22M${W - 40} ${H - 18}h22v-22M40 ${H - 18}H18v-22" fill="none" stroke="${C.gold}" stroke-opacity="0.5" stroke-width="1.6"/>

  <text x="64" y="88" font-family="${MONO}" font-size="9.5" letter-spacing="2.2" fill="${C.orange}">${esc(eyebrow)}</text>
  <text x="64" y="136" font-family="${SANS}" font-weight="800" font-size="34" letter-spacing="-0.8" fill="${C.white}">${esc(title)}</text>
  ${leads}
  <path d="M64 216H600" stroke="${C.white}" stroke-opacity="0.1"/>
  ${bl}

  <rect x="632" y="60" width="504" height="280" rx="10" fill="${C.panel}" stroke="${C.white}" stroke-opacity="0.09"/>
  ${body}

  <path d="M64 ${H - 40}H1136" stroke="${C.white}" stroke-opacity="0.08"/>
  <text x="64" y="${H - 20}" font-family="${MONO}" font-size="8.5" letter-spacing="1.8" fill="${C.white}" fill-opacity="0.35">mymanagerworkspace.com</text>
  <text x="1136" y="${H - 20}" text-anchor="end" font-family="${MONO}" font-size="8.5" letter-spacing="1.8" fill="${C.white}" fill-opacity="0.35">${esc(footerRight)}</text>
</svg>
`;
}

function panelHead(label, right) {
  return `<text x="656" y="90" font-family="${MONO}" font-size="9" letter-spacing="1.9" fill="${C.gold}">${esc(label)}</text>
  <text x="1112" y="90" text-anchor="end" font-family="${MONO}" font-size="9" letter-spacing="1.6" fill="${C.white}" fill-opacity="0.38">${esc(right)}</text>
  <path d="M656 104H1112" stroke="${C.white}" stroke-opacity="0.09"/>`;
}

function col(x, y, label, items, accent) {
  const head = `<circle cx="${x + 3}" cy="${y - 4}" r="3" fill="${accent}"/>
  <text x="${x + 14}" y="${y}" font-family="${MONO}" font-size="8.5" letter-spacing="1.7" fill="${C.white}" fill-opacity="0.45">${esc(label)}</text>`;
  const rows = items
    .map(
      (t, i) =>
        `<text x="${x}" y="${y + 28 + i * 22}" font-family="${MONO}" font-size="10.5" fill="${C.white}" fill-opacity="0.85">${esc(t)}</text>`
    )
    .join('\n  ');
  return head + '\n  ' + rows;
}

/* ---------------- card bodies ---------------- */

const mcp = shell({
  eyebrow: 'AGENT SURFACE',
  title: 'MCP server',
  lead: [
    'A scoped Model Context Protocol endpoint over the same',
    'project model the app renders. Read first, propose second.'
  ],
  bullets: [
    'EVERY WRITE IS A CHANGE SET',
    'QUEUED, VALIDATED, THEN ACCEPTED',
    'BUDGET GATES ON READ AND WRITE'
  ],
  footerRight: 'MCP · OPENAPI · SCOPED KEYS',
  body:
    panelHead('TOOL SURFACE', '23 TOOLS') +
    col(
      656,
      134,
      'READ',
      [
        'get_project_summary',
        'get_schedule',
        'get_budget',
        'get_risks',
        'get_deliveries',
        'run_monte_carlo'
      ],
      C.green
    ) +
    col(
      900,
      134,
      'WRITE',
      ['apply_changes', 'validate_changes', 'withdraw_changes', 'get_pending'],
      C.orange
    ) +
    `<path d="M656 288H1112" stroke="${C.white}" stroke-opacity="0.08"/>
  <text x="656" y="312" font-family="${MONO}" font-size="9" fill="${C.white}" fill-opacity="0.42">NOTHING AUTO-APPLIES. THE OWNER ACCEPTS.</text>`
});

const wbs = shell({
  eyebrow: 'SCOPE',
  title: 'Work breakdown',
  lead: [
    'Every task hangs off a numbered work package, so scope',
    'stays traceable from the charter to the last snag.'
  ],
  bullets: [
    'MAJOR GROUPS TO LEAF TASKS',
    'PARENT ROLLUP ON EVERY FIGURE',
    'CODES STABLE ACROSS REVISIONS'
  ],
  footerRight: 'WBS · ROLLUP · DEPENDENCIES',
  body:
    panelHead('OUTLINE', '9 GROUPS') +
    `<path d="M668 136v150M694 162v100" stroke="${C.white}" stroke-opacity="0.14"/>
  <g font-family="${MONO}" font-size="9" fill="${C.gold}" fill-opacity="0.85">
    <text x="656" y="140">1.0</text><text x="680" y="166">1.1</text>
    <text x="706" y="192">1.1.1</text><text x="706" y="218">1.1.2</text>
    <text x="680" y="244">1.2</text><text x="680" y="270">1.3</text>
    <text x="680" y="296">1.4</text>
  </g>
  <g font-family="${SANS}" font-size="11.5" fill="${C.white}">
    <text x="744" y="140" font-weight="700">Riverside Tower Renovation</text>
    <text x="744" y="166" fill-opacity="0.8">Demolition</text>
    <text x="770" y="192" fill-opacity="0.62">Demolition Floors 1-4</text>
    <text x="770" y="218" fill-opacity="0.62">Demolition Floors 5-8</text>
    <text x="744" y="244" fill-opacity="0.8">Planning</text>
    <text x="744" y="270" fill-opacity="0.62">Procurement</text>
    <text x="744" y="296" fill-opacity="0.85" font-weight="700">Structural</text>
  </g>
  <g font-family="${MONO}" font-size="9" text-anchor="end" fill="${C.white}" fill-opacity="0.45">
    <text x="1112" y="140">30 TASKS</text><text x="1112" y="166">6</text>
    <text x="1112" y="192">2</text><text x="1112" y="218">2</text>
    <text x="1112" y="244">3</text><text x="1112" y="270">2</text>
    <text x="1112" y="296">3</text>
  </g>`
});

const gantt = shell({
  eyebrow: 'SCHEDULE',
  title: 'Gantt and dependencies',
  lead: [
    'Bars, links and a live today line. Drag a date and the',
    'downstream work moves with it.'
  ],
  bullets: ['FINISH TO START LINKS', 'WORKING DAY CALENDAR', 'CRITICAL PATH HIGHLIGHTED'],
  footerRight: 'GANTT · CPM · BASELINE',
  body:
    panelHead('PHASES', '6 BARS') +
    `<path d="M900 128V300" stroke="${C.orange}" stroke-opacity="0.45" stroke-dasharray="3 4"/>
  <text x="900" y="122" text-anchor="middle" font-family="${MONO}" font-size="8" letter-spacing="1.2" fill="${C.orange}" fill-opacity="0.85">TODAY</text>
  <g font-family="${SANS}" font-size="10.5" fill="${C.white}" fill-opacity="0.8">
    <text x="656" y="152">Tenant Relocation</text>
    <text x="656" y="176">Demolition</text>
    <text x="656" y="200" font-weight="700" fill="${C.white}">Seismic Retrofit</text>
    <text x="656" y="224">MEP Rough-In</text>
    <text x="656" y="248">Interior Finishes</text>
    <text x="656" y="272">Commissioning</text>
  </g>
  <g>
    <rect x="790" y="143" width="70" height="11" rx="3" fill="${C.gold}" fill-opacity="0.42"/>
    <rect x="846" y="167" width="70" height="11" rx="3" fill="${C.gold}" fill-opacity="0.42"/>
    <rect x="900" y="191" width="96" height="11" rx="3" fill="${C.orange}"/>
    <rect x="982" y="215" width="66" height="11" rx="3" fill="${C.white}" fill-opacity="0.18"/>
    <rect x="1034" y="239" width="52" height="11" rx="3" fill="${C.white}" fill-opacity="0.18"/>
    <rect x="1072" y="263" width="40" height="11" rx="3" fill="${C.white}" fill-opacity="0.18"/>
  </g>
  <g fill="none" stroke="${C.white}" stroke-opacity="0.26">
    <path d="M862 154v6h6v7M918 178v6h6v7M998 202v6h6v7M1050 226v6h6v7M1086 250v6h6v7"/>
  </g>`
});

const cost = shell({
  eyebrow: 'COST',
  title: 'Budget and earned value',
  lead: [
    'Planned against earned against actual, drawn from the same',
    'numbers the reports print. No second spreadsheet.'
  ],
  bullets: [
    'EV, PV AND AC IN ONE CURVE',
    'CPI AND SPI ON EVERY ROLLUP',
    'CHANGE ORDERS TRACKED TO SOURCE'
  ],
  footerRight: 'EVM · BUDGET · CHANGE ORDERS',
  body:
    panelHead('S CURVE', 'MONTH 6 OF 21') +
    `<path d="M672 296H1104M672 296V112" stroke="${C.white}" stroke-opacity="0.12"/>
  <path d="M676 292C740 292 780 268 830 240S920 196 1000 172 1080 150 1100 142" fill="none" stroke="${C.gold}" stroke-opacity="0.5" stroke-width="2" stroke-dasharray="5 4"/>
  <path d="M676 292C760 292 800 276 846 252S936 214 1004 196 1070 184 1100 180" fill="none" stroke="${C.gold}" stroke-width="2.2"/>
  <path d="M676 292C780 294 824 284 866 266S950 236 1010 222 1072 214 1100 212" fill="none" stroke="${C.orange}" stroke-width="2.2"/>
  <circle cx="1060" cy="178" r="3.5" fill="${C.gold}"/>
  <circle cx="1060" cy="210" r="3.5" fill="${C.orange}"/>
  <g font-family="${MONO}" font-size="8.5" letter-spacing="1.2" fill="${C.white}" fill-opacity="0.4">
    <text x="676" y="316">M1</text><text x="810" y="316">M3</text>
    <text x="946" y="316">M5</text><text x="1080" y="316">M7</text>
  </g>
  <g font-family="${MONO}" font-size="9">
    <rect x="676" y="112" width="8" height="3" fill="${C.gold}" fill-opacity="0.5"/>
    <text x="690" y="116" fill="${C.white}" fill-opacity="0.55">PLANNED</text>
    <rect x="776" y="112" width="8" height="3" fill="${C.gold}"/>
    <text x="790" y="116" fill="${C.white}" fill-opacity="0.55">EARNED</text>
    <rect x="866" y="112" width="8" height="3" fill="${C.orange}"/>
    <text x="880" y="116" fill="${C.white}" fill-opacity="0.55">ACTUAL</text>
  </g>`
});

const sync = shell({
  eyebrow: 'OFFLINE / CLOUD',
  title: 'Offline first, cloud by choice',
  lead: [
    'A project lives on your device first and opens with no network.',
    'Cloud backup is switched on per project, and only when you ask.'
  ],
  bullets: [
    'LOCAL-FIRST STORAGE',
    'SYNC IS OPT-IN PER PROJECT',
    'ONE ACCEPTED REVISION, NO SILENT MERGE'
  ],
  footerRight: 'PWA · D1 · R2 · SERVICE WORKER',
  body:
    panelHead('TWO COPIES', 'REVISION 42') +
    col(
      656,
      134,
      'THIS DEVICE',
      ['IndexedDB project file', 'service worker cache', 'works with no network'],
      C.green
    ) +
    col(936, 134, 'CLOUD', ['D1 project rows', 'R2 photo blobs', 'accepted revision'], C.gold) +
    `<path d="M880 168h28" stroke="${C.white}" stroke-opacity="0.35" stroke-dasharray="3 3"/>
  <path d="M902 164l6 4-6 4" fill="none" stroke="${C.white}" stroke-opacity="0.45"/>
  <path d="M656 288H1112" stroke="${C.white}" stroke-opacity="0.08"/>
  <text x="656" y="312" font-family="${MONO}" font-size="9" fill="${C.white}" fill-opacity="0.42">NOTHING LEAVES THE DEVICE UNTIL YOU TURN SYNC ON.</text>`
});

const ai = shell({
  eyebrow: 'ASSISTANT',
  title: 'Your key, your model',
  lead: [
    'A relay in the Worker forwards the provider key you supply. The',
    'assistant reads the same project model the screen renders.'
  ],
  bullets: [
    'BRING YOUR OWN KEY',
    'THE KEY IS NEVER STORED SERVER-SIDE',
    'READS SCHEDULE, BUDGET AND RISK'
  ],
  footerRight: 'AI RELAY · MODEL LADDER · OPT-IN',
  body:
    panelHead('REQUEST PATH', 'ONE RELAY') +
    `<g font-family="${MONO}" font-size="9.5" fill="${C.white}" fill-opacity="0.8">
    <text x="656" y="140">YOUR DEVICE</text>
    <text x="656" y="186">/api/ai/chat</text>
    <text x="656" y="232">PROVIDER</text>
  </g>
  <g font-family="${MONO}" font-size="8.5" fill="${C.white}" fill-opacity="0.4">
    <text x="860" y="140">PROJECT CONTEXT, KEY HEADER</text>
    <text x="860" y="186">FALLBACK LADDER, NO STORAGE</text>
    <text x="860" y="232">STREAMED ANSWER</text>
  </g>
  <g fill="none" stroke="${C.gold}" stroke-opacity="0.5">
    <path d="M676 150v18M676 196v18"/>
    <path d="M670 164l6 6 6-6M670 210l6 6 6-6"/>
  </g>
  <path d="M656 288H1112" stroke="${C.white}" stroke-opacity="0.08"/>
  <text x="656" y="312" font-family="${MONO}" font-size="9" fill="${C.white}" fill-opacity="0.42">THE ASSISTANT IS OFF ON VIEW-ONLY AND OFFLINE PAGES.</text>`
});

const CARDS = [
  ['mmgr-section-mcp.svg', mcp],
  ['mmgr-section-wbs.svg', wbs],
  ['mmgr-section-gantt.svg', gantt],
  ['mmgr-section-cost.svg', cost],
  ['mmgr-section-sync.svg', sync],
  ['mmgr-section-ai.svg', ai]
];

async function renderCards(only) {
  const { chromium } = require('playwright');
  const { chromePath } = require('./chrome-launcher.cjs');
  fs.mkdirSync(OUT, { recursive: true });
  const cards = only && only.length ? CARDS.filter(c => only.indexOf(c[0]) > -1) : CARDS;
  for (const [name, svg] of cards) {
    fs.writeFileSync(path.join(OUT, name), svg);
  }
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath || undefined,
    args: ['--disk-cache-size=0']
  });
  for (const [name] of cards) {
    const src = path.resolve(OUT, name);
    const png = src.replace(/\.svg$/, '.png');
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    await page.goto('file:///' + src.replace(/\\/g, '/'), { waitUntil: 'load' });
    await page.waitForTimeout(250);
    await page.screenshot({ path: png, clip: { x: 0, y: 0, width: W, height: H } });
    await page.close();
    console.log('[card] ' + name + '  ' + fs.statSync(png).size + ' bytes');
  }
  await browser.close();
}

/* The dashboard image must be the REAL app: same CSS, same demo data, so the
   numbers in the README cannot drift from what the product shows. */
async function captureDashboard() {
  const { chromium } = require('playwright');
  const { chromePath } = require('./chrome-launcher.cjs');
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const FLUSH_RAF = `new Promise(function (res) {
  requestAnimationFrame(function () { requestAnimationFrame(function () { res(1); }); });
})`;
  const BASE = 'http://127.0.0.1:' + DASH_PORT;
  const srv = spawn(process.execPath, ['serve.cjs'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { MMGR_SERVE_PORT: String(DASH_PORT) }),
    stdio: 'ignore'
  });
  try {
    let up = false;
    for (let i = 0; i < 80 && !up; i++) {
      await delay(250);
      try {
        up = (await fetch(BASE + '/manifest.webmanifest')).ok;
      } catch (e) {
        up = false;
      }
    }
    if (!up) {
      throw new Error('serve.cjs did not answer on ' + BASE);
    }
    const browser = await chromium.launch({
      headless: true,
      executablePath: chromePath || undefined,
      args: ['--disk-cache-size=0', '--enable-unsafe-swiftshader']
    });
    const ctx = await browser.newContext({
      viewport: { width: 1560, height: 1900 },
      colorScheme: 'light'
    });
    await ctx.addInitScript(`
      try {
        localStorage.setItem('mmgr_unlocked_demo-filled', '1');
        localStorage.removeItem('mmgr_scope_demo-filled');
      } catch (e) {}
    `);
    const page = await ctx.newPage();
    await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
    await delay(1600);
    await page.goto(BASE + '/project.html?id=demo-filled', { waitUntil: 'domcontentloaded' });
    await delay(2600);
    await page.evaluate(FLUSH_RAF);
    await delay(900);

    // Strip anything that is not the dashboard itself.
    await page.evaluate(() => {
      [
        '#readonly-banner',
        '#ai-command-card',
        '#today-decision-card',
        '[class*="fab"]',
        '.dock',
        '#first-project-tour',
        '[id*="tour"]',
        '.packs-callout'
      ].forEach(sel => document.querySelectorAll(sel).forEach(el => el.remove()));
      document.querySelectorAll('body *').forEach(el => {
        const s = getComputedStyle(el);
        if (s.position === 'fixed' && (s.bottom !== 'auto' || s.right !== 'auto')) {
          if (el.getBoundingClientRect().width < 200) {
            el.remove();
          }
        }
      });
    });
    await delay(300);
    await page.evaluate(FLUSH_RAF);
    await delay(300);

    // Keep the KPI strip and dashboard grid, drop what follows them.
    await page.evaluate(() => {
      const ring = document.getElementById('completion-card');
      if (!ring) {
        return;
      }
      const grid = ring.closest('.g3');
      if (!grid) {
        return;
      }
      const kids = [...grid.parentElement.children];
      const target = kids.find(el => /BUDGET VARIANCE/i.test(el.textContent || ''));
      if (target) {
        kids.slice(kids.indexOf(target) + 1).forEach(el => el.remove());
      }
    });
    await delay(250);

    const box = await page.evaluate(() => {
      let cardsBottom = 0;
      document.querySelectorAll('body *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.bottom < 1500 && r.bottom > cardsBottom) {
          cardsBottom = r.bottom;
        }
      });
      const sb = document.querySelector('#app-sidebar') || document.querySelector('aside');
      let sideBottom = 0;
      if (sb) {
        sb.querySelectorAll('*').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.height > 0 && r.bottom > sideBottom) {
            sideBottom = r.bottom;
          }
        });
        sideBottom += window.scrollY;
      }
      return { cardsBottom: cardsBottom, botY: Math.max(cardsBottom, sideBottom) };
    });
    const height = Math.round(box.botY + 24);
    const out = path.join(OUT, 'mmgr-project-dashboard.png');
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({
      path: out,
      fullPage: true,
      clip: { x: 0, y: 0, width: 1560, height: height }
    });
    console.log('[dashboard] ' + out + '  ' + fs.statSync(out).size + ' bytes');
    await browser.close();
  } finally {
    try {
      srv.kill();
    } catch (e) {
      /* the server may already be gone */
    }
  }
}

(async () => {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx > -1 ? args[onlyIdx + 1].split(',') : null;
  const all = args.indexOf('--all') > -1;
  const dash = all || args.indexOf('--dashboard') > -1;
  if (!dash || all) {
    await renderCards(only);
  }
  if (dash) {
    await captureDashboard();
  }
})().catch(e => {
  console.error('[readme-art] ' + ((e && e.stack) || e));
  process.exit(1);
});
