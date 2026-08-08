/* ============================================================
   My MaNaGeR — Weather Analysis Module
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;

  // ---- Weather Windows (by region) ----
  const WINDOWS = {
    'northern-temperate': {
      name: 'Northern Temperate',
      winter: { start: '11-15', end: '03-15' },  // Nov 15 - Mar 15
      spring: { start: '03-16', end: '05-31' },
      summer: { start: '06-01', end: '08-31' },
      fall: { start: '09-01', end: '11-14' },
      monsoon: null,
      hurricane: { start: '06-01', end: '11-30' }
    },
    'southern-temperate': {
      name: 'Southern Temperate',
      winter: { start: '05-15', end: '09-15' },
      spring: { start: '09-16', end: '11-30' },
      summer: { start: '12-01', end: '02-28' },
      fall: { start: '03-01', end: '05-14' },
      monsoon: null,
      hurricane: null
    },
    'tropical': {
      name: 'Tropical',
      winter: null,
      spring: null,
      summer: null,
      fall: null,
      monsoon: { start: '05-01', end: '10-31' },
      hurricane: { start: '06-01', end: '11-30' }
    }
  };

  function getRegions() {
    return Object.keys(WINDOWS).map(k => ({ id: k, name: WINDOWS[k].name }));
  }

  function getRegion(regionId) {
    return WINDOWS[regionId] || null;
  }

  function getWindow(regionId, windowName) {
    const region = WINDOWS[regionId];
    if (!region) return null;
    return region[windowName] || null;
  }

  function isDateInWindow(dateStr, window) {
    if (!window || !dateStr) return false;
    const d = U.parseDL(dateStr);
    if (!d) return false;
    const startParts = window.start.split('-').map(Number);
    const endParts = window.end.split('-').map(Number);
    const startDate = new Date(d.getFullYear(), startParts[0] - 1, startParts[1]);
    const endDate = new Date(d.getFullYear(), endParts[0] - 1, endParts[1]);
    // Handle year-end wrap
    if (endDate < startDate) {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }
    return d >= startDate && d <= endDate;
  }

  function getTaskWeatherExposure(task, regionId) {
    if (!task || !task.startDate || !task.endDate) return { exposed: false, reason: '' };
    const region = WINDOWS[regionId || 'northern-temperate'];
    if (!region) return { exposed: false, reason: '' };
    const reasons = [];
    // Check winter
    const winter = region.winter;
    if (winter && (isDateInWindow(task.startDate, winter) || isDateInWindow(task.endDate, winter))) {
      reasons.push('Winter conditions');
    }
    // Check monsoon
    const monsoon = region.monsoon;
    if (monsoon && (isDateInWindow(task.startDate, monsoon) || isDateInWindow(task.endDate, monsoon))) {
      reasons.push('Monsoon/rainy season');
    }
    // Check hurricane
    const hurricane = region.hurricane;
    if (hurricane && (isDateInWindow(task.startDate, hurricane) || isDateInWindow(task.endDate, hurricane))) {
      reasons.push('Hurricane season');
    }
    return {
      exposed: reasons.length > 0,
      reason: reasons.join('; ')
    };
  }

  // NOTE: no calculateWeatherBuffer here. The old blunt "always +5 days"
  // buffer was removed — the single authoritative implementation is
  // ns.Schedule.calculateWeatherBuffer, which counts only WORKING days a
  // task actually spends inside hostile windows. Keeping one path prevents
  // the public API from silently disagreeing with the schedule engine.

  // ---- Hurricane Window Variance ----
  function getHurricaneWindowVariance(regionId, targetEndDate) {
    const region = WINDOWS[regionId || 'northern-temperate'];
    if (!region || !region.hurricane) return { overlap: false, daysUntilWindow: null, message: '' };
    const hurricane = region.hurricane;
    // Parse hurricane end
    const endParts = hurricane.end.split('-').map(Number);
    const hurricaneEnd = new Date();
    hurricaneEnd.setMonth(endParts[0] - 1, endParts[1]);
    hurricaneEnd.setFullYear(hurricaneEnd.getMonth() < 6 ? hurricaneEnd.getFullYear() + 1 : hurricaneEnd.getFullYear());
    const target = U.parseDL(targetEndDate);
    if (!target) return { overlap: false, daysUntilWindow: null, message: '' };
    const days = U.daysBetween(target, hurricaneEnd);
    if (days < 0) {
      return { overlap: true, daysUntilWindow: Math.abs(days), message: `Project ends ${Math.abs(days)} days into hurricane season` };
    } else {
      return { overlap: false, daysUntilWindow: days, message: `${days} days of buffer before hurricane season` };
    }
  }

  // ---- API ----
  ns.Weather = {
    getRegions: getRegions,
    getRegion: getRegion,
    getWindow: getWindow,
    isDateInWindow: isDateInWindow,
    getTaskWeatherExposure: getTaskWeatherExposure,
    getHurricaneWindowVariance: getHurricaneWindowVariance
  };
})(MMGR);
window.MMGR = MMGR;