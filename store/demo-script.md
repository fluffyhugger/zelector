# The 35 seconds

**Shot on 20 September.** `~/Desktop/record/zelector-demo.mp4` (1432×738),
`zelector-demo-1280.mp4` for the store's video field, and
`zelector-demo.gif` (5.1 MB, 900px) for the forum. The cut below is what
was actually used; the shot list that follows it is how it was planned.

| | |
|---|---|
| 0:00–0:03 | the form, `⌥⇧R`, the panel |
| 0:03–0:15 | filling it in at 3.2× |
| 0:15–0:19 | the step list, each wait with its reason — caption: *every wait, and why it is there* |
| 0:19–0:23 | the generated suite in the preview pane |
| 0:23–0:25 | `demosite (8).robot`, 9.9 KB, downloaded |
| 0:25–0:32 | the terminal, then Chrome opening itself and filling the form again — caption: *run as downloaded, nothing edited* |
| 0:32–0:35 | `1 test, 1 passed, 0 failed`, zoomed and held |

Cut from the first take: fifteen seconds of Finder, which is a person
looking for a file rather than anything the tool does — and a Downloads
list with unrelated filenames in it.

---


What to film, in what order, and why. The whole point is the last five
seconds: a suite nobody edited, running.

**Shoot on DemoQA** — https://demoqa.com/automation-practice-form. It is the
page the QA world already knows, and the one recording that is verified green
end to end (87 keywords, headless). Nothing to find out on camera.

**Before you start**

- `chrome://extensions` → reload Zelector, so the build in the browser is the
  one that works
- close every other tab, hide bookmarks (`⌘⇧B`), put the window at a size that
  crops to 1280×800 cleanly
- terminal on the other half of the screen, in `~/Desktop/robot-playground`,
  font at 16pt or larger — anything smaller is unreadable after compression
- `⌘⇧5` → Record Selected Portion, and keep the selection on the two windows

## The cuts

| t | on screen | why it is there |
|---|---|---|
| 0–3s | the form, nothing happening. `⌥⇧R`, the panel appears | someone has to see where it comes from |
| 3–14s | fill the form: name, email, gender, mobile, **date of birth — open it, pick a month, a year, a day**, subjects, hobbies, upload a picture, address, state, city | **speed this up 2×** in editing. Nobody wants to watch typing |
| 14–20s | hold on the panel. Scroll it so a **wait with its reason** is on screen — `# <div> appeared` next to `Wait Until Element Is Visible` | this is the claim the whole tool rests on. Let it sit |
| 20–24s | click Download, the file lands in `~/Downloads` | proof it is a file, not a preview |
| 24–35s | terminal: `./grab.sh`, then **Chrome opens by itself and fills the form again**, ending on `1 test, 1 passed, 0 failed` | the five seconds that matter. Hold the green for three of them |

## Rules

- **No voice, no intro, no logo.** A title card costs you the viewers who would
  have stayed.
- Text on screen only where the picture cannot say it: `waits, inferred` over
  the panel shot, `no edits` over the terminal shot.
- One take of the form-filling is enough — mistakes are fine, the recorder
  handles them, and a fumble on camera is honest.
- If the ad banner covers a field, zoom the page to 80% (`⌘-`) **before** you
  start recording.

## After

`./demo.sh tests/demosite.robot` is the run to film — one suite, a visible
browser, and a report short enough to read in the frame.

To cut it down and turn it into a GIF for the forum post:

```
brew install ffmpeg
ffmpeg -i demo.mov -vf "fps=12,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 demo.gif
```

Aim for under 8 MB — the forum and Reddit both take that. If it is bigger, drop
to `fps=10` before you drop the width; text going soft is worse than motion
going choppy.

The YouTube upload is the same file, and the store's promo-video field takes it
whenever. The GIF is the one that does the work: it plays where people already
are.
