// AudioFx preview derivative: renders a clip's sound through the SAME filter chain the
// export applies (electron/audiofx.cjs audioFxFilters) into a cached 48 kHz stereo WAV.
// The clip stores clip.audioFxRender = { path, from, to, chain, src }; the preview plays
// that file in place of the clip's sound and the export uses it as the clip's audio
// source (skipping a second application of the chain), so both hear exactly the same
// thing — parity by construction, the voice-enhance pattern (electron/enhance.cjs)
// generalised. If the clip's fx, range or sound source change, the stored render no
// longer validates (consumers recompute the chain / compare ranges) and the export
// falls back to applying the chain inline until a fresh derivative lands.
//
// The chain sits behind aresample=48000 in every export graph, and its pitch stage's
// asetrate math assumes 48 kHz — so the render resamples to 48 kHz BEFORE the chain.
// A mono source takes the same dual-mono pan the export chains apply first (monoUp in
// ffmpeg.cjs), so the derivative carries the level the export presented all along.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { audioFxFilters } = require('./audiofx.cjs');

const num = (v) => String(Math.round(v * 1000) / 1000);

// The full filter list for a derivative render: source conditioning + the shared chain.
// Exported for scripts/test-audiofx-preview.mjs, which rebuilds the same graph from
// audiofx.cjs directly and compares the rendered samples.
function derivativeFilters(fx, channels) {
  return [...(channels === 1 ? ['pan=stereo|c0=c0|c1=c0'] : []), 'aresample=48000', ...audioFxFilters(fx)];
}

function outFile(srcPath, from, to, chain, cacheDir) {
  const st = fs.statSync(srcPath);
  const key = crypto.createHash('sha1')
    .update(`${srcPath}|${st.size}|${st.mtimeMs}|audiofx1|${num(from)}|${num(to)}|${chain}`)
    .digest('hex').slice(0, 16);
  return path.join(cacheDir, `${key}-audiofx.wav`);
}

function run(ffmpegPath, args, cwd, onTime, isCanceled, len) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-nostats', '-progress', 'pipe:1', ...args], { cwd, windowsHide: true });
    let err = '';
    const timer = setInterval(() => { if (isCanceled()) p.kill(); }, 200);
    p.stdout.on('data', (d) => {
      const m = /out_time_us=(\d+)/.exec(String(d));
      if (m) onTime(Number(m[1]) / 1e6);
    });
    p.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
    p.on('error', reject);
    p.on('close', (code) => {
      clearInterval(timer);
      if (isCanceled()) {
        const e = new Error('Canceled.');
        e.canceled = true;
        reject(e);
      } else if (code === 0) resolve();
      else reject(new Error(`Audio effects render failed: ${err.trim().split('\n').pop() || `FFmpeg exited with ${code}`}`));
    });
  });
}

// srcPath / from / to: the clip's effective sound source and range — the media file's
// [clip.in, clip.out], or [0, clip.out - clip.in] of the enhanced render when Voice
// Enhance replaces the sound (the caller resolves that, exactly as the preview does).
// Returns { path, chain } — the cached WAV covering exactly [from, to] of the source —
// or null when the fx produce no filters (nothing to render).
async function renderAudioFx({ srcPath, from = 0, to, fx, channels = 2, cacheDir, ffmpegPath, onProgress = () => {}, isCanceled = () => false }) {
  const chain = audioFxFilters(fx).join(',');
  if (!chain) return null;
  const a = Math.max(0, from);
  const b = to ?? a;
  const len = Math.max(0.1, b - a);
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = outFile(srcPath, a, b, chain, cacheDir);
  if (fs.existsSync(out)) { onProgress(1); return { path: out, chain }; }
  const part = `${path.basename(out, '.wav')}.part.wav`;
  const args = ['-ss', num(a), '-t', num(len), '-i', srcPath,
    '-map', '0:a:0', '-vn', '-af', derivativeFilters(fx, channels).join(','), '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', '-y', part];
  try {
    await run(ffmpegPath, args, cacheDir, (t) => onProgress(Math.min(0.99, t / len)), isCanceled, len);
    fs.renameSync(path.join(cacheDir, part), out);
    onProgress(1);
    return { path: out, chain };
  } finally {
    fs.rmSync(path.join(cacheDir, part), { force: true });
  }
}

module.exports = { renderAudioFx, derivativeFilters };
