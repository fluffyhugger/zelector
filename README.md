# Zelector

> The selector inspector DevTools should have been.

Pick any element on a page — including inside **closed** shadow roots — and get
every reasonable selector for it, each scored on how likely it is to survive the
next deploy. Then export to Playwright, Selenium, Puppeteer, Cypress or raw CSS.

## Why

Chrome DevTools' "Copy selector" hands you `div > div:nth-child(3) > button` and
walks away. It also cannot show you:

| | DevTools | Zelector |
|---|---|---|
| Hover menus / tooltips | close the moment you reach for DevTools | **Freeze DOM** keeps them open |
| `#shadow-root (closed)` | opaque | walked, via an `attachShadow` hook installed at `document_start` |
| Selector durability | no opinion | 0–100 score with the reasons shown |
| Generated classes (`css-1x9d8f`, `_ngcontent-…`) | offered as if they were stable | detected and penalised |
| JSON field → DOM node | two panels, manual | (v0.3) one click |

## Install (development)

```bash
npm install
npm run dev        # rebuilds dist/ on change
```

Then: `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select the `dist/` folder.

## Use

| macOS | Windows / Linux | Action |
|---|---|---|
| `⌥` `Z` | `Alt` `Z` | toggle the element picker |
| `⌥` `⇧` `F` | `Alt` `Shift` `F` | freeze the DOM — hover menus stay open while you inspect |
| `↑` `↓` | `↑` `↓` | walk the selection up/down the tree without moving the mouse |
| `Esc` | `Esc` | cancel |

On macOS `⌥` is the **Option** key. Shortcuts are matched on `event.code`, so they
work regardless of keyboard layout — Option is a compose modifier on macOS and
would otherwise report `Ω` instead of `z`.

If a shortcut does nothing, another extension has claimed it: open
`chrome://extensions/shortcuts` and rebind. Clicking the toolbar icon always works.

A **Zelector** tab also appears in DevTools with a history of picks.

## Export targets

Robot Framework / SeleniumLibrary, Playwright (TS + Python), Selenium (Python + Java),
Puppeteer, Cypress, raw CSS, XPath, JSON.

### Robot Framework notes

The SeleniumLibrary output is built against **libdoc 6.9.0**, not from memory:

- Locators use the preferred `strategy:value` prefix form, never `strategy=value` —
  the latter collides with Robot's named-argument syntax.
- `data-testid="x"` becomes `data:testid:x`; the `data` strategy strips the `data-`
  prefix itself.
- The action keyword follows the element: `Click Button` / `Click Link` /
  `Input Password` / `Select From List By Label` / `Select Checkbox` / `Choose File`.
  This matters — `Click Button` also matches on `value`, `Click Link` on `href` and
  link text, while `Click Element` only knows `id` and `name`.
- `Select Radio Button` is special-cased: its signature is `(group_name, value)`,
  **not** a locator, so it renders the group's `name` and the button's `value`
  instead of a locator variable.
- **SeleniumLibrary has no shadow-DOM locator strategy** (grep the whole libdoc:
  zero hits for "shadow"). Elements behind a shadow boundary therefore export as a
  `dom:` expression with an explicit warning comment, rather than a `css:` locator
  that would silently never match.

Every generated snippet is checked against the real Robot Framework parser
(`robot.api.get_model`) — see `npm run test:robot`.

## How it is wired

MV3 forbids `chrome.*` in the MAIN world and hides closed shadow roots from the
isolated world, so the work is split:

```
main-world.js   MAIN, document_start
                ├─ hooks.ts    patches attachShadow / fetch / XHR before page scripts run
                ├─ picker.ts   overlay, deep elementFromPoint, freeze
                └─ hud.ts      result card (its own closed shadow root)
                      │ window.postMessage
content.js      ISOLATED — pure relay, no DOM logic
                      │ chrome.runtime
background.js   commands, badge, pick history
panel.js        DevTools panel
```

All DOM logic lives in the MAIN world because that is the only place the closed
shadow roots are reachable. The isolated script exists solely to reach
`chrome.runtime`.

## Scoring

`src/core/volatility.ts` decides whether an identifier is durable. Three buckets:

- **volatile** — hashed by a build tool (`css-*`, `sc-*`, CSS-modules, Angular
  encapsulation, React `useId`, UUIDs, high-entropy strings). Heavily penalised.
- **utility** — stable but meaningless for identity (Tailwind, layout classes).
  Ignored when building class selectors.
- **stable** — everything else.

`src/core/selector.ts` then emits candidates in this order of preference:
test attributes → `id` → `getByRole` → `getByLabel` / `name=` → `aria-label` →
text → other semantic attributes → class combination → structural path.

## Roadmap

- [x] **v0.1** picker, closed shadow DOM, freeze, scoring, code export
- [ ] **v0.2** same-origin iframe traversal, virtualized-list row patterns, DOM snapshot freeze
- [ ] **v0.3** click a JSON field in a captured response → JSONPath; auto-match DOM text ↔ API field
- [ ] **v0.4** Page Map export (generated Page Object Model + TypeScript types from real responses)
- [ ] **v0.5** user-editable export templates

---

Built by **Sirapob Wuth** — [GitHub](https://github.com/fluffyhugger) · [LinkedIn](https://www.linkedin.com/in/sirapob/) · [MIT](LICENSE)
