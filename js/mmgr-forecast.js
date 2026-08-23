/* ============================================================
   My MaNaGeR , Weather Forecast & Delay Log (ACTION-PLAN 7)
   Open-Meteo integration, fully client-side.
   ------------------------------------------------------------
   - 7.1  Weekly forecast risk panel (Open-Meteo daily API,
         latitude/longitude or one-time geocode of a place name).
         Responses are cached in localStorage with a short TTL
         (3h) , never re-fetched on every render.
   - 7.2  Risk-day thresholds: precipitation probability >= 60%,
         heat (tMax >= 32C), cold (tMin <= 0C). Days that clear a
         threshold and overlap a weather-sensitive task are fed to
         the Today Decision Engine (via ns.Decisions) and flagged
         in the forecast strip.
   - 7.4  Weather delay daily log: auto-pulled conditions + note +
         affected tasks, dispute-ready export (Copy All path).
   - 7.5  LD / contract exposure: logged weather days x LD rate.
   - Extras: Heat/Cold safety alert (visually distinct), Schedule
         Reliability Index card, manual on-site weather override,
         subcontractor weather notice (manual-trigger first).

   InfinityFree constraints: no websockets, no cron. Everything is
   on-request (forecast fetched on demand, cached); the log is
   localStorage only. When lat/lon is missing the app degrades to
   the region-window model (already present) and shows a setup
   hint instead of failing.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;
  const API = 'https://api.open-meteo.com/v1/forecast';
  const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
  const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
  const RISK_PRECIP = 60;   // precipitation probability threshold %
  const HEAT_C = 32;        // heat alert threshold
  const COLD_C = 0;         // cold alert threshold

  // ---- Geocode a place name ONCE and store lat/lon in state ----
  // Client-side, on-request. Fails quietly (returns false) when offline
  // or unknown , the app keeps using the static regional windows.
  // Phase 2: routed through MMGR.Net (timeout + exponential backoff, max 3).
  async function geocode(place, state) {
    const st = state || ns.State.getState();
    try {
      const url = GEO + '?name=' + encodeURIComponent(place) + '&count=1&language=en&format=json';
      const res = await ns.Net.get(url, { maxRetries: 3 });
      if (!res.ok) return false;
      const data = await res.json();
      const hit = data && data.results && data.results[0];
      if (!hit) return false;
      ns.State.updateState(function(s) {
        s.siteLat = hit.latitude;
        s.siteLon = hit.longitude;
        s.sitePlace = hit.name || place;
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---- Reverse-geocode exact coordinates into a friendly place label ----
  // Used by "Use my current location": the browser hands us raw lat/lon and
  // we turn it into "City, Region" so the forecast header reads as a place
  // instead of a coordinate pair. Open-Meteo's reverse search, same zero-key
  // API family as geocode(). Fails quietly -> '' (caller keeps a plain label).
  async function reverseGeocode(lat, lon) {
    try {
      const url = GEO + '?latitude=' + encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lon) +
        '&count=1&language=en&format=json';
      const res = await ns.Net.get(url, { maxRetries: 2 });
      if (!res.ok) return '';
      const data = await res.json();
      const hit = data && data.results && data.results[0];
      if (!hit) return '';
      const parts = [hit.name, hit.admin1, hit.country].filter(Boolean);
      return parts.join(', ');
    } catch (e) {
      return '';
    }
  }

  // ---- Fetch a 16-day daily forecast (cached, TTL) ----
  // Pure on-request: never called on load; the dashboard triggers it on
  // demand or after geocode. localStorage cache keyed by lat,lon.
  async function fetchForecast(lat, lon) {
    const url = API + '?latitude=' + encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lon) +
      '&daily=weathercode,precipitation_probability_max,temperature_2m_max,temperature_2m_min' +
      '&timezone=auto&forecast_days=16';
    // Phase 2: MMGR.Net handles the timeout + exponential backoff (max 3).
    const res = await ns.Net.get(url, { maxRetries: 3 });
    if (!res.ok) throw new Error('forecast ' + res.status);
    const data = await res.json();
    const days = (data.daily || {}).time ? data.daily.time.map((date, i) => ({
      date: date,
      code: (data.daily.weathercode || [])[i],
      precip: (data.daily.precipitation_probability_max || [])[i] || 0,
      tMax: (data.daily.temperature_2m_max || [])[i],
      tMin: (data.daily.temperature_2m_min || [])[i]
    })) : [];
    ns.State.updateState(function(s) {
      s.wxCache = { at: Date.now(), lat: lat, lon: lon, days: days };
    });
    return days;
  }

  // ---- Cached forecast (or null) ----
  function getForecast(state) {
    const s = state || ns.State.getState();
    const c = s && s.wxCache;
    if (!c || !c.days || !c.days.length) return null;
    if (Date.now() - (c.at || 0) > CACHE_TTL_MS) return null; // expired
    return c.days;
  }

  // ---- Risk days from cached forecast + thresholds ----
  // A day is a RISK day when it clears a threshold AND overlaps at least
  // one weather-sensitive task (or is within the next 7 days, so the crew
  // sees upcoming heat/cold even before task mapping is complete).
  function riskDays(state) {
    const s = state || ns.State.getState();
    const days = getForecast(s);
    if (!days) return [];
    const wxTasks = (s.tasks || []).filter(t => t.weatherSensitive && t.startDate && t.endDate);
    const dayStr = (d) => d.toISOString().slice(0, 10);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return days.map(d => {
      const risky = d.precip >= RISK_PRECIP || d.tMax >= HEAT_C || d.tMin <= COLD_C;
      if (!risky) return null;
      const dateObj = U.parseDL(d.date) || new Date(d.date + 'T00:00:00');
      const within7 = dateObj >= today && dateObj <= new Date(today.getTime() + 7 * 86400000);
      const affected = wxTasks.filter(t => {
        const ts = U.parseDL(t.startDate), te = U.parseDL(t.endDate);
        if (!ts || !te) return false;
        return dateObj >= ts && dateObj <= te;
      });
      if (!within7 && !affected.length) return null;
      const alerts = [];
      if (d.precip >= RISK_PRECIP) alerts.push('precip ' + d.precip + '%');
      if (d.tMax >= HEAT_C) alerts.push('heat ' + d.tMax + 'C');
      if (d.tMin <= COLD_C) alerts.push('cold ' + d.tMin + 'C');
      return { date: d.date, code: d.code, precip: d.precip, tMax: d.tMax, tMin: d.tMin, alerts: alerts, affected: affected.map(t => t.name) };
    }).filter(Boolean);
  }

  // ---- Heat/Cold safety alert (visually distinct) ----
  function heatColdAlert(state) {
    const days = riskDays(state);
    const heat = days.filter(d => d.alerts.indexOf('heat ' + d.tMax + 'C') > -1)[0];
    const cold = days.filter(d => d.alerts.some(a => a.indexOf('cold') === 0))[0];
    if (heat) return { kind: 'heat', text: 'Heat alert: ' + heat.tMax + 'C on ' + heat.date + ' , schedule outdoor work for early hours.' };
    if (cold) return { kind: 'cold', text: 'Cold alert: ' + cold.tMin + 'C on ' + cold.date + ' , concrete/water work at freeze risk.' };
    return null;
  }

  // ---- 7.4 Weather delay log ----
  // Auto-pulls today's cached conditions; manual override when no forecast
  // exists (on-site reality beats an expired cache). Stores into
  // state.weatherLog (client-side only , simulated backend).
  function logWeatherDay(state, opts) {
    const s = state || ns.State.getState();
    const o = opts || {};
    const today = U.todayStr();
    const days = getForecast(s);
    const todayFc = days ? days.find(d => d.date === today) : null;
    const entry = {
      date: o.date || today,
      condition: o.condition || (todayFc ? 'precip ' + todayFc.precip + '% / ' + todayFc.tMax + 'C' : 'manual entry'),
      note: o.note || '',
      affectedTaskIds: o.affectedTaskIds || [],
      manual: !!o.manual
    };
    ns.State.updateState(function(st) {
      if (!st.weatherLog) st.weatherLog = [];
      st.weatherLog.push(entry);
    });
    return entry;
  }

  function delWeatherLogEntry(index) {
    ns.State.updateState(function(s) {
      if (s.weatherLog && s.weatherLog[index]) s.weatherLog.splice(index, 1);
    });
  }

  // ---- 7.5 LD / contract exposure ----
  // Logged weather delay days x per-day LD rate from the charter/state.
  // Pure read; only counts days, never double-counts a logged day.
  function ldExposure(state) {
    const s = state || ns.State.getState();
    const rate = +((s && (s.ldRate !== undefined ? s.ldRate : (s.charter && s.charter.ldRate))) || 0);
    const days = (s && s.weatherLog) ? s.weatherLog.length : 0;
    return { days: days, rate: rate, exposure: days * rate };
  }

  // ---- Schedule Reliability Index (SRI) ----
  // Scheduled project days that were NOT lost to weather, as a fraction.
  // Pure read: weatherLog days / elapsed scheduled days (bounded 0-100).
  function sri(state) {
    const s = state || ns.State.getState();
    const tasks = (s && s.tasks) || [];
    const dated = tasks.filter(t => t.startDate && t.endDate);
    if (!dated.length) return null;
    const minStart = new Date(Math.min.apply(null, dated.map(t => new Date(t.startDate).getTime())));
    const maxEnd = new Date(Math.max.apply(null, dated.map(t => new Date(t.endDate).getTime())));
    const elapsed = Math.max(1, Math.round((maxEnd - minStart) / 86400000) + 1);
    const wxDays = ((s && s.weatherLog) || []).length;
    const idx = Math.max(0, Math.round((1 - wxDays / elapsed) * 100));
    return { index: Math.min(100, idx), wxDays: wxDays, elapsed: elapsed };
  }

  // ---- Subcontractor notice (manual-trigger first) ----
  // Copy-paste text: next 3 risk days + affected weather-sensitive tasks.
  function subcontractorNotice(state) {
    const s = state || ns.State.getState();
    const days = riskDays(s).filter(d => U.parseDL(d.date) >= new Date()).slice(0, 3);
    const proj = (s && (s.projectName || (s.charter && s.charter.name))) || 'Project';
    if (!days.length) return 'No weather risk days in the current forecast for ' + proj + '.';
    const lines = ['SUBCONTRACTOR WEATHER NOTICE , ' + proj, '='.repeat(40)];
    days.forEach(d => {
      lines.push(d.date + ' , ' + d.alerts.join(', ') + (d.affected.length ? ' | Affects: ' + d.affected.join(', ') : ' | No weather-sensitive tasks mapped'));
    });
    lines.push('Prepared by My MaNaGeR. Confirm with the site foreman before acting.');
    return lines.join('\n');
  }

  // ---- API ----
  ns.Forecast = {
    API: API,
    GEO: GEO,
    CACHE_TTL_MS: CACHE_TTL_MS,
    geocode: geocode,
    reverseGeocode: reverseGeocode,
    fetchForecast: fetchForecast,
    getForecast: getForecast,
    riskDays: riskDays,
    heatColdAlert: heatColdAlert,
    logWeatherDay: logWeatherDay,
    delWeatherLogEntry: delWeatherLogEntry,
    ldExposure: ldExposure,
    sri: sri,
    subcontractorNotice: subcontractorNotice,
    RISK_PRECIP: RISK_PRECIP,
    HEAT_C: HEAT_C,
    COLD_C: COLD_C
  };
})(MMGR);
window.MMGR = MMGR;
