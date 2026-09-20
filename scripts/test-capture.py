"""
The capture layer, driven by a real browser.

Everything else here is checked by parsing the output. The part that decides
what the output says has been checked by hand, which is how two fixes in one
evening broke something else without anyone noticing until the next recording.

Each case below is a bug that actually happened. They are driven through
WebDriver rather than synthesised, because every one of them came from the gap
between what an event reports and what the page had already done about it:
label activation arriving twice, a calendar opening on focus before the click,
a menu sliding under the cursor before the click lands. Dispatching fake events
would reproduce none of that.

    python3 scripts/test-capture.py          headless
    HEADED=1 python3 scripts/test-capture.py watch it happen
"""
import http.server
import json
import os
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys

ROOT = Path(__file__).resolve().parent.parent
PAGES = ROOT / "scripts" / "capture" / "pages"


def build(serve_dir: Path) -> None:
    """Bundle the recorder into the pages, exactly as the extension would."""
    shutil.copytree(PAGES, serve_dir, dirs_exist_ok=True)
    subprocess.run(
        ["npx", "esbuild", "scripts/capture/harness.ts", "--bundle", "--format=iife",
         "--platform=browser", "--alias:@=./src", f"--outfile={serve_dir / 'harness.js'}",
         "--log-level=error"],
        cwd=ROOT, check=True,
    )


def serve(directory: Path):
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(
        *a, directory=str(directory), **kw
    )
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def browser():
    options = Options()
    if not os.environ.get("HEADED"):
        options.add_argument("--headless=new")
    options.add_argument("--window-size=1200,900")
    return webdriver.Chrome(options=options)


class Case:
    """One page, one scripted interaction, one set of expectations."""

    def __init__(self, name, page, run, expect):
        self.name, self.page, self.run, self.expect = name, page, run, expect


def steps(driver):
    return driver.execute_script("return window.__zelector.steps()")


def locator(driver, selector):
    return driver.execute_script("return window.__zelector.locator(arguments[0])", selector)


def candidates(driver, selector):
    return driver.execute_script("return window.__zelector.candidates(arguments[0])", selector)


def check_scoring(driver):
    """
    The scorer, against a real layout rather than a described one.

    Written as its own pass because the rest of this file drives the recorder,
    and what is being asked here is narrower: given an element, which handle
    does the tool reach for, and does it refuse the ones that mean nothing.
    """
    problems = []

    def expect(selector, wanted, why):
        got = locator(driver, selector)
        if not got or got["value"] != wanted:
            problems.append(f"{selector}: expected {wanted}, got {got and got['value']}  ({why})")

    def expect_note(selector, fragment, why):
        got = locator(driver, selector)
        if not got or fragment not in (got["note"] or ""):
            problems.append(
                f"{selector}: expected a note about {fragment!r}, got "
                f"{got and got['note']!r}  ({why})")

    def expect_fragile(selector, fragile, why):
        got = locator(driver, selector)
        if not got or got["fragile"] != fragile:
            problems.append(
                f"{selector}: expected fragile={fragile}, got {got and got['fragile']}  ({why})")

    expect("#save", "data:testid:save-order", "a test hook outranks the id beside it")
    expect("#cancel", "id:cancel", "an id, with nothing better on offer")
    expect("[name=email]", "name:email", "a form field's name")
    expect('[aria-label="Close dialog"]', 'css:[aria-label="Close dialog"]',
           "the label, not the emotion class next to it")
    expect('a[href="/users/1"]', 'css:a[href="/users/1"]',
           "two links read the same, so the text cannot be the locator")

    # A counter id is usable and has to say so. Three libraries hand them out,
    # and the warning is the whole of what separates them from a real id: the
    # number is render order, and render order is not a name.
    expect("#mat-select-0", "id:mat-select-0", "Angular Material's counter, with nothing better on offer")
    expect_fragile("#mat-select-0", True, "a counter moves when anything renders before it")
    expect_note("#mat-select-0", "counter", "the warning is what makes a counter id honest")

    expect("#el-id-1024-3", "id:el-id-1024-3", "a counter id, with nothing better on the element")
    expect_fragile("#el-id-1024-3", True, "a counter moves when anything renders before it")
    expect_note("#el-id-1024-3", "counter", "Element Plus hands these out the same way")
    if any("is-focused" in c["value"] for c in (candidates(driver, "#el-id-1024-3") or [])):
        problems.append("a state class was offered as a handle")

    expect("#dateOfBirthInput", "id:dateOfBirthInput",
           "a camelCase name reads as high entropy, and is still a name")

    expect("#pay", "id:pay", "the id, not the Vue scoped-style hash stamped beside it")

    expect_fragile("#save", False, "a data-testid is what the page offered for this")
    expect_fragile("#rows li:nth-of-type(2) .cell", True,
                   "nothing here identifies the row but its position")

    # The classes on that button say nothing about which button it is.
    shrink = locator(driver, ".shrink-0")
    if shrink and "shrink" in shrink["value"]:
        problems.append(f"a Tailwind utility became the locator: {shrink['value']}")

    # A React 19 useId value resolves fastest and survives nothing. The id
    # branch used to read the attribute without asking the scorer at all.
    submit = locator(driver, "#_R_ajekmbjqfsua_")
    if submit and "_R_" in submit["value"]:
        problems.append(f"a regenerated id became the locator: {submit['value']}")

    # Nothing should reach for a scoped-style attribute, at any score.
    if any("data-v-" in c["value"] for c in (candidates(driver, "#pay") or [])):
        problems.append("a Vue scoped-style attribute was offered as a handle")

    # And the scorer should not be offering a generated class as identity.
    close = candidates(driver, '[aria-label="Close dialog"]') or []
    if any("css-1x9d8f" in c["value"] and c["score"] > 40 for c in close):
        problems.append("an emotion class scored as though it identified something")

    return problems


# ── The cases ────────────────────────────────────────────────────────────────

def typing(driver):
    field = driver.find_element(By.ID, "q")
    field.click()
    field.send_keys("hel")
    time.sleep(1.2)          # longer than the typing idle timer, on purpose
    field.send_keys("lo")
    time.sleep(1.2)


def date_field(driver):
    driver.find_element(By.ID, "dob").click()
    time.sleep(1.0)
    driver.find_element(By.ID, "day-9").click()
    time.sleep(1.0)


def date_after_typing(driver):
    phone = driver.find_element(By.ID, "phone")
    phone.click()
    phone.send_keys("0812345678")
    # No pause: the typing is still buffered when the next press arrives, which
    # is the ordering the real recording had.
    driver.find_element(By.ID, "dob").click()
    time.sleep(1.2)
    driver.find_element(By.ID, "day-9").click()
    time.sleep(1.0)


def date_after_a_pause(driver):
    """
    Type, think for half a second, then press the date field.

    The window that watches the page goes quiet after 400ms and the typing is
    not flushed for 700ms, so a pause between the two lands in the gap: the
    press arrives with no window open to close, and the window that opens when
    the typing is finally flushed is already watching the calendar this press
    opened.
    """
    phone = driver.find_element(By.ID, "phone")
    phone.click()
    phone.send_keys("0812345678")
    time.sleep(0.5)
    driver.find_element(By.ID, "dob").click()
    time.sleep(1.2)
    driver.find_element(By.ID, "day-9").click()
    time.sleep(1.0)


def dialogs(driver):
    driver.find_element(By.ID, "warn").click()
    driver.switch_to.alert.accept()
    time.sleep(0.8)
    driver.find_element(By.ID, "ask").click()
    driver.switch_to.alert.dismiss()
    time.sleep(0.8)
    driver.find_element(By.ID, "name").click()
    alert = driver.switch_to.alert
    alert.send_keys("Somebody")
    alert.accept()
    time.sleep(0.8)


def enter_key(driver):
    field = driver.find_element(By.ID, "q")
    field.click()
    field.send_keys("shoes")
    field.send_keys(Keys.RETURN)
    time.sleep(1.2)


def upload(driver):
    sample = Path(tempfile.gettempdir()) / "zelector-sample.png"
    sample.write_bytes(b"\x89PNG\r\n\x1a\n")
    # send_keys on a file input is how WebDriver sets one; it fires change the
    # same way choosing a file does.
    driver.find_element(By.ID, "avatar").send_keys(str(sample))
    time.sleep(1.2)


def drag(driver):
    card = driver.find_element(By.ID, "card-1")
    done = driver.find_element(By.ID, "done")
    ActionChains(driver).click_and_hold(card).move_to_element(done).pause(0.3).release().perform()
    time.sleep(1.2)


def hover_menu(driver):
    chain = ActionChains(driver)
    chain.move_to_element(driver.find_element(By.ID, "file")).pause(0.6)
    chain.click(driver.find_element(By.ID, "export")).perform()
    time.sleep(1.2)


def hover_past(driver):
    # Across a menu title and on to a button that was always there. The pointer
    # passing over something is not a step.
    chain = ActionChains(driver)
    chain.move_to_element(driver.find_element(By.ID, "edit")).pause(0.4)
    chain.click(driver.find_element(By.ID, "plain")).perform()
    time.sleep(1.2)


def hover_css(driver):
    chain = ActionChains(driver)
    chain.move_to_element(driver.find_element(By.ID, "card")).pause(0.5)
    chain.click(driver.find_element(By.ID, "profile")).perform()
    time.sleep(1.2)


def plain_link(driver):
    driver.find_element(By.ID, "plain-link").click()
    time.sleep(1.2)


def checkbox(driver):
    label = driver.find_element(By.CSS_SELECTOR, "label[for=agree]")
    label.click()
    time.sleep(1.0)
    label.click()
    time.sleep(1.0)


def dropdown(driver):
    driver.find_element(By.ID, "control").click()
    time.sleep(1.0)
    driver.find_element(By.ID, "opt-b").click()
    time.sleep(1.0)


def portal_select(driver):
    driver.find_element(By.ID, "_R_ajekmbjqfsua_").click()
    time.sleep(1.0)
    driver.find_element(By.CSS_SELECTOR, '.ant-select-dropdown [title="b11"]').click()
    time.sleep(1.0)


def multi_select(driver):
    # Ctrl-clicking a second option is how a person adds to a selection; the
    # Select helper does the same thing without depending on the modifier key.
    from selenium.webdriver.support.ui import Select
    picker = Select(driver.find_element(By.ID, "tags"))
    picker.select_by_visible_text("Urgent")
    time.sleep(0.5)
    picker.select_by_visible_text("Gift")
    time.sleep(1.2)


def double_click(driver):
    ActionChains(driver).double_click(driver.find_element(By.ID, "cell")).perform()
    time.sleep(1.2)


def right_click(driver):
    ActionChains(driver).context_click(driver.find_element(By.ID, "row")).perform()
    time.sleep(1.0)
    driver.find_element(By.ID, "rename").click()
    time.sleep(1.0)


def under_a_bar(driver):
    button = driver.find_element(By.ID, "submit")
    driver.execute_script("arguments[0].scrollIntoView({block:'center'})", button)
    time.sleep(0.4)
    button.click()
    time.sleep(1.2)


def combobox(driver):
    # On the padding, the way a person clicks a dropdown — not on the text.
    control = driver.find_element(By.ID, "control")
    ActionChains(driver).move_to_element_with_offset(control, 0, -22).click().perform()
    time.sleep(1.0)
    driver.find_element(By.ID, "opt-nsw").click()
    time.sleep(1.0)


def combobox_typed(driver):
    control = driver.find_element(By.ID, "control")
    ActionChains(driver).move_to_element_with_offset(control, 0, -22).click().perform()
    time.sleep(0.4)
    driver.find_element(By.ID, "typed").send_keys("new")
    time.sleep(1.2)


def container(driver):
    form = driver.find_element(By.ID, "userForm")
    ActionChains(driver).move_to_element_with_offset(form, 5, 5).click().perform()
    time.sleep(1.0)
    driver.find_element(By.ID, "real").click()
    time.sleep(1.0)


def foreign(driver):
    driver.find_element(By.ID, "go").click()
    time.sleep(1.5)
    driver.find_element(By.ID, "go").click()
    time.sleep(1.0)


def rerender(driver):
    driver.find_element(By.ID, "sort").click()
    time.sleep(1.5)
    driver.find_element(By.ID, "after").click()
    time.sleep(1.0)


CASES = [
    Case(
        "one field, one step, however long the pause",
        "typing.html", typing,
        lambda s: [
            (len(s) == 1, f"expected one step, got {len(s)}: {[x['keyword'] for x in s]}"),
            (s and s[0]["keyword"] == "Input Text", f"keyword was {s[0]['keyword'] if s else None}"),
            (s and s[0].get("value") == "hello", f"value was {s[0].get('value') if s else None}"),
        ],
    ),
    Case(
        "a click that opens something is kept",
        "datefield.html", date_field,
        lambda s: [
            (len(s) == 2, f"expected two steps, got {len(s)}: {[x['keyword'] for x in s]}"),
            (s and s[0]["keyword"] == "Click Element", f"first step was {s[0]['keyword'] if s else None}"),
            (s and s[0]["locator"] == "id:dob", f"first step targeted {s[0]['locator'] if s else None}"),
            # The calendar belongs to the step after the one that opened it.
            (len(s) > 1 and "tri" not in (s[0].get("waitTarget") or ""),
             f"the calendar was credited to the click that opened it: {s[0].get('waitTarget')}"),
        ],
    ),
    Case(
        "a calendar opened by a press belongs to the step after it",
        "datefield-after-typing.html", date_after_typing,
        lambda s: [
            (len(s) == 3, f"expected three steps, got {len(s)}: {[x['keyword'] for x in s]}"),
            (len(s) > 1 and s[1]["locator"] == "id:dob",
             f"the date field step targeted {s[1]['locator'] if len(s) > 1 else None}"),
            # The step that opens the calendar cannot be waiting for it.
            (len(s) > 1 and "tri" not in (s[1].get("waitTarget") or "")
             and "cal" not in (s[1].get("waitTarget") or ""),
             f"the calendar was credited to the click that opened it: "
             f"{s[1].get('waitTarget') if len(s) > 1 else None}"),
        ],
    ),
    Case(
        "a pause before the press does not hand it the calendar",
        "datefield-popper.html", date_after_a_pause,
        lambda s: [
            (len(s) == 3, f"expected three steps, got {len(s)}: {[x['keyword'] for x in s]}"),
            # Recorded from DemoQA: the click on the date field was preceded by
            # "wait until the react-datepicker triangle is visible" — a triangle
            # that only exists because of that click.
            (len(s) > 1 and "tri" not in (s[1].get("waitTarget") or "")
             and "cal" not in (s[1].get("waitTarget") or ""),
             f"the calendar was credited to the click that opened it: "
             f"{s[1].get('waitTarget') if len(s) > 1 else None}"),
        ],
    ),
    Case(
        "native dialogs become steps of their own",
        "dialogs.html", dialogs,
        lambda s: [
            (len(s) == 6, f"expected six steps, got {len(s)}: {[x['keyword'] for x in s]}"),
            ([x["keyword"] for x in s][1::2] == ["Handle Alert", "Handle Alert", "Input Text Into Alert"],
             f"dialog steps came out as {[x['keyword'] for x in s][1::2]}"),
        ],
    ),
    Case(
        "pressing Enter is the step that acts",
        "enter.html", enter_key,
        lambda s: [
            (len(s) == 2, f"expected two steps, got {len(s)}: {[x['keyword'] for x in s]}"),
            (s and s[0]["keyword"] == "Input Text" and s[0].get("value") == "shoes",
             f"the typing came out as {s[0] if s else None}"),
            (len(s) > 1 and s[1]["keyword"] == "Press Keys" and s[1].get("value") == "RETURN",
             f"the press came out as {s[1] if len(s) > 1 else None}"),
        ],
    ),
    Case(
        "a chosen file is named even though its path cannot be",
        "upload.html", upload,
        lambda s: [
            (len(s) == 1, f"expected one step, got {len(s)}: {[x['keyword'] for x in s]}"),
            (s and s[0]["keyword"] == "Choose File", f"keyword was {s[0]['keyword'] if s else None}"),
            (s and s[0].get("value") == "zelector-sample.png",
             f"the file name came out as {s[0].get('value') if s else None}"),
        ],
    ),
    Case(
        "a press that travels is a drag",
        "drag.html", drag,
        lambda s: [
            (len(s) == 1, f"expected one step, got {len(s)}: {[x['keyword'] for x in s]}"),
            (s and s[0]["keyword"] == "Drag And Drop", f"keyword was {s[0]['keyword'] if s else None}"),
            (s and s[0]["locator"] == "id:card-1", f"source was {s[0]['locator'] if s else None}"),
            (s and s[0].get("dropTarget") == "id:done", f"target was {s[0].get('dropTarget') if s else None}"),
        ],
    ),
    Case(
        "a hover that opens a menu is the step before the choice",
        "hover.html", hover_menu,
        lambda s: [
            (len(s) == 2, f"expected two steps, got {len(s)}: {[x['keyword'] for x in s]}"),
            (s and s[0]["keyword"] == "Mouse Over" and s[0]["locator"] == "id:file",
             f"the hover came out as {s[0] if s else None}"),
            (len(s) > 1 and s[1]["locator"] == "id:export",
             f"the choice came out as {s[1]['locator'] if len(s) > 1 else None}"),
        ],
    ),
    Case(
        "passing over something on the way is not a step",
        "hover.html", hover_past,
        lambda s: [
            (len(s) == 1, f"expected one step, got {len(s)}: {[x['keyword'] for x in s]}"),
            (s and s[0]["locator"] == "id:plain", f"step targeted {s[0]['locator'] if s else None}"),
        ],
    ),
    Case(
        "a menu opened by a stylesheet still needs the hover",
        "hover-css.html", hover_css,
        lambda s: [
            (len(s) == 2, f"expected two steps, got {len(s)}: {[x['keyword'] for x in s]}"),
            (s and s[0]["keyword"] == "Mouse Over" and s[0]["locator"] == "id:card",
             f"the hover came out as {s[0] if s else None}"),
            (len(s) > 1 and s[1]["locator"] == "id:profile",
             f"the click came out as {s[1]['locator'] if len(s) > 1 else None}"),
        ],
    ),
    Case(
        "a link that was always visible needs no hover",
        "hover-css.html", plain_link,
        lambda s: [
            (len(s) == 1, f"expected one step, got {len(s)}: {[x['keyword'] for x in s]}"),
            (s and s[0]["locator"] == "id:plain-link", f"step targeted {s[0]['locator'] if s else None}"),
        ],
    ),
    Case(
        "the scorer reaches for the right handle",
        "scoring.html",
        lambda driver: None,
        lambda s: [],   # assertions run in check_scoring, which needs the driver
    ),
    Case(
        "a covered checkbox is reached through its label",
        "checkbox.html", checkbox,
        lambda s: [
            (len(s) == 2, f"expected two steps, got {len(s)}: {[x['keyword'] for x in s]}"),
            # The input has no hit-testable box of its own, so the label is the
            # only thing a replay can click.
            (s and s[0]["locator"] != "id:agree",
             "targeted the input, which is underneath its label and cannot be clicked"),
        ],
    ),
    Case(
        "a menu that opens on mousedown does not steal the aim",
        "dropdown.html", dropdown,
        lambda s: [
            (len(s) == 2, f"expected two steps, got {len(s)}: {[x['locator'] for x in s]}"),
            (s and s[0]["locator"] == "id:control",
             f"the opening click landed on {s[0]['locator'] if s else None}"),
            (len(s) > 1 and s[1]["locator"] == "id:opt-b",
             f"the option click landed on {s[1]['locator'] if len(s) > 1 else None}"),
        ],
    ),
    Case(
        "a portalled list, and an id that is regenerated every render",
        "portal-select.html", portal_select,
        lambda s: [
            (len(s) == 2, f"expected two steps, got {len(s)}: {[x['locator'] for x in s]}"),
            # The trigger's id is a React 19 useId value. It resolves fastest and
            # survives nothing — a recording on the Ant Design docs shipped it as
            # the locator because the id branch never asked the scorer.
            (s and "_R_" not in s[0]["locator"],
             f"a regenerated id became the locator: {s[0]['locator'] if s else None}"),
            # Both examples on the page display a10, so the title tells them apart
            # from nothing. The ugly path that follows is the honest answer.
            (s and s[0]["locator"] != 'css:[title="a10"]',
             f"the trigger was located by a title two elements share: {s[0]['locator'] if s else None}"),
            (len(s) > 1 and "b11" in s[1]["locator"],
             f"the option came out as {s[1]['locator'] if len(s) > 1 else None}"),
        ],
    ),
    Case(
        "a multiple select is one step carrying every label",
        "multi-select.html", multi_select,
        lambda s: [
            (len(s) == 1, f"expected one step, got {len(s)}: {[x.get('value') for x in s]}"),
            (s and s[0]["keyword"] == "Select From List By Label",
             f"keyword was {s[0]['keyword'] if s else None}"),
            (s and s[0].get("values") == ["Urgent", "Gift"],
             f"the labels came out as {s[0].get('values') if s else None}"),
        ],
    ),
    Case(
        "a double click is one step, and says so",
        "gestures.html", double_click,
        lambda s: [
            (len(s) == 1, f"expected one step, got {len(s)}: {[x['keyword'] for x in s]}"),
            (s and s[0]["keyword"] == "Double Click Element",
             f"keyword was {s[0]['keyword'] if s else None}"),
            (s and s[0]["locator"] == "id:cell", f"step targeted {s[0]['locator'] if s else None}"),
        ],
    ),
    Case(
        "a right click is a step nothing else reports",
        "gestures.html", right_click,
        lambda s: [
            (len(s) == 2, f"expected two steps, got {len(s)}: {[x['keyword'] for x in s]}"),
            (s and s[0]["keyword"] == "Open Context Menu",
             f"keyword was {s[0]['keyword'] if s else None}"),
            (s and s[0]["locator"] == "id:row", f"step targeted {s[0]['locator'] if s else None}"),
            # What the menu offers is an ordinary click and records itself.
            (len(s) > 1 and s[1]["locator"] == "id:rename",
             f"the menu item came out as {s[1]['locator'] if len(s) > 1 else None}"),
        ],
    ),
    Case(
        "a click recorded under a pinned bar says so",
        "sticky-footer.html", under_a_bar,
        lambda s: [
            (len(s) == 1, f"expected one step, got {len(s)}: {[x['keyword'] for x in s]}"),
            (s and s[0].get("underBar") is True,
             "the page pins a footer to the bottom edge and the step did not record it"),
        ],
    ),
    Case(
        "a field nothing can click is recorded as the control around it",
        "combobox.html", combobox,
        lambda s: [
            (len(s) == 2, f"expected two steps, got {len(s)}: {[x['locator'] for x in s]}"),
            (s and s[0]["locator"] == "id:control",
             f"the opening click was recorded as {s[0]['locator'] if s else None}"),
            (len(s) > 1 and s[1]["locator"] == "id:opt-nsw",
             f"the option came out as {s[1]['locator'] if len(s) > 1 else None}"),
        ],
    ),
    Case(
        "typing still belongs to the field, not the control",
        "combobox.html", combobox_typed,
        lambda s: [
            (len(s) == 1, f"expected one step, got {len(s)}: {[x['keyword'] for x in s]}"),
            (s and s[0]["keyword"] == "Input Text", f"keyword was {s[0]['keyword'] if s else None}"),
            (s and s[0]["locator"] == "id:typed", f"step targeted {s[0]['locator'] if s else None}"),
        ],
    ),
    Case(
        "clicking a form's whitespace is not a step",
        "container.html", container,
        lambda s: [
            (len(s) == 1, f"expected one step, got {len(s)}: {[x['locator'] for x in s]}"),
            (s and s[0]["locator"] == "id:real", f"step targeted {s[0]['locator'] if s else None}"),
        ],
    ),
    Case(
        "another extension's markup is not something to wait for",
        "foreign.html", foreign,
        lambda s: [
            (len(s) == 2, f"expected two steps, got {len(s)}"),
            (len(s) > 1 and "gtx" not in (s[1].get("waitTarget") or ""),
             f"waited on injected markup: {s[1].get('waitTarget')}"),
        ],
    ),
    Case(
        "a list rebuilt in place is not an arrival",
        "rerender.html", rerender,
        lambda s: [
            (len(s) == 2, f"expected two steps, got {len(s)}"),
            (len(s) > 1 and "row" not in (s[1].get("waitTarget") or ""),
             f"waited on a row that never left: {s[1].get('waitTarget')}"),
            (len(s) > 1 and s[1]["wait"] != "not-visible",
             "asked for a rebuilt row to become invisible"),
        ],
    ),
]


def main() -> int:
    serve_dir = Path(tempfile.mkdtemp(prefix="zelector-capture-"))
    build(serve_dir)
    httpd, port = serve(serve_dir)
    driver = browser()
    failures = 0

    try:
        for case in CASES:
            driver.get(f"http://127.0.0.1:{port}/{case.page}")

            # The scoring pass asks about elements rather than about a
            # recording, so it does not drive the recorder at all.
            if case.page == "scoring.html":
                problems = check_scoring(driver)
            else:
                driver.execute_script("window.__zelector.start()")
                case.run(driver)
                driver.execute_script("window.__zelector.stop()")
                result = steps(driver)
                problems = [why for ok, why in case.expect(result) if not ok]
            if problems:
                failures += 1
                print(f"FAIL  {case.name}")
                for why in problems:
                    print(f"        {why}")
                if case.page != "scoring.html":
                    print(f"        steps: {json.dumps(result, indent=10)[:900]}")
            else:
                print(f"ok    {case.name}")
    finally:
        driver.quit()
        httpd.shutdown()
        shutil.rmtree(serve_dir, ignore_errors=True)

    print()
    print(f"{failures} of {len(CASES)} capture cases failed." if failures
          else f"All {len(CASES)} capture cases hold.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
