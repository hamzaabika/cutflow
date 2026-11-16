// AI video enhance — a local, free upscale of a whole media file with
// Real-ESRGAN's portable ncnn/Vulkan engine (vendor/realesrgan, BSD-3-Clause
// weights + MIT port; see vendor/realesrgan/README.md for provenance and
// hashes). The engine is invoked as an external tool exactly the way the
// bundled FFmpeg is: frames out, frames upscaled folder-to-folder, frames
// re-encoded. No network, no account.
//
// Pipeline (mirrors the export jobs' shape: probe → work → encode, progress
// throughout, one cancel that kills the running child):
//   1. Probe the source (dimensions / duration / audio from ffmpeg.cjs's
//      probe; the frame rate is read AGAIN as an exact rational — probe()
//      rounds 29.97 to 30, and re-encoding on a rounded rate re-grids every
//      frame, the old 25 fps lesson).
//   2. Extract the video track to a PNG sequence in a temp dir.
//   3. Run the engine folder-to-folder; progress is the count of finished
//      frames over the total, polled from the output dir.
//   4. Re-encode at the source's exact fps with the source's own audio
//      mapped in (copied; AAC fallback when the codec cannot live in MP4).
// The caller owns the output path; the temp dir is removed on success,
// failure AND cancel.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ffmpegPath, ffprobePath, probe } = require('./ffmpeg.cjs');

// Tile size for the engine: large enough to be efficient, small enough for
// low-memory integrated GPUs (the engine's 0 = auto can take whole-frame
// tiles and run out of memory on an iGPU at 4x).
const TILE_SIZE = 256;

// The engine's path RELATIVE to vendor/realesrgan, per platform — a pure
// helper so the platform selection is testable without a Windows/Mac host.
// Each OS package of the same engine build (v0.2.5.0) ships its own binary
// name/layout (see the vendor README for hashes):
//   linux  → realesrgan-ncnn-vulkan            (ELF, the original layout)
//   win32  → realesrgan-ncnn-vulkan.exe        (+ vcomp140.dll /
//            vcomp140d.dll beside it — the exe loads them from its own dir)
//   darwin → macos/realesrgan-ncnn-vulkan      (Mach-O universal; kept in a
//            subfolder so it never collides with the Linux ELF's name)
// The .param/.bin models are platform-independent and shared by all three.
function engineRelPath(platform = process.platform) {
  if (platform === 'win32') return 'realesrgan-ncnn-vulkan.exe';
  if (platform === 'darwin') return path.join('macos', 'realesrgan-ncnn-vulkan');
  return 'realesrgan-ncnn-vulkan';
}

// The engine directory, resolved the way ffmpeg-static resolves its binary:
// electron/ in dev, app.asar.unpacked in packaged builds (package.json's
// asarUnpack carries vendor/realesrgan/**).
function enginePaths(platform = process.platform) {
  const dir = path.join(__dirname, '..', 'vendor', 'realesrgan').replace('app.asar', 'app.asar.unpacked');
  return {
    dir,
    bin: path.join(dir, engineRelPath(platform)),
    models: path.join(dir, 'models'),
  };
}

// The three models the dialog offers. `native` is the scale the network
// itself produces; asking for less means upscaling native and downscaling
// with FFmpeg (planFor). realesr-animevideov3 is the exception: it ships a
// separate network per scale (the engine loads <name>-x<scale>), so both
// offered scales are native there.
const MODELS = {
  realistic: { name: 'realesrgan-x4plus', native: 4 },
  animation: { name: 'realesr-animevideov3', native: 0 },
  fast: { name: 'realesr-general-x4v3', native: 4 },
};

function planFor(modelId, scale) {
  const m = MODELS[modelId];
  if (!m) throw new Error(`Unknown enhance model: ${modelId}`);
  if (scale !== 2 && scale !== 4) throw new Error(`Unsupported enhance scale: ${scale}`);
  if (!m.native) return { modelName: m.name, engineScale: scale, downscale: false };
  return { modelName: m.name, engineScale: m.native, downscale: scale < m.native };
}

// "<name> (Enhanced 2x)" — the library name (and file name) of the result.
function outputNameFor(srcFile, scale) {
  const base = path.basename(String(srcFile || 'video')).replace(/\.[^.]+$/, '');
  return `${base} (Enhanced ${scale}x)`;
}

// The source's exact frame rate as a rational string ("30000/1001"), read
// from ffprobe directly: avg_frame_rate, falling back to r_frame_rate, then
// to the rounded probe value as a plain integer rate.
async function exactFps(file) {
  const out = await new Promise((resolve) => {
    const child = spawn(ffprobePath, ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=avg_frame_rate,r_frame_rate', '-of', 'json', file], { windowsHide: true });
    let buf = '';
    child.stdout.on('data', (d) => { buf += d; });
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(buf));
  });
  try {
    const s = (JSON.parse(out).streams || [])[0] || {};
    for (const raw of [s.avg_frame_rate, s.r_frame_rate]) {
      const m = /^(\d+)\/(\d+)$/.exec(String(raw || ''));
      if (m && Number(m[1]) > 0 && Number(m[2]) > 0) return { str: `${Number(m[1])}/${Number(m[2])}`, value: Number(m[1]) / Number(m[2]) };
    }
  } catch { /* fall through to the rounded probe value */ }
  const info = await probe(file).catch(() => null);
  const fps = info && info.fps > 0 ? info.fps : 30;
  return { str: String(fps), value: fps };
}

const framePattern = (dir) => path.join(dir, '%08d.png');
const extractArgs = (src, framesDir) => ['-y', '-i', src, '-map', '0:v:0', '-start_number', '0', framePattern(framesDir)];
const engineArgs = ({ framesDir, upDir, plan, modelsDir }) => [
  '-i', framesDir, '-o', upDir, '-n', plan.modelName, '-s', String(plan.engineScale),
  '-t', String(TILE_SIZE), '-m', modelsDir, '-f', 'png',
];
function encodeArgs({ upDir, src, outFile, fpsStr, plan, srcW, srcH, scale, audioCodec }) {
  const args = ['-y', '-framerate', fpsStr, '-start_number', '0', '-i', framePattern(upDir), '-i', src,
    '-map', '0:v:0', '-map', '1:a?'];
  // A native-4x model asked for 2x: the extra resolution is scaled back
  // here, in the same encode, with a high-quality downscale filter.
  if (plan.downscale) args.push('-vf', `scale=${srcW * scale}:${srcH * scale}:flags=lanczos`);
  args.push('-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', fpsStr,
    '-c:a', audioCodec, ...(audioCodec === 'aac' ? ['-b:a', '192k'] : []), '-shortest', outFile);
  return args;
}

// Run one child to completion. Registers the child for the caller's cancel
// (onChild) and polls isCanceled itself, killing the child either way; a
// cancel therefore stops whichever stage is running within ~150 ms.
function runChild(cmd, args, { isCanceled, onChild } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    if (onChild) onChild(child);
    const timer = setInterval(() => { if (isCanceled && isCanceled()) { try { child.kill('SIGKILL'); } catch { /* gone */ } } }, 150);
    child.on('error', (e) => { clearInterval(timer); reject(e); });
    child.on('close', (code) => {
      clearInterval(timer);
      if (isCanceled && isCanceled()) { const err = new Error('canceled'); err.canceled = true; reject(err); return; }
      resolve({ code, stderr });
    });
  });
}

const countPngs = (dir) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.png')).length; } catch { return 0; } };
const canceledError = () => { const e = new Error('canceled'); e.canceled = true; return e; };

// The whole job. onProgress({ phase, fraction }) with fraction monotonic
// over the job: frames 0→0.08, upscale 0.08→0.92, encode 0.92→1.
async function runEnhance({ src, model, scale, outFile, onProgress, isCanceled, onChild, tmpRoot }) {
  const { bin, models } = enginePaths();
  if (!fs.existsSync(bin)) throw new Error('The AI enhance engine is missing from this build.');
  if (!fs.existsSync(src)) throw new Error('The media file was not found.');
  const plan = planFor(model, scale);
  const info = await probe(src);
  if (!info || !info.hasVideo) throw new Error('The selected file has no video track to enhance.');
  const fps = await exactFps(src);
  const report = (phase, fraction) => { if (onProgress) onProgress({ phase, fraction }); };

  const work = fs.mkdtempSync(path.join(tmpRoot || os.tmpdir(), 'cutflow-enhance-'));
  const framesDir = path.join(work, 'frames');
  const upDir = path.join(work, 'up');
  fs.mkdirSync(framesDir); fs.mkdirSync(upDir);
  try {
    if (isCanceled && isCanceled()) throw canceledError();
    report('frames', 0.01);
    const ext = await runChild(ffmpegPath, extractArgs(src, framesDir), { isCanceled, onChild });
    if (ext.code !== 0) throw new Error(`Frame extraction failed: ${ext.stderr.trim().split('\n').pop() || 'ffmpeg error'}`);
    const total = countPngs(framesDir);
    if (!total) throw new Error('No frames could be read from the source video.');
    report('frames', 0.08);

    report('upscale', 0.08);
    const poll = setInterval(() => {
      const done = countPngs(upDir);
      if (done) report('upscale', 0.08 + 0.84 * Math.min(1, done / total));
    }, 350);
    let eng;
    try {
      eng = await runChild(bin, engineArgs({ framesDir, upDir, plan, modelsDir: models }), { isCanceled, onChild });
    } finally { clearInterval(poll); }
    if (eng.code !== 0) {
      // The engine's stderr names the usual cause (no Vulkan device, a
      // driver failure, a missing model) — surface it, never hang quietly.
      const tail = eng.stderr.trim().split('\n').filter(Boolean).slice(-3).join(' ');
      throw new Error(`The AI enhance engine failed${tail ? `: ${tail}` : ''}`);
    }
    if (countPngs(upDir) < total) throw new Error('The AI enhance engine stopped before finishing every frame.');
    report('upscale', 0.92);

    report('encode', 0.94);
    const encArgs = (audioCodec) => encodeArgs({ upDir, src, outFile, fpsStr: fps.str, plan, srcW: info.width, srcH: info.height, scale, audioCodec });
    let enc = await runChild(ffmpegPath, encArgs('copy'), { isCanceled, onChild });
    if (enc.code !== 0 && info.hasAudio) {
      // The source audio codec cannot be copied into an MP4 (e.g. Opus in a
      // WebM): one retry with an AAC encode before giving up.
      enc = await runChild(ffmpegPath, encArgs('aac'), { isCanceled, onChild });
    }
    if (enc.code !== 0) throw new Error(`Re-encoding the enhanced video failed: ${enc.stderr.trim().split('\n').pop() || 'ffmpeg error'}`);
    report('encode', 1);

    const out = await probe(outFile);
    let size = 0;
    try { size = fs.statSync(outFile).size; } catch { /* probe already proved the file */ }
    return {
      ok: true,
      path: outFile,
      media: {
        path: outFile, type: 'video', duration: out.duration, width: out.width, height: out.height,
        fps: out.fps, hasAudio: out.hasAudio, hasVideo: true, size,
      },
    };
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* temp hygiene only */ }
  }
}

module.exports = { MODELS, TILE_SIZE, engineRelPath, enginePaths, planFor, outputNameFor, exactFps, extractArgs, engineArgs, encodeArgs, runEnhance };
