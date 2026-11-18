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
- Scripts make no network requests and store no data.
- Scripts never place bids, click buttons or submit forms.
- Scripts only change the text of the elements they convert, and never insert HTML.
- No third-party code or dependencies are bundled.
- Updates are served only from this repository's `main` branch over HTTPS.
