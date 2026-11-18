# Security Policy – shopgoodwill.com tools

shopgoodwill.com tools are userscripts that run inside your browser on ShopGoodwill.com, the site where you are signed in and bid with real money. Security matters.

## Reporting a Vulnerability

If you find a security problem:

- Do NOT open a public issue.
- Use GitHub's [Private Vulnerability Reporting](https://github.com/maxhayim/shopgoodwill.com-tools/security/advisories/new).
- Include:
  - A clear description of the issue
  - Steps to reproduce
  - Affected version(s)
  - Any screenshots or logs (with personal details removed)

Please allow reasonable time for a fix before public disclosure.

## Supported Versions

| Version | Supported |
|---|---|
| 1.x (latest) | Yes |
| Older | No |

Tampermonkey installs updates automatically, so only the latest release receives fixes.

## Secure Development Practices

- Scripts run with `@grant none`: no special userscript permissions.
- Scripts only contact ShopGoodwill itself (`buyerapi.shopgoodwill.com`, the site's own API). Price Check builds links to other marketplaces but never fetches from them.
- The only data stored is your shipping ZIP code, cached estimates, followed auctions and alert settings, in your browser's storage for shopgoodwill.com.
- Scripts never read or use your login, password, session cookies or tokens. Bid Alerts reads only the site's reply to a bid (accepted or not, item and amount) and passes the request and reply through unchanged.
- Scripts never place bids, click buttons or submit forms.
- Scripts never insert HTML built from page or API data; text from ShopGoodwill is always set as plain text.
- No third-party code or dependencies are bundled.
- Updates are served only from this repository's `main` branch over HTTPS.
