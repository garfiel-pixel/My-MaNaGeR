/* ============================================================
   My MaNaGeR — Export & File I/O
   Export modal, project file save/load, baseline save.
   Extracted from mmgr-app.js.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;
  const $ = U.$;

  function _toast(msg, type) { if (ns.App && ns.App.showToast) ns.App.showToast(msg, type); }
  function _R() { return ns.Render; }

  // ---- Export Modal ----
  function openOM() {
    const modal = $('om');
    const txt = $('om-txt');
    if (!modal || !txt) return;
    txt.value = ns.State.exportState();
    modal.classList.add('open');
  }

  function closeOM() {
    const modal = $('om');
    if (modal) modal.classList.remove('open');
  }

  function cpOut() {
    const txt = $('om-txt');
    if (txt) { U.copyToClipboard(txt.value); _toast('Copied to clipboard!', 'ok'); }
  }

  function loadClip() {
    navigator.clipboard.readText().then(text => {
      if (text && ns.State.importState(text)) {
        _R().renderAll();
        if (ns.Charter) ns.Charter.loadCharterData();
        if (ns.Sprint) ns.Sprint.loadSprintData();
        _toast('State loaded from clipboard!', 'ok');
      } else {
        _toast('Invalid state data in clipboard.', 'err');
      }
    }).catch(() => { _toast('Cannot read clipboard. Paste manually.', 'err'); });
  }

  // ---- File Import/Export ----
  function saveProjectFile() {
    const data = ns.State.exportState();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mmgr-project-' + ns.projectId + '-' + U.todayStr() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    ns.State.save(true, { backup: true });
    _R().renderDirtyIndicator();
    _toast('Project backed up to file!', 'ok');
  }

  function loadProjectFile(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      if (ns.State.importState(e.target.result)) {
        _R().renderAll();
        if (ns.Charter) ns.Charter.loadCharterData();
        if (ns.Sprint) ns.Sprint.loadSprintData();
        _toast('Project loaded!', 'ok');
      } else {
        _toast('Invalid project file.', 'err');
      }
    };
    reader.readAsText(file);
    ev.target.value = '';
  }

  function saveBaseline() {
    ns.State.saveBaseline();
    _toast('Baseline saved!', 'ok');
  }

  ns.AppExport = {
    openOM: openOM,
    closeOM: closeOM,
    cpOut: cpOut,
    loadClip: loadClip,
    saveProjectFile: saveProjectFile,
    loadProjectFile: loadProjectFile,
    saveBaseline: saveBaseline
  };
})(MMGR);
window.MMGR = MMGR;
