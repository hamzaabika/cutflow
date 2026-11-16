# Creative Composer — architecture

**Status:** as-built at HEAD `2ec51ae` (P3 complete), 2026-11-15. Stage 1
deliverable (Master Stage 1 / Stage 7 #2). Companion to
`docs/creative-composer-audit.md` (CC-08, Stage 0 verified inventory + gap
matrix, 237 CSV rows) — the audit says *what* exists per row; this file says
*how it fits together*. Nothing here describes planned work as built: gaps
are listed in §8 with their owning CC item.

## 1. The three ideas the whole system hangs on

1. **One preset format.** Every shareable look is a `CreativePreset`
   (`src/presets/schema.js`, schema v1, `kind: 'cutflow.creative-preset'`):
   `{ id, name, target, family, variant, params, assets?, source,
   createdAt, updatedAt }`. Five targets only: `filter`, `text`, `caption`,
   `audio`, `transition`. `variant` names the built-in the preset wraps (a
   filter id, text template id, audio preset id, transition id) or `null`
   where the preset is pure parameters (a caption style, a custom audio
   chain). `params` holds only that target's keys, clamped by the registry.
   A newer `schemaVersion` is rejected, never guessed.
2. **One expression engine for picture.** Every pixel look — Adjust,
   filter looks, grade (incl. HSL bands and curves), the 146 pixel effects,
   the engine transitions — is an expression in `src/fx/expr.js`, compiled
   to a WebGL shader by `src/fx/gl.js` and to identical pixels by the CPU
   reference in `src/fx/run.js`. The preview and the export run the *same*
   pass list (`pixelPasses` in `src/fx/apply.js`), so preview/export parity
   holds by construction; the parity suites (`test-fx-parity`,
   `test-transition-parity`, `test-blend-psnr`, `test-export-audio-parity`)
   pin it with numbers. Particle/light overlays are the exception: they are
   canvas-drawn (`drawOverlayPasses`, same file), not shaded.
3. **One undoable dispatch.** Applying, editing, or capturing a preset
   writes the same clip fields the preview reads, through the store's
   `update` dispatch — so apply is live, undoable, and saved/reopened with
   the project. There is no separate "composer state" that can drift from
   the timeline.

## 2. Module map

| Area | Files | What it owns |
|---|---|---|
| Preset format | `src/presets/schema.js` | v1 schema, validation, sanitize, `.json` file parse/serialize (single preset or `{kind: 'cutflow.creative-preset-list'}`), legacy migration (`fromLegacyFilterPreset`, `fromLegacyTextTemplate`) |
| Registry | `src/presets/registry.js` | `TARGET_DEFS` (family, applies-to, param limits/defaults, renderers, performance tag per target), `variantExists`, `defaultParams`, `clampParams`, `getParam`/`setParam` (dotted paths) |
| Storage | `src/presets/store.js` | localStorage load/save/upsert/remove, one-shot legacy migration |
| Capture/apply | `src/presets/apply.js` | `capturePresetFromClip`, `presetClipPatch`, `presetTextPatch`, `presetAppliesTo` — **single clip only** (see §8: no multi-clip apply) |
| Assets | `src/presets/assets.js` | P2-17 asset manifest (LUT/font/media); import relinks against this machine, missing assets are reported, never silently substituted |
| Seeds | `src/presets/seeds.js` | Built-in read-only example presets (editing one copies it into user presets) |
| Composer UI | `src/components/ComposerPanel.jsx` | The one panel: browse/filter, apply, save-current, edit (registry sliders, live-applying), delete, import/export `.json` |
| Effect catalogs | `src/fx/catalog.js` (146 pixel + 24 overlay effects, engine transitions), `src/fx/catalog135.js` (+ `.json`, 135-name reference catalog), `src/effects.js` (`TRANSITIONS`, 119 total: native xfade + engine) | The inventories the registry validates variants against |
| Text catalogs | `src/text/catalog.js` (`TEXT_TEMPLATES`, incl. `caption: true` templates + `highlight` modes), `src/fx/textAnim.js` (`TEXT_ANIMS_IN/OUT/LOOP`), `src/text/captionPacks.js` | Titles, captions, word-level highlight modes (`scale`, `single`, `karaoke`, `color`, `none`), bubbles (`BUBBLES`, incl. `pill`) |
| Filter looks | `src/fx/filters.js` (`FILTERS`, 91 looks; `filterExpr`), `src/fx/lut.js` (bundled `.cube` LUTs) | One-click looks; a look is a `grade` object, drawn by the same GPU pass as Adjust |
| Grade | `src/fx/grade.js` (`gradeExpr`, `HSL_COLORS`, `curveFn`) | Temp/tint/saturation/exposure/contrast/tones/sharpen/clarity/fade/vignette/particles/curves + 8 HSL colour bands (hue/sat/light per band, weighted by hue distance — the HSL "mask") |
| Expression engine | `src/fx/expr.js`, `src/fx/gl.js` (`fxGL`), `src/fx/run.js`, `src/fx/selftest.js` | Parse → GLSL + CPU reference; `window.__fve.fxSelfTest()` compares GPU vs CPU in the app |
| Apply/routing | `src/fx/apply.js` | `pixelPasses` (adjust → filter/LUT → grade LUT → grade → clip effects → free effects → grade layers), `clipHasPixelFx`, `drawOverlayPasses`, `overlayRanges`, region masks (`fxRegions`, feathered) |
| Parameters | `src/fx/params.js` (`transitionExpr`, `resolveFxExpr`, `fxStrengthAt`, `fxTimingOf`), `src/fx/easing.js` (`EASE_PRESETS`, `easeValue`, `easePreset`), `src/components/CurveEditor.jsx` | Per-effect params, keyframed strength, timing windows, easing presets shared by preview/export/tests |
| Motion | `src/fx/motionPresets.js`, `src/fx/fxKeys.js` | Motion presets, keyframe storage |
| Audio presets | `src/fx/audioPresets.js`, `src/fx/audioFxChain.js` | 28 audio presets; chains are additive for Clean Voice, replace for the rest (see §8) |
| Export | `src/fxExport.js` (`renderFxPass`, `fxWork`), `electron/fxjobs.cjs` (segment decode/encode), `electron/ffmpeg.cjs` (`buildExportArgs`, `runExport`) | Renderer-side fx pass (WebGL) bakes overrides + transition segments; FFmpeg assembles. Text frames are drawn by the UI canvas renderer into `text.mov` (`project.textOverlay`); captions additionally serialize to an SRT `mov_text` stream (plain text + timings only, styling does not survive) |
| Recording | `src/useScreenRecorder.js` | Screen/window + camera (two recorders; camera lands as an overlay clip with shape/style/geometry), system audio and/or mic |
| Store | `src/store.js` | Project document, undoable dispatch, `videoLayout` (timeline starts, transition overlaps) |

## 3. Data flows

### 3.1 Apply a preset (Composer panel → preview)

```
ComposerPanel.applyPreset
  ├─ presetAppliesTo(preset) === 'picture'
  │    └─ updateTarget(presetClipPatch(preset))   // one undoable dispatch
  │         └─ clip.filter / .filterIntensity / .adjust / .audioFx /
  │            .transition.duration … (the same fields the preview reads)
  └─ else (text/caption)
       └─ dispatch({type:'update', track:'text', id, patch: presetTextPatch(preset)})
Preview (Preview.jsx) reads the clip → pixelPasses → WebGL / canvas draw.
```

Editing a preset's slider (`changeParam`) does the same live-apply on every
move, and persists the preset. Seeds are read-only: editing one copies it
first.

### 3.2 Save the current clip as a preset

```
ComposerPanel.saveCurrent → capturePresetFromClip(clip, target, name)
  → newCreativePreset({target, variant, params}) → upsertCreativePreset
  → localStorage (src/presets/store.js).
```

### 3.3 Import / export a preset file

`.json` in, `parseCreativePresetFile` (invalid entries reported and skipped,
never a throw) → asset relink (`relinkAssets`: bundled LUT by file, font by
family name; missing assets reported, preset still imports; id clash with a
different name/target gets a fresh id) → upsert. Export is
`serializeCreativePreset` (one) or `serializeCreativePresets` (library).
Portable packs (`.cutflowpack` v1, P2-17) are the sibling format for
filter-look presets with assets; the v1 `.json` preset carries an optional
`assets` manifest instead.

### 3.4 Render path (preview = export)

```
clip ──► pixelPasses(project, clip, clipStart, localT)
         [ adjust → filter/LUT → grade LUT → gradeExpr (incl. HSL/curves)
           → clip effects (params/strength/region/timing) → free effects
           → grade layers ]
       ├─► Preview: fxGL WebGL passes + drawOverlayPasses (canvas 2D)
       └─► Export: renderFxPass (same passes, WebGL in the renderer)
             → override files + transition segments (fxjobs.cjs)
             → buildExportArgs / FFmpeg assembly (+ text.mov overlay,
                + mov_text caption stream, + audio mix)
```

A clip reaches the fx pass only when `clipHasPixelFx` claims it. Native
transitions (`wipeleft`, `fade`, …) need no fx pass: the export renders them
with FFmpeg `xfade`. Engine transitions (`fx_*`, incl. `fx_irisout`) go
through the fx pass with `transitionExpr`. The morph cut (P3-03) analyses
its boundary pair once and reuses the analysis for preview and export.

### 3.5 Text / caption render path

A text clip is its template patch stored on the clip (`font`, `size`,
`color`, `stroke`, `shadow`, `effect`, `bubble`, `bg`, `highlight`,
`animIn/Out/Loop`). The preview draws it with the canvas text renderer;
the export draws the same renderer into `text.mov`. Word-level highlight
modes (`scale`, `single`, `karaoke`, `color`) need word timings; caption
packs (`src/text/captionPacks.js`) bundle a template + highlight + timing
preset. `title-decode` is the Decode template (`animIn: decode`).

## 4. Invariants (do not break these)

- **Preview == export by construction.** A look that exists only in the
  preview is a bug, not a feature. New renderers must go through
  `pixelPasses`/`drawOverlayPasses` or the fx pass, never a preview-only
  CSS/Canvas shortcut.
- **Deterministic.** Effects take a seed where they vary (`seed` param);
  the same project exports the same frames. Grain/particles hash on
  `(X, Y, floor(T·24))`, not on wall-clock time.
- **Variant validity.** A preset naming a non-existent variant is invalid
  (`variantExists`), never silently substituted — except LUT variants,
  which relink by filename on import.
- **Legacy migration is byte-identical.** A migrated legacy filter preset
  produces the same clip patch as the legacy one (pinned in
  `scripts/test-creative-presets.mjs`); old projects render identically.
- **Hard no's (Hamza's orders).** No plugin system; no synthesized /
  AI-generated SFX (licensed/original audio only); the 19 removed
  transitions and `cap-goldquote-hadith` stay removed; no cloud
  collaboration; MyInstants stays. The CSV's adapted mappings are never
  upgraded to `implemented` for appearances.

## 5. Performance notes

- The fx pass is per-frame IPC (`fxRead` → `fxGL` → `fxWrite`) with a
  segment cache for repeats (Sprint 9); batching the round-trips is open
  (B-F07). The export graph pins the output frame rate (the silent 25 fps
  re-grid is fixed) and tags BT.709 explicitly.
- Easing is one solver (`easeValue`) shared by preview, export, and tests.
- Overlay (particle/light) effects are drawn on canvas, not shaded; a
  region mask cannot wrap a LUT program, so a regioned layer's LUT grades
  the whole frame while sliders/curves/HSL stay masked (`apply.js`).

## 6. Testing entry points

- `node scripts/test-creative-presets.mjs` — schema/registry/store/
  capture/apply, no app needed.
- `node scripts/test-fx.mjs` — every transition/effect: expression parses,
  shader builds, CPU reference sane (GPU side: `FVE_SMOKE_MODE=fx`).
- `node scripts/test-fx-parity.cjs`, `test-transition-parity.cjs`,
  `test-blend-psnr`, `test-export-audio-parity.cjs` — component parity
  suites (the full deterministic golden-frame fixture, P1-19, is still
  open — CC scope).
- `node scripts/test-gap-f-verify.mjs` — §7 verification driver (29 CSV
  rows + HSL masks + Library/UX headless checks).
- `FVE_SMOKE_MODE=textanim|grade|screenrec|fx` — live-app smoke runs
  (see `electron/smoke*.cjs`).

## 7. Open gaps at this HEAD (owners in parentheses)

- True multi-pass bloom as a named preset — only `fx_bloom1` (single-pass
  glow) exists; CSV row 129 is an adapted stand-in (CC-01).
- No apply-to-multiple-selected-clips path; capture/apply is single-clip
  (CSV row 232; §7 verification 2026-11-15).
- No grouped editable vector/text layer-template system — graphics rows
  (178–197) are at best look-alike text templates (CC-06).
- No deterministic golden-frame fixture suite — component suites only
  (P1-19, CC scope).
- Audio presets still replace the whole chain (except Clean Voice, which
  is additive); no replace/merge mode or A/B preview (AU-04, B-F17).
- The 3D & Perspective CSV family has no 3D engine — all adapted to the
  same 2D stand-in except row 126 Cube (gated); do not build a 3D engine
  for these rows.

Row-level status for all 237 CSV rows lives in
`docs/creative-composer-audit.md` (CC-08).
