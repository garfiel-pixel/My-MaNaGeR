var MMGR = window.MMGR || {};
/* ============================================================
   ScrubNumber and SmartTime (2026-11-19)
   ------------------------------------------------------------
   Progressive enhancement layer for numeric, clock and date
   entry. Nothing here changes an application value until a real
   `change` event is dispatched on pointerup / Enter / blur, so
   the existing updField / updTaskField delegation stays the one
   write path and a full panel re-render happens exactly once.

   Opt in with data attributes:
     data-scrub="hours|duration|qty|rate|percent"
     data-scrub-step / -fine / -min / -max / -unit / -presets
     data-smart-time="clock|elapsed"  data-time-pair="#id"
     data-smart-date
   ============================================================ */
(function (ns) {
  'use strict';

  var DEAD_ZONE = 5;
  var PX_PER_STEP = 12;
  var LIVE_MS = 400;

  var PROFILES = {
    hours: { step: 0.25, fine: 0.05, min: 0, max: 24, unit: 'h', presets: '4,8,+0.5,clear' },
    duration: { step: 0.5, fine: 0.1, min: 0, max: 365, unit: 'd', presets: '0.5,1,3,5,10' },
    qty: { step: 1, fine: 0.1, min: 0, unit: '', presets: '+10%,-10%,round' },
    rate: { step: 1, fine: 0.1, min: 0, unit: '', presets: '+10%,-10%,round' },
    percent: { step: 1, fine: 0.1, min: 0, max: 100, unit: '%', presets: '10,15,25,clear' }
  };

  var state = null;
  var live = null;
  var lastAnnounce = 0;
  var announceTimer = null;
  var pendingAnnounce = '';
  var popover = null;
  var started = false;

  function num(v, fallback) {
    var n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }

  function decimals(step) {
    var s = String(step);
    var i = s.indexOf('.');
    return i < 0 ? 0 : s.length - i - 1;
  }

  function round(value, dp) {
    var f = Math.pow(10, dp);
    return Math.round(value * f) / f;
  }

  function clamp(value, min, max) {
    var v = value;
    if (min !== null && v < min) {
      v = min;
    }
    if (max !== null && v > max) {
      v = max;
    }
    return v;
  }

  function cfgFor(el) {
    var kind = el.getAttribute('data-scrub') || 'qty';
    var base = PROFILES[kind] || PROFILES.qty;
    return {
      kind: kind,
      step: num(el.getAttribute('data-scrub-step'), base.step),
      fine: num(el.getAttribute('data-scrub-fine'), base.fine),
      min: el.hasAttribute('data-scrub-min')
        ? num(el.getAttribute('data-scrub-min'), null)
        : base.min,
      max: el.hasAttribute('data-scrub-max')
        ? num(el.getAttribute('data-scrub-max'), null)
        : base.max,
      unit: el.getAttribute('data-scrub-unit') || base.unit,
      presets: el.getAttribute('data-scrub-presets') || base.presets,
      dp: decimals(el.getAttribute('data-scrub-step') || String(base.step))
    };
  }

  function readValue(el) {
    var v = el.tagName === 'INPUT' ? el.value : el.getAttribute('data-value') || el.textContent;
    return num(String(v).replace(/[^0-9.+-]/g, ''), 0);
  }

  function writeValue(el, value, cfg) {
    var text = String(round(value, cfg.dp));
    if (el.tagName === 'INPUT') {
      el.value = text;
    } else {
      el.setAttribute('data-value', text);
      el.textContent = cfg.unit ? text + cfg.unit : text;
    }
    el.setAttribute('aria-valuenow', text);
    el.setAttribute('aria-valuetext', text + (cfg.unit ? ' ' + cfg.unit : ''));
  }

  function emit(el, type, extra) {
    var ev = new CustomEvent(type, { bubbles: true, cancelable: false, detail: extra || {} });
    el.dispatchEvent(ev);
  }

  function announce(text, force) {
    if (!live) {
      return;
    }
    var now = Date.now();
    if (!force && now - lastAnnounce < LIVE_MS) {
      pendingAnnounce = text;
      if (!announceTimer) {
        announceTimer = setTimeout(
          function () {
            announceTimer = null;
            if (pendingAnnounce) {
              live.textContent = pendingAnnounce;
              pendingAnnounce = '';
              lastAnnounce = Date.now();
            }
          },
          LIVE_MS - (now - lastAnnounce)
        );
      }
      return;
    }
    if (announceTimer) {
      clearTimeout(announceTimer);
      announceTimer = null;
    }
    live.textContent = text;
    lastAnnounce = now;
  }

  function ensureLive() {
    if (live && document.body.contains(live)) {
      return;
    }
    live = document.getElementById('scrub-live-region');
    if (!live) {
      live = document.createElement('div');
      live.id = 'scrub-live-region';
      live.className = 'scrub-live';
      live.setAttribute('aria-live', 'polite');
      live.setAttribute('aria-atomic', 'true');
      document.body.appendChild(live);
    }
  }

  function ensureA11y(el, cfg) {
    if (el.tagName !== 'INPUT') {
      if (!el.hasAttribute('role')) {
        el.setAttribute('role', 'spinbutton');
      }
      if (!el.hasAttribute('tabindex')) {
        el.setAttribute('tabindex', '0');
      }
    }
    if (!el.hasAttribute('aria-valuemin') && cfg.min !== null) {
      el.setAttribute('aria-valuemin', String(cfg.min));
    }
    if (!el.hasAttribute('aria-valuemax') && cfg.max !== null) {
      el.setAttribute('aria-valuemax', String(cfg.max));
    }
    el.setAttribute('aria-valuenow', String(readValue(el)));
  }

  /* ---- Preset popover: one instance, body portal, viewport clamped ---- */
  function closePopover() {
    if (!popover) {
      return;
    }
    var el = popover;
    popover = null;
    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }

  function popoverFor(anchor, chips, onPick) {
    closePopover();
    var box = document.createElement('div');
    box.className = 'scrub-pop';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Quick values');
    chips.forEach(function (chip) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'scrub-chip' + (chip.live ? ' is-live' : '');
      b.textContent = chip.label;
      b.setAttribute('data-scrub-chip', chip.value);
      b.addEventListener('click', function (ev) {
        ev.preventDefault();
        onPick(chip.value);
        closePopover();
        anchor.focus();
      });
      box.appendChild(b);
    });
    document.body.appendChild(box);
    popover = box;
    var r = anchor.getBoundingClientRect();
    var w = box.offsetWidth;
    var left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - w - 8));
    var top = r.bottom + 6;
    if (top + box.offsetHeight > window.innerHeight - 8) {
      top = Math.max(8, r.top - box.offsetHeight - 6);
    }
    box.style.left = left + 'px';
    box.style.top = top + 'px';
  }

  function chipsFor(cfg) {
    return String(cfg.presets || '')
      .split(',')
      .map(function (raw) {
        var t = String(raw).trim();
        if (!t) {
          return null;
        }
        var liveChip = t === 'now' || t === 'today';
        var label = t === 'clear' ? 'Clear' : t;
        if (cfg.unit && /^[0-9.+-]+$/.test(t)) {
          label = t + cfg.unit;
        }
        return { value: t, label: label, live: liveChip };
      })
      .filter(Boolean);
  }

  /* ---- Scrub engine ---- */
  function beginScrub(el, ev) {
    var cfg = cfgFor(el);
    var initial = readValue(el);
    state = {
      el: el,
      cfg: cfg,
      initial: initial,
      current: initial,
      x0: ev.clientX,
      y0: ev.clientY,
      lastX: ev.clientX,
      lastT: Date.now(),
      active: false,
      changed: false,
      pointerId: ev.pointerId,
      keys: ''
    };
    ensureA11y(el, cfg);
    try {
      el.setPointerCapture(ev.pointerId);
    } catch (_) {}
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
  }

  function clearScrubListeners() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
  }

  function onMove(ev) {
    if (!state) {
      return;
    }
    if (ev.pointerId !== state.pointerId) {
      return;
    }
    var dx = ev.clientX - state.x0;
    var dy = ev.clientY - state.y0;

    if (!state.active) {
      if (Math.abs(dx) < DEAD_ZONE || Math.abs(dy) > Math.abs(dx)) {
        return;
      }
      state.active = true;
      state.el.classList.add('is-scrubbing');
      document.body.classList.add('is-scrubbing');
      closePopover();
    }
    ev.preventDefault();

    var now = Date.now();
    var dt = Math.max(1, now - state.lastT);
    var velocity = Math.abs(ev.clientX - state.lastX) / dt;
    state.lastX = ev.clientX;
    state.lastT = now;
    state.keys = (ev.shiftKey ? 'shift' : '') + (ev.altKey ? 'alt' : '');

    var accel = 1 + Math.min(velocity * 1.5, 3);
    var factor = state.keys === 'alt' ? 5 : state.keys === 'shift' ? 0.1 : 1;
    var step = state.keys === 'shift' ? state.cfg.fine : state.cfg.step;
    var steps = Math.round((dx / PX_PER_STEP) * accel * factor);
    var next = round(state.initial + steps * step, state.cfg.dp);
    next = clamp(next, state.cfg.min, state.cfg.max);
    if (next === state.current) {
      return;
    }
    state.current = next;
    state.changed = true;
    writeValue(state.el, next, state.cfg);
    emit(state.el, 'input', { scrubbing: true });
    announce(String(next) + (state.cfg.unit ? ' ' + state.cfg.unit : ''));
  }

  function finishScrub(commit) {
    if (!state) {
      return;
    }
    var s = state;
    state = null;
    clearScrubListeners();
    try {
      s.el.releasePointerCapture(s.pointerId);
    } catch (_) {}
    s.el.classList.remove('is-scrubbing');
    document.body.classList.remove('is-scrubbing');
    if (commit && s.active && s.changed) {
      writeValue(s.el, s.current, s.cfg);
      emit(s.el, 'change', { scrubbed: true });
      announce(String(s.current) + (s.cfg.unit ? ' ' + s.cfg.unit : ''), true);
    } else if (s.active) {
      writeValue(s.el, s.initial, s.cfg);
    }
  }

  function onUp(ev) {
    if (state && ev.pointerId !== state.pointerId) {
      return;
    }
    finishScrub(true);
  }

  function onCancel() {
    finishScrub(false);
  }

  function onKey(ev) {
    if (!state || !state.active) {
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      finishScrub(false);
    }
  }

  function applyPreset(el, raw) {
    var cfg = cfgFor(el);
    var t = String(raw).trim();
    var v = readValue(el);
    if (t === 'clear') {
      v = 0;
    } else if (t === 'round') {
      v = Math.round(v);
    } else if (/^[+-]?[0-9.]+%$/.test(t)) {
      var p = num(t.replace('%', ''), 0) / 100;
      v = round(v + v * p, cfg.dp);
    } else if (/^[+-]/.test(t)) {
      v = round(v + num(t, 0), cfg.dp);
    } else {
      v = num(t, v);
    }
    v = clamp(v, cfg.min, cfg.max);
    writeValue(el, v, cfg);
    announce(String(v) + (cfg.unit ? ' ' + cfg.unit : ''), true);
    emit(el, 'change', { preset: true });
  }

  /* ---- Clock helpers ---- */
  function todayISO(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + (offsetDays || 0));
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function endOfWeekISO() {
    var d = new Date();
    var delta = (5 - d.getDay() + 7) % 7;
    return todayISO(delta);
  }

  function parseClock(raw) {
    var s = String(raw || '').trim();
    var m = s.match(/^(\d{1,2})[:\s]?(\d{2})$/);
    if (!m) {
      return null;
    }
    var h = parseInt(m[1], 10);
    var min = parseInt(m[2], 10);
    if (h > 23 || min > 59) {
      return null;
    }
    return h * 60 + min;
  }

  function formatClock(mins) {
    var v = ((mins % 1440) + 1440) % 1440;
    return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
  }

  function writeClock(el, mins, announceIt) {
    var text = formatClock(mins);
    el.value = text;
    el.setAttribute('aria-valuenow', text);
    el.setAttribute('aria-valuetext', text);
    if (announceIt) {
      announce(text + ' hours and minutes', true);
    }
  }

  function readElapsed(el) {
    var h = num(el.getAttribute('data-value'), 0);
    return Math.round(h * 60);
  }

  function writeElapsed(el, mins) {
    var v = ((mins % 1440) + 1440) % 1440;
    var h = Math.floor(v / 60);
    var m = v % 60;
    el.setAttribute('data-value', String(round(v / 60, 2)));
    if (el.tagName === 'INPUT') {
      el.value = String(round(v / 60, 2));
    } else {
      el.textContent = (h ? h + 'h ' : '') + m + 'm';
    }
    el.setAttribute('aria-valuenow', String(round(v / 60, 2)));
    el.setAttribute('aria-valuetext', h + ' hours and ' + m + ' minutes');
    announce(h + ' hours and ' + m + ' minutes');
  }

  function beginTimeScrub(el, ev) {
    var elapsedMode = el.getAttribute('data-smart-time') === 'elapsed';
    var initial = elapsedMode ? readElapsed(el) : parseClock(el.value);
    if (initial === null) {
      initial = 480;
    }
    state = {
      el: el,
      time: true,
      elapsed: elapsedMode,
      initial: initial,
      current: initial,
      x0: ev.clientX,
      y0: ev.clientY,
      lastX: ev.clientX,
      lastT: Date.now(),
      active: false,
      changed: false,
      pointerId: ev.pointerId,
      keys: ''
    };
    try {
      el.setPointerCapture(ev.pointerId);
    } catch (_) {}
    window.addEventListener('pointermove', onTimeMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
  }

  function onTimeMove(ev) {
    if (!state || !state.time || ev.pointerId !== state.pointerId) {
      return;
    }
    var dx = ev.clientX - state.x0;
    var dy = ev.clientY - state.y0;
    if (!state.active) {
      if (Math.abs(dx) < DEAD_ZONE || Math.abs(dy) > Math.abs(dx)) {
        return;
      }
      state.active = true;
      state.el.classList.add('is-scrubbing');
      document.body.classList.add('is-scrubbing');
      closePopover();
    }
    ev.preventDefault();
    var now = Date.now();
    var dt = Math.max(1, now - state.lastT);
    var velocity = Math.abs(ev.clientX - state.lastX) / dt;
    state.lastX = ev.clientX;
    state.lastT = now;
    state.keys = (ev.shiftKey ? 'shift' : '') + (ev.altKey ? 'alt' : '');
    var step = state.keys === 'shift' ? 5 : state.keys === 'alt' ? 60 : 15;
    var accel = 1 + Math.min(velocity * 1.5, 3);
    var next = state.initial + Math.round((dx / PX_PER_STEP) * accel) * step;
    next = ((next % 1440) + 1440) % 1440;
    if (next === state.current) {
      return;
    }
    state.current = next;
    state.changed = true;
    if (state.elapsed) {
      writeElapsed(state.el, next);
    } else {
      writeClock(state.el, next, false);
    }
    emit(state.el, 'input', { scrubbing: true });
    if (!state.elapsed) {
      announce(formatClock(next));
    }
  }

  function shiftPaired(el, before, after) {
    var sel = el.getAttribute('data-time-pair');
    if (!sel) {
      return;
    }
    var other = document.querySelector(sel);
    if (!other || other === el) {
      return;
    }
    var b = parseClock(before);
    var a = parseClock(after);
    var o = parseClock(other.value);
    if (b === null || a === null || o === null) {
      return;
    }
    var next = (((o + (a - b)) % 1440) + 1440) % 1440;
    writeClock(other, next, false);
    emit(other, 'change', { timePair: true });
  }

  function finishTime(commit) {
    if (!state || !state.time) {
      return;
    }
    var s = state;
    state = null;
    clearScrubListeners();
    try {
      s.el.releasePointerCapture(s.pointerId);
    } catch (_) {}
    s.el.classList.remove('is-scrubbing');
    document.body.classList.remove('is-scrubbing');
    if (commit && s.active && s.changed) {
      if (s.elapsed) {
        writeElapsed(s.el, s.current);
        announce(String(round(s.current / 60, 2)) + ' hours', true);
      } else {
        writeClock(s.el, s.current, true);
        shiftPaired(s.el, formatClock(s.initial), formatClock(s.current));
      }
      emit(s.el, 'change', { scrubbed: true });
    } else if (s.active) {
      if (s.elapsed) {
        writeElapsed(s.el, s.initial);
      } else {
        writeClock(s.el, s.initial, false);
      }
    }
  }

  var origUp = onUp;
  onUp = function (ev) {
    if (state && state.time) {
      if (ev.pointerId !== state.pointerId) {
        return;
      }
      finishTime(true);
      return;
    }
    origUp(ev);
  };
  var origCancel = onCancel;
  onCancel = function () {
    if (state && state.time) {
      finishTime(false);
      return;
    }
    origCancel();
  };

  function applyTimePreset(el, raw) {
    var t = String(raw).trim();
    var elapsedMode = el.getAttribute('data-smart-time') === 'elapsed';
    var cur = elapsedMode ? readElapsed(el) : parseClock(el.value);
    if (cur === null) {
      cur = 480;
    }
    var next = cur;
    if (t === 'now') {
      var d = new Date();
      next = d.getHours() * 60 + d.getMinutes();
      next = Math.round(next / 15) * 15;
    } else if (/^:[0-9]{2}$/.test(t)) {
      var mm = parseInt(t.slice(1), 10);
      next = Math.floor(cur / 60) * 60 + mm;
    } else {
      var parsed = parseClock(t);
      if (parsed !== null) {
        next = parsed;
      }
    }
    var before = formatClock(cur);
    if (elapsedMode) {
      writeElapsed(el, next);
      announce(String(round(next / 60, 2)) + ' hours', true);
    } else {
      writeClock(el, next, true);
      shiftPaired(el, before, formatClock(next));
    }
    emit(el, 'change', { preset: true });
  }

  function timeChips() {
    return [
      { value: 'now', label: 'Now', live: true },
      { value: ':00', label: ':00' },
      { value: ':15', label: ':15' },
      { value: ':30', label: ':30' },
      { value: ':45', label: ':45' },
      { value: '08:00', label: '08:00' },
      { value: '12:00', label: '12:00' },
      { value: '17:00', label: '17:00' }
    ];
  }

  function dateChips() {
    return [
      { value: 'today', label: 'Today', live: true },
      { value: 'tomorrow', label: 'Tomorrow' },
      { value: '+3d', label: '+3d' },
      { value: '+1w', label: '+1w' },
      { value: 'eow', label: 'EOW' },
      { value: '-1d', label: 'Back 1d' },
      { value: '+1d', label: 'Next 1d' }
    ];
  }

  function applyDatePreset(el, raw) {
    var t = String(raw).trim();
    var next = todayISO(0);
    var cur = el.value;
    if (t === 'today') {
      next = todayISO(0);
    } else if (t === 'tomorrow') {
      next = todayISO(1);
    } else if (t === 'eow') {
      next = endOfWeekISO();
    } else if (t === '-1d' || t === '+1d' || t === '+3d' || t === '+1w') {
      var base = cur ? new Date(cur + 'T12:00:00') : new Date();
      var d = t === '-1d' ? -1 : t === '+1d' ? 1 : t === '+3d' ? 3 : 7;
      base.setDate(base.getDate() + d);
      next = todayISO(0);
      next =
        base.getFullYear() +
        '-' +
        String(base.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(base.getDate()).padStart(2, '0');
    }
    el.value = next;
    announce(next, true);
    emit(el, 'change', { preset: true });
  }

  /* ---- Delegated events ---- */
  function onPointerDown(ev) {
    if (ev.button !== 0 && ev.pointerType === 'mouse') {
      return;
    }
    var el = ev.target.closest
      ? ev.target.closest('[data-scrub],[data-smart-time],[data-smart-date]')
      : null;
    if (!el) {
      return;
    }
    if (ns.Perf && typeof ns.Perf.isPerf === 'function' && ns.Perf.isPerf()) {
      return;
    }
    if (el.hasAttribute('data-smart-time')) {
      beginTimeScrub(el, ev);
      return;
    }
    if (el.hasAttribute('data-scrub')) {
      beginScrub(el, ev);
    }
  }

  function onFocusIn(ev) {
    var el = ev.target;
    if (!el || !el.hasAttribute) {
      return;
    }
    if (el.hasAttribute('data-smart-date')) {
      popoverFor(el, dateChips(), function (v) {
        applyDatePreset(el, v);
      });
      return;
    }
    if (el.hasAttribute('data-smart-time')) {
      popoverFor(el, timeChips(), function (v) {
        applyTimePreset(el, v);
      });
      return;
    }
    if (el.hasAttribute('data-scrub')) {
      var presets = cfgFor(el).presets;
      if (!presets) {
        return;
      }
      popoverFor(el, chipsFor(cfgFor(el)), function (v) {
        applyPreset(el, v);
      });
    }
  }

  function onBlurOut(ev) {
    if (!ev.target || !ev.target.hasAttribute) {
      return;
    }
    if (ev.target.getAttribute('data-smart-time') !== 'clock') {
      return;
    }
    var p = parseClock(ev.target.value);
    if (p !== null) {
      writeClock(ev.target, p, false);
    }
  }

  function applyExtreme(el, isTime, toMin) {
    if (isTime) {
      var mins = toMin ? 0 : 1439;
      if (el.getAttribute('data-smart-time') === 'elapsed') {
        writeElapsed(el, mins);
      } else {
        writeClock(el, mins, true);
      }
    } else {
      var cfg = cfgFor(el);
      var v = toMin ? cfg.min : cfg.max;
      writeValue(el, v === null ? readValue(el) : v, cfg);
    }
    emit(el, 'change', { keyboard: true });
  }

  function onKeyDown(ev) {
    var el = ev.target;
    if (!el || !el.hasAttribute) {
      return;
    }
    var isTime = el.hasAttribute('data-smart-time');
    var isScrub = el.hasAttribute('data-scrub');
    if (!isTime && !isScrub) {
      return;
    }
    if (ev.key === 'Escape') {
      closePopover();
      return;
    }
    var step = 0;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') {
      step = 1;
    } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') {
      step = -1;
    } else if (ev.key === 'PageUp') {
      step = 10;
    } else if (ev.key === 'PageDown') {
      step = -10;
    } else if (ev.key === 'Home') {
      step = 0;
      ev.preventDefault();
      applyExtreme(el, isTime, true);
      return;
    } else if (ev.key === 'End') {
      step = 0;
      ev.preventDefault();
      applyExtreme(el, isTime, false);
      return;
    } else {
      return;
    }
    ev.preventDefault();
    if (isTime) {
      var elapsedMode = el.getAttribute('data-smart-time') === 'elapsed';
      var cur = elapsedMode ? readElapsed(el) : parseClock(el.value);
      if (cur === null) {
        cur = 480;
      }
      var unit = ev.shiftKey ? 5 : ev.altKey ? 60 : 15;
      var nxt = cur + step * unit;
      if (elapsedMode) {
        writeElapsed(el, nxt);
      } else {
        writeClock(el, nxt, true);
      }
      emit(el, 'change', { keyboard: true });
    } else {
      var cfg = cfgFor(el);
      var v = readValue(el) + step * (ev.shiftKey ? cfg.fine : cfg.step) * (ev.altKey ? 5 : 1);
      writeValue(el, clamp(v, cfg.min, cfg.max), cfg);
      emit(el, 'change', { keyboard: true });
    }
  }

  function onGlobalKey(ev) {
    if (ev.key === 'Tab' || ev.key === 'Escape') {
      closePopover();
    }
  }

  function onDocPointer(ev) {
    if (popover && !popover.contains(ev.target)) {
      closePopover();
    }
  }

  function start() {
    if (started) {
      return;
    }
    started = true;
    ensureLive();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onBlurOut);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keydown', onGlobalKey, true);
    document.addEventListener('pointerdown', onDocPointer);
  }

  ns.Scrub = {
    start: start,
    profiles: PROFILES,
    formatClock: formatClock,
    parseClock: parseClock,
    _test: {
      round: round,
      clamp: clamp,
      todayISO: todayISO,
      endOfWeekISO: endOfWeekISO
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(MMGR);
