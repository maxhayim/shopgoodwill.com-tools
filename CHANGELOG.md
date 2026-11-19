# Changelog

All notable changes to this project are documented here. This project uses [Semantic Versioning](https://semver.org/).

## v1.3.0 — End time beside the countdown

Release date: November 19, 2026

- **Eastern Time 1.1.0:** item pages show the end time in Eastern Time right beside the countdown, e.g. **Time left: 5h 18m · ends Thu 11/19, 9:02 PM EST**. It is read from the item's Ends On line, so EST/EDT follows the auction's own date.
- **Live Auction 1.3.0:** the Live chip moved beside **Current Price** and shows just **Live** (the time of the last check is in its tooltip), so the Time left line stays on one line.
- 3 new automated tests (69 in total).
- Checked on a live ShopGoodwill item page in Chrome, with the countdown ticking next to the Eastern end time.

## v1.2.0 — Bid Alerts

Release date: November 18, 2026

- **Bid Alerts** (`shopgoodwill-bid-alerts.user.js` 1.2.0), a new tool. It alerts you when you're outbid, when a bid reaches your max exactly, when someone bids on an item you follow, before an auction ends (15/5/1 minutes, configurable) and when it ends. Bids you place in this browser are followed automatically from the site's "bid accepted" reply (read only). **Alert me** on item pages follows anything else, with an optional max bid. Alerts are pop-ups on every open ShopGoodwill tab, with optional sound and desktop notifications, and one tab does the checking. A Bid alerts button lists everything followed, with its status and the settings.
- **Eastern Time 1.0.1:** also converts the item page's **Ends On** line, using its own date for EST/EDT (`11/23/2026 07:56:00 PM PT` → `11/23/2026 10:56:00 PM EST`).
- **Live Auction 1.2.0:** the Live chip moved to the Time left / Bids bar so it no longer wraps under the price, and stays on one line.
- Screenshots of every tool in the README (taken with a demo ZIP code).
- 16 new automated tests (65 in total).
- Checked on live ShopGoodwill pages in Chrome:
  - Ends On conversion.
  - Outbid alert straight after following with a max below the price.
  - "Ends in under 5 minutes", "under 1 minute" and "Auction ended" alerts on a real auction.
  - The same alerts arriving once in each of two tabs, with one tab checking.
  - The overview panel and settings.
- Not yet checked: automatic follow after a real bid (no bids were placed while testing) and desktop notifications (permission not granted while testing).

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
