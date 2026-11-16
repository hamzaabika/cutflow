# The 3 further M items — re-derivation attempt (Stream B)

## Verdict: unresolvable as an exact set — do not invent items

The gap file (§5.2) says worker B counted 22 distinct items but could only
name 19 in its tables, leaving "3 further M items … the re-analysis could
not name them". Re-deriving them exactly from Doc B (`~/workspace/user/files/1.md`)
and the Master Prompt (`~/workspace/user/files/CutFlow_AI_Agent_Master_Implementation_Prompt.md`)
was attempted and **could not be closed**, for two reasons:

1. **The arithmetic does not reconcile.** §5.2 lists 16 bullets. Counting
   the multi-item bullet (Callout Arrow / Progress Ring / Timer Countdown
   = 3 items) gives 18 named distinct items, not 19 — so even the size of
   the unnamed remainder is uncertain (22 − 18 = 4, not 3). There is no
   worker-B worksheet in the repo to check against.
2. **Several plausible candidates overlap CC scope or decisions**, so
   naming any three as "the" three would be a guess, and the task
   forbids inventing items.

## What was checked

Each Master Prompt stage item was checked against the repo (grep over
`src/fx/catalog.js`, `src/fx/textAnim.js`, `src/store.js`, `src/agent/`,
`src/components/`, `electron/`). Items already named in §5.2/§5.3/§5.4,
items present in the repo, and items in CC scope were excluded from the
candidate list below — except where the overlap itself is the finding.

## Verified candidates (each missing in the repo, with evidence)

These are the Master Prompt items that are genuinely absent and not
already named in the gap file. Any three of them *could* be worker B's
three; the evidence does not pick which.

| # | Master Prompt item | Repo evidence | Scope flag |
|---|---|---|---|
| 1 | Stage 2B — Film Burn **Effect** (continuous/timed, on video/overlay/effects track), distinct from the transition | No `fx_burn*` pixel effect exists (`grep id: 'fx_burn'` = 0). Only the transition side exists (`fx_lightburn` as the stand-in; `fx_filmburn` removed). | Possible CC-09 (analog effects) overlap — confirm with the CC stream before building. |
| 2 | Stage 3 #7 — Directional Motion Blur transition | No `fx_motionblur` / `fx_directionblur` in the catalog (0 hits). | CC-05 (transitions) — list and skip if CC covers it, like Stage 3 #10. |
| 3 | Stage 3 #8 — RGB Split Cut transition | No `fx_rgbsplit` in the catalog (0 hits). | CC-05 (transitions) — same as #2. |
| 4 | Stage 2D — copy animation to another layer | No `copyAnim` / `pasteAnim` anywhere in `src/` (0 hits). Clip copy carries animation with the clip; there is no animation-only copy. | Not obviously CC; needs a scope call. |
| 5 | Stage 4 — apply a preset/effect to **selected multiple clips** | No apply-to-multiple path found (`applyTo`, "multiple clips" = 0 hits). | Not obviously CC; needs a scope call. |
| 6 | Stage 2A — parametric bloom controls (Threshold, Softness, Radius, Intensity, Color, Blend Mode, Mask Source, Quality + keyframes) | `fx_bloom1` / `fx_bloom2` are fixed single-line expressions with no `params`. The Stream B `fx_dreambloom` is parametric, but it is one style, not the 2A control set. | Overlaps the CC-01/CC-02 effect work — do not duplicate; CC owns the bloom pipeline decision. |

## Verified present (excluded from the candidates)

- Stage 3 #1/#2 Smooth Push L/R — present as `fx_pushsmooth` (left) + push
  right/diagonal variants; Stage 3 #3/#4 Whip Pan — `fx_whipleft/right/up/down`;
  #5/#6 Seamless Zoom — `fx_seamlesszoom(in/out)`; #9 Luma Wipe —
  `fx_lumawipe`; #12 Warm Light Leak — `fx_prismleak` transition + `fx_leak*`
  pixel effects (adapted equivalents).
- Stage 2C Digital Decode — text anim `decode` exists (`Decode & Fade`).
- Doc B rank 17 portable versioned preset packs — present (P2-14,
  `.cutflowpack` import/export in `electron/main.cjs`).
- Stage 7 #3 demo and #7 docs — built in this stream (see the demo and
  the three composer docs).

## Recommendation to the coordinator

Treat the "3 further M items" as **open, not closed**: pick from the
candidate table above once CC scope is confirmed (items 2–3 are CC-05,
item 1 is possibly CC-09, item 6 is CC-01/CC-02), and do not count any
of them as built until that call is made.
