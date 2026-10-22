/* ============================================================
   My MaNaGeR - Procurement tab (PART H: supplier price book
   + AI quote panel)
   ------------------------------------------------------------
   State key: state.supplierBook  { vendors, items, nvendorid,
   nitemid } - deliberately NOT `procurement` (that is the C10
   material-order log in mmgr-closure.js).
   Namespace: ns.Proc (NOT ns.Procurement - taken by C10).
   The quote panel is a PANEL over the existing relay: it calls
   AiWin.runPreset('quote'), so keys, quota, the sign-in gate
   and error copy are all inherited. No second AI window.
   Vendor lines are entered BY HAND from each supplier's OWN
   rates (owner 2026-10-17): the JIC rate book never touches
   this tab.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const U = ns.Utils;
  const S = () => (ns.State ? ns.State.getState() : null);
  const STALE_DAYS = 30;

  // Ephemeral view state - never written to state, never synced
  // (H8.4: the quote selects read live from the DOM anyway).
  let _selId = ''; // whose items the right column shows
  let _openId = ''; // whose detail panel is disclosed

  function book() {
    const s = S();
    if (!s || !s.supplierBook || typeof s.supplierBook !== 'object') {
      return null;
    }
    return s.supplierBook;
  }

  function toast(msg, kind) {
    if (ns.App && ns.App.showToast) {
      ns.App.showToast(msg, kind || 'ok');
    }
  }

  // Attribute- AND text-safe escaping. U.escapeHtml passes quotes
  // through (it serialises a text node), and every row input below
  // lands inside value="..." / aria-label="..." - a quote in a
  // supplier name would break the attribute. One esc() closes both
  // contexts (H7.3 injection surface).
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // H7.6: quotedBy = the signed-in account, else the honest device label.
  function actorLabel() {
    try {
      const u = ns.GoogleAuth && ns.GoogleAuth.getUser ? ns.GoogleAuth.getUser() : null;
      if (u && u.email) {
        return String(u.email);
      }
    } catch (e) {
      /* display-only label - never block a price save */
    }
    return 'local (this device)';
  }

  function vendorsOf() {
    const b = book();
    return b && Array.isArray(b.vendors) ? b.vendors : [];
  }

  function itemsOf() {
    const b = book();
    return b && Array.isArray(b.items) ? b.items : [];
  }

  // Item rows are stored FLAT and filtered by vendorId (H2), so the
  // table can hand out the global index for updPitem/delPitem.
  function itemIdxFor(vendorId) {
    const out = [];
    const items = itemsOf();
    for (let i = 0; i < items.length; i++) {
      if (String(items[i].vendorId) === String(vendorId)) {
        out.push(i);
      }
    }
    return out;
  }

  function selectedVendor() {
    const id = _selId;
    if (!id) {
      return null;
    }
    const v = vendorsOf().filter(function (x) {
      return String(x.id) === id;
    });
    return v[0] || null;
  }

  function priced(it) {
    return (
      it &&
      it.minPrice !== '' &&
      it.minPrice !== null &&
      it.minPrice !== undefined &&
      isFinite(Number(it.minPrice)) &&
      Number(it.minPrice) >= 0
    );
  }

  function daysSince(iso) {
    const t = iso ? Date.parse(iso) : NaN;
    if (isNaN(t)) {
      return null;
    }
    return Math.floor((Date.now() - t) / 86400000);
  }

  // ---- P2 (directive 2026-10-18, price history) -------------------------
  // Every price edit keeps its trail: append-only, last 12 entries, each
  // {price, quotedAt, quotedBy, qtyBreak} (qtyBreak lands with P5 and is
  // kept null until then). This is the ONE write path - the manual price
  // cell and the P3 import both call it, so history can never fork.
  const PRICE_HISTORY_MAX = 12;
  function pushPriceHistory(list, entry) {
    const base = Array.isArray(list) ? list : [];
    return base.concat([entry]).slice(-PRICE_HISTORY_MAX);
  }

  // P2 sparkline: a one-glance trend from the append-only history.
  // Inline SVG (repo rule: graphics are SVG, never emoji), values listed
  // in the native <title> hover. Rising = red (bad for the buyer).
  function sparkline(it) {
    const h = Array.isArray(it.priceHistory) ? it.priceHistory : [];
    const vals = h
      .map(function (e) {
        return Number(e && e.price);
      })
      .filter(function (n) {
        return isFinite(n);
      });
    if (vals.length < 2) {
      return '';
    }
    const min = Math.min.apply(null, vals),
      max = Math.max.apply(null, vals);
    const w = 46,
      ht = 12;
    const pts = vals
      .map(function (n, i) {
        const x = (i / (vals.length - 1)) * (w - 2) + 1;
        const y = max === min ? ht / 2 : ht - 1 - ((n - min) / (max - min)) * (ht - 2);
        return Math.round(x * 10) / 10 + ',' + Math.round(y * 10) / 10;
      })
      .join(' ');
    const rising = vals[vals.length - 1] > vals[0];
    return (
      '<svg class="ph-spark" width="' +
      w +
      '" height="' +
      ht +
      '" viewBox="0 0 ' +
      w +
      ' ' +
      ht +
      '" role="img" aria-label="Price history, ' +
      vals.length +
      ' entries"><title>' +
      esc(
        vals
          .map(function (n) {
            return Math.round(n * 100) / 100;
          })
          .join(' > ')
      ) +
      '</title><polyline points="' +
      pts +
      '" fill="none" stroke="' +
      (rising ? '#b91c1c' : '#15803d') +
      '" stroke-width="1.4"/></svg>'
    );
  }

  // ---- P5 (directive 2026-10-18, quantity break pricing) ------------------
  // An item may carry volume tiers ({minQty, price}, ascending by minQty),
  // e.g. "1 to 49: 120, 50+: 112". Given a quantity, the applicable unit price
  // is the tier with the LARGEST minQty that is <= qty. With no tiers (or no
  // usable one) the single minPrice is the price - so a plain item prices
  // exactly as before. Tiers never convert currency (C2 rule); each tier is in
  // the item's own currency.
  const TIERS_MAX = 12;
  function tiersOf(it) {
    const raw = it && Array.isArray(it.priceTiers) ? it.priceTiers : [];
    return raw
      .filter(function (t) {
        // A tier needs BOTH a quantity and a REAL price. Number('') is 0, so
        // an empty price box would otherwise price the tier as 0 and quote
        // J$0 for that quantity - require a non-empty numeric price.
        const hasQty = t && t.minQty !== '' && t.minQty !== null && isFinite(Number(t.minQty));
        const hasPrice = t && t.price !== '' && t.price !== null && isFinite(Number(t.price));
        return hasQty && hasPrice && Number(t.minQty) >= 0 && Number(t.price) >= 0;
      })
      .map(function (t) {
        return { minQty: Number(t.minQty), price: Number(t.price) };
      })
      .sort(function (a, b) {
        return a.minQty - b.minQty;
      })
      .slice(0, TIERS_MAX);
  }

  // The one picking rule: largest minQty that does not exceed qty. Returns the
  // unit price as a Number, or null when nothing applies (caller falls back to
  // minPrice). Exported on ns.Proc so the quote builder and tests share it.
  function tierPriceFor(it, qty) {
    const q = Number(qty);
    if (!isFinite(q)) {
      return null;
    }
    const tiers = tiersOf(it);
    let pick = null;
    for (let i = 0; i < tiers.length; i++) {
      if (q >= tiers[i].minQty) {
        pick = tiers[i];
      }
    }
    return pick ? pick.price : null;
  }

  // The effective unit price for a quantity: the tier if one applies, else the
  // item's single minPrice. Returns null when the item has no usable price.
  function unitPriceFor(it, qty) {
    const t = tierPriceFor(it, qty);
    if (t !== null) {
      return t;
    }
    return priced(it) ? Number(it.minPrice) : null;
  }

  // Compact label for the table's Breaks cell: "1+ 120 | 50+ 112", or "-".
  function tierLabel(it) {
    const tiers = tiersOf(it);
    if (!tiers.length) {
      return '';
    }
    return tiers
      .map(function (t) {
        return t.minQty + '+ ' + t.price;
      })
      .join('  |  ');
  }

  // ---- P6 (directive 2026-10-18, landed cost) ----------------------------
  // "Cheapest" must mean cheapest DELIVERED. A supplier's per-delivery
  // on-costs (freight + handling) and each item's duty rate are added to the
  // unit price so the compare view and the quote can rank delivered price.
  // C2 HONESTY: every figure stays in the supplier's OWN currency. We never
  // convert - a landed total is only ever summed within one currency, and a
  // mixed-currency row is kept out of totals exactly as P4 does. Freight and
  // handling are per-DELIVERY, so they are spread over the order quantity
  // (qty defaults to 1 when unknown) to get a per-unit on-cost.
  function numOr(v, dflt) {
    const n = Number(
      String(v == null ? '' : v)
        .trim()
        .replace(/,/g, '')
    );
    return isFinite(n) && n >= 0 ? n : dflt;
  }

  // Per-unit on-costs for a vendor at a given quantity. Returns
  // { freight, handling, duty, lead } as per-unit numbers (0 when unset).
  function landedFor(vendor, item, qty) {
    const q = numOr(qty, 1);
    const divide = q > 0 ? q : 1;
    const freight = numOr(vendor && vendor.landFreight, 0) / divide;
    const handling = numOr(vendor && vendor.landHandling, 0) / divide;
    const duty = numOr(item && item.dutyPct, 0) / 100;
    return {
      freight: freight,
      handling: handling,
      dutyRate: numOr(item && item.dutyPct, 0),
      dutyFactor: 1 + duty,
      lead: numOr(vendor && vendor.landLeadDays, null)
    };
  }

  // The DELIVERED unit price for an item at a quantity, within its own
  // currency. base (from unitPriceFor) -> duty -> + spread freight/handling.
  // Returns null when the item has no usable base price. Never converts.
  function landedUnitFor(vendor, item, qty) {
    const base = unitPriceFor(item, qty);
    if (base === null) {
      return null;
    }
    const lf = landedFor(vendor, item, qty);
    return base * lf.dutyFactor + lf.freight + lf.handling;
  }

  // Staleness badge (H3.2): a price from six months ago is worse than
  // no price, so every disclosed supplier carries its own honest stamp.
  function staleBadge(vendorId) {
    const idxs = itemIdxFor(vendorId);
    if (!idxs.length) {
      return '';
    }
    const items = itemsOf();
    let newest = null;
    let anyPriced = false;
    idxs.forEach(function (i) {
      const it = items[i];
      if (priced(it)) {
        anyPriced = true;
      }
      const t = it.quotedAt ? Date.parse(it.quotedAt) : NaN;
      if (!isNaN(t) && (newest === null || t > newest)) {
        newest = t;
      }
    });
    if (!anyPriced) {
      return '';
    }
    if (newest === null) {
      return '<span class="pv-stale">No price date recorded</span>';
    }
    const days = Math.floor((Date.now() - newest) / 86400000);
    if (days >= STALE_DAYS) {
      const label = days === 1 ? '1 day' : days + ' days';
      return '<span class="pv-stale">Price is ' + label + ' old</span>';
    }
    return '';
  }

  function vendorFields(v, i, open) {
    const f = function (field, label, type, extra) {
      const val = type === 'textarea' ? '' : v[field] || '';
      const inner = type === 'textarea' ? U.escapeHtml(v[field] || '') : esc(val);
      return (
        '<label class="pv-fl" for="pv-' +
        field +
        '-' +
        i +
        '">' +
        esc(label) +
        '</label>' +
        (type === 'textarea'
          ? '<textarea class="pv-in" id="pv-' +
            field +
            '-' +
            i +
            '" data-action="updPvendor" data-idx="' +
            i +
            '" data-field="' +
            field +
            '" aria-label="' +
            esc(label) +
            '" rows="2">' +
            inner +
            '</textarea>'
          : '<input class="pv-in" type="' +
            type +
            '" id="pv-' +
            field +
            '-' +
            i +
            '" value="' +
            inner +
            '" data-action="updPvendor" data-idx="' +
            i +
            '" data-field="' +
            field +
            '" aria-label="' +
            esc(label) +
            '"' +
            (extra || '') +
            '>')
      );
    };
    // H7.6: duplicate vendor names are allowed but warned.
    let dup = '';
    const name = String(v.name || '')
      .trim()
      .toLowerCase();
    if (name) {
      const same = vendorsOf().filter(function (x) {
        return (
          String(x.name || '')
            .trim()
            .toLowerCase() === name
        );
      });
      if (same.length > 1) {
        dup =
          '<div class="pv-dup">Two suppliers share this name. That is allowed, but a clear name keeps quotes unambiguous.</div>';
      }
    }
    return (
      '<div class="pv-panel" id="pv-panel-' +
      i +
      '"' +
      (open ? '' : ' hidden') +
      '>' +
      f('name', 'Supplier name', 'text') +
      f('contact', 'Contact person', 'text') +
      f('phone', 'Phone', 'tel') +
      f('email', 'Email', 'email') +
      f('notes', 'Notes', 'textarea') +
      // P6 landed cost: per-DELIVERY on-costs in this supplier's own currency
      // (never converted). Spread across the order quantity to rank delivered
      // price in the compare view. Duty is per-item (see the item table).
      '<div class="pv-sub">Delivery and on-costs (this supplier\u2019s currency)</div>' +
      f('landFreight', 'Freight per delivery', 'text', ' inputmode="decimal"') +
      f('landHandling', 'Handling per delivery', 'text', ' inputmode="decimal"') +
      f('landLeadDays', 'Delivery lead (days)', 'text', ' inputmode="numeric"') +
      dup +
      '<div class="g6"><button type="button" class="btn btn-d btn-s" data-action="delPvendor" data-idx="' +
      i +
      '">Remove supplier</button></div>' +
      '</div>'
    );
  }

  function renderVendors() {
    const list = U.$('proc-vendors');
    if (!list) {
      return;
    }
    const count = U.$('proc-vendor-count');
    const vendors = vendorsOf();
    if (count) {
      count.textContent = vendors.length ? ' (' + vendors.length + ')' : '';
    }
    if (!vendors.length) {
      list.innerHTML =
        '<div class="proc-empty">No suppliers yet. Add one to start your price book.</div>';
      return;
    }
    const items = itemsOf();
    const html = vendors.map(function (v, i) {
      const n = items.filter(function (it) {
        return String(it.vendorId) === String(v.id);
      }).length;
      const open = _openId !== '' && String(v.id) === _openId;
      return (
        '<div class="pv-row">' +
        '<button type="button" class="pv-disc" id="pv-disc-' +
        i +
        '" aria-expanded="' +
        (open ? 'true' : 'false') +
        '" aria-controls="pv-panel-' +
        i +
        '" data-action="selVendor" data-idx="' +
        i +
        '" data-id="' +
        esc(v.id) +
        '">' +
        '<span class="pv-name">' +
        esc(v.name || '(unnamed supplier)') +
        '</span>' +
        '<span class="pv-meta">' +
        (n === 1 ? '1 item' : n + ' items') +
        '</span>' +
        staleBadge(v.id) +
        '</button>' +
        vendorFields(v, i, open) +
        '</div>'
      );
    });
    list.innerHTML = html.join('');
  }

  function renderItems() {
    const sub = U.$('proc-vendor-sub');
    const body = U.$('proc-item-body');
    const subtot = U.$('proc-subtotal');
    if (!body) {
      return;
    }
    const v = selectedVendor();
    if (sub) {
      sub.textContent = v ? ' - ' + (v.name || '(unnamed supplier)') : ' - pick a supplier';
    }
    if (!v) {
      body.innerHTML =
        '<tr><td colspan="12" class="proc-empty">Pick a supplier to see what they offer.</td></tr>';
      if (subtot) {
        subtot.textContent = '';
        subtot.classList.add('is-hide');
      }
      return;
    }
    const idxs = itemIdxFor(v.id);
    if (!idxs.length) {
      body.innerHTML =
        '<tr><td colspan="12" class="proc-empty">No items recorded yet. Add what this supplier offers and their price.</td></tr>';
      if (subtot) {
        subtot.textContent = '';
        subtot.classList.add('is-hide');
      }
      return;
    }
    const items = itemsOf();
    body.innerHTML = idxs
      .map(function (gi) {
        const it = items[gi];
        const qd =
          it.quotedAt && !isNaN(Date.parse(it.quotedAt)) ? String(it.quotedAt).slice(0, 10) : '-';
        const stale = staleBadge(v.id);
        return (
          '<tr>' +
          '<td>' +
          esc(it.id) +
          '</td>' +
          '<td><input type="text" value="' +
          esc(it.name || '') +
          '" data-action="updPitem" data-idx="' +
          gi +
          '" data-field="name" aria-label="Item name" placeholder="What they sell"></td>' +
          '<td><input type="text" value="' +
          esc(it.unit || '') +
          '" data-action="updPitem" data-idx="' +
          gi +
          '" data-field="unit" aria-label="Unit" placeholder="bag, litre, m"></td>' +
          '<td><input type="text" inputmode="decimal" value="' +
          esc(it.minPrice === 0 ? '0' : it.minPrice || '') +
          '" data-action="updPitem" data-idx="' +
          gi +
          '" data-field="minPrice" aria-label="Lowest price" placeholder="0"></td>' +
          '<td><input type="text" value="' +
          esc(it.currency || 'JMD') +
          '" data-action="updPitem" data-idx="' +
          gi +
          '" data-field="currency" aria-label="Currency" placeholder="JMD"></td>' +
          '<td><input type="text" inputmode="numeric" value="' +
          esc(it.leadTimeDays === 0 ? '0' : it.leadTimeDays || '') +
          '" data-action="updPitem" data-idx="' +
          gi +
          '" data-field="leadTimeDays" aria-label="Lead time in days" placeholder="-"></td>' +
          '<td><input type="text" inputmode="numeric" value="' +
          esc(it.minOrder === 0 ? '0' : it.minOrder || '') +
          '" data-action="updPitem" data-idx="' +
          gi +
          '" data-field="minOrder" aria-label="Minimum order quantity" placeholder="-"></td>' +
          '<td class="proc-qd">' +
          esc(qd) +
          sparkline(it) +
          (stale ? '<br>' + stale : '') +
          '</td>' +
          '<td><input type="text" inputmode="decimal" value="' +
          esc(it.dutyPct === 0 ? '0' : it.dutyPct || '') +
          '" data-action="updPitem" data-idx="' +
          gi +
          '" data-field="dutyPct" aria-label="Duty rate percent" placeholder="-"></td>' +
          '<td class="proc-brk">' +
          (function () {
            const lbl = tierLabel(it);
            // The button's VISIBLE text is the label (or "Set breaks"). The
            // accessible name must CONTAIN that visible text (axe SC 2.5.3),
            // so lead with it and append the purpose.
            const shown = lbl ? esc(lbl) : 'Set breaks';
            return (
              '<button type="button" class="btn btn-n btn-s" data-action="openTiers" data-idx="' +
              gi +
              '" aria-label="' +
              shown +
              ' - edit quantity breaks for ' +
              esc(it.name || 'item') +
              '">' +
              shown +
              '</button>' +
              // P10 lead time -> schedule. Stacked under the breaks button in
              // the SAME cell so the table stays 12 columns wide (no new
              // "wall"): both are per-item setup actions. Disabled with no
              // recorded lead days so we never attach a guessed duration.
              (function () {
                const ld = parseInt(it.leadTimeDays, 10);
                const ok = isFinite(ld) && ld > 0;
                return (
                  '<button type="button" class="btn btn-n btn-s mt4' +
                  (ok ? '' : ' is-off') +
                  '" data-action="procLead" data-idx="' +
                  gi +
                  '"' +
                  (ok ? '' : ' disabled') +
                  ' aria-label="Schedule - attach the ' +
                  (ok ? ld + '-day' : 'lead') +
                  ' lead time for ' +
                  esc(it.name || 'item') +
                  ' to a task">Schedule</button>'
                );
              })()
            );
          })() +
          '</td>' +
          '<td><input type="text" value="' +
          esc(it.notes || '') +
          '" data-action="updPitem" data-idx="' +
          gi +
          '" data-field="notes" aria-label="Notes" placeholder="-"></td>' +
          '<td class="w50"><button type="button" class="btn btn-s btn-d" data-action="delPitem" data-idx="' +
          Number(gi) +
          '" aria-label="Remove ' +
          esc(it.name || 'item') +
          '"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg></button></td>' +
          '</tr>'
        );
      })
      .join('');
    // ONE subtotal source (H2/H6): the same verdict string the quote
    // prompt and the local draft emit, so a subtotal in a generated
    // quote is always copyable byte-for-byte from what the panel shows.
    if (subtot) {
      const selItems = idxs.map(function (gi) {
        return items[gi];
      });
      const totals = ns.Prompts && ns.Prompts.bookTotals ? ns.Prompts.bookTotals(selItems) : null;
      const text = totals && totals.verdict ? totals.verdict : '';
      subtot.textContent = text;
      subtot.classList.toggle('is-hide', !text);
    }
  }

  function renderQuoteOpts() {
    const sel = U.$('proc-quote-vendor');
    if (!sel) {
      return;
    }
    const vendors = vendorsOf();
    const opts = ['<option value="">Pick a supplier</option>'];
    let stillThere = false;
    vendors.forEach(function (v) {
      const id = String(v.id);
      if (id === _quoteVendorSel()) {
        stillThere = true;
      }
      opts.push(
        '<option value="' +
          esc(id) +
          '"' +
          (id === _quoteVendorSel() ? ' selected' : '') +
          '>' +
          esc(v.name || '(unnamed supplier)') +
          '</option>'
      );
    });
    sel.innerHTML = opts.join('');
    if (_quoteVendorSel() && !stillThere) {
      sel.value = '';
    }
  }

  // The live select is the source of truth; the module var only
  // covers the before-first-render case (getQuoteOpts is called by
  // the prompt builders, which may run before the panel ever opened).
  let _quoteVendor = '';
  let _quoteOk = false;
  function _quoteVendorSel() {
    const el = U.$('proc-quote-vendor');
    return el ? String(el.value || '') : _quoteVendor;
  }

  function render() {
    renderVendors();
    renderItems();
    renderQuoteOpts();
    renderRfq();
    if (_imp) {
      renderImport();
    }
    if (_cmpOpen) {
      renderCompare();
    }
  }

  // ---- Suppliers ----
  function addPvendor() {
    let newId = '';
    ns.State.updateState(function (s) {
      if (!s.supplierBook || typeof s.supplierBook !== 'object') {
        s.supplierBook = { vendors: [], items: [], nvendorid: 1, nitemid: 1 };
      }
      const b = s.supplierBook;
      if (!Array.isArray(b.vendors)) {
        b.vendors = [];
      }
      const n = b.nvendorid > 0 ? b.nvendorid : 1;
      newId = 'v' + n;
      b.nvendorid = n + 1;
      b.vendors.push({
        id: newId,
        name: '',
        contact: '',
        phone: '',
        email: '',
        notes: '',
        updatedAt: new Date().toISOString()
      });
    });
    _selId = newId;
    _openId = newId;
    render();
    // Land the officer straight in the name field (owner workflow:
    // Add -> type what they offer).
    const el = document.querySelector(
      '#proc-vendors .pv-row input[data-field="name"][data-idx="' + (vendorsOf().length - 1) + '"]'
    );
    if (el) {
      el.focus();
    }
  }

  function delPvendor(el) {
    const idx = parseInt(el.getAttribute('data-idx'), 10);
    const vendors = vendorsOf();
    const v = vendors[idx];
    if (!v) {
      return;
    }
    ns.State.updateState(function (s) {
      const b = s.supplierBook;
      if (!b || !Array.isArray(b.vendors)) {
        return;
      }
      const victim = b.vendors[idx];
      // Their item rows go with them - an orphaned price line has no
      // supplier to belong to.
      if (victim && Array.isArray(b.items)) {
        b.items = b.items.filter(function (it) {
          return String(it.vendorId) !== String(victim.id);
        });
      }
      b.vendors.splice(idx, 1);
    });
    if (_selId === String(v.id)) {
      _selId = '';
      _openId = '';
    }
    render();
    toast('Supplier removed.', 'ok');
  }

  function updPvendor(el, e) {
    const idx = parseInt(el.getAttribute('data-idx'), 10);
    const field = el.getAttribute('data-field');
    let value = el.type === 'checkbox' ? el.checked : el.value;
    if (field === 'name' && String(value).length > 80) {
      return; // H7.6: names cap at 80; ignore the over-long keystroke
    }
    if (field === 'notes' && String(value).length > 500) {
      return;
    }
    // P6 landed cost: freight/handling/lead validate AT THE SEAM so state
    // never holds a number a later gate would reject. Same pattern as updPitem.
    if (field === 'landFreight' || field === 'landHandling') {
      const raw = String(value).trim();
      if (raw !== '') {
        const p = Number(raw.replace(/,/g, ''));
        if (!isFinite(p) || p < 0 || raw.length > 12) {
          return;
        }
      }
      value = raw.replace(/,/g, '');
    }
    if (field === 'landLeadDays') {
      const raw = String(value).trim();
      if (raw !== '' && !/^\d{0,4}$/.test(raw)) {
        return;
      }
    }
    value = String(value);
    ns.State.updateState(function (s) {
      if (s.supplierBook && s.supplierBook.vendors && s.supplierBook.vendors[idx]) {
        s.supplierBook.vendors[idx][field] = value;
        s.supplierBook.vendors[idx].updatedAt = new Date().toISOString();
      }
    });
    // Focus discipline (established evtType rule): save on keystroke,
    // re-render on commit so the header + stale badges stay live.
    if (e && e.type === 'input') {
      return;
    }
    render();
  }

  function selVendor(el) {
    const idx = parseInt(el.getAttribute('data-idx'), 10);
    const v = vendorsOf()[idx];
    if (!v) {
      return;
    }
    const id = String(v.id);
    _selId = id;
    // Real disclosure: click again collapses the detail panel (items
    // stay visible in the right column - the owner's "dropdown" keeps
    // answering the question that was asked).
    _openId = _openId === id ? '' : id;
    render();
    const btn = U.$('pv-disc-' + idx);
    if (btn) {
      btn.focus();
    }
  }

  // ---- Items ----
  function addPitem() {
    const v = selectedVendor();
    if (!v) {
      toast('Pick a supplier first, then add what they offer.', 'warn');
      return;
    }
    ns.State.updateState(function (s) {
      const b = s.supplierBook;
      const n = b.nitemid > 0 ? b.nitemid : 1;
      b.nitemid = n + 1;
      b.items.push({
        id: 'i' + n,
        vendorId: v.id,
        name: '',
        unit: '',
        minPrice: '',
        currency: 'JMD',
        leadTimeDays: '',
        minOrder: '',
        dutyPct: '',
        notes: '',
        quotedAt: '',
        quotedBy: '',
        priceHistory: []
      });
    });
    render();
    const rows = document.querySelectorAll('#proc-item-body input[data-field="name"]');
    if (rows.length) {
      rows[rows.length - 1].focus();
    }
  }

  function delPitem(el) {
    const idx = parseInt(el.getAttribute('data-idx'), 10);
    ns.State.updateState(function (s) {
      if (s.supplierBook && Array.isArray(s.supplierBook.items) && s.supplierBook.items[idx]) {
        s.supplierBook.items.splice(idx, 1);
      }
    });
    render();
  }

  function updPitem(el, e) {
    const idx = parseInt(el.getAttribute('data-idx'), 10);
    const field = el.getAttribute('data-field');
    let value = el.value;

    // H7.6 validation, applied AT THE SEAM so a half-typed value is
    // simply not written (state never holds a number the gate would
    // later reject).
    if (field === 'minPrice') {
      const raw = String(value).trim();
      if (raw !== '') {
        const p = Number(raw);
        if (!isFinite(p) || p < 0 || raw.length > 12) {
          return;
        }
      }
    }
    if (field === 'leadTimeDays') {
      const raw = String(value).trim();
      if (raw !== '' && !/^\d{0,4}$/.test(raw)) {
        return;
      }
    }
    if (field === 'minOrder') {
      const raw = String(value).trim();
      if (raw !== '' && !/^\d{0,6}$/.test(raw)) {
        return;
      }
    }
    // P6 landed cost: a per-item duty RATE (percent). Cap at 1000% and allow
    // one decimal; validated AT THE SEAM like every other numeric field.
    if (field === 'dutyPct') {
      const raw = String(value).trim();
      if (raw !== '' && (!/^\d{0,4}(\.\d{1,2})?$/.test(raw) || Number(raw) > 1000)) {
        return;
      }
    }
    if (field === 'name' && String(value).length > 80) {
      return;
    }
    if (field === 'notes' && String(value).length > 500) {
      return;
    }
    if (field === 'currency') {
      value = String(value).trim().toUpperCase().slice(0, 6);
    }

    let priceChanged = false;
    ns.State.updateState(function (s) {
      const b = s.supplierBook;
      if (!b || !Array.isArray(b.items) || !b.items[idx]) {
        return;
      }
      const it = b.items[idx];
      const before = it.minPrice;
      it[field] = value;
      // H7.6: every price change stamps who quoted it and when -
      // that stamp is what the staleness badge and the quote's
      // "quoted N days ago" line read.
      if (field === 'minPrice' && String(before) !== String(value)) {
        it.quotedAt = new Date().toISOString();
        it.quotedBy = actorLabel();
        // P2: the trail. Same append-only helper the import uses.
        it.priceHistory = pushPriceHistory(it.priceHistory, {
          price: String(value),
          quotedAt: it.quotedAt,
          quotedBy: it.quotedBy,
          qtyBreak: null
        });
        priceChanged = true;
      }
    });

    // Focus discipline (established evtType rule): save on keystroke,
    // re-render on commit. A price keystroke needs no re-render either
    // (the Quoted cell only changes meaning on commit).
    if (e && e.type === 'input') {
      return;
    }
    render();
    if (priceChanged) {
      toast('Price updated.', 'ok');
    }
  }

  // ---- AI quote panel (H2: one engine, never a second window) ----
  function getQuoteOpts() {
    const tone = U.$('proc-quote-tone');
    // P8 RFQ email pack: the term fields are read LIVE (ephemeral, H8.4) so
    // they never touch project state and need no migration.
    const valid = U.$('proc-quote-valid');
    const site = U.$('proc-quote-site');
    const terms = U.$('proc-quote-terms');
    return {
      vendorId: _quoteVendorSel(),
      tone: tone ? String(tone.value || 'rfq') || 'rfq' : 'rfq',
      validUntil: valid ? String(valid.value || '').slice(0, 40) : '',
      site: site ? String(site.value || '').slice(0, 120) : '',
      terms: terms ? String(terms.value || '').slice(0, 120) : ''
    };
  }

  function procQuoteVendor(el) {
    _quoteVendor = String(el.value || '');
  }

  function procQuoteTone(el) {
    // ephemeral, never state - getQuoteOpts reads the live select
    void el;
    // P9: switching to/from the award tone toggles the Purchase order
    // button - a PO is only raised from an awarded quote.
    syncPoBtn();
  }

  // P8: the term inputs are ephemeral too - getQuoteOpts reads them live.
  // Kept as a dispatch target so the change/input events have a handler and
  // the audit-action-map gate sees a real ACTION_MAP entry.
  function procQuoteTerm(el) {
    void el;
  }

  // P8: open the generated quote in the mail client. The subject names the
  // project + supplier; the body is the EXACT text already on screen (the
  // quote writer's byte-for-byte figures), so this adds no numbers of its
  // own - H7.2 integrity carries straight through to the mail client.
  function procQuoteMailto() {
    const out = U.$('proc-quote-out');
    const text = out ? out.textContent : '';
    if (!text) {
      toast('Write the quote first, then open it in email.', 'warn');
      return;
    }
    const opts = getQuoteOpts();
    const v = vendorsOf().filter(function (x) {
      return String(x.id) === String(opts.vendorId);
    })[0];
    const vendorName = v ? v.name || 'Supplier' : 'Supplier';
    const s = S();
    const pn = (s && s.charter && s.charter.name) || (s && s.projectName) || 'our project';
    const toneWord = opts.tone === 'award' ? 'Award' : opts.tone === 'thanks' ? 'Thank you' : 'RFQ';
    const subject = toneWord + ': ' + pn + ' - ' + vendorName;
    window.location.href =
      'mailto:' +
      encodeURIComponent((v && v.email) || '') +
      '?subject=' +
      encodeURIComponent(subject) +
      '&body=' +
      encodeURIComponent(text);
  }

  async function procQuote() {
    const out = U.$('proc-quote-out');
    const btn = document.querySelector('[data-action="procQuote"]');
    if (!out) {
      return;
    }
    if (!vendorsOf().length) {
      out.textContent = 'Add a supplier and their prices first, then write the quote.';
      return;
    }
    out.textContent = 'Writing your quote...';
    if (btn) {
      btn.disabled = true;
    }
    let res = null;
    try {
      res = await ns.AiWin.runPreset('quote');
    } catch (e) {
      res = { ok: false, error: (e && e.message) || 'The quote could not be written. Try again.' };
    } finally {
      if (btn) {
        btn.disabled = false;
      }
    }
    const copyBtn = U.$('proc-quote-copy');
    const mailBtn = U.$('proc-quote-mailto');
    if (res && res.ok && res.text) {
      out.textContent = res.text;
      _quoteOk = true;
      if (copyBtn) {
        copyBtn.classList.remove('is-hide');
      }
      if (mailBtn) {
        mailBtn.classList.remove('is-hide');
      }
    } else {
      let err = (res && res.error) || 'The quote could not be written. Try again.';
      if (err === 'busy') {
        err = 'The assistant is already writing. Give it a moment.';
      }
      out.textContent = err;
      _quoteOk = false;
      if (copyBtn) {
        copyBtn.classList.add('is-hide');
      }
      if (mailBtn) {
        mailBtn.classList.add('is-hide');
      }
    }
    syncPoBtn();
  }

  function procQuoteCopy() {
    const out = U.$('proc-quote-out');
    const text = out ? out.textContent : '';
    if (!text) {
      return;
    }
    U.copyToClipboard(text).then(function () {
      toast('Quote copied. Paste it into your email.', 'ok');
    });
  }

  // ============================================================
  // P9 (directive 2026-10-18, purchase order PDF): from an AWARDED
  // quote (tone = 'award') raise a one-page PO on the shared C5b PDF
  // writer. The PO number mirrors the calculator's docNoSuggest format
  // (PREFIX-0001) - that helper is page-scoped to calculator.html, so
  // the PO keeps the same zero-padded convention with its own counter
  // (mmgr_po_counter). Lines join the supplier's priced items to the
  // RFQ handoff (P7) quantities by normalised name; with no RFQ the
  // minimum order quantity is the grounded starting qty. Every figure
  // is a real book number (H7.2) - nothing is invented. Delivery is
  // derived from the longest lead time (or 'As agreed'). Ephemeral:
  // reads live, writes only the counter (localStorage), never state.
  // ============================================================
  const PO_NO_KEY = 'mmgr_po_counter';

  function poNextNo() {
    let n = 1;
    try {
      n = parseInt(localStorage.getItem(PO_NO_KEY), 10) || 1;
    } catch (e) {
      n = 1;
    }
    try {
      localStorage.setItem(PO_NO_KEY, String(n + 1));
    } catch (e) {
      /* a full/blocked localStorage must not break the export */
    }
    return 'PO-' + (n < 10 ? '000' + n : n < 100 ? '00' + n : n < 1000 ? '0' + n : String(n));
  }

  function poMoney(n) {
    const v = Number(n);
    if (!isFinite(v)) {
      return '-';
    }
    const p = v.toFixed(2).split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return p.join('.');
  }

  function poNormName(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  // Ordered lines: the supplier's priced items, qty joined from the RFQ
  // handoff by name (real estimate quantities) else the item's minimum
  // order quantity. total = qty x unit price, only when a qty is known.
  function poLines(vendorId) {
    const rfq = getRfq();
    const qByName = {};
    if (rfq && Array.isArray(rfq.lines)) {
      rfq.lines.forEach(function (l) {
        const q = Number(l.qty);
        if (isFinite(q)) {
          qByName[poNormName(l.name)] = q;
        }
      });
    }
    return itemsOf()
      .filter(function (it) {
        return String(it.vendorId) === String(vendorId) && priced(it);
      })
      .map(function (it) {
        const k = poNormName(it.name);
        const rfqQ = qByName[k];
        const moq =
          it.minOrder !== '' && isFinite(Number(it.minOrder)) ? Number(it.minOrder) : null;
        const qty = rfqQ !== undefined ? rfqQ : moq;
        const unitPrice = Number(it.minPrice);
        return {
          name: it.name || 'Item',
          unit: it.unit || '',
          currency: it.currency || 'JMD',
          unitPrice: unitPrice,
          qty: qty,
          total: qty !== null && qty !== undefined ? qty * unitPrice : null,
          lead:
            it.leadTimeDays !== '' && isFinite(Number(it.leadTimeDays))
              ? Number(it.leadTimeDays)
              : null
        };
      });
  }

  // Per-currency totals only - a mixed-currency book is never summed into
  // one figure (C2 rule). Returns [{currency,total}].
  function poTotals(lines) {
    const byCur = {};
    lines.forEach(function (l) {
      if (l.total !== null && l.total !== undefined) {
        byCur[l.currency] = (byCur[l.currency] || 0) + l.total;
      }
    });
    return Object.keys(byCur).map(function (c) {
      return { currency: c, total: byCur[c] };
    });
  }

  // Delivery date derived from the longest lead time (grounded). No usable
  // lead time -> 'As agreed' - never an invented date.
  function poDeliveryDate(lines) {
    let maxLead = null;
    lines.forEach(function (l) {
      if (l.lead !== null && l.lead !== undefined && (maxLead === null || l.lead > maxLead)) {
        maxLead = l.lead;
      }
    });
    if (maxLead === null || maxLead <= 0) {
      return 'As agreed';
    }
    return new Date(Date.now() + maxLead * 86400000).toISOString().slice(0, 10);
  }

  // The neutral draw list for ns.Pdf.build (px, y down). One 'fit' page.
  function buildPoDraw(d) {
    const W = 800;
    const M = 40;
    const prims = [];
    const text = function (x, y, str, o) {
      prims.push(
        Object.assign(
          { type: 'text', x: x, y: y, str: String(str), size: 11, fill: '#111827', weight: 400 },
          o || {}
        )
      );
    };
    const line = function (x1, y1, x2, y2, o) {
      prims.push(
        Object.assign(
          { type: 'line', x1: x1, y1: y1, x2: x2, y2: y2, stroke: '#d1d5db', lw: 1 },
          o || {}
        )
      );
    };
    text(M, 52, 'PURCHASE ORDER', { size: 22, weight: 700 });
    text(W - M, 52, d.no, { size: 14, weight: 700, align: 'right' });
    text(M, 74, d.project, { size: 11, fill: '#6b7280' });
    text(W - M, 74, 'Issued ' + d.today, { size: 11, fill: '#6b7280', align: 'right' });
    line(M, 88, W - M, 88, { stroke: '#111827', lw: 1.5 });
    let y = 112;
    // supplier (left)
    text(M, y, 'SUPPLIER', { size: 9, fill: '#6b7280', weight: 700 });
    y += 16;
    text(M, y, d.vendor.name || 'Supplier', { size: 13, weight: 700 });
    y += 16;
    ['contact', 'phone', 'email'].forEach(function (f) {
      if (d.vendor[f]) {
        text(M, y, d.vendor[f], { fill: '#374151' });
        y += 15;
      }
    });
    // terms (right)
    const rx = 480;
    let ry = 112;
    [
      ['DELIVER TO', d.site || 'As agreed'],
      ['DELIVERY', d.delivery],
      ['PAYMENT TERMS', d.terms || 'As agreed']
    ].forEach(function (pair) {
      text(rx, ry, pair[0], { size: 9, fill: '#6b7280', weight: 700 });
      ry += 16;
      text(rx, ry, pair[1], { fill: '#374151' });
      ry += 20;
    });
    y = Math.max(y, ry) + 8;
    line(M, y, W - M, y);
    y += 22;
    // table header
    const cItem = M + 28,
      cUnit = 360,
      cQty = 470,
      cPrice = 590,
      cCur = 606,
      cTotal = W - M;
    text(M, y, '#', { size: 9, fill: '#6b7280', weight: 700 });
    text(cItem, y, 'ITEM', { size: 9, fill: '#6b7280', weight: 700 });
    text(cUnit, y, 'UNIT', { size: 9, fill: '#6b7280', weight: 700 });
    text(cQty, y, 'QTY', { size: 9, fill: '#6b7280', weight: 700, align: 'right' });
    text(cPrice, y, 'UNIT PRICE', { size: 9, fill: '#6b7280', weight: 700, align: 'right' });
    text(cCur, y, 'CUR', { size: 9, fill: '#6b7280', weight: 700 });
    text(cTotal, y, 'TOTAL', { size: 9, fill: '#6b7280', weight: 700, align: 'right' });
    y += 8;
    line(M, y, W - M, y, { stroke: '#111827', lw: 1 });
    y += 18;
    // rows
    d.lines.forEach(function (l, i) {
      text(M, y, i + 1, { fill: '#374151' });
      text(cItem, y, l.name);
      text(cUnit, y, l.unit, { fill: '#374151' });
      text(cQty, y, l.qty === null || l.qty === undefined ? '-' : l.qty, { align: 'right' });
      text(cPrice, y, poMoney(l.unitPrice), { align: 'right' });
      text(cCur, y, l.currency, { fill: '#374151' });
      text(cTotal, y, l.total === null || l.total === undefined ? '-' : poMoney(l.total), {
        align: 'right'
      });
      y += 18;
      line(M, y - 8, W - M, y - 8, { stroke: '#e5e7eb', lw: 0.5 });
    });
    y += 6;
    line(M, y, W - M, y, { stroke: '#111827', lw: 1 });
    y += 20;
    // totals (per currency)
    const totals = poTotals(d.lines);
    if (totals.length) {
      totals.forEach(function (t) {
        text(W - M, y, 'Total (' + t.currency + '): ' + poMoney(t.total), {
          size: 12,
          weight: 700,
          align: 'right'
        });
        y += 18;
      });
    } else {
      text(W - M, y, 'Total: on confirmation', { size: 12, weight: 700, align: 'right' });
      y += 18;
    }
    y += 20;
    // signature block
    line(M, y, W - M, y, { stroke: '#d1d5db', lw: 1 });
    y += 28;
    const halfW = (W - 2 * M) / 2;
    text(M, y, 'Authorised signature', { size: 9, fill: '#6b7280' });
    text(M + halfW, y, 'Accepted by (Supplier)', { size: 9, fill: '#6b7280' });
    y += 34;
    line(M, y, M + halfW - 20, y, { stroke: '#374151', lw: 1 });
    line(M + halfW, y, W - M, y, { stroke: '#374151', lw: 1 });
    y += 16;
    text(M, y, d.project, { size: 9, fill: '#6b7280' });
    text(M + halfW, y, d.vendor.name || 'Supplier', { size: 9, fill: '#6b7280' });
    y += 30;
    return { prims: prims, W: W, H: y };
  }

  // Reveal the Purchase order button only for an AWARD-tone quote that
  // actually produced text - a PO is raised from an awarded quote.
  function syncPoBtn() {
    const btn = U.$('proc-po');
    if (!btn) {
      return;
    }
    const show = getQuoteOpts().tone === 'award' && _quoteOk;
    btn.classList.toggle('is-hide', !show);
  }

  function procPo() {
    const opts = getQuoteOpts();
    const v = vendorsOf().filter(function (x) {
      return String(x.id) === String(opts.vendorId);
    })[0];
    if (!v) {
      toast('Pick the awarded supplier first, then raise the purchase order.', 'warn');
      return;
    }
    const lines = poLines(String(v.id));
    if (!lines.length) {
      toast('That supplier has no priced items to order.', 'warn');
      return;
    }
    if (!ns.Pdf || typeof ns.Pdf.build !== 'function') {
      toast('PDF export is unavailable.', 'err');
      return;
    }
    const s = S();
    const project = (s && s.charter && s.charter.name) || (s && s.projectName) || 'Project';
    const no = poNextNo();
    const draw = buildPoDraw({
      no: no,
      project: project,
      vendor: v,
      lines: lines,
      site: opts.site,
      terms: opts.terms,
      delivery: poDeliveryDate(lines),
      today: new Date().toISOString().slice(0, 10)
    });
    const res = ns.Pdf.build(draw.prims, { page: 'fit', W: draw.W, H: draw.H, hdrPx: 0 });
    window.__poPdf = res;
    window.__poMeta = {
      no: no,
      supplier: v.name || 'Supplier',
      lines: lines.length,
      delivery: poDeliveryDate(lines),
      pages: res.pages,
      bytes: res.bytes.length,
      pdf: String.fromCharCode.apply(null, res.bytes.subarray(0, 5))
    };
    poDownload(new Blob([res.bytes], { type: 'application/pdf' }), 'po-' + no + '.pdf');
    toast('Purchase order ' + no + ' exported (PDF).', 'ok');
  }

  // local download helper (mmgr-app's ganttDownload is not on ns.Proc).
  function poDownload(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 400);
  }

  // ============================================================
  // P10 (directive 2026-10-18, lead time -> schedule): a supplier's
  // stated lead time on a procured item marks an EXISTING schedule
  // task as a lead-time item and stamps its tracking dates -
  //   submittedDate = today (the order date)
  //   expectedDate  = today + the item's leadTimeDays
  // so it flows straight into the Dashboard Lead-Time Tracker, the
  // Kanban lead-time lane and the hatched Gantt bar (all of which
  // already read t.leadTime / submittedDate / expectedDate). No new
  // tasks are created and no lead time is ever invented: with no
  // recorded lead days the card says so and the Link button is off.
  // It also warns - toast AND an inline tracker note - when order date
  // plus lead time lands AFTER the task's own start date, which is the
  // Primavera-style "you ordered too late" signal. Ephemeral picker;
  // only the chosen task's fields are written to project state.
  // ============================================================
  let _leadIdx = -1;

  function procLead(el) {
    const idx = parseInt(el.getAttribute('data-idx'), 10);
    if (!isFinite(idx) || !itemsOf()[idx]) {
      return;
    }
    _leadIdx = idx;
    const sec = U.$('proc-lead');
    if (sec) {
      sec.classList.remove('is-hide');
    }
    // One disclosure card at a time (same discipline as tiers/import/compare).
    ['proc-tiers', 'proc-import', 'proc-compare'].forEach(function (id) {
      const n = U.$(id);
      if (n) {
        n.classList.add('is-hide');
      }
    });
    _imp = null;
    _cmpOpen = false;
    renderLead();
  }

  function closeLead() {
    _leadIdx = -1;
    const sec = U.$('proc-lead');
    if (sec) {
      sec.classList.add('is-hide');
    }
  }

  // The card body: what this item promises, and which task to attach it to.
  // The lead days are echoed from the row - the Link button is disabled when
  // there is none, so the schedule is never seeded with a guessed duration.
  function renderLead() {
    const el = U.$('proc-lead-body');
    if (!el) {
      return;
    }
    const it = itemsOf()[_leadIdx];
    const s = S();
    const tasks = ((s && s.tasks) || []).filter(function (t) {
      return t && !t.isPhase;
    });
    if (!it) {
      el.innerHTML =
        '<div class="proc-empty">Pick an item first, then attach its lead time to a task.</div>';
      return;
    }
    const lead = parseInt(it.leadTimeDays, 10);
    const hasLead = isFinite(lead) && lead > 0;
    let html =
      '<div class="ct-sub"><strong>' +
      esc(it.name || '(unnamed item)') +
      '</strong> - supplier lead time: ' +
      (hasLead ? lead + ' days' : 'not set on this row yet') +
      '.</div>';
    if (!tasks.length) {
      html +=
        '<div class="proc-empty">No schedule tasks to attach to yet. Add a task in the Schedule first.</div>';
      el.innerHTML = html;
      return;
    }
    html +=
      '<div class="g6 mt8">' +
      '<label class="pv-fl" for="proc-lead-task">Attach to task</label>' +
      '<select id="proc-lead-task" class="btn btn-n btn-s cur-pt" aria-label="Schedule task to attach this lead time to">';
    tasks.forEach(function (t) {
      html +=
        '<option value="' +
        esc(t.id) +
        '">' +
        esc(t.name || 'Task') +
        (t.startDate ? ' (starts ' + esc(t.startDate) + ')' : '') +
        '</option>';
    });
    html += '</select>';
    html +=
      '<button type="button" class="btn btn-g btn-s" data-action="procLeadLink"' +
      (hasLead ? '' : ' disabled') +
      '>Link lead time</button>';
    html += '</div>';
    if (!hasLead) {
      html +=
        '<div class="proc-empty">Set "Lead days" on this item\u2019s row first, then attach it - we never invent a lead time.</div>';
    }
    el.innerHTML = html;
  }

  // The link itself. expectedDate = today + leadDays. When that lands after
  // the task's own start date we say so plainly (toast + the inline tracker
  // note renderLead adds) - ordering late is exactly what P10 exists to catch.
  function procLeadLink() {
    const it = itemsOf()[_leadIdx];
    const sel = U.$('proc-lead-task');
    if (!it || !sel) {
      return;
    }
    const lead = parseInt(it.leadTimeDays, 10);
    if (!isFinite(lead) || lead <= 0) {
      toast('Set this item\u2019s lead days first - we never guess a lead time.', 'warn');
      return;
    }
    const taskId = String(sel.value || '');
    const today = U.todayStr();
    const expected = U.fmtDate(U.addDays(today, lead));
    let late = false;
    let start = '';
    let taskName = '';
    ns.State.updateState(function (st) {
      const task = ((st && st.tasks) || []).find(function (t) {
        return String(t.id) === taskId;
      });
      if (!task) {
        return;
      }
      task.leadTime = true;
      task.submittedDate = today;
      task.expectedDate = expected;
      start = task.startDate || '';
      taskName = task.name || 'that task';
      // order date + lead time passes the task's start = too late.
      late = !!(start && U.parseDL(expected) > U.parseDL(start));
    });
    closeLead();
    // Refresh every surface that reads lead-time state (same set tglLeadTime
    // drives), so the tracker/lane/bar update without a reload.
    if (ns.Render) {
      ['renderWbs', 'renderGantt', 'renderKanban', 'renderDash'].forEach(function (fn) {
        if (typeof ns.Render[fn] === 'function') {
          ns.Render[fn]();
        }
      });
    }
    if (late) {
      toast(
        'Lead time linked, but it lands ' +
          expected +
          ' - after \u201c' +
          taskName +
          '\u201d starts (' +
          start +
          '). Order earlier.',
        'warn'
      );
    } else {
      toast('Lead time linked. Expected ' + expected + '.', 'ok');
    }
  }

  // ============================================================
  // P3 (directive 2026-10-18, supplier price-list import):
  // CSV or XLSX upload -> column mapping -> dry-run preview -> apply.
  // The merge rule: a row matches an existing item when the supplier,
  // the normalised name and the unit agree - it UPDATES that row's
  // price/terms (and appends to the same P2 history the manual cell
  // uses) instead of creating a duplicate. Anything without a name or
  // a usable price is skipped and NAMED in the preview, never guessed.
  // Ephemeral: _imp is view state, never written to project state.
  // ============================================================
  let _imp = null; // { rows, headers, map, fileName, preview }

  const IMP_FIELDS = [
    {
      key: 'name',
      label: 'Item name',
      words: ['item', 'product', 'description', 'name', 'material']
    },
    { key: 'unit', label: 'Unit', words: ['unit', 'uom', 'u/m'] },
    { key: 'price', label: 'Price', words: ['price', 'rate', 'cost', 'amount'] },
    { key: 'currency', label: 'Currency', words: ['currency', 'curr', 'ccy'] },
    { key: 'leadTimeDays', label: 'Lead days', words: ['lead', 'days', 'delivery', 'eta'] },
    { key: 'minOrder', label: 'Min order', words: ['min order', 'minimum', 'moq', 'min qty'] }
  ];

  function parseCsv(text) {
    const rows = [];
    let row = [],
      field = '',
      q = false;
    text = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            q = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        q = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter(function (r) {
      return r.some(function (c) {
        return String(c).trim() !== '';
      });
    });
  }

  function normName(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function autoMap(headers) {
    const map = {};
    IMP_FIELDS.forEach(function (f) {
      map[f.key] = -1;
    });
    headers.forEach(function (h, i) {
      const hl = normName(h);
      if (!hl) return;
      IMP_FIELDS.forEach(function (f) {
        if (map[f.key] !== -1) return;
        if (
          f.words.some(function (w) {
            return hl.indexOf(w) > -1;
          })
        ) {
          map[f.key] = i;
        }
      });
    });
    return map;
  }

  function buildImportPreview() {
    if (!_imp) return;
    const v = selectedVendor();
    const items = itemsOf();
    const mine = v
      ? items.filter(function (it) {
          return String(it.vendorId) === String(v.id);
        })
      : [];
    const add = [],
      upd = [],
      skip = [];
    _imp.rows.forEach(function (r, ri) {
      const get = function (key) {
        const c = _imp.map[key];
        return c > -1 && c < r.length ? r[c] : '';
      };
      const name = String(get('name') || '').trim();
      const rawPrice = String(get('price') || '').trim();
      const price = Number(rawPrice.replace(/,/g, ''));
      if (!name) {
        skip.push({ row: ri + 1, why: 'no item name', name: name });
        return;
      }
      if (rawPrice === '' || !isFinite(price) || price < 0) {
        skip.push({ row: ri + 1, why: 'no usable price (got "' + rawPrice + '")', name: name });
        return;
      }
      const unit = String(get('unit') || '').trim();
      const match = mine.filter(function (it) {
        return (
          normName(it.name) === normName(name) &&
          (String(it.unit || '').trim() === unit || !unit || !it.unit)
        );
      })[0];
      const rec = {
        row: ri + 1,
        name: name,
        unit: unit,
        price: price,
        currency:
          String(get('currency') || '')
            .trim()
            .toUpperCase()
            .slice(0, 6) || 'JMD',
        leadTimeDays: String(get('leadTimeDays') || '')
          .trim()
          .replace(/[^0-9]/g, '')
          .slice(0, 4),
        minOrder: String(get('minOrder') || '')
          .trim()
          .replace(/[^0-9]/g, '')
          .slice(0, 6),
        existing: match || null
      };
      (match ? upd : add).push(rec);
    });
    _imp.preview = { add: add, upd: upd, skip: skip };
  }

  function renderImport() {
    const el = U.$('proc-imp-body');
    if (!el) return;
    const v = selectedVendor();
    if (!v) {
      el.innerHTML =
        '<div class="proc-empty">Pick a supplier first - a price list belongs to one supplier.</div>';
      return;
    }
    let html =
      '<div class="pc-imp-top">' +
      '<input type="file" id="proc-imp-file" accept=".csv,.txt,.xlsx" aria-label="Price list file (CSV or Excel)" data-action="procImportFile">' +
      '<span class="ct-sub">' +
      (_imp ? 'Loaded: ' + esc(_imp.fileName) : 'Nothing loaded yet. CSV or Excel (.xlsx).') +
      '</span></div>';
    if (_imp) {
      html += '<div class="pc-imp-map">';
      IMP_FIELDS.forEach(function (f) {
        html +=
          '<label class="pc-imp-f">' +
          esc(f.label) +
          '<select data-action="procImportMap" data-key="' +
          f.key +
          '" aria-label="Column for ' +
          esc(f.label) +
          '">' +
          '<option value="-1">(not in this file)</option>' +
          _imp.headers
            .map(function (h, i) {
              return (
                '<option value="' +
                i +
                '"' +
                (_imp.map[f.key] === i ? ' selected' : '') +
                '>' +
                esc(String(h || 'Column ' + (i + 1))) +
                '</option>'
              );
            })
            .join('') +
          '</select></label>';
      });
      html += '</div>';
      const p = _imp.preview;
      html +=
        '<div class="pc-imp-sum">' +
        p.add.length +
        ' new, ' +
        p.upd.length +
        ' will update, ' +
        p.skip.length +
        ' skipped. Nothing is saved until you press Import.</div>';
      const sample = _imp.rows.slice(0, 8);
      html +=
        '<div class="ox"><table class="dt pc-imp-t"><thead><tr><th class="w50">Row</th><th>Item</th><th class="w110">Price</th><th class="w70">Unit</th><th class="w80">Currency</th><th>What happens</th></tr></thead><tbody>';
      sample.forEach(function (r, ri) {
        const rec = _imp.preview.add
          .concat(_imp.preview.upd)
          .concat(_imp.preview.skip)
          .filter(function (x) {
            return x.row === ri + 1;
          })[0];
        const verdict = !rec
          ? 'skipped'
          : rec.why
            ? 'skipped: ' + rec.why
            : rec.existing
              ? 'updates ' + (rec.existing.name || '(item)')
              : 'new item';
        const verdictCls = rec && !rec.why ? (rec.existing ? 'pc-v-upd' : 'pc-v-new') : 'pc-v-skip';
        html +=
          '<tr><td>' +
          (ri + 1) +
          '</td><td>' +
          esc(rec ? rec.name || '-' : String(r[_imp.map.name] || '-')) +
          '</td><td>' +
          esc(
            rec && rec.price !== undefined ? String(rec.price) : String(r[_imp.map.price] || '-')
          ) +
          '</td><td>' +
          esc(rec ? rec.unit || '-' : '-') +
          '</td><td>' +
          esc(rec ? rec.currency || '-' : '-') +
          '</td><td class="' +
          verdictCls +
          '">' +
          esc(verdict) +
          '</td></tr>';
      });
      html += '</tbody></table></div>';
      if (_imp.rows.length > sample.length) {
        html +=
          '<div class="ct-sub">...and ' + (_imp.rows.length - sample.length) + ' more rows.</div>';
      }
      html +=
        '<div class="g6 mt8"><button type="button" class="btn btn-g btn-s" data-action="procImportApply"' +
        (p.add.length + p.upd.length ? '' : ' disabled') +
        '>Import ' +
        (p.add.length + p.upd.length) +
        ' rows</button>' +
        '<button type="button" class="btn btn-d btn-s" data-action="procImportCancel">Cancel</button></div>';
    }
    el.innerHTML = html;
  }

  function procImport() {
    const sec = U.$('proc-import');
    if (!sec) return;
    _imp = null;
    sec.classList.remove('is-hide');
    renderImport();
    const cmp = U.$('proc-compare');
    if (cmp) cmp.classList.add('is-hide');
  }

  function procImportCancel() {
    _imp = null;
    const sec = U.$('proc-import');
    if (sec) sec.classList.add('is-hide');
  }

  function procImportFile(el) {
    const file = el && el.files && el.files[0];
    if (!file) return;
    const v = selectedVendor();
    if (!v) {
      toast('Pick a supplier first - a price list belongs to one supplier.', 'warn');
      return;
    }
    const name = String(file.name || 'price-list');
    const isX = /\.xlsx$/i.test(name);
    if (!isX && !/\.(csv|txt)$/i.test(name)) {
      toast('That file type cannot be read. Use .csv or .xlsx.', 'err');
      return;
    }
    const fr = new FileReader();
    fr.onerror = function () {
      toast('That file could not be read. Try exporting it again.', 'err');
    };
    fr.onload = function () {
      let rows = null;
      try {
        if (isX) {
          if (!ns.XlsxLite || typeof ns.XlsxLite.read !== 'function') {
            throw new Error('The spreadsheet reader is unavailable.');
          }
          rows = ns.XlsxLite.read(new Uint8Array(fr.result))[0].rows;
        } else {
          rows = parseCsv(fr.result);
        }
      } catch (err) {
        toast((err && err.message) || 'That file could not be read.', 'err');
        return;
      }
      rows = (rows || []).filter(function (r) {
        return (
          Array.isArray(r) &&
          r.some(function (c) {
            return String(c == null ? '' : c).trim() !== '';
          })
        );
      });
      if (rows.length < 2) {
        toast('That file has no data rows under its header.', 'err');
        return;
      }
      _imp = {
        headers: rows[0].map(function (c) {
          return String(c == null ? '' : c);
        }),
        rows: rows.slice(1),
        fileName: name
      };
      _imp.map = autoMap(_imp.headers);
      if (_imp.map.name === -1 || _imp.map.price === -1) {
        toast('Pick which columns hold the item name and the price.', 'warn');
      }
      buildImportPreview();
      renderImport();
    };
    if (isX) fr.readAsArrayBuffer(file);
    else fr.readAsText(file);
  }

  function procImportMap() {
    // selects read live; recompute the dry run on every change
    if (!_imp) return;
    document.querySelectorAll('#proc-imp-body select[data-key]').forEach(function (sel) {
      _imp.map[sel.getAttribute('data-key')] = parseInt(sel.value, 10);
    });
    buildImportPreview();
    renderImport();
  }

  function procImportApply() {
    if (!_imp || !_imp.preview) return;
    const v = selectedVendor();
    if (!v) return;
    const p = _imp.preview;
    const fileName = _imp.fileName;
    let added = 0,
      updated = 0;
    ns.State.updateState(function (s) {
      const b = s.supplierBook;
      if (!b || !Array.isArray(b.items)) return;
      const now = new Date().toISOString();
      p.add.forEach(function (rec) {
        const n = b.nitemid > 0 ? b.nitemid : 1;
        b.nitemid = n + 1;
        b.items.push({
          id: 'i' + n,
          vendorId: v.id,
          name: rec.name,
          unit: rec.unit,
          minPrice: String(rec.price),
          currency: rec.currency,
          leadTimeDays: rec.leadTimeDays,
          minOrder: rec.minOrder,
          notes: '',
          quotedAt: now,
          quotedBy: 'import (' + fileName + ')',
          priceHistory: pushPriceHistory(null, {
            price: String(rec.price),
            quotedAt: now,
            quotedBy: 'import (' + fileName + ')',
            qtyBreak: null
          })
        });
        added++;
      });
      p.upd.forEach(function (rec) {
        const it = b.items.filter(function (x) {
          return x === rec.existing;
        })[0];
        if (!it) return;
        const before = it.minPrice;
        it.minPrice = String(rec.price);
        if (rec.unit) it.unit = rec.unit;
        it.currency = rec.currency;
        if (rec.leadTimeDays !== '') it.leadTimeDays = rec.leadTimeDays;
        if (rec.minOrder !== '') it.minOrder = rec.minOrder;
        it.quotedAt = now;
        it.quotedBy = 'import (' + fileName + ')';
        if (String(before) !== String(rec.price)) {
          it.priceHistory = pushPriceHistory(it.priceHistory, {
            price: String(rec.price),
            quotedAt: now,
            quotedBy: 'import (' + fileName + ')',
            qtyBreak: null
          });
        }
        updated++;
      });
    });
    _imp = null;
    render();
    const sec = U.$('proc-import');
    if (sec) sec.classList.add('is-hide');
    toast(
      'Price list imported: ' +
        added +
        ' new, ' +
        updated +
        ' updated' +
        (p.skip.length ? ', ' + p.skip.length + ' skipped.' : '.'),
      'ok'
    );
  }

  // ============================================================
  // P4 (directive 2026-10-18, compare view): the same item name down
  // the rows, suppliers across, cheapest price highlighted, lead time
  // and minimum order under each price, and a per-currency basket of
  // the cheapest choices. Currencies are NEVER converted (C2 rule):
  // a row with mixed currencies highlights nothing and is kept out of
  // the totals, and every total names its own currency.
  // ============================================================
  let _cmpOpen = false;

  function renderCompare() {
    const el = U.$('proc-cmp-body');
    if (!el) return;
    const vendors = vendorsOf();
    const items = itemsOf().filter(priced);
    if (!vendors.length || !items.length) {
      el.innerHTML =
        '<div class="proc-empty">Record a price for at least two suppliers and the same item, then compare.</div>';
      return;
    }
    // Group priced rows by normalised name; per (name, vendor) keep the
    // cheapest qualifying row. P6: each cell also carries the DELIVERED unit
    // price (base + duty + spread freight/handling, qty=1) so the matrix can
    // rank by landed cost. On-costs stay in the item's own currency - never
    // converted (C2 rule).
    const vendorById = {};
    vendorsOf().forEach(function (v) {
      vendorById[String(v.id)] = v;
    });
    const byName = {};
    items.forEach(function (it) {
      const k = normName(it.name);
      if (!k) return;
      byName[k] = byName[k] || { label: it.name || k, cells: {} };
      const cur = String(it.currency || 'JMD').toUpperCase();
      const prev = byName[k].cells[String(it.vendorId)];
      const vend = vendorById[String(it.vendorId)] || null;
      const landed = landedUnitFor(vend, it, 1);
      const lf = landedFor(vend, it, 1);
      if (!prev || Number(it.minPrice) < prev.price) {
        byName[k].cells[String(it.vendorId)] = {
          price: Number(it.minPrice),
          landed: landed,
          onCost: landed !== null ? landed - Number(it.minPrice) : 0,
          landLead: lf.lead,
          currency: cur,
          lead: it.leadTimeDays,
          minOrder: it.minOrder
        };
      }
    });
    const names = Object.keys(byName).sort();
    if (names.length < 1 || vendors.length < 2) {
      el.innerHTML =
        '<div class="proc-empty">Add prices from at least two suppliers (and items they both offer) to compare.</div>';
      return;
    }
    const totals = {}; // currency -> basket sum
    let html =
      '<div class="ox"><table class="dt pcx"><thead><tr><th>Item</th>' +
      vendors
        .map(function (v) {
          return '<th>' + esc(v.name || '(unnamed)') + '</th>';
        })
        .join('') +
      '</tr></thead><tbody>';
    names.forEach(function (k) {
      const row = byName[k];
      // P6: rank by DELIVERED price (landed) where recorded, else base price.
      // On-costs stay in the item's own currency, so this is still a
      // within-one-currency comparison - never a conversion (C2 rule).
      const rankOf = function (c) {
        return c.landed !== null && c.landed !== undefined ? c.landed : c.price;
      };
      const byCur = {};
      vendors.forEach(function (v) {
        const c = row.cells[String(v.id)];
        if (!c) return;
        byCur[c.currency] = Math.min(
          byCur[c.currency] === undefined ? Infinity : byCur[c.currency],
          rankOf(c)
        );
      });
      const curs = Object.keys(byCur);
      const mixed = curs.length > 1;
      const rowMin = mixed ? null : curs.length ? byCur[curs[0]] : null;
      if (!mixed && curs.length) totals[curs[0]] = (totals[curs[0]] || 0) + rowMin;
      // A row only has a WINNER when 2+ suppliers actually carry it -
      // one supplier highlighted as cheapest tells the reader nothing.
      const pricedInRow = vendors.filter(function (v) {
        return row.cells[String(v.id)];
      }).length;
      const canCompare = !mixed && pricedInRow >= 2;
      html +=
        '<tr><td>' +
        esc(row.label) +
        (mixed ? ' <span class="pc-mixed">(mixed currencies)</span>' : '') +
        '</td>';
      vendors.forEach(function (v) {
        const c = row.cells[String(v.id)];
        if (!c) {
          html += '<td class="pc-none">-</td>';
          return;
        }
        const cheap = canCompare && rankOf(c) === rowMin;
        html +=
          '<td class="' +
          (cheap ? 'pc-cheap' : '') +
          '"><span class="pc-price">' +
          esc(c.currency + ' ' + c.price) +
          '</span>' +
          // P6: show the delivered uplift so "cheapest" is honest. Only when
          // there IS an on-cost (freight/handling/duty) to report.
          (c.onCost > 0
            ? '<span class="pc-sub">delivered ' +
              esc(c.currency + ' ' + Math.round(c.landed * 100) / 100) +
              '</span>'
            : '') +
          (c.landLead !== null && c.landLead !== undefined
            ? '<span class="pc-sub">delivery ' + esc(c.landLead) + 'd</span>'
            : '') +
          (c.lead !== '' && c.lead !== undefined && c.lead !== null
            ? '<span class="pc-sub">' + esc(c.lead) + 'd lead</span>'
            : '') +
          (c.minOrder !== '' && c.minOrder !== undefined && c.minOrder !== null
            ? '<span class="pc-sub">min order ' + esc(c.minOrder) + '</span>'
            : '') +
          '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    const tkeys = Object.keys(totals);
    if (tkeys.length) {
      html +=
        '<div class="pc-tot">Cheapest basket (one unit of each item): ' +
        tkeys
          .map(function (cur) {
            return cur + ' ' + Math.round(totals[cur] * 100) / 100;
          })
          .join('   ') +
        (mixedInAnyRow(names, byName) ? '  - rows with mixed currencies are left out.' : '') +
        '</div>';
    }
    el.innerHTML = html;
  }

  function mixedInAnyRow(names, byName) {
    return names.some(function (k) {
      const seen = {};
      vendorsOf().forEach(function (v) {
        const c = byName[k].cells[String(v.id)];
        if (c) seen[c.currency] = 1;
      });
      return Object.keys(seen).length > 1;
    });
  }

  function procCompare() {
    const sec = U.$('proc-compare');
    if (!sec) return;
    _cmpOpen = true;
    sec.classList.remove('is-hide');
    renderCompare();
    const imp = U.$('proc-import');
    if (imp) imp.classList.add('is-hide');
  }

  function procCompareClose() {
    _cmpOpen = false;
    const sec = U.$('proc-compare');
    if (sec) sec.classList.add('is-hide');
  }

  // ============================================================
  // P5 (directive 2026-10-18, quantity break pricing): a per-item tier
  // editor. Tiers live on the item as priceTiers [{minQty, price}]. This
  // panel lists them for ONE item, lets the officer add/remove/edit rows,
  // and previews the unit price the quote will pick for a sample quantity
  // (the same tierPriceFor rule the prompt context and the RFQ use). View
  // state only: _tierIdx is the global item index being edited.
  // ============================================================
  let _tierIdx = -1;

  function openTiers(el) {
    const idx = parseInt(el.getAttribute('data-idx'), 10);
    if (!isFinite(idx) || !itemsOf()[idx]) {
      return;
    }
    _tierIdx = idx;
    const sec = U.$('proc-tiers');
    if (sec) {
      sec.classList.remove('is-hide');
    }
    // One disclosure card at a time (matches import/compare behaviour).
    const imp = U.$('proc-import');
    if (imp) {
      imp.classList.add('is-hide');
    }
    const cmp = U.$('proc-compare');
    if (cmp) {
      cmp.classList.add('is-hide');
    }
    _imp = null;
    _cmpOpen = false;
    renderTiers();
  }

  function closeTiers() {
    _tierIdx = -1;
    const sec = U.$('proc-tiers');
    if (sec) {
      sec.classList.add('is-hide');
    }
  }

  function addTier() {
    const it = itemsOf()[_tierIdx];
    if (!it) {
      return;
    }
    ns.State.updateState(function (s) {
      const b = s.supplierBook;
      const target = b && Array.isArray(b.items) ? b.items[_tierIdx] : null;
      if (!target) {
        return;
      }
      if (!Array.isArray(target.priceTiers)) {
        target.priceTiers = [];
      }
      if (target.priceTiers.length >= TIERS_MAX) {
        return;
      }
      // Seed the next minQty one above the current highest so rows read as a
      // sensible ladder the officer can then tune.
      const highest = target.priceTiers.reduce(function (a, t) {
        return Math.max(a, isFinite(Number(t.minQty)) ? Number(t.minQty) : 0);
      }, 0);
      // Store minQty as a string, matching how minPrice/leadTimeDays/minOrder
      // are stored; tiersOf normalises with Number() at read time.
      target.priceTiers.push({ minQty: String(highest + 1), price: '' });
    });
    renderTiers();
    render();
  }

  function delTier(el) {
    const tidx = parseInt(el.getAttribute('data-tidx'), 10);
    ns.State.updateState(function (s) {
      const b = s.supplierBook;
      const target = b && Array.isArray(b.items) ? b.items[_tierIdx] : null;
      if (target && Array.isArray(target.priceTiers) && isFinite(tidx)) {
        target.priceTiers.splice(tidx, 1);
      }
    });
    renderTiers();
    render();
  }

  function updTier(el, e) {
    const tidx = parseInt(el.getAttribute('data-tidx'), 10);
    const field = el.getAttribute('data-field');
    const raw = String(el.value || '').trim();
    // Validate AT THE SEAM: a half-typed number is simply not written.
    if (field === 'minQty') {
      if (raw !== '' && (!/^\d{0,7}$/.test(raw) || Number(raw) < 0)) {
        return;
      }
    } else if (field === 'price') {
      if (raw !== '') {
        const p = Number(raw.replace(/,/g, ''));
        if (!isFinite(p) || p < 0 || raw.length > 12) {
          return;
        }
      }
    } else {
      return;
    }
    const value = field === 'price' ? raw.replace(/,/g, '') : raw;
    ns.State.updateState(function (s) {
      const b = s.supplierBook;
      const target = b && Array.isArray(b.items) ? b.items[_tierIdx] : null;
      if (target && Array.isArray(target.priceTiers) && target.priceTiers[tidx]) {
        target.priceTiers[tidx][field] = value;
      }
    });
    // Focus discipline: save on keystroke, re-render on commit.
    if (e && e.type === 'input') {
      return;
    }
    renderTiers();
    render();
  }

  function renderTiers() {
    const el = U.$('proc-tier-body');
    if (!el) {
      return;
    }
    const it = itemsOf()[_tierIdx];
    if (!it) {
      el.innerHTML =
        '<div class="proc-empty">Pick an item first, then set its quantity breaks.</div>';
      return;
    }
    const tiers = Array.isArray(it.priceTiers) ? it.priceTiers : [];
    const cur = String(it.currency || 'JMD');
    let html =
      '<div class="ct-sub">' +
      esc(it.name || '(unnamed item)') +
      ' - charge less per unit when they order more. The quote picks the row that matches the quantity.</div>';
    html +=
      '<div class="ox"><table class="dt pcx"><thead><tr><th>Order from (qty)</th><th class="w110">Unit price (' +
      esc(cur) +
      ')</th><th class="w50"></th></tr></thead><tbody>';
    tiers.forEach(function (t, ti) {
      html +=
        '<tr><td><input type="text" inputmode="numeric" value="' +
        esc(t.minQty === 0 ? '0' : t.minQty || '') +
        '" data-action="updTier" data-tidx="' +
        ti +
        '" data-field="minQty" aria-label="Minimum quantity for this price" placeholder="0"></td>' +
        '<td><input type="text" inputmode="decimal" value="' +
        esc(t.price === 0 ? '0' : t.price || '') +
        '" data-action="updTier" data-tidx="' +
        ti +
        '" data-field="price" aria-label="Unit price at this quantity" placeholder="0"></td>' +
        '<td class="w50"><button type="button" class="btn btn-s btn-d" data-action="delTier" data-tidx="' +
        ti +
        '" aria-label="Remove this price break"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg></button></td></tr>';
    });
    if (!tiers.length) {
      html +=
        '<tr><td colspan="3" class="proc-empty">No breaks yet - this item uses its single Min price for every quantity.</td></tr>';
    }
    html += '</tbody></table></div>';
    html +=
      '<div class="g6 mt8"><button type="button" class="btn btn-g btn-s" data-action="addTier"' +
      (tiers.length >= TIERS_MAX ? ' disabled' : '') +
      '>+ Add break</button></div>';
    // Live proof of the picking rule: type a quantity, see the unit price the
    // quote will charge. Falls back to Min price when no tier applies.
    html +=
      '<div class="pc-tier-pick"><label for="proc-tier-qty">Check a quantity: </label>' +
      '<input type="text" inputmode="numeric" id="proc-tier-qty" value="" placeholder="qty" ' +
      'data-action="tierPreview" aria-label="Quantity to price"><span id="proc-tier-pick-out" class="pc-sub"></span></div>';
    el.innerHTML = html;
    updateTierPreview();
  }

  // The preview echoes the SAME rule the prompt uses, so the officer sees
  // exactly what the quote will charge. No rounding games: unit price only.
  function tierPreview() {
    updateTierPreview();
  }
  function updateTierPreview() {
    const out = U.$('proc-tier-pick-out');
    const qEl = U.$('proc-tier-qty');
    if (!out || !qEl) {
      return;
    }
    const it = itemsOf()[_tierIdx];
    const q = Number(String(qEl.value || '').trim());
    if (!it || !isFinite(q) || String(qEl.value || '').trim() === '') {
      out.textContent = '';
      return;
    }
    const p = unitPriceFor(it, q);
    out.textContent =
      p === null
        ? 'no price recorded for this item yet'
        : q + ' x ' + String(it.currency || 'JMD') + ' ' + p + ' each';
  }

  // ============================================================
  // P7 (directive 2026-10-18): Calculator -> RFQ. The Bill of Quantities
  // lives in calculator.html (a different page), so the handoff is a shared
  // same-origin key `mmgr_rfq_draft` written by calcBoqRfq. On render we
  // pick it up, surface an RFQ card, and the quote writer can address these
  // lines to a chosen supplier. The lines carry CANONICAL engine qty/unit
  // (C1) - never a display conversion. View state + one pickup; the draft is
  // cleared only when the officer dismisses it (never silently dropped).
  // ============================================================
  let _rfq = null; // { lines:[{name,qty,unit,currency}], at } or null
  let _rfqLoaded = false;

  function loadRfqDraft() {
    if (_rfqLoaded) {
      return;
    }
    _rfqLoaded = true;
    try {
      const raw = localStorage.getItem('mmgr_rfq_draft');
      if (!raw) {
        return;
      }
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.lines) && d.lines.length) {
        _rfq = { lines: d.lines, at: d.at || '' };
      }
    } catch (e) {
      /* a malformed handoff must never break the tab */
    }
  }

  function getRfq() {
    loadRfqDraft();
    return _rfq;
  }

  function clearRfq() {
    _rfq = null;
    _rfqLoaded = true;
    try {
      localStorage.removeItem('mmgr_rfq_draft');
    } catch (e) {
      /* ignore */
    }
    render();
  }

  function renderRfq() {
    const sec = U.$('proc-rfq');
    if (!sec) {
      return;
    }
    loadRfqDraft();
    if (!_rfq) {
      sec.classList.add('is-hide');
      return;
    }
    const body = U.$('proc-rfq-body');
    if (body) {
      const rows = _rfq.lines
        .map(function (l, i) {
          return (
            '<tr><td>' +
            (i + 1) +
            '</td><td>' +
            esc(l.name || 'Line') +
            '</td><td>' +
            esc(String(l.qty)) +
            '</td><td>' +
            esc(l.unit || '') +
            '</td><td>' +
            esc(l.currency || 'JMD') +
            '</td></tr>'
          );
        })
        .join('');
      body.innerHTML =
        '<div class="ct-sub">' +
        _rfq.lines.length +
        ' line' +
        (_rfq.lines.length === 1 ? '' : 's') +
        ' sent from the Bill of quantities. Quantities are in their canonical engine units.</div>' +
        '<div class="ox"><table class="dt pcx"><thead><tr><th>#</th><th>Item</th>' +
        '<th class="w110">Qty</th><th class="w80">Unit</th><th class="w80">Cur</th>' +
        '</tr></thead><tbody>' +
        rows +
        '</tbody></table></div>';
    }
    sec.classList.remove('is-hide');
  }

  // ---- API ----
  ns.Proc = {
    render: render,
    getQuoteOpts: getQuoteOpts,
    addPvendor: addPvendor,
    delPvendor: delPvendor,
    updPvendor: updPvendor,
    selVendor: selVendor,
    addPitem: addPitem,
    delPitem: delPitem,
    updPitem: updPitem,
    procQuote: procQuote,
    procQuoteVendor: procQuoteVendor,
    procQuoteTone: procQuoteTone,
    procQuoteCopy: procQuoteCopy,
    // P8 RFQ email pack
    procQuoteTerm: procQuoteTerm,
    procQuoteMailto: procQuoteMailto,
    // P9 purchase order PDF (from an awarded quote)
    procPo: procPo,
    syncPoBtn: syncPoBtn,
    poLines: poLines,
    // P10 lead time -> schedule
    procLead: procLead,
    closeLead: closeLead,
    procLeadLink: procLeadLink,
    renderLead: renderLead,
    // P2/P3/P4
    procImport: procImport,
    procImportCancel: procImportCancel,
    procImportFile: procImportFile,
    procImportMap: procImportMap,
    procImportApply: procImportApply,
    procCompare: procCompare,
    procCompareClose: procCompareClose,
    renderCompare: renderCompare,
    // P5 quantity break pricing
    openTiers: openTiers,
    closeTiers: closeTiers,
    addTier: addTier,
    delTier: delTier,
    updTier: updTier,
    tierPreview: tierPreview,
    renderTiers: renderTiers,
    tierPriceFor: tierPriceFor,
    unitPriceFor: unitPriceFor,
    tiersOf: tiersOf,
    // P6 landed cost
    landedFor: landedFor,
    landedUnitFor: landedUnitFor,
    // P7 calculator -> RFQ
    getRfq: getRfq,
    clearRfq: clearRfq,
    renderRfq: renderRfq,
    _impPreview: function () {
      return _imp && _imp.preview ? _imp.preview : null;
    }
  };
})(MMGR);
window.MMGR = MMGR;
