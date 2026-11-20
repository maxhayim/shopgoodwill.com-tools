// ==UserScript==
// @name         shopgoodwill.com tools - Deal Check
// @namespace    https://github.com/maxhayim/shopgoodwill.com-tools
// @version      2.1.0
// @description  Tells you if a ShopGoodwill item is worth the price: adds up the next bid, shipping & handling and sales tax, compares it with what the item is worth to you or sells for, and shows the most you should bid. Works on desktop and mobile.
// @author       maxhayim
// @license      MIT
// @match        https://shopgoodwill.com/*
// @match        https://www.shopgoodwill.com/*
// @run-at       document-idle
// @grant        none
// @homepageURL  https://github.com/maxhayim/shopgoodwill.com-tools
// @supportURL   https://github.com/maxhayim/shopgoodwill.com-tools/issues
// @updateURL    https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-deal-check.user.js
// @downloadURL  https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-deal-check.user.js
// ==/UserScript==

/*
 * shopgoodwill.com tools - Deal Check
 * Copyright (c) 2026 maxhayim. MIT License.
 *
 * Adds a "Deal check" box under the bidding panel on item pages. You enter
 * what the item is worth to you (To keep) or what it sells for elsewhere
 * (To resell). The box works out what you would really pay (next bid +
 * shipping & handling + sales tax), gives a verdict, and shows the highest
 * bid that still makes it a good deal.
 *
 * Everything you enter stays in this browser (localStorage on
 * shopgoodwill.com). The only requests go to ShopGoodwill's own API, for the
 * item's price and its shipping estimate to your ZIP code.
 *
 * The same file runs in Tampermonkey and in Node.js (for the tests).
 */
(function (factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    // Run once per page, even if the script is injected twice.
    if (window.__sgwtDealCheck) return;
    window.__sgwtDealCheck = true;
    api.start(window, document);
  }
})(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // CONFIG: page details, defaults and verdict thresholds.
  // ---------------------------------------------------------------------------
  var CONFIG = {
    apiBase: 'https://buyerapi.shopgoodwill.com/api/',
    country: 'US',
    itemPathRegex: /^\/item\/(\d+)/,
    itemPanelSelector: 'app-bidding-control',
    priceCheckButtonSelector: '.sgwt-pc-btn',

    storagePrefix: 'sgwTools.deal.',
    // Shared with the Shipping & Handling tool, so the ZIP is entered once.
    zipStorageKey: 'sgwTools.shipping.zip',
    // Saved values for items not opened for this long are forgotten.
    forgetAfterMs: 60 * 24 * 60 * 60 * 1000,

    refreshMs: 60 * 1000,
    rescanDelayMs: 300,
    cssPrefix: 'sgwt-deal',

    defaults: {
      mode: 'keep',     // 'keep' or 'resell'
      taxPct: 0,        // your sales tax, applied to the item and S&H
      feePct: 13.6,     // selling fees, as a share of the sale price
      feeFixed: 0.4,    // selling fee per order
      minProfit: 10,    // resell: least profit worth the effort, in dollars
      minReturnPct: 30  // resell: least profit as a share of what you pay
    },

    // To keep: what you pay as a share of what it's worth to you.
    keep: { great: 0.7, good: 0.9, fair: 1 }
  };

  var LABELS = {
    keep: { great: 'Great deal', good: 'Good deal', fair: 'Fair price', over: 'Not worth it' },
    resell: { great: 'Great flip', good: 'Worth flipping', fair: 'Thin margin', over: 'Would lose money' }
  };

  // ---------------------------------------------------------------------------
  // Pure helpers (tested in Node).
  // ---------------------------------------------------------------------------
  function toNumber(s) {
    if (typeof s === 'number') return isFinite(s) ? s : null;
    var t = String(s === null || s === undefined ? '' : s).replace(/[$,\s]/g, '');
    if (!/^-?\d*\.?\d+$/.test(t)) return null;
    var n = parseFloat(t);
    return isFinite(n) ? n : null;
  }

  function cents(n) {
    return Math.round(n * 100) / 100;
  }

  function formatMoney(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '';
    var neg = n < 0;
    var s = '$' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return neg ? '-' + s : s;
  }

  function formatPct(ratio) {
    return Math.round(ratio * 100) + '%';
  }

  // Settings with every missing or bad value replaced by its default.
  function readSettings(raw, defaults) {
    defaults = defaults || CONFIG.defaults;
    var s = {};
    var obj = null;
    try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { obj = null; }
    obj = obj && typeof obj === 'object' ? obj : {};
    Object.keys(defaults).forEach(function (k) {
      var v = obj[k];
      if (k === 'mode') s[k] = v === 'resell' || v === 'keep' ? v : defaults[k];
      else s[k] = typeof v === 'number' && isFinite(v) && v >= 0 ? v : defaults[k];
    });
    return s;
  }

  function parseTime(s) {
    var t = Date.parse(String(s || '').replace(/(\.\d{3})\d+/, '$1'));
    return isFinite(t) ? t : null;
  }

  /**
   * The price you would pay from the item details: the Buy It Now price for
   * buy-now-only listings, the next bid while an auction is open, the final
   * price once it has ended. endTime and serverTime are both Pacific without
   * a zone, so comparing them is safe.
   */
  function priceBasis(detail) {
    if (!detail) return null;
    var current = typeof detail.currentPrice === 'number' ? detail.currentPrice : null;
    if (detail.isAuction === false) {
      var bn = [detail.discountedBuyNowPrice, detail.buyNowPrice, current].filter(function (n) {
        return typeof n === 'number' && n > 0;
      })[0];
      return bn === undefined ? null : { price: bn, label: 'Buy It Now', ended: false, buyNow: true };
    }
    var end = parseTime(detail.endTime);
    var now = parseTime(detail.serverTime);
    if (end !== null && now !== null && now >= end) {
      return current === null ? null : { price: current, label: 'Final price', ended: true };
    }
    if (typeof detail.minimumBid === 'number' && detail.minimumBid > 0) {
      return { price: detail.minimumBid, label: 'Next bid', ended: false };
    }
    return current === null ? null : { price: current, label: 'Current price', ended: false };
  }

  /** What you pay in total: price + S&H, plus tax on both. */
  function totalCost(price, sh, taxPct) {
    sh = sh || 0;
    var tax = cents((price + sh) * (taxPct || 0) / 100);
    return { price: price, sh: sh, tax: tax, total: cents(price + sh + tax) };
  }

  /** Money left from a sale after selling fees and your shipping to the buyer. */
  function saleNet(salePrice, settings, outShip) {
    var fees = cents(salePrice * settings.feePct / 100 + (salePrice > 0 ? settings.feeFixed : 0));
    return { fees: fees, net: cents(salePrice - fees - (outShip || 0)) };
  }

  /**
   * The verdict for a total cost.
   *   keep:   value = what it's worth to you.
   *   resell: value = what it sells for; outShip = what you pay to ship it on.
   * Returns {level: great|good|fair|over, label, detail} or null without a value.
   */
  function judge(mode, total, value, settings, outShip, config) {
    config = config || CONFIG;
    if (typeof value !== 'number' || !(value > 0) || typeof total !== 'number') return null;
    var level, detail;
    if (mode === 'resell') {
      var sale = saleNet(value, settings, outShip);
      var profit = cents(sale.net - total);
      var ret = total > 0 ? profit / total : Infinity;
      var minRet = settings.minReturnPct / 100;
      if (profit >= settings.minProfit && ret >= minRet * 2 && profit >= settings.minProfit * 2) level = 'great';
      else if (profit >= settings.minProfit && ret >= minRet) level = 'good';
      else if (profit > 0) level = 'fair';
      else level = 'over';
      detail = profit >= 0
        ? 'Profit ' + formatMoney(profit) + (isFinite(ret) ? ' (' + formatPct(ret) + ' return)' : '') +
          ' after ' + formatMoney(sale.fees) + ' fees' + (outShip ? ' and ' + formatMoney(outShip) + ' shipping' : '')
        : 'You would lose ' + formatMoney(-profit) + ' after ' + formatMoney(sale.fees) + ' fees' +
          (outShip ? ' and ' + formatMoney(outShip) + ' shipping' : '');
      return { level: level, label: LABELS.resell[level], detail: detail, profit: profit };
    }
    var ratio = total / value;
    if (ratio <= config.keep.great) level = 'great';
    else if (ratio <= config.keep.good) level = 'good';
    else if (ratio <= config.keep.fair) level = 'fair';
    else level = 'over';
    var diff = cents(value - total);
    detail = diff >= 0
      ? 'You save ' + formatMoney(diff) + ' (' + formatPct(diff / value) + ')'
      : formatMoney(-diff) + ' more than it\'s worth to you';
    return { level: level, label: LABELS.keep[level], detail: detail, saving: diff };
  }

  /**
   * The highest bid that still gets a "good" verdict, rounded down to the
   * cent. null when no bid can (fees and shipping alone eat the value).
   */
  function maxGoodBid(mode, value, sh, settings, outShip, config) {
    config = config || CONFIG;
    if (typeof value !== 'number' || !(value > 0)) return null;
    var target;
    if (mode === 'resell') {
      var net = saleNet(value, settings, outShip).net;
      target = Math.min(net - settings.minProfit, net / (1 + settings.minReturnPct / 100));
    } else {
      target = value * config.keep.good;
    }
    var bid = Math.floor((target / (1 + settings.taxPct / 100) - (sh || 0)) * 100 + 1e-6) / 100;
    return bid > 0 ? bid : null;
  }

  // Drops saved items not opened for a while. Works on any Storage-like object.
  function forgetOld(storage, prefix, maxAgeMs, now) {
    var old = [];
    try {
      for (var i = 0; i < storage.length; i++) {
        var k = storage.key(i);
        if (!k || k.indexOf(prefix) !== 0) continue;
        var v = null;
        try { v = JSON.parse(storage.getItem(k) || 'null'); } catch (e) { v = null; }
        if (!v || typeof v.t !== 'number' || now - v.t > maxAgeMs) old.push(k);
      }
      old.forEach(function (k) { storage.removeItem(k); });
    } catch (e) { /* storage unavailable */ }
    return old.length;
  }

  // Same parser as the Shipping & Handling tool: reads the total from the
  // HTML ShopGoodwill's shipping calculator returns.
  function parseShippingTotal(html) {
    var text = String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
    var m = /Total Shipping and Handling:\s*\$?([\d,]+(?:\.\d+)?)/i.exec(text);
    if (m) return { ok: true, total: toNumber(m[1]) };
    return { ok: false, noOptions: /No valid shipping options/i.test(text) };
  }

  // ---------------------------------------------------------------------------
  // Page.
  // ---------------------------------------------------------------------------
  var STYLE = [
    '.P-box{border:1px solid #d6e0ee;background:#f7f9fc;border-radius:6px;padding:.6rem .75rem;margin:1rem 0;font-size:.9rem;line-height:1.35;color:#222;max-width:100%;box-sizing:border-box}',
    '.P-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap;margin-bottom:.4rem}',
    '.P-head b{font-size:1rem}',
    '.P-modes{display:inline-flex;border:1px solid #2a5d9f;border-radius:999px;overflow:hidden}',
    '.P-modes button{all:unset;cursor:pointer;padding:.15rem .7rem;font-size:.8rem;color:#2a5d9f}',
    '.P-modes button[aria-pressed="true"]{background:#2a5d9f;color:#fff}',
    '.P-fields{display:grid;grid-template-columns:auto 1fr;gap:.3rem .5rem;align-items:center}',
    '.P-fields label{color:#444}',
    '.P-money{display:flex;align-items:center;gap:.2rem}',
    '.P-box input{width:100%;min-width:0;max-width:9rem;box-sizing:border-box;padding:.25rem .4rem;border:1px solid #bbc;border-radius:4px;font:inherit;background:#fff;color:#222}',
    '.P-sum{margin-top:.5rem;color:#444;font-size:.85rem}',
    '.P-sum strong{color:#222}',
    '.P-verdict{margin-top:.35rem;font-weight:700;font-size:1rem}',
    '.P-verdict small{display:block;font-weight:400;font-size:.85rem;color:#444}',
    '.P-great{color:#0b7a33}.P-good{color:#2e7d32}.P-fair{color:#9a6700}.P-over{color:#b00020}.P-none{color:#555;font-weight:400;font-size:.85rem}',
    '.P-hint{margin-top:.3rem;font-size:.85rem}',
    '.P-hint b{color:#2a5d9f}',
    '.P-links{margin-top:.4rem;display:flex;gap:.9rem;flex-wrap:wrap}',
    '.P-links button{all:unset;cursor:pointer;color:#2a5d9f;text-decoration:underline;font-size:.8rem}',
    '.P-settings{margin-top:.5rem;padding-top:.5rem;border-top:1px solid #d6e0ee}',
    '.P-box [hidden],.P-settings[hidden]{display:none!important}',
    '.P-note{font-size:.75rem;color:#666;margin-top:.35rem}',
    '@media (pointer: coarse){.P-box input{font-size:16px;padding:.4rem}.P-modes button{padding:.45rem .9rem}.P-links button{padding:.35rem 0}}'
  ].join('\n');

  function start(win, doc, config) {
    config = config || CONFIG;
    var P = config.cssPrefix;
    var storage = win.localStorage;
    var fetchFn = win.fetch.bind(win);
    var itemPrefix = config.storagePrefix + 'item.';

    var style = doc.createElement('style');
    style.textContent = STYLE.replace(/\.P-/g, '.' + P + '-');
    (doc.head || doc.documentElement).appendChild(style);

    forgetOld(storage, itemPrefix, config.forgetAfterMs, Date.now());

    function load(key) {
      try { return JSON.parse(storage.getItem(key) || 'null'); } catch (e) { return null; }
    }
    function save(key, v) {
      try { storage.setItem(key, JSON.stringify(v)); } catch (e) { /* full */ }
    }
    function settings() {
      return readSettings(storage.getItem(config.storagePrefix + 'settings'), config.defaults);
    }
    function getZip() {
      var z = storage.getItem(config.zipStorageKey);
      return /^\d{5}$/.test(z || '') ? z : null;
    }

    function itemDetail(id) {
      return fetchFn(config.apiBase + 'ItemDetail/GetItemDetailModelByItemId/' + encodeURIComponent(id))
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    }
    function shipping(id, zip) {
      return fetchFn(config.apiBase + 'ItemDetail/CalculateShipping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: Number(id), country: config.country, province: null, zipCode: zip, quantity: 1, clientIP: '' })
      }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(parseShippingTotal);
    }

    function el(tag, cls, text) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls.split(' ').map(function (c) { return P + '-' + c; }).join(' ');
      if (text !== undefined) e.textContent = text;
      return e;
    }

    function moneyInput(placeholder) {
      var wrap = el('span', 'money');
      wrap.appendChild(doc.createTextNode('$'));
      var input = doc.createElement('input');
      input.type = 'text';
      input.setAttribute('inputmode', 'decimal');
      input.setAttribute('autocomplete', 'off');
      if (placeholder) input.placeholder = placeholder;
      wrap.appendChild(input);
      return { wrap: wrap, input: input };
    }

    function row(grid, labelText, field) {
      var id = P + '-f' + Math.random().toString(36).slice(2, 8);
      var label = doc.createElement('label');
      label.textContent = labelText;
      label.setAttribute('for', id);
      field.input.id = id;
      grid.appendChild(label);
      grid.appendChild(field.wrap);
      return label;
    }

    // Keeps the site's own keyboard handlers (and any form) out of our inputs.
    function guardKeys(input, onEnter) {
      input.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); if (onEnter) onEnter(); }
      });
      input.addEventListener('keyup', function (e) { e.stopPropagation(); });
      input.addEventListener('keypress', function (e) { e.stopPropagation(); });
    }

    var current = null; // the box for the item page we're on

    function build(panelEl, id) {
      var state = {
        id: id, detail: null, sh: null, shNote: '', shZip: null, error: '',
        item: load(itemPrefix + id) || {}
      };
      var box = el('div', 'box');
      box.setAttribute('data-item', id);

      var head = el('div', 'head');
      head.appendChild(el('b', null, 'Deal check'));
      var modes = el('span', 'modes');
      modes.setAttribute('role', 'group');
      modes.setAttribute('aria-label', 'Buying to keep or to resell');
      var keepBtn = el('button', null, 'To keep');
      var resellBtn = el('button', null, 'To resell');
      [keepBtn, resellBtn].forEach(function (b) { b.type = 'button'; modes.appendChild(b); });
      head.appendChild(modes);
      box.appendChild(head);

      var grid = el('div', 'fields');
      var value = moneyInput('');
      var valueLabel = row(grid, '', value);
      var bid = moneyInput('');
      var bidLabel = row(grid, 'Your bid', bid);
      var outShip = moneyInput('0');
      var outLabel = row(grid, 'Your shipping to buyer', outShip);
      box.appendChild(grid);

      var sum = el('div', 'sum');
      var verdict = el('div', 'verdict');
      verdict.setAttribute('aria-live', 'polite');
      var hint = el('div', 'hint');
      box.appendChild(sum);
      box.appendChild(verdict);
      box.appendChild(hint);

      var links = el('div', 'links');
      var lookUp = el('button', null, 'Look up sold prices');
      lookUp.type = 'button';
      var setBtn = el('button', null, 'Settings');
      setBtn.type = 'button';
      setBtn.setAttribute('aria-expanded', 'false');
      links.appendChild(lookUp);
      links.appendChild(setBtn);
      box.appendChild(links);

      // Settings (shared by every item).
      var sets = el('div', 'settings');
      sets.hidden = true;
      var sgrid = el('div', 'fields');
      var fields = {
        taxPct: { label: 'Sales tax %', input: null },
        feePct: { label: 'Selling fees %', input: null },
        feeFixed: { label: 'Fee per sale $', input: null },
        minProfit: { label: 'Least profit $', input: null },
        minReturnPct: { label: 'Least return %', input: null }
      };
      Object.keys(fields).forEach(function (k) {
        var f = moneyInput('');
        f.wrap.firstChild.textContent = '';
        fields[k].input = f.input;
        fields[k].wrap = f.wrap;
        fields[k].labelEl = row(sgrid, fields[k].label, f);
      });
      var zip = moneyInput('e.g. 33139');
      zip.wrap.firstChild.textContent = '';
      zip.input.setAttribute('inputmode', 'numeric');
      zip.input.setAttribute('maxlength', '5');
      zip.input.setAttribute('autocomplete', 'postal-code');
      row(sgrid, 'ZIP for S&H', zip);
      sets.appendChild(sgrid);
      var note = el('div', 'note', 'Tax applies to the item and S&H. Fees, least profit and least return are used for To resell. The ZIP is shared with the Shipping & Handling tool.');
      sets.appendChild(note);
      box.appendChild(sets);

      function fillSettings() {
        var s = settings();
        Object.keys(fields).forEach(function (k) { fields[k].input.value = String(s[k]); });
        zip.input.value = getZip() || '';
      }

      function saveItem() {
        state.item.t = Date.now();
        save(itemPrefix + id, state.item);
      }

      function mode() {
        return state.item.mode === 'resell' || state.item.mode === 'keep' ? state.item.mode : settings().mode;
      }

      function render() {
        var s = settings();
        var m = mode();
        keepBtn.setAttribute('aria-pressed', String(m === 'keep'));
        resellBtn.setAttribute('aria-pressed', String(m === 'resell'));
        valueLabel.textContent = m === 'resell' ? 'Sells for' : 'Worth to you';
        outLabel.hidden = outShip.wrap.hidden = m !== 'resell';

        var basis = priceBasis(state.detail);
        bid.input.placeholder = basis ? basis.price.toFixed(2) : '';
        bidLabel.hidden = bid.wrap.hidden = !!(basis && basis.buyNow);
        sum.textContent = '';
        verdict.textContent = '';
        verdict.className = P + '-verdict';
        hint.textContent = '';

        if (!basis) {
          sum.textContent = state.error || 'Getting the price…';
          return;
        }
        var myBid = basis.buyNow ? null : toNumber(state.item.bid);
        var price = myBid !== null && myBid > 0 ? myBid : basis.price;
        var priceLabel = myBid !== null && myBid > 0 ? 'Your bid' : basis.label;
        var pickup = state.detail.pickupOnly;
        var sh = state.sh;
        var cost = totalCost(price, sh || 0, s.taxPct);

        var parts = [priceLabel + ' ' + formatMoney(price)];
        if (sh !== null) parts.push((pickup ? 'handling ' : 'S&H ') + formatMoney(sh));
        if (s.taxPct > 0) parts.push('tax ' + formatMoney(cost.tax));
        sum.appendChild(doc.createTextNode(parts.join(' + ') + ' = '));
        var strong = doc.createElement('strong');
        strong.textContent = formatMoney(cost.total);
        sum.appendChild(strong);
        if (sh === null) sum.appendChild(doc.createTextNode(' + S&H (' + (state.shNote || 'estimating…') + ')'));
        else if (pickup) sum.appendChild(doc.createTextNode(' · pickup only'));
        if (!(s.taxPct > 0)) sum.title = 'Add your sales tax in Settings for a closer total.';
        else sum.title = '';

        var v = toNumber(state.item.value);
        var out = toNumber(state.item.outShip) || 0;
        var j = judge(m, cost.total, v, s, out, config);
        if (!j) {
          verdict.className = P + '-verdict ' + P + '-none';
          verdict.textContent = m === 'resell'
            ? 'Enter what it sells for to see if it\'s worth flipping.'
            : 'Enter what it\'s worth to you to see if the price is worth it.';
          return;
        }
        verdict.className = P + '-verdict ' + P + '-' + j.level;
        verdict.textContent = j.label;
        verdict.appendChild(el('small', null, j.detail + (sh === null ? ', before S&H' : '')));

        if (basis.ended) {
          hint.textContent = 'This auction has ended.';
          return;
        }
        var max = maxGoodBid(m, v, sh || 0, s, out, config);
        if (basis.buyNow) {
          if (max !== null) {
            hint.appendChild(doc.createTextNode(m === 'resell' ? 'Worth flipping at ' : 'A good deal at '));
            hint.appendChild(el('b', null, formatMoney(max)));
            hint.appendChild(doc.createTextNode(' or less' + (max < basis.price ? '; it\'s listed at ' + formatMoney(basis.price) + '.' : '.')));
          }
        } else if (max === null) {
          hint.textContent = m === 'resell'
            ? 'No bid leaves enough profit at this sale price.'
            : 'No bid makes this a good deal at this value.';
        } else if (max < basis.price) {
          hint.appendChild(doc.createTextNode('A good deal needs a bid of '));
          hint.appendChild(el('b', null, formatMoney(max)));
          hint.appendChild(doc.createTextNode(' or less; the next bid is already ' + formatMoney(basis.price) + '.'));
        } else {
          hint.appendChild(doc.createTextNode('Bid up to '));
          hint.appendChild(el('b', null, formatMoney(max)));
          hint.appendChild(doc.createTextNode(m === 'resell' ? ' to keep it worth flipping.' : ' to keep it a good deal.'));
        }
        if (sh === null && max !== null) hint.appendChild(doc.createTextNode(' (S&H not included yet)'));
      }

      function loadShipping() {
        var detail = state.detail;
        if (!detail) return;
        if (detail.pickupOnly) {
          state.sh = typeof detail.handlingPrice === 'number' ? detail.handlingPrice : 0;
          return render();
        }
        var z = getZip();
        if (!z) {
          state.sh = null;
          state.shNote = 'set your ZIP in Settings';
          return render();
        }
        if (state.shZip === z && state.sh !== null) return render();
        state.shZip = z;
        state.sh = null;
        state.shNote = 'estimating…';
        render();
        shipping(id, z).then(function (res) {
          if (state.shZip !== z) return;
          if (res.ok) state.sh = res.total;
          else state.shNote = res.noOptions ? 'can\'t ship to ' + z : 'unavailable';
          render();
        }, function () {
          state.shZip = null;
          state.shNote = 'unavailable';
          render();
        });
      }

      function refresh() {
        return itemDetail(id).then(function (d) {
          state.detail = d;
          state.error = '';
          loadShipping();
          render();
        }, function () {
          if (!state.detail) state.error = 'ShopGoodwill did not answer. Reload to try again.';
          render();
        });
      }

      // Inputs.
      value.input.value = state.item.value !== undefined ? String(state.item.value) : '';
      bid.input.value = state.item.bid !== undefined ? String(state.item.bid) : '';
      outShip.input.value = state.item.outShip !== undefined ? String(state.item.outShip) : '';
      [[value.input, 'value'], [bid.input, 'bid'], [outShip.input, 'outShip']].forEach(function (pair) {
        guardKeys(pair[0], function () { pair[0].blur(); });
        pair[0].addEventListener('input', function () {
          var n = toNumber(pair[0].value);
          if (n === null || n < 0) delete state.item[pair[1]]; else state.item[pair[1]] = n;
          saveItem();
          render();
        });
      });

      function setMode(m) {
        state.item.mode = m;
        saveItem();
        var s = readSettings(storage.getItem(config.storagePrefix + 'settings'), config.defaults);
        s.mode = m; // the next new item starts in the same mode
        save(config.storagePrefix + 'settings', s);
        render();
      }
      keepBtn.addEventListener('click', function () { setMode('keep'); });
      resellBtn.addEventListener('click', function () { setMode('resell'); });

      Object.keys(fields).forEach(function (k) {
        var input = fields[k].input;
        guardKeys(input, function () { input.blur(); });
        input.addEventListener('input', function () {
          var s = settings();
          var n = toNumber(input.value);
          s[k] = n === null || n < 0 ? config.defaults[k] : n;
          save(config.storagePrefix + 'settings', s);
          render();
        });
      });
      guardKeys(zip.input, function () { zip.input.blur(); });
      zip.input.addEventListener('input', function () {
        var z = zip.input.value.trim();
        if (/^\d{5}$/.test(z)) { storage.setItem(config.zipStorageKey, z); loadShipping(); }
      });

      setBtn.addEventListener('click', function () {
        sets.hidden = !sets.hidden;
        setBtn.setAttribute('aria-expanded', String(!sets.hidden));
        if (!sets.hidden) fillSettings();
      });

      lookUp.addEventListener('click', function () {
        var pc = doc.querySelector(config.priceCheckButtonSelector);
        if (pc) { pc.click(); return; }
        var h1 = doc.querySelector('h1');
        var q = (h1 && h1.textContent || '').split('|')[0].trim();
        win.open('https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(q) + '&LH_Sold=1&LH_Complete=1', '_blank', 'noopener');
      });

      panelEl.appendChild(box);
      render();
      refresh();
      return { id: id, box: box, refresh: refresh, render: render, state: state };
    }

    function scan() {
      timer = null;
      var m = config.itemPathRegex.exec(win.location.pathname);
      if (!m) { current = null; return; }
      var panelEl = doc.querySelector(config.itemPanelSelector);
      if (!panelEl) return;
      if (current && current.id === m[1] && panelEl.contains(current.box)) return;
      var old = panelEl.querySelector('.' + P + '-box');
      if (old) old.remove();
      current = build(panelEl, m[1]);
    }

    var timer = null;
    function schedule() {
      if (timer === null) timer = win.setTimeout(scan, config.rescanDelayMs);
    }

    // Keeps the price current while the page is open and visible.
    var refresher = win.setInterval(function () {
      if (!current || doc.hidden) return;
      var basis = priceBasis(current.state.detail);
      if (basis && basis.ended) return;
      current.refresh();
    }, config.refreshMs);

    scan();
    var observer = new win.MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var t = mutations[i].target;
        if (t && t.closest && t.closest('.' + P + '-box')) continue;
        schedule();
        return;
      }
    });
    observer.observe(doc.body, { childList: true, subtree: true });

    return {
      scan: scan,
      current: function () { return current; },
      stop: function () { observer.disconnect(); win.clearInterval(refresher); }
    };
  }

  return {
    CONFIG: CONFIG,
    LABELS: LABELS,
    toNumber: toNumber,
    formatMoney: formatMoney,
    readSettings: readSettings,
    priceBasis: priceBasis,
    totalCost: totalCost,
    saleNet: saleNet,
    judge: judge,
    maxGoodBid: maxGoodBid,
    forgetOld: forgetOld,
    parseShippingTotal: parseShippingTotal,
    start: start
  };
});
