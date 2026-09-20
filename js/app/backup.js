/* ============================================================
   My MaNaGeR , Backup & Cloud-Sync UI
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
      ? 'Cloud-backed project , snapshots auto-sync to the cloud as you work.'
      : (C && C.getECode && C.getECode())
        ? 'Cloud project via code , your scoped edits sync to the cloud (editor saves wait for the owner\u2019s review).'
        : 'Sign in with Google to back this project up to the cloud , sign-in opens right after you click Backup to cloud. File backup stays optional either way.';
  }

  function bkCloud() {
    const C = window.MMGR.Cloud;
    bkClose();
    if (C && C.getCode && C.getCode()) {
      // Already linked with an owner code on this device , push the snapshot.
      if (C.saveToCloud) C.saveToCloud();
    } else if (C && C.getECode && C.getECode()) {
      // Editor code held , save flows through the owner-review path.
      if (C.saveToCloud) C.saveToCloud();
    } else {
      // OWNER 2026-09-19 (no-op fix): "Backup to cloud" on a device with no
      // credential must DO something. The link itself (Create) needs the
      // Google session, so route the user to sign-in at this exact moment;
      // the session-owner render path then answers every later click, and
      // Create runs automatically right after sign-in completes.
      openDrwToSave();
      if (C && C.createProject) C.createProject();
    }
  }

  // Unlinked drawer open: jump the user to the sign-in affordance inside the
  // Cloud Backup section so the "what do I do next" is visible immediately.
  function openDrwToSave() {
    if (ns.App && ns.App.openDrwToSave) ns.App.openDrwToSave();
    const C = window.MMGR.Cloud;
    if (C && C.signIn) { try { C.signIn(); } catch (e) { /* the section still shows its own guidance */ } }
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
