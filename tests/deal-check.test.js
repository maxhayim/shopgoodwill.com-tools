'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const D = require(path.join(__dirname, '..', 'scripts', 'shopgoodwill-deal-check.user.js'));

const S = D.readSettings(null); // defaults
const withTax = Object.assign({}, S, { taxPct: 7 });

test('numbers typed by people', () => {
  assert.equal(D.toNumber('$1,234.50'), 1234.5);
  assert.equal(D.toNumber(' 12 '), 12);
  assert.equal(D.toNumber('.5'), 0.5);
  assert.equal(D.toNumber(''), null);
  assert.equal(D.toNumber('abc'), null);
  assert.equal(D.toNumber('1.2.3'), null);
  assert.equal(D.toNumber(null), null);
  assert.equal(D.toNumber(7), 7);
  assert.equal(D.formatMoney(-3.5), '-$3.50');
  assert.equal(D.formatMoney(1234.5), '$1,234.50');
});

test('settings fall back to defaults', () => {
  assert.deepEqual(D.readSettings('{bad'), D.CONFIG.defaults);
  const s = D.readSettings(JSON.stringify({ mode: 'resell', taxPct: 6.5, feePct: -1, minProfit: 'x' }));
  assert.equal(s.mode, 'resell');
  assert.equal(s.taxPct, 6.5);
  assert.equal(s.feePct, D.CONFIG.defaults.feePct);
  assert.equal(s.minProfit, D.CONFIG.defaults.minProfit);
  assert.equal(D.readSettings({ mode: 'other' }).mode, 'keep');
});

test('price basis: next bid, then final price once ended', () => {
  const open = { currentPrice: 53, minimumBid: 54, endTime: '2026-11-19T18:02:00', serverTime: '2026-11-19T17:00:00.123' };
  assert.deepEqual(D.priceBasis(open), { price: 54, label: 'Next bid', ended: false });
  const ended = Object.assign({}, open, { serverTime: '2026-11-19T18:54:17.843' });
  assert.deepEqual(D.priceBasis(ended), { price: 53, label: 'Final price', ended: true });
  assert.deepEqual(D.priceBasis({ currentPrice: 9, minimumBid: 0 }), { price: 9, label: 'Current price', ended: false });
  assert.deepEqual(D.priceBasis({ isAuction: false, buyNowPrice: 14.99, discountedBuyNowPrice: 12.99, currentPrice: 14.99, minimumBid: 14.99 }),
    { price: 12.99, label: 'Buy It Now', ended: false, buyNow: true });
  assert.equal(D.priceBasis({ isAuction: false, buyNowPrice: 14.99, discountedBuyNowPrice: 0 }).price, 14.99);
  // Auctions with a lower Buy It Now price still use the next bid.
  assert.equal(D.priceBasis({ isAuction: true, buyNowPrice: 4.95, currentPrice: 9.95, minimumBid: 10.95 }).price, 10.95);
  assert.equal(D.priceBasis(null), null);
  assert.equal(D.priceBasis({}), null);
});

test('total cost adds S&H and tax on both', () => {
  assert.deepEqual(D.totalCost(54, 16.94, 0), { price: 54, sh: 16.94, tax: 0, total: 70.94 });
  assert.deepEqual(D.totalCost(54, 16.94, 7), { price: 54, sh: 16.94, tax: 4.97, total: 75.91 });
  assert.deepEqual(D.totalCost(10, null, 0), { price: 10, sh: 0, tax: 0, total: 10 });
});

test('to keep: verdict by share of what it is worth to you', () => {
  assert.equal(D.judge('keep', 60, 100, S).level, 'great');
  assert.equal(D.judge('keep', 70, 100, S).level, 'great');
  assert.equal(D.judge('keep', 85, 100, S).level, 'good');
  assert.equal(D.judge('keep', 100, 100, S).level, 'fair');
  const over = D.judge('keep', 120, 100, S);
  assert.equal(over.level, 'over');
  assert.equal(over.label, 'Not worth it');
  assert.equal(over.detail, '$20.00 more than it\'s worth to you');
  assert.equal(D.judge('keep', 60, 100, S).detail, 'You save $40.00 (40%)');
  assert.equal(D.judge('keep', 60, 0, S), null);
  assert.equal(D.judge('keep', 60, null, S), null);
});

test('to resell: profit after fees and your shipping', () => {
  // Sells for $150: fees 13.6% + $0.40 = $20.80, net $129.20 (no shipping).
  assert.deepEqual(D.saleNet(150, S, 0), { fees: 20.8, net: 129.2 });
  const great = D.judge('resell', 40, 150, S, 0);
  assert.equal(great.level, 'great');
  assert.equal(great.profit, 89.2);
  assert.match(great.detail, /^Profit \$89\.20 \(223% return\) after \$20\.80 fees$/);
  assert.equal(D.judge('resell', 90, 150, S, 0).level, 'good');       // $39.20, 44%
  assert.equal(D.judge('resell', 110, 150, S, 0).level, 'fair');      // $19.20, 17%
  const loss = D.judge('resell', 120, 150, S, 12);
  assert.equal(loss.level, 'over');
  assert.equal(loss.label, 'Would lose money');
  assert.equal(loss.detail, 'You would lose $2.80 after $20.80 fees and $12.00 shipping');
});

test('highest bid that is still a good deal', () => {
  // Keep: 90% of $100 = $90 total; minus $10 S&H = $80.
  assert.equal(D.maxGoodBid('keep', 100, 10, S), 80);
  // With 7% tax: 90 / 1.07 = 84.11..., minus 10 = 74.11.
  assert.equal(D.maxGoodBid('keep', 100, 10, withTax), 74.11);
  // That bid really is "good", one cent more is not.
  const total = (bid) => D.totalCost(bid, 10, 7).total;
  assert.equal(D.judge('keep', total(74.11), 100, withTax).level, 'good');
  // Resell $150: net 129.20; least of 129.20 - 10 and 129.20 / 1.3 = 99.38.
  assert.equal(D.maxGoodBid('resell', 150, 15, S, 0), 84.38);
  assert.equal(D.judge('resell', D.totalCost(84.38, 15, 0).total, 150, S, 0).level, 'good');
  // Nothing works when S&H alone is more than the value.
  assert.equal(D.maxGoodBid('keep', 10, 20, S), null);
  assert.equal(D.maxGoodBid('keep', null, 20, S), null);
});

test('shipping total from ShopGoodwill\'s calculator', () => {
  assert.deepEqual(D.parseShippingTotal("<p>Handling: $3.50</p><p><b>Total Shipping and Handling: $16.94</b></p>"), { ok: true, total: 16.94 });
  assert.deepEqual(D.parseShippingTotal('<p>No valid shipping options found.</p>'), { ok: false, noOptions: true });
  assert.deepEqual(D.parseShippingTotal(null), { ok: false, noOptions: false });
});

test('old saved items are forgotten', () => {
  const data = {
    'sgwTools.deal.item.1': JSON.stringify({ value: 5, t: 1000 }),
    'sgwTools.deal.item.2': JSON.stringify({ value: 5, t: 9000 }),
    'sgwTools.deal.item.3': 'not json',
    'sgwTools.shipping.zip': '33139'
  };
  const store = {
    get length() { return Object.keys(data).length; },
    key: (i) => Object.keys(data)[i],
    getItem: (k) => (k in data ? data[k] : null),
    removeItem: (k) => { delete data[k]; }
  };
  assert.equal(D.forgetOld(store, 'sgwTools.deal.item.', 5000, 10000), 2);
  assert.deepEqual(Object.keys(data), ['sgwTools.deal.item.2', 'sgwTools.shipping.zip']);
});
