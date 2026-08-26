/* ============================================================
 My MaNaGeR, Cloud Review Queue
 Owner review list, accept/reject, editor status.
 Extracted from mmgr-cloud.js.
 ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const C = ns.Cloud;
  const $ = function(id) { return document.getElementById(id); };
  function pid() { return C._pid(); }
  function esc(v) { return C._esc(v); }
  function getCode() { return C.getCode(); }
  function getECode() { return C.getECode(); }
  function setStatus(msg, kind) { C._setStatus(msg, kind); }
  function renderDiffPanel(en) { return C._renderDiffPanel(en); }

  async function cloudReviewList() {
 const wrap = $('cloud-review-list');
 if (!wrap) return;
 const code = getCode();
 if (!code) { wrap.innerHTML = '<div class="sr-hint">Owner code required.</div>'; return; }
 try {
 const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/reviews', {
 method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': code }
 });
 const data = await res.json().catch(function() { return {}; });
 if (!res.ok || !data.ok) { wrap.innerHTML = '<div class="sr-hint">Could not load proposals.</div>'; return; }
 const props = data.proposals || [];
 if (!props.length) {
 wrap.innerHTML = '<div class="sr-hint">Nothing waiting for review - edits from editor codes and AI imports land here until you accept them.</div>';
 return;
 }
 wrap.innerHTML = props.map(function(p) {
 const isMCP = p.sourceType === 'mcp';
 const src = isMCP
 ? '<span class="badge-ai"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-sparkle"></use></svg> MCP AI</span> ' + esc(p.sourceLabel || 'AI edit')
 : '<strong>' + esc(p.sourceLabel || 'Editor') + '</strong> (editor)';
 const when = String(p.proposedAt || '').slice(0, 19).replace('T', ' ');
 const badge = MMGR.Components && MMGR.Components.reviewBadge
 ? MMGR.Components.reviewBadge(p.status)
 : '<span class="badge" style="color:var(--amber);border:1px solid rgba(var(--amber-rgb),.35);background:rgba(var(--amber-rgb),.12)">' + (p.status || 'pending') + '</span>';
 let actions = '';
 if (p.status === 'pending') {
 actions = '<button class="btn btn-g btn-s" data-action="cloudReviewAccept" data-id="' + p.id + '"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg> Accept</button>' +
 '<button class="btn btn-o btn-s" data-action="cloudReviewReject" data-id="' + p.id + '"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> Reject</button>';
 } else {
 const decided = (p.status === 'accepted' ? 'Accepted ' : 'Rejected ') + String(p.decidedAt || '').slice(0, 19).replace('T', ' ');
 actions = '<span class="sr-hint" style="margin:0">' + esc(decided) + (p.decidedBy ? ' by ' + esc(p.decidedBy) : '') + '</span>';
 }
 const nDiffs = Array.isArray(p.diffs) ? p.diffs.length : 0;
 const diffsToggle = nDiffs
 ? '<button type="button" class="cl-toggle" data-action="cloudReviewToggleDiffs" data-id="' + p.id + '" aria-expanded="false" aria-controls="rv-diffs-' + p.id + '" aria-label="Show field diffs for proposal ' + p.id + '" title="Show field-level before/after values"></button>'
 : '';
 const diffsPanel = nDiffs
 ? '<div class="cl-diffs is-hide" id="rv-diffs-' + p.id + '">' + renderDiffPanel({ diffs: p.diffs }) + '</div>'
 : '';
 return '<div class="sr" style="border:1px solid var(--border);border-radius:var(--radius);padding:6px 8px;margin-top:6px">' +
 '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' + src + badge + diffsToggle +
 '<span class="sr-hint" style="margin:0">proposed ' + esc(when) + '</span>' +
 '<span style="margin-left:auto;display:flex;align-items:center;gap:6px;flex-wrap:wrap">' + actions + '</span>' +
 '</div>' + diffsPanel +
 '</div>';
 }).join('');
 } catch (e) {
 wrap.innerHTML = '<div class="sr-hint">Cloud unavailable here.</div>';
 }
  }

  async function cloudReviewMine() {
 const wrap = $('cloud-review-mine');
 if (!wrap) return;
 try {
 const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/reviews?mine=1', {
 method: 'GET', credentials: 'same-origin', headers: { 'X-Editor-Code': getECode() }
 });
 const data = await res.json().catch(function() { return {}; });
 if (!res.ok || !data.ok) { wrap.innerHTML = ''; return; }
 const props = data.proposals || [];
 if (!props.length) { wrap.innerHTML = '<div class="sr-hint">Your edits wait for the admin\u2019s review before reaching the cloud - status appears here after you save.</div>'; return; }
 const latest = props[0];
 const when = String(latest.proposedAt || '').slice(0, 19).replace('T', ' ');
 const statusTxt = latest.status === 'pending' ? 'pending the admin\u2019s review (proposed ' + when + ')'
 : latest.status === 'accepted' ? 'accepted on ' + String(latest.decidedAt || '').slice(0, 19).replace('T', ' ') + ' - it is now in the cloud project'
 : 'rejected on ' + String(latest.decidedAt || '').slice(0, 19).replace('T', ' ') + ' - it did not reach the project';
 wrap.innerHTML = '<div class="sr-hint" style="margin-top:6px">Your last change: <strong>' + esc(statusTxt) + '</strong>.</div>';
 } catch (e) {
 wrap.innerHTML = '';
 }
  }

  function reviewToggleDiffs(id) {
 const panel = $('rv-diffs-' + id);
 if (!panel) return;
 const show = panel.classList.contains('is-hide');
 panel.classList.toggle('is-hide');
 const btn = document.querySelector('#cloud-review-list [data-action="cloudReviewToggleDiffs"][data-id="' + String(id).replace(/"/g, '&quot;') + '"]');
 if (btn) {
 btn.classList.toggle('open', show);
 btn.setAttribute('aria-expanded', show ? 'true' : 'false');
 }
  }

  async function cloudReviewAccept(id) {
 const code = getCode();
 if (!code || !id) return;
 if (!window.confirm('Accept this change? It is applied to the cloud project now and logged in the changelog (and offline copies refresh).')) return;
 setStatus('Accepting\u2026', 'busy');
 try {
 const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/reviews/' + encodeURIComponent(id) + '/accept', {
 method: 'POST', credentials: 'same-origin',
 headers: { 'Content-Type': 'application/json', 'X-Owner-Code': code },
 body: JSON.stringify({})
 });
 const data = await res.json().catch(function() { return {}; });
 if (!res.ok || !data.ok) { setStatus((data && data.error) || 'Accept failed (HTTP ' + res.status + ').', 'err'); return; }
 setStatus('Accepted - the change is now in the cloud project' + (data.savedAt ? ' (' + String(data.savedAt).slice(0, 19).replace('T', ' ') + ')' : '') + '. Load from Cloud to pull it into this workspace.', 'ok');
 cloudReviewList();
 } catch (e) {
 setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
 }
  }

  async function cloudReviewReject(id) {
 const code = getCode();
 if (!code || !id) return;
 if (!window.confirm('Reject this change? It is discarded - the cloud project stays as it is, and the source device sees it was rejected.')) return;
 setStatus('Rejecting\u2026', 'busy');
 try {
 const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/reviews/' + encodeURIComponent(id) + '/reject', {
 method: 'POST', credentials: 'same-origin',
 headers: { 'Content-Type': 'application/json', 'X-Owner-Code': code },
 body: JSON.stringify({})
 });
 const data = await res.json().catch(function() { return {}; });
 if (!res.ok || !data.ok) { setStatus((data && data.error) || 'Reject failed (HTTP ' + res.status + ').', 'err'); return; }
 setStatus('Rejected - the change was discarded. The cloud project is unchanged.', 'ok');
 cloudReviewList();
 } catch (e) {
 setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
 }
  }

  async function copyEditorCode(code) {
 if (!code) { setStatus('No code to copy.', 'warn'); return; }
 let copied = false;
 try {
 await navigator.clipboard.writeText(code);
 copied = true;
 } catch (e) {
 window.prompt('Editor code (select + copy):', code);
 copied = true;
 }
 C._render();
 setStatus(copied ? 'Editor code copied to the clipboard.' : 'Editor code shown - copy it from the prompt.', 'ok');
  }

  function editorCodeDone() {
 C._render();
  }

  ns.CloudReview = {
 cloudReviewList: cloudReviewList,
 cloudReviewMine: cloudReviewMine,
 reviewToggleDiffs: reviewToggleDiffs,
 cloudReviewAccept: cloudReviewAccept,
 cloudReviewReject: cloudReviewReject,
 copyEditorCode: copyEditorCode,
 editorCodeDone: editorCodeDone
  };
})(MMGR);
window.MMGR = MMGR;
