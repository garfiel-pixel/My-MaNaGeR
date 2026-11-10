/* ============================================================
   My MaNaGeR , Backup & Cloud-Sync UI
   Header backup indicator, auto-save debounce, backup popover.
   Extracted from mmgr-app.js.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const U = ns.Utils;
  const $ = U.$;

  function _toast(msg, type) {
    if (ns.App && ns.App.showToast) {
      ns.App.showToast(msg, type);
    }
  }

  // Background cloud auto-sync debounce
  let _cloudAutoTimer = null;
  const CLOUD_AUTO_IDLE_MS = 25000;

  // Wave 2 (owner 2026-11-10): a session-owner project holds NO local code -
  // the Google session is the credential. The old check looked only at codes,
  // so a cloud project opened from the launcher (signed in, no code) never
  // scheduled a background push and "should naturally update" was false.
  // activeCredential() answers for every credential shape the save path uses.
  function cloudLinked() {
    const C = window.MMGR.Cloud;
    if (!C) {
      return false;
    }
    if (C.activeCredential) {
      try {
        if (C.activeCredential()) {
          return true;
        }
      } catch (e) {
        /* fall through to the code checks */
      }
    }
    if (C.getCode && C.getCode()) {
      return true;
    }
    if (C.getECode && C.getECode()) {
      return true;
    }
    return false;
  }

  function scheduleCloudAutoSave() {
    if (cloudLinked()) {
      armCloudAutoSave();
      return;
    }
    // The session probe has not settled yet (first seconds of a boot). Ask
    // the module to settle it once, then arm only if the project really is
    // linked - an unlinked project must not start a probe on every edit.
    const C = window.MMGR.Cloud;
    if (!C || !C.ensureLinked) {
      return;
    }
    Promise.resolve(C.ensureLinked()).then(
      function (ok) {
        if (ok) {
          armCloudAutoSave();
        }
      },
      function () {
        /* offline - nothing to schedule */
      }
    );
  }

  function armCloudAutoSave() {
    if (_cloudAutoTimer) {
      clearTimeout(_cloudAutoTimer);
    }
    _cloudAutoTimer = setTimeout(function () {
      _cloudAutoTimer = null;
      const C = window.MMGR.Cloud;
      if (C && C.autoSaveToCloud) {
        try {
          C.autoSaveToCloud();
        } catch (e) {
          /* never throws */
        }
      }
    }, CLOUD_AUTO_IDLE_MS);
  }

  function flushCloudAutoSave() {
    if (!_cloudAutoTimer) {
      return;
    }
    clearTimeout(_cloudAutoTimer);
    _cloudAutoTimer = null;
    if (!cloudLinked()) {
      return;
    }
    const C = window.MMGR.Cloud;
    if (C && C.autoSaveToCloud) {
      try {
        C.autoSaveToCloud({ keepalive: true });
      } catch (e) {
        /* never throws */
      }
    }
  }
  window.addEventListener('pagehide', flushCloudAutoSave);

  function bkToggle() {
    const pop = $('bk-pop');
    const ind = $('dirty-ind');
    if (!pop) {
      return;
    }
    if (pop.hidden) {
      bkSyncHint();
      pop.hidden = false;
      if (ind) {
        ind.setAttribute('aria-expanded', 'true');
      }
    } else {
      pop.hidden = true;
      if (ind) {
        ind.setAttribute('aria-expanded', 'false');
      }
    }
  }

  function bkClose() {
    const pop = $('bk-pop');
    const ind = $('dirty-ind');
    if (pop && !pop.hidden) {
      pop.hidden = true;
    }
    if (ind) {
      ind.setAttribute('aria-expanded', 'false');
    }
  }

  function bkSyncHint() {
    const el = $('bk-cloud-hint');
    if (!el) {
      return;
    }
    const C = window.MMGR.Cloud;
    // Wave 2: say which contract this project is on before anything else.
    const hasCred = !!(
      C &&
      ((C.getCode && C.getCode()) ||
        (C.getECode && C.getECode()) ||
        (C._isSessionOwner && C._isSessionOwner()))
    );
    if (hasCred && C.getSyncMode && C.getSyncMode() === 'manual') {
      el.textContent =
        'Manual cloud sync , changes stay on this device until you close a snapshot.';
      return;
    }
    el.textContent =
      C && C.getCode && C.getCode()
        ? 'Cloud-backed project , snapshots auto-sync to the cloud as you work.'
        : C && C.getECode && C.getECode()
          ? 'Cloud project via code , your scoped edits sync to the cloud (editor saves wait for the owner\u2019s review).'
          : 'Sign in with Google to back this project up to the cloud , sign-in opens right after you click Backup to cloud. File backup stays optional either way.';
  }

  function bkCloud() {
    const C = window.MMGR.Cloud;
    bkClose();
    if (C && C.getCode && C.getCode()) {
      // Already linked with an owner code on this device , push the snapshot.
      if (C.saveToCloud) {
        C.saveToCloud();
      }
    } else if (C && C.getECode && C.getECode()) {
      // Editor code held , save flows through the owner-review path.
      if (C.saveToCloud) {
        C.saveToCloud();
      }
    } else if (C && C._isSessionOwner && C._isSessionOwner()) {
      // Wave 2: a signed-in account owner holds no code; the session is the
      // credential, so this is a normal save - not a create.
      if (C.saveToCloud) {
        C.saveToCloud();
      }
    } else {
      // OWNER 2026-09-20 (no-op fix + CI phase1 C4c contract): "Backup to
      // cloud" on a device with no credential must DO something. Create
      // itself works anonymously (the owner code it hands back IS the
      // credential - phase1 encodes that), so the pill routes a signed-out
      // visitor to sign-in at this exact moment; a signed-in device calls
      // Create directly. Either way the drawer opens so the "what next"
      // surface is visible. checkMe is chained AFTER the drawer render:
      // signIn() needs #cloud-gis-host, which only exists once the cloud
      // section has rendered.
      openDrwToSave(function () {
        if (C && C.checkMe) {
          Promise.resolve(C.checkMe(false)).then(
            function (signedIn) {
              if (signedIn) {
                if (C.createProject) {
                  C.createProject();
                }
              } else if (C.signIn) {
                Promise.resolve(C.signIn()).catch(function () {});
              }
            },
            function () {}
          );
        } else if (C && C.createProject) {
          C.createProject(); // no checkMe on this host - behave as before
        }
      });
    }
  }

  // Unlinked drawer open: land on the Controls tab (monolith mechanics),
  // render the cloud section so its sign-in surface exists, then bring the
  // sign-in button into view - the "what do I do next" is visible
  // immediately instead of a bare drawer. `done` (optional) runs after the
  // render settles so callers can chain sign-in prompts on the rendered host.
  function openDrwToSave(done) {
    if (ns.App && ns.App.openDrwToSaveMechanics) {
      ns.App.openDrwToSaveMechanics();
    }
    const C = window.MMGR.Cloud;
    if (!C) {
      if (done) {
        done();
      }
      return;
    }
    const focusSignin = function () {
      const btn =
        document.querySelector('#ctrl-share [data-action="cloudSignIn"]') ||
        document.querySelector('#cloud-section [data-action="cloudSignIn"]');
      if (btn) {
        try {
          btn.scrollIntoView({ block: 'center', behavior: 'auto' });
        } catch (e) {
          try {
            btn.scrollIntoView();
          } catch (e2) {}
        }
        try {
          btn.focus();
        } catch (e) {}
      }
    };
    const settle = function () {
      requestAnimationFrame(function () {
        focusSignin();
        if (done) {
          done(focusSignin);
        }
      });
    };
    if (C.render) {
      Promise.resolve(C.render()).then(settle, settle);
    } else {
      settle();
    }
  }

  // Wave 2 (owner 2026-11-10): a MANUAL project publishes only on demand.
  // The popover row is hidden unless this project's sync mode is manual (see
  // Render.renderDirtyIndicator); this is the click that pushes the waiting
  // snapshot. `force` bypasses autoSaveToCloud's own manual guard.
  function bkCloseSnapshot() {
    const C = window.MMGR.Cloud;
    bkClose();
    if (!C || !C.autoSaveToCloud) {
      return;
    }
    Promise.resolve(C.autoSaveToCloud({ force: true })).then(
      function (ok) {
        _toast(
          ok ? 'Snapshot closed. The cloud copy is up to date.' : 'Could not publish the snapshot.',
          ok ? 'ok' : 'error'
        );
      },
      function () {
        _toast('Could not publish the snapshot.', 'error');
      }
    );
  }

  ns.AppBackup = {
    cloudLinked: cloudLinked,
    scheduleCloudAutoSave: scheduleCloudAutoSave,
    flushCloudAutoSave: flushCloudAutoSave,
    bkToggle: bkToggle,
    bkClose: bkClose,
    bkSyncHint: bkSyncHint,
    bkCloud: bkCloud,
    bkCloseSnapshot: bkCloseSnapshot
  };
})(MMGR);
window.MMGR = MMGR;
