'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const A = require(path.join(__dirname, '..', 'scripts', 'shopgoodwill-bid-alerts.user.js'));

const T0 = 1_800_000_000_000;               // "now" on this computer
const detail = (price, bids, minutesLeft, extra) => Object.assign({
  title: 'Pyrex Bowl',
  currentPrice: price,
  numberOfBids: bids,
  serverTime: '2026-11-20T12:00:00',
  endTime: new Date(Date.UTC(2026, 10, 20, 12, 0, 0) + minutesLeft * 60000).toISOString().slice(0, 19)
}, extra || {});
const rec = (extra) => Object.assign({ itemId: '1', maxBid: null, fired: {}, lastPrice: null, lastBids: null }, extra || {});
const types = (out) => out.events.map((e) => e.type);

test('records only bids the site accepted', () => {
  const body = JSON.stringify({ itemId: 284347676, quantity: 1, sellerId: 201, bidAmount: '30.00' });
  assert.deepEqual(A.parsePlaceBid(body, '{"status":true,"result":0,"message":"Bid placed"}'), { itemId: '284347676', bidAmount: 30 });
  assert.equal(A.parsePlaceBid(body, '{"status":false,"result":-4,"message":"Too low"}'), null);
  assert.equal(A.parsePlaceBid(body, 'not json'), null);
  assert.equal(A.parsePlaceBid('{bad', '{"status":true}'), null);
  assert.equal(A.parsePlaceBid(JSON.stringify({ itemId: 0, bidAmount: 5 }), '{"status":true}'), null);
  assert.deepEqual(A.parsePlaceBid({ itemId: '7', bidAmount: 2.5 }, { status: true }), { itemId: '7', bidAmount: 2.5 });
});

test('end time is placed on this computer\'s clock', () => {
  assert.equal(A.endAt(detail(1, 0, 10), T0), T0 + 10 * 60000);
  assert.equal(A.endAt({}, T0), null);
});

test('outbid fires once when the price passes your max', () => {
  let out = A.evaluate(rec({ maxBid: 30 }), detail(25, 3, 600), T0, T0);
  assert.deepEqual(types(out), []);
  out = A.evaluate(out.record, detail(31, 4, 600), T0, T0);
  assert.deepEqual(types(out), ['outbid']);
  assert.equal(out.events[0].level, 'danger');
  assert.match(out.events[0].text, /\$31\.00 \(your max \$30\.00\)/);
  out = A.evaluate(out.record, detail(33, 5, 600), T0, T0);
  assert.deepEqual(types(out), [], 'no repeat, and no "new bid" noise once outbid');
});

test('raising your max re-arms the outbid alert', () => {
  let out = A.evaluate(rec({ maxBid: 30 }), detail(31, 4, 600), T0, T0);
  assert.deepEqual(types(out), ['outbid']);
  const r = Object.assign({}, out.record, { maxBid: 40 });
  out = A.evaluate(r, detail(41, 6, 600), T0, T0);
  assert.deepEqual(types(out), ['outbid']);
});

test('outbid right away when a bid is accepted but another max is higher', () => {
  const out = A.evaluate(rec({ maxBid: 20 }), detail(21, 5, 600), T0, T0);
  assert.deepEqual(types(out), ['outbid']);
});

test('a bid that reaches your max exactly is flagged, not called outbid', () => {
  let out = A.evaluate(rec({ maxBid: 30 }), detail(25, 3, 600), T0, T0);
  out = A.evaluate(out.record, detail(30, 4, 600), T0, T0);
  assert.deepEqual(types(out).sort(), ['matched', 'newbid']);
  assert.match(out.events.find((e) => e.type === 'matched').text, /may be outbid/);
});

test('new bids on followed items', () => {
  let out = A.evaluate(rec(), detail(10, 1, 600), T0, T0);
  assert.deepEqual(types(out), [], 'the first check only learns the price');
  out = A.evaluate(out.record, detail(12, 2, 600), T0, T0);
  assert.deepEqual(types(out), ['newbid']);
  assert.match(out.events[0].text, /New bid: \$12\.00 \(2 bids\)/);
  out = A.evaluate(out.record, detail(12, 2, 600), T0, T0);
  assert.deepEqual(types(out), []);
  const quiet = A.evaluate(out.record, detail(14, 3, 600), T0, T0, Object.assign({}, A.DEFAULT_PREFS, { newBidAlerts: false }));
  assert.deepEqual(types(quiet), []);
});

test('your own new bid is not announced as someone else\'s', () => {
  let out = A.evaluate(rec({ maxBid: 50 }), detail(10, 1, 600), T0, T0);
  const r = Object.assign({}, out.record, { ownBidPending: true });
  out = A.evaluate(r, detail(11, 2, 600), T0, T0);
  assert.deepEqual(types(out), []);
  out = A.evaluate(out.record, detail(13, 3, 600), T0, T0);
  assert.deepEqual(types(out), ['newbid'], 'only the first rise after your bid is skipped');
});

test('ending-soon warnings fire once each, nearest threshold only', () => {
  let out = A.evaluate(rec(), detail(10, 1, 30), T0, T0);
  assert.deepEqual(types(out), []);
  out = A.evaluate(out.record, detail(10, 1, 14), T0, T0);
  assert.deepEqual(types(out), ['ending']);
  assert.match(out.events[0].text, /under 15 minutes/);
  out = A.evaluate(out.record, detail(10, 1, 12), T0, T0);
  assert.deepEqual(types(out), []);
  out = A.evaluate(out.record, detail(10, 1, 0.5), T0, T0);
  assert.deepEqual(types(out), ['ending']);
  assert.match(out.events[0].text, /under 1 minute\./);
  // Jumping straight to 4 minutes left warns once, about 5 minutes.
  const late = A.evaluate(rec(), detail(10, 1, 4), T0, T0);
  assert.deepEqual(types(late), ['ending']);
  assert.match(late.events[0].text, /under 5 minutes/);
  assert.equal(late.record.fired['ending:15'], true);
});

test('ended: within your max, above it, and just followed', () => {
  const won = A.evaluate(rec({ maxBid: 30, lastPrice: 25, lastBids: 3 }), detail(25, 3, -1), T0, T0);
  assert.deepEqual(types(won), ['ended']);
  assert.equal(won.events[0].level, 'success');
  assert.match(won.events[0].text, /may have won/);
  assert.equal(won.record.ended, true);
  const lost = A.evaluate(rec({ maxBid: 30, lastPrice: 35, lastBids: 3, fired: { 'outbid:30': true } }), detail(35, 3, -1), T0, T0);
  assert.deepEqual(types(lost), ['ended']);
  assert.match(lost.events[0].text, /past your max/);
  const watched = A.evaluate(rec({ lastPrice: 9, lastBids: 2 }), detail(9, 2, -1), T0, T0);
  assert.equal(watched.events[0].text, 'Auction ended at $9.00.');
  assert.deepEqual(types(A.evaluate(watched.record, detail(9, 2, -1), T0, T0)), []);
});

test('time passing between checks counts', () => {
  const out = A.evaluate(rec(), detail(10, 1, 20), T0, T0 + 16 * 60000);
  assert.deepEqual(types(out), ['ending']);
  assert.match(out.events[0].text, /under 5 minutes/);
});

test('status for the overview list', () => {
  assert.equal(A.statusOf(rec()).kind, 'wait');
  assert.equal(A.statusOf(rec({ lastPrice: 5 })).kind, 'watch');
  assert.equal(A.statusOf(rec({ lastPrice: 5, maxBid: 10 })).kind, 'ok');
  assert.equal(A.statusOf(rec({ lastPrice: 11, maxBid: 10 })).kind, 'outbid');
  assert.equal(A.statusOf(rec({ lastPrice: 10, maxBid: 10, ended: true })).kind, 'won');
  assert.equal(A.statusOf(rec({ lastPrice: 11, maxBid: 10, ended: true })).kind, 'lost');
  assert.equal(A.statusOf(rec({ lastPrice: 11, ended: true })).kind, 'ended');
});

test('one tab checks at a time', () => {
  assert.equal(A.shouldLead(null, 'a', 1000, 8000), true);
  assert.equal(A.shouldLead({ id: 'a', t: 0 }, 'a', 1000, 8000), true);
  assert.equal(A.shouldLead({ id: 'b', t: 0 }, 'a', 5000, 8000), false);
  assert.equal(A.shouldLead({ id: 'b', t: 0 }, 'a', 9000, 8000), true, 'takes over when the other tab goes quiet');
});

test('checks faster near the end', () => {
  assert.equal(A.pollEvery(60000), 5000);
  assert.equal(A.pollEvery(10 * 60000), 15000);
  assert.equal(A.pollEvery(60 * 60000), 60000);
  assert.equal(A.pollEvery(5 * 86400000), 300000);
  assert.equal(A.pollEvery(null), 300000);
});
