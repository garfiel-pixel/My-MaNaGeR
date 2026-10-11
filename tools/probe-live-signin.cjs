#!/usr/bin/env node
// tools/probe-live-signin.cjs - is the sign-in fix actually DEPLOYED?
//
//   node tools/probe-live-signin.cjs https://my-manager.garfieldprocis.workers.dev --min-sw 398
//   node tools/probe-live-signin.cjs https://mymanagerworkspace.com --min-sw 398
//
// Read-only: plain GETs, no cookies, no secrets. It fetches the page the way a
// visitor's browser does and checks the markers the fix left in the HTML, the
// stylesheet, the app bundle and the service worker. Answers "is the live site
// serving the new files" with evidence instead of a claim.
const base = (process.argv[2] || '').replace(/\/+$/, '');
const minSw = Number(
  (process.argv.indexOf('--min-sw') > -1 && process.argv[process.argv.indexOf('--min-sw') + 1]) || 0
);
if (!/^https?:\/\//.test(base)) {
  console.error('usage: node tools/probe-live-signin.cjs <https://origin> [--min-sw N]');
  process.exit(2);
}
let fails = 0;
const check = (ok, label, extra) => {
  if (!ok) {
    fails++;
  }
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  [' + extra + ']' : ''));
};
const get = async p => {
  const url = base + p + (p.includes('?') ? '&' : '?') + '_probe=' + Date.now();
  const r = await fetch(url, { cache: 'no-store', redirect: 'follow' });
  return { status: r.status, text: await r.text(), url: r.url };
};

function cssRule(css, selector) {
  const i = css.indexOf(selector);
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i) + 1);
}

(async () => {
  const page = await get('/signin.html');
  check(
    page.status === 200,
    'GET /signin.html is 200',
    'status ' + page.status + ' ' + page.url.replace(base, '')
  );
  const html = page.text;
  check(
    /accounts\.google\.com\/gsi\/client/.test(html),
    'page loads Google Identity (the Google button can render)'
  );
  check(!/#i-lock/.test(html), 'page has no lock icon');
  check(
    /id="google-signin-button"[^>]*data-gis-shape="pill"/.test(html),
    'Google slot asks for the full-width pill'
  );

  const cssHref = (html.match(/<link[^>]+href="([^"]*marketing\.min[^"]*\.css)"/) || [])[1];
  check(!!cssHref, 'page links its stylesheet', cssHref);
  if (cssHref) {
    const css = (await get('/' + cssHref.replace(/^\//, ''))).text;
    check(
      /#060607/i.test(css) && !/#0b1220/i.test(css),
      'stylesheet has the black sky and no navy #0b1220'
    );
    check(/gis-fallback-btn\.is-wide/.test(css), 'stylesheet styles the labelled Google fallback');
    const rule = cssRule(css, '.signin-card .signin-email-panel.signin-sheet');
    check(
      /position:\s*static/.test(rule),
      'email panel is switched off as a popup (position: static)',
      rule.slice(0, 70)
    );
  }
  const jsSrc = (html.match(/<script[^>]+src="(dist\/app-bundle[^"]*\.js)"/) || [])[1];
  check(!!jsSrc, 'page loads the app bundle', jsSrc);
  if (jsSrc) {
    const js = (await get('/' + jsSrc)).text;
    check(/gisShape/.test(js), 'app bundle reads the Google button options (data-gis-*)');
  }
  const sw = (await get('/sw.js')).text;
  const v = Number((sw.match(/const CACHE = 'mmgr-shell-v(\d+)'/) || [])[1] || 0);
  check(
    v >= minSw && v > 0,
    'service worker cache version is current',
    'v' + v + ' (need >= ' + minSw + ')'
  );

  console.log(
    '\n' +
      (fails === 0
        ? 'LIVE SIGN-IN FIX IS DEPLOYED'
        : fails + ' CHECK(S) FAILED - the live site is NOT serving the fix')
  );
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => {
  console.error('probe could not complete: ' + e.message);
  process.exit(2);
});
