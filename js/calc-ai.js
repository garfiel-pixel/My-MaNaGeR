/* ============================================================
   calc-ai.js - the assistant panel on the Build Cost Calculator
   (owner 2026-10-08, rebuilt 2026-10-09 as calc-ai-2)
   ------------------------------------------------------------
   The calculator page is a standalone page with no app bundle, so this
   module is deliberately small and self-contained: it talks to the same
   /api/ai/chat relay the app uses (so the key pool, the free daily cap and
   the provider ladder all live in ONE place, in the Worker) and never sees
   an API key of any kind.

   THE WINDOW (owner 2026-10-09, item 4.3-4.4): a larger, Claude-shaped
   panel - a history control that opens a list of earlier conversations, a
   "New chat" control, the conversation in the middle, and the signed-in
   identity pinned along the bottom. Conversations are kept on THIS DEVICE
   (localStorage), which is what offline-first means here: nothing about a
   conversation is uploaded anywhere except the question you send.

   FILE UPLOAD (item 4.4): a rate sheet or a document can be attached and
   read as text. The text is attached to the questions you ask from then on,
   and it is shown as a chip so you always know what the assistant can see.
   Nothing is uploaded - the file is read in the page.

   RATE SHEET (item 4.5): the assistant answers from the ACTIVE rate book.
   The page hands it a short plain-text reading of the book (and the work
   items it may name) through window.MMGR_CALC_RATEBOOK - this module never
   reaches into calculator internals. An attached rate sheet is added to the
   same grounding.

   BOTH OUTPUTS (item 4.6): when the conversation settles on figures the
   assistant writes them into a PROPOSAL line. The panel then offers the two
   paths the owner asked for - populate the calculator so you can export
   (marked recommended), or generate a file to download - and follows the
   choice through the page's own hooks, so there is exactly one code path per
   action: MMGR_CALC_POPULATE adds the line through the very dispatch the
   "Add to bill" button uses, and MMGR_CALC_FILE runs the existing CSV export.

   SWAP CONTRACT - the "window for the switch" the owner asked for. The page
   owns the card; this module owns everything inside one mount node and
   exposes exactly three things:

     window.MMGR_CALC_AI.mount(rootEl)   render into rootEl, start the panel
     window.MMGR_CALC_AI.unmount()       remove it and detach its listeners
     window.MMGR_CALC_AI.version         which build is mounted

   A later full-page takeover therefore does NOT have to unpick calculator
   markup: call unmount(), mount the new module on the same (or a different)
   node, delete this file. Optional context is a hook, not a dependency:

     window.MMGR_CALC_AI_CONTEXT = function () { return 'totals ...'; };
     window.MMGR_CALC_RATEBOOK   = function () { return 'the rate book ...'; };
     window.MMGR_CALC_POPULATE   = function (v) { return { ok: true }; };
     window.MMGR_CALC_FILE       = function () { ...the priced line as data... };

   MMGR_CALC_FILE returns the CSV as DATA ({ ok, name, mime, text, rows }) and
   never downloads anything: the panel renders a download chip from it, so the
   chat can only offer a file that really exists (owner 2026-10-10, T2).

   If a hook is absent the panel still answers; it only loses that one power,
   and it says so plainly instead of failing silently. No inline script, no
   emoji, sprite icons only - the page's CSP hashes stay untouched.
   ============================================================ */
(function () {
  'use strict';

  var VERSION = 'calc-ai-3';
  var ENDPOINT = '/api/ai/chat';
  var PROVIDER = 'google-gemini';
  var CAP = 5;
  var SIGNIN_URL = 'signin.html';
  var STORE_KEY = 'mmgr_calc_ai_chats';
  var MAX_CHATS = 20;
  var MAX_FILE_CHARS = 24000;
  var MAX_HISTORY_MSGS = 12;

  var SYSTEM_PROMPT =
    'You are the assistant on the My MaNaGeR Build Cost Calculator. Answer in plain ' +
    'language a client can follow - short, no jargon, no emoji. Use metric units. ' +
    'If you do not know something, say so instead of guessing. ' +
    'The RATE BOOK below is the truth about prices: quote from it, and say when a ' +
    'figure is not in it rather than inventing one. ' +
    'When the conversation settles on figures to price, end your reply with ONE ' +
    'final line in exactly this form (no code fences, nothing after it): ' +
    'PROPOSAL: {"work":"<key>","d1":<number>,"note":"<one short line>"} - ' +
    'use only the work keys you were given, include d2/d3 only if that work item ' +
    'needs them, and never guess a key. The page turns that line into the two ' +
    'choices the user then sees: add the line to the calculator so they can ' +
    'export it, or generate a file to download.';

  var root = null;
  var els = {};
  var draft = [];
  var chats = [];
  var activeId = '';
  var busy = false;
  var authKnown = false;
  var signedIn = false;
  var userEmail = '';
  var remaining = null;
  var attach = null;
  var proposal = null;
  // Blob URLs handed to the file chips - revoked on unmount so a closed panel
  // leaves nothing behind (T2).
  var chipUrls = [];
  // The in-flight "assistant is writing" row + its 25s slow-reply timer (T3).
  var typingRow = null;
  var typingTimer = null;

  function ico(name) {
    return (
      '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-' +
      name +
      '"></use></svg>'
    );
  }

  // Static skeleton only - every piece of user or server text below is set
  // with textContent, so nothing from the network can become markup.
  var SKELETON =
    '<div class="bcp-ai-head">' +
    '<p class="bcp-ai-status" id="calc-ai-status" role="status" data-cai="status"></p>' +
    '<div class="bcp-ai-tools">' +
    '<button type="button" class="btn btn-n btn-s" data-cai="hist" aria-expanded="false" aria-controls="calc-ai-hist" title="Your earlier conversations, kept on this device">' +
    ico('clock') +
    '<span>History</span>' +
    '</button>' +
    '<button type="button" class="btn btn-n btn-s" data-cai="new" title="Start a new conversation">' +
    ico('plus') +
    '<span>New chat</span>' +
    '</button>' +
    '</div>' +
    '</div>' +
    '<section class="bcp-ai-hist" id="calc-ai-hist" data-cai="histpanel" hidden aria-label="Your earlier conversations">' +
    '<ul class="bcp-ai-histlist" data-cai="histlist"></ul>' +
    '<p class="bcp-ai-histempty" data-cai="histempty">No saved conversations yet.</p>' +
    '</section>' +
    '<div class="bcp-ai-log" role="log" aria-live="polite" aria-label="Assistant conversation" data-cai="log"></div>' +
    '<div class="bcp-ai-paths" data-cai="paths" hidden>' +
    '<p class="bcp-ai-pathq" data-cai="pathq">Populate the calculator so you can export, or generate a file to download?</p>' +
    '<div class="bcp-ai-pathrow">' +
    '<button type="button" class="btn btn-g btn-s" data-cai="pop">' +
    ico('check-circle') +
    '<span>Populate the calculator</span>' +
    '<span class="bcp-ai-badge">recommended</span>' +
    '</button>' +
    '<button type="button" class="btn btn-n btn-s" data-cai="makefile">' +
    ico('download') +
    '<span>Generate a file to download</span>' +
    '</button>' +
    '</div>' +
    '</div>' +
    '<form class="bcp-ai-form" data-cai="form" autocomplete="off">' +
    '<button type="button" class="btn btn-n bcp-ai-attach" data-cai="attach" aria-label="Attach a rate sheet or a document" title="Attach a rate sheet or a document">' +
    ico('file-text') +
    '</button>' +
    '<input type="file" id="calc-ai-file" data-cai="file" accept=".json,.csv,.txt,.md,text/plain,application/json" hidden>' +
    '<label class="sr-only" for="calc-ai-input">Ask about this estimate</label>' +
    '<textarea id="calc-ai-input" class="bcp-ai-input" rows="3" data-cai="input" ' +
    'placeholder="Ask about this estimate..." aria-describedby="calc-ai-status"></textarea>' +
    '<button type="submit" class="btn btn-g bcp-ai-send" data-cai="send" aria-label="Send question">' +
    ico('arrow-right') +
    '</button>' +
    '</form>' +
    '<p class="bcp-ai-fileinfo" data-cai="fileinfo" hidden></p>' +
    '<div class="bcp-ai-me" data-cai="me"></div>';

  /* ---- small DOM helpers ------------------------------------------------ */
  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) {
      n.className = cls;
    }
    return n;
  }

  function plain(svg) {
    var wrap = el('span', 'bcp-ai-ico');
    wrap.innerHTML = svg;
    return wrap;
  }

  /* ---- transcript ------------------------------------------------------- */
  function push(role, text) {
    if (!els.log) {
      return;
    }
    var row = el('div', 'bcp-ai-msg ' + (role === 'user' ? 'user' : 'ai'));
    var who = el('span', 'bcp-ai-who');
    who.textContent = role === 'user' ? 'You' : 'Assistant';
    var body = el('div', 'bcp-ai-text');
    body.textContent = text;
    row.appendChild(who);
    row.appendChild(body);
    els.log.appendChild(row);
    els.log.scrollTop = els.log.scrollHeight;
  }

  /* OWNER 2026-10-10 (T3, R9): the in-flight indicator is a real assistant
     bubble with three gold dots, so the wait is visible IN the conversation
     instead of as a distant status line. It carries role=status and an
     accessible name, disappears on every outcome (answer, quota, outage,
     network failure), and only says "Still working..." after 25 seconds.
     prefers-reduced-motion keeps the dots but stops the motion (CSS). */
  function showTyping() {
    if (!els.log) {
      return;
    }
    hideTyping();
    var row = el('div', 'bcp-ai-typing');
    row.setAttribute('role', 'status');
    row.setAttribute('aria-label', 'The assistant is writing');
    for (var i = 0; i < 3; i++) {
      row.appendChild(el('span', 'bcp-ai-dot'));
    }
    var still = el('span', 'bcp-ai-still');
    still.textContent = 'Still working...';
    still.hidden = true;
    row.appendChild(still);
    els.log.appendChild(row);
    els.log.scrollTop = els.log.scrollHeight;
    typingRow = row;
    typingTimer = setTimeout(function () {
      still.hidden = false;
    }, 25000);
  }

  function hideTyping() {
    if (typingTimer) {
      clearTimeout(typingTimer);
      typingTimer = null;
    }
    if (typingRow && typingRow.parentNode) {
      typingRow.parentNode.removeChild(typingRow);
    }
    typingRow = null;
  }

  // A notice is a system line (quota, outage, sign-in), never a fake reply
  // and never counted as an assistant answer.
  function notice(text, kind) {
    if (!els.log) {
      return;
    }
    var row = el('div', 'bcp-ai-note' + (kind ? ' ' + kind : ''));
    row.appendChild(plain(ico(kind === 'bad' ? 'alert-triangle' : 'info')));
    var body = el('span');
    body.textContent = text;
    row.appendChild(body);
    els.log.appendChild(row);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function setStatus(text, withSignIn) {
    if (!els.status) {
      return;
    }
    els.status.textContent = '';
    if (text) {
      var span = el('span');
      span.textContent = text;
      els.status.appendChild(span);
    }
    if (withSignIn) {
      var a = el('a', 'btn btn-g btn-s bcp-ai-signin');
      a.href = SIGNIN_URL;
      a.textContent = 'Sign in';
      els.status.appendChild(a);
    }
    syncDisabled();
  }

  function quotaLine() {
    // The allowance is deliberately NOT advertised (owner 2026-10-09): the
    // status line stays quiet until there is something the user has to act on.
    // CAP is kept only so a server that reports the count can be sanity-read.
    if (remaining !== null && remaining <= 0) {
      return 'Your daily limit has been reached. It refreshes 24 hours after your first message.';
    }
    return '';
  }

  function syncDisabled() {
    if (!els.input || !els.send) {
      return;
    }
    var over = remaining !== null && remaining <= 0;
    var off = busy || !signedIn || over;
    els.input.disabled = off;
    els.send.disabled = off;
    els.input.setAttribute(
      'placeholder',
      off ? 'Sign in to ask a question' : 'Ask about this estimate...'
    );
  }

  /* ---- identity, pinned along the bottom of the window ------------------ */
  function renderIdentity() {
    if (!els.me) {
      return;
    }
    els.me.textContent = '';
    if (!signedIn) {
      var out = el('span', 'bcp-ai-me-out');
      out.textContent = 'Not signed in';
      els.me.appendChild(out);
      var link = el('a', 'bcp-ai-me-link');
      link.href = SIGNIN_URL;
      link.textContent = 'Sign in';
      els.me.appendChild(link);
      return;
    }
    var initial = (userEmail || '?').slice(0, 1).toUpperCase();
    var ava = el('span', 'bcp-ai-ava');
    ava.setAttribute('aria-hidden', 'true');
    ava.textContent = initial;
    els.me.appendChild(ava);
    var who = el('span', 'bcp-ai-me-mail');
    who.textContent = userEmail || 'signed in';
    els.me.appendChild(who);
  }

  /* ---- history (device-local) ------------------------------------------ */
  function loadChats() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      chats = Array.isArray(raw) ? raw : [];
    } catch (e) {
      chats = [];
    }
  }

  function saveChats() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(chats.slice(0, MAX_CHATS)));
    } catch (e) {
      /* a full or blocked store must never break the panel */
    }
  }

  function titleFor(msgs) {
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i].role === 'user' && msgs[i].content) {
        return String(msgs[i].content).replace(/\s+/g, ' ').trim().slice(0, 60);
      }
    }
    return 'Untitled conversation';
  }

  function saveDraft() {
    var msgs = draft
      .filter(function (m) {
        return m && (m.role === 'user' || m.role === 'assistant') && m.content;
      })
      .map(function (m) {
        return { role: m.role, content: m.content };
      });
    if (!msgs.length) {
      return;
    }
    if (!activeId) {
      activeId = 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
      chats.unshift({ id: activeId, title: titleFor(msgs), at: Date.now(), messages: msgs });
    } else {
      chats = chats.map(function (c) {
        return c.id === activeId
          ? { id: c.id, title: titleFor(msgs), at: Date.now(), messages: msgs }
          : c;
      });
    }
    saveChats();
    renderHistory();
  }

  function renderHistory() {
    if (!els.histlist) {
      return;
    }
    els.histlist.textContent = '';
    chats.forEach(function (c) {
      var li = el('li', 'bcp-ai-histrow');
      var b = el('button', 'bcp-ai-histopen');
      b.type = 'button';
      b.setAttribute('data-cai', 'histopen');
      b.setAttribute('data-id', c.id);
      var t = el('span', 'bcp-ai-histtitle');
      t.textContent = c.title || 'Untitled conversation';
      b.appendChild(t);
      var d = el('span', 'bcp-ai-histat');
      d.textContent = c.at ? new Date(c.at).toLocaleDateString() : '';
      b.appendChild(d);
      li.appendChild(b);
      var del = el('button', 'bcp-ai-histdel');
      del.type = 'button';
      del.setAttribute('data-cai', 'histdel');
      del.setAttribute('data-id', c.id);
      del.setAttribute('aria-label', 'Delete this conversation');
      del.innerHTML = ico('trash');
      li.appendChild(del);
      els.histlist.appendChild(li);
    });
    if (els.histempty) {
      els.histempty.hidden = chats.length > 0;
    }
  }

  function toggleHistory(force) {
    if (!els.histpanel || !els.hist) {
      return;
    }
    var open = force === undefined ? els.histpanel.hidden : !!force;
    els.histpanel.hidden = !open;
    els.hist.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function openChat(id) {
    var c = chats.filter(function (x) {
      return x.id === id;
    })[0];
    if (!c) {
      return;
    }
    saveDraft();
    activeId = c.id;
    draft = (c.messages || []).map(function (m) {
      return { role: m.role, content: m.content };
    });
    replay();
    toggleHistory(false);
  }

  function newChat() {
    saveDraft();
    activeId = '';
    draft = [];
    remaining = remaining;
    render();
  }

  /* ---- transcript rendering from stored messages ------------------------ */
  function replay() {
    if (!els.log) {
      return;
    }
    els.log.textContent = '';
    proposal = null;
    var introDone = false;
    draft.forEach(function (m) {
      if (m.role === 'user') {
        push('user', m.content);
        return;
      }
      var parsed = parseProposal(m.content);
      push('assistant', parsed.text);
      if (parsed.json) {
        proposal = parsed.json;
      }
      introDone = true;
    });
    if (!introDone) {
      push(
        'assistant',
        'Ask me about this estimate - what a line means, how a rate was worked out, or what to do next.'
      );
    }
    if (authKnown && !signedIn) {
      notice(
        'The assistant needs a sign-in so it can count your free messages. The calculator itself stays open to everyone.',
        'bad'
      );
    }
    renderPaths();
  }

  function render() {
    replay();
  }

  /* ---- the two output paths -------------------------------------------- */
  function parseProposal(text) {
    var s = String(text == null ? '' : text);
    var m = s.match(/(^|\n)\s*PROPOSAL:\s*(\{[\s\S]*\})\s*$/);
    if (!m) {
      return { text: s, json: null };
    }
    var json = null;
    try {
      json = JSON.parse(m[2]);
    } catch (e) {
      json = null;
    }
    var clean = s.slice(0, m.index).replace(/\s+$/, '');
    return { text: json ? clean || s : s, json: json };
  }

  function renderPaths() {
    if (!els.paths) {
      return;
    }
    els.paths.hidden = !proposal;
  }

  function onPopulate() {
    if (!proposal) {
      return;
    }
    var fn = window.MMGR_CALC_POPULATE;
    if (typeof fn !== 'function') {
      notice(
        'This page cannot add to the bill right now. Use "Add to bill" once the figures are in.',
        'bad'
      );
      return;
    }
    var out = null;
    try {
      out = fn(proposal);
    } catch (e) {
      out = { ok: false, error: 'could not add that line' };
    }
    if (out && out.ok) {
      notice(
        'Added to the bill: ' +
          String(out.name || 'the line') +
          (out.total !== undefined && out.total !== null
            ? ' - ' + String(out.currency || '') + ' ' + String(out.total)
            : '') +
          '. Open the bill of quantities to review or export it.',
        ''
      );
      proposal = null;
      renderPaths();
      return;
    }
    notice((out && out.error) || 'That line could not be added - check the quantities.', 'bad');
  }

  // OWNER 2026-10-10 (T2, F-2): "Generate a file" used to announce a download
  // that never happened. Now the chip IS the download: the page builds the
  // bytes, the chat renders the file with its real name, size and row count,
  // and a link the user clicks. No priced line means no chip and one plain
  // sentence - never a success claim.
  function humanBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) {
      return n + ' B';
    }
    if (n < 1024 * 1024) {
      return Math.round((n / 1024) * 10) / 10 + ' KB';
    }
    return Math.round((n / (1024 * 1024)) * 10) / 10 + ' MB';
  }

  function fileChip(f) {
    if (!els.log) {
      return;
    }
    var bytes = 0;
    try {
      bytes = new Blob([f.text]).size;
    } catch (e) {
      bytes = f.text ? f.text.length : 0;
    }
    var row = el('div', 'bcp-ai-chip');
    row.appendChild(plain(ico('file-text')));
    var meta = el('span', 'bcp-ai-chip-meta');
    var nm = el('strong', 'bcp-ai-chip-name');
    nm.textContent = f.name;
    var sub = el('span', 'bcp-ai-chip-sub');
    sub.textContent =
      humanBytes(bytes) + ' - ' + (f.rows || 0) + ' row' + ((f.rows || 0) === 1 ? '' : 's');
    meta.appendChild(nm);
    meta.appendChild(sub);
    row.appendChild(meta);
    var url = '';
    try {
      url = URL.createObjectURL(new Blob([f.text], { type: f.mime || 'text/plain' }));
    } catch (e) {
      url = '';
    }
    var a = el('a', 'btn btn-g btn-s');
    a.textContent = 'Download';
    a.setAttribute('download', f.name);
    a.href = url;
    row.appendChild(a);
    chipUrls.push(url);
    els.log.appendChild(row);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function onMakeFile() {
    var fn = window.MMGR_CALC_FILE;
    if (typeof fn !== 'function') {
      notice('Nothing is priced yet. Add the line to the calculator first.', 'bad');
      return;
    }
    var f = null;
    try {
      f = fn();
    } catch (e) {
      f = null;
    }
    if (!f || !f.ok || !f.text) {
      notice('Nothing is priced yet. Add the line to the calculator first.', 'bad');
      return;
    }
    fileChip(f);
  }

  /* ---- attachment ------------------------------------------------------ */
  function renderAttach() {
    if (!els.fileinfo) {
      return;
    }
    els.fileinfo.textContent = '';
    els.fileinfo.hidden = !attach;
    if (!attach) {
      return;
    }
    els.fileinfo.appendChild(plain(ico('file-text')));
    var name = el('span');
    name.textContent = attach.name + ' - the assistant can read this while it is attached';
    els.fileinfo.appendChild(name);
    var off = el('button', 'btn btn-n btn-s');
    off.type = 'button';
    off.setAttribute('data-cai', 'detach');
    off.textContent = 'Remove';
    els.fileinfo.appendChild(off);
  }

  function onFilePicked(input) {
    var file = input && input.files && input.files[0];
    if (!file) {
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      attach = {
        name: String(file.name || 'attached file').slice(0, 80),
        text: String(reader.result || '').slice(0, MAX_FILE_CHARS)
      };
      renderAttach();
      notice('Attached ' + attach.name + '. Your next questions will use it.', '');
    };
    reader.onerror = function () {
      notice('That file could not be read.', 'bad');
    };
    reader.readAsText(file);
  }

  /* ---- relay ----------------------------------------------------------- */
  function contextText() {
    try {
      var fn = window.MMGR_CALC_AI_CONTEXT;
      return typeof fn === 'function' ? String(fn() || '').slice(0, 4000) : '';
    } catch (e) {
      return '';
    }
  }

  function rateBookText() {
    try {
      var fn = window.MMGR_CALC_RATEBOOK;
      return typeof fn === 'function' ? String(fn() || '').slice(0, 6000) : '';
    } catch (e) {
      return '';
    }
  }

  function payload() {
    var parts = [SYSTEM_PROMPT];
    var book = rateBookText();
    if (book) {
      parts.push('RATE BOOK (answer from this):\n' + book);
    }
    var ctx = contextText();
    if (ctx) {
      parts.push('Estimate on screen:\n' + ctx);
    }
    if (attach) {
      parts.push('ATTACHED FILE "' + attach.name + '" (use it if it is relevant):\n' + attach.text);
    }
    var sys = parts.join('\n\n');
    var msgs = [{ role: 'system', content: sys }].concat(draft.slice(-MAX_HISTORY_MSGS));
    return { provider: PROVIDER, messages: msgs, context: ctx };
  }

  function checkAuth() {
    return fetch('/api/auth/me', { method: 'GET', credentials: 'same-origin' })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        authKnown = true;
        signedIn = !!(data && data.ok && data.user);
        userEmail = (data && data.user && (data.user.email || data.user.name)) || '';
        renderIdentity();
        if (signedIn) {
          setStatus(quotaLine());
        } else {
          // render() is what draws the sign-in explanation, and it can only
          // do that once authKnown is true - so redraw here, not at mount
          // time, or the reason the box is closed is never shown.
          render();
          setStatus('Sign in to use the assistant.', true);
        }
        syncDisabled();
      })
      .catch(function () {
        // Offline or blocked: the calculator still works, so say so quietly
        // and leave the input closed rather than failing loudly.
        authKnown = true;
        signedIn = false;
        renderIdentity();
        render();
        setStatus('Sign in to use the assistant.', true);
      });
  }

  function send() {
    if (busy || !signedIn || !els.input) {
      return;
    }
    var text = String(els.input.value || '').trim();
    if (!text) {
      return;
    }
    if (remaining !== null && remaining <= 0) {
      notice(
        'Your daily limit has been reached. It refreshes 24 hours after your first message.',
        'bad'
      );
      syncDisabled();
      return;
    }
    busy = true;
    els.input.value = '';
    push('user', text);
    draft.push({ role: 'user', content: text });
    showTyping();
    syncDisabled();
    fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload())
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            return { status: res.status, ok: res.ok, data: data || {} };
          });
      })
      .then(function (r) {
        busy = false;
        hideTyping();
        if (r.ok && r.data.ok && typeof r.data.text === 'string' && r.data.text) {
          var parsed = parseProposal(r.data.text);
          draft.push({ role: 'assistant', content: r.data.text });
          push('assistant', parsed.text);
          proposal = parsed.json;
          renderPaths();
          if (typeof r.data.remaining === 'number') {
            // Clamped to the client's own idea of the allowance: the server
            // owns the number, but a reply that reported more than CAP would
            // mean the two sides disagree, and this side must never promise
            // more than the other one grants.
            remaining = Math.min(r.data.remaining, CAP);
          } else if (r.data.remaining === null) {
            remaining = null;
          }
          setStatus(quotaLine());
          saveDraft();
          return;
        }
        if (r.status === 402) {
          remaining = 0;
          notice(
            r.data.error ||
              'Your daily limit has been reached. It refreshes 24 hours after your first message.',
            'bad'
          );
          setStatus(quotaLine());
          return;
        }
        if (r.status === 401 || r.status === 403) {
          signedIn = false;
          renderIdentity();
          notice('Your sign-in has run out. Sign in again and the assistant comes back.', 'bad');
          setStatus('Sign in to use the assistant.', true);
          return;
        }
        if (r.status === 429 || r.status === 503) {
          notice(
            r.data.error || 'The free assistant is busy right now. Try again in a minute.',
            'bad'
          );
          setStatus(quotaLine());
          return;
        }
        notice(
          r.data.error || 'The assistant could not answer just now (HTTP ' + r.status + ').',
          'bad'
        );
        setStatus(quotaLine());
      })
      .catch(function () {
        busy = false;
        hideTyping();
        notice('Could not reach the server. Check your connection and try again.', 'bad');
        setStatus(quotaLine());
      });
  }

  /* ---- events ---------------------------------------------------------- */
  function onClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-cai]') : null;
    if (!t || !root || !root.contains(t)) {
      return;
    }
    var what = t.getAttribute('data-cai');
    if (what === 'hist') {
      toggleHistory();
      return;
    }
    if (what === 'new') {
      newChat();
      toggleHistory(false);
      return;
    }
    if (what === 'histopen') {
      openChat(t.getAttribute('data-id'));
      return;
    }
    if (what === 'histdel') {
      var id = t.getAttribute('data-id');
      chats = chats.filter(function (c) {
        return c.id !== id;
      });
      if (activeId === id) {
        activeId = '';
        draft = [];
        render();
      }
      saveChats();
      renderHistory();
      return;
    }
    if (what === 'pop') {
      onPopulate();
      return;
    }
    if (what === 'makefile') {
      onMakeFile();
      return;
    }
    if (what === 'attach') {
      if (els.file) {
        els.file.click();
      }
      return;
    }
    if (what === 'detach') {
      attach = null;
      renderAttach();
      if (els.file) {
        els.file.value = '';
      }
    }
  }

  function onChange(e) {
    // A trusted user event only: a script-set value must never seed the box.
    if (!e.isTrusted && e.isTrusted !== undefined) {
      return;
    }
    if (els.file && e.target === els.file) {
      onFilePicked(els.file);
    }
  }

  function onSubmit(e) {
    if (!root || !root.contains(e.target)) {
      return;
    }
    e.preventDefault();
    send();
  }

  function onKey(e) {
    if (!els.input || e.target !== els.input) {
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function mount(node) {
    if (!node || typeof node.appendChild !== 'function') {
      return false;
    }
    unmount();
    root = node;
    root.innerHTML = SKELETON;
    els.log = root.querySelector('[data-cai=log]');
    els.status = root.querySelector('[data-cai=status]');
    els.input = root.querySelector('[data-cai=input]');
    els.send = root.querySelector('[data-cai=send]');
    els.form = root.querySelector('[data-cai=form]');
    els.file = root.querySelector('[data-cai=file]');
    els.fileinfo = root.querySelector('[data-cai=fileinfo]');
    els.me = root.querySelector('[data-cai=me]');
    els.hist = root.querySelector('[data-cai=hist]');
    els.histpanel = root.querySelector('[data-cai=histpanel]');
    els.histlist = root.querySelector('[data-cai=histlist]');
    els.histempty = root.querySelector('[data-cai=histempty]');
    els.paths = root.querySelector('[data-cai=paths]');
    root.classList.add('bcp-ai');
    draft = [];
    chats = [];
    activeId = '';
    remaining = null;
    busy = false;
    authKnown = false;
    signedIn = false;
    userEmail = '';
    attach = null;
    proposal = null;
    chipUrls = [];
    typingRow = null;
    typingTimer = null;
    loadChats();
    renderHistory();
    renderAttach();
    renderIdentity();
    render();
    setStatus('Checking your account...');
    syncDisabled();
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    root.addEventListener('change', onChange);
    if (els.form) {
      els.form.addEventListener('submit', onSubmit);
    }
    checkAuth();
    return true;
  }

  function unmount() {
    if (!root) {
      return;
    }
    hideTyping();
    chipUrls.forEach(function (u) {
      try {
        if (u) {
          URL.revokeObjectURL(u);
        }
      } catch (e) {}
    });
    chipUrls = [];
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKey);
    root.removeEventListener('change', onChange);
    if (els.form) {
      els.form.removeEventListener('submit', onSubmit);
    }
    root.innerHTML = '';
    root = null;
    els = {};
  }

  function isMounted() {
    return !!root;
  }

  window.MMGR_CALC_AI = {
    version: VERSION,
    mount: mount,
    unmount: unmount,
    isMounted: isMounted
  };
})();
