#!/usr/bin/env node
// tools/qa-signin-look.cjs
// Regression gate for the SIGN-IN PAGE (signin.html) and the app's Sign in entry.
// Owner rules 2026-10-10:
//   S1  The Google button is on /signin. The page loads Google's script and asks
//       for the full-width pill; if Google cannot load, a LABELLED button shows,
//       never a bare circle or an empty box.
//   S2  "Sign in with email" is an in-card DROPDOWN. It is never a popup:
//       not position:fixed, not outside the card, no dialog.
//   S3  The dropdown holds an Email box, a Password box with its show/hide
//       toggle on the SAME row, a Sign in button, "Create an account instead"
//       and "Forgot password?".
//   S4  Star sky, BLACK (no blue, no cyan), gold accent. No lock icon.
//   S5  The wordmark ("My MaNaGeR") is fully visible; text passes contrast.
//   S6  The app's Sign in goes to /signin?next=..., and the old #siom popup
//       stays hidden (locked decision L2).
//
// Why it exists: the page shipped with no Google script, the email panel wearing
// the old marketing popup class (position:fixed, #0b0b0d, white glow), a navy sky,
// and nothing measured any of it. This measures what the owner SEES.
//
// Google's script is replaced by a stub (offline, deterministic). The stub records
// the options the page asked for.
// Run against a served site: QA_BASE (default http://127.0.0.1:8765).
// Optional PW_CHROMIUM=/path/to/chrome for sandboxes with a pinned browser.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:8765';
const ROOT = path.join(__dirname, '..');
let fails = 0;
function check(ok, label, extra) {
  if (!ok) {
    fails++;
  }
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  [' + extra + ']' : ''));
}

const STUB = `
window.google = { accounts: { id: {
  initialize: function (o) { window.__gisInit = o; },
  renderButton: function (host, opts) {
    window.__gisOpts = opts;
    var d = document.createElement('div');
    d.setAttribute('role', 'button');
    d.style.cssText = 'width:' + (opts.width || 200) + 'px;height:44px;border-radius:999px;background:#fff;color:#111;display:flex;align-items:center;justify-content:center';
    d.textContent = 'Continue with Google';
    host.appendChild(d);
  },
  prompt: function () {}
} } };`;

// ---- colour helpers ---------------------------------------------------------
const parse = c => {
  const m = String(c).match(/rgba?\(([^)]+)\)/);
  if (!m) {
    return null;
  }
  const p = m[1].split(',').map(x => parseFloat(x));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
};
const lum = ({ r, g, b }) => {
  const f = v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const over = (fg, bg) => ({
  r: fg.a * fg.r + (1 - fg.a) * bg.r,
  g: fg.a * fg.g + (1 - fg.a) * bg.g,
  b: fg.a * fg.b + (1 - fg.a) * bg.b,
  a: 1
});
const ratio = (a, b) => {
  const la = lum(a),
    lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const CARD = { r: 29, g: 29, b: 30, a: 1 }; // the card composited over the black sky, light-theme worst case

async function openPage(browser, w, h, dark, opts) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  if (dark) {
    await ctx.addInitScript("try{localStorage.setItem('mmgr_theme','dark')}catch(e){}");
  }
  const page = await ctx.newPage();
  const seen = { gis: 0 };
  await page.route('**/api/auth/me', r =>
    r.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false}' })
  );
  await page.route('**/accounts.google.com/gsi/client*', r => {
    seen.gis++;
    if (opts && opts.blockGoogle) {
      return r.abort();
    }
    return r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
  });
  await page.goto(BASE + '/signin.html?next=/app.html', { waitUntil: 'load' });
  return { ctx, page, seen };
}

(async () => {
  // ---- static: the markup the owner can inspect ------------------------------
  const html = fs.readFileSync(path.join(ROOT, 'signin.html'), 'utf8');
  check(
    (html.match(/accounts\.google\.com\/gsi\/client/g) || []).length === 1,
    'signin.html loads Google Identity exactly once'
  );
  check(!/#i-lock/.test(html), 'signin.html has no lock icon');
  check(
    /id="google-signin-button"[^>]*data-gis-shape="pill"/.test(html),
    'the Google slot asks for the pill button'
  );
  console.log('');

  const browser = await chromium.launch(
    process.env.PW_CHROMIUM
      ? { executablePath: process.env.PW_CHROMIUM, args: ['--no-sandbox'] }
      : {}
  );

  for (const [w, h, dark] of [
    [1534, 900, false],
    [1534, 900, true],
    [390, 844, false]
  ]) {
    const tag = '@' + w + (dark ? ' dark' : '');
    const { ctx, page, seen } = await openPage(browser, w, h, dark);
    await page.waitForTimeout(900);

    const a = await page.evaluate(() => {
      const q = s => document.querySelector(s);
      const host = q('#google-signin-button');
      const hs = getComputedStyle(host);
      const hb = host.getBoundingClientRect();
      const cardEl = q('.signin-card');
      const cb = cardEl.getBoundingClientRect();
      const sky = getComputedStyle(q('.signin-sky')).backgroundImage;
      const brand = q('.auth-header .brand b');
      const lede = q('.signin-lede');
      const legal = q('.signin-legal');
      const divider = q('.signin-divider span');
      const ico = q('.signin-disclosure .ico');
      return {
        lock: !!document.querySelector('.signin-card svg use[href*="i-lock"]'),
        opts: window.__gisOpts || null,
        hostKids: host.children.length,
        hostH: Math.round(hb.height),
        hostW: Math.round(hb.width),
        hostBorder: parseFloat(hs.borderTopWidth) || 0,
        hostBg: hs.backgroundColor,
        sky,
        brandColor: getComputedStyle(brand).color,
        ledeColor: getComputedStyle(lede).color,
        legalColor: getComputedStyle(legal).color,
        dividerColor: getComputedStyle(divider).color,
        icoColor: getComputedStyle(ico).color,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        cardW: Math.round(cb.width),
        panelHidden: q('#signin-email-panel').hidden
      };
    });

    check(seen.gis >= 1, tag + ' requests Google Identity', 'requests ' + seen.gis);
    check(!a.lock, tag + ' has no lock icon');
    check(
      !!a.opts &&
        a.opts.shape === 'pill' &&
        a.opts.size === 'large' &&
        a.opts.text === 'continue_with' &&
        a.opts.theme === 'outline',
      tag + ' asks Google for the large pill "Continue with Google"',
      JSON.stringify(a.opts)
    );
    check(
      !!a.opts && a.opts.width >= 200 && a.opts.width <= 400 && a.opts.width <= a.hostW + 1,
      tag + ' button width fits the card',
      'width ' + (a.opts && a.opts.width) + ' host ' + a.hostW
    );
    check(
      a.hostKids > 0 && a.hostH >= 40,
      tag + ' Google button is drawn and tall enough',
      'height ' + a.hostH
    );
    check(
      a.hostBorder === 0 && parseFloat(a.hostBg.split(',')[3] || '1') === 0,
      tag + ' the Google slot is not a bordered box',
      'border ' + a.hostBorder + ' bg ' + a.hostBg
    );
    check(a.panelHidden, tag + ' email form starts closed');
    const grad = a.sky.slice(a.sky.indexOf('linear-gradient'));
    const gstops = (grad.match(/rgb\([^)]+\)/g) || []).map(parse);
    check(
      gstops.length >= 3 && gstops.every(c => Math.abs(c.b - c.r) <= 6 && c.r <= 20),
      tag + ' sky is black (no blue tint)',
      gstops.map(c => c.r + ',' + c.g + ',' + c.b).join(' | ')
    );
    check(!/0, 188, 212/.test(a.sky), tag + ' sky has no cyan glow');
    check(
      /radial-gradient/.test(a.sky) && /rgba\(255, 255, 255/.test(a.sky),
      tag + ' stars are still there'
    );
    check(
      ratio(parse(a.brandColor), { r: 6, g: 6, b: 7 }) >= 7,
      tag + ' wordmark "My MaNaGeR" is readable',
      a.brandColor
    );
    check(ratio(over(parse(a.ledeColor), CARD), CARD) >= 7, tag + ' intro text contrast >= 7:1');
    check(
      ratio(over(parse(a.legalColor), CARD), CARD) >= 4.5,
      tag + ' legal text contrast >= 4.5:1'
    );
    check(
      ratio(over(parse(a.dividerColor), CARD), CARD) >= 4.5,
      tag + ' divider label contrast >= 4.5:1'
    );
    const gold = parse(a.icoColor);
    check(
      gold && ((gold.r === 217 && gold.g === 107) || (gold.r === 232 && gold.g === 146)),
      tag + ' accent icon is gold',
      a.icoColor
    );
    check(!a.overflow, tag + ' has no sideways scroll');

    // ---- the email dropdown --------------------------------------------------
    await page.click('#signin-email-toggle');
    await page.waitForTimeout(500);
    const b = await page.evaluate(() => {
      const q = s => document.querySelector(s);
      const vis = e => !!(e && (e.offsetWidth || e.offsetHeight));
      const panel = q('#signin-email-panel');
      const card = q('.signin-card').getBoundingClientRect();
      const pb = panel.getBoundingClientRect();
      const em = panel.querySelector('input[type=email]');
      const pw = panel.querySelector('input[type=password]');
      const eye = panel.querySelector('.email-auth-eye');
      const submit = panel.querySelector('.email-auth-submit');
      const txt = re =>
        [...panel.querySelectorAll('button')].find(x => re.test(x.textContent) && vis(x));
      const r = e => (e ? e.getBoundingClientRect() : null);
      const fixedBig = [...document.querySelectorAll('body *')]
        .filter(
          e =>
            getComputedStyle(e).position === 'fixed' &&
            vis(e) &&
            e.offsetWidth * e.offsetHeight > 20000 &&
            !e.classList.contains('signin-sky')
        )
        .map(e => (e.id || e.className).toString().slice(0, 30));
      const dialogs = [
        ...document.querySelectorAll('dialog[open],[role=dialog],[aria-modal=true]')
      ].filter(vis).length;
      const eb = r(eye),
        pwb = r(pw);
      const sb = r(submit);
      const sc = submit && getComputedStyle(submit);
      return {
        expanded: q('#signin-email-toggle').getAttribute('aria-expanded'),
        position: getComputedStyle(panel).position,
        inCard:
          pb.left >= card.left - 1 &&
          pb.right <= card.right + 1 &&
          pb.top >= card.top - 1 &&
          pb.bottom <= card.bottom + 1,
        panelRect: [
          Math.round(pb.left),
          Math.round(pb.top),
          Math.round(pb.right),
          Math.round(pb.bottom)
        ],
        cardRect: [
          Math.round(card.left),
          Math.round(card.top),
          Math.round(card.right),
          Math.round(card.bottom)
        ],
        fixedBig,
        dialogs,
        email: vis(em),
        password: vis(pw),
        eyeSameRow: !!(
          eb &&
          pwb &&
          eb.top >= pwb.top - 2 &&
          eb.bottom <= pwb.bottom + 2 &&
          eb.right <= pwb.right + 2 &&
          eb.right >= pwb.right - 60
        ),
        pwW: pwb ? Math.round(pwb.width) : 0,
        emW: em ? Math.round(em.getBoundingClientRect().width) : 0,
        eyeVis: vis(eye),
        signIn: !!submit && vis(submit) && /sign in/i.test(submit.textContent),
        create: !!txt(/create an account instead/i),
        forgot: !!txt(/forgot password/i),
        submitBg: sc ? sc.backgroundColor : '',
        submitFg: sc ? sc.color : '',
        submitInCard: !!sb && sb.left >= card.left && sb.right <= card.right
      };
    });
    // every piece of readable text in the card, measured against the fill actually behind it
    const tc = await page.evaluate(() => {
      const card = document.querySelector('.signin-card');
      const parse = c => {
        const m = String(c).match(/rgba?\(([^)]+)\)/);
        if (!m) {
          return null;
        }
        const p = m[1].split(',').map(parseFloat);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      };
      const over = (f, b) => ({
        r: f.a * f.r + (1 - f.a) * b.r,
        g: f.a * f.g + (1 - f.a) * b.g,
        b: f.a * f.b + (1 - f.a) * b.b,
        a: 1
      });
      const lum = c => {
        const f = v => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
      };
      const ratio = (a, b) => {
        const x = lum(a),
          y = lum(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      const bgOf = el => {
        const chain = [];
        for (let e = el; e; e = e.parentElement) {
          chain.unshift(e);
          if (e === card) {
            break;
          }
        }
        let bg = { r: 6, g: 6, b: 7, a: 1 };
        chain.forEach(e => {
          const c = parse(getComputedStyle(e).backgroundColor);
          if (c && c.a > 0) {
            bg = over(c, bg);
          }
        });
        return bg;
      };
      const out = [];
      [...card.querySelectorAll('*')].forEach(e => {
        if (!(e.offsetWidth || e.offsetHeight) || e.closest('#google-signin-button')) {
          return;
        }
        const own = [...e.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim());
        if (!own) {
          return;
        }
        const cs = getComputedStyle(e);
        const fg = parse(cs.color);
        if (!fg) {
          return;
        }
        const bg = bgOf(e);
        const eff = over(fg, bg);
        const big =
          parseFloat(cs.fontSize) >= 24 ||
          (parseFloat(cs.fontSize) >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
        const r = ratio(eff, bg);
        if (r < (big ? 3 : 4.5)) {
          out.push(
            (e.className || e.tagName).toString().slice(0, 22) +
              ' ' +
              r.toFixed(2) +
              ':1 "' +
              e.textContent.trim().slice(0, 24) +
              '"'
          );
        }
      });
      return out;
    });
    check(
      tc.length === 0,
      tag + ' every text in the card passes contrast (4.5:1 / 3:1 large)',
      tc.slice(0, 3).join(' | ')
    );
    check(b.expanded === 'true', tag + ' toggle reports expanded');
    check(
      b.position !== 'fixed' && b.position !== 'absolute',
      tag + ' email form is NOT a popup',
      'position ' + b.position
    );
    check(
      b.inCard,
      tag + ' email form sits inside the card',
      'panel ' + b.panelRect + ' card ' + b.cardRect
    );
    check(
      b.fixedBig.length === 0 && b.dialogs === 0,
      tag + ' no overlay or dialog opened',
      b.fixedBig.join(',')
    );
    check(
      b.email && b.password && b.eyeVis,
      tag + ' Email box, Password box and show/hide toggle are visible'
    );
    check(
      b.eyeSameRow,
      tag + ' show/hide toggle sits inside the password box',
      'password ' + b.pwW + 'px'
    );
    check(
      Math.abs(b.pwW - b.emW) <= 4 && b.emW >= 200,
      tag + ' Email and Password boxes are the same full width',
      b.emW + ' vs ' + b.pwW
    );
    check(b.signIn && b.submitInCard, tag + ' "Sign in" button is in the card');
    check(
      b.create && b.forgot,
      tag + ' "Create an account instead" and "Forgot password?" are on the page'
    );
    const sbg = parse(b.submitBg),
      sfg = parse(b.submitFg);
    check(
      sbg && sfg && sbg.r === 232 && sbg.g === 146 && ratio(sfg, sbg) >= 4.5,
      tag + ' Sign in is gold with readable text',
      b.submitBg + ' / ' + b.submitFg
    );
    await ctx.close();
  }

  // ---- Google cannot load: the fallback must be a real, labelled button --------
  console.log('');
  {
    const { ctx, page } = await openPage(browser, 1534, 900, true, { blockGoogle: true });
    await page.waitForSelector('.gis-fallback-btn', { timeout: 15000 }).catch(() => {});
    const f = await page.evaluate(() => {
      const b = document.querySelector('#google-signin-button .gis-fallback-btn');
      if (!b) {
        return null;
      }
      const r = b.getBoundingClientRect();
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        text: b.textContent.trim(),
        wide: b.classList.contains('is-wide'),
        radius: getComputedStyle(b).borderTopLeftRadius
      };
    });
    check(!!f, 'fallback button appears when Google cannot load');
    check(
      !!f && f.wide && f.w >= 200 && f.h >= 40 && /google/i.test(f.text),
      'fallback is a wide, labelled "Continue with Google" button, not a circle',
      f ? JSON.stringify(f) : 'none'
    );
    if (f) {
      await page.click('.gis-fallback-btn');
      await page.waitForTimeout(300);
      const n = await page.evaluate(() => {
        const note = document.querySelector('.gis-fallback-note');
        const b = document.querySelector('.gis-fallback-btn');
        return { note: note ? note.textContent : '', btn: b ? b.textContent.trim() : '' };
      });
      check(
        /could not load/i.test(n.note),
        'clicking it explains the problem next to the button',
        n.note
      );
      check(/google/i.test(n.btn), 'the button keeps its label after the message');
    }
    await ctx.close();
  }

  // ---- the app: Sign in goes to the page, the old popup stays off (L2) ---------
  console.log('');
  {
    const ctx = await browser.newContext({ viewport: { width: 1534, height: 900 } });
    const page = await ctx.newPage();
    await page.route('**/api/auth/me', r =>
      r.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false}' })
    );
    await page.route('**/accounts.google.com/**', r =>
      r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB })
    );
    await page.goto(BASE + '/app.html', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const siom = await page.evaluate(() => {
      const m = document.getElementById('siom');
      return m ? getComputedStyle(m).display : 'missing';
    });
    check(siom === 'none', 'app.html: the old #siom sign-in popup is off on load', siom);
    const btn = await page.$('.db-signin');
    if (btn && (await btn.isVisible())) {
      await btn.click();
    } else {
      await page.evaluate(() => window.openSignIn && window.openSignIn());
    }
    await page.waitForTimeout(1200);
    check(
      /\/signin\.html\?next=/.test(page.url()),
      'app.html: Sign in goes to /signin?next=...',
      page.url().replace(BASE, '')
    );
    await ctx.close();
  }

  // ---- ?next= stays same-site ---------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1534, height: 900 } });
    const page = await ctx.newPage();
    await page.route('**/api/auth/me', r =>
      r.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false}' })
    );
    await page.route('**/accounts.google.com/**', r =>
      r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB })
    );
    await page.goto(BASE + '/signin.html?next=https://evil.example/steal', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const hidden = await page.evaluate(() => document.getElementById('signin-return').hidden);
    check(hidden, 'an absolute ?next= is discarded (no return promise shown)');
    await ctx.close();
  }

  await browser.close();
  console.log('\n' + (fails === 0 ? 'SIGN-IN PAGE PASS' : fails + ' CHECK(S) FAILED'));
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => {
  console.error(e);
  process.exit(2);
});
