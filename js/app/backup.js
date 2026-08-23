/* ============================================================
   My MaNaGeR — Backup & Cloud-Sync UI
   Header backup indicator, auto-save debounce, backup popover.
   Extracted from mmgr-app.js.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;
  const $ = U.$;

  function _toast(msg, type) { if (ns.App && ns.App.showToast) ns.App.showToast(msg, type); }

  // Background cloud auto-sync debounce
  let _cloudAutoTimer = null;
  const CLOUD_AUTO_IDLE_MS = 25000;

  function cloudLinked() {
    const C = window.MMGR.Cloud;
    if (!C) return false;
    if (C.getCode && C.getCode()) return true;
    if (C.getECode && C.getECode()) return true;
    return false;
  }

  function scheduleCloudAutoSave() {
    if (!cloudLinked()) return;
    if (_cloudAutoTimer) clearTimeout(_cloudAutoTimer);
    _cloudAutoTimer = setTimeout(function() {
      _cloudAutoTimer = null;
      const C = window.MMGR.Cloud;
      if (C && C.autoSaveToCloud) { try { C.autoSaveToCloud(); } catch (e) { /* never throws */ } }
    }, CLOUD_AUTO_IDLE_MS);
  }

  function flushCloudAutoSave() {
    if (!_cloudAutoTimer) return;
    clearTimeout(_cloudAutoTimer);
    _cloudAutoTimer = null;
    if (!cloudLinked()) return;
    const C = window.MMGR.Cloud;
    if (C && C.autoSaveToCloud) { try { C.autoSaveToCloud({ keepalive: true }); } catch (e) { /* never throws */ } }
  }
  window.addEventListener('pagehide', flushCloudAutoSave);

  function bkToggle() {
    const pop = $('bk-pop');
    const ind = $('dirty-ind');
    if (!pop) return;
    if (pop.hidden) {
      bkSyncHint();
      pop.hidden = false;
      if (ind) ind.setAttribute('aria-expanded', 'true');
    } else {
      pop.hidden = true;
      if (ind) ind.setAttribute('aria-expanded', 'false');
    }
  }

  function bkClose() {
    const pop = $('bk-pop');
    const ind = $('dirty-ind');
    if (pop && !pop.hidden) pop.hidden = true;
    if (ind) ind.setAttribute('aria-expanded', 'false');
  }

  function bkSyncHint() {
    const el = $('bk-cloud-hint');
    if (!el) return;
    const C = window.MMGR.Cloud;
    el.textContent = (C && C.getCode && C.getCode())
      ? 'Cloud-backed project — snapshots auto-sync to the cloud as you work.'
      : 'File backup is optional — save a .json copy whenever you\u2019re ready (e.g. at the end of a task). Link to the cloud once in Settings for automatic backups.';
  }

  function bkCloud() {
    const C = window.MMGR.Cloud;
    bkClose();
    if (C && C.getCode && C.getCode()) {
      if (C.saveToCloud) C.saveToCloud();
    } else {
      // Not linked yet — open the drawer at the Cloud Backup section
      if (ns.App && ns.App.openDrwToSave) ns.App.openDrwToSave();
    }
  }

  ns.AppBackup = {
    cloudLinked: cloudLinked,
    scheduleCloudAutoSave: scheduleCloudAutoSave,
    flushCloudAutoSave: flushCloudAutoSave,
    bkToggle: bkToggle,
    bkClose: bkClose,
    bkSyncHint: bkSyncHint,
    bkCloud: bkCloud
  };
})(MMGR);
window.MMGR = MMGR;
