/* ============================================================
   My MaNaGeR - CSP origin coverage gate (E3, 2026-11-09)
   ------------------------------------------------------------
   A CSP is only as good as its allowlist. This gate scans every served HTML
   page and every browser-side source file for absolute http(s)/wss origins
   and fails when one is neither covered by the real policy nor named in the
   explicit exceptions table below.

   Why the real policy and not a copy: the strings are imported from
   worker.js through cspPoliciesForTooling(), so a new origin added to the
   policy is picked up automatically and a new origin added to the code is
   caught on the same run.

   Coverage is judged against the REPORT-ONLY policy (the candidate the
   observation window is testing), because that is the policy that must be
   complete before it can ever be enforced. Wildcard entries in the policy
   ('https://*.example.com') cover their subdomains.

   Usage:  node tools/qa-csp-origins.cjs
   Exit:   0 = every scanned origin is covered or explicitly excepted
           1 = at least one origin is uncovered
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');

// Origins that appear in the scanned files but are never browser fetches.
// Each one names WHY, so the list stays reviewable rather than becoming a
// dumping ground.
const EXCEPTIONS = {
  'http://www.w3.org': 'SVG/XML namespace identifier, never fetched',
  'http://schemas.openxmlformats.org': 'XLSX XML namespace identifier, never fetched',
  'https://schema.org': 'JSON-LD vocabulary identifier, never fetched',
  'https://mymanagerworkspace.com': 'canonical / Open Graph links, top-level navigation',
  'https://github.com': 'anchor links and a comment reference',
  'https://release-assets.githubusercontent.com':
    'named in the project.html meta CSP comment; the Worker header governs the page',
  'https://cdnjs.cloudflare.com': 'comment reference only',
  'http://404tutorial.com': 'anchor link in dashboard.html',
  'https://your-webhook.example.com': 'example string in a comment',
  'https://hooks.example.com': 'example string in a comment',
  'https://evil.com': 'negative-test fixture in signin.js',
  'http://evil.com': 'negative-test fixture in signin.js',
  'https://*.cdn.hf.co':
    'project.html meta CSP only; the Worker header governs, and the sweep decides whether the whisper redirect really needs it',
  'https://presence.internal': 'Durable Object service-binding URL, server-side only',
  'https://api.paddle.com': 'Worker-side billing call, not browser-fetched',
  'https://sandbox-api.paddle.com': 'Worker-side billing call, not browser-fetched',
  'https://api.lemonsqueezy.com': 'Worker-side billing call, not browser-fetched',
  'https://api.resend.com': 'Worker-side email call, not browser-fetched',
  'https://api.pwnedpasswords.com': 'Worker-side HIBP call, not browser-fetched',
  'https://cdn.jsdelivr.net': 'Worker-side FX feed, not browser-fetched',
  'https://latest.currency-api.pages.dev': 'Worker-side FX fallback feed, not browser-fetched'
};

const URL_RE = /https?:\/\/[A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]+/g;

function walk(dir, out) {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', '.wrangler', 'tmp', 'dist', '_archive'].includes(entry.name)) {
        continue;
      }
      walk(full, out);
    } else if (/\.(js|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
}

function scanFiles() {
  const files = [];
  for (const name of fs.readdirSync(ROOT)) {
    if (name.endsWith('.html')) {
      files.push(path.join(ROOT, name));
    }
  }
  walk(path.join(ROOT, 'js'), files);
  walk(path.join(ROOT, 'src'), files);
  return files;
}

function originsIn(file) {
  const source = fs.readFileSync(file, 'utf8');
  const found = new Set();
  const matches = source.match(URL_RE) || [];
  for (const raw of matches) {
    // A URL in prose or in an HTML attribute is often followed by ';', ','
    // or a closing bracket. Trim that punctuation before parsing.
    const cleaned = raw.replace(/[;,.)\]}]+$/, '');
    try {
      found.add(new URL(cleaned).origin);
    } catch (e) {
      /* not a URL after all */
    }
  }
  return found;
}

function policyOrigins(policy) {
  const covered = new Set();
  String(policy || '')
    .split(';')
    .forEach(function (part) {
      const tokens = part.trim().split(/\s+/).slice(1);
      tokens.forEach(function (token) {
        const clean = token.replace(/[;,.)\]}]+$/, '');
        if (clean.indexOf('://*.') !== -1) {
          // A wildcard host cannot go through new URL() reliably; keep the
          // token and let wildcardCovers() match subdomains against it.
          covered.add(clean.replace(/\/$/, ''));
          return;
        }
        if (/^https?:\/\//i.test(clean) || /^wss?:\/\//i.test(clean)) {
          try {
            covered.add(new URL(clean.replace(/\/$/, '')).origin);
          } catch (e) {
            /* ignore */
          }
        }
      });
    });
  return covered;
}

function wildcardCovers(origin, covered) {
  let host;
  try {
    host = new URL(origin).hostname;
  } catch (e) {
    return false;
  }
  for (const entry of covered) {
    if (entry.indexOf('*.') === -1) {
      continue;
    }
    const suffix = entry.replace('https://*.', '');
    if (host === suffix || host.endsWith('.' + suffix)) {
      return true;
    }
  }
  return false;
}

async function main() {
  const worker = await import(pathToFileURL(path.join(ROOT, 'worker.js')).href);
  const request = new Request('https://mymanagerworkspace.com/');
  const policies = worker.cspPoliciesForTooling(request, {});
  const covered = policyOrigins(policies.reportOnly || policies.enforced);

  const files = scanFiles();
  const uncovered = new Map();
  for (const file of files) {
    for (const origin of originsIn(file)) {
      if (covered.has(origin) || wildcardCovers(origin, covered) || EXCEPTIONS[origin]) {
        continue;
      }
      if (!uncovered.has(origin)) {
        uncovered.set(origin, []);
      }
      uncovered.get(origin).push(path.relative(ROOT, file));
    }
  }

  console.log('[csp-origins] files scanned: ' + files.length);
  console.log('[csp-origins] policy origins: ' + covered.size);
  console.log('[csp-origins] exceptions: ' + Object.keys(EXCEPTIONS).length);

  if (uncovered.size === 0) {
    console.log('[csp-origins] PASS: every scanned origin is covered or excepted');
    return 0;
  }
  for (const [origin, where] of uncovered) {
    console.log('[csp-origins] UNCOVERED ' + origin + '  (' + where.slice(0, 4).join(', ') + ')');
  }
  console.log('[csp-origins] FAIL: ' + uncovered.size + ' uncovered origin(s)');
  return 1;
}

main()
  .then(function (code) {
    process.exit(code);
  })
  .catch(function (e) {
    console.error('[csp-origins] ERROR: ' + (e && e.message));
    process.exit(1);
  });
