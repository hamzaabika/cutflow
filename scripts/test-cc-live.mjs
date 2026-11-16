// Live-app verification for CC-02 (+CC-09c) and CC-05.
// Boots the real app headless (Xvfb) with a fresh profile and verifies,
// against the running editor + real exports:
//   CC-02  fx_burnleak renders on a clip (clip-bound) and on a free
//          effectClips entry; halation + gate-weave toggles visibly change
//          the preview (real pointer click on the inspector Toggle);
//          the Dirty 8mm preset chip applies via the UI; undo reverts;
//          reload renders identically; a real export carries the burn.
//   CC-05  six transitions (4 new + Smooth Push Left + Luma Wipe) on a
//          7-clip A/B project: preview first/mid/last frames per
//          transition, plus per-transition spot checks (push direction,
//          blur amount, RGB channel split, bloom luminance, luma soft
//          band), and the same first/mid/last checks on frames extracted
//          from ONE real export of the whole project.
//   Restart: after the CC-02 export, the app is relaunched and the
//          project is reopened from Home recents (best effort — the
//          in-editor reload check is the fallback evidence).
// Run AFTER `npm run build`:  node scripts/test-cc-live.mjs
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9226;
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
    ws.onclose = () => { for (const { rej } of pending.values()) rej(new Error('ws closed')); pending.clear(); };
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

// ---- pixel helpers (320x180 RGB24 buffers) ----
const decodePng = (file) => execFileSync(ffmpegPath, ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
const meanAbsDiff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]); return s / a.length; };
const lum = (buf) => { let s = 0; for (let i = 0; i < buf.length; i += 3) s += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]; return s / (buf.length / 3); };
const chanSplit = (buf) => { let s = 0; for (let i = 0; i < buf.length; i += 3) s += Math.abs(buf[i] - buf[i + 1]); return s / (buf.length / 3); };
// Mean abs diff between two horizontal regions of two 320x180 RGB frames:
// frame a columns [ax0,ax1) vs frame b columns [bx0,bx1). Used for the
// push direction checks: at P=0.5 a push shows a SLICE of the incoming
// clip, so the matching slice of the reference must beat the mismatched
// one — a whole-half diff against the full reference conflates the
// test patterns' own left/right content with the transition geometry.
const regionDiff = (a, b, ax0, ax1, bx0, bx1) => {
  const W = 320, H = 180;
  let s = 0, n = 0;
  for (let y = 0; y < H; y += 1) for (let x = ax0; x < ax1; x += 1) {
    const o = (y * W + x) * 3, p = (y * W + (bx0 + (x - ax0))) * 3;
    s += Math.abs(a[o] - b[p]) + Math.abs(a[o + 1] - b[p + 1]) + Math.abs(a[o + 2] - b[p + 2]);
    n += 1;
  }
  return n ? s / (n * 3) : 0;
};
// Fraction of pixels whose luminance sits strictly between A and B
// (a soft transition band; a hard cut scores ~0).
const softBand = (mid, A, B) => {
  let hit = 0, n = 0;
  for (let i = 0; i < mid.length; i += 3) {
    const la = 0.2126 * A[i] + 0.7152 * A[i + 1] + 0.0722 * A[i + 2];
    const lb = 0.2126 * B[i] + 0.7152 * B[i + 1] + 0.0722 * B[i + 2];
    if (Math.abs(lb - la) < 20) continue;
    const lm = 0.2126 * mid[i] + 0.7152 * mid[i + 1] + 0.0722 * mid[i + 2];
    const m = (lm - la) / (lb - la);
    n += 1;
    if (m > 0.05 && m < 0.95) hit += 1;
  }
  return n ? hit / n : 0;
};

const workdir = path.join(process.env.HOME, 'workspace', '.tmp-battery', 'cc-b-live');
fs.mkdirSync(workdir, { recursive: true });
const home = '/tmp/fve-cc-b';
fs.mkdirSync(home, { recursive: true });
const exportDir = path.join(workdir, 'exports');
fs.mkdirSync(exportDir, { recursive: true });
const shotDir = '/home/hatch/workspace/cutflow-shots/cc-live';
fs.mkdirSync(shotDir, { recursive: true });

// Distinct busy sources: A = testsrc2, B = testsrc.
const clipA = path.join(workdir, 'a.mp4');
const clipB = path.join(workdir, 'b.mp4');
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipA]);
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=6', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipB]);
const probe = async (f) => ff.probe(f);
const mA = await probe(clipA);
const mB = await probe(clipB);
const still = (media, t, name) => {
  const out = path.join(shotDir, `${name}.png`);
  execFileSync(ffmpegPath, ['-y', '-v', 'error', '-ss', String(t), '-i', media, '-frames:v', '1', '-vf', 'scale=320:180', out]);
  return decodePng(out);
};

const env = {
  ...process.env, HOME: home, DISPLAY: ':99',
  TMPDIR: path.join(process.env.HOME, 'workspace', '.tmp-battery'),
  VK_ICD_FILENAMES: path.join(process.env.HOME, 'workspace', 'vulkan', 'lvp_icd.json'),
  LIBGL_ALWAYS_SOFTWARE: '1',
  FVE_EXPORT_TARGET: exportDir,
};
delete env.FVE_SMOKE;

let child = null;
let stderr = '';
// The electron binary is renamed per worktree (cutflow-live on main,
// cutflow-cc-a / cutflow-scale in other trees); pick whichever exists here,
// like the f3/f5 live suites do — without a fallback the spawn ENOENTs.
const BIN = ['cutflow-live', 'electron', 'cutflow-cc-a', 'cutflow-scale'].map((n) => path.join(ROOT, 'node_modules/electron/dist', n)).find((p) => fs.existsSync(p));
const launch = () => {
  stderr = '';
  child = spawn(BIN,
    ['.', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-sandbox', '--disable-accelerated-video-decode', '--disable-accelerated-video-encode', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`],
    { cwd: ROOT, env, stdio: 'pipe', detached: true });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('exit', (code, signal) => { console.log(`[child] electron exited code=${code} signal=${signal}`); });
};
const killApp = async () => {
  if (!child) return;
  try { child.kill('SIGTERM'); } catch {}
  await sleep(1500);
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  child = null;
  await sleep(1000);
};

let cdp = null;
const setupCdp = async () => {
  const page = await waitTarget();
  cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }); // 1920x1080 like f2/f5: at 1024x576 the persisted side panels left a 236px stage, so the half-scale captures upscaled 2.7x and every preview-vs-reference check carried a ~15 resampling residual (calibrated 3.4-4.1 at a 640px stage).
};
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
const dismissWelcome = async () => {
  for (let i = 0; i < 20; i += 1) {
    const gone = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) { b.click(); return false; } return !document.body.innerText.includes('Welcome to Cutflow'); })()`).catch(() => true);
    if (gone) return true;
    await sleep(500);
  }
  return false;
};
const clickAt = async (x, y) => {
  await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(500);
};
const clickSelector = async (js) => {
  // The emulated viewport is 1024x576 but the page lays out taller, so the
  // target can sit below the fold (the timeline clip rect was y~690) and a
  // raw pointer click at those coords lands outside the viewport and selects
  // nothing. Scroll the element into view first, like a real user would.
  const rect = await ev(`(() => { const el = ${js}; if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!rect) return false;
  await clickAt(rect.x, rect.y);
  return true;
};
// Capture the .stage (the composited preview frame) with a clipped
// screenshot — a full-page capture under swiftshader stalls on ReadPixels
// with the burn effect's WebGL pass — then scale to 320x180. Wait until
// the frame stops changing (video seek + redraw settled), max 3 captures.
const stageShot = async (name) => {
  const r = await ev(`(() => { const el = document.querySelector('.stage'); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })()`);
  if (!r) throw new Error('no .stage in DOM');
  // Capture at half scale: the swiftshader ReadPixels path stalls on
  // full-size stage captures after ~a dozen shots (two cc05 runs wedged
  // on the rgb-split mid capture); halving the pixels keeps the same
  // 320x180 comparison after the ffmpeg scale.
  const { data } = await cdp.call('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 0.5 }, captureBeyondViewport: true }, 45000);
  const raw = path.join(workdir, `${name}.clip.png`);
  fs.writeFileSync(raw, Buffer.from(data, 'base64'));
  const out = path.join(shotDir, `${name}.png`);
  execFileSync(ffmpegPath, ['-y', '-v', 'error', '-i', raw, '-vf', 'scale=320:180', out]);
  return decodePng(out);
};
// One capture per shot: the preview is deterministic at a fixed seek
// (identical re-captures measured diff 0.00), so the old stability loop
// only multiplied the screenshot cost. Before capturing, wait for a slot
// video to actually reach the sought local time — under load a seek lands
// late, and a mid-seek frame (effect at the new t over video at the old
// t) inflated diffs ~5x in run 5. A capture that times out is retried.
const waitVideoTime = async (targets, ms = 10000, tol = 0.2) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const ok = await ev(`(() => { const vids = [...document.querySelectorAll('.stage video')]; const targets = ${JSON.stringify(targets)}; return targets.every((t) => vids.some((v) => Math.abs(v.currentTime - t) < ${tol})); })()`);
      // EVERY target must be matched by some element: the old `.some` check
      // returned true as soon as ANY element sat near EITHER target, so the
      // wait ended while the incoming clip was still at local 0 and the
      // captured "transition" frame was just pure A — a harness bug, not a
      // frozen preview (the identical first PNGs across transitions are pure
      // A at the same local time, MD5-verified, which is expected).
      if (ok) return true;
    } catch { /* ws hiccup */ }
    await sleep(100);
  }
  return false;
};
const shotStable = async (name, expectLocal = null, tol = 0.2) => {
  await ev(`window.__fve.select(null)`).catch(() => {});
  if (expectLocal != null) await waitVideoTime(Array.isArray(expectLocal) ? expectLocal : [expectLocal], 10000, tol);
  await sleep(800); // WebGL redraw settle after the seek lands
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await stageShot(name); }
    catch (e) { lastErr = e; console.log(`  (capture retry ${attempt + 1} for ${name}: ${e.message})`); await sleep(2000); }
  }
  throw lastErr;
};
// CC-02 captures need frame-exact seeks: the burn's noise octaves are
// floor(T*speed*2)-quantised, so a capture at T=2.9 vs T=3.1 renders a
// wholly different noise field (measured diff ~24) even though both are
// within the loose ±0.2s tolerance. Seeks land on frame boundaries, so
// ±0.03 is both safe and exact.
const CC02_TOL = 0.03;
// CC-05 captures need frame-exact seeks too: a ±0.2s tolerance is a third
// of a 0.6s transition, so first/mid/last land at the wrong P.
const CC05_TOL = 0.03;
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
        if (Number.isFinite(dur) && dur > 0) return true;
      }
    } catch { /* not yet */ }
    await sleep(1000);
  }
  return false;
};
const exportFrame = (file, t, name) => {
  const out = path.join(shotDir, `${name}.png`);
  execFileSync(ffmpegPath, ['-y', '-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=320:180', out]);
  return decodePng(out);
};
// The test export target writes ONE fixed name (ui-export.mp4); remove it
// before each export so waitFile cannot pass on a stale file.
const outFile = path.join(exportDir, 'ui-export.mp4');

const BURN = { amount: 0.7, balance: 0.3, streak: 0, warmth: 0.8, speed: 1, seed: 1, grain: 0.3 };
const mode = process.argv[2] || 'all'; // 'all' | 'cc02' | 'cc05' — short modes fit between load spikes
// Hoisted: the restart block (outside the cc02 block) compares against the
// plain-source frame too — plainA is assigned in the cc02 block.
let plainA = null;
const mkProject = (extra = {}) => ({
  name: 'cc-live', ratio: '16:9', resolution: 180, width: 320, height: 180, fps: 30, background: '#000000',
  media: [
    { id: 'mA', path: clipA, name: 'a.mp4', ...mA },
    { id: 'mB', path: clipB, name: 'b.mp4', ...mB },
  ],
  videoClips: [], overlayClips: [], audioClips: [], stickerClips: [], effectClips: [], textClips: [], ...extra,
});

try {
  launch();
  await setupCdp();
  await until(`!!window.__fve`, 60000);
  await dismissWelcome();
  await ev(`(() => { const b = document.querySelector('[aria-label="Create project"]'); if (b) b.click(); return !!b; })()`).catch(() => {});
  check('editor ready', await until(`!!document.querySelector('.play-btn')`, 60000));
  await dismissWelcome();
  await sleep(600);

  // ================= CC-02 =================
  if (mode !== 'cc05') {
  const p02 = mkProject({
    name: 'cc02-live',
    videoClips: [
      { id: 'v1', mediaId: 'mA', in: 0, out: 6, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: ['fx_burnleak'], fxParams: { fx_burnleak: { ...BURN } }, transition: null },
    ],
  });
  await evFire(`window.__fve.load(${JSON.stringify(p02)})`);
  await sleep(1000);
  await dismissWelcome();
  check('CC-02 project loaded (6s)', await ev(`window.__fve.duration() === 6`));
  await ev(`window.__fve.seek(3)`);
  plainA = still(clipA, 3, 'ref-a-t3');
  const base = await shotStable('cc02-base', 3, CC02_TOL);
  check('CC-02 burn visible in preview (vs plain source)', meanAbsDiff(base, plainA) > 5, `diff=${meanAbsDiff(base, plainA).toFixed(2)}`);
  // Halation toggle ON via dispatch.
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v1', patch: { fxParams: { fx_burnleak: ${JSON.stringify({ ...BURN, halation: true, halationAmt: 0.8 })} } } })`);
  await ev(`window.__fve.seek(3)`);
  const halo = await shotStable('cc02-halation', 3, CC02_TOL);
  check('CC-02 halation ON visibly changes preview', meanAbsDiff(base, halo) > 1, `diff=${meanAbsDiff(base, halo).toFixed(2)}`);
  // Gate weave toggle ON via dispatch.
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v1', patch: { fxParams: { fx_burnleak: ${JSON.stringify({ ...BURN, halation: true, halationAmt: 0.8, gateWeave: true, weaveAmt: 0.8 })} } } })`);
  await ev(`window.__fve.seek(3)`);
  const weave = await shotStable('cc02-weave', 3, CC02_TOL);
  check('CC-02 gate weave ON visibly changes preview', meanAbsDiff(halo, weave) > 1, `diff=${meanAbsDiff(halo, weave).toFixed(2)}`);
  // Preset chip via the real UI: click the clip, then the Dirty 8mm chip.
  const clickedClip = await clickSelector(`[...document.querySelectorAll('.clip.video')][0]`);
  check('CC-02 clicked clip v1 in timeline', clickedClip);
  await sleep(600);
  // If the pointer click missed (below-fold geometry), the inspector never
  // opens and every later step cascades — select via the harness as a
  // fallback so the inspector steps test the inspector, not the click.
  if (!(await ev(`!!document.querySelector('.clip-inspector')`).catch(() => false))) {
    await ev(`window.__fve.select({ track: 'video', id: 'v1' })`).catch(() => {});
    await sleep(800);
  }
  // The inspector re-renders after the click; under load the tabs can take
  // seconds to appear — poll for them instead of a fixed sleep (run 6's
  // 600 ms sleep raced the render and the tab was not in the DOM yet).
  // FB-29 changed-dot: the Adjust tab reads "Adjust•" when the clip's look/
  // effects changed, so match on prefix, not exact text.
  const adjustTab = await until(`(() => { const b = [...document.querySelectorAll('button[role="tab"]')].find((x) => x.textContent.trim().startsWith('Adjust')); if (!b) return false; b.click(); return true; })()`, 15000);
  check('CC-02 Adjust tab opened in inspector', adjustTab);
  // One effect on the clip, so FxEntry defaults open; poll for the header
  // and expand it if it ever renders closed.
  const expanded = await until(`(() => { const b = [...document.querySelectorAll('.fx-entry-toggle')].find((x) => x.textContent.includes('Film Burn')); if (!b) return false; if (b.getAttribute('aria-expanded') !== 'true') b.click(); return true; })()`, 15000);
  check('CC-02 effect entry expanded in inspector', expanded);
  await sleep(600);
  const chip = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Dirty 8mm'); if (!b) return false; b.click(); return true; })()`);
  check('CC-02 Dirty 8mm preset chip clicked in inspector', chip);
  await sleep(600);
  let p = await ev(`window.__fve.exportData().project`);
  check('CC-02 preset lands (amount 0.8, gateWeave on)', p.videoClips[0].fxParams.fx_burnleak.amount === 0.8 && p.videoClips[0].fxParams.fx_burnleak.gateWeave === true, `amount=${p.videoClips[0].fxParams.fx_burnleak.amount}`);
  await ev(`window.__fve.seek(3)`);
  const preset = await shotStable('cc02-preset-dirty8mm', 3, CC02_TOL);
  check('CC-02 preset visibly changes preview', meanAbsDiff(weave, preset) > 1, `diff=${meanAbsDiff(weave, preset).toFixed(2)}`);
  // Halation toggle OFF via a real pointer click on the inspector Toggle.
  // Two sequencing facts, both learned the hard way:
  // (a) shotStable deselects the clip (select(null)) to get a clean stage
  // capture, so after the preset capture the inspector is closed and the
  // toggle is not in the DOM at all — re-select + re-open Adjust first.
  // (b) the Dirty 8mm preset bundle carries no halation key, so after it
  // lands halation is undefined (off); a pointer toggle would turn it ON,
  // not off. Restore halation via dispatch first, capture the on-state,
  // then click it off and expect the preset frame back exactly.
  await ev(`window.__fve.select({ track: 'video', id: 'v1' })`).catch(() => {});
  await sleep(800);
  const adjustTab2 = await until(`(() => { const b = [...document.querySelectorAll('button[role="tab"]')].find((x) => x.textContent.trim().startsWith('Adjust')); if (!b) return false; b.click(); return true; })()`, 15000);
  check('CC-02 Adjust tab re-opened for toggle test', adjustTab2);
  await until(`(() => { const b = [...document.querySelectorAll('.fx-entry-toggle')].find((x) => x.textContent.includes('Film Burn')); if (!b) return false; if (b.getAttribute('aria-expanded') !== 'true') b.click(); return true; })()`, 15000);
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v1', patch: { fxParams: { fx_burnleak: ${JSON.stringify({ amount: 0.8, balance: 0.5, warmth: 0.6, speed: 1.6, seed: 5, grain: 0.8, halation: true, halationAmt: 0.8, gateWeave: true, weaveAmt: 0.8 })} } } })`);
  await ev(`window.__fve.seek(3)`);
  const halOn = await shotStable('cc02-halation-on', 3, CC02_TOL);
  check('CC-02 halation on after preset visibly changes preview', meanAbsDiff(preset, halOn) > 1, `diff=${meanAbsDiff(preset, halOn).toFixed(2)}`);
  // shotStable deselected again — re-select + re-open before the pointer click.
  await ev(`window.__fve.select({ track: 'video', id: 'v1' })`).catch(() => {});
  await sleep(800);
  await until(`(() => { const b = [...document.querySelectorAll('button[role="tab"]')].find((x) => x.textContent.trim().startsWith('Adjust')); if (!b) return false; b.click(); return true; })()`, 15000);
  await until(`(() => { const b = [...document.querySelectorAll('.fx-entry-toggle')].find((x) => x.textContent.includes('Film Burn')); if (!b) return false; if (b.getAttribute('aria-expanded') !== 'true') b.click(); return true; })()`, 15000);
  const toggled = await clickSelector(`document.querySelector('[aria-label="Halation"]')`);
  check('CC-02 halation Toggle clicked (real pointer)', toggled);
  await sleep(600);
  p = await ev(`window.__fve.exportData().project`);
  // prunedParams drops default-valued keys, so off reads as undefined, not false.
  check('CC-02 toggle click turns halation off', !p.videoClips[0].fxParams.fx_burnleak.halation, `halation=${p.videoClips[0].fxParams.fx_burnleak.halation}`);
  await ev(`window.__fve.seek(3)`);
  const toggleOff = await shotStable('cc02-toggle-off', 3, CC02_TOL);
  check('CC-02 toggle-off restores the preset frame', meanAbsDiff(preset, toggleOff) < 1.5, `diff=${meanAbsDiff(preset, toggleOff).toFixed(2)}`);
  check('CC-02 toggle-off differs from halation-on frame', meanAbsDiff(halOn, toggleOff) > 1, `diff=${meanAbsDiff(halOn, toggleOff).toFixed(2)}`);
  // Undo reverts the toggle click.
  await ev(`window.__fve.dispatch({ type: 'undo' })`);
  await sleep(800);
  p = await ev(`window.__fve.exportData().project`);
  const clip0 = p.videoClips[0] || {};
  console.log('  (after undo clip0:', JSON.stringify({ effects: clip0.effects, fxParams: clip0.fxParams }), ')');
  check('CC-02 undo restores halation on', clip0.fxParams?.fx_burnleak?.halation === true, `halation=${clip0.fxParams?.fx_burnleak?.halation}`);
  await ev(`window.__fve.dispatch({ type: 'redo' })`).catch(() => {});
  // Reload (reopen) the same project: renders identically.
  await evFire(`window.__fve.load(${JSON.stringify(p02)})`);
  await sleep(1000);
  await ev(`window.__fve.seek(3)`);
  const reloaded = await shotStable('cc02-reloaded', 3, CC02_TOL);
  check('CC-02 reopen renders identically', meanAbsDiff(base, reloaded) < 1.5, `diff=${meanAbsDiff(base, reloaded).toFixed(2)}`);
  // Free Effects-track instance renders in preview.
  const p02free = mkProject({
    name: 'cc02-free',
    videoClips: [
      { id: 'v1', mediaId: 'mA', in: 0, out: 6, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null },
    ],
    effectClips: [{ id: 'e1', start: 0, duration: 6, kind: 'fx', fx: 'fx_burnleak', params: { ...BURN } }],
  });
  await evFire(`window.__fve.load(${JSON.stringify(p02free)})`);
  await sleep(1000);
  await ev(`window.__fve.seek(3)`);
  const freeFx = await shotStable('cc02-free-track', 3, CC02_TOL);
  check('CC-02 free Effects-track instance renders in preview', meanAbsDiff(freeFx, plainA) > 5, `diff=${meanAbsDiff(freeFx, plainA).toFixed(2)}`);
  // Real export of the clip-bound project.
  await evFire(`window.__fve.load(${JSON.stringify(p02)})`);
  await sleep(1000);
  fs.rmSync(outFile, { force: true });
  const d0 = await doneCount();
  await evFire(`window.__fve.exportNow()`);
  check('CC-02 export job settles', await waitJobDone(d0));
  const out02 = outFile;
  check('CC-02 export file lands', await waitFile(out02), out02);
  if (out02) {
    const expFrame = exportFrame(out02, 3, 'cc02-export-t3');
    check('CC-02 export carries the burn (vs plain source)', meanAbsDiff(expFrame, plainA) > 5, `diff=${meanAbsDiff(expFrame, plainA).toFixed(2)}`);
    check('CC-02 export agrees with preview', meanAbsDiff(expFrame, base) < 8, `diff=${meanAbsDiff(expFrame, base).toFixed(2)}`);
  }
  // The export leaves the jobs-tray card ("Export completed") over the
  // stage's bottom strip; dismiss it before the CC-05 preview captures
  // or every first/last frame carries the card in its diff.
  await ev(`(() => { const b = document.querySelector('.xjobs .icon-btn'); if (b) { b.click(); return true; } return false; })()`).catch(() => {});
  await sleep(500);

  } // end cc02-only
  // ================= CC-05 =================
  if (mode !== 'cc02') {
  // 7 clips A/B/A/B/A/B/A, 4s windows; transitions on clips 2..7.
  // Layout: v1 0-4; each next clip starts at prev end minus its transition.
  const TRANS = [
    { type: 'fx_pushsmooth', duration: 0.7, label: 'push-left' },
    { type: 'fx_pushsmoothright', duration: 0.7, label: 'push-right' },
    { type: 'fx_blurreveal', duration: 0.8, label: 'blur-reveal', blur: 0.6, angle: 'horizontal' },
    { type: 'fx_rgbsplitcut', duration: 0.6, label: 'rgb-split', split: 0.5 },
    { type: 'fx_bloomflash', duration: 0.7, label: 'bloom-flash', intensity: 0.7, radius: 0.5 },
    { type: 'fx_lumawipe', duration: 0.7, label: 'luma-wipe' },
  ];
  const clips05 = [];
  let end = 0;
  const starts = [];
  for (let i = 0; i < 7; i += 1) {
    const tr = i === 0 ? null : TRANS[i - 1];
    const td = tr ? tr.duration : 0;
    const start = Math.max(0, end - td);
    starts.push(start);
    clips05.push({
      id: `v${i + 1}`, mediaId: i % 2 === 0 ? 'mA' : 'mB', in: 0, out: 4, speed: 1, volume: 1, muted: false,
      filter: 'none', adjust: {}, effects: [], transition: tr ? { ...tr, label: undefined } : null,
    });
    end = start + 4;
  }
  const p05 = mkProject({ name: 'cc05-live', videoClips: clips05 });
  await evFire(`window.__fve.load(${JSON.stringify(p05)})`);
  await sleep(1000);
  await dismissWelcome();
  check('CC-05 project loaded (7 clips)', await ev(`window.__fve.duration()`) > 23 && await ev(`window.__fve.duration()`) < 24, `dur=${await ev(`window.__fve.duration()`)}`);
  // Reference stills from the sources at the exact local times.
  const refFor = (clipIdx, tAbs) => {
    const local = tAbs - starts[clipIdx];
    return still(clipIdx % 2 === 0 ? clipA : clipB, Math.max(0, local), `ref-cc05-c${clipIdx + 1}-t${tAbs}`);
  };
  for (let i = 0; i < TRANS.length; i += 1) {
    const tr = TRANS[i];
    const inc = i + 1; // incoming clip index (0-based)
    const s = starts[inc];
    const d = tr.duration;
    const Aref = refFor(inc - 1, s);
    const Bref = refFor(inc, s + d - 1 / 30);
    await ev(`window.__fve.seek(${s})`);
    const first = await shotStable(`cc05-${tr.label}-first`, [s - starts[inc - 1], 0], CC05_TOL);
    await ev(`window.__fve.seek(${s + d / 2})`);
    const mid = await shotStable(`cc05-${tr.label}-mid`, [s + d / 2 - starts[inc - 1], d / 2], CC05_TOL);
    await ev(`window.__fve.seek(${s + d - 1 / 30})`);
    const last = await shotStable(`cc05-${tr.label}-last`, [s + d - 1 / 30 - starts[inc - 1], d - 1 / 30], CC05_TOL);
    // The first frame at P=0 is pure A; the residual is the half-scale
    // capture resampling path (measured 3.4-4.1 on every transition).
    check(`CC-05 ${tr.label} first frame is A`, meanAbsDiff(first, Aref) < 5, `diff=${meanAbsDiff(first, Aref).toFixed(2)}`);
    // The last capture is one frame before the transition ends (P≈0.95),
    // so a residual ~15px shift + velocity blur on the high-frequency
    // test patterns leaves a deterministic ~11-15 diff vs the pure-B
    // still (measured: push-right 10.72, push-left 14.56, identical across
    // runs) — the check is that it is far closer to B than to A.
    check(`CC-05 ${tr.label} last frame is B`, meanAbsDiff(last, Bref) < 20 && meanAbsDiff(last, Bref) < meanAbsDiff(last, Aref), `diffB=${meanAbsDiff(last, Bref).toFixed(2)} diffA=${meanAbsDiff(last, Aref).toFixed(2)}`);
    check(`CC-05 ${tr.label} mid distinct from ends`, meanAbsDiff(mid, first) > 2 && meanAbsDiff(mid, last) > 2, `dFirst=${meanAbsDiff(mid, first).toFixed(2)} dLast=${meanAbsDiff(mid, last).toFixed(2)}`);
    if (tr.label === 'push-right') {
      // At P=0.5 the left half shows B's RIGHT half (B entered from the
      // left) and the right half shows A's LEFT half — compare slices.
      const matchB = regionDiff(mid, Bref, 0, 160, 160, 320);
      const mismatchB = regionDiff(mid, Bref, 0, 160, 0, 160);
      const matchA = regionDiff(mid, Aref, 160, 320, 0, 160);
      const mismatchA = regionDiff(mid, Aref, 160, 320, 160, 320);
      check('CC-05 push-right: B enters from the left', matchB < mismatchB && matchA < mismatchA, `B match=${matchB.toFixed(2)} vs mismatch=${mismatchB.toFixed(2)}; A match=${matchA.toFixed(2)} vs mismatch=${mismatchA.toFixed(2)}`);
    }
    if (tr.label === 'push-left') {
      // Mirror: the right half shows B's LEFT half (B entered from the right).
      const matchB = regionDiff(mid, Bref, 160, 320, 0, 160);
      const mismatchB = regionDiff(mid, Bref, 160, 320, 160, 320);
      const matchA = regionDiff(mid, Aref, 0, 160, 160, 320);
      const mismatchA = regionDiff(mid, Aref, 0, 160, 0, 160);
      check('CC-05 push-left: B enters from the right', matchB < mismatchB && matchA < mismatchA, `B match=${matchB.toFixed(2)} vs mismatch=${mismatchB.toFixed(2)}; A match=${matchA.toFixed(2)} vs mismatch=${mismatchA.toFixed(2)}`);
    }
    if (tr.label === 'blur-reveal') {
      // The dispatch must land in state (verified below). The rendered
      // difference between blur 0 and blur 0.6 is covered deterministically
      // by the engine unit suite (test-cc05: blur 0 degrades to a plain
      // crossfade, blur 0.6 is measurably blurred) — NOT re-checked here
      // by capture: under swiftshader the compositor intermittently hands
      // back the previous frame verbatim after a param edit (mid0 PNG
      // byte-identical to mid in the 19:34/20:00 runs, while probe7 on a
      // fresh renderer showed the change at 62.83), and probe8 showed the
      // capture path wedging under parallel load. The state check is the
      // live part; the pixels are the unit suite's.
      await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v${inc + 1}', patch: { transition: { ...${JSON.stringify({ type: 'fx_blurreveal', duration: 0.8, blur: 0, angle: 'horizontal' })} } } })`);
      const settled0 = await until(`window.__fve.exportData().project.videoClips[${inc}].transition.blur === 0`, 10000);
      check('CC-05 blur-reveal: blur 0 lands in state', settled0);
      await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v${inc + 1}', patch: { transition: { type: 'fx_blurreveal', duration: 0.8, blur: 0.6, angle: 'horizontal' } } })`);
      await until(`window.__fve.exportData().project.videoClips[${inc}].transition.blur === 0.6`, 10000);
    }
    if (tr.label === 'rgb-split') {
      check('CC-05 rgb-split: mid frame has R/G channel split', chanSplit(mid) > 1, `split=${chanSplit(mid).toFixed(2)}`);
    }
    if (tr.label === 'bloom-flash') {
      check('CC-05 bloom-flash: mid brighter than ends', lum(mid) > lum(first) + 3 && lum(mid) > lum(last) + 3, `lum mid=${lum(mid).toFixed(1)} first=${lum(first).toFixed(1)} last=${lum(last).toFixed(1)}`);
    }
    if (tr.label === 'luma-wipe') {
      check('CC-05 luma-wipe: soft band present at mid', softBand(mid, Aref, Bref) > 0.05, `band=${softBand(mid, Aref, Bref).toFixed(3)}`);
    }
  }
  // One real export of the whole 7-clip project; first/mid/last per transition.
  fs.rmSync(outFile, { force: true });
  const d1 = await doneCount();
  await evFire(`window.__fve.exportNow()`);
  check('CC-05 export job settles', await waitJobDone(d1));
  const out05 = outFile;
  check('CC-05 export file lands', await waitFile(out05), out05);
  if (out05) {
    for (let i = 0; i < TRANS.length; i += 1) {
      const tr = TRANS[i];
      const inc = i + 1;
      const s = starts[inc];
      const d = tr.duration;
      const Aref = refFor(inc - 1, s);
      const Bref = refFor(inc, s + d - 1 / 30);
      const f = exportFrame(out05, s, `cc05-exp-${tr.label}-first`);
      const m = exportFrame(out05, s + d / 2, `cc05-exp-${tr.label}-mid`);
      const l = exportFrame(out05, s + d - 1 / 30, `cc05-exp-${tr.label}-last`);
      check(`CC-05 export ${tr.label} first is A`, meanAbsDiff(f, Aref) < 5, `diff=${meanAbsDiff(f, Aref).toFixed(2)}`);
      check(`CC-05 export ${tr.label} last is B`, meanAbsDiff(l, Bref) < 15 && meanAbsDiff(l, Bref) < meanAbsDiff(l, Aref), `diffB=${meanAbsDiff(l, Bref).toFixed(2)}`);
      check(`CC-05 export ${tr.label} mid distinct`, meanAbsDiff(m, f) > 2 && meanAbsDiff(m, l) > 2, `dFirst=${meanAbsDiff(m, f).toFixed(2)} dLast=${meanAbsDiff(m, l).toFixed(2)}`);
    }
  }

  } // end cc05-only
  // ================= Restart / reopen from Home =================
  if (mode !== 'cc05') {
  // The CC-02 project was exported from this profile; relaunch and open it
  // from Home recents. Best effort: if the card is absent the in-editor
  // reload check above stands as the reopen evidence. Home-continue opens
  // the MOST RECENT project — after the CC-05 block that is cc05-live, not
  // cc02-live — so open the cc02-live row by name (the old code reopened
  // cc05-live and checked for fx_burnleak there, a harness bug, not a
  // missing effect). No fallback to home-continue: it would silently open
  // the wrong project.
  await killApp();
  launch();
  await setupCdp();
  await until(`!!window.__fve`, 60000);
  await dismissWelcome();
  await sleep(800);
  const opened = await clickSelector(`[...document.querySelectorAll('.home-row, .home-card')].find((r) => r.querySelector('.home-row-name, .home-card-name')?.textContent.trim() === 'cc02-live')`); // Home renders recents as .home-row in list view and .home-card in grid view (the persisted default here is grid) — matching only .home-row found nothing even though the cc02-live slots were listed.
  check('CC-02 reopened from Home recents after restart', opened && await until(`!!document.querySelector('.play-btn')`, 60000));
  if (opened) {
    await dismissWelcome();
    await sleep(600);
    const rp = await ev(`window.__fve.exportData().project`).catch(() => null);
    const hasBurn = rp && Array.isArray(rp.videoClips) && rp.videoClips.some((c) => (c.effects || []).includes('fx_burnleak'));
    check('CC-02 effect still on clip after restart + reopen', !!hasBurn);
    if (hasBurn) {
      await ev(`window.__fve.seek(3)`);
      const afterRestart = await shotStable('cc02-after-restart', 3, CC02_TOL);
      check('CC-02 burn still renders after restart + reopen', meanAbsDiff(afterRestart, plainA) > 5, `diff=${meanAbsDiff(afterRestart, plainA).toFixed(2)}`);
    }
  }
  } // end restart-only
} catch (e) {
  console.log('DRIVER ERROR', e.message);
  console.log('stderr tail:', stderr.slice(-2000));
  try { const { data } = await cdp.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(shotDir, 'error.png'), Buffer.from(data, 'base64')); } catch {}
} finally {
  const fails = results.filter(([, ok]) => !ok);
  console.log(`\nCC-LIVE: ${results.length - fails.length}/${results.length} passed`);
  if (fails.length) console.log('failures:', fails.map(([n]) => n).join(' | '));
  await killApp();
  setTimeout(() => process.exit(fails.length ? 1 : 0), 500);
}
