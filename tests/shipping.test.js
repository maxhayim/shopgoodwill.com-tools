'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const s = require(path.join(__dirname, '..', 'scripts', 'shopgoodwill-shipping.user.js'));

// Responses captured from ShopGoodwill's shipping calculator on 2026-11-18.
const OK_HTML = "<p>Estimated Shipping and Handling:</p><p>Shipped From: Phoenix, AZ 85043</p><p>Shipping: Standard Shipping<p>Address:   33139 US</p><p>Shipping: <span id='shipping-span'>$13.44</span></p><p>Handling: $3.50</p><p><b>Total Shipping and Handling: $16.94</b></p>";
const NO_OPTIONS = '<p>There was an error calculating your shipping cost:</p><p>No valid shipping options found.</p><p>ERROR CODE:0</p><p>Please try again later<br/>If you continue to experience problems, make sure your shipping address is correct</p>';
const BAD_ZIP = '<p>There was an error calculating your shipping cost:</p><p>FedEx service is not currently available to this origin / destination combination. Enter new information or contact FedEx Customer Service.</p><p>ERROR CODE:RATE.LOCATION.NOSERVICE</p><p>Please try again later</p>';

test('parses a successful estimate', () => {
  assert.deepEqual(s.parseShippingHtml(OK_HTML), {
    ok: true, total: 16.94, shipping: 13.44, handling: 3.5,
    from: 'Phoenix, AZ 85043', service: 'Standard Shipping'
  });
});

test('parses errors', () => {
  const a = s.parseShippingHtml(NO_OPTIONS);
  assert.equal(a.ok, false);
  assert.equal(a.noOptions, true);
  assert.equal(a.error, 'No valid shipping options found.');
  const b = s.parseShippingHtml(BAD_ZIP);
  assert.equal(b.ok, false);
  assert.equal(b.noOptions, false);
  assert.match(b.error, /FedEx service is not currently available/);
  assert.equal(s.parseShippingHtml('').ok, false);
  assert.equal(s.parseShippingHtml(null).ok, false);
  assert.equal(s.parseShippingHtml('<p>Total Shipping and Handling: $1,204.50</p>').total, 1204.5);
});

test('ZIP validation', () => {
  assert.equal(s.isValidZip('33139'), true);
  assert.equal(s.isValidZip(' 02134 '), true);
  ['', '3313', '331399', 'abcde', '33139-1234', null, undefined, 33139].forEach((z) =>
    assert.equal(s.isValidZip(z), false, String(z)));
});

test('money formatting', () => {
  assert.equal(s.formatMoney(16.94), '$16.94');
  assert.equal(s.formatMoney(3.5), '$3.50');
  assert.equal(s.formatMoney(1234.5), '$1,234.50');
  assert.equal(s.formatMoney(0), '$0.00');
  assert.equal(s.formatMoney(NaN), '');
  assert.equal(s.formatMoney('5'), '');
});

test('estimate for a shippable item includes the total', () => {
  const est = s.describeEstimate({ currentPrice: 26.5, pickupOnly: false }, s.parseShippingHtml(OK_HTML), '33139');
  assert.equal(est.kind, 'ship');
  assert.equal(est.label, 'S&H $16.94');
  assert.equal(est.total, 43.44);
  assert.match(est.title, /ZIP 33139: Shipping \$13\.44 \+ Handling \$3\.50/);
  assert.match(est.title, /Ships from Phoenix, AZ 85043/);
});

test('pickup-only items', () => {
  const est = s.describeEstimate({ currentPrice: 10, pickupOnly: true, handlingPrice: 3.99, pickupCity: 'Newark', pickupState: 'OH' }, null, '33139');
  assert.equal(est.kind, 'pickup');
  assert.equal(est.label, 'Pickup only (Newark, OH) + $3.99 handling');
  assert.equal(est.short, 'Pickup · Newark, OH');
  assert.match(est.title, /Handling: \$3\.99 \(included in the total\)/);
  assert.equal(est.total, 13.99);
  const noHandling = s.describeEstimate({ currentPrice: 10, pickupOnly: true, handlingPrice: 0 }, null, '33139');
  assert.equal(noHandling.label, 'Pickup only');
  assert.equal(noHandling.short, 'Pickup only');
  assert.equal(noHandling.total, 10);
});

test('failed estimate', () => {
  const est = s.describeEstimate({ currentPrice: 10, pickupOnly: false }, s.parseShippingHtml(BAD_ZIP), '00000');
  assert.equal(est.kind, 'error');
  assert.equal(est.total, null);
  assert.match(est.title, /FedEx/);
});

test('item IDs from cards and links', () => {
  assert.equal(s.itemIdFromHref('/item/284347676'), '284347676');
  assert.equal(s.itemIdFromHref('/item/1?x=1'), '1');
  assert.equal(s.itemIdFromHref('/categories/listing'), null);
  const card = (id, href) => ({ querySelector: () => ({ id, getAttribute: () => href }) });
  assert.equal(s.itemIdFromCard(card('283825498', '')), '283825498');
  assert.equal(s.itemIdFromCard(card('', '/item/42')), '42');
  assert.equal(s.itemIdFromCard({ querySelector: () => null }), null);
});

test('slimDetail keeps only what is shown', () => {
  const d = s.slimDetail({ currentPrice: 1, pickupOnly: 0, handlingPrice: 2, pickupCity: 'A', pickupState: 'B', title: 'T', description: 'long', images: [] });
  assert.deepEqual(d, { currentPrice: 1, pickupOnly: false, handlingPrice: 2, pickupCity: 'A', pickupState: 'B', title: 'T' });
});

test('queue never runs more than the limit at once', async () => {
  const run = s.createQueue(2);
  let active = 0, peak = 0;
  const job = (v) => () => new Promise((r) => { active++; peak = Math.max(peak, active); setTimeout(() => { active--; r(v); }, 5); });
  const out = await Promise.all([1, 2, 3, 4, 5].map((v) => run(job(v))));
  assert.deepEqual(out, [1, 2, 3, 4, 5]);
  assert.equal(peak, 2);
});

test('queue keeps going after a failure', async () => {
  const run = s.createQueue(1);
  await assert.rejects(run(() => Promise.reject(new Error('x'))));
  assert.equal(await run(() => 7), 7);
});

test('cache expires', () => {
  const mem = {};
  const storage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  let t = 1000;
  const c = s.createCache(storage, 'p.', 100, () => t);
  c.set('a', { x: 1 });
  assert.deepEqual(c.get('a'), { x: 1 });
  t = 1101;
  assert.equal(c.get('a'), null);
  assert.equal(c.get('missing'), null);
  mem['p.bad'] = '{not json';
  assert.equal(c.get('bad'), null);
});
