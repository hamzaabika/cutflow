# Feasibility: Generative Extend / object removal

**Verdict: left open — scope, not a code gap. Do not build in this job.
There is no safe shippable core for the *generative* part.**

## What "Generative Extend / object removal" would need

1. **Generative Extend** (grow a clip beyond its real frames): a video
   generative model that synthesises temporally consistent new frames
   continuing the motion. That is a diffusion / video-generation model
   (multi-GB weights, GPU inference, seconds-to-minutes per frame on
   consumer hardware), plus licensing + download + update plumbing for
   the weights.
2. **Generative object removal** (erase something and fill the hole):
   video inpainting with temporal consistency — the fill must track the
   camera and the scene across frames, or the result shimmers. Same
   class of model, same hardware and distribution problem.
3. **On-device inference plumbing** for video models. The tree has
   on-device inference for exactly one thing (see below); nothing for
   video diffusion or inpainting, and no GPU compute path the export
   engine could reuse.

## What exists today instead

- **Background removal (matting)**, not generation: `electron/matting.cjs`
  runs Robust Video Matting (RVM MobileNetV3, 15 MB ONNX, GPL-3.0,
  downloaded once) on-device at ~75 ms/frame on a laptop CPU. It
  *segments* a subject from its background; it does not invent pixels
  to fill a hole or extend a shot.
- **Chroma key** in the inspector (same idea, colour-based).
- **No inpainting, no frame synthesis, no video diffusion** anywhere in
  the tree (verified by grep: no inpainting / diffusion / generative
  model references outside this doc).
- **Environment note:** this dev VM's `node_modules` was restored with
  `npm ci --ignore-scripts`, so the onnxruntime native binary is still
  missing — even the existing matting path cannot run here until a full
  `npm ci` succeeds. Any new model work would inherit that fragility.

## Why there is no safe shippable core here

- The *generative* qualifier is the whole feature: a non-generative
  approximation (e.g. ffmpeg `delogo` blurring a rectangle, or freezing
  a clean frame over the object) is not object removal and would be a
  fake partial — it does not do what the name promises.
- The real thing needs a model evaluation first: which open video
  inpainting/extension model, what quality at what resolution, what
  hardware it needs, what its licence allows, and how multi-GB weights
  ship inside a desktop app. That is a research spike, not a gap fix.
- A model that only works on a GPU workstation, or that takes minutes
  per second of video on the reference laptop (ThinkPad T470, Intel HD
  620), is not shippable to this user base even if it demos well.

## Honest next step

A spike, in this order: (1) shortlist 2–3 open video-inpainting /
frame-extension models with licences; (2) run one on a short clip on
reference-class hardware and measure time + quality; (3) only then
decide whether a "remove object" or "extend shot" feature is buildable
at all, and at what resolution / length limits.

## Scope note

This assessment was written, not built, per the gap-build instructions:
assess feasibility first; if neither VST3 nor Generative Extend has a
safe shippable core, report each left open with the exact reason.
