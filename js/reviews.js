/* ============================================================
   My MaNaGeR , Public Reviews Window (PART F T7, 2026-08-16).
   External module for reviews.html (no inline scripts → no CSP
   hash churn):
   - loads the public review list (GET /api/reviews, newest
     first) and renders it with textContent ONLY , user content
     is never innerHTML, so nothing can execute (the Worker also
     rejects HTML/links server-side; this is the second layer)
   - submits the leave-a-review form (POST /api/reviews) with
     client-side plain-text + length checks mirroring the server
   - star-READY: a review row renders its stored star rating
     (1-5) when present; 0/null (not rated) shows no stars. The
     star-INPUT UI is a follow-up session per the owner.
   Every lookup is null-guarded and every fetch is caught , this
   file must never throw.
   ============================================================ */
(function(){
  'use strict';

  var listEl = document.getElementById('reviews-list');
  var formEl = document.getElementById('review-form');
  var nameIn = document.getElementById('review-name');
  var textIn = document.getElementById('review-text');
  var statusEl = document.getElementById('review-status');
  // STAR INPUT UI (STABILIZATION 2026-08-16): the picker radios drive the
  // data-val fill state and ride along on submit (1-5 int, optional).
  var pickRow = document.getElementById('rv-pick-row');
  var turnstileDiv = document.getElementById('rv-turnstile');
  var turnstileToken = null;
  var turnstileWidget = null;
  // The sitekey the Worker will require. Exposed by a tiny read-only endpoint
  // so the key lives in the Wrangler environment (not hardcoded in the page)
  // and the client and the server can never drift apart.
  var turnstileRequired = false;

  // ---- Cloudflare Turnstile bot protection (owner 2026-10-02) -----------
  // Contract:
  //   - the PUBLIC sitekey comes from GET /api/turnstile-config
  //   - the SECRET is a Wrangler secret (TURNSTILE_SECRET), never in the repo
  //   - the Worker validates the token with CF siteverify in
  //     src/reviews.js handleReviewsCreate BEFORE anything is written
  // While no key is configured the widget simply never renders and the Worker
  // accepts posts as before, so the page stays usable in local dev and CI.
  var TS_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=mmgrTurnstileOnload';
  var tsLoaded = false;

  window.mmgrTurnstileOnload = function () {
    if (!turnstileDiv || typeof Turnstile === 'undefined' || turnstileWidget) return;
    try {
      turnstileWidget = window.turnstile.render(turnstileDiv, {
        sitekey: turnstileDiv.getAttribute('data-sitekey') || '',
        theme: 'auto',
        size: 'normal',
        callback: function (token) { turnstileToken = token; },
        'expired-callback': function () { turnstileToken = null; },
        'error-callback': function () { turnstileToken = null; }
      });
    } catch (e) {
      turnstileWidget = null;
    }
  };

  function loadTurnstileScript() {
    if (tsLoaded || !turnstileDiv) return;
    tsLoaded = true;
    var s = document.createElement('script');
    s.src = TS_SCRIPT;
    s.async = true;
    s.defer = true;
    s.onerror = function () { tsLoaded = false; };
    document.head.appendChild(s);
  }

  // Only render once BOTH sides agree the challenge is required. Asking the
  // Worker first is what keeps an unconfigured deploy from showing a widget
  // whose token the server would then reject.
  function initTurnstile() {
    if (!turnstileDiv) return;
    fetch('/api/turnstile-config', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.ok || !d.sitekey) return;
        turnstileRequired = true;
        turnstileDiv.setAttribute('data-sitekey', d.sitekey);
        loadTurnstileScript();
      })
      .catch(function () { /* offline or no Worker: leave the form as-is */ });
  }

  // Reset after every submit attempt: Turnstile tokens are single-use, so a
  // second review needs a fresh challenge.
  function resetTurnstile() {
    turnstileToken = null;
    try {
      if (window.turnstile && turnstileWidget && typeof window.turnstile.reset === 'function') {
        window.turnstile.reset(turnstileWidget);
      }
    } catch (e) { /* widget already gone */ }
  }

  function selectedStars() {
    if (!pickRow) return 0;
    var checked = pickRow.querySelector('input[name="stars"]:checked');
    var n = checked ? parseInt(checked.value, 10) : 0;
    return (n >= 1 && n <= 5) ? n : 0;
  }
  function syncPickFill() {
    if (pickRow) pickRow.setAttribute('data-val', String(selectedStars()));
  }
  function resetStars() {
    if (!pickRow) return;
    var checked = pickRow.querySelector('input[name="stars"]:checked');
    if (checked) checked.checked = false;
    syncPickFill();
  }
  if (pickRow) pickRow.addEventListener('change', syncPickFill);

  function setStatus(msg, isErr) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('is-err', !!isErr);
    statusEl.hidden = !msg;
  }

  // Build a star row (filled = stored rating) from the sprite , icons only,
  // never emoji. Returns null when not rated (0/null), so the row hides.
  function starRow(stars) {
    if (!stars || stars < 1 || stars > 5) return null;
    var wrap = document.createElement('span');
    wrap.className = 'rv-stars';
    wrap.setAttribute('aria-label', stars + ' out of 5');
    for (var i = 1; i <= 5; i++) {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'ico rv-star' + (i <= stars ? ' on' : ''));
      svg.setAttribute('aria-hidden', 'true');
      var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', 'css/mmgr-icons.svg#i-star');
      svg.appendChild(use);
      wrap.appendChild(svg);
    }
    return wrap;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // Render one review as DOM nodes , textContent only, never innerHTML.
  function reviewCard(r) {
    var card = document.createElement('article');
    card.className = 'rv-card';

    var head = document.createElement('div');
    head.className = 'rv-head';

    var name = document.createElement('span');
    name.className = 'rv-name';
    name.textContent = (r && r.name && r.name.trim()) ? r.name : 'Anonymous';
    head.appendChild(name);

    var when = document.createElement('time');
    when.className = 'rv-date';
    when.textContent = fmtDate(r && r.createdAt);
    head.appendChild(when);

    card.appendChild(head);

    var stars = starRow(r && r.stars);
    if (stars) card.appendChild(stars);

    var body = document.createElement('p');
    body.className = 'rv-text';
    body.textContent = (r && r.review) ? r.review : '';
    card.appendChild(body);

    return card;
  }

  function showEmpty(show) {
    var empty = document.getElementById('reviews-empty');
    if (empty) empty.hidden = !show;
  }

  function renderList(reviews) {
    if (!listEl) return;
    listEl.textContent = '';
    var list = Array.isArray(reviews) ? reviews : [];
    if (!list.length) { showEmpty(true); return; }
    showEmpty(false);
    list.forEach(function(r) {
      listEl.appendChild(reviewCard(r));
    });
  }

  async function loadReviews() {
    try {
      var res = await fetch('/api/reviews', { credentials: 'same-origin' });
      if (!res.ok) { showEmpty(true); return; }
      var data = await res.json();
      renderList(data && data.ok ? data.reviews : []);
    } catch (e) {
      // Offline / dev server without the mirror: show the empty state
      // quietly , the page must never throw.
      showEmpty(true);
    }
  }

  if (formEl && textIn) {
    formEl.addEventListener('submit', async function(ev) {
      ev.preventDefault();
      setStatus('');
      var review = textIn.value.replace(/\s+/g, ' ').trim();
      if (!review) { setStatus('Please write a short review before sending.', true); return; }
      if (review.length > 2000) { setStatus('That review is too long , keep it under 2000 characters.', true); return; }
      if (/[<>]/.test(review) || /https?:\/\/|www\./i.test(review)) {
        setStatus('Plain text only, please , no HTML or links in reviews.', true);
        return;
      }
      var name = nameIn ? nameIn.value.replace(/\s+/g, ' ').trim() : '';
      if (name.length > 60) name = name.slice(0, 60);
      var payload = { review: review };
      if (name) payload.name = name;
      var stars = selectedStars();
      if (stars) payload.stars = stars;
      // Only send a token when the Worker told us a challenge is required.
      // Sending nothing while required fails server-side with a clear message.
      if (turnstileToken) payload.turnstileToken = turnstileToken;
      if (turnstileRequired && !turnstileToken) {
        setStatus('Please finish the check above before sending your review.', true);
        return;
      }
      var btn = formEl.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      try {
        var res = await fetch('/api/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload)
        });
        var data = await res.json().catch(function() { return null; });
        if (!res.ok || !data || !data.ok) {
          setStatus((data && data.error) ? data.error : 'Could not post your review. Please try again.', true);
          return;
        }
        if (nameIn) nameIn.value = '';
        if (textIn) textIn.value = '';
        resetStars();
        resetTurnstile();
        setStatus('Thank you! Your review is live for everyone to see.');
        // Prepend the new review (newest first) , re-fetch keeps ordering
        // authoritative without trusting the echo.
        loadReviews();
      } catch (e) {
        setStatus('Could not reach the server. Please try again in a moment.', true);
      } finally {
        if (btn) btn.disabled = false;
        // Token is single-use whatever the outcome was.
        if (turnstileRequired) resetTurnstile();
      }
    });
  }

  initTurnstile();
  loadReviews();
})();
