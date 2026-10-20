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
        '<tr><td colspan="10" class="proc-empty">Pick a supplier to see what they offer.</td></tr>';
      if (subtot) {
        subtot.textContent = '';
        subtot.classList.add('is-hide');
      }
      return;
    }
    const idxs = itemIdxFor(v.id);
    if (!idxs.length) {
      body.innerHTML =
        '<tr><td colspan="10" class="proc-empty">No items recorded yet. Add what this supplier offers and their price.</td></tr>';
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
          '<td><input type="text" value="' +
          esc(it.notes || '') +
          '" data-action="updPitem" data-idx="' +
          gi +
          '" data-field="notes" aria-label="Notes" placeholder="-"></td>' +
          '<td class="w50"><button type="button" class="btn btn-s btn-d" data-action="delPitem" data-idx="' +
          gi +
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
  function _quoteVendorSel() {
    const el = U.$('proc-quote-vendor');
    return el ? String(el.value || '') : _quoteVendor;
  }

  function render() {
    renderVendors();
    renderItems();
    renderQuoteOpts();
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
    return {
      vendorId: _quoteVendorSel(),
      tone: tone ? String(tone.value || 'rfq') || 'rfq' : 'rfq'
    };
  }

  function procQuoteVendor(el) {
    _quoteVendor = String(el.value || '');
  }

  function procQuoteTone(el) {
    // ephemeral, never state - getQuoteOpts reads the live select
    void el;
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
    if (res && res.ok && res.text) {
      out.textContent = res.text;
      if (copyBtn) {
        copyBtn.classList.remove('is-hide');
      }
    } else {
      let err = (res && res.error) || 'The quote could not be written. Try again.';
      if (err === 'busy') {
        err = 'The assistant is already writing. Give it a moment.';
      }
      out.textContent = err;
      if (copyBtn) {
        copyBtn.classList.add('is-hide');
      }
    }
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
    // cheapest qualifying row.
    const byName = {};
    items.forEach(function (it) {
      const k = normName(it.name);
      if (!k) return;
      byName[k] = byName[k] || { label: it.name || k, cells: {} };
      const cur = String(it.currency || 'JMD').toUpperCase();
      const prev = byName[k].cells[String(it.vendorId)];
      if (!prev || Number(it.minPrice) < prev.price) {
        byName[k].cells[String(it.vendorId)] = {
          price: Number(it.minPrice),
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
      // cheapest within one currency only
      const byCur = {};
      vendors.forEach(function (v) {
        const c = row.cells[String(v.id)];
        if (!c) return;
        byCur[c.currency] = Math.min(
          byCur[c.currency] === undefined ? Infinity : byCur[c.currency],
          c.price
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
        const cheap = canCompare && c.price === rowMin;
        html +=
          '<td class="' +
          (cheap ? 'pc-cheap' : '') +
          '"><span class="pc-price">' +
          esc(c.currency + ' ' + c.price) +
          '</span>' +
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
    // P2/P3/P4
    procImport: procImport,
    procImportCancel: procImportCancel,
    procImportFile: procImportFile,
    procImportMap: procImportMap,
    procImportApply: procImportApply,
    procCompare: procCompare,
    procCompareClose: procCompareClose,
    renderCompare: renderCompare,
    _impPreview: function () {
      return _imp && _imp.preview ? _imp.preview : null;
    }
  };
})(MMGR);
window.MMGR = MMGR;
