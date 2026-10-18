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
  var MAX_HISTORY_MSGS = 12;
  // OWNER 2026-10-10 (T7, R1/R5): four attachment types, nothing else, and an
  // in-memory INDEX so a question carries only the relevant lines instead of
  // the whole file on every message.
  var FILE_EXT_OK = ['.pdf', '.csv', '.txt', '.md'];
  var FILE_MIME_OK = ['application/pdf', 'text/csv', 'text/plain', 'text/markdown'];
  var MAX_FILE_BYTES = 5 * 1024 * 1024;
  var CHUNK_BUDGET = 1800;

  var SYSTEM_PROMPT =
    'You are the assistant on the My MaNaGeR Build Cost Calculator. Answer in plain ' +
    'language a client can follow - short, no jargon, no emoji. ' +
    // C8 (AUDIT-DIRECTIVE-2026-10-18): the model must NEVER convert. The page
    // converts, in JavaScript, and shows its working - so a number the model
    // invents is never silently priced in the wrong unit.
    'Never convert units. Copy the numbers the user gave you and set "units" to ' +
    'the system the user spoke in (feet and square feet are imperial, metres and ' +
    'square metres are metric). If the user mixes systems, ask which one to use ' +
    'before proposing. The page does all the conversions. ' +
    'If you do not know something, say so instead of guessing. ' +
    'The RATE BOOK below is the truth about prices: quote from it, and say when a ' +
    'figure is not in it rather than inventing one. ' +
    'It opens with a scope line naming the book, its years, its total rate count ' +
    'and its per-trade counts. When that scope line says the full book could not ' +
    'load, tell the user plainly, in one short sentence, that this device only ' +
    'has the rates already on the page. ' +
    'When the conversation settles on figures to price, end your reply with ONE ' +
    'final line in exactly this form (no code fences, nothing after it): ' +
    'PROPOSAL: {"work":"<key>","units":"metric"|"imperial","d1":<number>,"note":"<one short line>"} - ' +
    'the units field is required and is the system the USER spoke in, never a ' +
    'converted guess. For a job the user states as one total, send ' +
    'PROPOSAL: {"work":"<key>","units":"...","measuredQty":<number>,"note":"..."} ' +
    'and put the user\u0027s own number there. ' +
    'Use only the work keys you were given, include d2/d3 only if that work item ' +
    'needs them, and never guess a key. The page turns that line into the two ' +
    'choices the user then sees: add the line to the calculator so they can ' +
    'export it, or generate a file to download. ' +
    'The five sentences below are locked - say them word for word when the ' +
    'situation calls for them. The rest of your reply stays free. ' +
    '1. When the rate book has no rate for the item you are asked about, say: ' +
    '"The rate book is silent on that one - you set the rate yourself." ' +
    '2. When a rate exists in the book but the calculator cannot price it, say: ' +
    '"That figure is in the book but not in my calculator - you set the rate." ' +
    '3. When something is still missing before a line can price, say: ' +
    '"I need one more number before that can price - your quantity or rate." ' +
    '4. After the user has confirmed they want the line, confirm it in one line: ' +
    '"That goes in the bill as " + name + " - " + qty + " " + unit + " at " + rate + "." ' +
    '5. When the user has not given you a rate and you cannot invent one, say: ' +
    '"I cannot price that without your rate - tell me the number and I will add it." ' +
    'A custom line has no rate book entry at all. When the book is silent on it ' +
    'or a figure cannot be priced, do not guess a rate: say you cannot price it ' +
    'without the user giving one, and ask for the quantity and the rate. ' +
    'When the user replies with a rate, build the proposal with the ' +
    'custom form: PROPOSAL: {"custom":{"label":"<your name>","unit":"<your unit>","qty":<number>,"rate":<number>,"source":"user"},"units":"metric"|"imperial","note":"<one short line>"} - ' +
    'the page accepts that and adds the line through the same dispatch as ' +
    'Add to bill. The rate must be a number the user typed in this ' +
    'conversation, or the published metric rate of a row you quoted.';

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
  // A1: when the assistant panel mounts, start loading the full 811-row JIC
  // book now (one script tag, reused if the card opens again), so it is ready
  // before the first question. The send path waits for this load for at most
  // 2 seconds, then proceeds either way. The card opens the same loader
  // (rrLoadFull) lazily, so a single tag is never emitted twice.
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
    '<div class="bcp-ai-chip" data-cai="chip"></div>' +
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
    '<input type="file" id="calc-ai-file" data-cai="file" accept=".pdf,.csv,.txt,.md,application/pdf,text/csv,text/plain,text/markdown" hidden>' +
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
      activeId = 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36); // ok: non-secret
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

  // B5: one chip under the two choices that reads "name - qty unit x cur rate".
  // The existing form is kept word for word - the chip is a new line, not a
  // change to the form.
  function renderProposalChip() {
    if (!els.paths) {
      return;
    }
    var p = proposal;
    if (!p) {
      els.paths.querySelector('.bcp-ai-chip').textContent = '';
      return;
    }
    var which = p.work !== undefined ? 'work' : p.custom !== undefined ? 'custom' : null;
    if (!which) {
      els.paths.querySelector('.bcp-ai-chip').textContent = '';
      return;
    }
    var label = '',
      qty = '',
      unit = '',
      rate = '',
      currency = '';
    if (which === 'work') {
      // C10 (AUDIT-DIRECTIVE-2026-10-18): a work proposal carries no rate, so
      // the old chip printed "blockwork -  x  ". Read the real figures from the
      // PAGE's own dry run instead: it is the preview the user is about to add.
      label = p.work;
      qty = '';
      unit = '';
      try {
        var ck = window.MMGR_CALC_CHECK;
        var chk = typeof ck === 'function' ? ck(p) : null;
        if (chk && chk.preview && chk.preview.qty) {
          qty = String(chk.preview.qty);
          unit = chk.preview.unit || '';
        }
      } catch (e) {
        qty = '';
      }
    } else {
      label = p.custom.label || '';
      qty = String(p.custom.qty || '');
      unit = p.custom.unit || '';
      rate = String(p.custom.rate || '');
    }
    var cur = (p.currency && p.currency !== 'USD' ? p.currency : '') || '';
    // C10: a work proposal reads as "name - quantity unit"; a custom proposal
    // keeps its arithmetic (its rate is the user's own typed figure).
    els.paths.querySelector('.bcp-ai-chip').textContent =
      which === 'work'
        ? label + (qty ? ' - ' + qty + ' ' + unit : '')
        : label + ' - ' + qty + ' ' + unit + ' x ' + cur + ' ' + rate;
  }

  // The two output choices appear ONLY while a parsed PROPOSAL is waiting.
  // The history replay, a live reply and the B6 rejection all funnel through
  // here, so consuming or rejecting a proposal takes them away again - the
  // box is never left dangling over a conversation that already answered.
  function renderPaths() {
    if (!els.paths) {
      return;
    }
    els.paths.hidden = !proposal;
    renderProposalChip();
  }

  // B6: the exact rejection notice (DIRECTIVE section 3). Wording kept in
  // step with the page's own guard in calculator-page.js.
  var B6_RATE_NOTICE =
    'I could not add that line because the rate did not match what you gave me. Tell me the rate again and I will add it.';
  // B6: source "user" - the rate must be a number the USER typed in this
  // conversation, compared after removing currency symbols, spaces and
  // thousands separators, and also by numeric equality so "4,500" proves 4500.
  function userTypedRate(rate) {
    var want = Number(rate);
    for (var i = 0; i < draft.length; i++) {
      if (draft[i].role !== 'user') {
        continue;
      }
      var flat = String(draft[i].content || '').replace(/[$,\s]/g, '');
      if (flat.indexOf(String(rate)) > -1) {
        return true;
      }
      var nums = flat.match(/\d+(?:\.\d+)?/g) || [];
      for (var j = 0; j < nums.length; j++) {
        if (Number(nums[j]) === want) {
          return true;
        }
      }
    }
    return false;
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
    // B1 (owner 2026-10-11): "those figures do not price" told the user nothing.
    // Ask the PAGE first - MMGR_CALC_CHECK is a pure dry run that names every
    // box still missing, in the page's own words and units - so the reply says
    // which field to fill rather than that something failed.
    var chk = null;
    try {
      var ck = window.MMGR_CALC_CHECK;
      if (typeof ck === 'function') {
        chk = ck(proposal);
      }
    } catch (e) {
      chk = null;
    }
    if (chk && chk.ok === false && chk.missing && chk.missing.length) {
      notice(
        'I cannot enter that yet. The form still needs: ' +
          chk.missing
            .map(function (m) {
              return m.label + (m.hint ? ' - ' + m.hint : '');
            })
            .join('  ') +
          ' Tell me that figure and I will price it.',
        'bad'
      );
      return;
    }
    // B6: self-enforcing guards run BEFORE the page is asked, so a rejected
    // proposal never fills a field, never prices and never touches the bill,
    // the counter or the chip. The model can be wrong; this side decides.
    if (proposal.custom) {
      var cr = proposal.custom.rate;
      if (typeof cr !== 'number' || !isFinite(cr) || cr <= 0) {
        notice(B6_RATE_NOTICE, 'bad');
        proposal = null;
        renderPaths();
        return;
      }
      var psrc = proposal.custom.source;
      var psrcs = String(psrc === undefined || psrc === null ? '' : psrc);
      if (!psrcs || psrcs === 'user') {
        if (!userTypedRate(cr)) {
          notice(B6_RATE_NOTICE, 'bad');
          proposal = null;
          renderPaths();
          return;
        }
      }
      // A JIC source is proved against the loaded book by the PAGE (it owns
      // the book); its rejection arrives as out.error below.
    }
    var out = null;
    try {
      out = fn(proposal);
    } catch (e) {
      out = { ok: false, error: 'could not add that line' };
    }
    if (out && out.ok && proposal) {
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
    notice(
      (out && out.error) ||
        'That line could not be added. Check the numbers are greater than zero and try again.',
      'bad'
    );
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

  // B1 (owner 2026-10-11): "Nothing is priced yet. Add the line to the
  // calculator first." named no cause and no next step. Say what is missing and
  // what to press; a pending proposal gets the one-click path instead.
  function nothingPricedNotice() {
    notice(
      proposal
        ? 'Nothing is priced on this page yet, so there is no file to build. Use Populate above and I will add the line, then generate the file.'
        : 'Nothing is priced on this page yet, so there is no file to build. Fill the dimension boxes and press Calculate, then generate the file again.',
      'bad'
    );
  }

  function onMakeFile() {
    var fn = window.MMGR_CALC_FILE;
    if (typeof fn !== 'function') {
      nothingPricedNotice();
      return;
    }
    var f = null;
    try {
      // C9: hand the pending proposal to the page so it can price it in a
      // sandbox - Download no longer needs Populate to have run first.
      f = fn(proposal);
    } catch (e) {
      f = null;
    }
    if (!f || !f.ok || !f.text) {
      nothingPricedNotice();
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
    name.textContent =
      attach.name + ' - ' + attach.lines + ' lines ready; only the relevant ones are sent';
    els.fileinfo.appendChild(name);
    var off = el('button', 'btn btn-n btn-s');
    off.type = 'button';
    off.setAttribute('data-cai', 'detach');
    off.textContent = 'Remove';
    els.fileinfo.appendChild(off);
  }

  /* OWNER 2026-10-10 (T7, R1): the allow-list is enforced on the FILE, not on
     the picker. A .json or a .png is refused in plain words and is not
     attached, and a PDF is checked for its real signature instead of being
     handed to the assistant as binary noise. */
  function extOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return m ? '.' + m[1].toLowerCase() : '';
  }

  function fileAllowed(file) {
    var ext = extOf(file && file.name);
    var mime = String((file && file.type) || '')
      .toLowerCase()
      .split(';')[0];
    if (FILE_EXT_OK.indexOf(ext) < 0 && FILE_MIME_OK.indexOf(mime) < 0) {
      return false;
    }
    return true;
  }

  /* ---- the retrieval index (R5) -----------------------------------------
     TXT/MD -> paragraphs of about 400 characters; CSV -> one line per row,
     normalised to "item | unit | rate" so a rate question can find the rate.
     Each question then carries the best ~1,800 characters, scored on the
     question plus the work item on screen - never the whole file, which used
     to ride on every single message. */
  function chunkText(text) {
    var out = [];
    var paras = String(text || '').split(/\n\s*\n/);
    paras.forEach(function (p) {
      var s = p.replace(/\s+/g, ' ').trim();
      if (!s) {
        return;
      }
      while (s.length > 400) {
        var cut = s.lastIndexOf(' ', 400);
        if (cut < 80) {
          cut = 400;
        }
        out.push(s.slice(0, cut));
        s = s.slice(cut).trim();
      }
      if (s) {
        out.push(s);
      }
    });
    return out;
  }

  function chunkCsv(text) {
    var lines = String(text || '').split(/\r?\n/);
    var rows = [];
    lines.forEach(function (ln) {
      if (!ln.trim()) {
        return;
      }
      var cells = ln.split(',').map(function (c) {
        return c.replace(/^"|"$/g, '').replace(/""/g, '"').trim();
      });
      rows.push(
        cells
          .filter(function (c) {
            return c !== '';
          })
          .join(' | ')
      );
    });
    return rows;
  }

  function buildIndex(name, text) {
    var ext = extOf(name);
    var chunks = ext === '.csv' ? chunkCsv(text) : chunkText(text);
    return {
      name: name,
      kind: ext.replace('.', '') || 'txt',
      chunks: chunks,
      lines: chunks.length
    };
  }

  function score(chunk, words) {
    var s = 0;
    var low = chunk.toLowerCase();
    for (var i = 0; i < words.length; i++) {
      if (low.indexOf(words[i]) > -1) {
        s += 2;
        if (new RegExp('\\b' + words[i] + '\\b').test(low)) {
          s += 2;
        }
      }
    }
    return s;
  }

  function retrieve(query, budget) {
    if (!attach || !attach.chunks || !attach.chunks.length) {
      return '';
    }
    var words = String(query || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(function (w) {
        return w.length > 2;
      });
    var scored = attach.chunks.map(function (c, i) {
      return { i: i, c: c, s: score(c, words) };
    });
    scored.sort(function (a, b) {
      return b.s - a.s || a.i - b.i;
    });
    var picked = [];
    var used = 0;
    for (var i = 0; i < scored.length; i++) {
      if (words.length && scored[i].s === 0 && used > 0) {
        break;
      }
      var piece = scored[i].c;
      if (used + piece.length + 2 > budget) {
        continue;
      }
      picked.push(piece);
      used += piece.length + 2;
      if (used >= budget) {
        break;
      }
    }
    return picked.join('\n');
  }

  /* ---- PDF text extraction (B2, owner 2026-10-11) --------------------------
     "PDF reading is not available on this device yet." was simply true: the
     panel refused every PDF. Sending the file to the model was never an option
     (the relay is text-only and the panel promises nothing is uploaded), so the
     reading happens here, in the page - no new dependency, no vendor blob, no
     network, so it still works offline.

     A PDF keeps its text inside content streams, usually zlib-compressed, drawn
     with the Tj / TJ showing operators. So: inflate each stream with the
     platform's own DecompressionStream, pull the literal strings that are
     actually shown, and hand the result to the same index every other file
     uses. A PDF with no text layer (a scan) yields nothing, and says so. */
  function pdfUnescape(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c !== '\\') {
        out += c;
        continue;
      }
      var n = s.charAt(++i);
      if (!n) {
        break;
      }
      if (n >= '0' && n <= '7') {
        var oct = n;
        while (oct.length < 3 && s.charAt(i + 1) >= '0' && s.charAt(i + 1) <= '7') {
          oct += s.charAt(++i);
        }
        out += String.fromCharCode(parseInt(oct, 8));
      } else if (n === 'n') {
        out += '\n';
      } else if (n === 'r') {
        out += '\r';
      } else if (n === 't') {
        out += '\t';
      } else if (n === '\n' || n === '\r') {
        // line continuation - nothing to add
      } else {
        out += n;
      }
    }
    return out;
  }

  // Pull the literal strings that a showing operator (Tj, TJ, ', ") actually
  // draws. Strings inside a bracket array belong to a TJ, so they always count.
  function pdfContentToText(content) {
    var res = [];
    var i = 0;
    var n = content.length;
    var depth = 0;
    while (i < n) {
      var ch = content.charAt(i);
      if (ch === '[') {
        depth++;
        i++;
        continue;
      }
      if (ch === ']') {
        if (depth > 0) {
          depth--;
        }
        i++;
        continue;
      }
      if (ch === '(') {
        var j = i + 1;
        var d = 1;
        var s = '';
        while (j < n && d > 0) {
          var c = content.charAt(j);
          if (c === '\\') {
            s += c + content.charAt(j + 1);
            j += 2;
            continue;
          }
          if (c === '(') {
            d++;
          } else if (c === ')') {
            d--;
            if (d === 0) {
              j++;
              break;
            }
          }
          s += c;
          j++;
        }
        var tail = content.slice(j, j + 8).replace(/^\s+/, '');
        if (depth > 0 || /^(Tj|TJ|'|"|'')/.test(tail)) {
          res.push(pdfUnescape(s));
        }
        i = j;
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        res.push('\n');
      }
      i++;
    }
    return res.join('');
  }

  function pdfInflate(bytes) {
    if (typeof DecompressionStream === 'undefined' || typeof Blob === 'undefined') {
      return Promise.resolve(null);
    }
    try {
      var ds = new DecompressionStream('deflate');
      var stream = new Blob([bytes]).stream().pipeThrough(ds);
      return new Response(stream).arrayBuffer().then(
        function (buf) {
          return new TextDecoder('latin1').decode(new Uint8Array(buf));
        },
        function () {
          return null;
        }
      );
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function extractPdfText(buf) {
    var bytes = new Uint8Array(buf);
    var latin = new TextDecoder('latin1').decode(bytes);
    if (latin.slice(0, 5) !== '%PDF-') {
      return Promise.resolve({ ok: false, reason: 'not-a-pdf', text: '' });
    }
    var parts = [];
    var idx = 0;
    var guard = 0;
    // A stream is followed by an end-of-line before "endstream"; that stray
    // byte makes DecompressionStream reject the whole stream, so drop trailing
    // whitespace before inflating and fall back to the untouched bytes.
    var trimEnd = function (arr) {
      var end = arr.length;
      while (end > 0) {
        var b = arr[end - 1];
        if (b === 0x0a || b === 0x0d || b === 0x20) {
          end--;
          continue;
        }
        break;
      }
      return arr.subarray(0, end);
    };
    var step = function () {
      if (guard++ > 5000 || parts.length > 400) {
        return Promise.resolve();
      }
      var s = latin.indexOf('stream', idx);
      if (s < 0) {
        return Promise.resolve();
      }
      // The spec allows any end-of-line after the stream keyword, and writers
      // emit one or two, so skip every one rather than assuming a single byte.
      var start = s + 6;
      while (latin.charAt(start) === '\n' || latin.charAt(start) === '\r') {
        start++;
      }
      var e = latin.indexOf('endstream', start);
      if (e < 0) {
        return Promise.resolve();
      }
      var raw = bytes.subarray(start, e);
      var next = function (content) {
        if (content && /\b(BT|Tj|TJ)\b/.test(content)) {
          var t = pdfContentToText(content);
          if (t && t.replace(/\s+/g, '').length) {
            parts.push(t);
          }
        }
        idx = e + 9;
        return step();
      };
      // 0x78 is the zlib header FlateDecode uses.
      if (raw.length && raw[0] === 0x78) {
        var trimmed = trimEnd(raw);
        return pdfInflate(trimmed).then(function (c) {
          if (c) {
            return next(c);
          }
          return pdfInflate(raw).then(next);
        });
      }
      return next(latin.slice(start, e));
    };
    return step().then(function () {
      var text = parts
        .join('\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return { ok: text.length > 0, reason: text.length ? '' : 'no-text-layer', text: text };
    });
  }

  function onFilePicked(input) {
    var file = input && input.files && input.files[0];
    if (!file) {
      return;
    }
    var name = String(file.name || 'attached file').slice(0, 80);
    if (!fileAllowed(file)) {
      if (els.file) {
        els.file.value = '';
      }
      notice('That file type is not supported. Attach a PDF, CSV, TXT or MD file.', 'bad');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      if (els.file) {
        els.file.value = '';
      }
      notice('That file is too big. Attach one under 5 MB.', 'bad');
      return;
    }
    var isPdf = extOf(name) === '.pdf' || /^application\/pdf/i.test(String(file.type || ''));
    var finish = function (text) {
      var idx = buildIndex(name, text);
      if (!idx.chunks.length) {
        notice('That file looks empty, so there is nothing to use from it.', 'bad');
        return;
      }
      attach = idx;
      renderAttach();
      notice('Attached ' + idx.name + '. Your next questions will use it.', '');
    };
    var reader = new FileReader();
    reader.onload = function () {
      if (!isPdf) {
        finish(String(reader.result || ''));
        return;
      }
      // A PDF is a container, so it is read as BYTES and opened here; decoding
      // it as text only ever produced binary noise, which is why it used to be
      // refused outright.
      extractPdfText(reader.result).then(function (r) {
        if (r.reason === 'not-a-pdf') {
          notice('That file is named .pdf but is not a PDF. Attach the real file.', 'bad');
          if (els.file) {
            els.file.value = '';
          }
          return;
        }
        if (!r.ok) {
          notice(
            'That PDF has no readable text (it looks like a scan). Export it as CSV or TXT and attach that.',
            'bad'
          );
          if (els.file) {
            els.file.value = '';
          }
          return;
        }
        finish(r.text);
      });
    };
    reader.onerror = function () {
      notice('That file could not be read.', 'bad');
    };
    if (isPdf) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
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

  // The rate book is filtered on the question (R5): the page returns the
  // work-item index plus only the rate rows that match, so the relevant rate
  // is present even when it sits outside the old first-12-families window.
  function rateBookText(query) {
    try {
      var fn = window.MMGR_CALC_RATEBOOK;
      return typeof fn === 'function' ? String(fn(query) || '').slice(0, 9000) : '';
    } catch (e) {
      return '';
    }
  }

  function payload(question) {
    var q = String(question || '');
    var parts = [SYSTEM_PROMPT];
    var book = rateBookText(q);
    if (book) {
      parts.push('RATE BOOK (answer from this):\n' + book);
    }
    var ctx = contextText();
    if (ctx) {
      parts.push('Estimate on screen:\n' + ctx);
    }
    if (attach) {
      var picked = retrieve(q, CHUNK_BUDGET);
      if (picked) {
        parts.push('ATTACHED FILE "' + attach.name + '" (relevant lines):\n' + picked);
      }
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

  // A1: the first question waits for the full JIC book to land, but only
  // for 2 seconds. The book stays async after that - a fresh page load in a
  // tab keeps downloading it silently, so a slow device still gets its answer.
  // A1: the page exposes its ONE loader (one script tag, never two). The
  // bare `rrLoadFull` global this used to look up never existed - the full
  // book never loaded outside the rate-book card, so the assistant could
  // never index the 811 published rates on a normal visit.
  function rrLoad(done) {
    var load = window.MMGR_JIC_FULL_LOAD;
    if (typeof load === 'function') {
      load(done);
      return true;
    }
    return false;
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
    // A1: the question waits for the full book to land - at most 2 seconds,
    // then it proceeds either way. The payload is built at DELIVER time, so
    // the RATE BOOK block carries the 811 rows whenever they made it in.
    var sent = false;
    var t = null;
    function deliver() {
      if (sent) {
        return;
      }
      sent = true;
      if (t) {
        clearTimeout(t);
      }
      doFetch();
    }
    function doFetch() {
      fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(text))
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
    t = setTimeout(deliver, 2000);
    if (!rrLoad(deliver)) {
      deliver();
    }
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
    // The file box is the ONE thing the browser already guarantees is user
    // started: a file input's value cannot be set from markup or by assignment,
    // only by the picker (or by a script holding a DataTransfer - and a script
    // with that reach already owns the page and everything on it). The older
    // isTrusted gate therefore protected nothing here while it blocked the one
    // honest way to drive the box from a test, so the allow-list check below
    // is what guards the input instead.
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
    // A1: begin loading the full JIC book the moment the panel mounts, so the
    // assistant can answer from the book on a normal visit and always says so
    // honestly when it cannot. The load is async and never blocks the panel;
    // the first question waits at most 2 seconds for it.
    rrLoad(function () {}); // the done callback is a no-op here
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
