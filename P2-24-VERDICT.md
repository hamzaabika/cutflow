# P2-24 Stem separation / music remix / podcast multitrack — feasibility verdict

**Verdict: FEASIBLE ON-DEVICE via demucs-onnx (HT-Demucs, ONNX). No cloud
dependency needed. Ship the vocals specialist first, lazy-download the model
on first use, keep the 4-stem bag as an option. A real-machine smoke test is
still required before any build — it could not complete on this VM (see below).**

## Evidence (2026-11-15)

### On-device path — verified pieces
- `demucs-onnx` 0.3.1 installs cleanly from PyPI into a plain venv: pure
  numpy + onnxruntime, no PyTorch at inference (~50 MB deps vs ~2 GB).
- Models download from Hugging Face (`StemSplitio` org) and are cached on
  disk here: `htdemucs_ft_vocals` fp32 (~316 MB) and fp16weights (~158 MB).
  The 4-stem specialist bag is 1.26 GB total.
- Cutflow already ships `onnxruntime-node` (used for matting/reframe), so the
  runtime is already in the dependency tree — no new native dependency class.
- Published numbers (StemSplit docs / blog, 2026): vocal SDR 9.19 dB (claimed
  #1 open-source vocal SDR on MUSDB18-HQ); full 4-stem bag ~0.49x real-time
  on Apple M4 Pro; single-stem mode ~4x faster, 75% less RAM than the bag;
  ONNX output numerically equivalent to PyTorch (max abs diff 0.000163).
- Hamza's laptop (ThinkPad T470, i5-7300U, 16 GB RAM, Ubuntu) has far more
  headroom than this VM cell; a single-stem separation needs the ~316 MB
  model + runtime buffers, the bag ~1.26 GB + buffers.

### Local smoke test — BLOCKED BY ENVIRONMENT, not by the approach
`scripts/test-p2e-demucs-smoke.mjs` (synthetic mix with known stems:
vibrato sweep = vocals, 80 Hz sine = bass, noise clicks = drums; measures
bass suppression, voice-band retention, wall-clock speed) and
`scripts/test-p2e-demucs-direct.mjs` (offline, cache-only, 5 s clip, 1 ORT
thread) were run 5 times. Every run was SIGKILLed by the OOM killer
(30–120 s in), including a bare `InferenceSession` load with no inference
and no network. System `free` showed ~6 GB available at each start — the
kills come from the shared 6 GB runtime-cell limit being saturated by
concurrent P2 streams, not from this workload's own footprint. The scripts
are committed for re-running on a quiet machine or Hamza's laptop.

### Cloud fallback — priced, not recommended
- **LALAL.AI** (Orion, proprietary): Lite $7.50/mo annual / $9.99 monthly,
  Pro $15/mo annual / $19.99 monthly; **API access only on Pro**. Minutes
  are charged as file length x number of stem types (a 4-min song split
  into 4 stems costs 16 min); top-ups ~$0.07/min ($50/750 min). Unlimited
  Relaxed Queue minutes on paid plans. Uploads leave the PC (privacy cost);
  no permanent pay-per-use tier.
- **Replicate `cjwbw/demucs`** (hosted Demucs): ~$0.020/run, usually < 90 s,
  but the build is pinned ~3 years back (not v4.1.0).
- Cloud is strictly worse here: recurring cost + upload privacy + API tier
  gating, for quality below the on-device FT models. Keep as a documented
  fallback only if on-device ever proves unusable on the target hardware.

### Scope notes
- Stem separation (vocals/drums/bass/other) covers music remix (stem gains)
  and podcast cleanup (isolate voice, duck music). It does NOT separate
  multiple speakers — podcast multitrack per-speaker still needs
  diarization, a separate feasibility item.
- Demucs code is MIT-licensed. The **HT-Demucs model weights licence must
  be confirmed before shipping** (Meta's weights; the demucs-onnx docs point
  at the upstream licence — verify it names redistribution as allowed).

## Recommendation
Build on-device: vocals specialist (fp16weights) lazy-downloaded from HF on
first use with a progress UI + cancel, then the 4-stem bag as a second
option. Gate on a smoke test on real hardware measuring SDR on a real song,
wall-clock speed, and peak RAM. No cloud dependency, no upload, no
per-minute cost. Do not build until the smoke test passes.
