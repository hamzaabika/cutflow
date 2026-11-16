// FB-17 (P1-22) — Adaptive hardware video decode with a safe fallback.
//
// Before this, decode was disabled by default unless FVE_GPU_VIDEO=1, with
// no hardware matrix, no per-device fallback/denylist and no safe-mode
// setting (electron/main.cjs:7-8). This module is the decision, kept pure so
// the suite can pin it without Electron:
//
//   resolveDecodeMode({ env, settings, gpuInfo, hwaccels }) ->
//     { mode: 'cpu' | 'hardware', reason, deniedBy, hwaccel }
//
// Precedence (first match wins):
//   1. settings.safeMode === true -> CPU. Safe mode is the explicit escape
//      hatch: no hardware decode, no hardware encode probing, no surprises —
//      it beats even the env override, because a user who turned it on must
//      be able to trust it.
//   2. FVE_GPU_VIDEO=1 (legacy env override) -> hardware, unless the device
//      is denylisted — a denylisted device crashes, and an env var must not
//      be able to re-arm a known crash.
//   3. FVE_GPU_VIDEO=0 -> CPU.
//   4. settings.videoDecode === 'cpu' -> CPU.
//   5. settings.videoDecode === 'hardware' -> hardware unless denylisted
//      (denylist still wins, with the reason reported) or no hwaccel at all.
//   6. 'auto' (default) -> hardware ONLY when the FFmpeg build reports a
//      usable hwaccel AND the GPU renderer is known and not denylisted.
//      Unknown GPU, software renderer (llvmpipe / SwiftShader / lavapipe),
//      or no hwaccel -> CPU. Auto never guesses.
//
// Denylist (per-device, with reasons — NOT a global removal of the Intel
// HD 530 workaround: that device stays CPU-decoded until it is verified
// fixed, which nothing on this VM can do):
//   - Intel HD Graphics 510/520/530 (Skylake) — the 2022-driver GPU-process
//     crash the original workaround was written for (main.cjs comment).
//   - Any software renderer string — hardware decode is meaningless there.
//   - Devices whose renderer string is empty/unknown under 'auto' —
//     unknown is not a green light.
//
// The multi-tier A/B the spec asks for (old/new Intel, Apple Silicon,
// AMD/NVIDIA, dropped-frame + seek measurements per tier) is UNRUNNABLE
// here: this VM has one Mesa lavapipe software path and no such hardware.
// What IS measured here is that path (scripts/measure-hwdecode.cjs); the
// rest is reported as unrunnable with the reason, not faked.
const { spawnSync } = require('node:child_process');

const DENYLIST = [
  { pattern: /intel\s*\(r\)?\s*hd\s*graphics\s*5[123]0/i, reason: 'Intel HD Graphics 510/520/530 (Skylake): known GPU-process crashes with hardware decode on the 2022 driver — CPU decode kept (original workaround, unverified fixed).' },
  { pattern: /hd\s*graphics\s*530/i, reason: 'Intel HD Graphics 530: known GPU-process crashes with hardware decode — CPU decode kept.' },
  { pattern: /llvmpipe|lavapipe|swiftshader|software\s*rendering|softpipe/i, reason: 'Software renderer: there is no GPU to decode on; hardware decode would only fail back to CPU.' },
];

const HWACCELS = ['vaapi', 'vdpau', 'cuda', 'qsv', 'd3d11va', 'dxva2', 'videotoolbox', 'drm', 'vulkan'];

// The renderer string out of Electron's getGPUInfo('complete'): the active
// device name, else the GL renderer, else the vendor:device fallback the
// crash log already uses. '' when nothing is known.
function gpuRendererName(info) {
  if (!info || typeof info !== 'object') return '';
  const g = (info.gpuDevice || []).find((x) => x && x.active) || (info.gpuDevice || [])[0];
  if (g && typeof g.deviceName === 'string' && g.deviceName.trim()) return g.deviceName.trim();
  if (typeof info.auxAttributes?.gl_renderer === 'string' && info.auxAttributes.gl_renderer.trim()) return info.auxAttributes.gl_renderer.trim();
  if (g && (g.vendorId || g.deviceId)) return `${Number(g.vendorId || 0).toString(16)}:${Number(g.deviceId || 0).toString(16)}`;
  return '';
}

function deniedBy(renderer) {
  if (!renderer) return null;
  for (const entry of DENYLIST) if (entry.pattern.test(renderer)) return entry;
  return null;
}

function pickHwaccel(hwaccels) {
  const list = (hwaccels || []).map((h) => String(h).toLowerCase());
  return HWACCELS.find((h) => list.includes(h)) || null;
}

function resolveDecodeMode({ env = {}, settings = {}, gpuInfo = null, hwaccels = [] } = {}) {
  const renderer = gpuRendererName(gpuInfo);
  const denied = deniedBy(renderer);
  const hwaccel = pickHwaccel(hwaccels);
  const cpu = (reason, extra = {}) => ({ mode: 'cpu', reason, deniedBy: denied ? denied.reason : null, hwaccel: null, renderer, ...extra });
  const hw = (reason) => ({ mode: 'hardware', reason, deniedBy: null, hwaccel, renderer });

  if (settings.safeMode === true) return cpu('Safe mode is on: hardware decode is disabled.');
  if (env.FVE_GPU_VIDEO === '1') {
    if (denied) return cpu(`FVE_GPU_VIDEO=1 requests hardware decode, but this device is denylisted (${denied.reason}) — CPU decode kept.`);
    if (!hwaccel) return cpu('FVE_GPU_VIDEO=1 requests hardware decode, but this FFmpeg build reports no usable hardware accelerator — CPU decode kept.');
    return hw('FVE_GPU_VIDEO=1 (explicit env override).');
  }
  if (env.FVE_GPU_VIDEO === '0') return cpu('FVE_GPU_VIDEO=0 (explicit env override).');
  const choice = settings.videoDecode === 'cpu' || settings.videoDecode === 'hardware' ? settings.videoDecode : 'auto';
  if (choice === 'cpu') return cpu('Video decoding is set to CPU in Settings.');
  if (choice === 'hardware') {
    if (denied) return cpu(`Hardware decode is requested in Settings, but this device is denylisted (${denied.reason}) — CPU decode kept.`);
    if (!hwaccel) return cpu('Hardware decode is requested in Settings, but this FFmpeg build reports no usable hardware accelerator — CPU decode kept.');
    return hw('Hardware decode requested in Settings; device is not denylisted and an accelerator is available.');
  }
  // auto
  if (denied) return cpu(`Auto: this device is denylisted (${denied.reason}) — CPU decode kept.`);
  if (!renderer) return cpu('Auto: the GPU could not be identified — CPU decode kept (unknown is not a green light).');
  if (!hwaccel) return cpu('Auto: no usable hardware accelerator in this FFmpeg build — CPU decode kept.');
  return hw(`Auto: ${renderer} is not denylisted and ${hwaccel} is available.`);
}

// FFmpeg's own accelerator list, via `ffmpeg -hwaccels`. [] on any failure —
// a probe that fails is "no hardware", never a crash.
function probeHwaccels(ffmpegPath) {
  try {
    const r = spawnSync(ffmpegPath, ['-hide_banner', '-hwaccels'], { encoding: 'utf8', timeout: 10000 });
    if (r.status !== 0) return [];
    return String(r.stdout || '').split('\n').map((l) => l.trim()).filter((l) => /^[a-z0-9]+$/.test(l));
  } catch { return []; }
}

module.exports = { DENYLIST, HWACCELS, gpuRendererName, deniedBy, pickHwaccel, resolveDecodeMode, probeHwaccels };
