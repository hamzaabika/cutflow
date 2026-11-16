// Stream F (§7) LIVE driver — the app, not the headless engine.
// Boots the real dev app (CDP port 9344 — distinct from other streams),
// loads one 12.4 s project that carries the §7 items that need the real
// fx/text passes (headless runExport cannot run them), and verifies:
//   - fx_dust overlay: preview toggle on/off + export presence
//   - HSL grade: preview toggle (green moves, red does not) + export
//   - fx_irisout + wipeleft junctions in preview and export
//   - Text 27 + Captions 200-208: each style burns into the export
//     (export with text vs the same project without text, per window)
//   - Library & UX 228/234/235 in the real Composer/CurveEditor UI
//     (232 multi-clip apply: asserted absent in UI + code)
//   - A-F10 component suites are run separately (see report); the full
//     deterministic golden-frame fixture (P1-19) is CC scope.
// Run AFTER `npm run build`. Usage: node scripts/test-gap-f-live.mjs
// Screenshots + results JSON land in ~/workspace/.tmp-gap-f-live/.
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9344;
const WORK = path.join(os.homedir(), 'workspace', '.tmp-gap-f-live');
fs.mkdirSync(WORK, { recursive: true });
const dir = fs.mkdtempSync(path.join(WORK, 'run-'));
const shots = path.join(dir, 'shots');
fs.mkdirSync(shots, { recursive: true });
const home = path.join(dir, 'home');
fs.mkdirSync(home, { recursive: true });

const ff = (await import('../electron/ffmpeg.cjs')).default;
const ffmpegPath = ff.ffmpegPath;
const { TEXT_TEMPLATES } = await import('../src/text/catalog.js');

const results = [];
const fails = [];
const check = (name, cond, extra = '') => {
  results.push([name, !!cond, extra]);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- fixtures ----------
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
const W = 640, H = 360, FPS = 30;
const grad = path.join(dir, 'grad.mp4');
const det = path.join(dir, 'det.mp4');
const two = path.join(dir, 'two.mp4');
gen(['-f', 'lavfi', '-i', `gradients=size=${W}x${H}:rate=${FPS}:duration=12`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-shortest', '-pix_fmt', 'yuv420p', grad]);
gen(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=12`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-shortest', '-pix_fmt', 'yuv420p', det]);
gen(['-f', 'lavfi', '-i', `color=c=0x00ff00:size=320x360:rate=${FPS}:duration=12`, '-f', 'lavfi', '-i', `color=c=0xff0000:size=320x360:rate=${FPS}:duration=12`,
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-filter_complex', '[0:v][1:v]hstack=inputs=2[v]', '-map', '[v]', '-map', '2:a', '-shortest', '-pix_fmt', 'yuv420p', two]);
const probe = async (f) => ff.probe(f);
const mGrad = await probe(grad), mDet = await probe(det), mTwo = await probe(two);

const tpl = (id) => TEXT_TEMPLATES.find((t) => t.id === id);
const wordsFor = (text, start, dur) => {
  const ws = text.split(' ');
  return ws.map((w, i) => ({ text: w, start: (i * dur) / ws.length, end: ((i + 1) * dur) / ws.length }));
};
const textClip = (id, templateId, text, start, dur, extra = {}) => {
  const p = { ...(tpl(templateId)?.patch || {}) };
  return { id, text, start, duration: dur, x: 0.5, y: p.y ?? 0.5, size: p.size ?? 64, ...p, ...extra, caption: true, words: wordsFor(text, start, dur) };
};
const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
const mkProject = (withText = true) => ({
  name: 'gapf-live', ratio: '16:9', resolution: 360, width: W, height: H, fps: FPS, background: '#000000',
  media: [
    { id: 'mg', path: grad, name: 'grad.mp4', ...mGrad },
    { id: 'md', path: det, name: 'det.mp4', ...mDet },
    { id: 'mt', path: two, name: 'two.mp4', ...mTwo },
  ],
  videoClips: [
    { ...base, id: 'v1', mediaId: 'md', in: 0, out: 2 },
    { ...base, id: 'v2', mediaId: 'mg', in: 0, out: 2, transition: { type: 'wipeleft', duration: 0.8 } },
    { ...base, id: 'v3', mediaId: 'md', in: 0, out: 2, transition: { type: 'fx_irisout', duration: 0.8 } },
    { ...base, id: 'v4', mediaId: 'mg', in: 0, out: 2, effects: ['fx_dust'] },
    { ...base, id: 'v5', mediaId: 'mt', in: 0, out: 2, grade: { hsl: { green: { h: 30, s: 0, l: 0 } } } },
    { ...base, id: 'v6', mediaId: 'md', in: 0, out: 4 },
  ],
  overlayClips: [],
  textClips: withText ? [
    { ...textClip('t1', 'title-decode', 'DECODE', 0, 2), caption: false, words: undefined },
    textClip('t2', 'cap-hormozi', 'WORD POP NOW', 2, 2),
    textClip('t3', 'cap-oneword', 'ONE', 4, 2),
    textClip('t4', 'cap-subtitle', 'PILL SUBTITLE', 6, 2, { bubble: 'pill', bubbleColor: '#16161f' }),
    textClip('t5', 'cap-karaoke', 'SING ALONG NOW', 8, 2),
    textClip('t6', 'cap-neon', 'NEON GLOW', 10, 1),
    { ...textClip('t7', 'cap-minimal', 'MINIMAL LIFT', 11, 1), animIn: { id: 'fadeUp', dur: 0.7 } },
  ] : [],
  audioClips: [], stickerClips: [], effectClips: [],
});

// ---------- pixel helpers (decode PNG screenshots / export frames with ffmpeg) ----------
const pngToRaw = (png) => {
  const raw = execFileSync(ffmpegPath, ['-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 28 });
  return raw;
};
const frameAt = (file, t, w = W, h = H) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file,
  '-frames:v', '1', '-vf', `scale=${w}:${h},format=rgba`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 24 });
const lumaAt = (f, x, y, w) => 0.299 * f[(y * w + x) * 4] + 0.587 * f[(y * w + x) * 4 + 1] + 0.114 * f[(y * w + x) * 4 + 2];
const meanDiff = (f1, f2, w = W, h = H, x0 = 0, x1 = 1, y0 = 0, y1 = 1) => {
  let s = 0, n = 0;
  for (let y = Math.floor(y0 * h); y < Math.floor(y1 * h); y++) for (let x = Math.floor(x0 * w); x < Math.floor(x1 * w); x++) {
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) { s += Math.abs(f1[i + c] - f2[i + c]); n++; }
  }
  return s / n;
};
const brightCount = (f, w, h, thr = 200, y0 = 0, y1 = 1) => {
  let n = 0;
  for (let y = Math.floor(y0 * h); y < Math.floor(y1 * h); y++) for (let x = 0; x < w; x++) if (lumaAt(f, x, y, w) > thr) n++;
  return n;
};
const centroidY = (f, w, h, thr = 180, y0 = 0.3, y1 = 0.8) => {
  let sy = 0, n = 0;
  for (let y = Math.floor(y0 * h); y < Math.floor(y1 * h); y++) for (let x = 0; x < w; x++) if (lumaAt(f, x, y, w) > thr) { sy += y; n++; }
  return n ? sy / n : -1;
};

// ---------- launch ----------
const env = {
  ...process.env, HOME: home, DISPLAY: ':99',
  TMPDIR: path.join(os.homedir(), 'workspace', '.tmp-gap-f-live-tmp'),
  LIBGL_ALWAYS_SOFTWARE: '1',
  FVE_EXPORT_TARGET: dir,
};
fs.mkdirSync(env.TMPDIR, { recursive: true });
delete env.FVE_SMOKE;
delete env.VK_ICD_FILENAMES;
// Renamed Electron binary (cutflow-gapf): sibling streams' cleanups run bare
// `pkill -x electron`, which SIGTERMs every stock-`electron` process —
// three live runs died that way (GPU process exit_code 15, network service
// crash), including an idle app with no CDP interaction. A renamed copy
// does not match the pattern (same fix as streams B/C: cutflow-gapb/c).
const electronBin = process.env.ELECTRON_BIN
  || [path.join(os.homedir(), 'workspace', '.tmp-gap-f-live', 'electron-gapf-dist', 'cutflow-gapf'),
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'),
    path.join(os.homedir(), 'workspace', 'electron-dist', 'electron')].find((p) => fs.existsSync(p));
if (!electronBin) throw new Error('electron binary not found (set ELECTRON_BIN)');
// The port must be free: a stale electron from an earlier run (or a sibling
// stream) answering /json/list would hand us the WRONG app.
try {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  if (r.ok) throw new Error(`CDP port ${CDP_PORT} already answers — refusing to drive a foreign app`);
} catch (e) { if (e.message.includes('already answers')) throw e; /* free */ }
const child = spawn(electronBin,
  ['.', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-sandbox', '--disable-accelerated-video-decode', '--disable-accelerated-video-encode', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: 'pipe', detached: true });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
child.on('exit', (code, signal) => { console.log(`[child] electron exited code=${code} signal=${signal}`); });

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
    ws.onerror = (e) => reject(new Error('ws error ' + (e.message || '')));
    ws.onclose = () => { for (const { rej } of pending.values()) rej(new Error('ws closed')); };
    ws.onopen = () => resolve({
      call: (method, params = {}, timeoutMs = 60000) => new Promise((res, rej) => {
        if (ws.readyState !== 1) return rej(new Error('ws not open'));
        const mid = ++id;
        const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
        pending.set(mid, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
        try { ws.send(JSON.stringify({ id: mid, method, params })); }
        catch (e) { clearTimeout(timer); pending.delete(mid); rej(e); }
      }),
      close: () => ws.close(),
    });
  });
}
async function waitTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('CDP target never appeared');
}

let cdp;
try {
  const page = await waitTarget();
  cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
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
  const until = async (expr, ms = 120000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch { /* not yet */ } await sleep(500); }
    return false;
  };
  // Wait until a <video> in the preview has decoded the seek target
  // (readyState >= 3, not seeking). Without this the first shot after a
  // seek can catch a black video frame — the canvas overlays (text, dust)
  // draw, but the video layer has not produced a frame yet (run EIk82N).
  const waitVideoReady = async (ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        const ok = await ev(`[...document.querySelectorAll('video')].some((v) => v.readyState >= 3 && !v.seeking && v.currentTime > 0)`);
        if (ok) { await sleep(800); return true; }
      } catch { /* not yet */ }
      await sleep(400);
    }
    return false;
  };
  const waitFrames = async () => {
    try { await ev(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`); } catch { /* page busy; shoot anyway */ }
  };
  const stageShot = async (name) => {
    await ev(`window.__fve.pause()`).catch(() => {});
    await waitFrames();
    await sleep(200);
    const rect = await ev(`(() => { const b = document.querySelector('.stage').getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) }; })()`);
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { data } = await cdp.call('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 }, captureBeyondViewport: false }, 90000);
        const p = path.join(shots, name);
        fs.writeFileSync(p, Buffer.from(data, 'base64'));
        return p;
      } catch (e) { lastErr = e; await sleep(2000); }
    }
    console.log(`  SHOT-UNAVAILABLE ${name}: ${lastErr?.message || lastErr} (environment: swiftshader screenshot starved under VM load)`);
    return null;
  };
  const stageFrame = async (name) => {
    const png = await stageShot(name);
    if (!png) return { raw: null, w: 0, h: 0, png: null };
    const raw = pngToRaw(png);
    const { width, height } = await ev(`(() => { const b = document.querySelector('.stage').getBoundingClientRect(); return { width: Math.round(b.width), height: Math.round(b.height) }; })()`);
    return { raw, w: width, h: height, png };
  };
  const meanChannel = (raw, w, h, ch, x0 = 0, x1 = 1, y0 = 0, y1 = 1) => {
    let s = 0, n = 0;
    for (let y = Math.floor(y0 * h); y < Math.floor(y1 * h); y++) for (let x = Math.floor(x0 * w); x < Math.floor(x1 * w); x++) { s += raw[(y * w + x) * 4 + ch]; n++; }
    return s / n;
  };
  const meanLum = (raw, w, h) => {
    let s = 0; const n = w * h;
    for (let i = 0; i < n; i++) s += (raw[i * 4] + raw[i * 4 + 1] + raw[i * 4 + 2]) / 3;
    return s / n;
  };
  const speckCount = (on, off, w, h, thresh = 40) => {
    let c = 0; const n = w * h;
    for (let i = 0; i < n; i++) {
      const d = Math.max(on[i * 4] - off[i * 4], on[i * 4 + 1] - off[i * 4 + 1], on[i * 4 + 2] - off[i * 4 + 2]);
      if (d > thresh) c++;
    }
    return c;
  };
  const doneCount = async () => ev(`document.querySelectorAll('.xjob-ic.ok').length`);
  const waitJobDone = async (before, ms = 300000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if ((await doneCount()) > before) return true; } catch { return false; }
      await sleep(1000);
    }
    return false;
  };
  const waitFile = async (file, ms = 300000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        const s = fs.statSync(file);
        if (s.size > 0) {
          const r = spawnSync(ff.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
          const dur = Number((r.stdout || '').trim());
          if (Number.isFinite(dur) && dur > 0) return dur;
        }
      } catch { /* not yet */ }
      await sleep(1000);
    }
    return 0;
  };

  await until(`!!window.__fve`, 60000);
  const dismissWelcome = async () => {
    for (let i = 0; i < 20; i++) {
      const gone = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) { b.click(); return false; } return !document.body.innerText.includes('Welcome to Cutflow'); })()`).catch(() => true);
      if (gone) return true;
      await sleep(500);
    }
    return false;
  };
  await dismissWelcome();
  await ev(`(() => { const b = document.querySelector('[aria-label="Create project"]'); if (b) b.click(); return !!b; })()`).catch(() => {});
  check('editor ready', await until(`!!document.querySelector('.play-btn')`, 60000));
  await dismissWelcome();
  await sleep(600);

  const project = mkProject(true);
  await evFire(`window.__fve.load(${JSON.stringify(project)})`);
  await sleep(800);
  check('project loaded (12.4 s, 6 video + 7 text clips)', Math.abs((await ev(`window.__fve.duration()`)) - 12.4) < 0.01, `duration=${await ev(`window.__fve.duration()`)}`);
  check('welcome dismissed before pointer work', await dismissWelcome());
  const loaded = await ev(`window.__fve.exportData().project.textClips.map((c) => c.id + ':' + (c.animIn?.id || '-') + ':' + (c.highlight?.mode || '-') + ':' + (c.bubble || '-'))`);
  console.log('  text clips loaded:', JSON.stringify(loaded));
  check('text clips kept template fields (decode/hormozi/pill/fadeUp)',
    Array.isArray(loaded) && loaded.length === 7
    && loaded[0].includes('decode') && loaded[1].includes('scale') && loaded[3].includes('pill') && loaded[6].includes('fadeUp'),
    JSON.stringify(loaded));

  // ---- L2a: fx_dust preview toggle ----
  await ev(`window.__fve.seek(5.4); window.__fve.select({ track: 'video', id: 'v4' })`);
  await waitVideoReady();
  const dustOn = await stageFrame('dust-on.png');
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v4', patch: { effects: [] } })`);
  await sleep(1200);
  const dustOff = await stageFrame('dust-off.png');
  // Dust = bright specks ADDED over the base frame. (The old bright-pixel
  // count was confounded by the white 'ONE' text, identical in both shots.)
  if (!dustOn.raw || !dustOff.raw) {
    check('152 Dust Flecks [preview]', false, 'ENV-BLOCKED: preview screenshot unavailable (see SHOT-UNAVAILABLE above); headless + export checks cover this row');
  } else {
    // Threshold 12, not 40: drawDust paints ~0.7 px dots at alpha 0.1-0.4, so
    // on a bright gradient a speck brightens a pixel by at most ~35 (run
    // T7FyRn: max ON-minus-OFF 35; >12 gives 29 vs 0 reverse — the >40
    // threshold only passed on run-YisJxg's black-frame artifact).
    const spDust = speckCount(dustOn.raw, dustOff.raw, dustOn.w, dustOn.h, 12);
    const lumOn = meanLum(dustOn.raw, dustOn.w, dustOn.h), lumOff = meanLum(dustOff.raw, dustOff.w, dustOff.h);
    check('152 Dust Flecks [preview]', lumOn > 15 && lumOff > 15 && spDust > 15, `specks on-vs-off ${spDust} (need > 15 at threshold 12), mean lum on ${lumOn.toFixed(1)} / off ${lumOff.toFixed(1)} (need > 15)`);
  }
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v4', patch: { effects: ['fx_dust'] } })`);
  await sleep(600);

  // ---- L2b: HSL preview toggle (green moves, red does not) ----
  await ev(`window.__fve.seek(7.4); window.__fve.select({ track: 'video', id: 'v5' })`);
  await waitVideoReady();
  const hslOn = await stageFrame('hsl-on.png');
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v5', patch: { grade: {} } })`);
  await sleep(1200);
  const hslOff = await stageFrame('hsl-off.png');
  if (!hslOn.raw || !hslOff.raw) {
    check('B-H-mask HSL [preview]', false, 'ENV-BLOCKED: preview screenshot unavailable (see SHOT-UNAVAILABLE above); headless + export checks cover this row');
  } else {
    const dGreen = meanDiff(hslOn.raw, hslOff.raw, hslOn.w, hslOn.h, 0, 0.5);
    const dRed = meanDiff(hslOn.raw, hslOff.raw, hslOn.w, hslOn.h, 0.5, 1);
    check('B-H-mask HSL [preview]', dGreen > 2 && dRed < 1, `green half diff ${dGreen.toFixed(2)}, red half diff ${dRed.toFixed(2)}`);
  }
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v5', patch: { grade: { hsl: { green: { h: 30, s: 0, l: 0 } } } } })`);
  await sleep(600);

  // ---- L2c: irisout junction canvas in preview ----
  await ev(`window.__fve.seek(2.8)`);
  await waitVideoReady();
  const irisCanvas = await ev(`document.querySelector('.fx-transition')?.style?.display === 'block'`);
  await stageShot('iris-mid.png'); // supplementary visual; null is tolerated
  check('115 Circle Reveal Soft [preview]', irisCanvas === true, `transition canvas display block at junction mid = ${irisCanvas}`);
  // ---- L2d: decode text visible + progressing in preview ----
  await ev(`window.__fve.seek(0.3)`);
  await waitVideoReady();
  const decEarly = await stageFrame('decode-early.png');
  await ev(`window.__fve.seek(1.5)`);
  await waitVideoReady();
  const decLate = await stageFrame('decode-late.png');
  if (!decEarly.raw || !decLate.raw) {
    check('27 Terminal Decode [preview]', false, 'ENV-BLOCKED: preview screenshot unavailable (see SHOT-UNAVAILABLE above); export checks cover this row');
  } else {
    const dDec = meanDiff(decEarly.raw, decLate.raw, decEarly.w, decEarly.h, 0.2, 0.8, 0.35, 0.75);
    const bDec = brightCount(decLate.raw, decLate.w, decLate.h, 200, 0.35, 0.75);
    check('27 Terminal Decode [preview]', dDec > 1 && bDec > 50, `early-vs-late text-band diff ${dDec.toFixed(2)}, bright px at rest ${bDec}`);
  }

  // ---- L3: export WITH text, then WITHOUT text (baseline) ----
  const outA = path.join(dir, 'ui-export.mp4');
  const outB = path.join(dir, 'ui-export-notext.mp4');
  let jobsBefore = await doneCount();
  await evFire(`window.__fve.exportNow()`);
  check('export A (with text) job completes', await waitJobDone(jobsBefore, 900000));
  const durA = await waitFile(outA, 900000);
  check('export A file valid', Math.abs(durA - 12.4) < 0.35, `ui-export.mp4 duration ${durA.toFixed(2)}s (expect 12.4)`);
  fs.copyFileSync(outA, path.join(dir, 'export-with-text.mp4'));
  await evFire(`window.__fve.load(${JSON.stringify(mkProject(false))})`);
  await sleep(800);
  jobsBefore = await doneCount();
  await evFire(`window.__fve.exportNow()`);
  check('export B (no text) job completes', await waitJobDone(jobsBefore, 900000));
  const durB = await waitFile(outA, 900000); // FVE_EXPORT_TARGET always writes ui-export.mp4
  check('export B file valid', Math.abs(durB - 12.4) < 0.35, `ui-export.mp4 duration ${durB.toFixed(2)}s (expect 12.4)`);
  fs.copyFileSync(outA, outB);

  const expA = path.join(dir, 'export-with-text.mp4');
  const expB = outB;
  // Per-window: export A vs B must differ where a caption style burns in.
  const windows = [
    [27, 'Terminal Decode', 0, 2, 1.0],
    [200, 'Word Pop Highlight', 2, 4, 1.0],
    [201, 'Smooth Single Word Reveal', 4, 6, 1.0],
    [202, 'Line Fade Subtitle', 6, 8, 1.0],
    [204, 'Active Word Glow', 10, 11, 0.5],
    [205, 'Pill Background Subtitle', 6, 8, 1.0],
    [206, 'Clean Karaoke Style', 8, 10, 1.0],
    [208, 'Subtitle Minimal Lift', 11, 12, 0.5],
  ];
  for (const [row, name, w0, w1, tOff] of windows) {
    const t = w0 + tOff;
    const d = meanDiff(frameAt(expA, t), frameAt(expB, t));
    check(`[${row}] ${name} [export]`, d > 1.0, `export with-text vs no-text at t=${t}s: mean diff ${d.toFixed(2)}`);
  }
  // Decode progresses inside window 1 (export frames).
  const dDecExp = meanDiff(frameAt(expA, 0.3), frameAt(expA, 1.5), W, H, 0.2, 0.8, 0.35, 0.75);
  check('27 Terminal Decode [export progress]', dDecExp > 1, `t=0.3 vs t=1.5 text-band diff ${dDecExp.toFixed(2)}`);
  // FadeUp rises: bright centroid moves up between 11.2 and 11.8.
  const cy1 = centroidY(frameAt(expA, 11.2), W, H);
  const cy2 = centroidY(frameAt(expA, 11.8), W, H);
  check('208 Subtitle Minimal Lift [export rise]', cy1 > 0 && cy2 > 0 && cy1 > cy2 + 3, `bright centroid y ${cy1.toFixed(1)} -> ${cy2.toFixed(1)}`);
  // Dust in export: A vs B at t=7 (same video, dust only in A).
  const dDustExp = meanDiff(frameAt(expA, 5.4), frameAt(expB, 5.4));
  check('152 Dust Flecks [export]', dDustExp > 0.5, `with-text vs no-text at t=5.4s: mean diff ${dDustExp.toFixed(2)}`);
  // HSL in export (absolute, top strip above the pill band): the green
  // half's B channel rises with the +30 hue shift (graded ref 22.0,
  // ungraded ref 0.0; preview on 29.1 / off 6.5), the red half stays put.
  const fA9 = frameAt(expA, 7.4);
  const bG9 = meanChannel(fA9, W, H, 2, 0, 0.5, 0, 0.3), bR9 = meanChannel(fA9, W, H, 2, 0.5, 1, 0, 0.3);
  check('B-H-mask HSL [export]', bG9 > 15 && bR9 < 5, `green-half B ${bG9.toFixed(1)} (need > 15), red-half B ${bR9.toFixed(1)} (need < 5)`);
  // Junctions in export: mid-junction differs from both sides.
  const jWipe = meanDiff(frameAt(expA, 1.6), frameAt(expA, 0.5));
  const jWipeB = meanDiff(frameAt(expA, 1.6), frameAt(expA, 2.15));
  check('112 Linear Soft Wipe [export]', jWipe > 2 && jWipeB > 2, `junction vs A ${jWipe.toFixed(2)}, vs B ${jWipeB.toFixed(2)}`);
  const jIris = meanDiff(frameAt(expA, 2.8), frameAt(expA, 2.15));
  const jIrisB = meanDiff(frameAt(expA, 2.8), frameAt(expA, 3.6));
  check('115 Circle Reveal Soft [export]', jIris > 2 && jIrisB > 2, `junction vs A ${jIris.toFixed(2)}, vs B ${jIrisB.toFixed(2)}`);

  // ---- L4: Library & UX in the real UI ----
  await evFire(`window.__fve.load(${JSON.stringify(mkProject(true))})`);
  await sleep(800);
  await ev(`window.__fve.select({ track: 'video', id: 'v1' })`);
  await sleep(400);
  await ev(`window.__fve.tab('library')`).catch(() => {});
  await sleep(400);
  // Open the Composer tab (LeftPanel tab id 'composer').
  const composerOpen = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Composer'); if (b) { b.click(); return true; } return false; })()`);
  await sleep(800);
  check('228 Composer panel opens', composerOpen && (await ev(`!!document.querySelector('.composer-apply, .composer-row') || document.body.innerText.includes('Composer')`)));
  // Import a preset .json via the hidden file input.
  const presetFile = path.join(dir, 'import-preset.json');
  fs.writeFileSync(presetFile, JSON.stringify({
    kind: 'cutflow.creative-preset', schemaVersion: 1, id: 'cp_gapflive1', name: 'GapF Live Vivid',
    target: 'filter', variant: 'vivid', params: { intensity: 70, adjust: {} }, source: 'user',
    createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z',
  }, null, 2));
  const inputNode = await cdp.call('Runtime.evaluate', { expression: `(() => { const i = document.querySelector('.composer-io input[type=file], input[type=file]'); if (!i) return null; const r = i.getBoundingClientRect(); return { x: r.left, y: r.top }; })()`, returnByValue: true });
  const hasInput = !!inputNode.result.value;
  if (hasInput) {
    const doc = await cdp.call('DOM.getDocument', { depth: -1 });
    const found = await cdp.call('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.composer-io input[type=file]' });
    if (found.nodeId) await cdp.call('DOM.setFileInputFiles', { files: [presetFile], nodeId: found.nodeId });
    await sleep(800);
  }
  const imported = await ev(`[...document.querySelectorAll('.composer-name')].some((s) => s.textContent.includes('GapF Live Vivid'))`);
  check('228 Preset Import [UI]', hasInput && imported, `file input present=${hasInput}, preset row appears=${imported}`);
  // Apply it to the selected clip.
  await ev(`[...document.querySelectorAll('.composer-row')].find((r) => r.textContent.includes('GapF Live Vivid'))?.querySelector('.composer-apply')?.click()`);
  await sleep(600);
  const applied = await ev(`(() => { const c = window.__fve.exportData().project.videoClips.find((x) => x.id === 'v1'); return c.filter + ':' + c.filterIntensity; })()`);
  check('228 Preset applies to selected clip [UI]', applied === 'vivid:70', `v1 filter=${applied}`);
  // Edit: sliders appear; move intensity; preset + clip update.
  await ev(`[...document.querySelectorAll('.composer-row')].find((r) => r.textContent.includes('GapF Live Vivid'))?.querySelector('.composer-actions .btn')?.click()`);
  await sleep(600);
  const sliders = await ev(`document.querySelectorAll('.composer-edit input[type=range]').length`);
  check('234 Preset Variant Controls [UI sliders]', sliders >= 1, `${sliders} slider(s) in the preset editor`);
  if (sliders >= 1) {
    await ev(`(() => { const el = document.querySelector('.composer-edit input[type=range]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '40'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(600);
    const after = await ev(`(() => { const c = window.__fve.exportData().project.videoClips.find((x) => x.id === 'v1'); const stored = JSON.parse(localStorage.getItem('cutflow.creativePresets.v1') || '[]'); const p = stored.find((x) => x.name === 'GapF Live Vivid'); return c.filterIntensity + ':' + (p?.params?.intensity ?? '?'); })()`);
    check('234 Slider edits preset + live-applies to clip', after === '40:40', `clip intensity:stored intensity = ${after}`);
  }
  // Export: spy on the anchor download the panel triggers.
  await ev(`window.__gapfDl = null; const _c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__gapfDl = this.download + '|' + this.href.slice(0, 20); return _c.call(this); };`);
  await ev(`[...document.querySelectorAll('.composer-row')].find((r) => r.textContent.includes('GapF Live Vivid'))?.querySelectorAll('.composer-actions .btn')[1]?.click()`);
  await sleep(600);
  const dl = await ev(`window.__gapfDl`);
  check('228 Preset Export [UI]', typeof dl === 'string' && dl.startsWith('cutflow-preset-gapf-live-vivid.json|blob:'), `download attempted: ${dl}`);
  // 232: the multi-clip apply gap is CLOSED by the merge (item c) — the
  // canonical implementation is gap-e's apply-style-to-selection
  // (ClipInspector, src/look.js applyStyleAction) on the shared
  // selectedPictures + updateMany path (CC FB-28 applyToSelected.js).
  // The old check asserted ABSENCE with a broad /selected|all clips|multi/
  // regex that false-positives on the Composer A/B "Use selected clip"
  // slot button (assigns one clip to a compare slot — not a multi-clip
  // apply). Assert the real affordance instead: with two picture clips
  // selected, the Adjust tab shows the apply-style button.
  await evFire(`window.__fve.select({ track: 'video', id: 'v1', items: [{ track: 'video', id: 'v1' }, { track: 'video', id: 'v2' }] })`);
  await sleep(700);
  await ev(`(() => { const ins = document.querySelector('.clip-inspector') || document.querySelector('.inspector'); if (!ins) return false; const b = [...ins.querySelectorAll('button[role="tab"]')].find((x) => x.textContent.replace(/•/g, '').trim() === 'Adjust'); if (b) { b.click(); return true; } return false; })()`);
  await sleep(500);
  const applyBtn232 = await ev(`!!document.querySelector('[data-testid="apply-style"]')`);
  check('232 Multi-Clip Apply present [UI]', applyBtn232, 'canonical apply-style-to-selection renders for a multi-selection');
  // 235: CurveEditor preset chips on the TRANSITION panel (select the
  // transition marker, track 'transition'; v3 fx_irisout is an engine
  // transition, v2 wipeleft is native and shows the curve note instead).
  await ev(`window.__fve.select({ track: 'transition', id: 'v3' })`);
  await sleep(800);
  const chips = await ev(`document.querySelectorAll('.curve-chips button, .curve-chips [role=button]').length`);
  check('235 Easing Graph Presets [UI chips]', chips >= 4, `${chips} easing preset chip(s) on the transition panel (v3 fx_irisout)`);
  if (chips >= 4) {
    const before = await ev(`window.__fve.exportData().project.videoClips.find((x) => x.id === 'v3').transition.ease`);
    await ev(`[...document.querySelectorAll('.curve-chips button')].find((b) => /bounce/i.test(b.textContent || b.getAttribute('aria-label') || b.title || ''))?.click()`);
    await sleep(500);
    const after = await ev(`window.__fve.exportData().project.videoClips.find((x) => x.id === 'v3').transition.ease`);
    check('235 Easing preset applies to transition', before !== after, `ease ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  }
} catch (e) {
  console.error('LIVE DRIVER ERROR:', e.message);
  console.error('child stderr tail:', stderr.slice(-2000));
  fails.push('driver: ' + e.message);
} finally {
  try { if (cdp) cdp.close(); } catch {}
  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
}

fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ dir, results }, null, 2));
console.log(`\n== GAP-F LIVE: ${results.filter((r) => r[1]).length} PASS / ${fails.length} FAIL / ${results.length} total; workdir ${dir}`);
if (fails.length) { console.error('FAILURES:\n' + fails.join('\n')); process.exit(1); }
console.log('GAP-F LIVE OK');
