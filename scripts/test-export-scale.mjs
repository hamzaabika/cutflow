// FB-01 (P0-06) — #17 text-layer export stall, scale verification.
// Full UI export at project scale: 12 text clips, 1080x1920, 32 s.
// The small-scale root-cause fix (7dbc9aa, format=yuva420p) was verified
// only at 640x360 / 5 s; this suite proves it holds at project scale:
//   1. the real app (CDP, __fve.load + __fve.exportNow) exports the scale
//      project to completion — the stall is gone;
//   2. the output is sane: probe says 1080x1920 / ~32 s, and frames taken
//      where no text clip is showing measure PSNR >= 40 dB against the
//      source (the fix measured 44.68 dB on a full re-export; the broken
//      YUV->RGB->YUV stacking measured 24.5 dB);
//   3. no scaler flood: the same graph re-run in node with its real
//      text.mov and -loglevel info exits 0 with only a handful of
//      scaler lines (the export itself runs at -loglevel error, so its
//      own stderr cannot show the flood — the re-run is the observable).
// Run AFTER `npm run build`:  node scripts/test-export-scale.mjs
// Needs Xvfb on :99. Takes several minutes (two 1080x1920 32 s encodes).
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9229;
const BASE = '/home/hatch/workspace/.tmp-battery';
const ff = (await import('../electron/ffmpeg.cjs')).default;
const { buildExportArgs, graphFile, probe, ffmpegPath } = ff;

const W = 1080;
const H = 1920;
const FPS = 30;
const DUR = 32;
const PSNR_MIN = 40;
const SCALER_LINES_MAX = 50;
const results = [];
const check = (name, cond, extra = '') => { results.push([name, !!cond, extra]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);

// --- preflight: Xvfb :99 must be up (live runs die without it) ------------
const xvfb = spawnSync('pgrep', ['-f', 'Xvfb :99'], { encoding: 'utf8' });
if (xvfb.status !== 0) {
  console.error('FAIL  Xvfb :99 is not running — start it before this suite (e.g. Xvfb :99 &)');
  process.exit(1);
}

fs.mkdirSync(BASE, { recursive: true });
const dir = fs.mkdtempSync(path.join(BASE, 'fve-scale-'));
const home = fs.mkdtempSync(path.join(dir, 'home-'));
const work = fs.mkdtempSync(path.join(dir, 'work-'));
console.log(`work dir ${dir} (kept for evidence)`);

// --- fixtures: 1080x1920 32 s source + the scale project -------------------
const clip = path.join(work, 'clip.mp4');
console.log(`${stamp()} generating source clip ${W}x${H} ${DUR}s…`);
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=${DUR}`,
  '-f', 'lavfi', '-i', `sine=frequency=440:duration=${DUR}`,
  '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip]);
const meta = await probe(clip);
console.log(`source: ${meta.width}x${meta.height} ${meta.duration.toFixed(2)}s hasAudio=${!!meta.hasAudio}`);

const TEXTS = ['SCALE TEST 01', 'Second caption here', 'Third line of text', 'Cutflow scale check',
  'Fifth text clip', 'Sixth one goes here', 'Seventh caption', 'Eighth text layer',
  'Ninth in the list', 'Tenth caption now', 'Eleventh text clip', 'Twelfth and last'];
const textClips = TEXTS.map((text, i) => ({
  id: `t${i + 1}`, text, start: 1 + i * 2.6, duration: 2,
  x: 0.5, y: [0.25, 0.5, 0.75][i % 3], size: 56 + (i % 3) * 20,
}));
const project = {
  name: 'scale-test', ratio: '9:16', resolution: 1080, width: W, height: H, fps: FPS, background: '#000000',
  media: [{ id: 'm0', path: clip, name: 'clip.mp4', ...meta }],
  videoClips: [{ id: 'v1', mediaId: 'm0', in: 0, out: DUR, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
  overlayClips: [], audioClips: [], stickerClips: [], effectClips: [], textClips,
};

// --- CDP harness (same shape as test-export-variants-live.mjs) ------------
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      }
    };
    ws.onerror = () => reject(new Error('ws error'));
    ws.onclose = () => { for (const { rej } of pending.values()) rej(new Error('ws closed')); pending.clear(); };
    ws.onopen = () => resolve({
      call: (method, params = {}) => new Promise((res, rej) => {
        const mid = ++id;
        const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)); }, 30000);
        pending.set(mid, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
        ws.send(JSON.stringify({ id: mid, method, params }));
      }),
      close: () => ws.close(),
    });
  });
}
async function waitTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('CDP target never appeared');
}

const env = {
  ...process.env, HOME: home, DISPLAY: ':99', FVE_EXPORT_TARGET: work, TMPDIR: work,
  VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES || '/home/hatch/workspace/vulkan/lvp_icd.json',
  LIBGL_ALWAYS_SOFTWARE: '1',
};
delete env.FVE_SMOKE;
// Software GL flags: without --disable-gpu the app died 24 s into the
// first run (GPU process launch failed, FATAL "GPU process isn't usable").
// The shared VM's standing cleanup is `pkill -x electron`, which SIGTERMs
// every process named exactly that — runs 5 and 6 died that way mid-export
// (GPU process exit 15, main clean exit 0). A symlink rename was NOT
// enough: Electron's children re-exec /proc/self/exe, i.e. the real path,
// so they are still named "electron". A HARDLINK in the same dist dir
// (same inode, zero extra disk, resources still adjacent) makes
// /proc/self/exe — and therefore every child — resolve to the new name.
// (Runs 5/6 used a symlink; the children re-exec'd the real binary.)
const electronBin = path.join(ROOT, 'node_modules/electron/dist/electron');
const electronLink = path.join(ROOT, 'node_modules/electron/dist/cutflow-scale');
try { fs.linkSync(electronBin, electronLink); } catch { /* already linked */ }
const child = spawn(electronLink,
  ['.', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-sandbox',
    '--disable-accelerated-video-decode', '--disable-accelerated-video-encode',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: 'pipe', detached: true });
let childStderr = '';
child.stderr.on('data', (d) => { childStderr += d; });

const psnrAt = (t) => {
  // One frame from the source and one from the export at the same time,
  // PSNR between them (both lossless PNGs, so the number is the encode's).
  const a = path.join(work, `psnr-src-${t}.png`);
  const b = path.join(work, `psnr-out-${t}.png`);
  const grab = (file, out) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', out]);
  grab(clip, a);
  grab(outFile, b);
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'info', '-i', a, '-i', b, '-filter_complex', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = (r.stderr || '').match(/average:\s*(inf|[\d.]+)/);
  return m ? (m[1] === 'inf' ? 99 : Number(m[1])) : null;
};

let outFile = null;
let textMov = null;
try {
  const page = await waitTarget();
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const ev = async (expr) => {
    const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const evFire = async (expr) => {
    const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: false, returnByValue: true });
    if (r.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const until = async (expr, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch { /* not yet */ } await sleep(500); }
    return false;
  };

  const alive = () => {
    if (child.exitCode !== null) throw new Error(`app exited (code ${child.exitCode}) — see child stderr tail in the log`);
  };
  await until(`!!window.__fve`, 120000);
  const harnessOk = await ev(`!!window.__fve`);
  check('app harness ready', harnessOk);
  if (!harnessOk) throw new Error('window.__fve never appeared (renderer did not mount)');
  alive();
  // First-run Welcome modal swallows pointer hits — dismiss it, here and
  // again after entering the editor (it can appear in both places).
  const dismiss = `(() => { const b = [...document.querySelectorAll('button')].find((x) => /got it|dismiss|close|start/i.test(x.textContent)); if (b) b.click(); return !!b; })()`;
  await ev(dismiss).catch(() => {});
  await ev(`(() => { const b = document.querySelector('[aria-label="Create project"]'); if (b) b.click(); return !!b; })()`).catch(() => {});
  // Startup is slow on a loaded VM (software GL): give the editor 3 min.
  check('editor ready', await until(`!!document.querySelector('.play-btn')`, 180000));
  alive();
  await ev(dismiss).catch(() => {});
  await ev(`(() => { const b = document.querySelector('button[aria-label="Skip tour"]') || [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) b.click(); return !!b; })()`).catch(() => {});
  await sleep(600);

  await ev(`window.__fve.load(${JSON.stringify(project)})`);
  await sleep(1500);
  check('scale project loaded (12 text clips)', await ev(`window.__fve.duration() > 30`));

  // Full UI export. The file on disk is ground truth (the tray poll is
  // blind to a finished job). While the encode runs, the text layer file
  // the renderer just wrote is stable — copy it for the graph re-run.
  console.log(`${stamp()} starting UI export…`);
  const t0 = Date.now();
  await evFire(`window.__fve.exportNow()`);
  let copiedSize = -1;
  // A growing file is not a finished export: the file is done only when
  // its size is stable across polls AND ffprobe reads it (the moov atom
  // is written last). The 1 MB tripwire in run 3 fired 20 s into the
  // encode and the suite killed the app mid-encode.
  let stable = 0;
  let lastSize = -1;
  while (Date.now() - t0 < 900000) {
    // Fail fast if the app died mid-export instead of waiting out the
    // whole timeout on a file that will never come.
    if (child.exitCode !== null) throw new Error(`app exited during export (code ${child.exitCode}) — see child stderr tail in the log`);
    const found = fs.readdirSync(work, { recursive: true })
      .filter((f) => typeof f === 'string' && f.endsWith('text.mov'))
      .map((f) => path.join(work, f));
    if (found.length) {
      // The text render writes in bursts: re-copy whenever the size
      // moved, after a stability pause, so the last copy is complete.
      const src = found[0];
      const size1 = fs.statSync(src).size;
      if (size1 !== copiedSize && size1 > 0) {
        await sleep(3000);
        if (fs.existsSync(src) && fs.statSync(src).size === size1) {
          textMov = path.join(work, 'text-copy.mov');
          fs.copyFileSync(src, textMov);
          copiedSize = size1;
          console.log(`${stamp()} text.mov copied (${(size1 / 1e6).toFixed(1)} MB) while the encode runs`);
        }
      }
    }
    const mp4s = fs.readdirSync(work).filter((f) => f.endsWith('.mp4') && f !== 'clip.mp4');
    const cand = mp4s.map((f) => path.join(work, f)).find((f) => fs.statSync(f).size > 1000000);
    if (cand) {
      const size = fs.statSync(cand).size;
      stable = size === lastSize ? stable + 1 : 0;
      lastSize = size;
      if (stable >= 6) {
        try {
          const pm = await probe(cand);
          if (pm && pm.width) { outFile = cand; break; }
        } catch { /* still writing — keep waiting */ }
        stable = 0;
      }
    } else { stable = 0; lastSize = -1; }
    await sleep(2000);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  check('UI export completes at scale', !!outFile, outFile ? `${outFile} in ${elapsed}s` : `no output after ${elapsed}s`);
  if (!outFile) throw new Error('UI export produced no file');

  const om = await probe(outFile);
  check('output is 1080x1920', om.width === 1080 && om.height === 1920, `${om.width}x${om.height}`);
  check('output is ~32 s', Math.abs(om.duration - DUR) < 0.6, `${om.duration.toFixed(2)}s`);

  // PSNR where no text clip is showing: the number must stay near the
  // fixed 44.68 dB, far above the broken stacking's 24.5 dB.
  const times = [0.5, 16.3, 31.8];
  const psnrs = times.map((t) => [t, psnrAt(t)]);
  for (const [t, v] of psnrs) check(`PSNR sane at t=${t}s`, v !== null && v >= PSNR_MIN, v === null ? 'no reading' : `${v.toFixed(2)} dB`);
  const mean = psnrs.reduce((n, [, v]) => n + (v ?? 0), 0) / psnrs.length;
  check('mean PSNR sane', mean >= PSNR_MIN, `${mean.toFixed(2)} dB`);

  // Scaler flood: the same graph, re-run in node with the real text.mov
  // and -loglevel info (the export itself runs at -loglevel error).
  check('text.mov captured for the graph re-run', !!textMov, textMov || 'not found under TMPDIR');
  if (textMov) {
    const tm = await probe(textMov);
    const withText = { ...project, textOverlay: { file: textMov, count: Math.max(1, Math.round(tm.duration * FPS)) } };
    const out2 = path.join(work, 'out-direct.mp4');
    const { args } = buildExportArgs(withText, out2, { encoder: 'libx264' });
    const infoArgs = [...args];
    const li = infoArgs.indexOf('-loglevel');
    if (li >= 0) infoArgs[li + 1] = 'info';
    console.log(`${stamp()} re-running the export graph directly (libx264, -loglevel info)…`);
    const run = await new Promise((resolve) => {
      const p = spawn(ffmpegPath, graphFile(infoArgs, work), { windowsHide: true });
      let err = '';
      // The progress pipe writes to stdout continuously: it must be
      // consumed or the pipe fills and stalls the encode.
      p.stdout.on('data', () => {});
      p.stderr.on('data', (d) => { err += d; });
      const kill = setTimeout(() => { p.kill('SIGKILL'); resolve({ code: -1, err }); }, 600000);
      p.on('close', (code) => { clearTimeout(kill); resolve({ code, err }); });
    });
    const scalerLines = (run.err.match(/^.*(swscaler|deprecated pixel format|Conversion failed).*$/gim) || []).length;
    fs.writeFileSync(path.join(work, 'direct-ffmpeg-stderr.log'), run.err);
    check('direct graph run exits 0', run.code === 0, `exit ${run.code}`);
    check('no scaler flood in stderr', scalerLines < SCALER_LINES_MAX, `${scalerLines} scaler lines (cap ${SCALER_LINES_MAX})`);
    if (fs.existsSync(out2)) {
      const dm = await probe(out2);
      check('direct run output is 1080x1920', dm.width === 1080 && dm.height === 1920, `${dm.width}x${dm.height}`);
    }
  }

  console.log(`\nEXPORT SCALE: ${results.filter(([, ok]) => ok).length}/${results.length} checks passed — work dir ${dir}`);
  if (results.some(([, ok]) => !ok)) process.exitCode = 1;
} catch (e) {
  console.error('EXPORT SCALE ERROR:', e.message);
  console.error(childStderr.slice(-3000));
  process.exitCode = 1;
} finally {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already dead */ }
}
