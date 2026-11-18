# Contributing to shopgoodwill.com tools

Thanks for your interest in improving shopgoodwill.com tools.

## Ways to contribute

- Report a bug or a page where a tool stops working, using [GitHub Issues](../../issues). Include the page address and the element's HTML (right-click → **Inspect** → **Copy outerHTML**). Leave out your username, bids and anything else personal.
- Suggest a feature, or pick one from the roadmap in the README.
- Improve the documentation.
- Send a pull request with a fix or a new tool.

## Ground rules

- **Plain JavaScript, no dependencies.** No jQuery, frameworks or build step. Each tool must work when pasted into Tampermonkey as a single file.
- **One tool per file** in `scripts/`, named `shopgoodwill-<tool>.user.js`, with its own complete `==UserScript==` block.
- **Keep selectors in `CONFIG`** at the top of the script so they can be updated in one place.
- **Never change bidding.** Tools may read and decorate the page, but must not place bids, click buttons or submit forms on the user's behalf.
- **No tracking.** Tools must not send data anywhere unless that is the feature and the user turns it on.
- **Make scripts loadable by Node** so tests run the real code: export the functions when `module` exists, start on the page otherwise. See the Eastern Time script for the pattern.

## Before opening a pull request

```bash
npm run check
npm test
```

Both must pass. CI runs the same commands on Node.js 22 and 24.

If you change a userscript, bump its `@version` and the `version` in `package.json` (they must match), and add an entry to `CHANGELOG.md`. Versions follow [Semantic Versioning](https://semver.org/):

- **Patch** (1.0.1): bug fixes and selector updates
- **Minor** (1.1.0): new features or new tools
- **Major** (2.0.0): changes that alter existing behaviour in a way users would notice

Say in the pull request whether you tested on the live site, and in which browser. Don't describe a change as tested in a browser unless it was.

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE). Only submit code you wrote yourself or code whose license allows it, and say where any borrowed code came from.
