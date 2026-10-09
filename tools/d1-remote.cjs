#!/usr/bin/env node
// tools/d1-remote.cjs - read the LIVE D1 database and print clean rows.
//
//   node tools/d1-remote.cjs "SELECT rowid, owner_sub, status FROM cloud_subscriptions"
//   node tools/d1-remote.cjs --local "SELECT ..."        (local dev DB instead)
//   node tools/d1-remote.cjs --db other-db "SELECT ..."
//
// Why this exists: `wrangler d1 execute` prints a banner and warnings that
// contain "[" (for example "[WARNING] Processing wrangler.jsonc"), and its
// JSON is an ARRAY with one entry per statement: [ { results: [rows] } ].
// A parser that slices from the first "[" or reads `.results` on the outer
// array finds no rows - which is exactly how a session lost hours reading a
// table that had four rows in it. This wrapper does both parts correctly.
//
// READ-ONLY: anything that is not a single SELECT/PRAGMA is refused.
const { spawnSync } = require('node:child_process');

// stdout of wrangler -> array of rows. Tries every "[" until one parses, then
// flattens [{results:[...]}, ...] into one row list.
function parseWranglerRows(stdout) {
  const text = String(stdout || '');
  for (let i = text.indexOf('['); i !== -1; i = text.indexOf('[', i + 1)) {
    let parsed;
    try {
      parsed = JSON.parse(text.slice(i).trim());
    } catch (e) {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    if (parsed.length && parsed.every(s => s && typeof s === 'object' && 'results' in s))
      return parsed.reduce((all, s) => all.concat(s.results || []), []);
    if (parsed.length === 0) return [];
  }
  throw new Error('no JSON result found in wrangler output');
}

function isReadOnly(sql) {
  const s = String(sql || '')
    .trim()
    .replace(/;+\s*$/, '');
  return /^(select|pragma)\b/i.test(s) && s.indexOf(';') === -1;
}

function main() {
  const args = process.argv.slice(2);
  let db = 'my-manager-db';
  let where = '--remote';
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db') db = args[++i];
    else if (args[i] === '--local') where = '--local';
    else rest.push(args[i]);
  }
  const sql = rest.join(' ');
  if (!sql) {
    console.error('usage: node tools/d1-remote.cjs [--local] [--db NAME] "SELECT ..."');
    process.exit(2);
  }
  if (!isReadOnly(sql)) {
    console.error('refused: only a single SELECT or PRAGMA is allowed here');
    process.exit(2);
  }
  // 2026-10-08: the original `spawnSync('npx', [...], {shell:true})` form let the
  // shell re-split the SQL on its spaces, so wrangler saw `SELECT` and `1` as
  // separate arguments and refused the whole command ("Unknown argument: 1") on
  // every query. Spawn the LOCAL wrangler through node itself, exactly as
  // tools/deploy.cjs does: no shell, so the SQL stays ONE argv element.
  const wrangler = require('node:path').join(
    __dirname,
    '..',
    'node_modules',
    'wrangler',
    'bin',
    'wrangler.js'
  );
  const r = spawnSync(
    process.execPath,
    [wrangler, 'd1', 'execute', db, where, '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  );
  let rows;
  try {
    rows = parseWranglerRows(r.stdout);
  } catch (e) {
    console.error('could not read wrangler output (exit ' + r.status + '): ' + e.message);
    console.error('--- stdout (first 600 chars) ---\n' + String(r.stdout).slice(0, 600));
    console.error('--- stderr (first 600 chars) ---\n' + String(r.stderr).slice(0, 600));
    process.exit(1);
  }
  console.log('ROWS=' + rows.length);
  rows.forEach(function (row, i) {
    console.log('--- row ' + (i + 1) + ' ---');
    Object.keys(row).forEach(function (k) {
      console.log(k + '=' + row[k]);
    });
  });
}

module.exports = { parseWranglerRows, isReadOnly };
if (require.main === module) main();
