// ==UserScript==
// @name         shopgoodwill.com tools - Local Time
// @namespace    https://github.com/maxhayim/shopgoodwill.com-tools
// @version      2.0.0
// @description  Shows ShopGoodwill auction ending times in your own time zone (detected automatically, or pick any zone). Works on desktop and mobile, including iPhone Safari.
// @author       maxhayim
// @license      MIT
// @match        https://shopgoodwill.com/*
// @match        https://www.shopgoodwill.com/*
// @run-at       document-idle
// @grant        none
// @homepageURL  https://github.com/maxhayim/shopgoodwill.com-tools
// @supportURL   https://github.com/maxhayim/shopgoodwill.com-tools/issues
// @updateURL    https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-local-time.user.js
// @downloadURL  https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-local-time.user.js
// ==/UserScript==

/*
 * shopgoodwill.com tools - Local Time (formerly Eastern Time)
 * Copyright (c) 2026 maxhayim. MIT License.
 *
 * ShopGoodwill shows auction ending times in Pacific Time, for example:
 *
 *   <li class="text-danger">6:39:00 PM PDT</li>
 *
 * This script rewrites that text to your time zone ("9:39:00 PM EDT" in New
 * York, "8:39:00 PM CDT" in Chicago...) and keeps the original Pacific time in
 * the element's tooltip. The zone is the device's own, or one picked by tapping
 * the end time on an item page.
 *
 * The same file runs in Tampermonkey and in Node.js (for the tests): in Node it
 * only exports its functions and never touches a page.
 */
(function (factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    // Run once per page, even if the script is injected twice.
    if (window.__sgwtLocalTime) return;
    window.__sgwtLocalTime = true;
    api.start(window, document);
  }
})(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // CONFIG: every page-specific detail lives here. If ShopGoodwill changes its
  // markup, this is the only block that should need editing. See README,
  // "Updating selectors".
  // ---------------------------------------------------------------------------
  var CONFIG = {
    // Elements whose text holds an auction ending time in Pacific Time.
    timeSelectors: ['li.text-danger'],

    // Times shown next to a label, e.g. the item page's Item Info table:
    //   <th>Ends On:</th><td>11/23/2026 07:56:00 PM PT</td>
    // The value is the label's next element.
    labeledTimes: [
      { labelSelector: 'th', label: /^(Ends|Ended|Ending|Starts|Started) On:?$/i }
    ],

    // The item page's countdown ("Time left: 5h 12m") gets the Eastern end
    // time beside it, taken from the Ends On line above.
    endsBeside: {
      container: 'app-bidding-control',
      labelSelector: 'strong',
      label: /^Time left:?$/i,
      endsLabelSelector: 'th',
      endsLabel: /^Ends On:?$/i,
      className: 'sgwt-et-ends'
    },

    // How many ancestor levels to search for the auction's closing date when
    // the date is not in the time element itself. A level is only used if it
    // holds a single time element and a single distinct date, so a date from a
    // neighbouring listing is never borrowed.
    dateSearchLevels: 2,

    // Ignore ancestors with more text than this when looking for the date.
    dateSearchMaxTextLength: 600,

    // Wait this long after the page changes before scanning again (ms).
    rescanDelayMs: 150,

    // Data attribute prefix used to remember what was converted.
    attrPrefix: 'data-sgw-et',

    // Where the chosen time zone is kept ("auto" or an IANA name such as
    // "America/Chicago"). Auto uses the device's time zone.
    zoneStorageKey: 'sgwTools.time.zone',

    // Used when the browser can't report its time zone.
    fallbackZone: 'America/New_York',

    // Shown first in the time zone picker.
    commonZones: [
      ['America/New_York', 'Eastern'],
      ['America/Chicago', 'Central'],
      ['America/Denver', 'Mountain'],
      ['America/Phoenix', 'Arizona'],
      ['America/Los_Angeles', 'Pacific'],
      ['America/Anchorage', 'Alaska'],
      ['Pacific/Honolulu', 'Hawaii'],
      ['America/Puerto_Rico', 'Puerto Rico']
    ]
  };

  // The proven pattern from the original script, with seconds made optional
  // and an optional date right before the time.
  var TIME_REGEX = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)\s*(PDT|PST|PT)\b/i;

  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  var DATE_REGEXES = [
    // 11/20/2026 or 11-20-2026
    { re: /\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/g, y: 3, m: 1, d: 2, named: false },
    // 2026-11-20
    { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, y: 1, m: 2, d: 3, named: false },
    // Nov 20, 2026 / November 20 2026
    { re: /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi, y: 3, m: 1, d: 2, named: true }
  ];

  // ---------------------------------------------------------------------------
  // Date helpers (US daylight-saving rules in force since 2007).
  // ---------------------------------------------------------------------------
  function isValidDate(y, m, d) {
    if (!(y >= 1970 && y <= 2200 && m >= 1 && m <= 12 && d >= 1)) return false;
    return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  // Day of month of the nth Sunday of a month (month is 1-12).
  function nthSunday(year, month, n) {
    var firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return 1 + ((7 - firstDow) % 7) + (n - 1) * 7;
  }

  // US DST runs from 2:00 local on the 2nd Sunday of March to 2:00 local on the
  // 1st Sunday of November. Returns the UTC instants for a zone whose standard
  // offset is stdOffsetHours (e.g. -5 for Eastern).
  function dstBoundsUtc(year, stdOffsetHours) {
    var start = Date.UTC(year, 2, nthSunday(year, 3, 2), 2 - stdOffsetHours);
    var end = Date.UTC(year, 10, nthSunday(year, 11, 1), 2 - (stdOffsetHours + 1));
    return { start: start, end: end };
  }

  function easternOffsetAtUtc(utcMs) {
    var year = new Date(utcMs).getUTCFullYear();
    var b = dstBoundsUtc(year, -5);
    return (utcMs >= b.start && utcMs < b.end) ? -4 : -5;
  }

  function pacificOffsetAtUtc(utcMs) {
    var year = new Date(utcMs).getUTCFullYear();
    var b = dstBoundsUtc(year, -8);
    return (utcMs >= b.start && utcMs < b.end) ? -7 : -8;
  }

  // ShopGoodwill's own calendar date (Pacific) at a given instant.
  function pacificDateAt(utcMs) {
    var d = new Date(utcMs + pacificOffsetAtUtc(utcMs) * 3600000);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  }

  // ---------------------------------------------------------------------------
  // Time zones (any IANA zone, through the browser's Intl support).
  // ---------------------------------------------------------------------------
  var EASTERN = 'America/New_York';

  function isValidZone(zone) {
    if (typeof zone !== 'string' || !zone) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
      return true;
    } catch (e) {
      return false;
    }
  }

  // The device's time zone, e.g. "America/Chicago", or null.
  function deviceZone() {
    try {
      var z = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return isValidZone(z) ? z : null;
    } catch (e) {
      return null;
    }
  }

  // The zone to show times in: the saved choice, else the device's zone.
  function resolveZone(saved, device, fallback) {
    if (saved && saved !== 'auto' && isValidZone(saved)) return saved;
    return device || fallback || EASTERN;
  }

  var formatters = {};
  // Wall-clock parts of an instant in a zone, with its short name ("CST").
  function zoneParts(utcMs, zone) {
    var f = formatters[zone];
    if (!f) {
      f = formatters[zone] = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short', timeZoneName: 'short'
      });
    }
    var o = {};
    f.formatToParts(new Date(utcMs)).forEach(function (part) { o[part.type] = part.value; });
    return {
      year: +o.year, month: +o.month, day: +o.day,
      hour24: (+o.hour) % 24, minute: +o.minute, second: +o.second,
      weekday: o.weekday, abbr: o.timeZoneName
    };
  }

  var easternCache = {};
  // True for zones that keep Eastern time all year (New York, Toronto,
  // Detroit...). Those use the original, fully tested Eastern conversion.
  function isEasternZone(zone) {
    if (!zone || zone === EASTERN) return true;
    if (Object.prototype.hasOwnProperty.call(easternCache, zone)) return easternCache[zone];
    var same = isValidZone(zone);
    var year = new Date().getUTCFullYear();
    var samples = [[0, 15], [2, 10], [2, 30], [6, 1], [9, 30], [10, 5]];
    for (var i = 0; same && i < samples.length; i++) {
      var utc = Date.UTC(year, samples[i][0], samples[i][1], 12);
      var a = zoneParts(utc, zone);
      var b = zoneParts(utc, EASTERN);
      same = a.hour24 === b.hour24 && a.minute === b.minute && a.day === b.day;
    }
    easternCache[zone] = same;
    return same;
  }

  // Pacific offset for a wall-clock time on a given date when the page only
  // says "PT". The repeated 1 AM hour in November is read as daylight time.
  function pacificOffsetForLocal(date, hour24) {
    var startDay = nthSunday(date.year, 3, 2);
    var endDay = nthSunday(date.year, 11, 1);
    var md = date.month * 100 + date.day;
    var startMd = 300 + startDay;
    var endMd = 1100 + endDay;
    var dst;
    if (md < startMd || md > endMd) dst = false;
    else if (md > startMd && md < endMd) dst = true;
    else if (md === startMd) dst = hour24 >= 2;
    else dst = hour24 < 2;
    return dst ? -7 : -8;
  }

  // ---------------------------------------------------------------------------
  // Parsing and formatting.
  // ---------------------------------------------------------------------------
  function parsePacificTime(text) {
    if (typeof text !== 'string') return null;
    var m = TIME_REGEX.exec(text);
    if (!m) return null;
    var hour12 = parseInt(m[1], 10);
    var minute = parseInt(m[2], 10);
    var hasSeconds = m[3] !== undefined;
    var second = hasSeconds ? parseInt(m[3], 10) : 0;
    if (hour12 < 1 || hour12 > 12 || minute > 59 || second > 59) return null;
    var pm = m[4].toUpperCase() === 'PM';
    var hour24 = (hour12 % 12) + (pm ? 12 : 0);
    return {
      matchText: m[0],
      index: m.index,
      hour24: hour24,
      minute: minute,
      second: second,
      hasSeconds: hasSeconds,
      zone: m[5].toUpperCase()
    };
  }

  // Returns every valid date found in text, as {year, month, day, text, index}.
  function findDates(text) {
    var found = [];
    if (typeof text !== 'string') return found;
    DATE_REGEXES.forEach(function (def) {
      def.re.lastIndex = 0;
      var m;
      while ((m = def.re.exec(text)) !== null) {
        var y = parseInt(m[def.y], 10);
        var mo = def.named ? MONTHS.indexOf(m[def.m].slice(0, 3).toLowerCase()) + 1 : parseInt(m[def.m], 10);
        var d = parseInt(m[def.d], 10);
        if (isValidDate(y, mo, d)) {
          found.push({ year: y, month: mo, day: d, text: m[0], index: m.index });
        }
      }
    });
    return found;
  }

  function distinctDates(dates) {
    var seen = {};
    return dates.filter(function (d) {
      var key = d.year + '-' + d.month + '-' + d.day;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function formatTime(hour24, minute, second, withSeconds) {
    var suffix = hour24 >= 12 ? 'PM' : 'AM';
    var h = hour24 % 12;
    if (h === 0) h = 12;
    return h + ':' + pad2(minute) + (withSeconds ? ':' + pad2(second) : '') + ' ' + suffix;
  }

  // Formats a date in the same style as the date text it replaces.
  function formatDateLike(sample, date) {
    if (/^\d{4}-/.test(sample)) {
      return date.year + '-' + pad2(date.month) + '-' + pad2(date.day);
    }
    var sep = sample.indexOf('-') !== -1 ? '-' : '/';
    if (/^\d/.test(sample)) {
      var padded = /^0\d/.test(sample);
      var mm = padded ? pad2(date.month) : String(date.month);
      var dd = padded ? pad2(date.day) : String(date.day);
      return mm + sep + dd + sep + date.year;
    }
    var name = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December'][date.month - 1];
    var long = /^[A-Za-z]{4,}/.test(sample) && !/^Sept/i.test(sample);
    var monthText = long ? name : name.slice(0, 3);
    return monthText + ' ' + date.day + (sample.indexOf(',') !== -1 ? ',' : '') + ' ' + date.year;
  }

  // ---------------------------------------------------------------------------
  // Conversion.
  // ---------------------------------------------------------------------------

  /**
   * Converts a parsed Pacific time to Eastern Time.
   *
   * @param {object} t     result of parsePacificTime
   * @param {object} [date] the auction's Pacific closing date {year, month, day}
   * @returns {object} {hour24, minute, second, abbr, dayOffset, date, certain}
   *
   * With a date, the exact instant is computed and the Eastern offset comes
   * from the US DST rules, so EST/EDT is exact even on changeover nights.
   *
   * Without a date, three hours are added (the original behaviour). The two
   * zones agree on daylight time at every moment except between 11 PM and
   * 2 AM Pacific on the two changeover nights, so a PDT/PST time outside that
   * window gets EDT/EST, and anything else gets the neutral "ET".
   */
  function convertPacificToEastern(t, date) {
    var hasDate = !!(date && isValidDate(date.year, date.month, date.day));
    if (hasDate) {
      var pacOffset = t.zone === 'PDT' ? -7 : t.zone === 'PST' ? -8 : pacificOffsetForLocal(date, t.hour24);
      var utc = Date.UTC(date.year, date.month - 1, date.day, t.hour24 - pacOffset, t.minute, t.second);
      var etOffset = easternOffsetAtUtc(utc);
      var et = new Date(utc + etOffset * 3600000);
      var etDate = { year: et.getUTCFullYear(), month: et.getUTCMonth() + 1, day: et.getUTCDate() };
      var dayOffset = Math.round((Date.UTC(etDate.year, etDate.month - 1, etDate.day) -
        Date.UTC(date.year, date.month - 1, date.day)) / 86400000);
      return {
        hour24: et.getUTCHours(),
        minute: et.getUTCMinutes(),
        second: et.getUTCSeconds(),
        abbr: etOffset === -4 ? 'EDT' : 'EST',
        dayOffset: dayOffset,
        date: etDate,
        certain: true
      };
    }

    var total = t.hour24 + 3;
    var outsideChangeoverWindow = t.hour24 >= 2 && t.hour24 < 23;
    var certain = (t.zone === 'PDT' || t.zone === 'PST') && outsideChangeoverWindow;
    return {
      hour24: total % 24,
      minute: t.minute,
      second: t.second,
      abbr: certain ? (t.zone === 'PDT' ? 'EDT' : 'EST') : 'ET',
      dayOffset: total >= 24 ? 1 : 0,
      date: null,
      certain: certain
    };
  }

  // The UTC instant of a Pacific wall-clock time on a Pacific date.
  function pacificToUtc(t, date) {
    var pacOffset = t.zone === 'PDT' ? -7 : t.zone === 'PST' ? -8 : pacificOffsetForLocal(date, t.hour24);
    return Date.UTC(date.year, date.month - 1, date.day, t.hour24 - pacOffset, t.minute, t.second);
  }

  /**
   * Converts a parsed Pacific time to any time zone.
   *
   * Eastern zones use convertPacificToEastern unchanged. Other zones need a
   * date to pick the exact instant; without one, today's date (Pacific) is
   * assumed, which only matters around daylight-saving changes.
   *
   * @param {object} t      result of parsePacificTime
   * @param {object} [date] the auction's Pacific closing date
   * @param {string} [zone] IANA zone; defaults to Eastern
   * @param {number} [nowMs] "now", for tests
   */
  function convertPacificToZone(t, date, zone, nowMs) {
    if (!zone || isEasternZone(zone)) return convertPacificToEastern(t, date);
    var hasDate = !!(date && isValidDate(date.year, date.month, date.day));
    var ref = hasDate ? date : pacificDateAt(typeof nowMs === 'number' ? nowMs : Date.now());
    var utc = pacificToUtc(t, ref);
    var p = zoneParts(utc, zone);
    var dayOffset = Math.round((Date.UTC(p.year, p.month - 1, p.day) -
      Date.UTC(ref.year, ref.month - 1, ref.day)) / 86400000);
    return {
      hour24: p.hour24,
      minute: p.minute,
      second: p.second,
      abbr: p.abbr,
      dayOffset: dayOffset,
      date: hasDate ? { year: p.year, month: p.month, day: p.day } : null,
      certain: hasDate,
      assumedDate: !hasDate
    };
  }

  /**
   * Converts the first Pacific time found in `text`.
   *
   * @param {string} text
   * @param {object} [options] {date, zone, now}: the closing date if it was
   *   found elsewhere on the page, the IANA time zone to convert to (default
   *   Eastern) and "now" for tests.
   * @returns {null|object} null if there is nothing to convert, otherwise
   *   {text, original, eastern, result, dateSource}
   */
  function convertText(text, options) {
    var t = parsePacificTime(text);
    if (!t) return null;
    options = options || {};

    // A date in the same text, right before the time, wins.
    var before = text.slice(0, t.index);
    var inline = findDates(before).filter(function (d) {
      return /^[\s,@-]*(at\s*)?[\s,@-]*$/i.test(before.slice(d.index + d.text.length));
    });
    var inlineDate = inline.length ? inline[inline.length - 1] : null;
    var date = inlineDate || options.date || null;

    var r = convertPacificToZone(t, date, options.zone, options.now);
    var easternTime = formatTime(r.hour24, r.minute, r.second, t.hasSeconds) + ' ' + r.abbr;
    var out;
    if (inlineDate) {
      var newDate = formatDateLike(inlineDate.text, r.date);
      out = text.slice(0, inlineDate.index) + newDate +
        text.slice(inlineDate.index + inlineDate.text.length, t.index) +
        easternTime + text.slice(t.index + t.matchText.length);
    } else {
      var shown = easternTime;
      if (r.dayOffset > 0) shown += ' (next day)';
      else if (r.dayOffset < 0) shown += ' (previous day)';
      out = text.slice(0, t.index) + shown + text.slice(t.index + t.matchText.length);
    }

    return {
      text: out,
      original: t.matchText,
      eastern: easternTime,
      result: r,
      dateSource: inlineDate ? 'inline' : options.date ? 'page' : 'none'
    };
  }

  /**
   * Short end time for the countdown, e.g. "Thu 11/19, 9:02 PM EST", from a
   * Pacific Ends On value such as "11/19/2026 06:02:00 PM PT". Returns null
   * if the value has no Pacific time and date.
   */
  function shortLocalEnd(text, zone) {
    var t = parsePacificTime(text);
    if (!t) return null;
    var dates = findDates(text.slice(0, t.index));
    if (!dates.length) return null;
    var p = zoneParts(pacificToUtc(t, dates[dates.length - 1]), zone || EASTERN);
    var h = p.hour24 % 12 || 12;
    return p.weekday + ' ' + p.month + '/' + p.day + ', ' + h + ':' + pad2(p.minute) + ' ' +
      (p.hour24 >= 12 ? 'PM' : 'AM') + ' ' + p.abbr;
  }

  function tooltipFor(conv) {
    var tip = 'Original: ' + conv.original + ' (Pacific Time)';
    if (conv.result.assumedDate) {
      tip += '\nClosing date not found, so daylight saving time is based on today\'s date.';
    } else if (!conv.result.certain) {
      tip += '\nClosing date not found, so EST/EDT could not be confirmed; shown as ET.';
    }
    return tip;
  }

  // ---------------------------------------------------------------------------
  // DOM.
  // ---------------------------------------------------------------------------
  function matchesAny(el, selectors) {
    if (!el || el.nodeType !== 1 || typeof el.matches !== 'function') return false;
    for (var i = 0; i < selectors.length; i++) {
      if (el.matches(selectors[i])) return true;
    }
    return false;
  }

  // Text of a subtree with a space between text nodes, so "3/7/2026" in one
  // element and "11:30 PM" in the next don't run together.
  function spacedText(node) {
    if (node.nodeType === 3) return node.nodeValue || '';
    var parts = [];
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) parts.push(spacedText(kids[i]));
    return parts.join(' ');
  }

  function countTimeElements(container, selectors) {
    var n = 0;
    selectors.forEach(function (s) { n += container.querySelectorAll(s).length; });
    return n;
  }

  // Looks for the closing date near el without ever borrowing one from a
  // different listing. Returns {year, month, day} or null.
  function findClosingDate(el, config) {
    config = config || CONFIG;
    var node = el.parentElement;
    for (var level = 0; node && level < config.dateSearchLevels; level++, node = node.parentElement) {
      var text = spacedText(node);
      if (text.length > config.dateSearchMaxTextLength) return null;
      if (countTimeElements(node, config.timeSelectors) > 1) return null;
      var dates = distinctDates(findDates(text));
      if (dates.length === 1) return dates[0];
      if (dates.length > 1) return null;
    }
    return null;
  }

  // Finds the single text node holding the Pacific time.
  function findTimeTextNode(el) {
    var nodes = el.childNodes || [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3 && TIME_REGEX.test(n.nodeValue || '')) return n;
    }
    return null;
  }

  /**
   * Converts one element in place. Safe to call repeatedly: an element that
   * already shows our converted text is skipped, and if Angular later puts a
   * new Pacific time into it, that new time is converted.
   *
   * @returns {boolean} true if the element was changed
   */
  function processElement(el, config, zone) {
    config = config || CONFIG;
    var doneAttr = config.attrPrefix + '-converted';
    var current = el.textContent || '';
    if (el.getAttribute(doneAttr) === current) return false;

    var node = findTimeTextNode(el);
    if (!node) return false;

    var inlineDates = findDates(node.nodeValue.slice(0, parsePacificTime(node.nodeValue).index));
    var date = inlineDates.length ? null : findClosingDate(el, config);
    var source = node.nodeValue;
    var conv = convertText(source, { date: date, zone: zone });
    if (!conv) return false;

    var titleAttr = config.attrPrefix + '-title';
    if (!el.hasAttribute(titleAttr)) el.setAttribute(titleAttr, el.getAttribute('title') || '');
    var priorTitle = el.getAttribute(titleAttr);

    node.nodeValue = conv.text;
    el.setAttribute('title', (priorTitle ? priorTitle + '\n' : '') + tooltipFor(conv));
    el.setAttribute(config.attrPrefix + '-original', conv.original);
    el.setAttribute(config.attrPrefix + '-source', source);
    el.setAttribute(doneAttr, el.textContent || '');
    return true;
  }

  function findLabel(root, selector, re) {
    var list = root.querySelectorAll(selector);
    for (var i = 0; i < list.length; i++) {
      if (re.test((list[i].textContent || '').trim())) return list[i];
    }
    return null;
  }

  // Puts "· ends Thu 11/19, 9:02 PM EST" right after the countdown value.
  // Tapping it opens the time zone picker (onTap). Returns true if anything
  // changed.
  function addEndsBeside(root, config, zone, onTap) {
    var def = config.endsBeside;
    if (!def || typeof root.querySelectorAll !== 'function') return false;
    var doc = root.ownerDocument || root;
    var containers = root.querySelectorAll(def.container);
    if (!containers.length) return false;
    var endsLabel = findLabel(root, def.endsLabelSelector, def.endsLabel);
    var ends = endsLabel && endsLabel.nextElementSibling;
    var source = ends && (ends.getAttribute(config.attrPrefix + '-source') ||
      spacedText(ends).replace(/\s+/g, ' ').trim());
    var short = source ? shortLocalEnd(source, zone) : null;
    if (!short) return false;
    var text = ' \u00b7 ends ' + short;
    var changed = false;
    for (var i = 0; i < containers.length; i++) {
      var label = findLabel(containers[i], def.labelSelector, def.label);
      var value = label && label.nextElementSibling;
      if (!value) continue;
      var next = value.nextElementSibling;
      var el = next && next.className === def.className ? next : null;
      if (!el) {
        el = doc.createElement('span');
        el.className = def.className;
        el.setAttribute('style', 'color:#555;font-weight:400;white-space:nowrap;margin-right:.25em;cursor:pointer');
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        if (onTap && el.addEventListener) {
          el.addEventListener('click', function (e) { e.preventDefault(); onTap(); });
          el.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); }
          });
        }
        value.parentElement.insertBefore(el, value.nextSibling);
        changed = true;
      }
      if (el.textContent !== text) { el.textContent = text; changed = true; }
      var tip = 'Auction ends ' + short + ' (' + (zone || EASTERN) + '). Click or tap to change the time zone.';
      if (el.getAttribute('title') !== tip) el.setAttribute('title', tip);
    }
    return changed;
  }

  // Converts every matching element under root. Returns how many changed.
  function scan(root, config, zone, onTap) {
    config = config || CONFIG;
    var changed = 0;
    if (!root || typeof root.querySelectorAll !== 'function') return 0;
    config.timeSelectors.forEach(function (sel) {
      var list = root.querySelectorAll(sel);
      for (var i = 0; i < list.length; i++) {
        if (processElement(list[i], config, zone)) changed++;
      }
    });
    if (matchesAny(root, config.timeSelectors) && processElement(root, config, zone)) changed++;
    (config.labeledTimes || []).forEach(function (def) {
      var labels = root.querySelectorAll(def.labelSelector);
      for (var i = 0; i < labels.length; i++) {
        var value = labels[i].nextElementSibling;
        if (value && def.label.test((labels[i].textContent || '').trim()) && processElement(value, config, zone)) changed++;
      }
    });
    if (addEndsBeside(root, config, zone, onTap)) changed++;
    return changed;
  }

  // ---------------------------------------------------------------------------
  // Time zone picker (opened by tapping the end time on an item page).
  // ---------------------------------------------------------------------------
  var PICKER_STYLE = [
    '.sgwt-tz{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);z-index:2147483600;box-sizing:border-box;width:360px;max-width:calc(100vw - 24px);background:#fff;color:#222;border:1px solid #ccd3dd;border-radius:12px;box-shadow:0 10px 32px rgba(0,0,0,.28);padding:14px 16px;font:14px/1.45 -apple-system,system-ui,sans-serif;text-align:left}',
    '.sgwt-tz h4{margin:0 0 6px;font:700 16px -apple-system,system-ui,sans-serif;color:inherit}',
    '.sgwt-tz p{margin:0 0 8px;color:#555;font-size:13px}',
    '.sgwt-tz select{display:block;width:100%;box-sizing:border-box;font-size:16px;padding:8px;margin:4px 0 12px;border:1px solid #bbc3cf;border-radius:8px;background:#fff;color:#222}',
    '.sgwt-tz button{min-height:40px;min-width:88px;padding:0 16px;border-radius:8px;border:1px solid #2a5d9f;background:#2a5d9f;color:#fff;font:600 15px -apple-system,system-ui,sans-serif;cursor:pointer;float:right}',
    '.sgwt-tz::after{content:"";display:block;clear:both}',
    '@media (prefers-color-scheme: dark){.sgwt-tz{background:#1f2329;color:#eceff3;border-color:#3a414b}.sgwt-tz p{color:#a9b2bd}.sgwt-tz select{background:#2a2f37;color:#eceff3;border-color:#4a525d}}'
  ].join('\n');

  // Options for the picker: automatic, common US zones, then every zone the
  // browser knows (Intl.supportedValuesOf, where available).
  function zoneOptions(win, config, device) {
    var all = [];
    try {
      if (win.Intl && typeof win.Intl.supportedValuesOf === 'function') all = win.Intl.supportedValuesOf('timeZone');
    } catch (e) { all = []; }
    var nowMs = Date.now();
    function label(zone, name) {
      var abbr = '';
      try { abbr = zoneParts(nowMs, zone).abbr; } catch (e) { abbr = ''; }
      return (name ? name + ' – ' : '') + zone.replace(/_/g, ' ') + (abbr ? ' (' + abbr + ')' : '');
    }
    return {
      auto: 'Automatic – this device' + (device ? ' (' + device.replace(/_/g, ' ') + ')' : ''),
      common: config.commonZones.map(function (z) { return { value: z[0], text: label(z[0], z[1]) }; }),
      all: all.map(function (z) { return { value: z, text: label(z) }; })
    };
  }

  function createPicker(win, doc, config, state) {
    var panel = null;
    function close() {
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
      panel = null;
      doc.removeEventListener('keydown', onKey, true);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    function open() {
      if (panel) { close(); return; }
      if (!doc.getElementById('sgwt-tz-style')) {
        var st = doc.createElement('style');
        st.id = 'sgwt-tz-style';
        st.textContent = PICKER_STYLE;
        (doc.head || doc.documentElement).appendChild(st);
      }
      panel = doc.createElement('div');
      panel.className = 'sgwt-tz';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Time zone');
      var h = doc.createElement('h4');
      h.textContent = 'Show auction times in';
      var note = doc.createElement('p');
      note.textContent = 'ShopGoodwill lists times in Pacific Time. Pick any time zone, or let your device decide.';
      var select = doc.createElement('select');
      select.setAttribute('aria-label', 'Time zone');
      var opts = zoneOptions(win, config, state.device);
      function add(parent, value, text) {
        var o = doc.createElement('option');
        o.value = value;
        o.textContent = text;
        parent.appendChild(o);
      }
      add(select, 'auto', opts.auto);
      [['United States', opts.common], ['All time zones', opts.all]].forEach(function (g) {
        if (!g[1].length) return;
        var group = doc.createElement('optgroup');
        group.label = g[0];
        g[1].forEach(function (o) { add(group, o.value, o.text); });
        select.appendChild(group);
      });
      select.value = state.saved && state.saved !== 'auto' ? state.saved : 'auto';
      select.addEventListener('change', function () {
        try { win.localStorage.setItem(config.zoneStorageKey, select.value); } catch (e) { /* private mode */ }
        // Reload so every time on the page is converted again from the
        // original Pacific text.
        win.location.reload();
      });
      var done = doc.createElement('button');
      done.type = 'button';
      done.textContent = 'Done';
      done.addEventListener('click', close);
      panel.appendChild(h);
      panel.appendChild(note);
      panel.appendChild(select);
      panel.appendChild(done);
      doc.body.appendChild(panel);
      doc.addEventListener('keydown', onKey, true);
    }
    return { open: open, close: close };
  }

  // True if a mutation could hold a new Pacific time. Countdown ticks
  // ("5h 12m") and our own inserted end time are ignored, so a ticking page
  // doesn't trigger a scan every second.
  function mutationMatters(m, config) {
    if (m.type === 'characterData') return /\b(PDT|PST|PT)\b/.test((m.target && m.target.nodeValue) || '');
    var added = m.addedNodes || [];
    var ownClass = config.endsBeside && config.endsBeside.className;
    for (var i = 0; i < added.length; i++) {
      var n = added[i];
      if (n.nodeType === 1 && (n.className === ownClass || n.className === 'sgwt-tz')) continue;
      if (n.nodeType === 3 && !/\b(PDT|PST|PT)\b/.test(n.nodeValue || '')) continue;
      return true;
    }
    return false;
  }

  /**
   * Starts the converter on a page: converts what is there now, then watches
   * for Angular adding or re-rendering content. Rescans are debounced, and our
   * own edits do not cause further work because converted elements are skipped.
   *
   * @returns {object} {stop(), scanNow(), zone}
   */
  function start(win, doc, config) {
    config = config || CONFIG;
    var root = doc.body || doc.documentElement;
    var timer = null;

    var saved = null;
    try { saved = win.localStorage && win.localStorage.getItem(config.zoneStorageKey); } catch (e) { saved = null; }
    var state = { saved: saved, device: deviceZone() };
    var zone = resolveZone(saved, state.device, config.fallbackZone);
    var picker = doc.createElement ? createPicker(win, doc, config, state) : null;
    var onTap = picker ? picker.open : null;

    function scanNow() {
      timer = null;
      return scan(root, config, zone, onTap);
    }

    function schedule() {
      if (timer === null) timer = win.setTimeout(scanNow, config.rescanDelayMs);
    }

    scanNow();

    var Observer = win.MutationObserver;
    var observer = null;
    if (typeof Observer === 'function') {
      observer = new Observer(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          if (mutationMatters(mutations[i], config)) {
            schedule();
            return;
          }
        }
      });
      observer.observe(root, { childList: true, subtree: true, characterData: true });
    }

    return {
      zone: zone,
      scanNow: scanNow,
      stop: function () {
        if (observer) observer.disconnect();
        if (timer !== null) win.clearTimeout(timer);
        timer = null;
        if (picker) picker.close();
      }
    };
  }

  return {
    CONFIG: CONFIG,
    TIME_REGEX: TIME_REGEX,
    parsePacificTime: parsePacificTime,
    findDates: findDates,
    nthSunday: nthSunday,
    easternOffsetAtUtc: easternOffsetAtUtc,
    pacificOffsetForLocal: pacificOffsetForLocal,
    formatTime: formatTime,
    convertPacificToEastern: convertPacificToEastern,
    convertText: convertText,
    convertPacificToZone: convertPacificToZone,
    isEasternZone: isEasternZone,
    isValidZone: isValidZone,
    deviceZone: deviceZone,
    resolveZone: resolveZone,
    zoneParts: zoneParts,
    pacificDateAt: pacificDateAt,
    mutationMatters: mutationMatters,
    shortLocalEnd: shortLocalEnd,
    addEndsBeside: addEndsBeside,
    findClosingDate: findClosingDate,
    processElement: processElement,
    scan: scan,
    start: start
  };
});
