/* ============================================================
   wrangler-ci-helpers.cjs — shared WRANGLER_DEV_URL support
   ------------------------------------------------------------
   Test scripts that start their own wrangler dev can import this
   to skip local start when an external wrangler is already running
   (set via WRANGLER_DEV_URL env var in CI).

   Usage:
     const { USE_EXTERNAL, externalWranglerGuard, stopWranglerIfLocal } = require('./wrangler-ci-helpers.cjs');

   In startWrangler():
     if (externalWranglerGuard(log)) return;  // resolves immediately

   In stopWrangler():
     stopWranglerIfLocal(proc);  // only kills if not external
   ============================================================ */

const USE_EXTERNAL = !!process.env.WRANGLER_DEV_URL;

/**
 * Check if an external wrangler is available. If so, log and resolve immediately.
 * Call this at the TOP of startWrangler() — if it returns true, skip the local start.
 *
 * @param {function} log - logging function (e.g. (s) => process.stdout.write('[tag] ' + s + '\n'))
 * @returns {Promise<void>|null} A resolved promise if external, null if local start needed
 */
function externalWranglerGuard(log) {
  if (!USE_EXTERNAL) return null;
  log('using external wrangler at ' + process.env.WRANGLER_DEV_URL + ' (skipping local start)…');
  return (async () => {
    try {
      const r = await fetch(process.env.WRANGLER_DEV_URL + '/api/health');
      const body = await r.json().catch(() => null);
      if (r.ok && body && body.ok === true) return;
      throw new Error('health check failed: ' + r.status);
    } catch (e) {
      throw new Error('external wrangler not reachable: ' + e.message);
    }
  })();
}

/**
 * Kill a wrangler child process only if we started it (not external).
 *
 * @param {object|null} proc - the child process to kill
 */
function stopWranglerIfLocal(proc) {
  if (USE_EXTERNAL) return;
  try { proc && proc.kill(); } catch (e) {}
}

module.exports = { USE_EXTERNAL, externalWranglerGuard, stopWranglerIfLocal };
