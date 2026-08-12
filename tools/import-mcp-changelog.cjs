#!/usr/bin/env node
/* ============================================================
   My MaNaGeR — MCP → Cloud changelog importer (CLOUD-MCP-IMPORT)
   ------------------------------------------------------------
   Reads the MCP server's cloud-shaped sidecar changelog
   (<project>.mcp-changelog.json, written by mcp/server.mjs on every
   approved AI edit) and pushes its entries into the D1
   cloud_changelog via the owner-only Worker endpoint

     POST /api/cloud/projects/:id/changelog/import

   The Worker VERIFIES each entry's diffs against the live cloud
   snapshot before storing (stale/diverged entries are skipped and
   reported), so only AI edits that match what the cloud actually
   holds become rows — and those rows are revertible through the
   existing owner revert route (recordId-aware).

   Idempotency is server-side (UNIQUE import_key, migration 0005):
   re-running this script can never duplicate audit rows. A local
   ledger (<sidecar>.imported.json) is still kept so repeat runs
   skip already-imported entries instead of resending them.

   Usage:
     node tools/import-mcp-changelog.cjs \
       --file mcp/projects/demo.json \
       --url https://mymanager.example.com \
       --owner-code XXXX-XXXX-XXXX-XXXX
     env: MMGR_MCP_DIR (dir for --project-name), MMGR_CLOUD_URL,
          MMGR_OWNER_CODE
   Options:
     --file <path>          exported project JSON (sidecar is derived)
     --dir <dir>            with --project-name: MCP project directory
                            (default $MMGR_MCP_DIR or ./mcp/projects)
     --project-name <name>  mcp project file <name>.json in --dir
     --project-id <id>      cloud project id (default: state.projectId)
     --url <base>           Worker origin, no trailing slash
     --owner-code <code>    owner code (X-Owner-Code header)
     --max-id <n>           only import local entries with id <= n
     --ledger <path>        ledger file (default: <sidecar>.imported.json)
     --dry-run              print the plan, push nothing
     --help                 this message
   Exit codes: 0 ok / nothing to do, 1 bad usage or server error,
   2 auth/rate-limit failure.
   ============================================================ */

const fs = require('fs');
const path = require('path');

const USAGE = __filename;
function help() {
  console.log('My MaNaGeR MCP → cloud changelog importer\n' +
    'Usage: node tools/import-mcp-changelog.cjs --file <project.json> --url <origin> --owner-code <code> [--dry-run]\n' +
    '  --file <path>          exported project JSON (MCP sidecar derived from it)\n' +
    '  --dir <dir>            + --project-name: MCP project directory\n' +
    '  --project-name <name>  mcp project file <name>.json inside --dir\n' +
    '  --project-id <id>      cloud project id override (default: state.projectId)\n' +
    '  --url <base>           Worker origin, no trailing slash (env MMGR_CLOUD_URL)\n' +
    '  --owner-code <code>    owner code (env MMGR_OWNER_CODE)\n' +
    '  --max-id <n>           only import local entries with id <= n\n' +
    '  --ledger <path>        ledger file (default <sidecar>.imported.json)\n' +
    '  --dry-run              print the plan, push nothing\n' +
    '  --help                 this message\n' +
    'Exit codes: 0 ok / nothing to do, 1 usage/server error, 2 auth/rate-limit.');
  process.exit(0);
}

function fail(msg, code) { console.error('error: ' + msg); process.exit(code || 1); }

// ---- arg parsing ---------------------------------------------------------
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--help' || k === '-h') { help(); return null; }
    const v = argv[i + 1];
    if (k === '--file' || k === '--dir' || k === '--project-name' || k === '--project-id' ||
        k === '--url' || k === '--owner-code' || k === '--max-id' || k === '--ledger') {
      if (v === undefined) fail(k + ' requires a value');
      a[k.slice(2).replace(/-/g, '_')] = v; i++;
    } else if (k === '--dry-run') { a.dry_run = true; }
    else fail('unknown option ' + k);
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (!args) process.exit(0);

// ---- locate the sidecar + derive the cloud project id --------------------
let projectFile = args.file;
if (!projectFile) {
  const dir = args.dir || process.env.MMGR_MCP_DIR || path.join('mcp', 'projects');
  const name = args.project_name;
  if (!name) fail('provide --file <project.json>, or --dir + --project-name');
  projectFile = path.join(dir, name.replace(/\.json$/i, '') + '.json');
}
if (!fs.existsSync(projectFile)) fail('project file not found: ' + projectFile);

let state = {};
try { state = JSON.parse(fs.readFileSync(projectFile, 'utf8')); }
catch (e) { fail('cannot parse project file ' + projectFile + ': ' + e.message); }

const projectId = args.project_id || state.projectId;
if (!projectId || !/^[A-Za-z0-9_-]{1,64}$/.test(String(projectId))) {
  fail('cannot determine cloud project id (state.projectId missing or invalid) — pass --project-id');
}

const sidecar = projectFile.replace(/\.json$/i, '') + '.mcp-changelog.json';
if (!fs.existsSync(sidecar)) fail('no MCP changelog sidecar at ' + sidecar + ' — run the MCP server and approve some edits first');
let log = {};
try { log = JSON.parse(fs.readFileSync(sidecar, 'utf8')); }
catch (e) { fail('cannot parse sidecar ' + sidecar + ': ' + e.message); }
const entries = Array.isArray(log.entries) ? log.entries : [];
if (!entries.length) { console.log('[import] sidecar has no entries — nothing to import'); process.exit(0); }

const ledgerPath = args.ledger || sidecar.replace(/\.json$/i, '') + '.imported.json';
let ledger = { projectId: projectId, entries: {} };
try { ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); } catch (e) { /* first run */ }
if (!ledger.entries || typeof ledger.entries !== 'object') ledger.entries = {};

const maxId = args.max_id !== undefined ? Number(args.max_id) : Infinity;
const pending = entries.filter(function(e) {
  const id = Number(e.id);
  return Number.isInteger(id) && id >= 1 && !(String(id) in ledger.entries) && id <= maxId;
}).map(function(e) {
  return {
    localId: Number(e.id),
    entry_type: e.entry_type || 'edit',
    actor_type: e.actor_type || 'owner',
    actor_label: e.actor_label || 'mcp-ai',
    diffs_json: e.diffs_json !== undefined ? e.diffs_json : null,
    created_at: e.created_at || null
  };
});

console.log('[import] project=' + projectId + ' file=' + projectFile);
console.log('[import] sidecar entries=' + entries.length + ' already-imported=' + (entries.length - pending.length) + ' pending=' + pending.length);
if (!pending.length) { console.log('[import] nothing to import'); process.exit(0); }
for (let i = 0; i < pending.length; i++) {
  const n = Array.isArray(pending[i].diffs_json) ? pending[i].diffs_json.length
    : (typeof pending[i].diffs_json === 'string' ? '(json string)' : 0);
  console.log('  #' + pending[i].localId + ' ' + pending[i].entry_type + ' actor=' + pending[i].actor_label + ' diffs=' + n + ' at=' + (pending[i].created_at || '?'));
}

const url = (args.url || process.env.MMGR_CLOUD_URL || '').replace(/\/+$/, '');
if (!url) fail('provide --url <origin> (or set MMGR_CLOUD_URL)');
const ownerCode = args.owner_code || process.env.MMGR_OWNER_CODE || '';
if (!ownerCode) fail('provide --owner-code <code> (or set MMGR_OWNER_CODE)');

if (args.dry_run) { console.log('[import] DRY RUN — ' + pending.length + ' entries would be imported (no request sent)'); process.exit(0); }

// ---- push ----------------------------------------------------------------
(async () => {
  let res;
  try {
    res = await fetch(url + '/api/cloud/projects/' + encodeURIComponent(projectId) + '/changelog/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerCode },
      body: JSON.stringify({ entries: pending })
    });
  } catch (e) {
    fail('cannot reach ' + url + ' (' + e.message + ')');
  }
  let body = null;
  try { body = await res.json(); } catch (e) { /* non-JSON */ }
  if (res.status === 403) fail('owner code rejected for project ' + projectId + ' (403)', 2);
  if (res.status === 429) fail('rate limited — ' + (body && body.error || 'try again in a minute'), 2);
  if (!res.ok) fail('import failed (HTTP ' + res.status + '): ' + JSON.stringify(body).slice(0, 300));
  const b = body || {};
  for (let i = 0; i < (b.imported || []).length; i++) {
    const im = b.imported[i];
    ledger.entries[String(im.localId)] = { cloudId: im.cloudId, at: new Date().toISOString() };
  }
  try {
    const tmp = ledgerPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2));
    fs.renameSync(tmp, ledgerPath);
  } catch (e) { console.warn('[import] warn: ledger not written (' + e.message + ') — server dedupe still prevents duplicates'); }
  console.log('[import] imported=' + (b.imported || []).length + ' skipped=' + (b.skipped || []).length);
  for (let i = 0; i < (b.imported || []).length; i++) {
    const im = b.imported[i];
    console.log('  OK  #' + im.localId + ' -> cloud entry ' + im.cloudId + ' (' + im.type + (im.section ? ', ' + im.section : '') + ')');
  }
  for (let i = 0; i < (b.skipped || []).length; i++) {
    const sk = b.skipped[i];
    console.log('  --  #' + sk.localId + ' skipped: ' + sk.reason);
  }
  const failed = (b.skipped || []).filter(function(s) { return s.reason !== 'already imported'; });
  if ((b.imported || []).length === 0 && failed.length) {
    console.error('[import] nothing imported — all pending entries were skipped (see reasons above)');
    process.exit(2);
  }
  process.exit(0);
})().catch(function(e) { fail('unexpected error: ' + (e && e.stack || e)); });
