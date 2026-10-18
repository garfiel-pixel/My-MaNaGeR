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
        '<tr><td colspan="9" class="proc-empty">Pick a supplier to see what they offer.</td></tr>';
      if (subtot) {
        subtot.textContent = '';
        subtot.classList.add('is-hide');
      }
      return;
    }
    const idxs = itemIdxFor(v.id);
    if (!idxs.length) {
      body.innerHTML =
        '<tr><td colspan="9" class="proc-empty">No items recorded yet. Add what this supplier offers and their price.</td></tr>';
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
          '<td class="proc-qd">' +
          esc(qd) +
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
        notes: '',
        quotedAt: '',
        quotedBy: ''
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
    procQuoteCopy: procQuoteCopy
  };
})(MMGR);
window.MMGR = MMGR;
