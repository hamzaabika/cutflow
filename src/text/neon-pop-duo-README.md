# Neon Pop Duo — `neon-pop-duo`

A two-line caption preset: a white Inter line pops in word by word with a
neon blur-in and a seeded baseline float, then a red Playfair Display Bold
Italic line types in character by character underneath. Built from the written
spec (no reference clip existed); every number below is a token in the patch,
not a constant in the renderer.

## How to apply it

- **New caption:** Text panel → Captions → **Neon Pop Duo** tile. The new clip
  gets the sample text `Bezaf dyal lmgharba / Machi Professionnel`, 3 s long,
  anchored at 60% frame height. Type your own lines in the Inspector.
- **Existing caption:** select the clip → Templates tab → Neon Pop Duo. The
  clip keeps its own text; the duo style applies to it. (With "Apply to all
  main captions" on, the style goes to every caption.)
- **Inspector:** a duo clip shows two text fields (**Line 1** / **Line 2
  (emphasis)**) joined by `\n` in `clip.text`, plus a **Neon Pop Duo** card:
  line colours, Line 1 size, Speed, Word stagger, Glow, Light mode, Hard-cut
  exit. The generic font / size / fill controls are hidden for duo clips —
  they don't apply (each line has its own font and colour in the duo spec).
  Vertical position still comes from the Position card (`y`, default 0.6).

## The spec (all tokens live in `src/text/duo.js` `DEFAULT_DUO`)

- **Layout:** two lines, centred, block centre at `y` (0.60). Max width 90% of
  frame width; over-long words shrink the whole block (floor 70%). Gap 0.15em
  of the line-1 size. Line 2 is optional — line 1 alone looks right.
- **Line 1:** Inter Medium, 5.5% of video width, letter-spacing −0.01em,
  line-height 1.1, `#FFFFFF`, resting glow 6 px white at 0.35 alpha.
- **Line 2:** Playfair Display Bold Italic, 1.15× line 1, letter-spacing
  −0.02em, `#E10600`, resting glow 8 px red at 0.45 alpha.
- **Line 1 per word:** starts at `i × 120 ms`; opacity 0→1 + blur 10 px→0 over
  280 ms (`cubic-bezier(.22,1,.36,1)`); neon entry glow `#FF4D6D` ~14 px
  cooling to the resting glow over 320 ms (first word 1.5×); seeded baseline
  float in [−0.18em, +0.18em] easing to 0 over 350 ms (seed = preset seed +
  word index); scale 0.92→1.
- **Line 2 per char:** starts 150 ms after the last line-1 word finishes; one
  char every 35 ms: opacity 0→1, blur 6 px→0, red glow `#FF1A1A` 12 px
  settling to the resting glow over 200 ms. No jitter. The full line is laid
  out once; each char is placed with `measureText` on prefixes (kerning
  preserved).
- **Hold / exit:** hold until clip end − 120 ms; exit fades both lines together
  over 100 ms (or an instant cut with `hardCut`).
- **Short clips:** stagger + typing compress (never below 0.1×) so line 2
  finishes ≥ 300 ms before the exit.
- **RTL / Arabic:** auto-detected per line. Arabic animates **per word on both
  lines — never per letter**; `ctx.direction = 'rtl'`; stagger runs
  right-to-left; `Intl.Segmenter` for grapheme-safe segmentation. Arabic
  line 1 = Cairo Medium (500), line 2 = Aref Ruqaa Bold (700) with Noto Naskh
  Arabic Bold as fallback. Italic never applies to Arabic.
- **Light mode** (`lightMode`): blur becomes opacity + scale only.
- **Video blur transition:** out of scope — `videoBlurTransition: false` is a
  reserved option in the data.

## How it is built (one renderer, preview = export)

- `src/text/duo.js` — pure module (no DOM): `DEFAULT_DUO`, `resolveDuo`
  (deep-merge), `duoTiming` (the whole schedule + short-clip compression),
  `duoSettledAt`, mulberry32 seeded PRNG, cubic-bezier easing, grapheme/word
  segmentation, RTL helpers. Imported by the renderer, the static-frame
  detector, and the node tests.
- `src/text/render.js` — `drawTextClip` hands any clip with `st.duo` to
  `drawDuoClip`, which reuses the existing `layout()` per paragraph and
  `paintText()` per unit. Same `(time, text, tokens)` → same pixels in
  preview and in export (both go through `drawTextLayer` → text.mov).
- `src/text/catalog.js` — entry `neon-pop-duo` (Captions, TAGS Word + Glow).
  The patch carries `duo: {}` — `resolveDuo` fills every token from
  `DEFAULT_DUO`. A variant is a data clone that overrides only what differs.
- `src/fonts.js` — new font ids `inter` (Inter Variable, regular 500),
  `playfairbi` (real Playfair 700-italic face, loaded in `fontsReady`),
  `cairomed` (Cairo 500). All bundled `@fontsource`, no network, no new
  dependencies. IBM Plex Sans Arabic was deliberately NOT installed.
- `src/text/staticFrame.js` — a duo clip is only "settled" in its hold window
  (last unit finished, exit not started); otherwise it returns null, so the
  exporter never reuses a stale frame mid-animation.
- `src/components/TextInspector.jsx` — two text fields + the Neon Pop Duo
  card (colours, size, speed, stagger, glow, light mode, hard cut); the
  Animation tab notes the duo runs its own timing.

## Performance notes

- Glow is `shadowBlur` per unit + `ctx.filter` blur only on units currently
  entering (bounded count, same pattern as the existing wordPop). The brief's
  glow-sprite cache was not built: the entering-unit count is bounded and the
  cache would add a second render path for no measured gain.
- Drawing is skipped entirely outside `[0, duration)` and once the exit
  alpha hits 0.

## Cloning into a new preset

Copy the catalog entry, change the id/name, and override tokens in the patch:

```js
{ id: 'neon-pop-duo-fast', name: 'Neon Pop Duo Fast', cat: 'Captions', caption: true,
  patch: { /* …same base fields… */, text: 'Line one\nLine two',
    duo: { speed: 1.4, line2: { color: '#FFD400' } } } },
```

No code change is needed — `resolveDuo` merges the override onto the defaults.
Add the id to the `TAGS.Word` / `TAGS.Glow` lists if it should appear there.

## Bounce variant (`neon-pop-duo-bounce`)

The same preset with `duo: { bounce: true }` — a data clone, the original
stays bounce-off. When on, line-1 words DROP from above the resting baseline
and bounce when they land — a drop-bounce, not a pop-up. The word starts
0.55 em above the line (seeded ±0.1 em per word, so every word starts well
above it), falls with gravity (ease-in, accelerating) over 300 ms, lands on
the baseline, then bounces once within 250 ms: overshoot +0.08 em below the
baseline, rebound −0.03 em above it, settle to 0 — total entry 550 ms
(`dropBounceDy`, `duo.js`). The scale stays 1.0 through the whole entry: no
pop-up, the word TRAVELS down into place. The 120 ms stagger, the 280 ms
opacity/blur window, the neon glow cooling, line-2 typing, and the original
preset are all untouched. Tune with
`duo: { bounce: true, line1: { dropHeight: 0.55, dropVar: 0.1, dropFallDur: 300, dropBounceDur: 250 } }`.
The old scale-pop (`bounceScale`) and sine-dip (`bounceFloatDy`) versions are
removed — the dip was only 0.10 em at the very end of the entry, and the
scale pop read as "bounce up" instead of "coming down".

## Tests

- `node scripts/test-neon-pop-duo.mjs` — timing math (3 s sample: line 1 ends
  520 ms, line 2 starts 670 ms, ends 1500 ms, exit 2880 ms), seeded offsets
  (deterministic, in range), RTL segmentation, short-clip compression,
  static-frame hold window, catalog entry shape.
- `node scripts/test-text-templates.mjs` — catalog validity (114 templates).

## Verified live (2026-11-14, dev app on CDP:9225)

- Samples 1 + 2 + Arabic in the real player at t = 0.1 / 0.4 / 0.8 / 1.4 /
  2.0 s; determinism hashes match after forward/backward scrubbing
  (t = 0.4 and t = 0.8 identical); 9:16 / 1:1 / 16:9 all render with sizes
  relative to video width; all four fonts load (`document.fonts.check` true).
- Preview/export parity: real UI export of the 3 s sample → 1080×1920 30 fps
  mp4; frame at t = 1.4 vs the preview canvas at the same timestamp
  (540×960): mean abs diff 1.16 per channel, 2.15% of pixels differ by > 10
  (H.264 compression level). The #17 text-layer stall did NOT occur.
- Responsiveness: during a 10 s export, seek round-trips were 262 ms (text
  phase) and 92 ms (encode phase); export completed in 29 s.
- Tile + Inspector verified in the running app (tile shows the sample; the
  Inspector shows the two line fields and the Neon Pop Duo card).
- Frames: `~/workspace/text-preset-video/verify-duo/` (`s1-*`, `s2-*`, `ar-*`,
  `aspect-*`, `export-preview-t14.png`, `export-frame-t14.png`,
  `export-duo-3s.mp4`, `export-duo-10s.mp4`, `ui-*.png`).
