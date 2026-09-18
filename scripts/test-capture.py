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
