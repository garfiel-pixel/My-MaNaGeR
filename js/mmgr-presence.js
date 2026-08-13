/* ============================================================
   My MaNaGeR — Real-time presence (REAL-TIME-PRESENCE, 2026-08-12)
   Loaded ONLY by project.html. OPT-IN + purely additive: opens a
   WebSocket to /api/cloud/presence when this device holds valid
   access (linked Google session cookie, or a stored cloud owner/
   editor code) and shows a quiet "N online — names" chip in the
   header. If the socket cannot connect — offline, no access
   evidence, worker down — the chip stays hidden and NOTHING else
   changes (offline-first is sacred). Presence shares only {name,
   since} per viewer, never project content. Handshake rejections
   (403) give up after 3 tries — auth/availability won't self-heal.
   ============================================================ */
(function(ns) {
  'use strict';
  var U = ns.Utils;

  var ws = null;
  var selfId = null;
  var members = {};        // id -> { name, since }
  var reconnectDelay = 1000;
  var closedByUs = false;
  var failedOpens = 0;
  var pingTimer = null;

  function pid() {
    return ns.projectId || (new URLSearchParams(window.location.search).get('id') || '');
  }
  function chip() {
    return (U && U.$) ? U.$('presence-chip') : document.getElementById('presence-chip');
  }

  // Access evidence for the handshake: the stored cloud owner/editor code if
  // this device has one (sessionStorage only — never persisted). A linked
  // Google session needs no code — the cookie rides the handshake.
  function accessEvidence() {
    var p = pid();
    if (!p) return null;
    var code = '';
    try {
      code = sessionStorage.getItem('mmgr_cloud_code_' + p) || sessionStorage.getItem('mmgr_cloud_ecode_' + p) || '';
    } catch (e) { code = ''; }
    return code || null;
  }

  function connect() {
    var p = pid();
    if (!p || closedByUs || typeof WebSocket === 'undefined') return;
    var proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    var code = accessEvidence();
    var url = proto + window.location.host + '/api/cloud/presence?project=' + encodeURIComponent(p) +
      (code ? '&code=' + encodeURIComponent(code) : '');
    var socket;
    try { socket = new WebSocket(url); } catch (e) { scheduleReconnect(); return; }
    ws = socket;
    socket.onopen = function() {
      failedOpens = 0;
      reconnectDelay = 1000;
      startPing();
    };
    socket.onmessage = function(ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'init') {
        selfId = msg.self;
        members = {};
        (msg.members || []).forEach(function(m) { members[m.id] = { name: m.name, since: m.since }; });
        render();
      } else if (msg.type === 'join') {
        members[msg.id] = { name: msg.name, since: msg.since };
        render();
      } else if (msg.type === 'leave') {
        delete members[msg.id];
        render();
      }
      // 'pong' is a keepalive ack — nothing to render.
    };
    socket.onclose = function() {
      stopPing();
      ws = null;
      if (closedByUs) return;
      if (failedOpens >= 3) return; // 403/availability won't self-heal — stay quiet
      failedOpens++;
      scheduleReconnect();
    };
    socket.onerror = function() { /* onclose handles reconnect */ };
  }

  function scheduleReconnect() {
    if (closedByUs || !pid()) return;
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(function() {
      if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify({ type: 'ping' })); } catch (e) { /* ignore */ } }
    }, 25000);
  }
  function stopPing() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  }

  function render() {
    var el = chip();
    if (!el) return;
    var others = Object.keys(members).filter(function(id) { return id !== selfId; });
    if (!others.length) { el.hidden = true; return; }
    var names = others.map(function(id) { return members[id].name || 'Viewer'; });
    var label = el.querySelector('[data-presence-label]');
    if (label) label.textContent = others.length + ' online — ' + names.join(', ');
    el.setAttribute('title', names.join(', ') + (names.length > 1 ? ' are viewing' : ' is viewing') + ' this project');
    el.hidden = false;
  }

  function boot() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
      return;
    }
    connect();
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) { closedByUs = true; if (ws) { try { ws.close(); } catch (e) { /* ignore */ } } }
      else { closedByUs = false; if (!ws) connect(); }
    });
    window.addEventListener('pagehide', function() {
      closedByUs = true;
      stopPing();
      if (ws) { try { ws.close(); } catch (e) { /* ignore */ } }
    });
  }

  boot();

  ns.Presence = {
    connect: connect,
    render: render
  };
})(window.MMGR || (window.MMGR = {}));
