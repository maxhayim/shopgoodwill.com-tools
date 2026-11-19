'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const L = require(path.join(__dirname, '..', 'scripts', 'shopgoodwill-live-auction.user.js'));

test('parses ShopGoodwill times', () => {
  assert.equal(L.parseNaive('2026-11-23T19:56:00'), Date.UTC(2026, 10, 23, 19, 56, 0));
  assert.equal(L.parseNaive('2026-11-18T07:09:59.497'), Date.UTC(2026, 10, 18, 7, 9, 59, 497));
  assert.equal(L.parseNaive('2026-11-18T07:09:59.5'), Date.UTC(2026, 10, 18, 7, 9, 59, 500));
  assert.equal(L.parseNaive('bad'), null);
  assert.equal(L.parseNaive(null), null);
});

test('remaining time uses the server clock, not the computer clock', () => {
  const d = { endTime: '2026-11-23T19:56:00', serverTime: '2026-11-23T19:50:00' };
  assert.equal(L.remainingMs(d, 1000, 1000), 6 * 60 * 1000);
  assert.equal(L.remainingMs(d, 1000, 61000), 5 * 60 * 1000);
  assert.equal(L.remainingMs(d, 1000, 1000 + 10 * 60 * 1000), 0);
  assert.equal(L.remainingMs({ endTime: 'x' }, 0, 0), null);
});

test('countdown format', () => {
  assert.equal(L.formatCountdown(5 * 86400000 + 12 * 3600000 + 3 * 60000), '5d 12h 3m');
  assert.equal(L.formatCountdown(4 * 3600000 + 5 * 60000 + 9000), '4:05:09');
  assert.equal(L.formatCountdown(12 * 60000 + 9000), '12:09');
  assert.equal(L.formatCountdown(7000), '0:07');
  assert.equal(L.formatCountdown(999), '0:00');
  assert.equal(L.formatCountdown(0), 'Ended');
  assert.equal(L.formatCountdown(null), '');
});

test('checks more often near the end, and less when the tab is hidden', () => {
  assert.equal(L.pollDelay(60 * 1000, false), 4000);
  assert.equal(L.pollDelay(10 * 60 * 1000, false), 10000);
  assert.equal(L.pollDelay(60 * 60 * 1000, false), 30000);
  assert.equal(L.pollDelay(3 * 86400000, false), 60000);
  assert.equal(L.pollDelay(null, false), 60000);
  assert.equal(L.pollDelay(60 * 1000, true), 30000);
  assert.equal(L.pollDelay(3 * 86400000, true), 60000);
});

test('tab title', () => {
  assert.equal(L.tabTitle('Lamp | ShopGoodwill.com', 65000, 26.5), '⏱ 1:05 · $26.50 | Lamp | ShopGoodwill.com');
});

// Stand-in for the bidding panel markup seen on ShopGoodwill (2026-11-18).
class T { constructor(v) { this.nodeType = 3; this.nodeValue = v; } get textContent() { return this.nodeValue; } }
class E {
  constructor(tag, kids = []) {
    this.tagName = tag.toUpperCase(); this.nodeType = 1; this.childNodes = []; this.parentElement = null;
    kids.forEach((k) => this.add(typeof k === 'string' ? new T(k) : k));
  }
  add(k) { k.parentElement = this; this.childNodes.push(k); return this; }
  setAttribute(n, v) { (this.attrs = this.attrs || {})[n] = String(v); }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get nextElementSibling() { const s = this.parentElement.children; return s[s.indexOf(this) + 1] || null; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  querySelectorAll(sel) {
    const parts = sel.split(',').map((t) => t.trim());
    const hit = (c) => parts.some((p) => p.startsWith('[')
      ? !!(c.attrs && Object.prototype.hasOwnProperty.call(c.attrs, p.slice(1, -1)))
      : p.toUpperCase() === c.tagName);
    const out = [];
    const walk = (e) => e.children.forEach((c) => { if (hit(c)) out.push(c); walk(c); });
    walk(this);
    return out;
  }
}

function panel() {
  const timeVal = new E('span', ['5d 12h ']);
  const bidsA = new E('a', ['4']);
  const bidsPrint = new E('span', ['4']);
  const price = new E('h3', ['$26.50 ']);
  const minBid = new E('p', ['$27.50']);
  const root = new E('app-bidding-control', [
    new E('div', [
      new E('div', [
        new E('span', [new E('strong', [new E('i'), ' Time left:']), timeVal]),
        new E('span', [new E('span', ['|']), new E('strong', ['Bids:']), bidsA, bidsPrint])
      ]),
      new E('div', [
        new E('div', [new E('div', [new E('h3', ['Current Price:'])]), new E('div', [price])]),
        new E('div', [new E('div', [new E('p', ['Minimum Bid:'])]), new E('div', [minBid])])
      ])
    ])
  ]);
  return { root, timeVal, bidsA, bidsPrint, price, minBid };
}

test('finds the values by their labels', () => {
  const p = panel();
  const t = L.findTargets(p.root, L.CONFIG);
  assert.equal(t.timeLeft, p.timeVal);
  assert.deepEqual(t.bids, [p.bidsA, p.bidsPrint]);
  assert.equal(t.price, p.price);
  assert.equal(t.minimumBid, p.minBid);
});

test('the Live chip sits in the Current Price label without hiding it', () => {
  const p = panel();
  const t = L.findTargets(p.root, L.CONFIG);
  assert.equal(t.priceLabel.textContent, 'Current Price:');
  const chip = new E('span', [new E('i'), new E('span', ['Live'])]);
  chip.setAttribute('data-sgwt-chip', '');
  t.priceLabel.add(chip);
  const again = L.findTargets(p.root, L.CONFIG);
  assert.equal(again.priceLabel, t.priceLabel);
  assert.equal(again.price, p.price);
});

test('setText only changes the text, keeping spacing and other children', () => {
  const p = panel();
  const badge = new E('span', ['badge']);
  p.price.add(badge);
  assert.equal(L.setText(p.price, '$30.00'), true);
  assert.equal(p.price.childNodes[0].nodeValue, '$30.00 ');
  assert.equal(p.price.childNodes[1], badge);
  assert.equal(L.setText(p.price, '$30.00'), false);
  assert.equal(L.setText(null, 'x'), false);
});
