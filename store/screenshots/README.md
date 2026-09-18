# Screenshots

**Upload the .jpg files.** The .png are the sources they were made from.

The store takes 1280x800 or 640x400, and 24-bit only — a screen capture on a
Mac is RGBA, and an upload with an alpha channel is refused without saying
which of the two rules it broke. `sips` cannot drop alpha from a PNG and there
is no ImageMagick here, so the uploads are JPEG at maximum quality, which the
store accepts and which shows no artefacts on this kind of screenshot.

    node scripts/check-shots.mjs          # size and alpha
    node scripts/check-shots.mjs --fix    # resize to 1280x800

Order matters: the first is the only one on a search result card.
