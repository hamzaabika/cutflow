// Live verification for P3 stream C (P3-05 scoped extrusion + P3-10
// recommendations): boots the real dev app on CDP 9228 with a fresh profile,
// loads a 16:9 project with an extruded title + a cooking transcript, and
// drives each feature's UI for real:
//  - P3-05: the 3D extrude card in the text inspector; the preview text
//    layer carries face-yellow AND shaded-side pixels; the exported frame
//    at the same timestamp matches the preview on the opaque text pixels
//    (mean abs diff + outlier fraction, measured — not eyeballed).
//  - P3-10: the Media tab shows pasta + cooking-music suggestions with a
//    transcript reason, never the unrelated city clip; dismissing one
//    removes it and persists; no http(s) resource is loaded anywhere
//    (local-only proof, plus the static no-network check in
//    scripts/test-recommend.mjs).
// Run AFTER `npm run build`:  node scripts/test-p3c-live.mjs
// Screenshots + pixel evidence land in the run dir.
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9228;
const HOME = '/tmp/p3c-home';
const TMP = path.join(process.env.HOME, 'workspace/.tmp-p3-c-live');
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
const ff = require('../electron/ffmpeg.cjs');
const ffmpegPath = ff.ffmpegPath;

const results = [];
const check = (name, cond, extra = '') => { results.push([name, !!cond, extra]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
        const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)); }, 60000);
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

// Library media: one clip on the timeline (beach), three in the library only
// (pasta + cooking music match the transcript, city matches nothing).
const clipBeach = path.join(TMP, 'beach-sunset.mp4');
const clipPasta = path.join(TMP, 'pasta-recipe.mp4');
const clipCity = path.join(TMP, 'city-night.mp4');
const clipMusic = path.join(TMP, 'cooking-music.mp3');
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-shortest', '-pix_fmt', 'yuv420p', clipBeach]);
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'gradients=size=1280x720:rate=30:duration=5:c0=ff5522:c1=ffcc33', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-shortest', '-pix_fmt', 'yuv420p', clipPasta]);
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-shortest', '-pix_fmt', 'yuv420p', clipCity]);
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=5', clipMusic]);
const probeBeach = await ff.probe(clipBeach);
const probePasta = await ff.probe(clipPasta);
const probeCity = await ff.probe(clipCity);
const probeMusic = await ff.probe(clipMusic);

const env = {
  ...process.env, HOME, DISPLAY: ':99', TMPDIR: TMP,
  VK_ICD_FILENAMES: path.join(process.env.HOME, 'workspace/vulkan/lvp_icd.json'),
  FVE_EXPORT_TARGET: TMP,
};
const logFile = path.join(TMP, 'electron-p3c.log');
const logFd = fs.openSync(logFile, 'w');
for (let i = 0; i < 15; i++) {
  try { execFileSync('pkill', ['-x', 'electron']); } catch {}
  await sleep(1000);
  try { execFileSync('pgrep', ['-x', 'electron']); } catch { break; }
}
const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron'),
  ['.', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: ['ignore', logFd, logFd], detached: true });
console.log(`electron pid ${child.pid} (log: ${logFile})`);

const shot = async (cdp, name) => {
  const r = await cdp.call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(TMP, `${name}.png`), Buffer.from(r.data, 'base64'));
  console.log(`shot ${name}.png`);
};

// Decode an image to raw RGB(A) at 640x360 for pixel comparison.
const rawPixels = (file, pixFmt) => {
  const buf = execFileSync(ffmpegPath, ['-v', 'error', '-i', file, '-vf', 'scale=640:360', '-f', 'rawvideo', '-pix_fmt', pixFmt, '-']);
  return buf;
};

let cdp;
try {
  const page = await waitTarget();
  cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const ev = async (expr) => {
    const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page exception: ${JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text)}`);
    return r.result.value;
  };
  const evFire = async (expr) => {
    const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: false, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page exception: ${JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text)}`);
    return r.result.value;
  };
  const until = async (expr, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(300); }
    return false;
  };

  await sleep(2500);
  await ev(`(() => { const b = document.querySelector('.home-create'); if (b) b.click(); return !!b; })()`);
  check('editor entered', await until(`!!document.querySelector('.play-btn')`, 20000));
  await until(`(() => { const b = document.querySelector('.welcome-go'); if (b) { b.click(); return true; } return false; })()`, 8000);
  await sleep(600);

  const project = {
    name: 'p3c-check', ratio: '16:9', resolution: 720, width: 1280, height: 720, fps: 30, background: '#000000',
    media: [
      { id: 'm0', path: clipBeach, name: 'beach-sunset.mp4', ...probeBeach },
      { id: 'm1', path: clipPasta, name: 'pasta-recipe.mp4', ...probePasta },
      { id: 'm2', path: clipCity, name: 'city-night.mp4', ...probeCity },
      { id: 'm3', path: clipMusic, name: 'cooking-music.mp3', ...probeMusic },
    ],
    videoClips: [
      { id: 'v1', mediaId: 'm0', in: 0, out: 5, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null },
    ],
    overlayClips: [], audioClips: [], stickerClips: [], effectClips: [],
    textClips: [
      {
        id: 't1', text: 'BEACH FEAST', start: 0, duration: 5, font: 'montserrat', size: 110,
        color: '#ffd400', color2: '#c2410c', stroke: { width: 0, color: '#000000' },
        shadow: { on: false, color: '#000000', blur: 0, x: 0, y: 0, opacity: 0 },
        bg: { on: false }, bubble: 'none', effect: 'none', x: 0.5, y: 0.45,
        extrude: { on: true, depth: 16, bevel: 3, light: 225, tiltX: 12, tiltY: -10 },
        animIn: { id: 'none', dur: 0.3, unit: 'whole' },
        animOut: { id: 'none', dur: 0.25, unit: 'whole' },
        animLoop: { id: 'none', speed: 1 },
      },
      {
        id: 't2', text: 'cooking pasta tonight at the beach', caption: true, source: 'srt', start: 0, duration: 5,
        font: 'cairo', size: 44, color: '#ffffff', x: 0.5, y: 0.85,
        animIn: { id: 'none', dur: 0.3, unit: 'whole' },
        animOut: { id: 'none', dur: 0.25, unit: 'whole' },
        animLoop: { id: 'none', speed: 1 },
      },
    ],
  };
  await ev(`window.__fve.load(${JSON.stringify(project)})`);
  await ev(`window.__fve.seek(2)`);
  await sleep(1000);
  check('project loaded: 1 video clip + extruded title + caption', await ev(`(() => { const p = window.__fve.exportData().project; return p.videoClips.length === 1 && p.textClips.length === 2 && p.textClips[0].extrude.on === true; })()`));

  // ---- P3-05: inspector card + preview pixels --------------------------------
  await ev(`window.__fve.select({ track: 'text', id: 't1' })`);
  await sleep(700);
  const cardText = await ev(`document.body.textContent.includes('3D extrude')`);
  check('inspector shows the 3D extrude card for the title', cardText);
  const extrudeControls = await ev(`(() => {
    const card = [...document.querySelectorAll('.insp-card')].find((el) => el.querySelector('.insp-card-title')?.textContent.trim() === '3D extrude');
    if (!card) return 'no-card';
    return card.textContent;
  })()`);
  check('extrude card offers Depth / Bevel / Light / Tilt controls',
    typeof extrudeControls === 'string' && /Depth/.test(extrudeControls) && /Bevel/.test(extrudeControls) && /Light direction/.test(extrudeControls) && /Tilt/.test(extrudeControls),
    String(extrudeControls).slice(0, 200));
  await shot(cdp, 'preview-extrude');

  // Read the preview text layer straight off its canvas: count face-yellow
  // pixels (the #ffd400 face) and shaded-side pixels (darkened yellows) —
  // depth + shading, measured, not eyeballed.
  const previewPng = await ev(`(() => {
    const cv = document.querySelector('canvas.text-layer');
    if (!cv) return null;
    return { dataUrl: cv.toDataURL('image/png'), w: cv.width, h: cv.height };
  })()`);
  check('preview text-layer canvas is readable', !!previewPng?.dataUrl, previewPng ? `${previewPng.w}x${previewPng.h}` : 'no canvas');
  let previewStats = null;
  if (previewPng) {
    const pngPath = path.join(TMP, 'preview-text.png');
    fs.writeFileSync(pngPath, Buffer.from(previewPng.dataUrl.split(',')[1], 'base64'));
    const rgba = rawPixels(pngPath, 'rgba');
    let face = 0; let side = 0; let opaque = 0;
    for (let i = 0; i + 3 < rgba.length; i += 4) {
      const [r, g, b, a] = [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
      if (a < 200) continue;
      opaque++;
      if (r > 240 && g >= 195 && g <= 225 && b < 40) face++;
      else if (r >= 100 && r <= 230 && g >= 80 && g <= 200 && b < 40) side++;
    }
    previewStats = { face, side, opaque, w: 640, h: 360 };
    console.log(`  preview text layer @640x360: opaque=${opaque} face-yellow=${face} shaded-side=${side}`);
    check('preview shows the extruded face (yellow) in depth', face > 200, `face=${face}`);
    check('preview shows shaded extrusion sides (darker yellow)', side > 200, `side=${side}`);
  }

  // ---- P3-10: recommendations -------------------------------------------------
  await ev(`window.__fve.tab('media')`);
  await sleep(800);
  const recSection = await ev(`(() => {
    const el = document.querySelector('[data-testid="recommendations"]');
    return el ? el.textContent : null;
  })()`);
  check('recommendations section renders in the Media tab', !!recSection, String(recSection).slice(0, 200));
  if (recSection) {
    check('pasta clip is recommended', recSection.includes('pasta-recipe.mp4'), recSection.slice(0, 300));
    check('cooking music is recommended', recSection.includes('cooking-music.mp3'), recSection.slice(0, 300));
    check('unrelated city clip is NOT recommended', !recSection.includes('city-night.mp4'), recSection.slice(0, 300));
    check('reason names the transcript', /Transcript mentions/.test(recSection), recSection.slice(0, 300));
  }
  // Dismiss the pasta suggestion: it leaves the list and persists locally.
  const dismissed = await ev(`(() => {
    const rows = [...document.querySelectorAll('.media-recommend-row')];
    const row = rows.find((r) => r.textContent.includes('pasta-recipe.mp4'));
    if (!row) return 'no-row';
    row.querySelector('.media-recommend-dismiss')?.click();
    return 'clicked';
  })()`);
  await sleep(500);
  const afterDismiss = await ev(`document.querySelector('[data-testid="recommendations"]')?.textContent || ''`);
  const dismissedPrefs = await ev(`JSON.parse(localStorage.getItem('clipcraft.recommend.v1') || '{}')`);
  check('dismiss removes the suggestion and persists the id',
    dismissed === 'clicked' && !afterDismiss.includes('pasta-recipe.mp4') && Array.isArray(dismissedPrefs.dismissed) && dismissedPrefs.dismissed.includes('m1'),
    `${dismissed} dismissed=${JSON.stringify(dismissedPrefs.dismissed)}`);
  // Local-only proof at runtime: no http(s) resource was ever loaded.
  const netResources = await ev(`performance.getEntriesByType('resource').filter((e) => /^https?:/.test(e.name)).map((e) => e.name)`);
  check('no http(s) resource loaded during the whole session (local only)', Array.isArray(netResources) && netResources.length === 0, JSON.stringify(netResources));

  // ---- P3-05: export frame vs preview pixels --------------------------------
  await evFire(`window.__fve.exportNow()`);
  const outFile = await (async () => {
    const t0 = Date.now();
    let lastSize = -1; let stableSince = 0;
    while (Date.now() - t0 < 240000) {
      const mp4s = fs.existsSync(TMP) ? fs.readdirSync(TMP).filter((f) => f.endsWith('.mp4') && !f.startsWith('beach-') && !f.startsWith('pasta-') && !f.startsWith('city-')) : [];
      const done = mp4s.map((f) => path.join(TMP, f)).filter((f) => fs.statSync(f).size > 10000);
      if (done.length) {
        const size = fs.statSync(done[0]).size;
        if (size === lastSize) {
          if (Date.now() - stableSince > 2000) return done[0];
        } else { lastSize = size; stableSince = Date.now(); }
      }
      await sleep(1000);
    }
    return null;
  })();
  check('export file written to disk', !!outFile, outFile || 'none');
  if (outFile && previewStats) {
    const framePng = path.join(TMP, 'export-frame.png');
    execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', outFile, '-ss', '2', '-frames:v', '1', framePng]);
    const previewRgba = rawPixels(path.join(TMP, 'preview-text.png'), 'rgba');
    const exportRgb = rawPixels(framePng, 'rgb24');
    // The preview rasterizes the text at stage size (917x516 here) and the
    // export at project size (1280x720), then YUV420 — so a glyph edge can
    // land one pixel apart between the two without anything being wrong.
    // Compare each opaque preview pixel against the best match in the
    // export's 3x3 neighbourhood (a 1 px rasterization tolerance), and keep
    // the exact (0,0) mean as a gross-mismatch guard: any 1 px shift makes
    // the exact comparison much worse (verified: 6.49 -> 20+), so alignment
    // is right and only edge rasterization differs.
    const diffAt = (x, y, dx, dy) => {
      const ex = Math.min(639, Math.max(0, x + dx)); const ey = Math.min(359, Math.max(0, y + dy));
      const i = (y * 640 + x) * 4; const j = (ey * 640 + ex) * 3;
      return Math.max(Math.abs(previewRgba[i] - exportRgb[j]), Math.abs(previewRgba[i + 1] - exportRgb[j + 1]), Math.abs(previewRgba[i + 2] - exportRgb[j + 2]));
    };
    let n = 0; let sum = 0; let outliers = 0; let sumExact = 0; let titleN = 0; let titleOut = 0;
    for (let y = 0; y < 360; y++) for (let x = 0; x < 640; x++) {
      const i = (y * 640 + x) * 4;
      if (previewRgba[i + 3] < 200) continue; // only opaque text pixels: there the export must equal the preview
      n++;
      sumExact += diffAt(x, y, 0, 0);
      let best = 255;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) best = Math.min(best, diffAt(x, y, dx, dy));
      sum += best;
      if (best > 16) outliers++;
      if (y < 200) { titleN++; if (best > 16) titleOut++; } // the extruded title lives in the top half
    }
    const mean = n ? sum / n : NaN;
    const frac = n ? outliers / n : NaN;
    const meanExact = n ? sumExact / n : NaN;
    console.log(`  preview-vs-export on ${n} opaque text pixels: exact mean=${meanExact?.toFixed(2)}, 3x3-tolerant mean=${mean?.toFixed(2)}, outliers(>16)=${(frac * 100)?.toFixed(2)}% (extruded title region: ${(titleOut / titleN * 100)?.toFixed(2)}%)`);
    check('exported frame matches the preview on the extruded text',
      n > 500 && meanExact < 8 && mean < 5 && frac < 0.08,
      `n=${n} exact-mean=${meanExact?.toFixed(2)} tolerant-mean=${mean?.toFixed(2)} outliers=${(frac * 100)?.toFixed(2)}%`);
  }

  const failed = results.filter(([, okk]) => !okk);
  console.log(failed.length ? `P3C-LIVE FAIL (${failed.length}/${results.length})` : `P3C-LIVE OK (${results.length} checks)`);
  if (failed.length) process.exitCode = 1;
} catch (e) {
  console.error('P3C-LIVE ERROR', e);
  process.exitCode = 1;
} finally {
  try { if (cdp) cdp.close(); } catch { /* already closed */ }
  try { child.kill('SIGTERM'); } catch { /* already dead */ }
  await sleep(500);
  try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ }
}
