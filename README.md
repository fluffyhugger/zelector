# Zelector

Pick any element on a page, including inside closed shadow roots, and get every
reasonable selector for it, scored on how likely it is to survive the next deploy.
Exports to Playwright, Selenium, Puppeteer, Cypress, Robot Framework, CSS and XPath.

## Why

Right-click, Copy selector, and Chrome hands you `div > div:nth-child(3) > button`.
That dies the moment somebody wraps the button in a flex container. DevTools has no
opinion on which selectors last, and it can't help at all when the element is behind
a hover menu that closes the second you reach for DevTools, or inside
`#shadow-root (closed)`.

Zelector freezes the DOM to hold those menus open, walks closed shadow roots through
an `attachShadow` hook installed at `document_start`, and penalises generated class
names (`css-1x9d8f`, `Button_root__3kD9a`, `_ngcontent-…`) instead of offering them
as if they were stable.

## Install (dev)

```bash
npm install
npm run dev        # rebuilds dist/ on change
```

`chrome://extensions` → Developer mode → Load unpacked → pick `dist/`.

## Shortcuts

| macOS | Windows / Linux | |
|---|---|---|
| `⌥` `Z` | `Alt` `Z` | toggle the picker |
| `⌥` `⇧` `F` | `Alt` `Shift` `F` | freeze the DOM |
| `↑` `↓` | `↑` `↓` | walk the selection up/down the tree |
| `Esc` | `Esc` | cancel |

Matched on `event.code`, so keyboard layout doesn't matter. If a shortcut does
nothing, another extension has claimed it — rebind at `chrome://extensions/shortcuts`.
The toolbar icon always works. There's also a Zelector tab in DevTools with a history
of picks.

## Robot Framework output

Built against libdoc 6.9.0, so locators use the `strategy:value` prefix form (the
`=` form collides with named arguments), `data-testid="x"` becomes `data:testid:x`,
and the keyword follows the element — `Click Button` also matches on `value`,
`Click Link` on `href` and link text, `Click Element` only knows `id` and `name`.
`Select Radio Button` takes `(group_name, value)` rather than a locator.

SeleniumLibrary has no shadow-DOM strategy at all, so elements behind a shadow
boundary export as a `dom:` expression with a warning comment instead of a `css:`
locator that would silently never match.

Snippets are checked against the real parser — `npm run test:robot`.

## How it's wired

MV3 forbids `chrome.*` in the MAIN world and hides closed shadow roots from the
isolated world, so the work is split:

```
main-world.js   MAIN, document_start
                ├─ hooks.ts    patches attachShadow / fetch / XHR before page scripts
                ├─ picker.ts   overlay, deep elementFromPoint, freeze
                └─ hud.ts      result card (its own closed shadow root)
                      │ window.postMessage
content.js      ISOLATED — pure relay, no DOM logic
                      │ chrome.runtime
background.js   commands, badge, pick history
panel.js        DevTools panel
```

All DOM logic lives in the MAIN world because that's the only place closed shadow
roots are reachable. The isolated script exists solely to reach `chrome.runtime`.

There's no `innerHTML` anywhere either: pages sending `require-trusted-types-for
'script'` reject every sink that takes an HTML string, so nodes are built by hand in
`src/main-world/dom-build.ts`.

## Scoring

`src/core/volatility.ts` sorts identifiers into volatile (hashed by a build tool),
utility (stable but meaningless, like Tailwind classes) and stable.
`src/core/selector.ts` then emits candidates in order of preference: test attributes,
`id`, `getByRole`, `getByLabel` / `name=`, `aria-label`, text, other semantic
attributes, class combination, structural path.

## Roadmap

More coming soon.

---

Built by Sirapob Wuth — [GitHub](https://github.com/fluffyhugger) · [LinkedIn](https://www.linkedin.com/in/sirapob/) · [MIT](LICENSE)
