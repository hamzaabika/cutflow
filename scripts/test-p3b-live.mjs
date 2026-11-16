// Live-app check for P3 stream B (P3-03 true morph cut + P3-06 physics
// motion). Boots the real app headless (Xvfb) on CDP port 9227 with a fresh
// profile and verifies, against the running editor:
//   P3-03  Morph Cut selectable; the Transition panel reports a real score
//          and "Warped" for a morphable pair; the preview mid-transition
//          frame matches the CPU morph reference (not a dissolve); a
//          dissimilar pair reports the fallback honestly in the UI.
//   P3-06  the CurveEditor offers the Physics Spring chip + stiffness /
//          damping / mass sliders; the motion-preview dot overshoots past
//          100% and the curve graph rises above the 1.0 line; the Jelly
//          Wobble effect renders in preview matching the CPU reference.
//   Both  the exported file carries the warp (preview vs export parity)
//          and the jelly, measured frame by frame.
// Run AFTER `npm run build`:  node scripts/test-p3b-live.mjs
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9227;
const ff = (await import('../electron/ffmpeg.cjs')).default;
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
    ws.onerror = (e) => reject(new Error('ws error ' + (e.message || '')));
    ws.onclose = () => {
      for (const { rej } of pending.values()) rej(new Error('ws closed'));
      pending.clear();
    };
    ws.onopen = () => resolve({
      call: (method, params = {}) => new Promise((res, rej) => {
        if (ws.readyState !== 1) return rej(new Error('ws not open'));
        const mid = ++id;
        const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)); }, 60000);
        pending.set(mid, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
        try { ws.send(JSON.stringify({ id: mid, method, params })); }
        catch (e) { clearTimeout(timer); pending.delete(mid); rej(e); }
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

const { analyseMorph, renderMorphCPU } = await import('../src/fx/morph.js');
const { runTransition, runEffect } = await import('../src/fx/run.js');
const { transitionExpr } = await import('../src/fx/params.js');
const { PIXEL_EFFECTS } = await import('../src/fx/catalog.js');
const jelly = PIXEL_EFFECTS.find((e) => e.id === 'fx_jelly');

const W = 320; const H = 180; const FPS = 30; const TD = 0.8;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-p3b-'));
const home = '/tmp/p3b-live';
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(path.join(process.env.HOME, 'workspace', '.tmp-p3b'), { recursive: true });

// Fixtures: A = a real photo held 2 s; B = the same photo shifted 8 px (a
// true morph pair); C = a different pattern (the dissimilar pair).
const photo = path.join(ROOT, 'public', 'preview', 'p1015.jpg');
const a = path.join(dir, 'a.mp4');
const b = path.join(dir, 'b.mp4');
const c = path.join(dir, 'c.mp4');
const mid = path.join(dir, 'mid.mp4');
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
gen(['-loop', '1', '-i', photo, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-vf', `scale=${W}:${H}`, '-pix_fmt', 'yuv420p', '-t', '2', a]);
gen(['-i', a, '-vf', `crop=${W - 8}:${H}:8:0,pad=${W}:${H}:0:0`, '-pix_fmt', 'yuv420p', b]);
gen(['-i', a, '-vf', `crop=${W - 4}:${H}:4:0,pad=${W}:${H}:0:0`, '-pix_fmt', 'yuv420p', mid]);
gen(['-f', 'lavfi', '-i', `testsrc=size=${W}x${H}:rate=${FPS}:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2', '-shortest', '-pix_fmt', 'yuv420p', c]);
const mA = await ff.probe(a); const mB = await ff.probe(b); const mC = await ff.probe(c);

const decodeFrames = (file, from, len, w = W, h = H) => {
  const raw = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file,
    '-vf', `trim=start=${from}:duration=${len},setpts=PTS-STARTPTS,fps=${FPS},scale=${w}:${h},format=rgba`,
    '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 28 });
  const size = w * h * 4;
  const frames = [];
  for (let o = 0; o + size <= raw.length; o += size) frames.push(raw.subarray(o, o + size));
  return frames;
};
// Mean abs diff on RGB, downsampled 4x on both sides (the preview canvases
// are read downsampled the same way, so the numbers are comparable).
const meanAbs = (x, y) => {
  let s = 0; let n = 0;
  for (let i = 0; i < x.length; i += 4) { s += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]); n++; }
  return s / n / 3;
};
const down4 = (buf, w, h) => {
  const out = Buffer.alloc(Math.ceil(w / 4) * Math.ceil(h / 4) * 3);
  let o = 0;
  for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) { const i = (y * w + x) * 4; out[o++] = buf[i]; out[o++] = buf[i + 1]; out[o++] = buf[i + 2]; }
  return out;
};
const extractAt = (file, t) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file,
  '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, 'pipe:1'], { maxBuffer: 1 << 28 });

const env = {
  ...process.env, HOME: home, DISPLAY: ':99',
  TMPDIR: path.join(process.env.HOME, 'workspace', '.tmp-p3b'),
  VK_ICD_FILENAMES: path.join(process.env.HOME, 'workspace', 'vulkan', 'lvp_icd.json'),
  LIBGL_ALWAYS_SOFTWARE: '1',
  FVE_EXPORT_TARGET: dir,
};
delete env.FVE_SMOKE;
const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron'),
  ['.', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-sandbox', '--disable-accelerated-video-decode', '--disable-accelerated-video-encode', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: 'pipe', detached: true });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
child.on('exit', (code, signal) => { console.log(`[child] electron exited code=${code} signal=${signal}`); });

const shotDir = '/home/hatch/workspace/cutflow-shots/p3b-live';
fs.mkdirSync(shotDir, { recursive: true });
let cdp;

try {
  const page = await waitTarget();
  cdp = await connect(page.webSocketDebuggerUrl);
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
  const shot = async (name) => {
    const { data } = await cdp.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(shotDir, name), Buffer.from(data, 'base64'));
  };
  const until = async (expr, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch { /* not yet */ } await sleep(500); }
    return false;
  };
  const doneCount = async () => ev(`document.querySelectorAll('.xjob-ic.ok').length`);
  const waitJobDone = async (before, ms = 240000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if ((await doneCount()) > before) return true; } catch { return false; } await sleep(1000); }
    return false;
  };
  const waitFile = async (file, ms = 240000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        const s = fs.statSync(file);
        if (s.size > 0) {
          const r = spawnSync(ff.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
          const dur = Number((r.stdout || '').trim());
          if (Number.isFinite(dur) && dur > 0) return true;
        }
      } catch { /* not yet */ }
      await sleep(1000);
    }
    return false;
  };
  // Read a canvas downsampled 4x as base64 RGB (keeps the CDP payload small).
  const readCanvas = async (selector) => ev(`(() => {
    const c = document.querySelector(${JSON.stringify(selector)});
    if (!c || !c.width) return null;
    const ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, c.width, c.height).data;
    const w = Math.ceil(c.width / 4), h = Math.ceil(c.height / 4);
    const out = new Uint8Array(w * h * 3);
    let o = 0;
    for (let y = 0; y < c.height; y += 4) for (let x = 0; x < c.width; x += 4) { const i = (y * c.width + x) * 4; out[o++] = img[i]; out[o++] = img[i + 1]; out[o++] = img[i + 2]; }
    let bin = '';
    for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
    return { w: c.width, h: c.height, b64: btoa(bin) };
  })()`).then((r) => (r ? { w: r.w, h: r.h, data: Buffer.from(r.b64, 'base64') } : null));

  await until(`!!window.__fve`, 60000);
  const dismissWelcome = async () => {
    for (let i = 0; i < 20; i += 1) {
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

  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const mkProject = (mediaB, secondId) => ({
    name: 'p3b-live', ratio: '16:9', resolution: 180, width: W, height: H, fps: FPS, background: '#000000',
    media: [
      { id: 'm1', path: a, name: 'a.mp4', ...mA },
      { id: secondId, path: mediaB, name: path.basename(mediaB), ...(secondId === 'm2' ? mB : mC) },
    ],
    videoClips: [
      { ...base, id: 'v1', mediaId: 'm1', in: 0, out: 2 },
      { ...base, id: 'v2', mediaId: secondId, in: 0, out: 2, transition: { type: 'fx_morphcut', duration: TD } },
    ],
    overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
  });
  await evFire(`window.__fve.load(${JSON.stringify(mkProject(b, 'm2'))})`);
  await sleep(800);
  check('morph project loaded (3.2 s)', await ev(`window.__fve.duration() === 3.2`));
  check('welcome dismissed before pointer click', await dismissWelcome());

  // ---- P3-03: the Transition panel + morph quality readout ----
  await ev(`window.__fve.select({ track: 'transition', id: 'v2' })`);
  await sleep(600);
  check('Transition panel opens for Morph Cut', await ev(`document.body.innerText.includes('Morph Cut')`));
  check('morph quality pending before play-through', await ev(`document.body.innerText.includes('Play through the transition to analyse the morph.')`));
  // Mid-transition: the window is [2 - TD, 2] = [1.2, 2.0]; P = 0.5 at 1.6.
  await ev(`window.__fve.seek(1.6)`);
  // Wait past the transient "analysis failed" state (first redraw can run
  // before the videos decode — that failure is never cached now, the next
  // redraw re-analyses) to a settled verdict.
  const reportSeen = await until(`document.body.innerText.includes('Score ') && (document.body.innerText.includes('Warped') || document.body.innerText.includes('too different') || document.body.innerText.includes('fast motion'))`, 15000);
  check('morph report appears after seeking into the transition', reportSeen);
  const reportText = await ev(`(() => { const m = document.body.innerText.match(/Score \\d+%[^\\n]*/); return m ? m[0] : document.body.innerText.slice(0, 200); })()`);
  const score = Number((reportText.match(/Score (\d+)%/) || [])[1]);
  check('morph report says Warped (not fallback) with score > 45%', reportText.includes('Warped') && score > 45, reportText);
  await shot('01-morph-panel.png');

  // ---- P3-03: the preview frame is a warp, not a dissolve ----
  const trVisible = await until(`(() => { const c = document.querySelector('.fx-transition'); return c && c.style.display === 'block' && c.width > 0; })()`, 15000);
  check('transition canvas renders in preview', trVisible);
  await sleep(800); // let the seeked videos + GL draw settle
  const prev = await readCanvas('.fx-transition');
  check('preview transition frame readable', !!prev, prev ? `${prev.w}x${prev.h}` : 'null');
  if (prev) {
    const fa = decodeFrames(a, 0, 0.1, prev.w, prev.h)[0];
    const fb = decodeFrames(b, 0, 0.1, prev.w, prev.h)[0];
    const analysis = analyseMorph(fa, fb, prev.w, prev.h);
    const morphRef = new Uint8ClampedArray(prev.w * prev.h * 4);
    renderMorphCPU(fa, fb, morphRef, prev.w, prev.h, 0.5, analysis.flow, analysis.gw, analysis.gh, 1);
    const disRef = new Uint8ClampedArray(prev.w * prev.h * 4);
    runTransition(fa, fb, disRef, prev.w, prev.h, 0.5, transitionExpr({ type: 'dissolve' }));
    // The warp midpoint for this rigid 8 px shift is the photo shifted 4 px
    // — a hash-independent warp proof (the GL and CPU dither dissolves use
    // effectively independent hash patterns, so the dissolve comparison
    // alone cannot separate a warp from a dissolve here). The flow is not
    // perfectly uniform on a real photo (flat blocks match at 0), so the
    // midpoint is approximate: < 12 separates it from the dissolve (~18).
    const midRef = decodeFrames(mid, 0, 0.1, prev.w, prev.h)[0];
    const vsMorph = meanAbs(prev.data, down4(morphRef, prev.w, prev.h));
    const vsMid = meanAbs(prev.data, down4(midRef, prev.w, prev.h));
    const vsDis = meanAbs(prev.data, down4(disRef, prev.w, prev.h));
    console.log(`preview mid-frame: vs morph ref ${vsMorph.toFixed(2)}, vs 4px-shift warp midpoint ${vsMid.toFixed(2)}, vs dissolve ref ${vsDis.toFixed(2)} (analysis score ${analysis.score.toFixed(2)})`);
    check('preview mid-frame matches the morph reference', vsMorph < 8, `mean abs ${vsMorph.toFixed(2)}`);
    check('preview mid-frame is the warp midpoint (4 px shift)', vsMid < 12, `mean abs ${vsMid.toFixed(2)}`);
    check('preview mid-frame is a warp, not a dissolve', vsDis > vsMorph, `dissolve ${vsDis.toFixed(2)} vs morph ${vsMorph.toFixed(2)}`);
  }

  // ---- P3-06: spring physics in the CurveEditor ----
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v2', patch: { transition: { type: 'fx_morphcut', duration: ${TD}, ease: 'springPhysics' } } })`);
  await sleep(800);
  const inspText = await ev(`document.body.innerText`);
  check('Physics Spring chip renders', inspText.includes('Physics Spring'), 'chip label present');
  check('spring param sliders render', inspText.includes('Stiffness') && inspText.includes('Damping') && inspText.includes('Mass'), 'stiffness/damping/mass labels');
  // The curve graph must rise above the 1.0 line (overshoot): the graph maps
  // value 1.0 to y = 72 - 1.4 * (68 / 1.85) = 20.54 in its viewBox; the
  // spring path's minimum y must sit above that line (smaller svg y).
  const overshoot = await ev(`(() => {
    const path = document.querySelector('svg.curve-graph path.curve-line');
    if (!path) return null;
    const ys = [...path.getAttribute('d').matchAll(/,([\\d.]+)/g)].map((m) => Number(m[1]));
    return { minY: Math.min(...ys), yAt1: 72 - 1.4 * (68 / 1.85) };
  })()`);
  check('spring curve graph overshoots the 1.0 line', !!overshoot && overshoot.minY < overshoot.yAt1, overshoot ? `minY=${overshoot.minY.toFixed(1)} y(1.0)=${overshoot.yAt1.toFixed(1)}` : 'no graph path');
  // The motion-preview dot must travel past 100% while playing. The dot is
  // driven by rAF, which the hidden-window rig throttles to ~1 Hz, so the
  // pass is sampled over 8 s (several 900 ms passes) to catch a tick inside
  // the overshoot window; the graph path above is the deterministic proof.
  await ev(`(() => { const b = document.querySelector('.curve-play'); if (b) b.click(); return !!b; })()`);
  let dotMax = 0;
  for (let i = 0; i < 80; i += 1) {
    const left = await ev(`(() => { const d = document.querySelector('.curve-dot:not(.ghost)'); if (!d) return 0; return Number((d.style.left || '0%').replace('%', '')); })()`).catch(() => 0);
    dotMax = Math.max(dotMax, left);
    await sleep(100);
  }
  await ev(`(() => { const b = document.querySelector('.curve-play'); if (b && b.classList.contains('on')) b.click(); return true; })()`).catch(() => {});
  check('spring motion-preview dot overshoots past 100%', dotMax > 100, `max left ${dotMax.toFixed(1)}%`);
  await shot('02-spring-curve.png');
  // Back to a linear ease so the export below compares against the P=0.5 reference.
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v2', patch: { transition: { type: 'fx_morphcut', duration: ${TD} } } })`);
  await sleep(500);

  // ---- P3-06: jelly wobble renders in preview, matching the CPU reference ----
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v1', patch: { effects: ['fx_jelly'] } })`);
  await sleep(500);
  await ev(`window.__fve.seek(0.3)`);
  const keyedVisible = await until(`(() => { const cs = [...document.querySelectorAll('.slot .keyed')]; return cs.some((c) => c.style.display === 'block' && c.width > 0); })()`, 15000);
  check('jelly-processed frame shows in the keyed canvas', keyedVisible);
  await sleep(800);
  const jellyPrev = await ev(`(() => {
    const cs = [...document.querySelectorAll('.slot .keyed')].filter((c) => c.style.display === 'block' && c.width > 0);
    if (!cs.length) return null;
    const c = cs[0];
    const ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, c.width, c.height).data;
    const w = Math.ceil(c.width / 4), h = Math.ceil(c.height / 4);
    const out = new Uint8Array(w * h * 3);
    let o = 0;
    for (let y = 0; y < c.height; y += 4) for (let x = 0; x < c.width; x += 4) { const i = (y * c.width + x) * 4; out[o++] = img[i]; out[o++] = img[i + 1]; out[o++] = img[i + 2]; }
    let bin = '';
    for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
    return { w: c.width, h: c.height, b64: btoa(bin) };
  })()`).then((r) => (r ? { w: r.w, h: r.h, data: Buffer.from(r.b64, 'base64') } : null));
  check('jelly preview frame readable', !!jellyPrev, jellyPrev ? `${jellyPrev.w}x${jellyPrev.h}` : 'null');
  if (jellyPrev) {
    const src = decodeFrames(a, 0.3, 0.1, jellyPrev.w, jellyPrev.h)[0];
    const ref = new Uint8Array(jellyPrev.w * jellyPrev.h * 4);
    runEffect(src, ref, jellyPrev.w, jellyPrev.h, 0.3, jelly.expr);
    const vsRef = meanAbs(jellyPrev.data, down4(ref, jellyPrev.w, jellyPrev.h));
    const vsPlain = meanAbs(jellyPrev.data, down4(src, jellyPrev.w, jellyPrev.h));
    console.log(`jelly preview at T=0.3: vs CPU ref ${vsRef.toFixed(2)}, vs plain frame ${vsPlain.toFixed(2)}`);
    check('jelly preview matches the CPU reference', vsRef < 8, `mean abs ${vsRef.toFixed(2)}`);
    check('jelly preview is deformed, not the plain frame', vsPlain > 1, `mean abs ${vsPlain.toFixed(2)}`);
  }
  await shot('03-jelly-preview.png');

  // ---- Export: warp + jelly survive, preview vs export parity ----
  const outFile = path.join(dir, 'ui-export.mp4');
  const d0 = await doneCount();
  await evFire(`window.__fve.exportNow()`);
  check('export job settles', await waitJobDone(d0));
  check('export file lands', await waitFile(outFile), outFile);
  const info = await ff.probe(outFile);
  check('export duration ~3.2 s', Math.abs(info.duration - 3.2) < 0.2, `${info.duration.toFixed(2)} s`);
  const expMid = extractAt(outFile, 1.6);
  if (prev) {
    const vsPrev = meanAbs(down4(expMid, W, H), prev.data);
    console.log(`export mid-frame vs preview mid-frame: ${vsPrev.toFixed(2)}`);
    check('export mid-frame matches the preview frame', vsPrev < 8, `mean abs ${vsPrev.toFixed(2)}`);
    const midRef = decodeFrames(mid, 0, 0.1, prev.w, prev.h)[0];
    const vsMid = meanAbs(down4(expMid, W, H), down4(midRef, prev.w, prev.h));
    check('export mid-frame is the warp midpoint (4 px shift)', vsMid < 12, `mean abs ${vsMid.toFixed(2)}`);
    const fa = decodeFrames(a, 0, 0.1, prev.w, prev.h)[0];
    const fb = decodeFrames(b, 0, 0.1, prev.w, prev.h)[0];
    const disRef = new Uint8ClampedArray(prev.w * prev.h * 4);
    runTransition(fa, fb, disRef, prev.w, prev.h, 0.5, transitionExpr({ type: 'dissolve' }));
    const vsDis = meanAbs(down4(expMid, W, H), down4(disRef, prev.w, prev.h));
    check('export mid-frame is a warp, not a dissolve', vsDis > vsMid, `dissolve ${vsDis.toFixed(2)} vs warp midpoint ${vsMid.toFixed(2)}`);
  }
  if (jellyPrev) {
    const expJelly = extractAt(outFile, 0.3);
    const src = decodeFrames(a, 0.3, 0.1, jellyPrev.w, jellyPrev.h)[0];
    const ref = new Uint8Array(jellyPrev.w * jellyPrev.h * 4);
    runEffect(src, ref, jellyPrev.w, jellyPrev.h, 0.3, jelly.expr);
    const vsRef = meanAbs(down4(expJelly, W, H), down4(ref, jellyPrev.w, jellyPrev.h));
    console.log(`export jelly frame at t=0.3: vs CPU ref ${vsRef.toFixed(2)}`);
    check('export jelly frame matches the CPU reference', vsRef < 8, `mean abs ${vsRef.toFixed(2)}`);
  }

  // ---- P3-03 fallback, live in the UI: dissimilar pair ----
  await evFire(`window.__fve.load(${JSON.stringify(mkProject(c, 'm3'))})`);
  await sleep(800);
  check('dissimilar project loaded (3.2 s)', await ev(`window.__fve.duration() === 3.2`));
  await ev(`window.__fve.select({ track: 'transition', id: 'v2' })`);
  await sleep(600);
  await ev(`window.__fve.seek(1.6)`);
  const fbSeen = await until(`document.body.innerText.includes('Fell back to dissolve')`, 15000);
  check('dissimilar pair reports the fallback in the UI', fbSeen);
  const fbText = await ev(`(() => { const m = document.body.innerText.match(/Score \\d+%[^\\n]*/); return m ? m[0] : ''; })()`);
  check('fallback reason is "too different"', fbText.includes('too different'), fbText);
  await shot('04-dissimilar-fallback.png');
} catch (e) {
  console.log('DRIVER ERROR', e.message);
  console.log('stderr tail:', stderr.slice(-2000));
  try { const { data } = await cdp.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(shotDir, 'error.png'), Buffer.from(data, 'base64')); } catch {}
} finally {
  const fails = results.filter(([, ok]) => !ok);
  console.log(`\nP3B-LIVE: ${results.length - fails.length}/${results.length} passed`);
  if (fails.length) console.log('failures:', fails.map(([n]) => n).join(' | '));
  try { child.kill('SIGTERM'); } catch {}
  setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} process.exit(fails.length ? 1 : 0); }, 1500);
}
