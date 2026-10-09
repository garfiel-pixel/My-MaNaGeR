/* ============================================================
   calc-ai.js - the assistant panel on the Build Cost Calculator
   (owner 2026-10-08)
   ------------------------------------------------------------
   The calculator page is a standalone page with no app bundle, so this
   module is deliberately small and self-contained: it talks to the same
   /api/ai/chat relay the app uses (so the key pool, the free daily cap and
   the provider ladder all live in ONE place, in the Worker) and never sees
   an API key of any kind.

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

   If that function is absent the panel still answers, just without the
   on-screen estimate attached. No inline script, no emoji, sprite icons
   only - the page's CSP hashes stay untouched.
   ============================================================ */
(function () {
  'use strict';

  var VERSION = 'calc-ai-1';
  var ENDPOINT = '/api/ai/chat';
  var PROVIDER = 'google-gemini';
  var CAP = 10;
  var SIGNIN_URL = 'signin.html';
  var SYSTEM_PROMPT =
    'You are the assistant on the My MaNaGeR Build Cost Calculator. Answer in plain ' +
    'language a client can follow - short, no jargon, no emoji. Use metric units. ' +
    'If you do not know something, say so instead of guessing.';

  var root = null;
  var els = {};
  var history = [];
  var busy = false;
  var authKnown = false;
  var signedIn = false;
  var remaining = null;

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
    '<button type="button" class="btn btn-n btn-s" data-cai="clear" title="Clear the conversation">Clear</button>' +
    '</div>' +
    '<div class="bcp-ai-log" role="log" aria-live="polite" aria-label="Assistant conversation" data-cai="log"></div>' +
    '<form class="bcp-ai-form" data-cai="form" autocomplete="off">' +
    '<label class="sr-only" for="calc-ai-input">Ask about this estimate</label>' +
    '<textarea id="calc-ai-input" class="bcp-ai-input" rows="2" data-cai="input" ' +
    'placeholder="Ask about this estimate..." aria-describedby="calc-ai-status"></textarea>' +
    '<button type="submit" class="btn btn-g bcp-ai-send" data-cai="send" aria-label="Send question">' +
    ico('arrow-right') +
    '</button>' +
    '</form>';

  function push(role, text) {
    if (!els.log) {
      return;
    }
    var row = document.createElement('div');
    row.className = 'bcp-ai-msg ' + (role === 'user' ? 'user' : 'ai');
    var who = document.createElement('span');
    who.className = 'bcp-ai-who';
    who.textContent = role === 'user' ? 'You' : 'Assistant';
    var body = document.createElement('div');
    body.className = 'bcp-ai-text';
    body.textContent = text;
    row.appendChild(who);
    row.appendChild(body);
    els.log.appendChild(row);
    els.log.scrollTop = els.log.scrollHeight;
  }

  // A notice is a system line (quota, outage, sign-in), never a fake reply
  // and never counted as an assistant answer.
  function notice(text, kind) {
    if (!els.log) {
      return;
    }
    var row = document.createElement('div');
    row.className = 'bcp-ai-note' + (kind ? ' ' + kind : '');
    row.appendChild(plain(ico(kind === 'bad' ? 'alert-triangle' : 'info')));
    var body = document.createElement('span');
    body.textContent = text;
    row.appendChild(body);
    els.log.appendChild(row);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function plain(svg) {
    var wrap = document.createElement('span');
    wrap.className = 'bcp-ai-ico';
    wrap.innerHTML = svg;
    return wrap;
  }

  function setStatus(text, withSignIn) {
    if (!els.status) {
      return;
    }
    els.status.textContent = '';
    if (text) {
      var span = document.createElement('span');
      span.textContent = text;
      els.status.appendChild(span);
    }
    if (withSignIn) {
      var a = document.createElement('a');
      a.className = 'btn btn-g btn-s bcp-ai-signin';
      a.href = SIGNIN_URL;
      a.textContent = 'Sign in';
      els.status.appendChild(a);
    }
    syncDisabled();
  }

  function quotaLine() {
    if (remaining === null) {
      return CAP + ' free messages a day.';
    }
    if (remaining <= 0) {
      return 'No free messages left today - they reset 24 hours after your first.';
    }
    return remaining + ' of ' + CAP + ' free messages left today.';
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

  function contextText() {
    try {
      var fn = window.MMGR_CALC_AI_CONTEXT;
      return typeof fn === 'function' ? String(fn() || '').slice(0, 4000) : '';
    } catch (e) {
      return '';
    }
  }

  function payload() {
    var ctx = contextText();
    var sys = SYSTEM_PROMPT + (ctx ? '\n\nEstimate on screen:\n' + ctx : '');
    var msgs = [{ role: 'system', content: sys }].concat(history.slice(-10));
    return { provider: PROVIDER, messages: msgs, context: ctx };
  }

  function render() {
    if (!els.log) {
      return;
    }
    els.log.innerHTML = '';
    push(
      'assistant',
      'Ask me about this estimate - what a line means, how a rate was worked out, or what to do next.'
    );
    if (authKnown && !signedIn) {
      notice(
        'The assistant needs a sign-in so it can count your free messages. The calculator itself stays open to everyone.',
        'bad'
      );
    }
  }

  function checkAuth() {
    return fetch('/api/auth/me', { method: 'GET', credentials: 'same-origin' })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        authKnown = true;
        signedIn = !!(data && data.ok && data.user);
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
      notice('No free messages left today. They reset 24 hours after your first.', 'bad');
      syncDisabled();
      return;
    }
    busy = true;
    els.input.value = '';
    push('user', text);
    history.push({ role: 'user', content: text });
    setStatus('Thinking...');
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
        if (r.ok && r.data.ok && typeof r.data.text === 'string' && r.data.text) {
          history.push({ role: 'assistant', content: r.data.text });
          push('assistant', r.data.text);
          if (typeof r.data.remaining === 'number') {
            remaining = r.data.remaining;
          } else if (r.data.remaining === null) {
            remaining = null;
          }
          setStatus(quotaLine());
          return;
        }
        if (r.status === 402) {
          remaining = 0;
          notice(
            r.data.error || 'No free messages left today. They reset 24 hours after your first.',
            'bad'
          );
          setStatus(quotaLine());
          return;
        }
        if (r.status === 401 || r.status === 403) {
          signedIn = false;
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
        notice('Could not reach the server. Check your connection and try again.', 'bad');
        setStatus(quotaLine());
      });
  }

  function onClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-cai]') : null;
    if (!t || !root || !root.contains(t)) {
      return;
    }
    if (t.getAttribute('data-cai') === 'clear') {
      history = [];
      render();
      return;
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
    root.classList.add('bcp-ai');
    history = [];
    remaining = null;
    busy = false;
    authKnown = false;
    signedIn = false;
    render();
    setStatus('Checking your account...');
    syncDisabled();
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
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
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKey);
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
