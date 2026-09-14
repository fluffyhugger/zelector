# Privacy Policy

**Zelector — XPath & CSS Selector Finder + Robot Framework Recorder**

Last updated: 14 September 2026

## The short version

Zelector has no servers. Nothing it reads ever leaves your browser. There is no
account, no analytics, no telemetry, no error reporting, and no network request
of any kind made by this extension.

## What it reads

When you open the picker or start a recording, Zelector reads the page you are
on — element tags, attributes, text and layout — because generating a selector
for an element is not possible without looking at it. While recording, it also
notes which elements you clicked and what you typed into them, since that is
what a recorded test is made of.

It installs hooks on `attachShadow`, `fetch` and `XMLHttpRequest` when a page
loads. The first lets it see into closed shadow roots. The other two let it tell
how long a request took, so a generated test waits for the right thing instead of
sleeping for an arbitrary number of seconds. Response bodies are held in the
page's own memory and are discarded when the page unloads.

All of this happens inside the tab. None of it is sent anywhere.

## What it stores

Two things, both in `chrome.storage.session`, which Chrome keeps in memory and
clears when you close the browser:

- **The recording in progress** — the steps, their locators and their waits. It
  lives outside the page because a login or a checkout navigates, and a
  navigation destroys everything held in the page.
- **Recent picks** — the last 50 elements you inspected, so the DevTools panel
  still has them if you open it after the fact.

Nothing is written to disk. Nothing persists across a browser restart. There is
no sync, and no other storage area is used.

## What leaves your machine

Only what you deliberately take out of it: the code you copy to the clipboard,
and the `.robot` file you choose to download. Both go where you put them.

## Permissions

`storage` — for the two session-scoped items above.

The content scripts run on all sites. They have to: the `attachShadow` hook must
be installed before a page's first script runs, and there is no way to know in
advance which page you will want to inspect. Running everywhere is not the same
as sending anything anywhere, and this extension sends nothing.

## Third parties

There are none. No SDKs, no bundled analytics, no fonts or scripts loaded from
anyone else's server.

## Contact

Open an issue at https://github.com/fluffyhugger/zelector/issues.

The source is MIT-licensed and public, so every claim on this page can be checked
against the code rather than taken on trust.
