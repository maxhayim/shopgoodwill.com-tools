# Changelog

All notable changes to this project are documented here. This project uses [Semantic Versioning](https://semver.org/).

## v1.1.0 — Shipping, Live Auction & Price Check

Release date: November 18, 2026

Three new tools, each installed separately. Eastern Time is unchanged (still 1.0.0).

- **Shipping & Handling** (`shopgoodwill-shipping.user.js` 1.1.0): estimated shipping & handling and the total cost for your ZIP code on every search result and item page, from ShopGoodwill's own shipping calculator. Pickup-only items show the pickup city. Estimates load as you scroll, two at a time, and are cached for six hours.
- **Live Auction** (`shopgoodwill-live-auction.user.js` 1.1.0): price, bid count and minimum bid refresh on their own on item pages. Time left becomes a to-the-second countdown on the server clock, with a red final five minutes. A Live chip shows the last update and pauses on click. The tab title shows the countdown and price. Checks speed up near the end and slow down in background tabs.
- **Price Check** (`shopgoodwill-price-check.user.js` 1.1.0): a Price check button on item pages and search results opens tidied-up, editable search terms with links to sold prices (eBay, Mercari, Poshmark), current listings (eBay, Etsy, Facebook Marketplace, Google Shopping) and search by photo (Google Lens, Bing Visual Search) using any of the item's photos.
- Each userscript now has its own version. `npm run check` also validates every script's metadata.
- 24 new automated tests (49 in total), including shipping responses captured from ShopGoodwill.
- Checked on live ShopGoodwill pages in Chrome: item page, grid and list search results, in-app page changes, pickup-only items, ZIP entry and validation, countdown ticking, pause and resume, and Price Check links. The scripts were loaded into the page directly, not through Tampermonkey.

## v1.0.0 — Initial Release

Release date: November 18, 2026

- Initial ShopGoodwill Eastern Time Converter
- Dynamic Angular page support
- Pacific-to-Eastern Time conversion
- EST/EDT handling
- Tampermonkey automatic-update metadata
- MIT open-source licensing
- Initial documentation and automated tests
