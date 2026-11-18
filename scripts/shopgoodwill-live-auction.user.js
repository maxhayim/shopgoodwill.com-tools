// ==UserScript==
// @name         shopgoodwill.com tools - Live Auction
// @namespace    https://github.com/maxhayim/shopgoodwill.com-tools
// @version      1.1.0
// @description  Keeps the price, bid count and a to-the-second countdown up to date on ShopGoodwill item pages without reloading.
// @author       maxhayim
// @license      MIT
// @match        https://shopgoodwill.com/*
// @match        https://www.shopgoodwill.com/*
// @run-at       document-idle
// @grant        none
// @homepageURL  https://github.com/maxhayim/shopgoodwill.com-tools
// @supportURL   https://github.com/maxhayim/shopgoodwill.com-tools/issues
// @updateURL    https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-live-auction.user.js
// @downloadURL  https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-live-auction.user.js
// ==/UserScript==

/*
 * shopgoodwill.com tools - Live Auction
 * Copyright (c) 2026 maxhayim. MIT License.
 *
 * On an item page, re-reads the auction from ShopGoodwill's API on a schedule
 * that speeds up near the end, and updates the price, bid count and minimum
 * bid in place. "Time left" becomes a countdown that ticks every second, and
 * the browser tab title shows the countdown and price so you can watch an
 * auction from another tab. Display only: bidding is never touched.
 *
 * The same file runs in Tampermonkey and in Node.js (for the tests).
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
  // CONFIG: page-specific details. See README, "Updating selectors".
  // ---------------------------------------------------------------------------
  var CONFIG = {
    apiBase: 'https://buyerapi.shopgoodwill.com/api/',
    itemPathRegex: /^\/item\/(\d+)/,
    panelSelector: 'app-bidding-control',

    // Labels the site prints next to each value. Matching is by text, so
    // class name changes don't break it.
    labels: {
      timeLeft: /^Time left:?$/i,
      bids: /^Bids:?$/i,
      price: /^Current Price:?$/i,
      minimumBid: /^Minimum Bid:?$/i
    },

    // Seconds between API checks, by time remaining.
    pollSchedule: [
      { underMs: 2 * 60 * 1000, everyMs: 4000 },
      { underMs: 15 * 60 * 1000, everyMs: 10000 },
      { underMs: 2 * 60 * 60 * 1000, everyMs: 30000 },
      { underMs: Infinity, everyMs: 60000 }
    ],
    hiddenTabMinMs: 30000,     // never faster than this while the tab is hidden
    finalStretchMs: 5 * 60 * 1000,
    showInTabTitle: true,
    cssPrefix: 'sgwt-live'
  };

  // ---------------------------------------------------------------------------
  // Pure helpers (tested in Node).
  // ---------------------------------------------------------------------------

  // ShopGoodwill sends times like "2026-11-23T19:56:00" with no zone. Both
  // endTime and serverTime use the same zone, so treating them alike as UTC
  // gives the right difference.
  function parseNaive(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(s || '');
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +(m[7] + '00').slice(0, 3) : 0);
  }

  // Milliseconds left at `now`, given the detail fetched at `fetchedAt`.
  function remainingMs(detail, fetchedAt, now) {
    var end = parseNaive(detail && detail.endTime);
    var server = parseNaive(detail && detail.serverTime);
    if (end === null || server === null) return null;
    return Math.max(0, end - server - (now - fetchedAt));
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // 3d 4h 12m · 4:05:09 · 12:09 · 0:07
  function formatCountdown(ms) {
    if (ms === null || ms === undefined) return '';
    if (ms <= 0) return 'Ended';
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
    if (h > 0) return h + ':' + pad2(m) + ':' + pad2(sec);
    return m + ':' + pad2(sec);
  }

  function pollDelay(msLeft, hidden, config) {
    config = config || CONFIG;
    var every = config.pollSchedule[config.pollSchedule.length - 1].everyMs;
    for (var i = 0; i < config.pollSchedule.length; i++) {
      if (msLeft !== null && msLeft < config.pollSchedule[i].underMs) { every = config.pollSchedule[i].everyMs; break; }
    }
    return hidden ? Math.max(every, config.hiddenTabMinMs) : every;
  }

  function formatMoney(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '';
    return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function ago(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + 's ago';
    return Math.floor(s / 60) + 'm ago';
  }

  function tabTitle(baseTitle, msLeft, price) {
    var bits = [formatCountdown(msLeft)];
    if (typeof price === 'number') bits.push(formatMoney(price));
    return '⏱ ' + bits.filter(Boolean).join(' · ') + ' | ' + baseTitle;
  }

  // ---------------------------------------------------------------------------
  // DOM helpers.
  // ---------------------------------------------------------------------------
  function textOf(el) { return (el && el.textContent || '').replace(/\s+/g, ' ').trim(); }

  // Finds the element whose own text matches `re` inside root.
  function findLabel(root, re) {
    var all = root.querySelectorAll('strong,h3,p,span,div');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var text = textOf(el);
      if (!re.test(text)) continue;
      // Skip wrappers: a child holding the same text is the real label.
      var wrapper = false;
      for (var c = 0; c < el.children.length; c++) {
        if (textOf(el.children[c]) === text) { wrapper = true; break; }
      }
      if (!wrapper) return el;
    }
    return null;
  }

  // Value cell for a label laid out as  .row > .col-8 > LABEL  /  .col-4 > VALUE
  function valueInRow(label) {
    var col = label.parentElement;
    var row = col && col.parentElement;
    if (!row) return null;
    var cols = row.children;
    for (var i = 0; i < cols.length; i++) {
      if (cols[i] !== col) return cols[i].firstElementChild || cols[i];
    }
    return null;
  }

  // Replaces the first non-empty text node, so badges and icons stay put.
  function setText(el, value) {
    if (!el) return false;
    var nodes = el.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].nodeType === 3 && nodes[i].nodeValue.trim()) {
        var lead = /^\s*/.exec(nodes[i].nodeValue)[0];
        var trail = /\s*$/.exec(nodes[i].nodeValue)[0];
        if (nodes[i].nodeValue !== lead + value + trail) {
          nodes[i].nodeValue = lead + value + trail;
          return true;
        }
        return false;
      }
    }
    return false;
  }

  function findTargets(panel, config) {
    var L = config.labels;
    var t = {};
    var timeLabel = findLabel(panel, L.timeLeft);
    t.timeLeft = timeLabel && timeLabel.nextElementSibling;
    var bidsLabel = findLabel(panel, L.bids);
    t.bids = [];
    for (var n = bidsLabel && bidsLabel.nextElementSibling; n; n = n.nextElementSibling) t.bids.push(n);
    var priceLabel = findLabel(panel, L.price);
    t.price = priceLabel && valueInRow(priceLabel);
    var minLabel = findLabel(panel, L.minimumBid);
    t.minimumBid = minLabel && valueInRow(minLabel);
    return t;
  }

  // ---------------------------------------------------------------------------
  // Page.
  // ---------------------------------------------------------------------------
  var STYLE = [
    '.P-chip{display:inline-flex;align-items:center;gap:5px;margin-left:8px;padding:1px 8px;border-radius:999px;background:#e8f5ec;color:#1b6b34;font-size:.75rem;font-weight:600;vertical-align:middle;cursor:pointer;user-select:none}',
    '.P-chip i{width:7px;height:7px;border-radius:50%;background:#22a050;animation:P-pulse 1.6s ease-in-out infinite}',
    '.P-chip.P-paused{background:#eee;color:#666}.P-chip.P-paused i{background:#999;animation:none}',
    '.P-chip.P-ended{background:#f4e6e6;color:#8b1c1c}.P-chip.P-ended i{background:#8b1c1c;animation:none}',
    '@keyframes P-pulse{0%,100%{opacity:1}50%{opacity:.25}}',
    '.P-final{color:#c62828!important;font-weight:700}',
    '.P-flash{animation:P-flash 1.8s ease-out}',
    '@keyframes P-flash{0%{background:#fff3a0}100%{background:transparent}}'
  ].join('\n');

  function start(win, doc, config) {
    config = config || CONFIG;
    var P = config.cssPrefix;
    var style = doc.createElement('style');
    style.textContent = STYLE.replace(/P-/g, P + '-');
    (doc.head || doc.documentElement).appendChild(style);

    var state = null;   // {itemId, detail, fetchedAt, targets, chip, baseTitle, paused, pollTimer}
    var tickTimer = null;

    function stopItem() {
      if (!state) return;
      win.clearTimeout(state.pollTimer);
      if (state.chip) state.chip.remove();
      if (config.showInTabTitle && state.baseTitle && /^⏱/.test(doc.title)) doc.title = state.baseTitle;
      state = null;
    }

    function poll() {
      if (!state || state.paused) return;
      var s = state;
      win.fetch(config.apiBase + 'ItemDetail/GetItemDetailModelByItemId/' + s.itemId)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (d) {
          if (state !== s) return;
          var prev = s.detail;
          s.detail = d;
          s.fetchedAt = Date.now();
          s.error = null;
          applyDetail(prev);
        }, function () { if (state === s) s.error = true; })
        .then(function () {
          if (state !== s || s.paused) return;
          var left = s.detail ? remainingMs(s.detail, s.fetchedAt, Date.now()) : null;
          if (left === 0) return;    // auction over, stop polling
          s.pollTimer = win.setTimeout(poll, pollDelay(left, doc.hidden, config));
        });
    }

    function flash(el) {
      if (!el) return;
      el.classList.remove(P + '-flash');
      void el.offsetWidth;
      el.classList.add(P + '-flash');
    }

    function applyDetail(prev) {
      var d = state.detail;
      var t = state.targets;
      if (typeof d.currentPrice === 'number' && setText(t.price, formatMoney(d.currentPrice)) && prev) flash(t.price);
      if (typeof d.minimumBid === 'number') setText(t.minimumBid, formatMoney(d.minimumBid));
      if (typeof d.numberOfBids === 'number') {
        t.bids.forEach(function (el) {
          if (setText(el, String(d.numberOfBids)) && prev && el.offsetParent !== null) flash(el);
          if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', d.numberOfBids + ' bids – See all bids');
        });
      }
      tick();
    }

    function tick() {
      if (!state || !state.detail) return;
      var left = remainingMs(state.detail, state.fetchedAt, Date.now());
      var t = state.targets;
      if (t.timeLeft) {
        setText(t.timeLeft, formatCountdown(left));
        t.timeLeft.classList.toggle(P + '-final', left !== null && left > 0 && left < config.finalStretchMs);
      }
      var chip = state.chip;
      if (chip) {
        var ended = left === 0;
        chip.className = P + '-chip' + (ended ? ' ' + P + '-ended' : state.paused ? ' ' + P + '-paused' : '');
        chip.lastChild.textContent = ended ? 'Ended' : state.paused ? 'Paused' :
          'Live · ' + (state.error ? 'retrying' : 'updated ' + ago(Date.now() - state.fetchedAt));
        chip.title = ended ? 'This auction has ended.' : state.paused
          ? 'Live updates are paused. Click to resume.'
          : 'Price, bids and time left update automatically. Click to pause.';
      }
      if (config.showInTabTitle && state.baseTitle) {
        doc.title = left === 0 ? state.baseTitle : tabTitle(state.baseTitle, left, state.detail.currentPrice);
      }
    }

    function setupItem(itemId) {
      var panel = doc.querySelector(config.panelSelector);
      if (!panel) return;
      var targets = findTargets(panel, config);
      if (!targets.timeLeft && !targets.price) return;   // markup changed; do nothing
      stopItem();
      state = {
        itemId: itemId, detail: null, fetchedAt: 0, targets: targets,
        baseTitle: doc.title.replace(/^⏱[^|]*\|\s*/, ''), paused: false, pollTimer: null
      };
      var chip = doc.createElement('span');
      chip.className = P + '-chip';
      chip.setAttribute('role', 'button');
      chip.setAttribute('tabindex', '0');
      chip.appendChild(doc.createElement('i'));
      chip.appendChild(doc.createElement('span'));
      chip.lastChild.textContent = 'Live';
      chip.addEventListener('click', togglePause);
      chip.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePause(); } });
      var anchor = targets.price || targets.timeLeft.parentElement;
      anchor.appendChild(chip);
      state.chip = chip;
      poll();
    }

    function togglePause() {
      if (!state) return;
      state.paused = !state.paused;
      win.clearTimeout(state.pollTimer);
      if (!state.paused) poll();
      tick();
    }

    function check() {
      var m = config.itemPathRegex.exec(win.location.pathname);
      if (!m) { stopItem(); return; }
      var stale = !state || state.itemId !== m[1] || !doc.contains(state.chip) ||
        (state.targets.timeLeft && !doc.contains(state.targets.timeLeft));
      if (stale) setupItem(m[1]);
    }

    check();
    tickTimer = win.setInterval(function () { check(); tick(); }, 1000);
    doc.addEventListener('visibilitychange', function () {
      // Catch up straight away when the tab comes back.
      if (!doc.hidden && state && !state.paused) { win.clearTimeout(state.pollTimer); poll(); }
    });

    return { stop: function () { win.clearInterval(tickTimer); stopItem(); } };
  }

  return {
    CONFIG: CONFIG,
    parseNaive: parseNaive,
    remainingMs: remainingMs,
    formatCountdown: formatCountdown,
    pollDelay: pollDelay,
    formatMoney: formatMoney,
    tabTitle: tabTitle,
    findTargets: findTargets,
    setText: setText,
    start: start
  };
});
