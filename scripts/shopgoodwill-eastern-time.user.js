// ==UserScript==
// @name         shopgoodwill.com tools - Eastern Time
// @namespace    https://github.com/maxhayim/shopgoodwill.com-tools
// @version      1.1.0
// @description  Converts ShopGoodwill auction ending times from Pacific to Eastern Time.
// @author       maxhayim
// @license      MIT
// @match        https://shopgoodwill.com/*
// @match        https://www.shopgoodwill.com/*
// @run-at       document-idle
// @grant        none
// @homepageURL  https://github.com/maxhayim/shopgoodwill.com-tools
// @supportURL   https://github.com/maxhayim/shopgoodwill.com-tools/issues
// @updateURL    https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-eastern-time.user.js
// @downloadURL  https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-eastern-time.user.js
// ==/UserScript==

/*
 * shopgoodwill.com tools - Eastern Time
 * Copyright (c) 2026 maxhayim. MIT License.
 *
 * ShopGoodwill shows auction ending times in Pacific Time, for example:
 *
 *   <li class="text-danger">6:39:00 PM PDT</li>
 *
 * This script rewrites that text to Eastern Time ("9:39:00 PM EDT") and keeps
 * the original Pacific time in the element's tooltip.
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
    attrPrefix: 'data-sgw-et'
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

  /**
   * Converts the first Pacific time found in `text`.
   *
   * @param {string} text
   * @param {object} [options] {date}: the closing date if it was found
   *                           elsewhere on the page.
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

    var r = convertPacificToEastern(t, date);
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

  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /**
   * Short Eastern end time for the countdown, from an Ends On value in either
   * Pacific ("11/19/2026 06:02:00 PM PT") or already-converted Eastern form.
   * Returns e.g. "Thu 11/19, 9:02 PM EST", or null if it can't be read.
   */
  function shortEasternEnd(text) {
    if (!text) return null;
    var conv = convertText(text);
    var eastern = conv ? conv.text : text;
    var d = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(eastern);
    var t = /(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)\s*(EDT|EST|ET)\b/i.exec(eastern);
    if (!d || !t) return null;
    var month = +d[1], day = +d[2], year = +d[3];
    if (!isValidDate(year, month, day)) return null;
    var weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
    return weekday + ' ' + month + '/' + day + ', ' + (+t[1]) + ':' + t[2] + ' ' +
      t[3].toUpperCase() + ' ' + t[4].toUpperCase();
  }

  function tooltipFor(conv) {
    var tip = 'Original: ' + conv.original + ' (Pacific Time)';
    if (!conv.result.certain) {
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
  function processElement(el, config) {
    config = config || CONFIG;
    var doneAttr = config.attrPrefix + '-converted';
    var current = el.textContent || '';
    if (el.getAttribute(doneAttr) === current) return false;

    var node = findTimeTextNode(el);
    if (!node) return false;

    var inlineDates = findDates(node.nodeValue.slice(0, parsePacificTime(node.nodeValue).index));
    var date = inlineDates.length ? null : findClosingDate(el, config);
    var conv = convertText(node.nodeValue, { date: date });
    if (!conv) return false;

    var titleAttr = config.attrPrefix + '-title';
    if (!el.hasAttribute(titleAttr)) el.setAttribute(titleAttr, el.getAttribute('title') || '');
    var priorTitle = el.getAttribute(titleAttr);

    node.nodeValue = conv.text;
    el.setAttribute('title', (priorTitle ? priorTitle + '\n' : '') + tooltipFor(conv));
    el.setAttribute(config.attrPrefix + '-original', conv.original);
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
  // Returns true if anything changed.
  function addEndsBeside(root, config) {
    var def = config.endsBeside;
    if (!def || typeof root.querySelectorAll !== 'function') return false;
    var doc = root.ownerDocument || root;
    var containers = root.querySelectorAll(def.container);
    if (!containers.length) return false;
    var endsLabel = findLabel(root, def.endsLabelSelector, def.endsLabel);
    var ends = endsLabel && endsLabel.nextElementSibling;
    var short = ends ? shortEasternEnd(spacedText(ends).replace(/\s+/g, ' ').trim()) : null;
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
        el.setAttribute('style', 'color:#555;font-weight:400;white-space:nowrap;margin-right:.25em');
        value.parentElement.insertBefore(el, value.nextSibling);
        changed = true;
      }
      if (el.textContent !== text) { el.textContent = text; changed = true; }
      var tip = 'Auction ends ' + short + ' (Eastern Time)';
      if (el.getAttribute('title') !== tip) el.setAttribute('title', tip);
    }
    return changed;
  }

  // Converts every matching element under root. Returns how many changed.
  function scan(root, config) {
    config = config || CONFIG;
    var changed = 0;
    if (!root || typeof root.querySelectorAll !== 'function') return 0;
    config.timeSelectors.forEach(function (sel) {
      var list = root.querySelectorAll(sel);
      for (var i = 0; i < list.length; i++) {
        if (processElement(list[i], config)) changed++;
      }
    });
    if (matchesAny(root, config.timeSelectors) && processElement(root, config)) changed++;
    (config.labeledTimes || []).forEach(function (def) {
      var labels = root.querySelectorAll(def.labelSelector);
      for (var i = 0; i < labels.length; i++) {
        var value = labels[i].nextElementSibling;
        if (value && def.label.test((labels[i].textContent || '').trim()) && processElement(value, config)) changed++;
      }
    });
    if (addEndsBeside(root, config)) changed++;
    return changed;
  }

  /**
   * Starts the converter on a page: converts what is there now, then watches
   * for Angular adding or re-rendering content. Rescans are debounced, and our
   * own edits do not cause further work because converted elements are skipped.
   *
   * @returns {object} {stop(), scanNow()}
   */
  function start(win, doc, config) {
    config = config || CONFIG;
    var root = doc.body || doc.documentElement;
    var timer = null;

    function scanNow() {
      timer = null;
      return scan(root, config);
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
          var m = mutations[i];
          if ((m.addedNodes && m.addedNodes.length) || m.type === 'characterData') {
            schedule();
            return;
          }
        }
      });
      observer.observe(root, { childList: true, subtree: true, characterData: true });
    }

    return {
      scanNow: scanNow,
      stop: function () {
        if (observer) observer.disconnect();
        if (timer !== null) win.clearTimeout(timer);
        timer = null;
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
    shortEasternEnd: shortEasternEnd,
    addEndsBeside: addEndsBeside,
    findClosingDate: findClosingDate,
    processElement: processElement,
    scan: scan,
    start: start
  };
});
