# Hardware video-decode matrix (P1-22 / A-F4)

Cutflow used to disable Chromium hardware video decode on every machine
(`disable-accelerated-video-decode` unless `FVE_GPU_VIDEO=1`), because an
Intel HD 530 with a 2022 driver crashed the GPU process while playing.
`electron/hwdecode.cjs` now decides at startup (`resolveDecodeMode`, pure
and unit-testable): the decision runs from, in order, the safe-mode +
videoDecode settings, the `FVE_GPU_VIDEO` env override, the GPU
fingerprint cached from the last launch, and this FFmpeg build's
accelerator list (`ffmpeg -hwaccels`). First launch has no fingerprint:
'auto' resolves to CPU, the safe default, exactly like the old
unconditional disable.

Decision rule (in order, first match wins):

1. Safe mode on → CPU decode (beats even the env override).
2. `FVE_GPU_VIDEO=1` → hardware decode, unless the device is denylisted
   (a denylisted device crashes; an env var must not re-arm a known crash)
   or the FFmpeg build reports no usable accelerator → CPU decode.
3. `FVE_GPU_VIDEO=0` → CPU decode.
4. Settings `videoDecode: 'cpu'` → CPU decode.
5. Settings `videoDecode: 'hardware'` → hardware decode unless denylisted
   or no accelerator → CPU decode.
6. `'auto'` (default) → hardware decode ONLY when the FFmpeg build reports
   a usable accelerator AND the GPU renderer is known and not denylisted.
   Unknown GPU, software renderer (llvmpipe / SwiftShader / lavapipe),
   or no accelerator → CPU decode. Auto never guesses.

## Denylist

The denylist in `hwdecode.cjs` matches the renderer string, not PCI ids:

| Pattern | Chip | Why |
| --- | --- | --- |
| `Intel(R) HD Graphics 5[123]0` | Intel HD Graphics 510/520/530 (Skylake) | GPU-process crashes while playing (2022 driver) |
| `HD Graphics 530` | Intel HD Graphics 530 | Same, as a backstop for missed ids |
| `llvmpipe / lavapipe / SwiftShader / software rendering / softpipe` | Any software renderer | There is no GPU to decode on |

Add a chip here only with an observed crash, never on suspicion — and
remove it only after a driver update is verified to fix the crash on
that exact chip.

## Observed machines

| Machine / GPU | Decision | Evidence |
| --- | --- | --- |
| Intel HD Graphics 530, 2022 driver (Hamza-era report) | CPU decode (`denylist`) | Repeated GPU-process crashes, black player |
| Dev VM, no GPU (llvmpipe software renderer) | CPU decode (`software-renderer`) | `getGPUInfo` reports vendor/device 0 |
| NVIDIA / AMD / Intel Iris Xe and newer | Hardware decode | **Not yet observed on real hardware — verify on a machine with the chip before treating the row as passed** |

The multi-tier A/B the spec asks for (old/new Intel, Apple Silicon,
AMD/NVIDIA, dropped-frame + seek measurements per tier) is UNRUNNABLE
on this VM: it has one Mesa lavapipe software path and no such hardware.
What IS measured is that path (`scripts/measure-hwdecode.cjs`); the rest
is reported as unrunnable with the reason, not faked.

The renderer can read the live decision with `window.api.decodeDecision()`
(`app:decodeDecision` in the main process). Unit proof lives in
`scripts/test-gap-a.mjs` (pure `resolveDecodeMode` cases: denylist,
software renderer, missing info, both env forces, auto without an
accelerator).
