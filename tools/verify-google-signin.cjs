/* ============================================================
   My MaNaGeR — Google sign-in wiring + domain gate (owner 2026-10-31)
   ------------------------------------------------------------
   WHY THIS EXISTS
   On 2026-10-24 the Worker began refusing every real Google sign-in: the
   tokeninfo endpoint serialises `email_verified` as the STRING "true" and the
   verifier compared it with boolean `true`. CI stayed green for a week because
   the only harness that exercises the route faked the wire shape. The owner
   found it by signing out and being unable to sign back in: the account
   chooser opened, the credential came back, the Worker answered 401, and the
   page said nothing.

   The BEHAVIOURAL half of the fix is `tools/verify-auth-worker.mjs`, which now
   runs the real tokeninfo serialisation and names the regression. This file is
   the CONFIGURATION half: the identity and origin wiring that no unit test can
   see, including the Google Console setting that lives outside this repo.

   ARMS
     1. One Client ID. src/auth/google.js, js/mmgr-google-auth.js,
        js/mmgr-cloud.js, wrangler.jsonc, wrangler.ci.jsonc and the harness
        must all carry the SAME public client ID, in the documented shape.
     2. The served CSP still allows Google. accounts.google.com in script-src
        and frame-src, oauth2.googleapis.com in connect-src (the server call
        that validates the credential), in the document policy that ships.
     3. Every page that loads the GIS script can actually sign in: it has the
        #google-signin-button mount, and the module that drives it is loaded
        (directly, or inside the bundle the page references).
     4. The domain checklist tracks the site's domains. Every hostname this
        repo claims as canonical (rel=canonical, sitemap.xml, robots.txt) must
        appear in docs/GOOGLE-SIGNIN-SETUP.md's Authorized JavaScript Origins,
        alongside the two local dev origins. A new domain therefore fails here
        until the Google Console checklist is updated with it, which is the
        "domain issue" this gate exists to prevent.
     5. The verifier keeps the normaliser. A static tripwire against the exact
        comparison that broke production.

   This gate proves what the repo controls. It cannot read the Google Console:
   arm 4 keeps the written record of that setting in step with the code.

   Usage:  node tools/verify-google-signin.cjs
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failed = 0;
const fail = msg => {
  console.log('  FAIL  ' + msg);
  failed++;
};
const pass = msg => console.log('  PASS  ' + msg);
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(ROOT, rel));

const CLIENT_ID_RE = /^[0-9]{6,}-[a-z0-9]{6,}\.apps\.googleusercontent\.com$/;

// ---- ARM 1: one client ID everywhere --------------------------------------
console.log('\n=== 1. Client ID is identical wherever it is written ===');

const SOURCES = [
  ['src/auth/google.js', /const GOOGLE_CLIENT_ID = '([^']+)'/],
  ['js/mmgr-google-auth.js', /const CLIENT_ID = '([^']+)'/],
  ['js/mmgr-cloud.js', /const CLIENT_ID = '([^']+)'/],
  ['wrangler.jsonc', /"GOOGLE_CLIENT_ID":\s*"([^"]+)"/],
  ['wrangler.ci.jsonc', /"GOOGLE_CLIENT_ID":\s*"([^"]+)"/],
  ['tools/verify-auth-worker.mjs', /const PUBLIC_CLIENT_ID = '([^']+)'/]
];

const found = [];
for (const [file, re] of SOURCES) {
  if (!exists(file)) {
    fail(file + ' is missing');
    continue;
  }
  const m = read(file).match(re);
  if (!m) {
    fail(file + ' carries no readable client ID');
    continue;
  }
  found.push({ file, id: m[1] });
}
const ids = new Set(found.map(f => f.id));
if (ids.size === 1) {
  pass(found.length + ' files carry one client ID');
} else {
  fail('client IDs disagree: ' + found.map(f => f.file + '=' + f.id).join(', '));
}
for (const f of found) {
  if (!CLIENT_ID_RE.test(f.id)) {
    fail(f.file + ' client ID is not in the documented shape');
  }
}
if (found.length && found.every(f => CLIENT_ID_RE.test(f.id))) {
  pass('client ID shape matches the Google client ID form');
}

// ---- ARM 2: the served CSP still allows Google ----------------------------
console.log('\n=== 2. Served CSP allows the sign-in origins ===');

const workerSrc = read('worker.js');
const cspBlock = (workerSrc.match(/const CSP = \[([\s\S]*?)\]\.join/) || [])[1] || '';
if (!cspBlock) {
  fail('worker.js has no document CSP block');
} else {
  const scriptSrc = (cspBlock.match(/"script-src [^"]*"/) || [''])[0];
  const connectSrc = (cspBlock.match(/"connect-src [^"]*"/) || [''])[0];
  const frameSrc = (cspBlock.match(/'frame-src [^']*'/) || [''])[0];
  const arms = [
    [
      'script-src allows accounts.google.com (the GIS script)',
      scriptSrc.includes('https://accounts.google.com')
    ],
    [
      'connect-src allows oauth2.googleapis.com (token verification)',
      connectSrc.includes('https://oauth2.googleapis.com')
    ],
    [
      'connect-src allows accounts.google.com (GIS fetches)',
      connectSrc.includes('https://accounts.google.com')
    ],
    [
      'frame-src allows accounts.google.com (the account chooser)',
      frameSrc.includes('https://accounts.google.com')
    ],
    ['img-src allows the Google avatar host', cspBlock.includes('https://*.googleusercontent.com')]
  ];
  arms.forEach(([name, ok]) => (ok ? pass(name) : fail(name)));
}

// ---- ARM 3: every GIS page has a mount and a module ------------------------
console.log('\n=== 3. Every page that loads GIS can finish a sign-in ===');

const BUNDLE = 'dist/app-bundle.js';
const buildSrc = read('build.js');
function bundleModules(name) {
  const m = buildSrc.match(new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\];'));
  return m ? m[1] : '';
}
// app.html and signin.html load dist/app-bundle.js (APP_LAUNCHER_MODULES);
// project.html loads dist/bundle.js (APP_MODULES). The module must ride both,
// or the page's own script tag is the only thing standing between a GIS page
// and a dead Google button.
const inLauncher = bundleModules('APP_LAUNCHER_MODULES').includes("'js/mmgr-google-auth.js'");
const inProject = bundleModules('APP_MODULES').includes("'js/mmgr-google-auth.js'");
if (inLauncher && inProject) {
  pass('build.js carries the module in the project and app-launcher bundles');
} else {
  fail(
    'build.js module lists are missing js/mmgr-google-auth.js (project=' +
      inProject +
      ', launcher=' +
      inLauncher +
      ')'
  );
}
if (exists(BUNDLE)) {
  pass(BUNDLE + ' is built');
} else {
  fail(BUNDLE + ' is missing (run node build.js)');
}
const pages = fs
  .readdirSync(ROOT)
  .filter(f => f.endsWith('.html'))
  .filter(f => read(f).includes('accounts.google.com/gsi/client'));
if (!pages.length) {
  fail('no page loads the GIS script, which cannot be right');
}
for (const page of pages) {
  const html = read(page);
  const hasHost = /id="google-signin-button"/.test(html);
  const direct = /src="js\/mmgr-google-auth\.js"/.test(html);
  const viaBundle = /src="dist\/app-bundle\.js"/.test(html)
    ? inLauncher
    : /src="dist\/bundle\.js"/.test(html)
      ? inProject
      : false;
  if (!hasHost) {
    fail(page + ' loads GIS but has no #google-signin-button mount');
  } else if (!direct && !viaBundle) {
    fail(page + ' loads GIS but neither the module nor the bundle that carries it');
  } else {
    pass(page + ' (mount + module)');
  }
}

// ---- ARM 4: the domain checklist tracks the site's domains ----------------
console.log('\n=== 4. Authorized JavaScript Origins list covers every site domain ===');

const DOC = 'docs/GOOGLE-SIGNIN-SETUP.md';
if (!exists(DOC)) {
  fail(DOC + ' is missing (it is the written record of the Google Console setting)');
} else {
  const doc = read(DOC);
  const hosts = new Set();
  for (const f of fs.readdirSync(ROOT).filter(x => x.endsWith('.html'))) {
    const m = read(f).match(/rel="canonical" href="https:\/\/([^/"]+)/);
    if (m) {
      hosts.add(m[1].toLowerCase());
    }
  }
  if (exists('sitemap.xml')) {
    for (const m of read('sitemap.xml').matchAll(/<loc>\s*https:\/\/([^/<\s]+)/g)) {
      hosts.add(m[1].toLowerCase());
    }
  }
  if (exists('robots.txt')) {
    for (const m of read('robots.txt').matchAll(/Sitemap:\s*https:\/\/([^/\s]+)/gi)) {
      hosts.add(m[1].toLowerCase());
    }
  }
  if (!hosts.size) {
    fail('no canonical hostname found in the repo to check against');
  }
  for (const host of [...hosts].sort()) {
    const origin = 'https://' + host;
    if (doc.includes(origin)) {
      pass('checklist names ' + origin);
    } else {
      fail('checklist does not name ' + origin + ' (' + DOC + ', Authorized JavaScript Origins)');
    }
  }
  for (const dev of ['http://localhost:8765', 'http://localhost:8787']) {
    if (doc.includes(dev)) {
      pass('checklist names the local dev origin ' + dev);
    } else {
      fail('checklist does not name the local dev origin ' + dev);
    }
  }
  if (/no\s+redirect\s+uri/i.test(doc) || /Redirect URI/i.test(doc)) {
    pass('checklist states that the GIS flow uses no redirect URI');
  } else {
    fail('checklist does not say that the GIS popup flow uses no redirect URI');
  }
}

// ---- ARM 5: the verifier keeps the normaliser -----------------------------
console.log('\n=== 5. The verifier reads the tokeninfo wire shape ===');

const googleSrc = read('src/auth/google.js');
// Strip comment lines before the tripwire: the FILE HEADER documents the bug
// it fixes, and a naive scan of the prose would fail the gate it describes.
const googleCode = googleSrc
  .split('\n')
  .filter(line => {
    const t = line.trim();
    return t && t.indexOf('//') !== 0 && t.indexOf('*') !== 0 && t.indexOf('/*') !== 0;
  })
  .join('\n');
if (/email_verified\s*!==\s*true/.test(googleCode)) {
  fail('src/auth/google.js compares email_verified with boolean true (tokeninfo sends a string)');
} else {
  pass('no boolean-only email_verified comparison');
}
if (/emailVerified\(payload\.email_verified\)/.test(googleCode)) {
  pass('email_verified goes through the normaliser');
} else {
  fail('src/auth/google.js no longer routes email_verified through emailVerified()');
}
if (/idTokenClaims\(idToken\)/.test(googleCode)) {
  pass('the nonce claim is read from the ID token itself');
} else {
  fail('src/auth/google.js no longer reads the nonce claim from the ID token');
}

console.log('\n' + (failed ? failed + ' failed' : 'all checks passed'));
process.exit(failed ? 1 : 0);
