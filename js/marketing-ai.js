/* ============================================================
   marketing-ai.js - the "Try the AI" assistant on the landing page (C2)
   ------------------------------------------------------------
   Loaded LAZILY by js/marketing.js: the loader injects this file only when the
   #try-ai section nears the viewport or the visitor acts inside it, so nothing
   here competes with the hero for first paint or LCP.

   What it is: a guided, offline-capable tour. It explains what the product
   does, asks two qualifying questions (AI proficiency, MCP appetite), and only
   turns the composer on once it is ready. The tour itself makes NO network
   request: every canned answer lives in this file, so it works with no
   connection and costs nothing.

   Free-form questions are matched against the same small knowledge base first.
   Only a question the base cannot answer escalates to the signed-in /api/ai/chat
   relay, and only after the visitor has typed or tapped (never on mount). The
   free relay is signed-in only by the owner's own rule, so a signed-out visitor
   gets a plain "sign in to ask anything, or open the app" line instead of a
   dead box. Offline, the widget says so and offers the app, which works with no
   connection.

   No inline script, no emoji, sprite icons only - the page's CSP hashes stay
   untouched. All user and server text reaches the screen through textContent.
   ============================================================ */
(function () {
  'use strict';

  var VERSION = 'landing-ai-1';
  var ENDPOINT = '/api/ai/chat';
  var PROVIDER = 'google-gemini';
  var MAX_HISTORY = 10;

  var SYSTEM_PROMPT =
    'You are the assistant on the My MaNaGeR landing page. My MaNaGeR is an ' +
    'offline-first construction project management workspace that runs in the ' +
    'browser. Answer in plain language a visitor can follow: short, no jargon, ' +
    'no emoji, no markdown. Explain what the product does, how the data stays ' +
    'on the visitor device, how the built-in AI works, and how to start. Ask at ' +
    'most one qualifying question about how comfortable the visitor is with AI ' +
    'tools or whether they use MCP or outside AI tools. Never invent prices or ' +
    'project figures. If the visitor wants to do real project work, invite them ' +
    'to open the app, which needs no account.';

  /* ---- the local knowledge base (no network) ---------------------------- */
  var KB = [
    {
      keys: ['what', 'does', 'do', 'about', 'product', 'workspace', 'app'],
      a: 'My MaNaGeR is one workspace for construction project management. It runs in your browser and covers the schedule, budget, risks, meetings, claims and closeout in one place, so a number entered once shows up everywhere it matters.'
    },
    {
      keys: [
        'data',
        'privacy',
        'private',
        'store',
        'stored',
        'cloud',
        'upload',
        'safe',
        'security'
      ],
      a: 'Your project lives on your own device. It autosaves in your browser and you can export a portable file at any time. Nothing is uploaded unless you choose to back up to the cloud, and the app itself needs no account.'
    },
    {
      keys: ['ai', 'assistant', 'model', 'gemini', 'key', 'intelligence'],
      a: 'The built-in AI reads your live project numbers and answers in plain language. You can connect your own AI key for unlimited questions, or use the free allowance after signing in. It traces every answer to your figures instead of inventing them.'
    },
    {
      keys: ['cost', 'price', 'pricing', 'free', 'pay', 'subscription', 'plan'],
      a: 'The workspace is free to use with no account. Signing in only unlocks convenience such as backup and moving between devices. Paid plans add team and cloud features, while the core app stays open to everyone.'
    },
    {
      keys: ['offline', 'connection', 'internet', 'network', 'online'],
      a: 'Yes. The app works with no connection. Schedules, budgets and notes all run locally, and the only things that need a network are optional weather and cloud backup.'
    },
    {
      keys: ['browser', 'platform', 'install', 'device', 'phone', 'mobile', 'mac', 'windows'],
      a: 'It runs in current versions of Chrome, Edge, Firefox and Safari, on desktop and mobile. There is nothing to install: open the app and go.'
    },
    {
      keys: ['mcp', 'outside', 'external', 'connect', 'integration', 'tool'],
      a: 'If you use an outside AI tool, My MaNaGeR can expose a project through MCP so that tool can read it with your permission. You stay in control of what is shared, and nothing is exposed unless you choose it.'
    },
    {
      keys: ['start', 'begin', 'first', 'setup', 'how'],
      a: 'Open the app, pick a methodology, and start with a charter or a plain outline. Most teams are productive in their first fifteen minutes, and you can change the setup as the job grows.'
    },
    {
      keys: ['calculator', 'estimate', 'cost', 'quantity', 'rate', 'boq'],
      a: 'The Build Cost Calculator turns quantities and rates into a priced bill of quantities, with tax, overhead, margin and statutory costs handled for you. It is the same rate book the rest of the workspace reads.'
    },
    {
      keys: ['team', 'collaborate', 'collaboration', 'role', 'permission', 'share'],
      a: 'You can bring the team in with roles and permissions. A view-only code opens a project read-only, and scoped editor codes let people work without seeing everything.'
    }
  ];

  /* ---- state ----------------------------------------------------------- */
  var root = null;
  var els = {};
  var phase = 'idle';
  var busy = false;
  var signedIn = null;
  var answered = false;
  var q1Done = false;
  var q2Done = false;
  var history = [];

  var STARTERS = [
    'What does My MaNaGeR do?',
    'Where is my data kept?',
    'How does the AI work?',
    'How much does it cost?'
  ];

  function ico(name) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', 'css/mmgr-icons.svg#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) {
      n.className = cls;
    }
    return n;
  }

  function setPhase(p) {
    phase = p;
    if (root) {
      root.setAttribute('data-lai-phase', p);
    }
  }

  function scrollLog() {
    if (els.log) {
      els.log.scrollTop = els.log.scrollHeight;
    }
  }

  function push(role, text) {
    if (!els.log) {
      return;
    }
    var row = el('div', 'lai-msg ' + (role === 'user' ? 'user' : 'ai'));
    var who = el('span', 'lai-who');
    who.textContent = role === 'user' ? 'You' : 'Assistant';
    var body = el('div', 'lai-text');
    body.textContent = text;
    row.appendChild(who);
    row.appendChild(body);
    els.log.appendChild(row);
    scrollLog();
  }

  function notice(text, kind) {
    if (!els.log) {
      return;
    }
    var row = el('div', 'lai-note' + (kind ? ' ' + kind : ''));
    var body = el('span');
    body.textContent = text;
    row.appendChild(body);
    els.log.appendChild(row);
    scrollLog();
  }

  function setStatus(text) {
    if (els.status) {
      els.status.textContent = text || '';
    }
  }

  function setComposer(on) {
    if (els.input) {
      els.input.disabled = !on;
    }
    if (els.send) {
      els.send.disabled = !on;
    }
  }

  /* ---- chips ----------------------------------------------------------- */
  function clearChips() {
    if (els.chips) {
      els.chips.textContent = '';
      els.chips.hidden = true;
    }
  }

  function chip(label, attrs) {
    var b = el('button', 'lai-chip');
    b.type = 'button';
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) {
        b.setAttribute(k, attrs[k]);
      }
    }
    b.textContent = label;
    return b;
  }

  function renderStarters() {
    if (!els.chips) {
      return;
    }
    els.chips.textContent = '';
    els.chips.hidden = false;
    STARTERS.forEach(function (q) {
      els.chips.appendChild(chip(q, { 'data-lai-ask': q }));
    });
  }

  function renderQualifying() {
    if (!els.chips) {
      return;
    }
    els.chips.textContent = '';
    els.chips.hidden = false;
    var q = el('p', 'lai-q');
    q.textContent = 'Two quick questions so I can point you the right way.';
    els.chips.appendChild(q);
    els.chips.appendChild(chip('New to AI', { 'data-lai-qual': 'ai|New to it' }));
    els.chips.appendChild(chip('Comfortable', { 'data-lai-qual': 'ai|Comfortable' }));
    els.chips.appendChild(chip('Power user', { 'data-lai-qual': 'ai|Power user' }));
  }

  function renderMcpQuestion() {
    if (!els.chips) {
      return;
    }
    els.chips.textContent = '';
    els.chips.hidden = false;
    var q = el('p', 'lai-q');
    q.textContent = 'Do you use MCP or outside AI tools?';
    els.chips.appendChild(q);
    els.chips.appendChild(chip('Yes', { 'data-lai-qual': 'mcp|Yes' }));
    els.chips.appendChild(chip('No', { 'data-lai-qual': 'mcp|No' }));
    els.chips.appendChild(chip('Not sure', { 'data-lai-qual': 'mcp|Not sure' }));
  }

  function renderFinal() {
    if (!els.chips) {
      return;
    }
    els.chips.textContent = '';
    els.chips.hidden = false;
    var open = el('a', 'lai-chip lai-chip-go');
    open.href = 'app.html';
    open.textContent = 'Open the app';
    els.chips.appendChild(open);
    var guide = el('a', 'lai-chip');
    guide.href = 'mymanager-field-guide.html';
    guide.textContent = 'See the field guide';
    els.chips.appendChild(guide);
  }

  /* ---- local answers --------------------------------------------------- */
  function match(question) {
    var low = String(question || '').toLowerCase();
    var best = null;
    var bestScore = 0;
    KB.forEach(function (entry) {
      var score = 0;
      entry.keys.forEach(function (k) {
        if (low.indexOf(k) > -1) {
          score++;
        }
      });
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    });
    return bestScore > 0 ? best.a : '';
  }

  function answerLocal(text) {
    push('user', text);
    history.push({ role: 'user', content: text });
    var a = match(text);
    if (a) {
      push('assistant', a);
      history.push({ role: 'assistant', content: a });
    } else {
      var fallback =
        'I can explain the basics here: what the workspace does, where your data stays, how the AI works, and how to start. For anything deeper, open the app, which needs no account.';
      push('assistant', fallback);
      history.push({ role: 'assistant', content: fallback });
    }
    answered = true;
    if (!q1Done) {
      renderQualifying();
    }
  }

  function handleQual(qid, value) {
    push('user', value);
    var line = '';
    if (qid === 'ai') {
      if (value === 'New to it') {
        line =
          'Good. The assistant is built to explain its reasoning, so you can start with plain questions and no setup.';
      } else if (value === 'Comfortable') {
        line =
          'Great. You can connect your own AI key for unlimited questions and keep the free allowance as a fallback.';
      } else {
        line =
          'Then you will like the MCP path: connect an outside tool and let it read a project you choose.';
      }
      q1Done = true;
      push('assistant', line);
      renderMcpQuestion();
      return;
    }
    if (value === 'Yes') {
      line =
        'You can connect an outside AI tool through MCP and keep control of what it sees. Nothing is shared unless you choose it.';
    } else if (value === 'No') {
      line =
        'No problem. The built-in assistant covers the common questions with no setup, and you can ignore MCP until you need it.';
    } else {
      line =
        'MCP lets an outside AI tool read a project you choose. You can ignore it until you need it.';
    }
    q2Done = true;
    push('assistant', line);
    renderFinal();
  }

  /* ---- relay (only after a typed question the base cannot answer) ------ */
  function ensureAuth() {
    if (signedIn !== null) {
      return Promise.resolve(signedIn);
    }
    return fetch('/api/auth/me', { method: 'GET', credentials: 'same-origin' })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        signedIn = !!(data && data.ok && data.user);
        return signedIn;
      })
      .catch(function () {
        signedIn = false;
        return false;
      });
  }

  function postRelay(question) {
    var messages = [{ role: 'system', content: SYSTEM_PROMPT }].concat(history.slice(-MAX_HISTORY));
    messages.push({ role: 'user', content: question });
    return fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: PROVIDER, messages: messages })
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
        if (r.ok && r.data.ok && typeof r.data.text === 'string' && r.data.text) {
          push('assistant', r.data.text);
          history.push({ role: 'assistant', content: r.data.text });
          return true;
        }
        if (r.status === 401 || r.status === 403) {
          signedIn = false;
          notice('Sign in to ask anything beyond the basics, or open the app.', 'bad');
          return false;
        }
        if (r.status === 402 || r.status === 429 || r.status === 503) {
          notice(
            r.data.error || 'The free assistant is busy right now. Try again in a minute.',
            'bad'
          );
          return false;
        }
        notice(r.data.error || 'The assistant could not answer just now.', 'bad');
        return false;
      })
      .catch(function () {
        notice('Could not reach the server. The app itself works offline.', 'bad');
        return false;
      });
  }

  function send(text) {
    var q = String(text || '').trim();
    if (!q || busy) {
      return;
    }
    busy = true;
    if (els.input) {
      els.input.value = '';
    }
    setComposer(false);
    push('user', q);
    history.push({ role: 'user', content: q });

    var local = match(q);
    if (local) {
      push('assistant', local);
      history.push({ role: 'assistant', content: local });
      answered = true;
      if (!q1Done) {
        renderQualifying();
      }
      busy = false;
      setComposer(true);
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      notice('You are offline right now. The app itself works with no connection.', 'bad');
      renderFinal();
      busy = false;
      setComposer(false);
      return;
    }

    ensureAuth().then(function (ok) {
      if (!ok) {
        notice(
          'I can answer the basics here. Sign in to ask anything, or open the app, which needs no account.',
          ''
        );
        renderFinal();
        busy = false;
        setComposer(false);
        return;
      }
      return postRelay(q).then(function () {
        busy = false;
        setComposer(true);
        if (!q1Done) {
          renderQualifying();
        }
      });
    });
  }

  /* ---- events ---------------------------------------------------------- */
  function onClick(e) {
    var t =
      e.target && e.target.closest ? e.target.closest('[data-lai-ask],[data-lai-qual]') : null;
    if (!t || !root || !root.contains(t)) {
      return;
    }
    var ask = t.getAttribute('data-lai-ask');
    if (ask) {
      answerLocal(ask);
      return;
    }
    var qual = t.getAttribute('data-lai-qual');
    if (qual) {
      var parts = qual.split('|');
      handleQual(parts[0], parts.slice(1).join('|'));
    }
  }

  function onSubmit(e) {
    if (!root || !root.contains(e.target)) {
      return;
    }
    e.preventDefault();
    send(els.input ? els.input.value : '');
  }

  /* ---- mount ----------------------------------------------------------- */
  function mount(node) {
    if (!node || typeof node.appendChild !== 'function') {
      return false;
    }
    unmount();
    root = node;
    root.textContent = '';
    root.classList.add('lai');
    root.setAttribute('data-lai-saw-loading', '1');
    setPhase('loading');

    var head = el('div', 'lai-head');
    var badge = el('span', 'lai-badge');
    badge.appendChild(ico('sparkle'));
    var badgeText = el('span');
    badgeText.textContent = 'AI tour';
    badge.appendChild(badgeText);
    var status = el('p', 'lai-status');
    status.setAttribute('role', 'status');
    status.textContent = 'Preparing the assistant...';
    head.appendChild(badge);
    head.appendChild(status);

    var log = el('div', 'lai-log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    log.setAttribute('aria-label', 'Assistant conversation');

    var chips = el('div', 'lai-chips');
    chips.hidden = true;

    var form = el('form', 'lai-form');
    form.setAttribute('autocomplete', 'off');
    var label = el('label', 'sr-only');
    label.setAttribute('for', 'lai-input');
    label.textContent = 'Ask the assistant';
    var input = el('input', 'lai-input');
    input.id = 'lai-input';
    input.type = 'text';
    input.setAttribute('placeholder', 'Ask a question...');
    input.setAttribute('data-lai', 'input');
    input.disabled = true;
    var sendBtn = el('button', 'btn btn-gold lai-send');
    sendBtn.type = 'submit';
    sendBtn.setAttribute('aria-label', 'Send question');
    sendBtn.appendChild(ico('arrow-right'));
    sendBtn.disabled = true;
    form.appendChild(label);
    form.appendChild(input);
    form.appendChild(sendBtn);

    root.appendChild(head);
    root.appendChild(log);
    root.appendChild(chips);
    root.appendChild(form);

    els.head = head;
    els.status = status;
    els.log = log;
    els.chips = chips;
    els.form = form;
    els.input = input;
    els.send = sendBtn;

    root.addEventListener('click', onClick);
    form.addEventListener('submit', onSubmit);

    // Offline at mount: say so and offer the app, which works with no network.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setPhase('offline');
      setStatus('You are offline.');
      push(
        'assistant',
        'You are offline right now. The app itself works with no connection, so you can open it and keep working.'
      );
      renderFinal();
      return true;
    }

    // The deliberate wait: the composer turns on only when the tour is ready.
    setTimeout(function () {
      if (!root) {
        return;
      }
      setPhase('ready');
      setStatus('Ready. Ask a question, or pick one below.');
      push(
        'assistant',
        'Hi. I can explain what My MaNaGeR does, how your data stays yours, and how the AI works. What would you like to know?'
      );
      renderStarters();
      setComposer(true);
    }, 420);
    return true;
  }

  function unmount() {
    if (root) {
      root.removeEventListener('click', onClick);
      if (els.form) {
        els.form.removeEventListener('submit', onSubmit);
      }
    }
    root = null;
    els = {};
    phase = 'idle';
    busy = false;
    signedIn = null;
    answered = false;
    q1Done = false;
    q2Done = false;
    history = [];
  }

  function boot() {
    var node = document.getElementById('landing-ai');
    if (node) {
      mount(node);
    }
  }

  window.MMGR_LANDING_AI = {
    mount: mount,
    unmount: unmount,
    version: VERSION,
    phase: function () {
      return phase;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
