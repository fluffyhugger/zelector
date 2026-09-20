# Changelog

## 0.3.0 — unreleased

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
