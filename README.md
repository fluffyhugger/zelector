# Zelector

Record a flow, or pick any element — closed shadow roots included — and get
selectors scored on how likely they are to survive the next deploy. Exports to
Robot Framework, Playwright, Selenium, Puppeteer, Cypress, CSS and XPath.

Free, MIT, no account, nothing leaves the browser.

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

## Record a flow

Click the toolbar icon and pick **Record a flow**, or press `⌥⇧R`. Use the page the way you normally would — clicks, typing
and dropdowns are captured, keystrokes collapse into one `Input Text`, and a
click on a `<span>` inside a button records the button.

What it does not do is ask you to choose a wait every time you click. That
interrupts the flow you are reproducing, and worse, folds your thinking time
into the timings it is measuring. Instead it watches what the page actually did
— which request fired, what appeared, what appeared and then vanished — and
proposes a wait per step, with the reason attached:

```
3  Click Button ▾   button[export-csv]
   wait  Wait Until Element Is Not Visible ▾  <div>  15s
   ⓘ after POST /api/export (780ms), <div> appeared then went away
```

Every row is editable, so you fix the two the recorder got wrong instead of
answering twenty prompts. The suite comes out as a `.robot` file — named after
the test — or on the clipboard. Timeouts come from the time the page actually took,
not a default nobody tunes. `Sleep` is in the dropdown, last, with a warning —
hiding it just means people type it back in by hand.

Assertions are the part no recorder can capture by watching, so the panel keeps
a **＋ Add assertion** button on screen: it opens the picker, and the keyword
list becomes the list of assertions you can append.

The recording survives navigation: it lives in the service worker, and the new
page picks it back up — which also turns the click that navigated into a
`Wait Until Location Contains`.

The panel has a **test** and a **doc** field. The name is seeded from the page
title and becomes the test case heading; the doc becomes its `[Documentation]`,
defaulting to where and when the flow was recorded — which is the question
anyone reading a generated suite six months later actually has.

Output is a full suite: one keyword per element, each waiting for its own
element, with the flow-level waits left visible in the test case. Clicking the
same button twice defines one keyword, not two.

## Install (dev)

```bash
npm install
npm run dev        # rebuilds dist/ on change
```

`chrome://extensions` → Developer mode → Load unpacked → pick `dist/`.

## Shortcuts

| macOS | Windows / Linux | |
|---|---|---|
| `⌥` `⇧` `R` | `Alt` `Shift` `R` | start / stop recording |
| `⌥` `Z` | `Alt` `Z` | toggle the picker |
| `⌥` `⇧` `F` | `Alt` `Shift` `F` | freeze the DOM |
| `↑` `↓` | `↑` `↓` | walk the selection up/down the tree |
| `Esc` | `Esc` | cancel |

Matched on `event.code`, so keyboard layout doesn't matter. If a shortcut does
nothing, something else holds the keys — on Windows `Alt+Z` is the NVIDIA overlay,
which swallows it before Chrome sees it. Rebind at `chrome://extensions/shortcuts`;
the popup marks any shortcut Chrome could not assign, and its buttons always work.

There's also a Zelector tab in DevTools with a history of picks.

## Robot Framework output

Built against libdoc 6.9.0, so locators use the `strategy:value` prefix form (the
`=` form collides with named arguments), `data-testid="x"` becomes `data:testid:x`,
and the keyword follows the element — `Click Button` also matches on `value`,
`Click Link` on `href` and link text, `Click Element` only knows `id` and `name`.
`Select Radio Button` takes `(group_name, value)` rather than a locator.

SeleniumLibrary has no shadow-DOM strategy at all, so elements behind a shadow
boundary export as a `dom:` expression with a warning comment instead of a `css:`
locator that would silently never match.

Nothing crosses an iframe boundary either — Selenium has a current frame, and a
locator only addresses that one — so an element inside a frame gets
`Select Frame` / `Unselect Frame` around it, and a wait on something in the same
frame moves inside that block. The frame's own selector comes from
`window.frameElement`, which means it is generated against the real element
rather than guessed; across an origin boundary that is unreachable, and the
guess is labelled as one.

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
