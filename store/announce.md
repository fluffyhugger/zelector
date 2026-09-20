# Community posts

Written for the Robot Framework forum, r/QualityAssurance and the RF Slack —
the places the first users actually come from. **Nothing here goes up until the
store listing is live**, because a post that ends in "coming soon" spends the
attention it earns and gets nothing back.

The tone is deliberate: this audience has been sold recorders before. No
adjectives that cannot be checked, the limitations in the post rather than in a
reply three days later, and a number wherever there is one.

---

## Robot Framework forum — `forum.robotframework.org`, Tools category

**Subject:** Zelector — a recorder that infers the waits, and a locator scorer
that says why

Hi all,

I got tired of recorder output that needs rewriting before it can be committed,
so I spent a couple of weeks on the two parts that decide whether a recorded
test survives: the waits and the locators. It is a Chrome extension, free, MIT,
and it does not talk to a server.

**The waits.** Nobody performs a wait, so it cannot be recorded — it has to be
inferred. After each action the extension watches what the page did: which
request fired and how long it took, what appeared, what appeared and then went
away. A spinner that comes and goes becomes
`Wait Until Element Is Not Visible` on that spinner. A route change becomes
`Wait Until Location Contains`. The timeout comes from how long the page
actually took. Every guess is shown with the reason for it and can be changed
before you export. `Sleep` is on the list, last, with a warning — hiding it
would only mean people type it back in by hand.

**The locators.** Every candidate is scored and every point lost has a reason
attached. Build-tool classes (`css-1x9d8f`, `Button_root__3kD9a`), ids that are
regenerated on every render (React 19's `_R_…`), counter ids (`mat-select-0`,
`pn_id_7`), classes that name a state rather than an element (`is-focused`,
`ant-select-open`) — all recognised and marked rather than handed over as
though they were stable. A selector that matches twenty elements loses to one
that matches the element you picked. When nothing durable exists the panel says
so, while you can still go and ask someone for a `data-testid`.

**What it gets right that surprised me while testing it.** Closed shadow roots
(the hook goes in before the page's first script, so the picker sees inside
them). `Select Frame` / `Unselect Frame` around anything in an iframe.
`Handle Alert` for dialogs, which are browser chrome rather than DOM and are
the classic way a recorded suite hangs. Drag, hover menus, double click, right
click. A `<select multiple>` as one step carrying every label. A page with a
sticky footer gets a helper that puts the element where a click can reach it —
WebDriver scrolls the smallest distance that brings something into view, which
parks it under exactly the bar that was covering it.

**What it does not do.** The path of an uploaded file cannot be recorded
because the browser does not tell anyone; the name goes into a declared
variable and you drop the file beside the suite. Cross-origin iframes give a
frame selector that is a guess, and it is labelled as one. It generates
SeleniumLibrary; there is no Browser library support yet.

Testing was not reading the output — it was running it. The DemoQA practice
form now records and replays end to end, 87 keywords, headless. Recordings on
saucedemo, Element Plus, PrimeNG, practicesoftwaretesting and a Thai government
site all run. Roughly fifteen real bugs came out of doing that, and three of
them were things every test and every panel in the UI claimed already worked.

<!-- store link -->

Source: https://github.com/fluffyhugger/zelector

I would rather hear where it fails than that it is a nice idea. If you record
something and the suite does not run, the `.robot` file plus the site is enough
for me to work from.

---

## r/QualityAssurance

Same content, shorter, and lead with the measurement rather than the pitch:

> I built a Chrome recorder for Robot Framework because I was tired of fixing
> `Sleep 2` and `nth-child` by hand. It infers the wait from what the page did
> after each action, and scores every locator with the reason for each point
> lost. The DemoQA practice form records and replays end to end, headless, 87
> keywords. Free, MIT, no server. Happy to be told where it breaks.

---

## Slack (#tools or similar)

> Zelector — Chrome recorder → Robot Framework suite. Infers waits from what
> the page actually did rather than emitting `Sleep`, and marks every locator
> it is not sure about. MIT, no server. <link> — bug reports very welcome.

---

## After posting

Whoever replies with a failing recording is the most valuable person in the
thread. Ask for the `.robot` file and the URL, reproduce it, fix it, and say in
the thread which version has the fix. That loop is the entire marketing plan.
