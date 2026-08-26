/* ============================================================
   chrome-launcher.cjs — cross-platform Chrome auto-detect
   ------------------------------------------------------------
   Shared utility for all qa-*.cjs scripts that need headless
   Chrome. Replaces the hardcoded Windows path in every script.

   Usage:
     const { chromePath, chromeArgs, BASE, PORT } = require('./chrome-launcher.cjs');

   Auto-detects Chrome on:
     - Windows: C:\Program Files\Google\Chrome\Application\chrome.exe
     - macOS: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
     - Linux: google-chrome, google-chrome-stable, chromium-browser

   Environment overrides:
     CHROME_PATH — explicit path to Chrome binary
     QA_PORT — server port (default 8765)
     CHROME_DEBUG_PORT — Chrome DevTools port (default 9228)
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PLATFORM = process.platform;

// ---- Chrome path auto-detect ----
function findChrome() {
  // 1. Environment override
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  // 2. Platform-specific defaults
  const candidates = [];

  if (PLATFORM === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    );
  } else if (PLATFORM === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    // Linux
    candidates.push(
      'google-chrome',
      'google-chrome-stable',
      'chromium-browser',
      'chromium'
    );
  }

  // 3. Try each candidate
  for (const c of candidates) {
    if (PLATFORM === 'linux' || PLATFORM === 'darwin') {
      // On Unix, check if the command exists in PATH
      try {
        execSync('which ' + JSON.stringify(c), { stdio: 'pipe' });
        return c;
      } catch (e) { /* not in PATH */ }
    } else {
      // On Windows, check file existence
      if (fs.existsSync(c)) return c;
    }
  }

  // 4. Fallback — let the caller handle the error
  return null;
}

// ---- Configuration ----
const CHROME = findChrome();
const PORT = parseInt(process.env.QA_PORT || '8765', 10);
const DEBUG_PORT = parseInt(process.env.CHROME_DEBUG_PORT || '9228', 10);
const BASE = process.env.QA_BASE || ('http://127.0.0.1:' + PORT);

// ---- Chrome launch arguments (headless, no-sandbox for CI) ----
function chromeArgs(extraArgs = []) {
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-background-networking',
    '--remote-debugging-port=' + DEBUG_PORT,
    '--user-data-dir=' + require('os').tmpdir() + '/mmgr-qa-' + Date.now()
  ];
  return args.concat(extraArgs);
}

// ---- Validation ----
function validateChrome() {
  if (!CHROME) {
    console.error('ERROR: Chrome not found. Set CHROME_PATH environment variable.');
    console.error('  Windows: C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    console.error('  macOS: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    console.error('  Linux: google-chrome (install via apt)');
    process.exit(1);
  }
  return CHROME;
}

module.exports = {
  chromePath: CHROME,
  chromeArgs,
  validateChrome,
  BASE,
  PORT,
  DEBUG_PORT,
  PLATFORM
};
