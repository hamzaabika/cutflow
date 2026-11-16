# Creative-composer demo — vertical sample timeline

`composer-vertical-demo.json` is the Master Stage 7 #3 demo: a 9 s vertical
(1080×1920, 30 fps) timeline that shows five composer beats against the
current engine. Regenerate it with `node scripts/make-composer-demo.cjs`
(add `--regenerate-media` to re-render the test clips with ffmpeg).

Media lives in `media/` next to the project (relative paths, so the project
opens wherever the folder is copied). The two demo clips are NOT bundled in
the repo (binaries travel by other routes — see AGENTS.md); regenerate them
with `node scripts/make-composer-demo.cjs --regenerate-media`.

## The five beats

| # | Beat | How it is built | Engine id |
|---|------|-----------------|-----------|
| 1 | Glow | Clip A carries the Glow Bloom effect | `fx_bloom2` |
| 2 | Film Burn A→B | Clip B enters with the Light Burn transition | `fx_lightburn` |
| 3 | Flicker | The caption animates in with Flicker | text anim `flicker` |
| 4 | Zoom | Clip C enters with the Zoom In transition | `fx_zoomin` |
| 5 | Caption highlight | The caption uses the Word Box highlight, word-timed | `highlight.mode: 'box'` |

## What is NOT in the demo (and why)

- **Film Burn as a transition is blocked.** `fx_filmburn` is one of the 19
  removed transitions and is not re-added. Beat 2 uses `fx_lightburn`, the
  never-removed burn-style A→B transition (A overexposes hotter until B
  fades in out of the blow-out). The generator script fails loudly if
  `fx_filmburn` (or any unknown effect/transition id) ever appears.
- **CC-01/CC-02 effects are not duplicated here.** The demo only references
  ids that already exist in the shipped catalog; if the Creative Composer
  stream adds new effects, the demo can adopt them, but it does not build
  them.
- **No audio.** The clips are silent test patterns; the demo is a visual
  timeline check, not a mix.

## How to open it

In Cutflow: File → Open project → `composer-vertical-demo.json` (keep the
`media/` folder next to it). Scrub the timeline: 0–3 s Glow, 3–6 s burn
transition into Dream Bloom, 6–9 s Zoom In, with the flickering boxed
caption running 0.5–8.5 s throughout.
