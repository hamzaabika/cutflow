# Creative Composer — user controls

**Applies to:** Cutflow at HEAD `2ec51ae` (P3 complete). The Composer is the
one place to browse, apply, save, edit, import, and export presets
(`src/components/ComposerPanel.jsx`, Library rail → **Composer**). One preset
format covers five targets — **Filter, Text, Caption, Audio, Transition** —
and every control below writes the same clip fields the preview reads, so
what you see is what exports. All changes are undoable (Ctrl+Z).

## 1. The Composer panel

- **Filter chips** (`All · Filter · Text · Caption · Audio · Transition`)
  narrow the library by target, with a count per target.
- **Each preset row** shows the name, target, and variant (or family), plus
  a `Seed` tag for built-in examples and `Migrated` for presets converted
  from the old filter/text format.
- **Apply** — click the preset name. For picture presets (Filter, Audio,
  Transition) the selected picture clip is required; for text presets
  (Text, Caption) the selected text clip is required. Without the right
  selection the panel tells you which clip it needs — nothing is applied
  to the wrong thing.
- **Edit** — opens the preset's parameter sliders. Moving a slider updates
  the preset **and** live-applies it to the current clip, so you hear/see
  the result as you drag. `Done` closes the editor.
- **Export** (per preset) — downloads that preset as a `.json` file
  (`cutflow-preset-<name>.json`). **Export all** downloads the whole
  library (`cutflow-presets.json`). **Import .json** reads a preset file
  (one preset, or a whole library) back in.
- **Delete** (×) — user presets only. Seeds cannot be deleted.
- **Seeds are read-only examples.** Editing a seed copies it into your
  presets first (the note tells you it was copied) — the original stays
  untouched.

## 2. Saving the current clip as a preset

1. Select the clip whose look you want to keep.
2. Type a name, pick the preset type (Filter / Text / Caption / Audio /
   Transition), click **Save**.
3. The preset captures that clip's settings for the chosen target and
   appears in the library. Save is disabled until a suitable clip is
   selected.

A saved preset stores **parameters, not pixels**: applying it later to a
different clip reproduces the look from the new clip's own picture.

## 3. What you can control, per target

| Target | Variant (the built-in it wraps) | Editable parameters |
|---|---|---|
| Filter | Any filter look (e.g. Vivid), or a bundled LUT (`lut:<file>.cube`) | Intensity 0–100 |
| Text | Any text template (e.g. `title-bold`) | Size 8–300, Opacity 0–1 |
| Caption | Any caption template; or pure style (no variant) | Size 8–300, Opacity 0–1 |
| Audio | Any audio preset (e.g. Clear Voice); or a custom chain (no variant) | Pitch −12…+12, High-pass 0–300 Hz |
| Transition | Any transition (e.g. Fade) | Duration 0.2–2 s |

Out-of-range numbers are clamped to these limits, never rejected — the
panel shows the clamped value. Unknown parameters in an imported file are
dropped. A preset naming a variant that does not exist on this machine is
invalid and skipped on import (its error is reported, the rest import).

## 4. Effect controls (clip inspector)

Applying a preset is the shortcut; the inspector is the full control set
for a selected clip:

- **Effects** — add/remove any pixel or overlay effect; per-effect
  **strength** (0 = off), **timing window** (effect active only inside
  it), **region mask** (rect/ellipse, feathered edge — the effect applies
  inside the region only), and **keyframes** for animated strength.
- **Adjust / Grade** — temperature, tint, saturation, exposure, contrast,
  highlights, shadows, whites, blacks, brilliance, sharpen, clarity,
  fade, vignette, particles (film grain), plus **HSL**: pick one of eight
  colours (Red, Orange, Yellow, Green, Cyan, Blue, Purple, Magenta) and
  turn its hue (±100), saturation (±100), lightness (±100). The HSL change
  touches only pixels in that colour's band — other colours are untouched.
  **Curves** (master + R/G/B) and a **LUT** slot (bundled `.cube` looks,
  intensity 0–100) live in the same panel.
- **Skin tones** — a focused front-end for the orange HSL band
  (`src/fx/skin.js`).
- **Transitions** — on the incoming clip: type, duration, and (for engine
  transitions) easing. Native transitions (Fade, Wipe Left, …) render with
  the platform crossfader; engine transitions (Circle Reveal, …) use the
  shared shader engine.
- **Easing / motion curves** — the curve editor (transitions + keyframe
  segments) offers preset chips (Linear, Smooth, Ease In/Out, Snap In/Out,
  Overshoot, Spring, Bounce) with a live curve drawing, or a custom
  bezier/physics curve. The same solver drives preview, export, and tests,
  so an eased motion renders identically everywhere.
- **Text animation** — In / Out / Loop browsers with category folders;
  each tile applies its animation and duration to the selected text clip.
  Caption templates carry a word-highlight mode (pop/scale, single word,
  karaoke sweep, glow colour) and an optional pill background bubble.

## 5. Import / export rules

- Presets are versioned `.json` files (schema v1). A file with a newer
  schema version is rejected outright — the app never guesses at a format
  it does not know.
- **Assets travel with the preset** (LUT/font/media manifest). On import
  the app relinks them against this machine: a bundled LUT resolves by
  filename, a font by family name. Missing assets are **reported, never
  silently substituted** — the preset still imports, and the note names
  what is missing.
- An imported preset whose id clashes with a different preset gets a fresh
  id; an identical one updates in place.
- Invalid entries in an imported file are reported and skipped; a file
  with zero valid presets imports nothing and says so.

## 6. What the Composer does NOT do (by design)

- **No multi-clip apply.** A preset applies to one selected clip at a
  time; there is no "apply to all selected clips" yet.
- **No grouped vector/title templates.** Titles and captions are text
  templates, not grouped editable layers — a title preset is a look, not
  a package of shapes.
- **No cloud sync.** Presets live in this machine's library (localStorage)
  plus whatever `.json` files you export. Share them as files.
- **Audio presets replace the clip's audio chain** (except Clean Voice,
  which is additive). There is no replace-vs-merge switch or A/B preview
  yet — save the current chain as a preset first if you want to go back.
- **Removed items stay removed.** The 19 removed transitions and the Gold
  Quote Hadith preset cannot be re-added from the Composer, and no
  synthesized/AI-generated sound effects are offered — audio comes from
  real licensed/original sources only.

## 7. Quick reference

| I want to… | Do this |
|---|---|
| Try a look on a clip | Select the clip → Composer → click the preset |
| Keep a look for later | Select the clip → name + type → Save |
| Tune a look live | Preset → Edit → drag a slider (preview follows) |
| Share a look | Preset → Export (or Export all) → send the `.json` |
| Use someone else's look | Import .json → pick the file |
| Change one colour only | Select clip → Adjust → HSL → pick the colour → drag Hue/Sat/Light |
| Ease a transition | Select the incoming clip → curve editor → pick a preset chip |
| Undo an apply | Ctrl+Z (apply is one undoable step) |
