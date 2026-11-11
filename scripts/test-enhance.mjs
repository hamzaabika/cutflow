// AI video enhance (Real-ESRGAN ncnn, local): electron/esrgan.cjs end to end.
// 1) Model/scale mapping: the two native-4x networks upscale at 4 and
//    downscale in the encode for a 2x ask; animevideov3 has a true per-scale
//    network, so both scales are native there.
// 2) Command construction: engine args (model, scale, tile, models dir),
//    frame extraction, and the re-encode — the source's EXACT rational fps
//    on both the image2 input and the output, the source audio mapped in,
//    the downscale filter only when the plan calls for it.
// 3) Output naming: "<name> (Enhanced 2x)".
// 4) exactFps reads 30000/1001 back as "30000/1001", never 30.
// 5) A REAL end-to-end run on a synthesized 1 s clip (Mesa lavapipe
//    software Vulkan — the real engine binary really runs): output is
//    exactly 2x, fps identical, audio present, progress ordered and
//    monotonic, temp dir cleaned.
// 6) Cancel mid-upscale: the run rejects as canceled, no output file, temp
//    dir cleaned. Engine failure (bogus Vulkan ICD): a surfaced error, not
//    a hang, temp dir cleaned.
// 7) Wiring: IPC + preload + tray job kind + menu/dialog + packaging lists.
// Usage: node scripts/test-enhance.mjs
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const esrgan = require('../electron/esrgan.cjs');
const { ffmpegPath, ffprobePath } = require('../electron/ffmpeg.cjs');

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures += 1; };
const section = (s) => console.log(`\n== ${s}`);

// Software Vulkan for the real runs (the dev VM has no GPU): point the ICD
// loader at Mesa lavapipe unless the environment already chose one.
const LVP = '/usr/share/vulkan/icd.d/lvp_icd.json';
if (!process.env.VK_ICD_FILENAMES && fs.existsSync(LVP)) process.env.VK_ICD_FILENAMES = LVP;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-enhance-suite-'));
const gen = (file, args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'pipe' });
const probeJson = (file) => JSON.parse(spawnSync(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }).stdout);
const leftovers = () => fs.readdirSync(TMP).filter((f) => f.startsWith('cutflow-enhance-'));

try {
  section('model / scale mapping');
  const cases = [
    ['realistic', 2, { modelName: 'realesrgan-x4plus', engineScale: 4, downscale: true }],
    ['realistic', 4, { modelName: 'realesrgan-x4plus', engineScale: 4, downscale: false }],
    ['animation', 2, { modelName: 'realesr-animevideov3', engineScale: 2, downscale: false }],
    ['animation', 4, { modelName: 'realesr-animevideov3', engineScale: 4, downscale: false }],
    ['fast', 2, { modelName: 'realesr-general-x4v3', engineScale: 4, downscale: true }],
    ['fast', 4, { modelName: 'realesr-general-x4v3', engineScale: 4, downscale: false }],
  ];
  for (const [m, s, want] of cases) {
    const p = esrgan.planFor(m, s);
    ok(p.modelName === want.modelName && p.engineScale === want.engineScale && p.downscale === want.downscale,
      `planFor(${m}, ${s}) = ${p.modelName} @${p.engineScale}${p.downscale ? ' + downscale' : ''}`);
  }
  ok((() => { try { esrgan.planFor('nope', 2); return false; } catch { return true; } })(), 'planFor rejects an unknown model');
  ok((() => { try { esrgan.planFor('fast', 3); return false; } catch { return true; } })(), 'planFor rejects scale 3');

  section('command construction');
  const plan = esrgan.planFor('realistic', 2);
  const ea = esrgan.engineArgs({ framesDir: '/w/frames', upDir: '/w/up', plan, modelsDir: '/app/models' });
  ok(ea.join(' ').includes('-n realesrgan-x4plus') && ea.join(' ').includes('-s 4'), 'engine args carry model + native scale');
  ok(ea[ea.indexOf('-t') + 1] === String(esrgan.TILE_SIZE) && esrgan.TILE_SIZE >= 32, `engine args carry the safe tile size (${esrgan.TILE_SIZE})`);
  ok(ea[ea.indexOf('-m') + 1] === '/app/models' && ea[ea.indexOf('-i') + 1] === '/w/frames' && ea[ea.indexOf('-o') + 1] === '/w/up', 'engine args are folder-to-folder with the bundled models dir');
  const xa = esrgan.extractArgs('/media/in.mp4', '/w/frames');
  ok(xa.includes('0:v:0') && xa[xa.length - 1].endsWith('%08d.png'), 'extract args pull the video track to a PNG sequence');
  const enc = esrgan.encodeArgs({ upDir: '/w/up', src: '/media/in.mp4', outFile: '/media/out.mp4', fpsStr: '30000/1001', plan, srcW: 640, srcH: 360, scale: 2, audioCodec: 'copy' });
  ok(enc[enc.indexOf('-framerate') + 1] === '30000/1001', 'encode input framerate is the exact rational, unrounded');
  ok(enc[enc.indexOf('-r') + 1] === '30000/1001', 'encode output rate is the exact rational, unrounded');
  ok(enc.join(' ').includes('1:a?'), 'encode maps the source audio in');
  ok(enc[enc.indexOf('-vf') + 1] === 'scale=1280:720:flags=lanczos', 'a 2x ask on a native-4x model downscales to exactly 2x in the encode');
  const encNative = esrgan.encodeArgs({ upDir: '/w/up', src: '/media/in.mp4', outFile: '/media/out.mp4', fpsStr: '24/1', plan: esrgan.planFor('animation', 2), srcW: 640, srcH: 360, scale: 2, audioCodec: 'aac' });
  ok(!encNative.includes('-vf'), 'a native-scale plan adds no downscale filter');
  ok(encNative[encNative.indexOf('-c:a') + 1] === 'aac' && encNative.includes('192k'), 'the AAC fallback shape is available');

  section('output naming');
  ok(esrgan.outputNameFor('clip.mp4', 2) === 'clip (Enhanced 2x)', 'name: clip.mp4 -> "clip (Enhanced 2x)"');
  ok(esrgan.outputNameFor('/some/dir/My Movie.mkv', 4) === 'My Movie (Enhanced 4x)', 'name: paths and other extensions handled');

  section('exact fps');
  const ntsc = path.join(TMP, 'ntsc.mp4');
  gen(ntsc, ['-f', 'lavfi', '-i', 'testsrc=duration=0.5:size=160x120:rate=30000/1001', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ntsc]);
  const fps1 = await esrgan.exactFps(ntsc);
  ok(fps1.str === '30000/1001', `exactFps reads 30000/1001 verbatim (got ${fps1.str})`);
  const pal = path.join(TMP, 'pal.mp4');
  gen(pal, ['-f', 'lavfi', '-i', 'testsrc=duration=0.5:size=160x120:rate=25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', pal]);
  const fps2 = await esrgan.exactFps(pal);
  ok(fps2.str === '25/1', `exactFps reads 25 as 25/1 (got ${fps2.str})`);

  section('real end-to-end (lavapipe, animation 2x)');
  const src = path.join(TMP, 'clip.mp4');
  gen(src, ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=30000/1001',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src]);
  const outFile = path.join(TMP, 'clip (Enhanced 2x).mp4');
  const events = [];
  const t0 = Date.now();
  const res = await esrgan.runEnhance({
    src, model: 'animation', scale: 2, outFile, tmpRoot: TMP,
    onProgress: (p) => events.push(p), isCanceled: () => false,
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  ok(res.ok === true && fs.existsSync(outFile), `run completed in ${secs}s (lavapipe software Vulkan — says nothing about a real GPU)`);
  const pj = probeJson(outFile);
  const v = pj.streams.find((s) => s.codec_type === 'video');
  const a = pj.streams.find((s) => s.codec_type === 'audio');
  ok(v.width === 320 && v.height === 240, `output is exactly 2x: ${v.width}x${v.height}`);
  ok(v.avg_frame_rate === '30000/1001', `output fps identical to source: ${v.avg_frame_rate}`);
  ok(!!a, 'output carries the audio stream');
  const phases = events.map((e) => e.phase);
  ok(phases.includes('frames') && phases.includes('upscale') && phases.includes('encode'), 'progress reported all three phases');
  ok(events.every((e, i) => i === 0 || e.fraction >= events[i - 1].fraction), 'progress fractions are monotonic');
  ok(events.length && events[events.length - 1].fraction === 1, 'progress ends at 1');
  ok(leftovers().length === 0, 'temp dir cleaned after success');
  ok(res.media.width === 320 && res.media.height === 240 && res.media.hasAudio === true, 'returned media describes the enhanced file');

  section('cancel cleanup');
  const big = path.join(TMP, 'big.mp4');
  gen(big, ['-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', big]);
  const bigOut = path.join(TMP, 'big (Enhanced 2x).mp4');
  let cancel = false;
  let cancelErr = null;
  try {
    await esrgan.runEnhance({
      src: big, model: 'fast', scale: 2, outFile: bigOut, tmpRoot: TMP,
      onProgress: (p) => { if (p.phase === 'upscale') cancel = true; },
      isCanceled: () => cancel,
    });
  } catch (e) { cancelErr = e; }
  ok(!!cancelErr && cancelErr.canceled === true, 'cancel during the upscale rejects as canceled');
  ok(!fs.existsSync(bigOut), 'cancel leaves no output file');
  ok(leftovers().length === 0, 'temp dir cleaned after cancel');

  section('engine failure surfaces');
  const savedIcd = process.env.VK_ICD_FILENAMES;
  process.env.VK_ICD_FILENAMES = '/nonexistent/icd.json';
  let failErr = null;
  try {
    await esrgan.runEnhance({ src, model: 'fast', scale: 2, outFile: path.join(TMP, 'never.mp4'), tmpRoot: TMP, isCanceled: () => false });
  } catch (e) { failErr = e; }
  process.env.VK_ICD_FILENAMES = savedIcd;
  ok(!!failErr && /engine failed/i.test(failErr.message), `no Vulkan device -> clear error, not a hang ("${failErr && failErr.message.slice(0, 80)}")`);
  ok(leftovers().length === 0, 'temp dir cleaned after failure');

  section('wiring');
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const main = read('electron/main.cjs'); const preload = read('electron/preload.cjs');
  const app = read('src/App.jsx'); const pkg = JSON.parse(read('package.json'));
  ok(main.includes("'esrgan:start'") && main.includes("'esrgan:cancel'"), 'main: esrgan:start + esrgan:cancel IPC');
  ok(preload.includes('esrganStart') && preload.includes('onEsrganProgress'), 'preload: esrganStart + onEsrganProgress');
  ok(app.includes("t('menu.aiEnhance')") && app.includes('runEnhanceJob') && app.includes("kind: 'enhance'"), 'app: clip-menu action + enhance job kind in the tray queue');
  ok(fs.existsSync(path.join(ROOT, 'src/components/EnhanceDialog.jsx')), 'app: EnhanceDialog component');
  ok(pkg.build.files.some((f) => f.includes('vendor/realesrgan')) && pkg.build.asarUnpack.some((f) => f.includes('vendor/realesrgan')), 'packaging: vendor/realesrgan in files + asarUnpack (ships, unpacked, like ffmpeg)');
  const relCfg = JSON.parse(JSON.stringify(pkg.build)); delete relCfg.extraResources;
  ok(relCfg.files.some((f) => f.includes('vendor/realesrgan')), 'packaging: the release config keeps the engine (it is app function, not the content pack)');
  const { bin, models } = esrgan.enginePaths();
  ok(fs.existsSync(bin) && (fs.statSync(bin).mode & 0o111) !== 0, 'vendor: engine binary present and executable');
  for (const f of ['realesrgan-x4plus.param', 'realesrgan-x4plus.bin', 'realesr-animevideov3-x2.param', 'realesr-animevideov3-x2.bin',
    'realesr-animevideov3-x4.param', 'realesr-animevideov3-x4.bin', 'realesr-general-x4v3.param', 'realesr-general-x4v3.bin']) {
    ok(fs.existsSync(path.join(models, f)), `vendor: model file ${f}`);
  }
} catch (e) {
  failures += 1;
  console.log(`FAIL  suite error: ${e.message}`);
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* suite temp */ }
}
console.log(failures ? `\ntest-enhance: FAIL (${failures})` : '\ntest-enhance: ALL PASS');
process.exit(failures ? 1 : 0);
