# Bundled AI-upscale engine: Real-ESRGAN (ncnn / Vulkan)

Cutflow's **AI Enhance** feature runs entirely on this machine. It invokes the
portable `realesrgan-ncnn-vulkan` binary below as an external tool — exactly
the way the bundled FFmpeg is invoked — extracting a clip's frames, upscaling
them folder-to-folder, and re-encoding. No network, no account, no fee.

## What is bundled

| File | sha256 |
| --- | --- |
| `realesrgan-ncnn-vulkan` (Linux x86-64) | `22c2296a39b40cc43ac92615c827ab6d4b60b7142e8cee59f718e3f8e2cdbda9` |
| `models/realesrgan-x4plus.bin` | `713ee713b0353afaa27976f0563a64a5043bd70b9bd8936c2e26e25ebcdbcddf` |
| `models/realesrgan-x4plus.param` | `35330ececcea33b6c397a72548e788d5d53becee4734c50b7fada36e89f10a86` |
| `models/realesr-animevideov3-x2.bin` / `-x3.bin` / `-x4.bin` | `548a36f9c3f4ab8da56cd3b13badf23968bee207b396dad14d04b830e5f2ab2d` (one weights file, three scale params) |
| `models/realesr-animevideov3-x2.param` | `b88ff4f00ebf019a7fdac17fdd45a7fd3665d37509efc5baf2e4da2e24420a04` |
| `models/realesr-animevideov3-x3.param` | `d1a5755008791d09b57e3425fc9dd0bd26b00fdf79c606210bc0e693f8230881` |
| `models/realesr-animevideov3-x4.param` | `850a248e7c14c27e5bd8cf7265113a9441036a7db63963bb8aa5169d788a435e` |
| `models/realesr-general-x4v3.bin` | `6e92abc6d75cd0e7f7a0a91e7514bc7694f3cbbfe31a5b2a1bbb04b3ee0bdee2` |
| `models/realesr-general-x4v3.param` | `8a0c4b4fd1c57c945ef24477edbdbeba8a509ca9c9adf8f63f51c265ea1bcc89` |

## Provenance

- Engine + the x4plus / animevideov3 models: the official portable package
  `realesrgan-ncnn-vulkan-20220424-ubuntu.zip` (sha256 of the zip:
  `e5aa6eb131234b87c0c51f82b89390f5e3e642b7b70f2b9bbe95b6a285a40c96`) from the
  Real-ESRGAN **v0.2.5.0** release
  (github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.5.0). The engine binary is
  the project's v0.2.0 build (2022-04-24). Windows / macOS packages of the same
  build are `realesrgan-ncnn-vulkan-20220424-windows.zip` (binary:
  `realesrgan-ncnn-vulkan.exe`) and `realesrgan-ncnn-vulkan-20220424-macos.zip`
  in the same release — drop the platform binary in here under the same layout
  when packaging for those platforms.
- `realesr-general-x4v3`: the official ncnn package above predates this model,
  so its `.param`/`.bin` were converted locally from the official
  `realesr-general-x4v3.pth` in the same v0.2.5.0 release (sha256:
  `8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292`) with
  Tencent's pnnx converter, following the model's own SRVGGNetCompact
  definition (including its nearest-neighbour residual add; the param's
  in/out blobs are named `data`/`output`, as the engine expects). Verified
  against the PyTorch reference output at 36.2 dB PSNR (fp16 rounding) on
  2026-11-11.

## Licensing

- Real-ESRGAN: BSD-3-Clause (Tencent ARC Lab) — see
  `LICENSE-Real-ESRGAN-BSD3.txt`.
- The ncnn Vulkan port: MIT — see `LICENSE`. ncnn itself is BSD-3-Clause
  (Tencent).

No code from Upscayl or Video2X (AGPL) is used anywhere in this feature —
only the Real-ESRGAN engine binary and model weights, invoked as a tool.
