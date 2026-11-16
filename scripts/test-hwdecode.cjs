// FB-17 (P1-22) — adaptive hardware decode decision, pinned without Electron.
// Usage: node scripts/test-hwdecode.cjs
const { resolveDecodeMode, gpuRendererName, deniedBy, pickHwaccel } = require('../electron/hwdecode.cjs');

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const goodGpu = { gpuDevice: [{ active: true, deviceName: 'NVIDIA GeForce RTX 4060', vendorId: 0x10de, deviceId: 0x2803 }] };
const vaapi = ['vaapi', 'vdpau'];
const none = [];

// Auto: good GPU + accelerator -> hardware.
let r = resolveDecodeMode({ settings: { videoDecode: 'auto' }, gpuInfo: goodGpu, hwaccels: vaapi });
ok(r.mode === 'hardware' && r.hwaccel === 'vaapi', `auto + RTX + vaapi -> hardware (${r.mode}/${r.hwaccel})`);
// Auto: no accelerator -> CPU.
r = resolveDecodeMode({ settings: { videoDecode: 'auto' }, gpuInfo: goodGpu, hwaccels: none });
ok(r.mode === 'cpu' && /no usable hardware accelerator/.test(r.reason), 'auto + no hwaccel -> CPU');
// Auto: unknown GPU -> CPU (unknown is not a green light).
r = resolveDecodeMode({ settings: { videoDecode: 'auto' }, gpuInfo: {}, hwaccels: vaapi });
ok(r.mode === 'cpu' && /could not be identified/.test(r.reason), 'auto + unknown GPU -> CPU');
// Auto: software renderer -> CPU.
r = resolveDecodeMode({ settings: { videoDecode: 'auto' }, gpuInfo: { auxAttributes: { gl_renderer: 'llvmpipe (LLVM 15, 256 bits)' } }, hwaccels: vaapi });
ok(r.mode === 'cpu' && /Software renderer/.test(r.deniedBy || ''), 'auto + llvmpipe -> CPU via denylist');
// Denylist: Intel HD 530 stays CPU even when hardware is explicitly requested.
const hd530 = { gpuDevice: [{ active: true, deviceName: 'Intel(R) HD Graphics 530', vendorId: 0x8086, deviceId: 0x191b }] };
r = resolveDecodeMode({ settings: { videoDecode: 'hardware' }, gpuInfo: hd530, hwaccels: ['qsv'] });
ok(r.mode === 'cpu' && /Skylake/.test(r.deniedBy || ''), 'explicit hardware + HD 530 -> CPU (workaround kept)');
r = resolveDecodeMode({ settings: { videoDecode: 'auto' }, gpuInfo: hd530, hwaccels: ['qsv'] });
ok(r.mode === 'cpu', 'auto + HD 530 -> CPU');
r = resolveDecodeMode({ env: { FVE_GPU_VIDEO: '1' }, settings: {}, gpuInfo: hd530, hwaccels: ['qsv'] });
ok(r.mode === 'cpu', 'env FVE_GPU_VIDEO=1 + HD 530 -> CPU (env cannot re-arm a known crash)');
// Env override works on a good device.
r = resolveDecodeMode({ env: { FVE_GPU_VIDEO: '1' }, settings: {}, gpuInfo: goodGpu, hwaccels: vaapi });
ok(r.mode === 'hardware', 'env FVE_GPU_VIDEO=1 + good GPU -> hardware');
r = resolveDecodeMode({ env: { FVE_GPU_VIDEO: '0' }, settings: { videoDecode: 'hardware' }, gpuInfo: goodGpu, hwaccels: vaapi });
ok(r.mode === 'cpu', 'env FVE_GPU_VIDEO=0 beats Settings hardware -> CPU');
// Safe mode beats everything except the denylist logic (same outcome: CPU).
r = resolveDecodeMode({ settings: { videoDecode: 'hardware', safeMode: true }, gpuInfo: goodGpu, hwaccels: vaapi });
ok(r.mode === 'cpu' && /Safe mode/.test(r.reason), 'safe mode + hardware setting -> CPU');
r = resolveDecodeMode({ env: { FVE_GPU_VIDEO: '1' }, settings: { safeMode: true }, gpuInfo: goodGpu, hwaccels: vaapi });
ok(r.mode === 'cpu' && /Safe mode/.test(r.reason), 'safe mode beats env override -> CPU');
// Explicit CPU setting.
r = resolveDecodeMode({ settings: { videoDecode: 'cpu' }, gpuInfo: goodGpu, hwaccels: vaapi });
ok(r.mode === 'cpu', 'explicit CPU setting -> CPU');
// Explicit hardware with no accelerator -> CPU.
r = resolveDecodeMode({ settings: { videoDecode: 'hardware' }, gpuInfo: goodGpu, hwaccels: none });
ok(r.mode === 'cpu', 'explicit hardware + no hwaccel -> CPU');
// Helpers.
ok(gpuRendererName(goodGpu) === 'NVIDIA GeForce RTX 4060', 'gpuRendererName reads the active device');
ok(gpuRendererName({ auxAttributes: { gl_renderer: 'ANGLE (Intel)' } }) === 'ANGLE (Intel)', 'gpuRendererName falls back to gl_renderer');
ok(gpuRendererName(null) === '', 'gpuRendererName of null is empty');
ok(deniedBy('Intel(R) HD Graphics 520') !== null, 'HD 520 denylisted');
ok(deniedBy('AMD Radeon RX 7800 XT') === null, 'AMD RX 7800 XT not denylisted');
ok(pickHwaccel(['qsv', 'vaapi']) === 'vaapi', 'pickHwaccel prefers vaapi over qsv (list order)');
ok(pickHwaccel(['none']) === null, 'pickHwaccel of unknown list is null');

console.log(failures ? `HWDECODE FAIL (${failures})` : 'HWDECODE OK');
process.exit(failures ? 1 : 0);
