# Changelog

## 0.4.0 — 22 September 2026

Submitted over 0.3.0 while that was still in review, because one of these is
a shortcut that does nothing on a large share of Windows machines and the rest
are recordings that came out empty.

### Recordings that came out empty

- **A rich text editor recorded nothing at all.** A contenteditable has no
  value, so the input handler returned before it began, and its element is
  usually a `<body>` or a `<div>`, so the click that focuses it was dropped as
  structure. TinyMCE, CKEditor, Quill and ProseMirror all put one on a page.
  The keystrokes come out as `Press Keys`, taken from the events rather than
  read back off the element — the element's text is everything it already held.
- **A drag the browser runs recorded nothing either.** `draggable="true"` hands
  the gesture to the browser and pointer events stop arriving. It replays
  through a keyword that dispatches the drag events, because Selenium's
  `Drag And Drop` is pointer actions and Chrome does not turn those into a
  native drag.

### Suites that could not replay

- **Alt+Z on Windows belongs to the NVIDIA overlay**, which takes it before
  Chrome sees it. The picker's shortcut is Alt+Shift+Z there now; macOS keeps
  Alt+Z. The popup shows what Chrome actually assigned and offers to open the
  shortcuts page when it could not assign one.
- **A React page hydrates after it loads** and replaces the nodes it just
  rendered: the first step found its element, reached for it, and got
  StaleElementReferenceException — two runs in three on Ant Design's form page.
  The suite setup waits for the DOM to hold still first.
- **A shadow chain threw instead of waiting** when the host at its head was not
  on the page. `?.` at every link, so it times out naming the locator.
- **A backslash in a host's attribute** survived two of the three readers
  between the file and the element.
- **A generated keyword could be called `Click Button`**, which is
  SeleniumLibrary's own — and Robot resolves a suite's keywords first, so it
  called itself.
- **A recorded file upload stopped at "Variable '${FILE_PATH}' not found"**, a
  message about Robot syntax for a missing file. The name is declared now.

### The shape of the suite

- The browser opens in `Suite Setup`, closes in `Suite Teardown`, and the test
  case is the flow and nothing else.
- `[Tags]    recorded    <site>`.
- A path anchored on something says the two ends rather than every step
  between: `#form-demo button[type="submit"]` instead of seven levels of
  nth-of-type.

### Scoring

- A test hook carrying a record id — `data-test="category-01M2ZB0KQP…"` — is
  marked: the attribute is durable and the value belongs to one seeded
  database.
- A path anchored on a component-library counter inherits the counter's
  warning.
- An editor is not named after its contents.

### Kept honest

- Playwright, Puppeteer and Cypress export targets removed: nothing here was
  being done for them, and the store read the list in the description as
  keyword spam.
- A pass that fails on code nothing reaches, after three dead things in two
  days — one of which shipped in 0.2.0.
- The listing is 2,000 characters rather than 5,800.

## 0.3.0 — 20 September 2026

Two days of recording real pages rather than reading the code. Every entry
below is something a recording got wrong on a site that exists, and most of
them were found by running the suite that came out rather than by reading it.

### Recordings that could not replay

- **Native dialogs were never generated.** `renderDialog` was written,
  documented, and never called: an alert step fell through to the ordinary path
  and came out as a click on `css:html`, which does nothing, so the dialog
  stayed up and blocked every step after it. The panel, the capture tests and a
  dead renderer all agreed it worked; none of them was the generator. If you
  recorded a confirm on 0.2.0, this is why it hung.
- **A wait could be handed to the step that caused it.** Type, pause half a
  second, then press: the window that watches the page had gone quiet and the
  typing had not been flushed, so the press landed in the gap and the window
  opened afterwards was already watching the calendar that press opened. The
  step that opens a date picker was told to wait for the picker first.
- **A hashed id outscored the structural path.** React 19's `useId` values
  (`_R_ajekmbjqfsua_`) were being emitted as the best locator a page had. They
  are regenerated on every render.
- **A state class could become the locator.** Element Plus recorded as
  `css:div.el-select__wrapper.is-focused` — a class that only exists once the
  select has been clicked, which is the thing the step was there to click.
- **camelCase ids were read as hashes.** `dateOfBirthInput` scored as
  high-entropy and was thrown out, so DemoQA's date field fell back to a class
  react-datepicker only adds while the calendar is open.
- **Clicks under a sticky bar.** WebDriver scrolls an element the smallest
  distance that puts it in the viewport, which parks it against the edge an ad
  footer is pinned to. Suites recorded on such a page now define one
  `Bring Into View` keyword: it waits for the element to hold the same box for
  two frames on screen, then centres it.
- **Clicks at a banner that had not landed.** `Wait Until Element Is Visible`
  returns while a banner is still sliding; the same helper covers it.
- **Every click that navigated also got a `Go To`.** The rule was a stopwatch,
  and data.go.th takes six seconds to load. A link says where it was going.
- **Replay at the recorded window size.** `Maximize Browser Window` does
  nothing in headless Chrome, which is where CI runs, leaving 800x600 — narrow
  enough that a responsive site folds its navigation away and the suite waits
  for a link that was never rendered.

### The shape of the suite

- The browser opens in `Suite Setup` and closes in `Suite Teardown`, so the
  test case is the flow and nothing else. A suite with one test reads the same
  either way; the one somebody adds a second test to does not.
- `[Tags]    recorded    <site>` — what a team excludes from a curated run, and
  what they select when one site is the one being worked on.
- The setup waits for the page to stop changing before the first step. A React
  page hydrates after it loads and replaces the nodes it just rendered: the
  first step finds its element, reaches for it, and gets
  StaleElementReferenceException. Two runs in three on Ant Design's form page,
  and four out of four after.

### Recorded for the first time

- Double click and right click — `Double Click Element`, `Open Context Menu`.
  Nothing else reports them.
- `<select multiple>`: one step carrying every label, because `change` fires
  per option and a multiple select does not accumulate across calls.
- Element names in the language of the page. `[^\w\s-]` was deleting every
  non-Latin character, so a button reading ยืนยันการสั่งซื้อ became
  `${BUTTON_TARGET}`.

### Tests

- **libdoc** — every keyword the generator emits, checked against
  SeleniumLibrary's own documentation: does it exist, does it take these
  arguments. The list of keywords a recording cannot reach is how the missing
  dialogs were found.
- **navigation** — which navigations a click explains.
- **capture** — seventeen recordings at 0.2.0, twenty-five now.
- Everything runs on every push.

## 0.2.0 — submitted 18 September 2026

First submission to the Chrome Web Store. Element picker with locator scoring,
flow recording to a Robot Framework suite, wait inference, closed shadow roots,
iframes, and single-element export to Playwright, Puppeteer, Cypress, Selenium
(Python and Java), CSS, XPath and JSON.
