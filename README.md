<p align="center">
  <strong>Open-source browser tools and enhancements for ShopGoodwill.com</strong>
</p>

<p align="center">
  <a href="https://github.com/maxhayim/shopgoodwill.com-tools/actions/workflows/validate.yml">
    <img src="https://github.com/maxhayim/shopgoodwill.com-tools/actions/workflows/validate.yml/badge.svg" alt="Validate">
  </a>
  <a href="https://github.com/maxhayim/shopgoodwill.com-tools/releases/latest">
    <img src="https://img.shields.io/github/v/release/maxhayim/shopgoodwill.com-tools" alt="Latest release">
  </a>
  <a href="https://opensource.org/licenses/MIT">
    <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
  </a>
  <img src="https://img.shields.io/badge/Userscript-Tampermonkey-lightgrey" alt="Tampermonkey">
</p>

# shopgoodwill.com tools

**shopgoodwill.com tools** is a set of small, independent browser userscripts that make ShopGoodwill.com easier to bid on: ending times in your time zone, what an item will really cost delivered, an auction page that keeps itself up to date, alerts when you're outbid, and one-click price checks before you bid.

Each tool is a single file in [`scripts/`](scripts/). Install only the ones you want.

| Tool | What it does | Install |
|---|---|---|
| **Eastern Time** | Shows auction ending times in Eastern Time (EST/EDT) | [Install](https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-eastern-time.user.js) |
| **Shipping & Handling** | Estimated shipping & handling and the total cost for your ZIP code, on search results and item pages | [Install](https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-shipping.user.js) |
| **Live Auction** | Keeps the price, bids and a to-the-second countdown up to date on item pages, and in the tab title | [Install](https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-live-auction.user.js) |
| **Price Check** | One click to sold prices, current listings and search-by-photo on other marketplaces | [Install](https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-price-check.user.js) |
| **Bid Alerts** | Pop-up, sound and desktop alerts when you're outbid, when someone bids on an item you follow, and before auctions end | [Install](https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-bid-alerts.user.js) |

The tools don't depend on each other and work together on the same page.

<h2>Screenshots</h2>

<p align="center">
  <img src="assets/screenshots/overview.png" alt="An item page with all the tools: Price check button, Alert me, shipping estimate box and the Live chip" width="900">
  <br><em>An item page with Price Check, Bid Alerts, Shipping & Handling and Live Auction</em>
</p>

<p align="center">
  <img src="assets/screenshots/shipping-search.png" alt="Search results with S&H and total under each price" width="900">
  <br><em>Shipping & Handling on search results: S&H and the total for your ZIP code</em>
</p>

<table>
  <tr>
    <td width="50%"><img src="assets/screenshots/shipping-item.png" alt="Shipping breakdown box on an item page"><br><em>Shipping & Handling on an item page</em></td>
    <td width="50%"><img src="assets/screenshots/live-auction.png" alt="Time left 5:08:14, ends Thu 11/19, 9:02 PM EST, and a Live chip beside Current Price"><br><em>Live Auction countdown with the Eastern end time beside it</em></td>
  </tr>
  <tr>
    <td><img src="assets/screenshots/bid-alerts-panel.png" alt="Bid alerts panel listing an outbid item, one within the max and one ended, plus settings"><br><em>Bid Alerts overview and settings</em></td>
    <td><img src="assets/screenshots/price-check.png" alt="Price check panel with sold prices, for sale now and search by photo"><br><em>Price Check</em></td>
  </tr>
  <tr>
    <td><img src="assets/screenshots/bid-alerts-toast.png" alt="Outbid pop-up: You've been outbid. Price is now $36.00 (your max $30.00)"><br><em>An outbid alert</em></td>
    <td><img src="assets/screenshots/eastern-time.png" alt="Item info table showing Ends On 11/23/2026 10:56:00 PM EST"><br><em>Eastern Time on the item page's Ends On line</em></td>
  </tr>
</table>

<sub>Screenshots from shopgoodwill.com, taken 2026-11-18 with a demo ZIP code. Listings and photos belong to their sellers.</sub>

## Features

### Eastern Time

- Converts auction ending times such as `6:39:00 PM PDT` to `9:39:00 PM EDT`.
- Shows **EST** or **EDT** correctly, including on the nights the clocks change.
- Uses the auction's closing date when it is on the page, never today's date.
- Handles times that cross midnight, for example `10:30:00 PM PST` → `1:30:00 AM EST (next day)`.
- Keeps the original Pacific time in a tooltip: hover over a converted time to see it.
- On item pages, shows the end time in Eastern Time right beside the countdown: **Time left: 5h 18m · ends Thu 11/19, 9:02 PM EST**.
- Also converts the item page's **Ends On** line (`11/23/2026 07:56:00 PM PT` → `11/23/2026 10:56:00 PM EST`), using its date for EST/EDT.
- Works on pages Angular loads or redraws after the page opens (search results, paging, item pages).
- Converts each time once, and converts again only if the site puts a new Pacific time in its place.
- Leaves countdown timers, prices, bid buttons and everything else alone.
- Plain JavaScript: no jQuery, no frameworks, no network requests, no permissions (`@grant none`).

### Shipping & Handling

- Adds a line under every search result price: **S&H $15.20 · Total $35.19**. The total is the current price plus shipping and handling.
- On item pages, a box above the bidding panel shows the breakdown: shipping, handling, where it ships from and the carrier service.
- Pickup-only items say so, with the pickup city: **Pickup · Newark, OH**. Any handling fee is included in the total.
- Estimates come from ShopGoodwill's own shipping calculator (the one behind *Estimate Shipping* on item pages), so they match what the site would tell you.
- Set your ZIP code once (click **set ZIP for estimate** or **change ZIP**). It is saved in your browser only.
- Only results you scroll to are estimated, at most two requests at a time, and results are remembered for six hours, so browsing stays fast and light on ShopGoodwill.
- Works in grid and list view and keeps up when you search, filter or change pages.

### Live Auction

- **Time left** becomes a countdown that ticks every second (`1:45:41`), turning red in the last five minutes.
- The current price, bid count and minimum bid refresh on their own, and briefly highlight when they change.
- A **Live** chip beside **Current Price** shows the updates are on; hover it to see when the page last checked. Click it to pause or resume.
- The browser tab title shows the countdown and price (`⏱ 1:45:41 · $19.99 | …`), so you can follow an auction from another tab.
- Checks more often as the end gets closer (every minute when days are left, every 4 seconds in the final 2 minutes), slows down while the tab is in the background, and stops when the auction ends.
- The countdown uses ShopGoodwill's server clock, so it's right even if your computer's clock is off.
- Display only: it never places, changes or confirms a bid.

### Price Check

- Adds a **Price check** button next to the item title and under every search result price.
- Opens a panel with search terms tidied up from the listing title (seller notes after `|`, weights such as `21.84g`, and words like *untested* or *lot of* are dropped). Edit them, or click **Full title** to use the original.
- **Sold prices:** eBay sold, Mercari sold, Poshmark sold.
- **For sale now:** eBay, Etsy, Facebook Marketplace, Google Shopping.
- **Search by photo:** pick any of the item's photos, then search with Google Lens or Bing Visual Search.
- Links open in a new tab. Nothing is fetched from those sites, and nothing about you is sent to them beyond the search itself.

### Bid Alerts

- **Outbid:** alerts as soon as the price passes your max bid. If a bid reaches your max exactly, you get a separate "may be outbid" warning, because the earlier bidder wins a tie.
- **New bid:** someone bid on an item you follow.
- **Ending soon:** 15, 5 and 1 minute(s) before the end (you choose the minutes).
- **Ended:** the final price, and whether it was within your max.
- **Bids you place are followed automatically.** When ShopGoodwill confirms a bid in this browser, the script notes the item and your max. It only reads the site's reply; it never places, changes or repeats a bid.
- **Follow anything else** with **Alert me** on an item page. Optionally enter your max bid there, for example for bids placed on your phone.
- Alerts show as pop-ups on every open ShopGoodwill tab, with an optional sound and optional desktop notifications. Only one tab checks prices, so you don't get the same alert in every tab.
- A **Bid alerts** button (bottom left) shows how many auctions you follow, turns red with the number you're outbid on, and opens a list with each item's status and the settings.
- Checks every 5 minutes when days are left, down to every 5 seconds in the last 3 minutes. Ended auctions drop off the list after a day.

## Requirements

- A desktop browser with a userscript manager. [Tampermonkey](https://www.tampermonkey.net/) is the one this project targets.

## Privacy

- The tools run only on `shopgoodwill.com` and `www.shopgoodwill.com`.
- Shipping & Handling, Live Auction and Bid Alerts talk only to ShopGoodwill's own API (`buyerapi.shopgoodwill.com`), the same one the site uses. Your ZIP code goes there and nowhere else.
- Bid Alerts reads prices from the public item details everyone sees. It never uses your login, password or session.
- Your ZIP code, cached estimates, followed auctions and alert settings are kept in your browser's storage for shopgoodwill.com, under keys starting with `sgwTools.`.
- No accounts, analytics, tracking or third-party servers.

## Installation

1. Install the Tampermonkey extension for your browser:
   - [Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - [Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/)
   - [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
   - [Safari](https://www.tampermonkey.net/?browser=safari)
2. In Chrome and Edge, allow userscripts: open the extension's details page and turn on **Allow User Scripts** (or **Developer mode** on older versions).
3. Open the install link for each tool you want:
   - **[Eastern Time](https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-eastern-time.user.js)**
   - **[Shipping & Handling](https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-shipping.user.js)**
   - **[Live Auction](https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-live-auction.user.js)**
   - **[Price Check](https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-price-check.user.js)**
   - **[Bid Alerts](https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-bid-alerts.user.js)**
4. Tampermonkey shows an install page for each. Click **Install**.
5. Open or reload [shopgoodwill.com](https://shopgoodwill.com/).
6. For shipping estimates, click **set ZIP for estimate** under any search result and enter your ZIP code.
7. For desktop notifications, open **Bid alerts** (bottom left), tick **Desktop notifications** and allow them when the browser asks.

## Usage

- **Eastern Time:** nothing to set up. Ending times appear in Eastern Time. Hover over a time to see the original Pacific time.
- **Shipping & Handling:** set your ZIP code once. Hover over an estimate for the breakdown.
- **Live Auction:** open any item page. Click the **Live** chip to pause or resume updates.
- **Price Check:** click **Price check**, adjust the search terms if needed, then click a marketplace. Press <kbd>Enter</kbd> to open the first link, <kbd>Esc</kbd> to close.
- **Bid Alerts:** bid as usual; the item is followed automatically. To follow something else, click **Alert me** on its page. Keep at least one ShopGoodwill tab open to get alerts.

### Eastern Time examples

| ShopGoodwill shows | Closing date known? | You see |
|---|---|---|
| `6:39:00 PM PDT` | no | `9:39:00 PM EDT` |
| `4:05:00 PM PST` | no | `7:05:00 PM EST` |
| `12:00:00 PM PDT` | no | `3:00:00 PM EDT` |
| `9:00:00 PM PST` | no | `12:00:00 AM EST (next day)` |
| `11:30:00 PM PDT` | no | `2:30:00 AM ET (next day)` |
| `8/31/2026 10:30:00 PM PDT` | yes, in the text | `9/1/2026 1:30:00 AM EDT` |
| `11:30:00 PM PST` on 3/7/2026 | yes, nearby | `3:30:00 AM EDT (next day)` |
| `11:30:00 PM PDT` on 10/31/2026 | yes, nearby | `1:30:00 AM EST (next day)` |

## How It Works

### Eastern Time

The script looks for elements matching `li.text-danger`, and for the value next to labels such as **Ends On:**, whose text contains a time ending in `PDT`, `PST` or `PT`. It replaces just that time in the element's text and remembers what it wrote, so the next scan skips it. A `MutationObserver` watches for Angular adding or redrawing content and triggers a rescan (debounced, so a burst of changes causes one scan).

#### Daylight saving time

Pacific and Eastern Time are three hours apart almost all the time. The exception is the two nights a year the clocks change, because each zone changes at 2 AM *its own* local time:

- **Spring (2nd Sunday of March):** from 11 PM to 2 AM Pacific, Eastern is already on EDT while Pacific is still on PST, so the gap is **4 hours**.
- **Fall (1st Sunday of November):** from 11 PM to 2 AM Pacific, Eastern is already back on EST while Pacific is still on PDT, so the gap is **2 hours**.

When the auction's closing date is available, either in the same text as the time or in the same listing, the script works out the exact moment and gets these nights right.

When the date is **not** available, the script adds three hours, like the original script. If the time is between 2 AM and 11 PM Pacific and the site says `PDT` or `PST`, the result is exact and shown as `EDT` or `EST`. If the time is between 11 PM and 2 AM, or the site only says `PT`, the script shows the neutral `ET` and says in the tooltip that EST/EDT could not be confirmed.

The script uses the US daylight-saving rules in force since 2007. Its results were checked against the system time zone database for every half hour from 2025 to 2028.

### Shipping & Handling

For each item, the script reads the item's details from ShopGoodwill's API (`ItemDetail/GetItemDetailModelByItemId`) to get the current price and whether it is pickup only. For items that ship, it asks `ItemDetail/CalculateShipping` for your ZIP code and reads the shipping, handling and total from the answer. Search results are estimated when they scroll into view.

### Live Auction

On an item page, the script reads the same item details on a schedule, then updates the numbers next to the site's own **Time left**, **Bids**, **Current Price** and **Minimum Bid** labels. It finds them by their label text, not by class names, and changes only the text, never the bid form.

### Price Check

Search terms and links are built in the browser from the listing title. Photos come from the item's details. The list of marketplaces is the `SOURCES` table near the top of the script, so adding one is a one-line change.

### Bid Alerts

The script keeps a list of followed auctions in your browser's storage. One open ShopGoodwill tab is chosen to do the checking. If it closes, another tab takes over within seconds. That tab reads each auction's public details and compares the price, bid count and end time with what it saw last time. Alerts are shared with the other tabs through browser storage.

To follow your own bids automatically, the script watches for the site's own `ItemBid/PlaceBid` request to finish. When the reply says the bid was accepted, it records the item and the amount. The request and reply are passed through untouched.

Outbid detection compares the price with your max bid. With proxy bidding, the price never goes past the highest bidder's max, so a price above your max means someone else's max is higher.

### Updating selectors

ShopGoodwill can change its markup at any time. Everything page-specific is in the `CONFIG` block at the top of each script. For example, in [`scripts/shopgoodwill-eastern-time.user.js`](scripts/shopgoodwill-eastern-time.user.js):

```javascript
var CONFIG = {
  timeSelectors: ['li.text-danger'],   // elements that hold the Pacific time
  dateSearchLevels: 2,                 // how far up to look for the closing date
  dateSearchMaxTextLength: 600,        // skip ancestors bigger than this
  rescanDelayMs: 150,                  // wait after page changes before rescanning
  attrPrefix: 'data-sgw-et'            // attributes used to remember conversions
};
```

The other scripts work the same way: Shipping & Handling and Price Check use `cardSelector`, `cardNameSelector` and `cardPriceSelector` for search results, and Live Auction uses `panelSelector` plus the `labels` it looks for.

If a tool stops working:

1. On ShopGoodwill, right-click the part of the page that changed and choose **Inspect**.
2. Note the element's tag and classes (for example `<li class="text-danger">`).
3. Update the matching selector in `CONFIG`. Keep selectors narrow so the tool stays away from unrelated parts of the page.
4. Run `npm test`, then open a pull request.

## Automatic Updates

Each script's `@updateURL` and `@downloadURL` point at its copy on the `main` branch. Tampermonkey checks it on its normal schedule (daily by default) and installs a new version when the `@version` number goes up. To check right away, open the Tampermonkey dashboard and choose **Check for userscript updates**.

## Browser Compatibility

The scripts use only standard JavaScript and browser features (`fetch`, `MutationObserver`, `IntersectionObserver`, `localStorage`) available in every current browser. It is written for Tampermonkey on desktop Chrome, Edge, Firefox and Safari. Other userscript managers (Violentmonkey, Greasemonkey 4, Userscripts for Safari) should work but have not been tested.

## Known Limitations

- The automated tests use a small stand-in DOM, not a real browser. Eastern Time and Shipping & Handling have been used on the live site with Tampermonkey. The other tools were checked by loading them into live ShopGoodwill pages in Chrome (see [CHANGELOG.md](CHANGELOG.md)).
- The closing date is only used when it appears in the time's own text or in the same listing. If ShopGoodwill does not show it near the time, the script falls back to adding three hours as described above.
- Only US daylight-saving rules from 2007 onward are built in. If Congress changes them, the script will need an update.
- Converts to Eastern Time only. Other time zones are on the roadmap.
- Shipping estimates are for US ZIP codes only, and are estimates: ShopGoodwill sets the final cost at checkout. Combined shipping for several items won by the same buyer is not reflected.
- Live Auction updates the item page only, not the countdowns on search results.
- Price Check links depend on each marketplace's search address. If one changes, the link may open a general search page instead.
- Bid Alerts only runs while a ShopGoodwill tab is open, like any userscript. Close every tab and alerts stop until you open one again.
- Bid Alerts follows bids placed in this browser automatically. For bids placed elsewhere (phone, another computer), click **Alert me** and enter your max.
- Bid Alerts can't see the winner. "Within your max" and "you may have won" come from comparing prices; check My ShopGoodwill for the result. Automatic bid capture has not yet been checked with a real bid.
- Sound only plays after you've clicked somewhere on a ShopGoodwill page (a browser rule).

## Troubleshooting

| Problem | What to try |
|---|---|
| Times still show PDT/PST | Make sure the script is enabled in Tampermonkey and that the page address starts with `https://shopgoodwill.com` or `https://www.shopgoodwill.com`. Reload the page. |
| Chrome/Edge: script never runs | Turn on **Allow User Scripts** (or **Developer mode**) for Tampermonkey, then reload. |
| Some times convert, others don't | ShopGoodwill may show those times in a different element. See [Updating selectors](#updating-selectors) and open an issue with the element's HTML. |
| A time shows `ET` instead of `EST`/`EDT` | The closing date wasn't found and the time is between 11 PM and 2 AM Pacific. Hover for details. The time itself is still three hours ahead of Pacific. |
| Want the original time | Hover over the converted time. |
| Shipping shows **S&H unavailable** | Hover for ShopGoodwill's reason. Check your ZIP code with **change ZIP**. Some items can't be shipped to every ZIP code. |
| Shipping estimates look out of date | Estimates are kept for six hours. Changing the ZIP code fetches new ones. |
| The tab title keeps showing ⏱ | That's Live Auction following the item. Click the **Live** chip to pause it, or leave the item page. |
| Price Check opens the wrong item | Edit the search terms in the panel, or click **Full title**. |
| No bid alerts | Keep a ShopGoodwill tab open. Check that the item is in the **Bid alerts** list. |
| No desktop notifications | Open **Bid alerts**, tick **Desktop notifications**, and allow notifications for shopgoodwill.com in your browser and operating system. |
| No alert sound | Click anywhere on the page once; browsers block sound until you do. Check that **Sound** is ticked. |
| Outbid alert for a bid I raised | Update **My max bid** on the item page so the alert knows your new max. |

To report a problem, [open an issue](https://github.com/maxhayim/shopgoodwill.com-tools/issues) with the page address, what you saw, and the element's HTML (right-click → **Inspect** → right-click the element → **Copy** → **Copy outerHTML**). Leave out anything personal such as your username or bids.

## Roadmap

Planned tools. Each will be its own script in `scripts/` that can be installed separately.

- Auction watchlist synced with ShopGoodwill favorites
- Auction search improvements
- Optional cross-device synchronization
- Auction history
- Additional time zone options
- Browser extension packaging

## Development

```bash
npm run check   # syntax check every .js file and validate each userscript's metadata
npm test        # run the tests with Node's built-in test runner
```

Node.js 22 or newer. There are no dependencies to install.

Every userscript can be loaded by Node (`require('./scripts/shopgoodwill-shipping.user.js')`): it then exports its functions instead of starting, so the tests run the same code Tampermonkey runs.

### Adding a new tool

1. Add `scripts/shopgoodwill-<tool>.user.js` with its own `==UserScript==` block, `@namespace https://github.com/maxhayim/shopgoodwill.com-tools`, and matching `@updateURL`/`@downloadURL`.
2. Keep page selectors in a `CONFIG` block at the top.
3. Add `tests/<tool>.test.js`.
4. Add a row to the table at the top of this README.
5. Give it its own `@version`, starting at the repository version in `package.json` when it is added.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

MIT License. Copyright (c) 2026 maxhayim. See [LICENSE](LICENSE).

## Acknowledgments

The idea of converting ShopGoodwill's Pacific times with a userscript comes from community ShopGoodwill timezone userscripts. This project's code is an independent implementation and does not include third-party code.

**Disclaimer:** shopgoodwill.com tools is an independent community project. It is not affiliated with, endorsed by, or sponsored by ShopGoodwill.com, Goodwill Industries International, or any Goodwill member organization. "ShopGoodwill" and "Goodwill" are trademarks of their respective owners.
