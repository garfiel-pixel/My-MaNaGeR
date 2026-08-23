/* ============================================================
   My MaNaGeR — Weather Actions
   Geocoding, forecast refresh, location, logging, region.
   Extracted from mmgr-app.js.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const S = () => ns.State.getState();
  const U = ns.Utils;
  const $ = U.$;

  // showToast + Render refs resolved at call time (they live in mmgr-app.js
  // and mmgr-render.js which load first).
  function _toast(msg, type) { if (ns.App && ns.App.showToast) ns.App.showToast(msg, type); }
  function _R() { return ns.Render; }

  async function wxGeocode() {
    const place = ($('wx-place-in') || {}).value || '';
    if (!place.trim()) { _toast('Enter a site city first.', 'err'); return; }
    const ok = await ns.Forecast.geocode(place.trim());
    if (ok) { _toast('Site located — refresh for the forecast.', 'ok'); _R().renderAll(); }
    else { _toast('Could not find that location — check the city name.', 'err'); }
  }

  async function wxRefresh() {
    const s = S();
    if (s.siteLat === null || s.siteLon === null) { _toast('Locate the site city first.', 'err'); return; }
    try {
      await ns.Forecast.fetchForecast(s.siteLat, s.siteLon);
      _toast('Forecast refreshed.', 'ok');
    } catch (e) {
      _toast('Forecast unavailable (offline?). Using cached or regional windows.', 'err');
    }
    _R().renderAll();
  }

  async function wxUseLocation() {
    if (!navigator.geolocation) {
      _toast('Location lookup is unavailable in this browser — type your site city instead.', 'err');
      return;
    }
    _toast('Locating you…', 'ok');
    let pos;
    try {
      pos = await new Promise(function(res, rej) {
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 });
      });
    } catch (e) {
      _toast('Could not get your location (permission or coverage) — type your site city instead.', 'err');
      return;
    }
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    ns.State.updateState(function(s) {
      s.siteLat = lat;
      s.siteLon = lon;
      s.sitePlace = '';
    });
    let place = '';
    try { place = (await ns.Forecast.reverseGeocode(lat, lon)) || ''; } catch (e) { place = ''; }
    if (!place) place = lat.toFixed(2) + ', ' + lon.toFixed(2);
    ns.State.updateState(function(s) { s.sitePlace = place; });
    try {
      await ns.Forecast.fetchForecast(lat, lon);
      _toast('Forecast set for your current location' + (place ? ' — ' + place : '') + '.', 'ok');
    } catch (e) {
      _toast('Location saved, but the forecast could not be fetched (offline?) — regional windows remain.', 'err');
    }
    _R().renderAll();
  }

  function wxLogToday() {
    const s = S();
    const today = U.todayStr();
    const affected = (s.tasks || []).filter(t => t.weatherSensitive && t.startDate && t.endDate &&
      U.parseDL(t.startDate) <= new Date() && U.parseDL(t.endDate) >= new Date()).map(t => t.id);
    ns.Forecast.logWeatherDay(s, { note: '', affectedTaskIds: affected });
    _toast('Weather day logged.', 'ok');
    _R().renderAll();
  }

  function wxLogManual() {
    const s = S();
    const condEl = $('wx-manual-cond');
    const noteEl = $('wx-manual-note');
    const condition = (condEl && condEl.value.trim()) || '';
    if (!condition) { _toast('Enter the manual conditions first.', 'err'); return; }
    const note = (noteEl && noteEl.value.trim()) || '';
    const affected = (s.tasks || []).filter(t => t.weatherSensitive && t.startDate && t.endDate &&
      U.parseDL(t.startDate) <= new Date() && U.parseDL(t.endDate) >= new Date()).map(t => t.id);
    ns.Forecast.logWeatherDay(s, { note: note, affectedTaskIds: affected, manual: true, condition: condition });
    if (condEl) condEl.value = '';
    if (noteEl) noteEl.value = '';
    _toast('Manual weather day logged.', 'ok');
    _R().renderAll();
  }

  function wxCopyNotice() {
    U.copyToClipboard(ns.Forecast.subcontractorNotice(S()));
    _toast('Subcontractor notice copied.', 'ok');
  }

  function wxSetView(el) {
    const days = parseInt((el && el.getAttribute('data-days')) || '7', 10);
    ns.State.updateState(function(s) { s.wxViewDays = days === 16 ? 16 : 7; });
    _R().renderAll();
  }

  function wxDelLogEntry(el) {
    ns.Forecast.delWeatherLogEntry(parseInt(el.getAttribute('data-idx'), 10));
    _R().renderAll();
  }

  function setRegion(val) {
    ns.State.updateState(function(s) { s.weatherRegion = val; });
    if (ns.Schedule && ns.Schedule.checkWeatherExposure) {
      ns.Schedule.checkWeatherExposure((S().tasks || []), val);
    }
    _R().renderWbs();
    _R().renderGantt();
    let label = val;
    if (ns.Weather && ns.Weather.getRegion) {
      const r = ns.Weather.getRegion(val);
      if (r && r.name) label = r.name;
    }
    _toast('Weather region: ' + label, 'ok');
  }

  ns.AppWeather = {
    wxGeocode: wxGeocode,
    wxRefresh: wxRefresh,
    wxUseLocation: wxUseLocation,
    wxLogToday: wxLogToday,
    wxLogManual: wxLogManual,
    wxCopyNotice: wxCopyNotice,
    wxSetView: wxSetView,
    wxDelLogEntry: wxDelLogEntry,
    setRegion: setRegion
  };
})(MMGR);
window.MMGR = MMGR;
