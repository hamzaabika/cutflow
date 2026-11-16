# Creative Composer — troubleshooting

**Applies to:** Cutflow at HEAD `2ec51ae`. Symptoms are ordered by where
you hit them. Each entry: what you see → most likely cause → fix. Fixes
are ordered cheapest-first.

## Import / export

### "Import .json" reports entries skipped as invalid

**Cause:** those entries failed `validateCreativePreset` — the usual
reasons are a wrong `kind`, a `schemaVersion` other than 1, an empty or
over-80-character name, an unknown `target`, or a `variant` that names no
built-in on this machine.
**Fix:** open the file, find the named entry in the note, and correct the
field (check the variant id against the app's own catalogs — filter ids in
`src/fx/filters.js`, text/caption ids in `src/text/catalog.js`, audio ids
in `src/fx/audioPresets.js`, transition ids in `src/effects.js`). Valid
entries in the same file still import — only the bad ones are skipped.

### Imported preset says "Missing assets on this machine"

**Cause:** the preset's asset manifest names a LUT file or font this
machine does not have. The preset still imported — assets are never
silently substituted.
**Fix:** install the named LUT (`.cube`, via Adjust → LUT → Import) or
font, then re-import the preset; or accept the preset without that asset
(the look falls back to its non-asset parameters). When sharing a preset,
ship the asset file beside the `.json` (or as a `.cutflowpack`).

### A preset file with a newer schema version is rejected entirely

**Cause:** the file was written by a newer Cutflow than this one.
**Fix:** update Cutflow. Do not hand-edit `schemaVersion` down — the
reader rejects newer versions rather than guessing, and a downgraded
number would silently misread fields the old reader does not know.

### Export downloads nothing / the file is empty

**Cause:** usually the browser blocked the download, or (for Export all)
the library is empty — Export all is disabled with no user presets.
**Fix:** allow downloads for the app, and check the library actually
lists a preset first. A single preset's Export button always writes that
preset, even a seed.

## Applying presets

### Clicking a preset does nothing, or the panel says a clip is needed

**Cause:** the preset's target needs a selection you do not have — a
picture preset (Filter/Audio/Transition) needs a picture clip selected;
a text preset (Text/Caption) needs a text clip selected.
**Fix:** click the clip on the timeline first, then the preset. Applying
to the wrong kind is refused on purpose — nothing is applied to the wrong
thing.

### The preset applies, but the preview does not change

**Cause (check in order):**
1. **Strength/intensity is 0** (effect strength 0, filter intensity 0) —
   the pass is skipped by design.
2. **Timing window** — the effect is active only inside its window; the
   playhead is outside it.
3. **Region mask** — the effect applies inside the region only; the
   region is off-frame or feathered to nothing.
4. **The preset is a no-op for this clip** — e.g. an HSL recipe for green
   on a clip with no green pixels.
**Fix:** check the clip inspector values first (strength, window,
region), then the playhead position, then whether the clip's picture
actually contains what the recipe acts on.

### The preview changes, but the export does not

**Cause:** this is a bug, not a setting — preview and export run the same
pass list by construction (`pixelPasses`). The usual real culprits are a
stale export (you exported before applying — re-export), or the effect
sitting on a clip the exporter's layout does not include (e.g. the clip
is muted/disabled, or on a track the export skips).
**Fix:** re-export after the change; check the clip is enabled and on an
exported track. If a fresh export still differs from the preview, report
it with the project and the two frames — include which effect, which
clip, and the export settings. (Verification method: the parity suites in
`scripts/test-fx-parity.cjs` / `test-transition-parity.cjs`.)

### Undo does not restore the clip

**Cause:** applying a preset is one undo step — but editing a preset's
sliders writes one step per move in some flows, so a single Ctrl+Z may
only undo the last slider move.
**Fix:** press Ctrl+Z again (or check the undo history). If undo restores
something other than the pre-apply state, that is a bug — report the exact
steps.

## Editing presets

### Editing a seed does not stick / the seed looks unchanged

**Cause:** seeds are read-only by design. Editing one copies it into your
presets and you edit the copy; the seed stays as it was.
**Fix:** look for the "(copy)" preset in your library — that is the one
you edited. The panel's note says when a copy was made.

### A slider moves but the number snaps back

**Cause:** the value is clamped to the registry limits for that target
(e.g. transition duration 0.2–2 s, filter intensity 0–100). Out-of-range
input is clamped, never rejected.
**Fix:** that is the limit working as intended — if the look needs a value
outside it, the recipe needs a different variant or engine support, not a
bigger number.

### My saved preset is missing after reopening the app

**Cause:** presets live in this machine's library (localStorage). A fresh
profile, a cleared site data, or a different machine has an empty library.
**Fix:** re-import your exported `.json` (this is why Export exists).
There is no cloud sync — the file is the backup.

## Text / captions

### A caption style applies but words do not highlight one by one

**Cause:** word-level highlight modes (`scale`, `single`, `karaoke`,
`color`) need word timings. A plain text clip has none — timings come
from a transcript/caption import.
**Fix:** generate or import captions for the clip first, then apply the
caption preset. Without timings the template renders as a static style.

### Decoded/scrambled text stays scrambled

**Cause:** the Decode animation (`title-decode`, `animIn: decode`) reveals
over its duration (1 s by default). Scrubbing to before the reveal, or a
clip shorter than the animation, leaves it mid-scramble.
**Fix:** play past the first second, or shorten the animation duration in
the text inspector.

### Text looks right in preview but is missing in the export

**Cause:** export text is drawn by the UI canvas renderer into a
`text.mov` overlay during export. If the export was run headless or the
text pass was skipped, text is absent.
**Fix:** export from the app (not a script), and check the text clip's
time range overlaps the exported range. Caption styling does not survive
the separate `mov_text` subtitle stream — that stream is plain text +
timings by design; the burned-in look is the `text.mov` overlay.

## Effects / grade

### An HSL change shifts the whole picture, not one colour

**Cause:** the HSL band weights by hue distance — a large hue turn on a
band whose neighbours are close (e.g. red/orange) bleeds into the
neighbour. A saturation/lightness change on a near-grey pixel also does
little, because the mask multiplies by the pixel's saturation.
**Fix:** use smaller turns, or pick the band whose centre is closest to
the colour you mean. Verify on a two-colour test frame: the untouched
half must not move (the §7 HSL check does exactly this).

### Grain / scanlines / fine patterns look weaker in the export than in preview

**Cause:** the encoder. Fine 1 px patterns and per-pixel noise partly
do not survive x264 at low bitrates — the look is present, just softer.
**Fix:** this is expected at 320×180 test sizes; at 1080p export with
the normal bitrate the pattern survives far better. Judge it on a
full-resolution export, not a proxy. (Measured: scanline row-alternation
and grain HF energy stay several times above a plain export.)

### A transition is a hard cut instead of a blend

**Cause:** the transition duration is 0, the incoming clip has no
transition set (transitions live on the incoming clip), or the overlap
was consumed by trimming the outgoing clip short.
**Fix:** select the incoming clip, set the transition type and a duration
above 0, and leave enough handle (the transition overlaps the two clips;
very short clips clamp it).

## Recording (screen + camera)

### The camera bubble is missing from the recording

**Cause:** the camera recorder failed (permission denied, camera busy) —
the screen recording still completes and the camera is dropped, not
faked.
**Fix:** allow camera access, close other apps using the camera, and
re-record. The combined flow records screen and camera as two recorders;
the camera lands as an overlay clip with its shape/style/geometry.

### The Stop bar appears in the screen recording (Linux)

**Cause:** on Linux the Stop bar cannot be hidden from a capture
(`setContentProtection` is Windows/macOS-only), so the app must not show
it for screen recordings. If you see it, the bar-visibility rule did not
run.
**Fix:** use a window recording (bar allowed there) or stop from the
keyboard/tray. Report it with the platform and source kind if it recurs
(`scripts/test-recorder-linux.mjs` pins the rule).

## Getting help

When reporting a Composer problem, include: the preset file (or its
`target`/`variant`/`params`), the clip kind it was applied to, a screenshot
of the preview, and — for export issues — the exported file's frame at the
affected time. "It doesn't work" without those three cannot be diagnosed.
