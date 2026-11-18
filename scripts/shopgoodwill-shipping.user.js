// ==UserScript==
// @name         shopgoodwill.com tools - Shipping & Handling
// @namespace    https://github.com/maxhayim/shopgoodwill.com-tools
// @version      1.1.0
// @description  Shows estimated shipping & handling and the total cost for your ZIP code on ShopGoodwill search results and item pages.
// @author       maxhayim
// @license      MIT
// @match        https://shopgoodwill.com/*
// @match        https://www.shopgoodwill.com/*
// @run-at       document-idle
// @grant        none
// @homepageURL  https://github.com/maxhayim/shopgoodwill.com-tools
// @supportURL   https://github.com/maxhayim/shopgoodwill.com-tools/issues
// @updateURL    https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-shipping.user.js
// @downloadURL  https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-shipping.user.js
// ==/UserScript==

/*
 * shopgoodwill.com tools - Shipping & Handling
 * Copyright (c) 2026 maxhayim. MIT License.
 *
 * Asks ShopGoodwill's own shipping calculator (the one behind "Estimate
 * Shipping" on item pages) for your ZIP code and shows the result on every
 * search result card and on the item page, with the total (price + S&H).
 *
 * Your ZIP code is stored only in this browser (localStorage on
 * shopgoodwill.com) and is sent only to ShopGoodwill's API.
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
    country: 'US',

    // Search result cards.
    cardSelector: '.feat-item',
    cardNameSelector: 'a.feat-item_name',
    cardPriceSelector: '.feat-item_price',

    // Item page: our box goes at the top of the bidding panel.
    itemPathRegex: /^\/item\/(\d+)/,
    itemPanelSelector: 'app-bidding-control',

    maxConcurrentRequests: 2,
    cacheTtlMs: 6 * 60 * 60 * 1000,
    rescanDelayMs: 250,
    storagePrefix: 'sgwTools.shipping.',
    cssPrefix: 'sgwt-ship'
  };

  // ---------------------------------------------------------------------------
  // Pure helpers (tested in Node).
  // ---------------------------------------------------------------------------
  function isValidZip(zip) {
    return typeof zip === 'string' && /^\d{5}$/.test(zip.trim());
  }

  function formatMoney(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '';
    return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function toNumber(s) {
    var n = parseFloat(String(s).replace(/[$,\s]/g, ''));
    return isFinite(n) ? n : null;
  }

  function stripTags(html) {
    return String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?p\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
      .replace(/[ \t]+/g, ' ');
  }

  /**
   * Parses the HTML that ItemDetail/CalculateShipping returns, e.g.
   *   <p>Shipped From: Phoenix, AZ 85043</p> ... <p>Shipping: <span>$13.44</span></p>
   *   <p>Handling: $3.50</p><p><b>Total Shipping and Handling: $16.94</b></p>
   * or an error ("There was an error calculating your shipping cost: ...").
   */
  function parseShippingHtml(html) {
    if (typeof html !== 'string' || !html) return { ok: false, error: 'Empty response' };
    var text = stripTags(html);
    var total = /Total Shipping and Handling:\s*\$?([\d,]+(?:\.\d+)?)/i.exec(text);
    if (!total) {
      var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      var i = lines.findIndex(function (l) { return /error calculating/i.test(l); });
      var msg = i >= 0 && lines[i + 1] ? lines[i + 1] : (lines[0] || 'Unknown error');
      return { ok: false, error: msg, noOptions: /No valid shipping options/i.test(text) };
    }
    var ship = /(?:^|\n)\s*Shipping:\s*\$([\d,]+(?:\.\d+)?)/i.exec(text);
    var hand = /Handling:\s*\$([\d,]+(?:\.\d+)?)/i.exec(text);
    var from = /Shipped From:\s*([^\n]+)/i.exec(text);
    var service = /Shipping:\s*([A-Za-z][^\n$]*)/i.exec(text);
    return {
      ok: true,
      total: toNumber(total[1]),
      shipping: ship ? toNumber(ship[1]) : null,
      handling: hand ? toNumber(hand[1]) : null,
      from: from ? from[1].trim() : null,
      service: service ? service[1].trim() : null
    };
  }

  /**
   * Turns item details (+ a shipping result if one was fetched) into what we
   * show. Returns {kind: 'ship'|'pickup'|'error', label, total, title}.
   */
  function describeEstimate(detail, ship, zip) {
    var price = detail && typeof detail.currentPrice === 'number' ? detail.currentPrice : null;
    if (detail && detail.pickupOnly) {
      var handling = detail.handlingPrice || 0;
      var where = [detail.pickupCity, detail.pickupState].filter(Boolean).join(', ');
      return {
        kind: 'pickup',
        label: 'Pickup only' + (where ? ' (' + where + ')' : '') +
          (handling ? ' + ' + formatMoney(handling) + ' handling' : ''),
        short: 'Pickup' + (where ? ' · ' + where : ' only'),
        total: price !== null ? price + handling : null,
        title: 'This item cannot be shipped. It must be picked up' + (where ? ' in ' + where : '') + '.' +
          (handling ? '\nHandling: ' + formatMoney(handling) + ' (included in the total).' : '')
      };
    }
    if (!ship || !ship.ok) {
      return {
        kind: 'error',
        label: 'S&H unavailable',
        short: 'S&H unavailable',
        total: null,
        title: (ship && ship.error) || 'Shipping could not be estimated.'
      };
    }
    var parts = [];
    if (ship.shipping !== null) parts.push('Shipping ' + formatMoney(ship.shipping));
    if (ship.handling !== null) parts.push('Handling ' + formatMoney(ship.handling));
    var title = 'Estimated to ZIP ' + zip + (parts.length ? ': ' + parts.join(' + ') : '') +
      (ship.from ? '\nShips from ' + ship.from : '') +
      (ship.service ? '\n' + ship.service : '') +
      '\nEstimate from ShopGoodwill; the final cost is set at checkout.';
    return {
      kind: 'ship',
      label: 'S&H ' + formatMoney(ship.total),
      short: 'S&H ' + formatMoney(ship.total),
      total: price !== null ? price + ship.total : null,
      title: title
    };
  }

  function itemIdFromHref(href) {
    var m = /\/item\/(\d+)/.exec(href || '');
    return m ? m[1] : null;
  }

  function itemIdFromCard(card, config) {
    config = config || CONFIG;
    var a = card.querySelector(config.cardNameSelector);
    if (!a) return null;
    if (a.id && /^\d+$/.test(a.id)) return a.id;
    return itemIdFromHref(a.getAttribute('href'));
  }

  // Runs async tasks with at most `limit` in flight.
  function createQueue(limit) {
    var active = 0;
    var waiting = [];
    function next() {
      if (active >= limit || !waiting.length) return;
      var job = waiting.shift();
      active++;
      Promise.resolve().then(job.fn).then(job.resolve, job.reject).then(function () {
        active--;
        next();
      });
    }
    return function (fn) {
      return new Promise(function (resolve, reject) {
        waiting.push({ fn: fn, resolve: resolve, reject: reject });
        next();
      });
    };
  }

  // Small cache over a Storage-like object ({getItem, setItem}).
  function createCache(storage, prefix, ttlMs, now) {
    now = now || function () { return Date.now(); };
    return {
      get: function (key) {
        try {
          var raw = storage.getItem(prefix + key);
          if (!raw) return null;
          var v = JSON.parse(raw);
          if (now() - v.t > ttlMs) return null;
          return v.d;
        } catch (e) { return null; }
      },
      set: function (key, data) {
        try { storage.setItem(prefix + key, JSON.stringify({ t: now(), d: data })); } catch (e) { /* full */ }
      }
    };
  }

  // ---------------------------------------------------------------------------
  // API.
  // ---------------------------------------------------------------------------
  function createApi(win, config) {
    var fetchFn = win.fetch.bind(win);
    return {
      itemDetail: function (itemId) {
        return fetchFn(config.apiBase + 'ItemDetail/GetItemDetailModelByItemId/' + encodeURIComponent(itemId))
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
      },
      shipping: function (itemId, zip) {
        return fetchFn(config.apiBase + 'ItemDetail/CalculateShipping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: Number(itemId), country: config.country, province: null,
            zipCode: zip, quantity: 1, clientIP: ''
          })
        }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
      }
    };
  }

  // Only the fields we use are kept, so the cache stays small.
  function slimDetail(d) {
    return {
      currentPrice: d.currentPrice, pickupOnly: !!d.pickupOnly, handlingPrice: d.handlingPrice,
      pickupCity: d.pickupCity, pickupState: d.pickupState, title: d.title
    };
  }

  // ---------------------------------------------------------------------------
  // Page.
  // ---------------------------------------------------------------------------
  var STYLE = [
    '.P-line{display:block;font-size:.85rem;line-height:1.3;color:#2a5d9f;font-weight:600;margin:.15rem 0}',
    '.P-line .P-total{color:#333;font-weight:700;margin-left:.35rem}',
    '.P-line.P-pickup{color:#8a5a00}',
    '.P-line.P-error,.P-line.P-wait{color:#888;font-weight:400}',
    '.P-line button{all:unset;cursor:pointer;text-decoration:underline;color:#2a5d9f;font-weight:400;font-size:.8rem;margin-left:.35rem}',
    '.P-box{border:1px solid #d6e0ee;background:#f5f8fc;border-radius:6px;padding:.6rem .75rem;margin:0 0 1rem}',
    '.P-box .P-line{font-size:1rem;margin:0}',
    '.P-box .P-detail{font-size:.8rem;color:#555;white-space:pre-line;margin-top:.25rem}',
    '.P-panel{position:fixed;z-index:2147483000;right:16px;bottom:16px;background:#fff;border:1px solid #ccd;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:12px 14px;font:14px/1.4 system-ui,sans-serif;color:#222;width:250px}',
    '.P-panel b{display:block;margin-bottom:6px}',
    '.P-panel input{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #bbc;border-radius:4px;font-size:15px;margin:4px 0 8px}',
    '.P-panel .P-row{display:flex;gap:8px;justify-content:flex-end}',
    '.P-panel button{padding:5px 12px;border-radius:4px;border:1px solid #2a5d9f;background:#2a5d9f;color:#fff;cursor:pointer}',
    '.P-panel button.P-secondary{background:#fff;color:#2a5d9f}',
    '.P-panel .P-msg{color:#b00020;font-size:12px;min-height:1em}'
  ].join('\n');

  function start(win, doc, config) {
    config = config || CONFIG;
    var P = config.cssPrefix;
    var storage = win.localStorage;
    var cache = createCache(storage, config.storagePrefix + 'cache.', config.cacheTtlMs);
    var api = createApi(win, config);
    var queue = createQueue(config.maxConcurrentRequests);
    var pending = {};

    var style = doc.createElement('style');
    style.textContent = STYLE.replace(/\.P-/g, '.' + P + '-');
    (doc.head || doc.documentElement).appendChild(style);

    function getZip() {
      var z = storage.getItem(config.storagePrefix + 'zip');
      return isValidZip(z) ? z : null;
    }

    function estimate(itemId, zip) {
      var key = itemId + ':' + zip;
      var hit = cache.get(key);
      if (hit) return Promise.resolve(hit);
      if (pending[key]) return pending[key];
      pending[key] = queue(function () {
        return api.itemDetail(itemId).then(function (d) {
          var detail = slimDetail(d);
          if (detail.pickupOnly) return { detail: detail, ship: null };
          return api.shipping(itemId, zip).then(function (html) {
            return { detail: detail, ship: parseShippingHtml(html) };
          });
        });
      }).then(function (res) {
        // Don't cache transient failures.
        if (!res.ship || res.ship.ok || res.ship.noOptions) cache.set(key, res);
        delete pending[key];
        return res;
      }, function (err) {
        delete pending[key];
        throw err;
      });
      return pending[key];
    }

    // --- ZIP panel ---------------------------------------------------------
    var panel = null;
    function openZipPanel() {
      if (panel) { panel.querySelector('input').focus(); return; }
      panel = doc.createElement('div');
      panel.className = P + '-panel';
      panel.setAttribute('role', 'dialog');
      panel.innerHTML = '<b>Shipping estimate ZIP code</b>' +
        '<div>US ZIP code to estimate shipping to:</div>' +
        '<input inputmode="numeric" maxlength="5" autocomplete="postal-code" placeholder="e.g. 33139">' +
        '<div class="' + P + '-msg"></div>' +
        '<div class="' + P + '-row"><button type="button" class="' + P + '-secondary">Cancel</button>' +
        '<button type="button">Save</button></div>';
      var input = panel.querySelector('input');
      input.value = getZip() || '';
      var buttons = panel.querySelectorAll('button');
      function close() { if (panel) { panel.remove(); panel = null; } }
      function save() {
        var z = input.value.trim();
        if (!isValidZip(z)) {
          panel.querySelector('.' + P + '-msg').textContent = 'Enter a 5-digit US ZIP code.';
          return;
        }
        storage.setItem(config.storagePrefix + 'zip', z);
        close();
        refreshAll();
      }
      buttons[0].addEventListener('click', close);
      buttons[1].addEventListener('click', save);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') close();
      });
      doc.body.appendChild(panel);
      input.focus();
    }

    function zipButton(text) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openZipPanel();
      });
      return b;
    }

    // --- Rendering ---------------------------------------------------------
    function render(line, res, zip, withDetail) {
      var est = describeEstimate(res.detail, res.ship, zip);
      line.className = P + '-line ' + P + '-' + est.kind;
      line.textContent = withDetail ? est.label : est.short;
      line.title = est.title;
      if (est.total !== null) {
        var t = doc.createElement('span');
        t.className = P + '-total';
        t.textContent = '· Total ' + formatMoney(est.total);
        line.appendChild(t);
      }
      if (withDetail) {
        var box = line.parentElement;
        var d = box.querySelector('.' + P + '-detail');
        if (d) d.textContent = est.title;
        line.appendChild(zipButton('change ZIP'));
      }
    }

    function fill(line, itemId, withDetail) {
      var zip = getZip();
      line.textContent = '';
      if (!zip) {
        line.className = P + '-line ' + P + '-wait';
        line.textContent = 'S&H:';
        line.appendChild(zipButton('set ZIP for estimate'));
        return;
      }
      line.className = P + '-line ' + P + '-wait';
      line.textContent = 'S&H: estimating…';
      line.setAttribute('data-zip', zip);
      estimate(itemId, zip).then(function (res) {
        if (line.getAttribute('data-zip') === zip) render(line, res, zip, withDetail);
      }, function () {
        line.className = P + '-line ' + P + '-error';
        line.textContent = 'S&H unavailable';
        line.title = 'ShopGoodwill did not answer. Reload to try again.';
      });
    }

    // Cards are only estimated when they scroll into view.
    var io = typeof win.IntersectionObserver === 'function'
      ? new win.IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          io.unobserve(e.target);
          fill(e.target, e.target.getAttribute('data-item'), false);
        });
      }, { rootMargin: '300px' })
      : null;

    function processCard(card) {
      var itemId = itemIdFromCard(card, config);
      if (!itemId) return;
      var existing = card.querySelector('.' + P + '-line');
      if (existing && existing.getAttribute('data-item') === itemId) return;
      if (existing) existing.remove();
      var price = card.querySelector(config.cardPriceSelector);
      if (!price) return;
      var line = doc.createElement('div');
      line.className = P + '-line ' + P + '-wait';
      line.setAttribute('data-item', itemId);
      price.insertAdjacentElement('afterend', line);
      if (io) io.observe(line); else fill(line, itemId, false);
    }

    function processItemPage() {
      var m = config.itemPathRegex.exec(win.location.pathname);
      if (!m) return;
      var panelEl = doc.querySelector(config.itemPanelSelector);
      if (!panelEl) return;
      var box = panelEl.querySelector('.' + P + '-box');
      if (box && box.getAttribute('data-item') === m[1]) return;
      if (box) box.remove();
      box = doc.createElement('div');
      box.className = P + '-box';
      box.setAttribute('data-item', m[1]);
      var line = doc.createElement('div');
      var detail = doc.createElement('div');
      detail.className = P + '-detail';
      box.appendChild(line);
      box.appendChild(detail);
      panelEl.insertBefore(box, panelEl.firstChild);
      fill(line, m[1], true);
    }

    function scan() {
      timer = null;
      var cards = doc.querySelectorAll(config.cardSelector);
      for (var i = 0; i < cards.length; i++) processCard(cards[i]);
      processItemPage();
    }

    function refreshAll() {
      var lines = doc.querySelectorAll('.' + P + '-line[data-item]');
      for (var i = 0; i < lines.length; i++) {
        lines[i].removeAttribute('data-zip');
        if (io) io.observe(lines[i]); else fill(lines[i], lines[i].getAttribute('data-item'), false);
      }
      var box = doc.querySelector('.' + P + '-box');
      if (box) box.remove();
      processItemPage();
    }

    var timer = null;
    function schedule() {
      if (timer === null) timer = win.setTimeout(scan, config.rescanDelayMs);
    }

    scan();
    var observer = new win.MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var t = mutations[i].target;
        // Ignore our own changes.
        if (t && t.closest && (t.closest('.' + P + '-line') || t.closest('.' + P + '-box') || t.closest('.' + P + '-panel'))) continue;
        schedule();
        return;
      }
    });
    observer.observe(doc.body, { childList: true, subtree: true });

    return { scan: scan, openZipPanel: openZipPanel, stop: function () { observer.disconnect(); if (io) io.disconnect(); } };
  }

  return {
    CONFIG: CONFIG,
    isValidZip: isValidZip,
    formatMoney: formatMoney,
    parseShippingHtml: parseShippingHtml,
    describeEstimate: describeEstimate,
    itemIdFromHref: itemIdFromHref,
    itemIdFromCard: itemIdFromCard,
    createQueue: createQueue,
    createCache: createCache,
    slimDetail: slimDetail,
    start: start
  };
});
