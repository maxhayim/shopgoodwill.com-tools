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

ShopGoodwill.com shows every auction ending time in Pacific Time. **shopgoodwill.com tools** is a set of small, independent browser userscripts that make the site easier to use, starting with a converter that shows those times in Eastern Time.

Each tool is a single file in [`scripts/`](scripts/). Install only the ones you want.

| Tool | What it does | Install |
|---|---|---|
| **Eastern Time** | Shows auction ending times in Eastern Time (EST/EDT) | [Install](https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-eastern-time.user.js) |

## Features

- Converts auction ending times such as `6:39:00 PM PDT` to `9:39:00 PM EDT`.
- Shows **EST** or **EDT** correctly, including on the nights the clocks change.
- Uses the auction's closing date when it is on the page, never today's date.
- Handles times that cross midnight, for example `10:30:00 PM PST` → `1:30:00 AM EST (next day)`.
- Keeps the original Pacific time in a tooltip: hover over a converted time to see it.
- Works on pages Angular loads or redraws after the page opens (search results, paging, item pages).
- Converts each time once, and converts again only if the site puts a new Pacific time in its place.
- Leaves countdown timers, prices, bid buttons and everything else alone.
- Plain JavaScript: no jQuery, no frameworks, no network requests, no permissions (`@grant none`).

## Requirements

- A desktop browser with a userscript manager. [Tampermonkey](https://www.tampermonkey.net/) is the one this project targets.

## Installation

1. Install the Tampermonkey extension for your browser:
   - [Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - [Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/)
   - [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
   - [Safari](https://www.tampermonkey.net/?browser=safari)
2. In Chrome and Edge, allow userscripts: open the extension's details page and turn on **Allow User Scripts** (or **Developer mode** on older versions).
3. Open the direct install link:
   **[shopgoodwill-eastern-time.user.js](https://raw.githubusercontent.com/maxhayim/shopgoodwill.com-tools/main/scripts/shopgoodwill-eastern-time.user.js)**
4. Tampermonkey shows an install page. Click **Install**.
5. Open or reload [shopgoodwill.com](https://shopgoodwill.com/).

## Usage

There is nothing to set up. Ending times on ShopGoodwill appear in Eastern Time. Hover over a time to see the original Pacific time.

### Examples

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

The script looks for elements matching `li.text-danger` whose text contains a time ending in `PDT`, `PST` or `PT`. It replaces just that time in the element's text and remembers what it wrote, so the next scan skips it. A `MutationObserver` watches for Angular adding or redrawing content and triggers a rescan (debounced, so a burst of changes causes one scan).

### Daylight saving time

Pacific and Eastern Time are three hours apart almost all the time. The exception is the two nights a year the clocks change, because each zone changes at 2 AM *its own* local time:

- **Spring (2nd Sunday of March):** from 11 PM to 2 AM Pacific, Eastern is already on EDT while Pacific is still on PST, so the gap is **4 hours**.
- **Fall (1st Sunday of November):** from 11 PM to 2 AM Pacific, Eastern is already back on EST while Pacific is still on PDT, so the gap is **2 hours**.

When the auction's closing date is available, either in the same text as the time or in the same listing, the script works out the exact moment and gets these nights right.

When the date is **not** available, the script adds three hours, like the original script. If the time is between 2 AM and 11 PM Pacific and the site says `PDT` or `PST`, the result is exact and shown as `EDT` or `EST`. If the time is between 11 PM and 2 AM, or the site only says `PT`, the script shows the neutral `ET` and says in the tooltip that EST/EDT could not be confirmed.

The script uses the US daylight-saving rules in force since 2007. Its results were checked against the system time zone database for every half hour from 2025 to 2028.

### Updating selectors

ShopGoodwill can change its markup at any time. Everything page-specific is in the `CONFIG` block at the top of [`scripts/shopgoodwill-eastern-time.user.js`](scripts/shopgoodwill-eastern-time.user.js):

```javascript
var CONFIG = {
  timeSelectors: ['li.text-danger'],   // elements that hold the Pacific time
  dateSearchLevels: 2,                 // how far up to look for the closing date
  dateSearchMaxTextLength: 600,        // skip ancestors bigger than this
  rescanDelayMs: 150,                  // wait after page changes before rescanning
  attrPrefix: 'data-sgw-et'            // attributes used to remember conversions
};
```

If times stop converting:

1. On ShopGoodwill, right-click an ending time and choose **Inspect**.
2. Note the element's tag and classes (for example `<li class="text-danger">`).
3. Add a CSS selector for it to `timeSelectors`. Keep it narrow: the script only converts text that ends in `PDT`, `PST` or `PT`, but a narrow selector keeps it away from unrelated parts of the page.
4. Run `npm test`, then open a pull request.

## Automatic Updates

The script's `@updateURL` and `@downloadURL` point at the copy on the `main` branch. Tampermonkey checks it on its normal schedule (daily by default) and installs a new version when the `@version` number goes up. To check right away, open the Tampermonkey dashboard and choose **Check for userscript updates**.

## Browser Compatibility

The script uses only standard JavaScript and DOM features (`MutationObserver`, `querySelectorAll`) available in every current browser. It is written for Tampermonkey on desktop Chrome, Edge, Firefox and Safari. Other userscript managers (Violentmonkey, Greasemonkey 4, Userscripts for Safari) should work but have not been tested.

## Known Limitations

- **Not yet checked on the live site by this project.** The selector and behaviour come from the original working script and a real ShopGoodwill element (`<li class="text-danger">6:39:00 PM PDT</li>`). The automated tests use a small stand-in DOM, not a real browser.
- The closing date is only used when it appears in the time's own text or in the same listing. If ShopGoodwill does not show it near the time, the script falls back to adding three hours as described above.
- Only US daylight-saving rules from 2007 onward are built in. If Congress changes them, the script will need an update.
- Converts to Eastern Time only. Other time zones are on the roadmap.

## Troubleshooting

| Problem | What to try |
|---|---|
| Times still show PDT/PST | Make sure the script is enabled in Tampermonkey and that the page address starts with `https://shopgoodwill.com` or `https://www.shopgoodwill.com`. Reload the page. |
| Chrome/Edge: script never runs | Turn on **Allow User Scripts** (or **Developer mode**) for Tampermonkey, then reload. |
| Some times convert, others don't | ShopGoodwill may show those times in a different element. See [Updating selectors](#updating-selectors) and open an issue with the element's HTML. |
| A time shows `ET` instead of `EST`/`EDT` | The closing date wasn't found and the time is between 11 PM and 2 AM Pacific. Hover for details. The time itself is still three hours ahead of Pacific. |
| Want the original time | Hover over the converted time. |

To report a problem, [open an issue](https://github.com/maxhayim/shopgoodwill.com-tools/issues) with the page address, what you saw, and the element's HTML (right-click → **Inspect** → right-click the element → **Copy** → **Copy outerHTML**). Leave out anything personal such as your username or bids.

## Roadmap

Planned tools. None are implemented yet; each will be its own script in `scripts/` that can be installed separately.

- Auction watchlist
- Auction-ending notifications
- Outbid alerts
- Auction search improvements
- Optional cross-device synchronization
- Auction history
- Additional time zone options
- Browser extension packaging

## Development

```bash
npm run check   # syntax check every .js file and confirm @version matches package.json
npm test        # run the tests with Node's built-in test runner
```

Node.js 22 or newer. There are no dependencies to install.

The userscript can be loaded by Node (`require('./scripts/shopgoodwill-eastern-time.user.js')`): it then exports its functions instead of starting, so the tests run the same code Tampermonkey runs.

### Adding a new tool

1. Add `scripts/shopgoodwill-<tool>.user.js` with its own `==UserScript==` block, `@namespace https://github.com/maxhayim/shopgoodwill.com-tools`, and matching `@updateURL`/`@downloadURL`.
2. Keep page selectors in a `CONFIG` block at the top.
3. Add `tests/<tool>.test.js`.
4. Add a row to the table at the top of this README.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

MIT License. Copyright (c) 2026 maxhayim. See [LICENSE](LICENSE).

## Acknowledgments

The idea of converting ShopGoodwill's Pacific times with a userscript comes from community ShopGoodwill timezone userscripts. This project's code is an independent implementation and does not include third-party code.

**Disclaimer:** shopgoodwill.com tools is an independent community project. It is not affiliated with, endorsed by, or sponsored by ShopGoodwill.com, Goodwill Industries International, or any Goodwill member organization. "ShopGoodwill" and "Goodwill" are trademarks of their respective owners.
