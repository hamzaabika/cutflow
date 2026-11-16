# Feasibility: VST3 plugin hosting

**Verdict: left open — scope, not a code gap. Do not build in this job.
There is no safe shippable core.**

## What VST3 hosting would need

1. **A native plugin host.** VST3 is a C++ SDK/API (Steinberg). Loading a
   `.vst3` bundle, instantiating its processor + controller, pumping audio
   through it and hosting its editor UI requires a native host module.
   Nothing in this tree is one: there are zero VST references in
   `src/` or `electron/` (verified by grep — the only "vst" hits are
   "invest"/"harvest"/"FavStar").
2. **A place to run it.** Cutflow's audio runs through ffmpeg filter
   graphs (`electron/audiofx.cjs` → `audioFxFilters`, rendered by
   `electron/audiofxrender.cjs` into cached WAV derivatives). ffmpeg has
   no VST3 support, so a VST3 stage cannot sit inside the existing chain:
   it would need its own audio path (host process or native addon) plus a
   way to splice its output back into the export graph sample-accurately.
3. **Editor UI embedding.** Plugin editors are native windows. Parenting
   one into an Electron window, on Linux + Windows + macOS, is a
   separate cross-platform problem from audio processing.
4. **State, presets and sandboxing.** Plugin state save/restore per
   project, preset browsing, and isolation (a crashing plugin must not
   take the editor down) all need design + implementation.
5. **Packaging and licensing.** A native host is a new build matrix
   (per-OS binaries in the installer), and VST3 itself is under
   Steinberg's license — the distribution terms need a decision before
   any code ships.

## What exists today instead

- The built-in audio chain (EQ, compressor, limiter, denoise, loudnorm,
  echo, pitch, pan/width) as ffmpeg filters, with preview/export parity
  by construction (the preview plays the same rendered derivative the
  export uses).
- No third-party plugin loading of any kind.

## Why there is no safe shippable core here

Every sub-problem above is a project on its own (native host module,
audio-path integration, editor embedding, state/sandboxing, packaging).
A "partial" VST3 — e.g. loading a plugin but never showing its editor,
or hosting without state save — would ship broken projects (settings
lost on reopen, no way to tune the plugin) and is worse than not
shipping it. The honest next step is a research spike: pick one host
approach (native JUCE-based addon vs. a separate host process), build a
hello-world plugin load + process + state round-trip on one OS, and
cost the other four items before committing.

## Scope note

This assessment was written, not built, per the gap-build instructions:
assess feasibility first; if neither VST3 nor Generative Extend has a
safe shippable core, report each left open with the exact reason.
