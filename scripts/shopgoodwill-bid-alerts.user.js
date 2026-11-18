// ==UserScript==
// @name         shopgoodwill.com tools - Bid Alerts
// @namespace    https://github.com/maxhayim/shopgoodwill.com-tools
// @version      1.2.0
// @description  Alerts you on ShopGoodwill when you're outbid, when someone bids on an item you follow, and before your auctions end.
// @author       maxhayim
// @license      MIT
// @match        https://shopgoodwill.com/*
// @match        https://www.shopgoodwill.com/*
// @run-at       document-idle
// @grant        none
// @homepageURL  https://github.com/maxhayim/shopgoodwill.com-tools
// @supportURL   https://github.com/maxhayim/shopgoodwill.com-tools/issues
// @updateURL    https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-bid-alerts.user.js
// @downloadURL  https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-bid-alerts.user.js
// ==/UserScript==

/*
 * shopgoodwill.com tools - Bid Alerts
 * Copyright (c) 2026 maxhayim. MIT License.
 *
 * Follows auctions and tells you when something happens:
 *   - Outbid: the price went past the max bid you placed
 *   - Matched: someone's bid reached your max exactly
 *   - New bid: someone bid on an item you follow
 *   - Ending soon: 15, 5 and 1 minute(s) before the end (configurable)
 *   - Ended: the final price, and whether it was within your max
 *
 * What it follows:
 *   - Every bid you place in this browser. The script notices the site's own
 *     "bid accepted" reply and records the item and your max bid. It only
 *     reads that reply; it never changes, sends or repeats a bid.
 *   - Any item you follow with the bell button on its page (optionally with
 *     your max bid, e.g. for bids placed on another device).
 *
 * Alerts appear as pop-ups on every open ShopGoodwill tab, with an optional
 * sound and optional desktop notifications. One tab does the checking (the
 * others listen), so alerts aren't repeated. Prices come from the same
 * public item details the site shows to everyone; your login is never used.
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
  // CONFIG
  // ---------------------------------------------------------------------------
  var CONFIG = {
    apiBase: 'https://buyerapi.shopgoodwill.com/api/',
    placeBidPath: /\/ItemBid\/PlaceBid(?:\?|$)/i,
    itemPathRegex: /^\/item\/(\d+)/,
    itemPanelSelector: 'app-bidding-control',

    // Seconds between checks of one item, by time remaining.
    pollSchedule: [
      { underMs: 3 * 60 * 1000, everyMs: 5000 },
      { underMs: 20 * 60 * 1000, everyMs: 15000 },
      { underMs: 3 * 60 * 60 * 1000, everyMs: 60000 },
      { underMs: Infinity, everyMs: 5 * 60000 }
    ],
    leaderTtlMs: 8000,             // a checking tab that goes quiet this long is replaced
    loopMs: 2000,
    keepEndedMs: 24 * 60 * 60 * 1000,
    toastMs: 12000,
    storagePrefix: 'sgwTools.alerts.',
    cssPrefix: 'sgwt-alert'
  };

  var DEFAULT_PREFS = {
    endingMinutes: [15, 5, 1],
    sound: true,
    desktop: false,
    newBidAlerts: true
  };

  // ---------------------------------------------------------------------------
  // Pure helpers (tested in Node).
  // ---------------------------------------------------------------------------
  function formatMoney(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '';
    return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function parseNaive(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(s || '');
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +(m[7] + '00').slice(0, 3) : 0);
  }

  // Absolute end time on this computer's clock, from ShopGoodwill's end and
  // server times (both in the same unlabelled zone).
  function endAt(detail, fetchedAt) {
    var end = parseNaive(detail && detail.endTime);
    var server = parseNaive(detail && detail.serverTime);
    if (end === null || server === null) return null;
    return fetchedAt + (end - server);
  }

  function minutesLabel(m) { return m === 1 ? '1 minute' : m + ' minutes'; }

  function pollEvery(msLeft, config) {
    config = config || CONFIG;
    for (var i = 0; i < config.pollSchedule.length; i++) {
      if (msLeft !== null && msLeft < config.pollSchedule[i].underMs) return config.pollSchedule[i].everyMs;
    }
    return config.pollSchedule[config.pollSchedule.length - 1].everyMs;
  }

  /**
   * Reads the site's bid request and reply. Returns {itemId, bidAmount} when
   * the site accepted the bid, otherwise null.
   */
  function parsePlaceBid(requestBody, responseText) {
    var req, res;
    try { req = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody; } catch (e) { return null; }
    try { res = typeof responseText === 'string' ? JSON.parse(responseText) : responseText; } catch (e) { return null; }
    if (!req || !res || res.status !== true) return null;
    var itemId = Number(req.itemId);
    var amount = Number(req.bidAmount);
    if (!(itemId > 0) || !(amount > 0)) return null;
    return { itemId: String(itemId), bidAmount: amount };
  }

  /**
   * Compares a fresh item detail with what we knew, and returns the alerts to
   * show plus the updated record. Pure: `now` and `fetchedAt` are passed in.
   *
   * record: {itemId, title, maxBid, source, lastPrice, lastBids, endAt,
   *          fired: {key: true}, ended}
   */
  function evaluate(record, detail, fetchedAt, now, prefs) {
    prefs = prefs || DEFAULT_PREFS;
    var r = JSON.parse(JSON.stringify(record));
    r.fired = r.fired || {};
    var events = [];
    var price = typeof detail.currentPrice === 'number' ? detail.currentPrice : null;
    var bids = typeof detail.numberOfBids === 'number' ? detail.numberOfBids : null;
    var end = endAt(detail, fetchedAt);
    if (detail.title) r.title = detail.title;
    if (end !== null) r.endAt = end;

    function fire(key, ev) {
      if (r.fired[key]) return;
      r.fired[key] = true;
      ev.itemId = r.itemId;
      ev.title = r.title;
      events.push(ev);
    }

    var first = r.lastPrice === undefined || r.lastPrice === null;
    var priceUp = !first && price !== null && price > r.lastPrice;
    var bidsUp = !first && bids !== null && r.lastBids !== null && r.lastBids !== undefined && bids > r.lastBids;
    var max = typeof r.maxBid === 'number' ? r.maxBid : null;

    if (max !== null && price !== null) {
      if (price > max) {
        // Key on the max, so raising your max re-arms the alert.
        fire('outbid:' + max, {
          type: 'outbid', level: 'danger',
          text: 'You\'ve been outbid. Price is now ' + formatMoney(price) + ' (your max ' + formatMoney(max) + ').'
        });
      } else if (price === max && (bidsUp || first) && bids !== null && bids > 1) {
        fire('matched:' + max, {
          type: 'matched', level: 'warning',
          text: 'Bidding reached your max of ' + formatMoney(max) + '. If the other bidder bid first, you may be outbid.'
        });
      }
    }

    if (prefs.newBidAlerts && (bidsUp || priceUp) && !(max !== null && price > max)) {
      var ownBid = r.ownBidPending && price !== null && max !== null && price <= max;
      if (!ownBid) {
        fire('bid:' + bids + ':' + price, {
          type: 'newbid', level: 'info',
          text: 'New bid: ' + formatMoney(price) + ' (' + bids + (bids === 1 ? ' bid' : ' bids') + ').'
        });
      }
    }
    r.ownBidPending = false;

    var left = end !== null ? end - now : null;
    var ended = left !== null && left <= 0;
    if (!ended && left !== null) {
      var mins = (prefs.endingMinutes || []).slice().sort(function (a, b) { return a - b; });
      for (var i = 0; i < mins.length; i++) {
        if (left <= mins[i] * 60000) {
          // Fire only the nearest threshold, and mark the larger ones done.
          for (var j = i; j < mins.length; j++) r.fired['ending:' + mins[j]] = r.fired['ending:' + mins[j]] || j > i;
          fire('ending:' + mins[i], {
            type: 'ending', level: 'warning',
            text: 'Ends in under ' + minutesLabel(mins[i]) + '. Price ' + formatMoney(price) +
              (max !== null ? (price > max ? ' (above your max ' + formatMoney(max) + ')' : ' (your max ' + formatMoney(max) + ')') : '') + '.'
          });
          break;
        }
      }
    }

    if (ended || detail.isItemEndTimeExpire === true) {
      r.ended = true;
      var outcome = max === null ? '' : price > max
        ? ' It went past your max of ' + formatMoney(max) + '.'
        : ' That\'s within your max of ' + formatMoney(max) + ', so you may have won. Check My ShopGoodwill to confirm.';
      fire('ended', { type: 'ended', level: max !== null && price <= max ? 'success' : 'info', text: 'Auction ended at ' + formatMoney(price) + '.' + outcome });
    }

    if (price !== null) r.lastPrice = price;
    if (bids !== null) r.lastBids = bids;
    return { record: r, events: events };
  }

  // Status line for the overview panel.
  function statusOf(record, now) {
    var max = typeof record.maxBid === 'number' ? record.maxBid : null;
    var price = record.lastPrice;
    if (record.ended) {
      if (max === null) return { text: 'Ended', kind: 'ended' };
      return price > max ? { text: 'Ended above your max', kind: 'lost' } : { text: 'Ended within your max', kind: 'won' };
    }
    if (typeof price !== 'number') return { text: 'Checking…', kind: 'wait' };
    if (max !== null && price > max) return { text: 'Outbid', kind: 'outbid' };
    if (max !== null) return { text: 'Within your max', kind: 'ok' };
    return { text: 'Following', kind: 'watch' };
  }

  // Picks which tab does the checking. `lock` is {id, t} or null.
  function shouldLead(lock, myId, now, ttlMs) {
    if (!lock || !lock.id) return true;
    if (lock.id === myId) return true;
    return now - lock.t > ttlMs;
  }

  // ---------------------------------------------------------------------------
  // Page.
  // ---------------------------------------------------------------------------
  var BELL = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 002.45-2h-4.9A2.5 2.5 0 0012 22zm7-6V11a7 7 0 00-5.5-6.84V3a1.5 1.5 0 00-3 0v1.16A7 7 0 005 11v5l-2 2v1h18v-1z"/></svg>';

  var STYLE = [
    '.P-fab{position:fixed;left:16px;bottom:16px;z-index:2147482000;all:unset;box-sizing:border-box;position:fixed;left:16px;bottom:16px;z-index:2147482000;display:flex;align-items:center;gap:6px;cursor:pointer;background:#1f3a5f;color:#fff;border-radius:999px;padding:8px 12px;font:600 13px/1 system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25)}',
    '.P-fab b{background:#e8a33d;color:#1f2a33;border-radius:999px;padding:2px 6px;font-size:11px}',
    '.P-fab.P-has-outbid b{background:#d93636;color:#fff}',
    '.P-toasts{position:fixed;top:16px;right:16px;z-index:2147483600;display:flex;flex-direction:column;gap:8px;width:330px;max-width:calc(100vw - 32px)}',
    '.P-toast{background:#fff;color:#222;border-left:5px solid #2a6fb0;border-radius:8px;box-shadow:0 8px 26px rgba(0,0,0,.22);padding:10px 12px 10px 12px;font:13px/1.4 system-ui,sans-serif;animation:P-in .25s ease-out}',
    '.P-toast.P-danger{border-color:#d93636}.P-toast.P-warning{border-color:#e8a33d}.P-toast.P-success{border-color:#2e9d57}',
    '.P-toast a{display:block;font-weight:700;color:#1f3a5f;text-decoration:none;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.P-toast button{all:unset;float:right;cursor:pointer;color:#888;font-size:16px;line-height:1;margin-left:8px}',
    '@keyframes P-in{from{transform:translateX(30px);opacity:0}to{transform:none;opacity:1}}',
    '.P-follow{all:unset;display:inline-flex;align-items:center;gap:6px;cursor:pointer;border:1px solid #9fb4cf;color:#1f3a5f;background:#f2f6fb;border-radius:6px;padding:5px 10px;font:600 13px/1.2 system-ui,sans-serif;margin:0 0 10px}',
    '.P-follow[aria-pressed="true"]{background:#1f3a5f;color:#fff;border-color:#1f3a5f}',
    '.P-follow-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
    '.P-follow-row label{font:12px system-ui,sans-serif;color:#444;margin:0 0 10px}',
    '.P-follow-row input{width:84px;padding:3px 6px;border:1px solid #bbc;border-radius:4px;font-size:13px;margin-left:4px}',
    '.P-panel{position:fixed;left:16px;bottom:62px;z-index:2147482001;width:380px;max-width:calc(100vw - 32px);max-height:70vh;overflow:auto;background:#fff;color:#222;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25);font:13px/1.4 system-ui,sans-serif;padding:12px}',
    '.P-panel h4{margin:0 0 8px;font:700 15px system-ui,sans-serif;color:#1f3a5f;display:flex;justify-content:space-between}',
    '.P-panel h4 button{all:unset;cursor:pointer;color:#888;font-size:18px}',
    '.P-row{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:7px 0;border-top:1px solid #eef1f5}',
    '.P-row a{color:#1f3a5f;font-weight:600;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.P-row small{color:#666}',
    '.P-row .P-x{all:unset;cursor:pointer;color:#999;grid-row:span 2;align-self:center;font-size:16px;padding:0 4px}',
    '.P-tag{display:inline-block;border-radius:4px;padding:0 5px;font-size:11px;font-weight:700;margin-right:4px}',
    '.P-tag.P-outbid,.P-tag.P-lost{background:#fde3e3;color:#a12020}.P-tag.P-ok,.P-tag.P-won{background:#e2f4e8;color:#1d6e3b}',
    '.P-tag.P-watch,.P-tag.P-wait,.P-tag.P-ended{background:#eef1f5;color:#445}',
    '.P-settings{border-top:1px solid #dde3ea;margin-top:8px;padding-top:8px;display:grid;gap:6px}',
    '.P-settings label{display:flex;align-items:center;gap:6px}',
    '.P-settings input[type=text]{width:90px;padding:2px 5px;border:1px solid #bbc;border-radius:4px}',
    '.P-empty{color:#777;padding:6px 0}',
    '.P-note{color:#888;font-size:11px}'
  ].join('\n');

  function start(win, doc, config) {
    config = config || CONFIG;
    var P = config.cssPrefix;
    var S = config.storagePrefix;
    var ls = win.localStorage;
    var tabId = Math.random().toString(36).slice(2);
    var nextCheck = {};      // itemId -> time of next check (leader only)
    var inFlight = {};
    var audioCtx = null;

    function read(key, fallback) {
      try { var v = JSON.parse(ls.getItem(S + key)); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; }
    }
    function write(key, value) { try { ls.setItem(S + key, JSON.stringify(value)); } catch (e) { /* full */ } }
    function items() { return read('items', {}); }
    function saveItems(v) { write('items', v); renderFab(); renderPanel(); renderFollow(); }
    function prefs() {
      var p = read('prefs', {});
      var out = {};
      Object.keys(DEFAULT_PREFS).forEach(function (k) { out[k] = p[k] === undefined ? DEFAULT_PREFS[k] : p[k]; });
      return out;
    }
    function updateItem(itemId, fn) {
      var all = items();
      var r = all[itemId];
      var next = fn(r ? r : null);
      if (next) all[itemId] = next; else delete all[itemId];
      saveItems(all);
      return next;
    }

    var style = doc.createElement('style');
    style.textContent = STYLE.replace(/P-/g, P + '-');
    (doc.head || doc.documentElement).appendChild(style);

    function el(tag, cls, text) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls.split(' ').map(function (c) { return P + '-' + c; }).join(' ');
      if (text !== undefined) e.textContent = text;
      return e;
    }

    // --- Recording bids placed in this browser (read-only) ------------------
    function recordBid(found) {
      if (!found) return;
      updateItem(found.itemId, function (r) {
        r = r || { itemId: found.itemId, fired: {}, lastPrice: null, lastBids: null };
        r.maxBid = Math.max(found.bidAmount, typeof r.maxBid === 'number' ? r.maxBid : 0);
        r.source = 'bid';
        r.ended = false;
        r.ownBidPending = true;   // the next price rise is probably ours
        r.addedAt = r.addedAt || Date.now();
        return r;
      });
      nextCheck[found.itemId] = 0;
      toast({ level: 'success', itemId: found.itemId, title: titleFor(found.itemId), text: 'Bid recorded. You\'ll be alerted if you\'re outbid (your max ' + formatMoney(found.bidAmount) + ').' }, false);
    }

    (function watchBids() {
      var XHR = win.XMLHttpRequest;
      if (XHR && XHR.prototype && !XHR.prototype.__sgwtAlerts) {
        var open = XHR.prototype.open;
        var send = XHR.prototype.send;
        XHR.prototype.__sgwtAlerts = true;
        XHR.prototype.open = function (method, url) {
          try { this.__sgwtUrl = String(url); this.__sgwtMethod = String(method).toUpperCase(); } catch (e) { /* ignore */ }
          return open.apply(this, arguments);
        };
        XHR.prototype.send = function (body) {
          try {
            if (this.__sgwtMethod === 'POST' && config.placeBidPath.test(this.__sgwtUrl || '')) {
              var xhr = this;
              xhr.addEventListener('load', function () {
                try {
                  if (xhr.status >= 200 && xhr.status < 300) {
                    var text = xhr.responseType === '' || xhr.responseType === 'text' ? xhr.responseText : xhr.response;
                    recordBid(parsePlaceBid(body, text));
                  }
                } catch (e) { /* never interfere */ }
              });
            }
          } catch (e) { /* never interfere */ }
          return send.apply(this, arguments);
        };
      }
      if (typeof win.fetch === 'function' && !win.fetch.__sgwtAlerts) {
        var origFetch = win.fetch;
        var wrapped = function (input, init) {
          var p = origFetch.apply(this, arguments);
          try {
            var url = typeof input === 'string' ? input : input && input.url;
            var method = (init && init.method) || (input && input.method) || 'GET';
            if (String(method).toUpperCase() === 'POST' && config.placeBidPath.test(url || '') && init && typeof init.body === 'string') {
              p.then(function (res) {
                if (res && res.ok) res.clone().text().then(function (t) { recordBid(parsePlaceBid(init.body, t)); }, function () {});
              }, function () {});
            }
          } catch (e) { /* never interfere */ }
          return p;
        };
        wrapped.__sgwtAlerts = true;
        win.fetch = wrapped;
      }
    })();

    function titleFor(itemId) {
      var r = items()[itemId];
      if (r && r.title) return r.title;
      var h = doc.querySelector('h1');
      return config.itemPathRegex.test(win.location.pathname) && h ? h.textContent.trim() : 'Item ' + itemId;
    }

    // --- Alerts ---------------------------------------------------------------
    var toastBox = null;
    function toast(ev, broadcast) {
      if (broadcast) write('event', { ev: ev, t: Date.now(), from: tabId });
      showToast(ev);
    }

    function showToast(ev) {
      if (!doc.body) return;
      if (!toastBox || !doc.body.contains(toastBox)) {
        toastBox = el('div', 'toasts');
        toastBox.setAttribute('role', 'status');
        toastBox.setAttribute('aria-live', 'polite');
        doc.body.appendChild(toastBox);
      }
      var t = el('div', 'toast ' + (ev.level || 'info'));
      var x = el('button', null, '×');
      x.type = 'button';
      x.setAttribute('aria-label', 'Dismiss');
      x.addEventListener('click', function () { t.remove(); });
      var a = doc.createElement('a');
      a.href = '/item/' + ev.itemId;
      a.textContent = ev.title || 'Item ' + ev.itemId;
      t.appendChild(x);
      t.appendChild(a);
      t.appendChild(doc.createTextNode(ev.text));
      toastBox.appendChild(t);
      win.setTimeout(function () { t.remove(); }, ev.level === 'danger' ? config.toastMs * 3 : config.toastMs);
    }

    function beep(level) {
      if (!prefs().sound) return;
      try {
        var Ctx = win.AudioContext || win.webkitAudioContext;
        if (!Ctx) return;
        audioCtx = audioCtx || new Ctx();
        var notes = level === 'danger' ? [880, 660, 880] : level === 'warning' ? [740, 740] : [660];
        notes.forEach(function (f, i) {
          var o = audioCtx.createOscillator();
          var g = audioCtx.createGain();
          var t0 = audioCtx.currentTime + i * 0.18;
          o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(0.15, t0 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
          o.connect(g).connect(audioCtx.destination);
          o.start(t0);
          o.stop(t0 + 0.16);
        });
      } catch (e) { /* audio blocked until the page is clicked */ }
    }

    function desktop(ev) {
      if (!prefs().desktop || typeof win.Notification !== 'function' || win.Notification.permission !== 'granted') return;
      try {
        var n = new win.Notification(ev.title || 'ShopGoodwill', { body: ev.text, tag: 'sgwt-' + ev.itemId + '-' + ev.type });
        n.onclick = function () { win.focus(); win.location.href = '/item/' + ev.itemId; };
      } catch (e) { /* not allowed */ }
    }

    win.addEventListener('storage', function (e) {
      if (e.key === S + 'event' && e.newValue) {
        try {
          var m = JSON.parse(e.newValue);
          if (m.from !== tabId && Date.now() - m.t < 30000) { showToast(m.ev); if (!doc.hidden) beep(m.ev.level); }
        } catch (err) { /* ignore */ }
      }
      if (e.key === S + 'items') { renderFab(); renderPanel(); renderFollow(); }
    });

    // --- Checking (one tab at a time) -------------------------------------------
    function isLeader() {
      var lock = read('leader', null);
      var now = Date.now();
      if (shouldLead(lock, tabId, now, config.leaderTtlMs)) {
        write('leader', { id: tabId, t: now });
        return true;
      }
      return false;
    }

    function check(itemId) {
      inFlight[itemId] = true;
      win.fetch(config.apiBase + 'ItemDetail/GetItemDetailModelByItemId/' + itemId)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (d) {
          var fetchedAt = Date.now();
          var all = items();
          var rec = all[itemId];
          if (!rec) return;
          var out = evaluate(rec, d, fetchedAt, fetchedAt, prefs());
          all[itemId] = out.record;
          saveItems(all);
          out.events.forEach(function (ev) {
            toast(ev, true);
            beep(ev.level);
            desktop(ev);
          });
          var left = out.record.endAt ? out.record.endAt - Date.now() : null;
          nextCheck[itemId] = out.record.ended ? Infinity : Date.now() + pollEvery(left, config);
        })
        .catch(function () { nextCheck[itemId] = Date.now() + 30000; })
        .then(function () { delete inFlight[itemId]; });
    }

    function loop() {
      if (!isLeader()) return;
      var all = items();
      var now = Date.now();
      var changed = false;
      Object.keys(all).forEach(function (id) {
        var r = all[id];
        if (r.ended) {
          if (r.endAt && now - r.endAt > config.keepEndedMs) { delete all[id]; changed = true; }
          return;
        }
        if (inFlight[id]) return;
        if (nextCheck[id] === undefined) {
          var left = r.endAt ? r.endAt - now : null;
          // Recheck soon after a new tab takes over, sooner when ending.
          nextCheck[id] = now + Math.min(pollEvery(left, config), 10000);
          if (r.lastPrice === null || r.lastPrice === undefined) nextCheck[id] = now;
        }
        if (now >= nextCheck[id]) check(id);
      });
      if (changed) saveItems(all);
    }

    win.setInterval(loop, config.loopMs);
    win.addEventListener('pagehide', function () {
      var lock = read('leader', null);
      if (lock && lock.id === tabId) { try { ls.removeItem(S + 'leader'); } catch (e) { /* ignore */ } }
    });

    // --- Follow button on item pages ------------------------------------------------
    var followRow = null;
    function renderFollow() {
      var m = config.itemPathRegex.exec(win.location.pathname);
      var panel = doc.querySelector(config.itemPanelSelector);
      if (!m || !panel) { if (followRow) { followRow.remove(); followRow = null; } return; }
      var id = m[1];
      if (!followRow || !panel.contains(followRow) || followRow.getAttribute('data-item') !== id) {
        if (followRow) followRow.remove();
        followRow = el('div', 'follow-row');
        followRow.setAttribute('data-item', id);
        var btn = el('button', 'follow');
        btn.type = 'button';
        var label = doc.createElement('label');
        label.textContent = 'My max bid $';
        var input = doc.createElement('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.placeholder = 'optional';
        input.setAttribute('aria-label', 'My max bid in dollars (optional)');
        label.appendChild(input);
        btn.addEventListener('click', function () {
          var following = !!items()[id];
          if (following) {
            updateItem(id, function () { return null; });
          } else {
            var max = parseFloat(String(input.value).replace(/[$,]/g, ''));
            updateItem(id, function () {
              return { itemId: id, title: titleFor(id), maxBid: max > 0 ? max : null, source: 'follow', fired: {}, lastPrice: null, lastBids: null, addedAt: Date.now() };
            });
            nextCheck[id] = 0;
            primeAudio();
          }
        });
        input.addEventListener('change', function () {
          var max = parseFloat(String(input.value).replace(/[$,]/g, ''));
          if (!items()[id]) return;
          updateItem(id, function (r) { r.maxBid = max > 0 ? max : null; return r; });
        });
        followRow.appendChild(btn);
        followRow.appendChild(label);
        panel.insertBefore(followRow, panel.firstChild);
      }
      var rec = items()[id];
      var b = followRow.querySelector('button');
      b.setAttribute('aria-pressed', rec ? 'true' : 'false');
      b.innerHTML = BELL;
      b.appendChild(doc.createTextNode(rec ? (rec.source === 'bid' ? 'Alerts on (you bid)' : 'Following') : 'Alert me'));
      b.title = rec ? 'Click to stop alerts for this item' : 'Get alerts for new bids, outbids and the last minutes';
      var inp = followRow.querySelector('input');
      if (doc.activeElement !== inp) inp.value = rec && typeof rec.maxBid === 'number' ? rec.maxBid.toFixed(2) : inp.value;
    }

    // Browsers only allow sound after a click on the page.
    function primeAudio() {
      if (!prefs().sound) return;
      try {
        var Ctx = win.AudioContext || win.webkitAudioContext;
        if (Ctx) { audioCtx = audioCtx || new Ctx(); if (audioCtx.state === 'suspended') audioCtx.resume(); }
      } catch (e) { /* ignore */ }
    }
    doc.addEventListener('click', primeAudio, { once: true, capture: true });

    // --- Floating bell + overview panel --------------------------------------------
    var fab = null;
    var panelEl = null;
    function renderFab() {
      if (!doc.body) return;
      var all = items();
      var ids = Object.keys(all);
      if (!fab) {
        fab = el('button', 'fab');
        fab.type = 'button';
        fab.addEventListener('click', function () { if (panelEl) closePanel(); else openPanel(); });
      }
      if (!doc.body.contains(fab)) doc.body.appendChild(fab);
      var active = ids.filter(function (id) { return !all[id].ended; });
      var outbid = active.filter(function (id) { return statusOf(all[id]).kind === 'outbid'; }).length;
      fab.innerHTML = BELL;
      fab.appendChild(doc.createTextNode('Bid alerts'));
      var count = el('b', null, outbid ? outbid + ' outbid' : String(active.length));
      fab.appendChild(count);
      fab.classList.toggle(P + '-has-outbid', outbid > 0);
      fab.title = active.length + ' auction(s) followed';
    }

    function closePanel() { if (panelEl) { panelEl.remove(); panelEl = null; } }
    function openPanel() { panelEl = el('div', 'panel'); panelEl.setAttribute('role', 'dialog'); panelEl.setAttribute('aria-label', 'Bid alerts'); doc.body.appendChild(panelEl); renderPanel(); }

    function renderPanel() {
      if (!panelEl) return;
      var all = items();
      var now = Date.now();
      var p = prefs();
      panelEl.textContent = '';
      var h = el('h4', null, 'Bid alerts');
      var close = el('button', null, '×');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close');
      close.addEventListener('click', closePanel);
      h.appendChild(close);
      panelEl.appendChild(h);

      var ids = Object.keys(all).sort(function (a, b) {
        var ea = all[a].ended ? 1 : 0, eb = all[b].ended ? 1 : 0;
        return ea - eb || (all[a].endAt || 9e15) - (all[b].endAt || 9e15);
      });
      if (!ids.length) panelEl.appendChild(el('div', 'empty', 'Nothing followed yet. Bids you place are added automatically, or click "Alert me" on an item page.'));
      ids.forEach(function (id) {
        var r = all[id];
        var st = statusOf(r, now);
        var row = el('div', 'row');
        var a = doc.createElement('a');
        a.href = '/item/' + id;
        a.textContent = r.title || 'Item ' + id;
        a.title = r.title || '';
        var x = el('button', 'x', '×');
        x.type = 'button';
        x.title = 'Stop following';
        x.addEventListener('click', function () { updateItem(id, function () { return null; }); });
        var info = doc.createElement('small');
        info.appendChild(el('span', 'tag ' + st.kind, st.text));
        var bits = [];
        if (typeof r.lastPrice === 'number') bits.push(formatMoney(r.lastPrice));
        if (typeof r.maxBid === 'number') bits.push('max ' + formatMoney(r.maxBid));
        if (r.endAt && !r.ended) bits.push(timeLeft(r.endAt - now));
        info.appendChild(doc.createTextNode(bits.join(' · ')));
        row.appendChild(a);
        row.appendChild(x);
        row.appendChild(info);
        panelEl.appendChild(row);
      });

      var s = el('div', 'settings');
      s.appendChild(checkbox('Sound', p.sound, function (v) { setPref('sound', v); if (v) primeAudio(); }));
      s.appendChild(checkbox('Alerts for new bids', p.newBidAlerts, function (v) { setPref('newBidAlerts', v); }));
      var desk = checkbox('Desktop notifications', p.desktop && win.Notification && win.Notification.permission === 'granted', function (v, input) {
        if (!v) { setPref('desktop', false); return; }
        if (typeof win.Notification !== 'function') { input.checked = false; return; }
        win.Notification.requestPermission().then(function (perm) {
          setPref('desktop', perm === 'granted');
          input.checked = perm === 'granted';
        });
      });
      s.appendChild(desk);
      var endLabel = doc.createElement('label');
      endLabel.textContent = 'Warn before the end (minutes):';
      var endInput = doc.createElement('input');
      endInput.type = 'text';
      endInput.value = p.endingMinutes.join(', ');
      endInput.addEventListener('change', function () {
        var list = endInput.value.split(/[ ,]+/).map(Number).filter(function (n) { return n > 0 && n <= 1440; });
        setPref('endingMinutes', list);
        endInput.value = list.join(', ');
      });
      endLabel.appendChild(endInput);
      s.appendChild(endLabel);
      s.appendChild(el('div', 'note', 'Alerts work while a ShopGoodwill tab is open. Prices are checked more often as auctions near their end.'));
      panelEl.appendChild(s);
    }

    function checkbox(text, checked, onChange) {
      var l = doc.createElement('label');
      var i = doc.createElement('input');
      i.type = 'checkbox';
      i.checked = !!checked;
      i.addEventListener('change', function () { onChange(i.checked, i); });
      l.appendChild(i);
      l.appendChild(doc.createTextNode(text));
      return l;
    }

    function setPref(k, v) { var p = read('prefs', {}); p[k] = v; write('prefs', p); }

    function timeLeft(ms) {
      if (ms <= 0) return 'ending';
      var m = Math.floor(ms / 60000);
      if (m < 60) return m + 'm left';
      var h = Math.floor(m / 60);
      if (h < 48) return h + 'h ' + (m % 60) + 'm left';
      return Math.floor(h / 24) + 'd left';
    }

    // Keep the button and panel present as Angular redraws the page.
    var timer = null;
    new win.MutationObserver(function () {
      if (timer === null) timer = win.setTimeout(function () { timer = null; renderFab(); renderFollow(); }, 300);
    }).observe(doc.body, { childList: true, subtree: true });
    win.setInterval(function () { if (panelEl) renderPanel(); }, 15000);
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });

    renderFab();
    renderFollow();
    loop();

    return { loop: loop, toast: showToast, openPanel: openPanel };
  }

  return {
    CONFIG: CONFIG,
    DEFAULT_PREFS: DEFAULT_PREFS,
    formatMoney: formatMoney,
    endAt: endAt,
    pollEvery: pollEvery,
    parsePlaceBid: parsePlaceBid,
    evaluate: evaluate,
    statusOf: statusOf,
    shouldLead: shouldLead,
    start: start
  };
});
