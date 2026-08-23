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
        setStatus('Thank you! Your review is live for everyone to see.');
        // Prepend the new review (newest first) , re-fetch keeps ordering
        // authoritative without trusting the echo.
        loadReviews();
      } catch (e) {
        setStatus('Could not reach the server. Please try again in a moment.', true);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  loadReviews();
})();
