/* ============================================================
   PRICING - J$ estimate lines (A4, 2026-11-09)
   ------------------------------------------------------------
   Paddle bills in USD; JMD is not a settlement currency. This script paints
   an estimate beside each paid price from GET /api/fx and does nothing else:

     - the USD price is already in the HTML, so it reads correctly with
       JavaScript off;
     - if the rate is stale or the request fails, no J$ line and no footnote
       appear - the page never shows an estimate it cannot date;
     - the amount is rounded to the nearest J$100 by the server contract and
       labelled "billed in USD", because the bank sets the real charge.

   No identifiers, no cookies, no third-party request: same-origin only.
   ============================================================ */
(function () {
  'use strict';

  function group(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function line(usd, period, rate) {
    var jmd = Math.round((usd * rate) / 100) * 100;
    return 'about J$' + group(jmd) + ' / ' + period + ' - billed in USD';
  }

  function paint(data) {
    if (!data || data.available !== true) {
      return;
    }
    var rate = Number(data.jmdPerUsd);
    if (!isFinite(rate) || rate <= 0) {
      return;
    }
    var prices = document.querySelectorAll('[data-usd]');
    for (var i = 0; i < prices.length; i++) {
      var node = prices[i];
      var usd = Number(node.getAttribute('data-usd'));
      var period = node.getAttribute('data-period') || 'month';
      if (!isFinite(usd) || usd <= 0) {
        continue;
      }
      var estimate = document.createElement('p');
      estimate.className = 'pc-jmd';
      estimate.textContent = line(usd, period, rate);
      if (node.parentNode) {
        node.parentNode.insertBefore(estimate, node.nextSibling);
      }
    }
    var grid = document.querySelector('.pricing-grid');
    if (grid && grid.parentNode && data.asOf) {
      var note = document.createElement('p');
      note.className = 'pc-jmd-note';
      note.textContent =
        'J$ amounts are estimates at the ' +
        String(data.asOf) +
        ' rate. Your bank sets the exact amount charged.';
      grid.parentNode.insertBefore(note, grid.nextSibling);
    }
  }

  function load() {
    try {
      fetch('/api/fx', { credentials: 'same-origin' })
        .then(function (res) {
          return res.ok ? res.json() : null;
        })
        .then(paint)
        .catch(function () {
          /* no estimate is better than a wrong one */
        });
    } catch (e) {
      /* fetch unavailable - the USD prices still read correctly */
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
