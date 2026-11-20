// ==UserScript==
// @name         shopgoodwill.com tools - Price Check
// @namespace    https://github.com/maxhayim/shopgoodwill.com-tools
// @version      1.2.0
// @description  Adds a Price Check button to ShopGoodwill listings: sold prices, current listings and search-by-photo on other marketplaces in one click. Works on desktop and mobile.
// @author       maxhayim
// @license      MIT
// @match        https://shopgoodwill.com/*
// @match        https://www.shopgoodwill.com/*
// @run-at       document-idle
// @grant        none
// @homepageURL  https://github.com/maxhayim/shopgoodwill.com-tools
// @supportURL   https://github.com/maxhayim/shopgoodwill.com-tools/issues
// @updateURL    https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-price-check.user.js
// @downloadURL  https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-price-check.user.js
// ==/UserScript==

/*
 * shopgoodwill.com tools - Price Check
 * Copyright (c) 2026 maxhayim. MIT License.
 *
 * Adds a "Price check" button next to the item title and to each search
 * result. It opens a small panel with tidied-up search terms (editable) and
 * links that open other marketplaces' sold and current listings, plus
 * search-by-photo with any of the item's photos. Nothing is fetched from
 * those sites; the links just open in a new tab.
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
    if (window.__sgwtPriceCheck) return;
    window.__sgwtPriceCheck = true;
    api.start(window, document);
  }
})(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // CONFIG: page-specific details and the list of sources.
  // ---------------------------------------------------------------------------
  var CONFIG = {
    apiBase: 'https://buyerapi.shopgoodwill.com/api/',
    itemPathRegex: /^\/item\/(\d+)/,
    itemTitleSelector: 'h1',
    cardSelector: '.feat-item',
    cardNameSelector: 'a.feat-item_name',
    cardPriceSelector: '.feat-item_price',
    maxPhotos: 8,
    rescanDelayMs: 250,
    cssPrefix: 'sgwt-pc'
  };

  // {q} = search terms, {img} = photo URL. Both are URL-encoded.
  var SOURCES = [
    { group: 'Sold prices', name: 'eBay sold', url: 'https://www.ebay.com/sch/i.html?_nkw={q}&LH_Sold=1&LH_Complete=1' },
    { group: 'Sold prices', name: 'Mercari sold', url: 'https://www.mercari.com/search/?keyword={q}&status=sold_out' },
    { group: 'Sold prices', name: 'Poshmark sold', url: 'https://poshmark.com/search?query={q}&availability=sold_out' },
    { group: 'For sale now', name: 'eBay', url: 'https://www.ebay.com/sch/i.html?_nkw={q}' },
    { group: 'For sale now', name: 'Etsy', url: 'https://www.etsy.com/search?q={q}' },
    { group: 'For sale now', name: 'Facebook Marketplace', url: 'https://www.facebook.com/marketplace/search/?query={q}' },
    { group: 'For sale now', name: 'Google Shopping', url: 'https://www.google.com/search?tbm=shop&q={q}' },
    { group: 'Search by photo', name: 'Google Lens', url: 'https://lens.google.com/uploadbyurl?url={img}', photo: true },
    { group: 'Search by photo', name: 'Bing Visual Search', url: 'https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:{img}', photo: true }
  ];

  // ---------------------------------------------------------------------------
  // Pure helpers (tested in Node).
  // ---------------------------------------------------------------------------

  // Turns a listing title into useful search terms: keeps the part before
  // " | " (ShopGoodwill sellers put weights, lot numbers and notes after it),
  // and drops weights, sizes like "21.84g", and filler words.
  function searchTerms(title) {
    var t = String(title || '').replace(/\s+/g, ' ').trim();
    var head = t.split(/\s+[|•]\s+/)[0];
    if (head.split(' ').length >= 2) t = head;
    t = t
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/\b\d+(?:\.\d+)?\s?(?:g|grams?|oz|ozt|lbs?|pounds?|ct|cttw|dwt)\b\.?/gi, ' ')
      .replace(/\b(?:lot of|lot|bundle of|w\/|with|untested|as[- ]is|read|see photos?|pre-?owned|nwt|nib|euc|vtg)\b/gi, ' ')
      .replace(/[#*~!]+/g, ' ')
      .replace(/\s+[-,&]\s+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return t || String(title || '').trim();
  }

  function buildUrl(source, terms, photoUrl) {
    return source.url
      .replace('{q}', encodeURIComponent(terms || ''))
      .replace('{img}', encodeURIComponent(photoUrl || ''));
  }

  // Photo URLs from item details: imageServer + ';'-separated paths with
  // backslashes, e.g. "201\Items\2026-11-16\abc.jpg".
  function photoUrls(detail, max) {
    if (!detail || !detail.imageServer || !detail.imageUrlString) return [];
    var base = String(detail.imageServer).replace(/\/?$/, '/');
    return String(detail.imageUrlString).split(';')
      .map(function (p) { return p.trim().replace(/\\/g, '/').replace(/^\//, ''); })
      .filter(Boolean)
      .slice(0, max || 8)
      .map(function (p) { return base + p.split('/').map(encodeURIComponent).join('/'); });
  }

  function groupSources(sources) {
    var groups = [];
    var byName = {};
    sources.forEach(function (s) {
      if (!byName[s.group]) { byName[s.group] = { name: s.group, items: [] }; groups.push(byName[s.group]); }
      byName[s.group].items.push(s);
    });
    return groups;
  }

  // ---------------------------------------------------------------------------
  // Page.
  // ---------------------------------------------------------------------------
  var ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M21.4 11.6l-9-9A2 2 0 0011 2H4a2 2 0 00-2 2v7c0 .55.22 1.05.59 1.42l9 9a2 2 0 002.82 0l7-7a2 2 0 000-2.82zM6.5 8A1.5 1.5 0 118 6.5 1.5 1.5 0 016.5 8z"/></svg>';

  var STYLE = [
    '.P-btn{all:unset;display:inline-flex;align-items:center;gap:4px;cursor:pointer;font:600 12px/1 system-ui,sans-serif;color:#6b3fa0;border:1px solid #cdb8e6;background:#f7f2fc;border-radius:999px;padding:3px 8px;margin-left:8px;vertical-align:middle;white-space:nowrap}',
    '.P-btn:hover,.P-btn:focus-visible{background:#ece2f8;outline:none}',
    '.P-card-btn{margin:2px 0 0;padding:2px 7px;font-size:11px}',
    '.P-panel{position:absolute;z-index:2147483000;width:320px;max-width:calc(100vw - 24px);background:#fff;color:#222;border:1px solid #d9cfe6;border-radius:10px;box-shadow:0 10px 30px rgba(40,20,70,.2);font:13px/1.4 system-ui,sans-serif;padding:12px}',
    '.P-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:700;color:#4a2a75}',
    '.P-close{all:unset;cursor:pointer;font-size:18px;line-height:1;color:#777;padding:0 4px}',
    '.P-terms{display:flex;gap:6px;margin-bottom:10px}',
    '.P-terms input{flex:1;min-width:0;padding:6px 8px;border:1px solid #c9bfd8;border-radius:6px;font-size:13px}',
    '.P-terms button{all:unset;cursor:pointer;padding:0 8px;border:1px solid #c9bfd8;border-radius:6px;font-size:12px;color:#4a2a75}',
    '.P-group{margin:8px 0 4px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#7a6a90}',
    '.P-links{display:flex;flex-wrap:wrap;gap:6px}',
    '.P-links a{display:inline-block;padding:5px 9px;border-radius:6px;background:#f3eefa;color:#3d2363;text-decoration:none;font-weight:600;font-size:12px}',
    '.P-links a:hover{background:#e4d8f4}',
    '.P-photos{display:flex;gap:6px;overflow-x:auto;padding:2px 0 6px}',
    '.P-photos button{all:unset;cursor:pointer;flex:0 0 auto;width:46px;height:46px;border-radius:6px;border:2px solid transparent;overflow:hidden;background:#eee}',
    '.P-photos button[aria-pressed="true"]{border-color:#6b3fa0}',
    '.P-photos img{width:100%;height:100%;object-fit:cover;display:block}',
    '.P-note{color:#888;font-size:11px;margin-top:8px}',
    '@media (pointer: coarse){.P-btn{padding:6px 10px;font-size:13px}.P-terms input{font-size:16px;padding:8px}.P-terms button{min-height:38px}.P-links a{padding:9px 12px;font-size:14px}.P-photos button{width:56px;height:56px}.P-close{padding:6px 8px;font-size:22px}}',
    '@media (prefers-color-scheme: dark){.P-panel{background:#211d29;color:#ece8f2;border-color:#463b57}.P-head{color:#d6c2f2}.P-terms input{background:#2b2635;color:#ece8f2;border-color:#54476a}.P-terms button{color:#d6c2f2;border-color:#54476a}.P-group{color:#b3a2cc}.P-links a{background:#342b44;color:#e7dcf7}.P-note{color:#9a91a8}}'
  ].join('\n');

  function start(win, doc, config, sources) {
    config = config || CONFIG;
    sources = sources || SOURCES;
    var P = config.cssPrefix;
    var detailCache = {};
    var openPanel = null;

    var style = doc.createElement('style');
    style.textContent = STYLE.replace(/\.P-/g, '.' + P + '-');
    (doc.head || doc.documentElement).appendChild(style);

    function getDetail(itemId) {
      if (!detailCache[itemId]) {
        detailCache[itemId] = win.fetch(config.apiBase + 'ItemDetail/GetItemDetailModelByItemId/' + itemId)
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .catch(function (e) { delete detailCache[itemId]; throw e; });
      }
      return detailCache[itemId];
    }

    function closePanel() {
      if (openPanel) { openPanel.remove(); openPanel = null; }
    }

    function el(tag, cls, text) {
      var e = doc.createElement(tag);
      if (cls) e.className = P + '-' + cls;
      if (text) e.textContent = text;
      return e;
    }

    function showPanel(anchor, itemId, title) {
      closePanel();
      var panel = el('div', 'panel');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Price check');
      openPanel = panel;

      var head = el('div', 'head', 'Price check');
      var close = el('button', 'close', '×');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close');
      close.addEventListener('click', closePanel);
      head.appendChild(close);
      panel.appendChild(head);

      var terms = el('div', 'terms');
      var input = doc.createElement('input');
      input.type = 'search';
      input.value = searchTerms(title);
      input.setAttribute('aria-label', 'Search terms');
      var reset = el('button', null, 'Full title');
      reset.type = 'button';
      reset.title = 'Use the full listing title';
      reset.addEventListener('click', function () { input.value = title; update(); });
      terms.appendChild(input);
      terms.appendChild(reset);
      panel.appendChild(terms);

      var photos = [];
      var selected = 0;
      var linkEls = [];
      var photoRow = null;

      groupSources(sources).forEach(function (g) {
        panel.appendChild(el('div', 'group', g.name));
        if (g.items.some(function (s) { return s.photo; })) {
          photoRow = el('div', 'photos');
          panel.appendChild(photoRow);
        }
        var links = el('div', 'links');
        g.items.forEach(function (s) {
          var a = doc.createElement('a');
          a.textContent = s.name;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.setAttribute('data-source', s.name);
          links.appendChild(a);
          linkEls.push({ a: a, source: s });
        });
        panel.appendChild(links);
      });
      panel.appendChild(el('div', 'note', 'Opens in a new tab. Edit the search terms to narrow results.'));

      function update() {
        var q = input.value.trim();
        linkEls.forEach(function (l) {
          var photo = photos[selected];
          var disabled = l.source.photo && !photo;
          l.a.href = disabled ? '#' : buildUrl(l.source, q, photo);
          l.a.style.opacity = disabled ? '.45' : '';
          l.a.style.pointerEvents = disabled ? 'none' : '';
        });
      }

      function renderPhotos() {
        if (!photoRow) return;
        photoRow.textContent = '';
        if (!photos.length) {
          photoRow.appendChild(el('span', 'note', 'Loading photos…'));
          return;
        }
        photos.forEach(function (url, i) {
          var b = doc.createElement('button');
          b.type = 'button';
          b.setAttribute('aria-pressed', i === selected ? 'true' : 'false');
          b.setAttribute('aria-label', 'Photo ' + (i + 1));
          var img = doc.createElement('img');
          img.src = url;
          img.alt = '';
          img.loading = 'lazy';
          b.appendChild(img);
          b.addEventListener('click', function () { selected = i; renderPhotos(); update(); });
          photoRow.appendChild(b);
        });
      }

      input.addEventListener('input', update);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && linkEls[0]) { update(); linkEls[0].a.click(); }
        if (e.key === 'Escape') closePanel();
      });

      renderPhotos();
      update();
      getDetail(itemId).then(function (d) {
        if (openPanel !== panel) return;
        photos = photoUrls(d, config.maxPhotos);
        if (!photos.length && photoRow) { photoRow.textContent = ''; photoRow.appendChild(el('span', 'note', 'No photos found.')); }
        else renderPhotos();
        update();
      }, function () {
        if (openPanel === panel && photoRow) { photoRow.textContent = ''; photoRow.appendChild(el('span', 'note', 'Photos could not be loaded.')); }
      });

      doc.body.appendChild(panel);
      var r = anchor.getBoundingClientRect();
      var left = Math.min(r.left + win.scrollX, win.scrollX + doc.documentElement.clientWidth - panel.offsetWidth - 12);
      panel.style.left = Math.max(win.scrollX + 12, left) + 'px';
      panel.style.top = (r.bottom + win.scrollY + 6) + 'px';
      // On touch screens, focusing would pop up the keyboard over the links.
      var coarse = win.matchMedia && win.matchMedia('(pointer: coarse)').matches;
      if (!coarse) {
        input.focus();
        input.select();
      }
    }

    function makeButton(itemId, getTitle, extraClass) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = P + '-btn' + (extraClass ? ' ' + P + '-' + extraClass : '');
      b.setAttribute('data-item', itemId);
      b.innerHTML = ICON + '<span>Price check</span>';
      b.title = 'Compare prices on other marketplaces';
      b.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (openPanel && openPanel.getAttribute('data-for') === itemId) { closePanel(); return; }
        showPanel(b, itemId, getTitle());
        if (openPanel) openPanel.setAttribute('data-for', itemId);
      });
      return b;
    }

    function itemIdFromCard(card) {
      var a = card.querySelector(config.cardNameSelector);
      if (!a) return null;
      if (a.id && /^\d+$/.test(a.id)) return a.id;
      var m = /\/item\/(\d+)/.exec(a.getAttribute('href') || '');
      return m ? m[1] : null;
    }

    function scan() {
      timer = null;
      var cards = doc.querySelectorAll(config.cardSelector);
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var id = itemIdFromCard(card);
        var existing = card.querySelector('.' + P + '-btn');
        if (!id || (existing && existing.getAttribute('data-item') === id)) continue;
        if (existing) existing.remove();
        var price = card.querySelector(config.cardPriceSelector);
        var name = card.querySelector(config.cardNameSelector);
        if (!price || !name) continue;
        price.insertAdjacentElement('afterend', makeButton(id, (function (n) {
          return function () { return n.getAttribute('title') || n.textContent; };
        })(name), 'card-btn'));
      }

      var m = config.itemPathRegex.exec(win.location.pathname);
      if (m) {
        var h1s = doc.querySelectorAll(config.itemTitleSelector);
        for (var j = 0; j < h1s.length; j++) {
          var h1 = h1s[j];
          if (!h1.offsetParent && h1s.length > 1) continue;   // the site has a hidden mobile copy
          var btn = h1.querySelector('.' + P + '-btn');
          if (btn && btn.getAttribute('data-item') === m[1]) continue;
          if (btn) btn.remove();
          h1.appendChild(makeButton(m[1], (function (h) {
            return function () {
              var clone = h.cloneNode(true);
              var nodes = clone.querySelectorAll('button,svg,[class^="sgw"]');
              for (var k = 0; k < nodes.length; k++) nodes[k].remove();
              return clone.textContent.replace(/\s+/g, ' ').trim();
            };
          })(h1)));
        }
      }
    }

    var timer = null;
    function schedule() { if (timer === null) timer = win.setTimeout(scan, config.rescanDelayMs); }

    doc.addEventListener('click', function (e) {
      if (openPanel && !openPanel.contains(e.target) && !(e.target.closest && e.target.closest('.' + P + '-btn'))) closePanel();
    });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });

    scan();
    var observer = new win.MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var t = mutations[i].target;
        if (t && t.closest && (t.closest('.' + P + '-panel') || t.closest('.' + P + '-btn'))) continue;
        schedule();
        return;
      }
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    return { scan: scan, stop: function () { observer.disconnect(); closePanel(); } };
  }

  return {
    CONFIG: CONFIG,
    SOURCES: SOURCES,
    searchTerms: searchTerms,
    buildUrl: buildUrl,
    photoUrls: photoUrls,
    groupSources: groupSources,
    start: start
  };
});
