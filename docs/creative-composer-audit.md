# Creative Composer audit — Stage 0 verified inventory + gap matrix (CC-08)

**Source CSV:** `~/workspace/user/files/CutFlow_Creative_Preset_Backlog.csv` — 237 rows + header, verified 2026-11-15.
**Tree verified against:** worktree `~/.tmp-cc-e`, branch `cc-e`, HEAD `2ec51ae` (P3 complete).
**Spec:** `~/workspace/cutflow-audit-20261115/MASTER-SPEC.md` §5 CC-08, Appendix C. This file is the spec's Stage 0 deliverable (`docs/creative-composer-audit.md`).

## Method

Each CSV row was checked against the engine inventories loaded from the tree (not from memory or from the CSV's own claims — every row's `baseline_status` in the CSV is `VERIFY IN REPOSITORY / APP` and asserts nothing). Inventories dumped 2026-11-15 from `src/fx/catalog.js`, `src/fx/catalog135.js` (+ `.json`), `src/effects.js`, `src/text/catalog.js`, `src/fx/textAnim.js`, `src/text/render.js`, `src/fx/filters.js`, `src/fx/audioPresets.js`, `src/fx/motionPresets.js`, `src/stickers.js`, `src/presets/*`, `src/components/ComposerPanel.jsx`, `src/accessibility.js`, `src/favorites.jsx`, `src/recents.js`.

Engine inventory at HEAD `2ec51ae`: 119 transitions (`TRANSITIONS`, `src/effects.js`), 146 pixel effects + 24 overlay effects (`PIXEL_EFFECTS` / `OVERLAY_EFFECTS`), 118 text templates, 54 `ANIM_IN` / 52 `ANIM_OUT` / 11 `ANIM_LOOP` renderer ids, 53 in-presets + 51 out-presets (`TEXT_ANIMS_IN/OUT`), 91 filter looks, 28 audio presets, 9 motion presets, 86 stickers, 10 caption highlight modes, 12 text bubbles, 16 text effects. The 135-name reference catalog resolves 45 `implemented` / 90 `adapted` onto the 119 engine transitions.

## Verdict rules

- **implemented** — the engine performs the recipe as named (trivial wording differences allowed: `Slide In Left` vs `Slide Left`, `Zoom Punch` vs `Punch Zoom`), with the recipe's core behaviour and editable duration. The engine id is the evidence.
- **adapted** — the engine performs the same motion/effect class under a different name, or with a subset of the recipe's controls (e.g. no feather/softness param, no word-level variant, fixed amplitude). The nearest real engine id is named; nothing is presented as the recipe itself. Per CC-05 / P1-07, an adapted mapping is never upgraded to `implemented` for appearances.
- **missing** — no engine item performs the recipe. `BLOCKED` in the note means the item is gated by one of Hamza's orders (removed transitions, no synthesized SFX) or by a hard product boundary — it is not a build recommendation on its own.
- This pass verifies **existence and mapping only**. The CSV's `validation` column (preview/export parity, editable, undo/redo, save/reopen, deterministic, appropriate resolution) is **not** verified per row here — parity is the P1-19 golden-frame suite's job, and per-row live verification belongs to the §8 gate. A row marked `implemented` means the named renderer exists in the tree, not that it has passed a live apply/preview/export round-trip.
- No row was built twice: where a row maps to an existing anim/effect/transition it is marked, not implemented. No new presets were added in this pass (one rename decision below; no code change was needed for it).

## Summary

**Overall: 49 implemented / 109 adapted / 79 missing, of 237.**

| Category | Rows | Implemented | Adapted | Missing |
|---|---|---|---|---|
| Transition | 70 | 18 | 36 | 16 |
| Text Animation | 58 | 17 | 32 | 9 |
| Effect | 42 | 4 | 19 | 19 |
| Graphics | 29 | 0 | 15 | 14 |
| Audio | 16 | 0 | 0 | 16 |
| Captions | 10 | 5 | 5 | 0 |
| Library & UX | 12 | 5 | 2 | 5 |

| Priority | Rows | Implemented | Adapted | Missing |
|---|---|---|---|---|
| P1 | 130 | 38 | 54 | 38 |
| P2 | 99 | 11 | 55 | 33 |
| P3 | 8 | 0 | 0 | 8 |

Reading: the P1 slice is 38 implemented / 54 adapted / 38 missing — over a third of the P1 backlog has no engine item at all, and it is concentrated in the bloom/light family (CC-01, 13 of 14 glow rows missing as named presets), the removed-by-order transitions, and the Library & UX workflow rows. The P3 slice is 8/8 missing (all 3D/perspective transitions — the engine has no 3D renderer; the nearest items are 2D flips/spins). Audio is 16/16 missing: there is no bundled or licensed SFX library at all (see below).

## Duplicate recipe name — decision

`Masked Line Reveal` appears twice in the CSV with different ids/renderers:

- `cutflow.text-animation.masked-line-reveal` (Text Animation, entrance, P1) — **missing**. No masked-line text entrance exists in `ANIM_IN` (`src/text/catalog.js`); the nearest motions are `charSlideUp` / `charFade`.
- `cutflow.transition.masked-line-reveal` (Transition, wipe, P2) — **implemented** as `fx_maskreveal`, engine name **Mask Reveal**, with `shape` / `direction` / `feather` params (`src/fx/catalog.js:722`).

**Decision: keep both, with distinct names — no rename needed in code.** The collision exists only in the CSV's recipe names; in the tree the two things already have distinct names (`Masked Line Reveal` does not exist as a text anim; the transition is `Mask Reveal` / `fx_maskreveal`). If the text entrance is ever built, it must be named differently from the transition (suggested: `Masked Line Reveal` stays with the text entrance once built, and the transition keeps its engine name `Mask Reveal`) — or vice versa, but never two live items sharing one display name. Recorded here so the A–D merge re-verification does not re-open it.

## Blocked items (do not build without Hamza's fresh word)

- **Removed transitions (2026-11-14, commit 49c0bbe):** `cutflow.transition.warm-light-leak` (`fx_lightleak`), `cutflow.transition.procedural-film-burn` (`fx_filmburn`), `cutflow.transition.camera-roll-right` (`fx_rollright`). Re-adding any of them — including the film-burn / light-leak transitions CC-02/CC-05 name — requires Hamza's fresh word (MASTER-SPEC §7, Appendix B item 5).
- **SFX (all 16 Audio rows):** no synthesized/AI-generated SFX anywhere (Hamza's order, checklist #10 — the 34 synthesized SFX were deleted 2026-11-13). The only audio file in the tree is `shared/sfx/export-done.mp3` (Hamza's own timer-end sound, a UI sound, not a design SFX). `AudioLibrary.jsx` links out to MyInstants (external meme sounds, user-fetched from the web) — that is not a licensed SFX preset library and none of the 16 rows is marked against it. P2-15 stays BLOCKED.
- **True multi-pass bloom (CC-01):** the 13 missing Glow & Light rows are not a naming gap — there is no bloom pipeline (soft-knee extraction → multi-scale blur → tint/composite). `fx_bloom1`/`fx_bloom2` are single-pass glow approximations. Building the pipeline is CC-01 work, not a rename.
- **3D/perspective transitions (all 8 P3 rows):** no 3D renderer exists; the nearest engine items are 2D (`fx_spinout`, `fx_fliplr`, `fx_pagecurl`).
- **Stroke reveal / shape morph (CC-09):** `cutflow.graphics.stroke-draw-on` is missing — there is no mask/paint path; `morph-cut` maps to `fx_morphcut` (P3-03, real since this HEAD) but shape morph as a graphics effect does not exist.

## Gap matrix (all 237 rows)

Engine column is the evidence pointer: an engine id, a file, or `—` when nothing exists. Notes starting `BLOCKED` are gated items (above).

### Transition — 70 rows (18 implemented / 36 adapted / 16 missing)

| id | Recipe | Verdict | Engine evidence | Note |
|---|---|---|---|---|
| `cutflow.transition.smooth-push-left` | Smooth Push Left | **implemented** | fx_pushsmooth | Exact name + motion (catalog.js). |
| `cutflow.transition.smooth-push-right` | Smooth Push Right | **implemented** | fx_pullsmooth | Engine name 'Smooth Pull Right'; same rightward push motion. |
| `cutflow.transition.smooth-push-up` | Smooth Push Up | **adapted** | fx_slideup | No push-up renderer; Slide Up is the nearest (slide, no motion blur). |
| `cutflow.transition.smooth-push-down` | Smooth Push Down | **adapted** | fx_slidedown | No push-down renderer; Slide Down is the nearest. |
| `cutflow.transition.whip-pan-left` | Whip Pan Left | **implemented** | fx_whipleft | Exact name + motion. |
| `cutflow.transition.whip-pan-right` | Whip Pan Right | **implemented** | fx_whipright | Exact name + motion. |
| `cutflow.transition.whip-pan-up` | Whip Pan Up | **implemented** | fx_whipup | Exact name + motion. |
| `cutflow.transition.whip-pan-down` | Whip Pan Down | **implemented** | fx_whipdown | Exact name + motion. |
| `cutflow.transition.camera-slide-through` | Camera Slide Through | **adapted** | slideleft | Slide-through is a plain slide; no distinct renderer. |
| `cutflow.transition.camera-roll-left` | Camera Roll Left | **implemented** | fx_rollleft | Engine 'Roll Left'; same motion. |
| `cutflow.transition.camera-roll-right` | Camera Roll Right | **missing** | — | BLOCKED - fx_rollright was removed 2026-11-14 at Hamza's order (commit 49c0bbe); nearest fx_rollleft. |
| `cutflow.transition.soft-lens-push` | Soft Lens Push | **adapted** | fx_seamlesszoom | Zoom-push with blur; no distinct soft-lens renderer. |
| `cutflow.transition.seamless-zoom-in` | Seamless Zoom In | **implemented** | fx_seamlesszoom | Exact name + motion. |
| `cutflow.transition.seamless-zoom-out` | Seamless Zoom Out | **implemented** | fx_seamlesszoomout | Exact name + motion. |
| `cutflow.transition.snap-zoom` | Snap Zoom | **adapted** | fx_zoompunch | Punchy zoom; catalog135 maps snap-zoom to fx_zoomin. |
| `cutflow.transition.soft-zoom-cross` | Soft Zoom Cross | **adapted** | fx_zoomblur | Zoom-blur crossfade; no distinct soft-zoom-cross renderer. |
| `cutflow.transition.zoom-through` | Zoom Through | **implemented** | fx_zoomthrough | Exact name + motion. |
| `cutflow.transition.depth-push` | Depth Push | **adapted** | fx_warppush | Warp push; no depth-plane push. |
| `cutflow.transition.parallax-zoom` | Parallax Zoom | **missing** | — | No multi-plane/parallax zoom; nearest fx_seamlesszoom. |
| `cutflow.transition.punch-zoom` | Punch Zoom | **implemented** | fx_zoompunch | Engine 'Zoom Punch'; same motion. |
| `cutflow.transition.perspective-push` | Perspective Push | **missing** | — | No perspective/3D push; nearest fx_spinout (2D scale+rotate). |
| `cutflow.transition.smooth-camera-pull` | Smooth Camera Pull | **adapted** | fx_seamlesszoomout | Zoom-out pull; lateral pull is fx_pullsmooth. |
| `cutflow.transition.bloom-flash` | Bloom Flash | **adapted** | fx_glowdissolve | Glow dissolve; no true bloom flash (see CC-01). |
| `cutflow.transition.warm-light-leak` | Warm Light Leak | **missing** | — | BLOCKED - fx_lightleak removed 2026-11-14 at Hamza's order (commit 49c0bbe); nearest fx_lightburn / fx_flare. |
| `cutflow.transition.procedural-film-burn` | Procedural Film Burn | **missing** | — | BLOCKED - fx_filmburn removed 2026-11-14 at Hamza's order (commit 49c0bbe); nearest fx_lightburn. |
| `cutflow.transition.double-warm-flash` | Double Warm Flash | **adapted** | fx_flashframe | Single flash frame; no double-flash variant. |
| `cutflow.transition.soft-white-flash` | Soft White Flash | **implemented** | fadewhite | Engine 'Fade to White'. |
| `cutflow.transition.amber-edge-leak` | Amber Edge Leak | **adapted** | fx_lightburn | Warm burn/leak transition; edge placement not parametric. |
| `cutflow.transition.analog-lens-flare` | Analog Lens Flare | **adapted** | fx_flaresweep | Engine 'Lens Flare Sweep'. |
| `cutflow.transition.golden-bloom-reveal` | Golden Bloom Reveal | **adapted** | fx_glowdissolve | Glow dissolve; no bloom renderer. |
| `cutflow.transition.blue-light-sweep` | Blue Light Sweep | **adapted** | fx_flaresweep | Sweep exists; colour not parametric. |
| `cutflow.transition.vintage-film-gate-cut` | Vintage Film Gate Cut | **missing** | — | No film-gate cut transition; nearest fx_filmroll. |
| `cutflow.transition.organic-burn-wipe` | Organic Burn Wipe | **adapted** | fx_brush | Brush-cut organic edge wipe; no burn/char edge. |
| `cutflow.transition.overexposed-dissolve` | Overexposed Dissolve | **adapted** | fx_glowdissolve | Bright glow dissolve. |
| `cutflow.transition.directional-blur-reveal` | Directional Blur Reveal | **adapted** | fx_zoomblur | Zoom blur; direction not parametric. |
| `cutflow.transition.soft-blur-dissolve` | Soft Blur Dissolve | **implemented** | fx_blur | Blur crossfade (catalog135 blur-dissolve -> fx_blur). |
| `cutflow.transition.radial-motion-blur` | Radial Motion Blur | **implemented** | fx_radialblur | Exact motion-blur transition. |
| `cutflow.transition.focus-pull-transition` | Focus Pull Transition | **adapted** | fx_blur | Blur ramp; no focus-pull semantics. |
| `cutflow.transition.speed-blur` | Speed Blur | **adapted** | fx_radialblur | catalog135 speed-blur-transition -> fx_radialblur. |
| `cutflow.transition.bokeh-blur-cross` | Bokeh Blur Cross | **missing** | — | No bokeh blur; nearest fx_blur / fx_dreamy. |
| `cutflow.transition.gaussian-drift` | Gaussian Drift | **adapted** | fx_blur | Blur crossfade; drift is not a renderer. |
| `cutflow.transition.motion-match-blur` | Motion Match Blur | **missing** | — | No motion-matched blur; nearest fx_zoomblur. |
| `cutflow.transition.rgb-split-cut` | RGB Split Cut | **adapted** | fx_rgbslidel | Real RGB-split transition (slide variant); a cut variant is not distinct. |
| `cutflow.transition.horizontal-scan-tear` | Horizontal Scan Tear | **adapted** | fx_slices | Slice Shift horizontal displacement. |
| `cutflow.transition.pixel-slice-reveal` | Pixel Slice Reveal | **adapted** | fx_slices | Slice Shift. |
| `cutflow.transition.digital-compression-glitch` | Digital Compression Glitch | **adapted** | fx_glitch | Glitch transition. |
| `cutflow.transition.clean-datamosh-style-warp` | Clean Datamosh-Style Warp | **adapted** | fx_warp | Directional Warp; datamosh smear is a pixel effect (fx_mosh), not a transition. |
| `cutflow.transition.channel-shift-flicker` | Channel Shift Flicker | **adapted** | fx_glitch | Glitch transition; no channel-shift flicker renderer. |
| `cutflow.transition.wave-glitch-cut` | Wave Glitch Cut | **adapted** | fx_ripplewave | Ripple Wave. |
| `cutflow.transition.block-wipe-glitch` | Block Wipe Glitch | **adapted** | fx_tiles | Mosaic Tiles block wipe. |
| `cutflow.transition.signal-line-cut` | Signal Line Cut | **adapted** | fx_bandwipe | Band Wipe; signal-line motif not distinct. |
| `cutflow.transition.chromatic-edge-transition` | Chromatic Edge Transition | **adapted** | fx_glitch | catalog135 chromatic-aberration -> fx_glitch. |
| `cutflow.transition.luma-wipe-soft` | Luma Wipe Soft | **implemented** | fx_lumawipe | Real luma wipe + feather param (src/fx/catalog.js:718). |
| `cutflow.transition.linear-soft-wipe` | Linear Soft Wipe | **adapted** | wipeleft | Linear wipe; no feather param on wipeleft. |
| `cutflow.transition.diagonal-soft-wipe` | Diagonal Soft Wipe | **adapted** | fx_slidediag | Diagonal slide; no feather. |
| `cutflow.transition.gradient-sweep` | Gradient Sweep | **implemented** | fx_gradientwipe | Direction + feather params (src/fx/catalog.js:714). |
| `cutflow.transition.circle-reveal-soft` | Circle Reveal Soft | **adapted** | fx_irisout | Circle reveal; no feather param. |
| `cutflow.transition.diamond-reveal-smooth` | Diamond Reveal Smooth | **implemented** | fx_diamondreveal | Engine 'Diamond Reveal'. |
| `cutflow.transition.organic-ink-mask` | Organic Ink Mask | **adapted** | fx_brush | Brush-cut organic mask. |
| `cutflow.transition.rounded-panel-wipe` | Rounded Panel Wipe | **adapted** | fx_squircle | Squircle (rounded-square) wipe. |
| `cutflow.transition.masked-line-reveal` | Masked Line Reveal | **implemented** | fx_maskreveal | Engine 'Mask Reveal'; shape+direction+feather params. See duplicate decision. |
| `cutflow.transition.multiband-soft-wipe` | Multiband Soft Wipe | **adapted** | fx_bandwipe | Band Wipe; no feather. |
| `cutflow.transition.perspective-card-flip` | Perspective Card Flip | **missing** | — | No 3D perspective; nearest fx_fliplr (2D flip). |
| `cutflow.transition.smooth-3d-roll` | Smooth 3D Roll | **missing** | — | No 3D roll; nearest fx_spinout (2D). |
| `cutflow.transition.perspective-tilt` | Perspective Tilt | **missing** | — | No perspective tilt; nearest fx_spinout / fx_warp. |
| `cutflow.transition.folded-card-reveal` | Folded Card Reveal | **missing** | — | No folded-card 3D; nearest fx_pagecurl (2D page curl). |
| `cutflow.transition.orbit-camera-swap` | Orbit Camera Swap | **missing** | — | No 3D orbit; nearest fx_orbitwipe (2D wipe). |
| `cutflow.transition.cube-turn-simple` | Cube Turn Simple | **missing** | — | No cube turn; nearest fx_spinout. |
| `cutflow.transition.depth-rotation` | Depth Rotation | **missing** | — | No depth rotation; nearest fx_spinout. |
| `cutflow.transition.3d-card-push` | 3D Card Push | **missing** | — | No 3D card push; nearest fx_pushsmooth. |

### Text Animation — 58 rows (17 implemented / 32 adapted / 9 missing)

| id | Recipe | Verdict | Engine evidence | Note |
|---|---|---|---|---|
| `cutflow.text-animation.soft-rise` | Soft Rise | **adapted** | fadeUp | Rise+fade (src/text/render.js:283); no named 'Soft Rise' preset. |
| `cutflow.text-animation.rise-with-blur` | Rise with Blur | **adapted** | slideUpBlur | Rise+blur (render.js:266). |
| `cutflow.text-animation.slide-in-left` | Slide In Left | **implemented** | slideLeft | Same motion; name differs only by 'In'. |
| `cutflow.text-animation.slide-in-right` | Slide In Right | **implemented** | slideRight | Same motion; name differs only by 'In'. |
| `cutflow.text-animation.slide-in-up` | Slide In Up | **implemented** | slideUp | Same motion; name differs only by 'In'. |
| `cutflow.text-animation.slide-in-down` | Slide In Down | **implemented** | slideDown | Same motion; name differs only by 'In'. |
| `cutflow.text-animation.subtle-scale-pop` | Subtle Scale Pop | **adapted** | pop | Pop; subtlety not parametric. |
| `cutflow.text-animation.scale-pop-overshoot` | Scale Pop Overshoot | **adapted** | elasticPop | Elastic overshoot pop. |
| `cutflow.text-animation.drop-spring` | Drop Spring | **adapted** | springSettle | P3-06 damped spring settle; drop+spring combined is not a distinct preset. |
| `cutflow.text-animation.tracking-reveal` | Tracking Reveal | **implemented** | trackingIn | Letter-spacing settle = tracking reveal. |
| `cutflow.text-animation.smooth-character-reveal` | Smooth Character Reveal | **adapted** | charFade | Per-character fade reveal. |
| `cutflow.text-animation.staggered-word-reveal` | Staggered Word Reveal | **adapted** | wordRise | Per-word rise stagger. |
| `cutflow.text-animation.word-cascade` | Word Cascade | **adapted** | title-cascade | Cascade template (charSlideUp). |
| `cutflow.text-animation.masked-line-reveal` | Masked Line Reveal | **missing** | — | No masked-line text entrance in ANIM_IN; nearest charSlideUp / charFade. See duplicate decision. |
| `cutflow.text-animation.typewriter-clean` | Typewriter Clean | **implemented** | typewriter | Exact motion. |
| `cutflow.text-animation.soft-bounce-in` | Soft Bounce In | **adapted** | bounceUp | Bounce Up. |
| `cutflow.text-animation.light-sweep-reveal` | Light Sweep Reveal | **missing** | — | No light sweep across text; nearest title-neon. |
| `cutflow.text-animation.fade-up-editorial` | Fade Up Editorial | **implemented** | fadeUp | Fade Up; 'Editorial' is a style label, same motion. |
| `cutflow.text-animation.stretch-text-reveal` | Stretch Text Reveal | **implemented** | stretch | Scale-X reveal (render.js:251). |
| `cutflow.text-animation.rotation-settle` | Rotation Settle | **adapted** | slideRotate | Slide+rotate settle. |
| `cutflow.text-animation.soft-neon-flicker` | Soft Neon Flicker | **adapted** | title-flicker | Flicker template (charFlicker + glow). |
| `cutflow.text-animation.startup-neon-flicker` | Startup Neon Flicker | **adapted** | title-flicker | Flicker template. |
| `cutflow.text-animation.flicker-reveal` | Flicker Reveal | **adapted** | charFlicker | Per-character flicker reveal. |
| `cutflow.text-animation.flicker-out` | Flicker Out | **implemented** | flicker (out) | TEXT_ANIMS_OUT 'Flicker Out' (src/fx/textAnim.js). |
| `cutflow.text-animation.word-flicker` | Word Flicker | **adapted** | charFlicker | Per-character flicker; no word-level variant. |
| `cutflow.text-animation.digital-decode` | Digital Decode | **adapted** | title-decode | Decode template (decode anim). |
| `cutflow.text-animation.terminal-decode` | Terminal Decode | **adapted** | title-decode | Decode template. |
| `cutflow.text-animation.signal-interference-text` | Signal Interference Text | **missing** | — | No signal-interference text anim; nearest glitchIn. |
| `cutflow.text-animation.gentle-rgb-flicker` | Gentle RGB Flicker | **missing** | — | Flicker is opacity-only; no RGB-channel flicker; nearest charFlicker. |
| `cutflow.text-animation.electric-word-highlight` | Electric Word Highlight | **adapted** | cap-hormozi | Highlight colour + word pop (highlight mode 'scale' + pop anim). |
| `cutflow.text-animation.glitch-reveal` | Glitch Reveal | **adapted** | title-glitch | Glitch template (glitchIn). |
| `cutflow.text-animation.character-scan` | Character Scan | **missing** | — | No scan-line character reveal; nearest charFade. |
| `cutflow.text-animation.text-grain-reveal` | Text Grain Reveal | **missing** | — | No grain text reveal; nearest charFade. |
| `cutflow.text-animation.fade-and-flicker` | Fade and Flicker | **adapted** | flicker | Opacity flicker incl. fade envelope. |
| `cutflow.text-animation.pulse-decode` | Pulse Decode | **adapted** | decode + loop pulse | Decode anim + ANIM_LOOP pulse composable on one clip. |
| `cutflow.text-animation.neon-stabilize` | Neon Stabilize | **adapted** | cap-neon | Neon template; no stabilize concept. |
| `cutflow.text-animation.subtle-float` | Subtle Float | **implemented** | float (loop) | Vertical sine bob (render.js:314). |
| `cutflow.text-animation.slow-breath-scale` | Slow Breath Scale | **adapted** | pulse (loop) | 5% scale sine; speed adjustable via animLoop.speed. |
| `cutflow.text-animation.gentle-wiggle` | Gentle Wiggle | **adapted** | swing (loop) | Rotation oscillation +/-0.08 rad; amplitude fixed. |
| `cutflow.text-animation.soft-highlight-pulse` | Soft Highlight Pulse | **adapted** | highlight color + loop pulse | Active-word highlight + pulse loop. |
| `cutflow.text-animation.color-drift` | Color Drift | **adapted** | rainbow (loop) | Hue cycle; drift speed not distinct. |
| `cutflow.text-animation.position-sway` | Position Sway | **adapted** | float (loop) | Positional sine; vertical only. |
| `cutflow.text-animation.light-sweep-loop` | Light Sweep Loop | **missing** | — | No light-sweep loop; nearest cap-neon. |
| `cutflow.text-animation.gentle-type-oscillation` | Gentle Type Oscillation | **adapted** | wave (loop) | Per-character wave. |
| `cutflow.text-animation.idle-neon-pulse` | Idle Neon Pulse | **adapted** | cap-neon + loop pulse | Neon template + pulse loop. |
| `cutflow.text-animation.slow-tracking-shift` | Slow Tracking Shift | **missing** | — | No tracking loop; scaleTrack is an in-anim only; nearest scaleTrack. |
| `cutflow.text-animation.wave-text-offset` | Wave Text Offset | **adapted** | wave (loop) | Per-character wave. |
| `cutflow.text-animation.subtle-rotation-drift` | Subtle Rotation Drift | **adapted** | swing (loop) | Rotation oscillation. |
| `cutflow.text-animation.blur-fade-out` | Blur Fade Out | **implemented** | blurIn (out) | TEXT_ANIMS_OUT 'Blur Out'. |
| `cutflow.text-animation.drop-out` | Drop Out | **implemented** | drop (out) | TEXT_ANIMS_OUT 'Fly Up' (renderer mirrors drop for exits). |
| `cutflow.text-animation.slide-left-out` | Slide Left Out | **implemented** | slideLeft (out) | TEXT_ANIMS_OUT 'Slide Left'. |
| `cutflow.text-animation.slide-right-out` | Slide Right Out | **implemented** | slideRight (out) | TEXT_ANIMS_OUT 'Slide Right'. |
| `cutflow.text-animation.scale-to-zero` | Scale to Zero | **implemented** | zoomOut (out) | TEXT_ANIMS_OUT 'Scale Down'. |
| `cutflow.text-animation.tracking-collapse` | Tracking Collapse | **implemented** | trackingIn (out) | TEXT_ANIMS_OUT 'Tracking Out'. |
| `cutflow.text-animation.word-cascade-exit` | Word Cascade Exit | **adapted** | wordRise (out) | TEXT_ANIMS_OUT 'Word Fall'. |
| `cutflow.text-animation.character-scatter` | Character Scatter | **missing** | — | No scatter exit; nearest waveIn 'Letters Out'. |
| `cutflow.text-animation.shallow-rotate-exit` | Shallow Rotate Exit | **adapted** | tiltIn (out) | TEXT_ANIMS_OUT 'Tilt Out'. |
| `cutflow.text-animation.soft-dissolve-exit` | Soft Dissolve Exit | **implemented** | softFade (out) | TEXT_ANIMS_OUT 'Soft Fade Out'. |

### Effect — 42 rows (4 implemented / 19 adapted / 19 missing)

| id | Recipe | Verdict | Engine evidence | Note |
|---|---|---|---|---|
| `cutflow.effect.clean-soft-bloom` | Clean Soft Bloom | **missing** | — | CC-01: true multi-pass bloom MISSING as a named preset; nearest fx_bloom1 Soft Bloom (single-pass glow). |
| `cutflow.effect.neon-sign-glow` | Neon Sign Glow | **missing** | — | No neon-glow pixel effect; nearest title-neon / TEXT_EFFECTS neon (text only). |
| `cutflow.effect.warm-halation` | Warm Halation | **missing** | — | CC-09: halation MISSING as a named effect; nearest fx_bloom2 / fx_washgold. |
| `cutflow.effect.dream-bloom` | Dream Bloom | **missing** | — | No dream-bloom preset; nearest fx_bloom2 Glow Bloom / fx_soft2 Dream Blur. |
| `cutflow.effect.cool-diffuse-glow` | Cool Diffuse Glow | **missing** | — | No cool diffuse glow; nearest fx_bloom1. |
| `cutflow.effect.golden-film-bloom` | Golden Film Bloom | **missing** | — | No golden bloom; nearest fx_washgold Golden Wash. |
| `cutflow.effect.chromatic-neon` | Chromatic Neon | **missing** | — | No chromatic neon effect; nearest fx_prismglow Prism Glow. |
| `cutflow.effect.text-glow-pulse` | Text Glow Pulse | **adapted** | TEXT_EFFECTS glow + loop pulse | Text glow + pulse loop composable (cap-glowsoft 'Soft Glow'). |
| `cutflow.effect.subject-edge-halo` | Subject Edge Halo | **missing** | — | No edge-halo effect; nearest fx_halo Halo Ring / fx_neonedge Neon Edges. |
| `cutflow.effect.low-key-glow` | Low-Key Glow | **missing** | — | No low-key glow; nearest fx_bloom1. |
| `cutflow.effect.cinematic-highlight-halo` | Cinematic Highlight Halo | **missing** | — | No highlight halo; nearest fx_halo. |
| `cutflow.effect.light-sweep-accent` | Light Sweep Accent | **missing** | — | No light-sweep pixel effect; nearest fx_sunglow Sun Glow / fx_flaresweep (transition). |
| `cutflow.effect.color-bloom` | Color Bloom | **missing** | — | No color bloom; nearest fx_bloom2. |
| `cutflow.effect.glass-highlight-glow` | Glass Highlight Glow | **missing** | — | No glass highlight glow; nearest fx_frost Frosted Glass / fx_prismglow. |
| `cutflow.effect.analog-film-burn-overlay` | Analog Film Burn Overlay | **missing** | — | CC-02: procedural film-burn EFFECT missing; nearest fx_lightburn (transition) / fx_burning (overlay). |
| `cutflow.effect.warm-edge-leak-overlay` | Warm Edge Leak Overlay | **adapted** | fx_leakedge | Edge Burn + warm leak family fx_leaktl / fx_leaktr / fx_leakbl. |
| `cutflow.effect.soft-organic-leak` | Soft Organic Leak | **adapted** | fx_leakbl | Light Leak Bottom; organic softness not parametric. |
| `cutflow.effect.light-streak-overlay` | Light Streak Overlay | **adapted** | fx_leakstrip | Leak Strip. |
| `cutflow.effect.vintage-grain` | Vintage Grain | **adapted** | fx_grainfine + fx_faded | Grain + faded film; no single named preset combining them. |
| `cutflow.effect.halation-and-grain` | Halation and Grain | **missing** | — | CC-09: halation MISSING; nearest fx_grainfine + fx_bloom1. |
| `cutflow.effect.8mm-gate-weave` | 8mm Gate Weave | **missing** | — | CC-09: gate weave MISSING; nearest fx_filmroll / fx_flicker. |
| `cutflow.effect.scratch-overlay` | Scratch Overlay | **implemented** | fx_scratch | Engine 'Scratches & Dust'. |
| `cutflow.effect.paper-texture` | Paper Texture | **adapted** | fx_agedpaper | Aged Paper. |
| `cutflow.effect.dust-flecks` | Dust Flecks | **adapted** | fx_dust | Dust Motes overlay. |
| `cutflow.effect.subtle-vhs-tracking` | Subtle VHS Tracking | **implemented** | fx_vhstrack | Engine 'VHS Tracking Band'. |
| `cutflow.effect.betacam-soft-noise` | Betacam Soft Noise | **adapted** | fx_vhs | VHS Noise; Betacam softness not distinct. |
| `cutflow.effect.old-film-frame` | Old Film Frame | **adapted** | fx_filmborder + fx_oldphoto | Film Border + Old Photo. |
| `cutflow.effect.warm-chemical-flash` | Warm Chemical Flash | **missing** | — | No chemical flash; nearest fx_flashframe (transition) / fx_washgold. |
| `cutflow.effect.analog-color-bloom` | Analog Color Bloom | **missing** | — | No analog color bloom; nearest fx_bloom2. |
| `cutflow.effect.fine-color-grain` | Fine Color Grain | **implemented** | fx_colorgrain | Engine 'Color Grain'. |
| `cutflow.effect.chromatic-edge-split` | Chromatic Edge Split | **adapted** | fx_rgb2 | RGB Split Light. |
| `cutflow.effect.soft-wave-warp` | Soft Wave Warp | **adapted** | fx_wavewarp | Wave Warp; softness not parametric. |
| `cutflow.effect.gentle-heat-haze` | Gentle Heat Haze | **missing** | — | No heat-haze shimmer; nearest fx_wavewarp / fx_pond. |
| `cutflow.effect.liquid-refraction` | Liquid Refraction | **adapted** | fx_pond | Pond Ripple water displacement; no true refraction shader. |
| `cutflow.effect.glass-ripple` | Glass Ripple | **adapted** | fx_pond | Pond Ripple (+ fx_frost). |
| `cutflow.effect.pixel-trail` | Pixel Trail | **adapted** | fx_zoomtrails | Zoom Trails (zoom echo, not a pixel echo). |
| `cutflow.effect.motion-echo` | Motion Echo | **adapted** | fx_zoomtrails | Zoom Trails. |
| `cutflow.effect.outline-trace` | Outline Trace | **adapted** | fx_edgelines | Edge Lines. |
| `cutflow.effect.neon-line-outline` | Neon Line Outline | **adapted** | fx_neonedge | Neon Edges. |
| `cutflow.effect.radial-light-warp` | Radial Light Warp | **adapted** | fx_radial1 | Radial Blur. |
| `cutflow.effect.crt-screen-curve` | CRT Screen Curve | **adapted** | fx_crt | CRT Grille (grille only; CC-09: unified CRT incl. curvature MISSING). |
| `cutflow.effect.scanline-video` | Scanline Video | **implemented** | fx_scanline | Engine 'Scanlines'. |

### Graphics — 29 rows (0 implemented / 15 adapted / 14 missing)

| id | Recipe | Verdict | Engine evidence | Note |
|---|---|---|---|---|
| `cutflow.graphics.minimal-single-title` | Minimal Single Title | **adapted** | cap-minimal | Minimal template. |
| `cutflow.graphics.editorial-two-line-title` | Editorial Two-Line Title | **adapted** | mat-duo-title | Violet Duo (two-line title). |
| `cutflow.graphics.filled-rounded-label` | Filled Rounded Label | **adapted** | mat-pill-label | Craft Pill (+ BUBBLES pill); text template, not a grouped vector layer. |
| `cutflow.graphics.outline-rounded-label` | Outline Rounded Label | **adapted** | title-hollow + BUBBLES rounded | Outline style + rounded bubble; no grouped vector label. |
| `cutflow.graphics.neon-lower-third` | Neon Lower Third | **adapted** | mat-lower-third + title-neon | Violet Third + Neon Sign. |
| `cutflow.graphics.clean-lower-third` | Clean Lower Third | **adapted** | stu-name-third | Studio Third. |
| `cutflow.graphics.headline-underline` | Headline Underline | **adapted** | mat-accent-bar | Accent Rule (+ BUBBLES underline). |
| `cutflow.graphics.split-screen-title` | Split Screen Title | **missing** | — | No split-screen title; nearest title-bold. |
| `cutflow.graphics.cinematic-simple-credits` | Cinematic Simple Credits | **missing** | — | No credits template/roll; nearest title-elegant. |
| `cutflow.graphics.chapter-intro` | Chapter Intro | **missing** | — | No chapter-intro graphic (src/chapters.js is markers only); nearest title-bold. |
| `cutflow.graphics.subtle-callout-caption` | Subtle Callout Caption | **adapted** | mat-caption-chip | Craft Chip. |
| `cutflow.graphics.social-cta-bar` | Social CTA Bar | **adapted** | label-subscribe | Subscribe template. |
| `cutflow.graphics.brand-endcard` | Brand Endcard | **adapted** | cap-brand-en | Brand English (+ ar/darija/bilingual). |
| `cutflow.graphics.stroke-draw-on` | Stroke Draw On | **missing** | — | CC-09: stroke reveal MISSING; no mask/paint path. |
| `cutflow.graphics.arrow-trace` | Arrow Trace | **missing** | — | Static arrow stickers only (arrow-right etc.); no animated trace. |
| `cutflow.graphics.circle-draw` | Circle Draw | **missing** | — | No animated circle draw; nearest static shape sticker. |
| `cutflow.graphics.animated-underline` | Animated Underline | **missing** | — | BUBBLES underline is static; no draw-on animation. |
| `cutflow.graphics.bubble-pop` | Bubble Pop | **adapted** | label-speech + pop | Speech bubble template + pop anim. |
| `cutflow.graphics.progress-ring` | Progress Ring | **missing** | — | CC-06: progress ring MISSING. |
| `cutflow.graphics.number-counter` | Number Counter | **missing** | — | CC-06: counters MISSING; nearest mat-big-number (static big number). |
| `cutflow.graphics.countdown-timer` | Countdown Timer | **missing** | — | CC-06: timer MISSING. |
| `cutflow.graphics.progress-bar` | Progress Bar | **missing** | — | No progress bar graphic. |
| `cutflow.graphics.pointer-highlight` | Pointer Highlight | **adapted** | ptr-cursor | Click Cursor sticker (static; no animated highlight). |
| `cutflow.graphics.doodle-accent` | Doodle Accent | **missing** | — | No doodle-style graphic; nearest shape-sparkle sticker (static). |
| `cutflow.graphics.shape-swoosh` | Shape Swoosh | **missing** | — | arrow-swoosh sticker is static; no animated swoosh. |
| `cutflow.graphics.rounded-panel-reveal` | Rounded Panel Reveal | **adapted** | mat-pill-label + slide | Craft Pill + slide anim. |
| `cutflow.graphics.kinetic-dot-grid` | Kinetic Dot Grid | **missing** | — | No dot-grid kinetic graphic. |
| `cutflow.graphics.simple-confetti` | Simple Confetti | **adapted** | fx_confetti | Confetti particle overlay. |
| `cutflow.graphics.clean-hud-bracket` | Clean HUD Bracket | **adapted** | label-brackets | Brackets (+ label-frame Frame). |

### Audio — 16 rows (0 implemented / 0 adapted / 16 missing)

| id | Recipe | Verdict | Engine evidence | Note |
|---|---|---|---|---|
| `cutflow.audio.soft-whoosh` | Soft Whoosh | **missing** | — | No bundled/licensed SFX; nearest is the AudioLibrary MyInstants web link (external meme sounds, not a preset). BLOCKED - P2-15: no synthesized SFX. |
| `cutflow.audio.fast-swish` | Fast Swish | **missing** | — | No bundled/licensed SFX; nearest MyInstants web link. BLOCKED - P2-15. |
| `cutflow.audio.reverse-rise` | Reverse Rise | **missing** | — | No bundled/licensed SFX; nearest MyInstants web link. BLOCKED - P2-15. |
| `cutflow.audio.minimal-click` | Minimal Click | **missing** | — | No bundled/licensed SFX; nearest MyInstants web link. BLOCKED - P2-15. |
| `cutflow.audio.button-pop` | Button Pop | **missing** | — | No bundled/licensed SFX; nearest MyInstants web link. BLOCKED - P2-15. |
| `cutflow.audio.soft-impact` | Soft Impact | **missing** | — | No bundled/licensed SFX; nearest MyInstants web link. BLOCKED - P2-15. |
| `cutflow.audio.deep-impact` | Deep Impact | **missing** | — | No bundled/licensed SFX; nearest MyInstants web link. BLOCKED - P2-15. |
| `cutflow.audio.text-blip` | Text Blip | **missing** | — | No bundled/licensed SFX; nearest MyInstants web link. BLOCKED - P2-15. |
| `cutflow.audio.digital-bleep` | Digital Bleep | **missing** | — | No bundled/licensed SFX; nearest MyInstants web link. BLOCKED - P2-15. |
| `cutflow.audio.transition-whoosh` | Transition Whoosh | **missing** | — | No bundled/licensed SFX; nearest MyInstants web link. BLOCKED - P2-15. |
| `cutflow.audio.low-cinematic-riser` | Low Cinematic Riser | **missing** | — | No bundled/licensed SFX; nearest MyInstants web link. BLOCKED - P2-15. |
| `cutflow.audio.tiny-ui-tick` | Tiny UI Tick | **missing** | — | No bundled/licensed SFX; nearest MyInstants web link. BLOCKED - P2-15. |
| `cutflow.audio.warm-ambient-sweep` | Warm Ambient Sweep | **missing** | — | No bundled/licensed SFX; nearest MyInstants web link. BLOCKED - P2-15. |
| `cutflow.audio.glitch-chirp` | Glitch Chirp | **missing** | — | No bundled/licensed SFX; nearest MyInstants web link. BLOCKED - P2-15. |
| `cutflow.audio.mechanical-tap` | Mechanical Tap | **missing** | — | No bundled/licensed SFX; nearest MyInstants web link. BLOCKED - P2-15. |
| `cutflow.audio.short-bass-accent` | Short Bass Accent | **missing** | — | No bundled/licensed SFX; nearest MyInstants web link. BLOCKED - P2-15. |

### Captions — 10 rows (5 implemented / 5 adapted / 0 missing)

| id | Recipe | Verdict | Engine evidence | Note |
|---|---|---|---|---|
| `cutflow.captions.word-pop-highlight` | Word Pop Highlight | **implemented** | cap-hormozi | Highlight 'scale' + pop anim, word timings. |
| `cutflow.captions.smooth-single-word-reveal` | Smooth Single Word Reveal | **implemented** | cap-oneword | One Word + highlight 'single'. |
| `cutflow.captions.line-fade-subtitle` | Line Fade Subtitle | **implemented** | cap-subtitle | Subtitle template + fade anim. |
| `cutflow.captions.two-word-cascade` | Two-Word Cascade | **adapted** | title-cascade | Cascade; two-word grouping not distinct. |
| `cutflow.captions.active-word-glow` | Active Word Glow | **adapted** | cap-neon + highlight color | Neon glow + active-word highlight. |
| `cutflow.captions.pill-background-subtitle` | Pill Background Subtitle | **implemented** | BUBBLES pill + cap templates | Pill bubble background on subtitle templates. |
| `cutflow.captions.clean-karaoke-style` | Clean Karaoke Style | **implemented** | cap-karaoke | Word Sweep, highlight 'karaoke'. |
| `cutflow.captions.rtl-word-pulse` | RTL Word Pulse | **adapted** | cap-arabic + loop pulse | Arabic Bold + pulse loop; word-level RTL pulse timing not distinct. |
| `cutflow.captions.subtitle-minimal-lift` | Subtitle Minimal Lift | **adapted** | cap-minimal + fadeUp | Minimal + rise. |
| `cutflow.captions.caption-scale-settle` | Caption Scale Settle | **adapted** | highlight scale + springSettle | Scale highlight + spring settle. |

### Library & UX — 12 rows (5 implemented / 2 adapted / 5 missing)

| id | Recipe | Verdict | Engine evidence | Note |
|---|---|---|---|---|
| `cutflow.library-&-ux.favorite-presets` | Favorite Presets | **implemented** | src/favorites.jsx + electron/favorites.cjs | Favorites toggle/list in the app. |
| `cutflow.library-&-ux.recently-used-presets` | Recently Used Presets | **missing** | — | src/recents.js tracks recent PROJECTS only; no recent-presets list found. |
| `cutflow.library-&-ux.preset-import-export` | Preset Import Export | **implemented** | src/components/ComposerPanel.jsx + src/presets/schema.js | .json import (parseCreativePresetFile) + export in ComposerPanel. |
| `cutflow.library-&-ux.custom-collections` | Custom Collections | **missing** | — | 10 built-in collections only (src/fx/collections.js); no user-created collections. |
| `cutflow.library-&-ux.render-preview-on-user-clip` | Render Preview on User Clip | **adapted** | src/fx/previews.jsx | Tiles render from sample scenes/bundled photos, not the user's selected clip. |
| `cutflow.library-&-ux.hover-scrub-thumbnail` | Hover Scrub Thumbnail | **missing** | — | MediaPeek is click-to-peek with scrub; no hover-scrub thumbnails. |
| `cutflow.library-&-ux.multi-clip-apply` | Multi-Clip Apply | **missing** | — | No apply-to-multiple-selected-clips path found. |
| `cutflow.library-&-ux.copy-paste-animation` | Copy Paste Animation | **missing** | — | No animation copy/paste (clip copy/paste is separate). |
| `cutflow.library-&-ux.preset-variant-controls` | Preset Variant Controls | **implemented** | src/components/ComposerPanel.jsx + src/presets/registry.js | Variant + paramDefs sliders per preset. |
| `cutflow.library-&-ux.easing-graph-presets` | Easing Graph Presets | **implemented** | src/fx/easing.js EASE_PRESETS + src/components/CurveEditor.jsx | Easing presets rendered in the curve editor. |
| `cutflow.library-&-ux.reduce-flash-mode` | Reduce Flash Mode | **implemented** | src/accessibility.js | reduceMotion / reduceFlashing settings. |
| `cutflow.library-&-ux.asset-license-inspector` | Asset License Inspector | **adapted** | src/components/AudioLibrary.jsx + src/assetsLib.js | License badges + credit lines per item; no dedicated inspector panel. |

## What this pass did NOT do

- No preset was built, renamed in code, or re-added. The only rename consideration (Masked Line Reveal) needed no code change — see the decision above.
- No per-row live apply/preview/export check: that is the §8 gate's job (fixture-driven, after the A–D merge). Spot live verification of mapped items is recorded in the gate report, not here.
- The `validation` column of the CSV (parity / editable / undo-redo / save-reopen / deterministic / resolution) is a requirement per row, not a verified fact — it is asserted by no row and verified by none in this pass.

## Re-verification after the A–D merge — amendment 2026-11-15

Re-verified by the CC coordinator against merged HEAD `748e78a` (P3 + all CC
streams A–E + forgotten-buildable streams F1–F5 merged, plus the §8-gate
xfade fix). Only rows affected by the merged streams were re-checked, each
against the merged tree's inventories — `src/fx/catalog.js` (CC-01 bloom
entries `fx_bloom_*`, CC-02 `fx_burnleak` presets, CC-09 `fx_crtvhs` /
`fx_glassprism` / `fx_strokereveal` / `fx_shapemorph`), `src/text/catalog.js`
(`flk-*`, `gfx-*`), `src/components/ComposerPanel.jsx` (recent presets),
`src/fx/applyToSelected.js` (multi-clip helper), CC-04 `copyMotion` /
`pasteMotion` (`src/anim.js`). Rows untouched by the merge keep the verdicts
above. This is still Stage 0 (existence and mapping only); per-row live
apply/preview/export verification remains the §8 gate's job.

**New totals: 75 implemented / 113 adapted / 49 missing, of 237** (was
49 / 109 / 79).

| Category | Rows | Implemented | Adapted | Missing |
|---|---|---|---|---|
| Transition | 70 | 19 | 36 | 15 |
| Text Animation | 58 | 24 | 28 | 6 |
| Effect | 42 | 15 | 26 | 1 |
| Graphics | 29 | 5 | 15 | 9 |
| Audio | 16 | 0 | 0 | 16 |
| Captions | 10 | 5 | 5 | 0 |
| Library & UX | 12 | 7 | 3 | 2 |

| Priority | Rows | Implemented | Adapted | Missing |
|---|---|---|---|---|
| P1 | 130 | 59 | 58 | 13 |
| P2 | 99 | 16 | 55 | 28 |
| P3 | 8 | 0 | 0 | 8 |

### Missing → implemented (17)

- Effect: Clean Soft Bloom (`fx_bloom_clean`), Neon Sign Glow
  (`fx_bloom_neon`, "Neon Sign"), Warm Halation (`fx_bloom_halation`),
  Dream Bloom (`fx_bloom_dream`, "Dream"), Cool Diffuse Glow
  (`fx_bloom_cool`, "Cool Diffuse"), Chromatic Neon (`fx_bloom_chroma`),
  Cinematic Highlight Halo (`fx_bloom_halo`, "Highlight Halo"), Color Bloom
  (`fx_bloom_color`, "Colored Bloom"), Light Sweep Accent
  (`fx_bloom_sweep`, "Gentle Light Sweep"), Analog Film Burn Overlay
  (`fx_burnleak`, continuous effect with 12 variations).
- Text Animation: Character Scan (`flk-char-scan`).
- Graphics: Stroke Draw On (`fx_strokereveal`, real mask-paint path),
  Progress Ring (`gfx-progress-ring`), Number Counter (`gfx-kinetic-number`),
  Countdown Timer (`gfx-timer-countdown`).
- Library & UX: Recently Used Presets (ComposerPanel recent-presets list +
  `recent` chip), Copy Paste Animation (CC-04 `copyMotion` / `pasteMotion`,
  keyframes + in/out/combo to another layer).

### Adapted → implemented (9)

- Transition: Bloom Flash (`fx_bloomflash`, real CC-05 transition).
- Text Animation: Soft Neon Flicker (`flk-soft-neon`), Startup Neon Flicker
  (`flk-startup-neon`, "Startup Neon"), Flicker Reveal
  (`flk-flicker-reveal`), Word Flicker (`flk-word-flicker`, word-level as
  the recipe requires), Digital Decode (`flk-digital-decode`), Terminal
  Decode (`flk-terminal-resolve`, "Terminal Resolve").
- Effect: Text Glow Pulse (`fx_bloom_textpulse`, "Text Glow Pulse").
- Graphics: Minimal Single Title (`gfx-minimal-title`, "Minimal Title").

### Missing → adapted (13)

- Effect: Golden Film Bloom (`fx_bloom_halation` warm gold + CC-02 Gold
  Bloom variation), Subject Edge Halo (`fx_bloom_edge`, "Edge Glow"),
  Low-Key Glow (`fx_bloom_clean` at low intensity — no dedicated low-key
  preset), Glass Highlight Glow (`fx_glassprism`, glass light-play class;
  no dedicated highlight-glow preset), Halation and Grain (halation toggle
  + grain param on `fx_burnleak`, composable, no single named preset),
  8mm Gate Weave (Dirty 8mm variation, `gateWeave: true`), Warm Chemical
  Flash (Center Flash, warmth 0.85), Analog Color Bloom (`fx_bloom_color`,
  "Colored Bloom"; no distinct analog-film variant).
- Text Animation: Signal Interference Text (`flk-signal-error`, RGB-glitch
  signal class), Gentle RGB Flicker (`flk-rgb-glitch`, "RGB Glitch Reveal";
  RGB-channel motion exists, as a reveal rather than a gentle loop).
- Transition: Motion Match Blur (`fx_blurreveal`, directional blur
  transition; no motion-matched direction).
- Graphics: Circle Draw (`gfx-progress-ring` — the ring draws its circular
  arc progressively).
- Library & UX: Multi-Clip Apply (shared helper
  `src/fx/applyToSelected.js`, wired in LeftPanel; the Composer tile path
  is still an explicit TODO in `ComposerPanel.jsx`).

### Adapted, engine id updated (verdict unchanged, 6)

- Transition: Golden Bloom Reveal and Overexposed Dissolve
  (`fx_glowdissolve` → `fx_bloomflash`).
- Text Animation: Electric Word Highlight (`cap-hormozi` →
  `flk-electric-subtitle`), Flicker Out (engine id now `flk-flicker-out`;
  was already implemented).
- Graphics: Editorial Two-Line Title (`mat-duo-title` →
  `gfx-editorial-third`), Outline Rounded Label (`title-hollow` + BUBBLES
  → `gfx-outline-label`), Rounded Panel Reveal (`mat-pill-label` + slide →
  `gfx-text-box-pop`).

### Still missing (unchanged)

- Transitions: the three removed-by-order rows (Camera Roll Right, Warm
  Light Leak, Procedural Film Burn — BLOCKED, need Hamza's word), all eight
  P3 3D/perspective rows (no 3D renderer), Bokeh Blur Cross (no bokeh
  transition), Vintage Film Gate Cut (CC-02 Film Gate Burn is an effect,
  not a cut transition).
- Text Animation: Masked Line Reveal (decision stands), Light Sweep Reveal
  and Light Sweep Loop (no text light sweep; the pixel-effect cousin is
  `fx_bloom_sweep`), Text Grain Reveal, Slow Tracking Shift, Character
  Scatter.
- Effect: Gentle Heat Haze (no heat-haze effect).
- Graphics: Split Screen Title, Cinematic Simple Credits, Chapter Intro,
  Arrow Trace (Callout Arrow exists but does not trace; Stroke Reveal is
  the draw-on mechanism, not yet combined), Animated Underline, Progress
  Bar, Doodle Accent, Shape Swoosh, Kinetic Dot Grid.
- Audio: all 16 rows (no bundled/licensed SFX; BLOCKED by Hamza's order).
- Library & UX: Custom Collections (10 built-in collections only), Hover
  Scrub Thumbnail (tiles animate on hover; no positional scrub).

