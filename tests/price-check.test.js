'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const PC = require(path.join(__dirname, '..', 'scripts', 'shopgoodwill-price-check.user.js'));

test('search terms drop seller notes and weights', () => {
  assert.equal(PC.searchTerms('925 Sterling Silver Lagos Bead Stretch Bracelet | COA 21.84g'), '925 Sterling Silver Lagos Bead Stretch Bracelet');
  assert.equal(PC.searchTerms('Lot of 3 Pyrex Bowls (Untested) 4.2 lbs'), '3 Pyrex Bowls');
  assert.equal(PC.searchTerms('Vintage  Omega   Seamaster Watch - Untested'), 'Vintage Omega Seamaster Watch');
  assert.equal(PC.searchTerms('14K Gold Ring 3.1g Size 7'), '14K Gold Ring Size 7');
  assert.equal(PC.searchTerms('Camera | Nikon'), 'Camera | Nikon');
  assert.equal(PC.searchTerms(''), '');
  assert.equal(PC.searchTerms(null), '');
});

test('URLs encode the terms and photo', () => {
  const sold = PC.SOURCES.find((s) => s.name === 'eBay sold');
  assert.equal(PC.buildUrl(sold, 'Pyrex & bowls').split('?')[1], '_nkw=Pyrex%20%26%20bowls&LH_Sold=1&LH_Complete=1');
  const lens = PC.SOURCES.find((s) => s.name === 'Google Lens');
  assert.equal(PC.buildUrl(lens, 'x', 'https://img.test/a b.jpg').split('?')[1], 'url=https%3A%2F%2Fimg.test%2Fa%20b.jpg');
});

test('every source is https and has a placeholder', () => {
  PC.SOURCES.forEach((s) => {
    assert.match(s.url, /^https:\/\//, s.name);
    assert.ok(s.url.includes(s.photo ? '{img}' : '{q}'), s.name);
  });
});

test('photo URLs from item details', () => {
  const d = {
    imageServer: 'https://shopgoodwillimages.azureedge.net/production/',
    imageUrlString: '201\\Items\\2026-11-16\\be17448f-old1_11161.jpg;201\\Items\\2026-11-16\\57fe-old1_11162.jpg;'
  };
  assert.deepEqual(PC.photoUrls(d), [
    'https://shopgoodwillimages.azureedge.net/production/201/Items/2026-11-16/be17448f-old1_11161.jpg',
    'https://shopgoodwillimages.azureedge.net/production/201/Items/2026-11-16/57fe-old1_11162.jpg'
  ]);
  assert.equal(PC.photoUrls(d, 1).length, 1);
  assert.deepEqual(PC.photoUrls({ imageServer: 'https://x.test', imageUrlString: 'a b.jpg' }), ['https://x.test/a%20b.jpg']);
  assert.deepEqual(PC.photoUrls(null), []);
  assert.deepEqual(PC.photoUrls({}), []);
});

test('sources are grouped in order', () => {
  const g = PC.groupSources(PC.SOURCES);
  assert.deepEqual(g.map((x) => x.name), ['Sold prices', 'For sale now', 'Search by photo']);
  assert.equal(g.reduce((n, x) => n + x.items.length, 0), PC.SOURCES.length);
});
