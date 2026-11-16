// Live verification for P2 stream E (P2-37 workspaces, P2-38 bidi, P2-39
// a11y, P2-41 semantic search, P2-42 reframe) in the real dev app on CDP
// 9230 with a fresh profile. Run AFTER `npm run build`:
//   node scripts/test-p2e-live.mjs
// Screenshots land in <TMP>/shots/ for visual inspection of the bidi
// render and the high-DPI layout.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9230;
const TMP = path.join(ROOT, '.tmp-p2e-live');
const HOME = '/tmp/fve-p2-e';
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(path.join(TMP, 'shots'), { recursive: true });
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
      // Long-timeout variant: an export settles minutes after it starts
      // (the hidden-window canvas renders ~1 frame/s), so the settle wait
      // needs a timeout the 60 s default cannot give.
      callLong: (method, params = {}, ms = 600000) => new Promise((res, rej) => {
        const mid = ++id;
        const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)); }, ms);
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

// ---- fixtures ----
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
// Talking-head scene: the public-domain Obama portrait (same fixture as
// test-reframe-detect.cjs) on a black canvas, 6 s.
const portrait = path.join(TMP, 'portrait.jpg');
if (!fs.existsSync(portrait)) {
  const res = await fetch('https://upload.wikimedia.org/wikipedia/commons/8/8d/President_Barack_Obama.jpg');
  if (!res.ok) throw new Error('portrait download failed');
  fs.writeFileSync(portrait, Buffer.from(await res.arrayBuffer()));
}
const scene = path.join(TMP, 'scene.mp4');
if (!fs.existsSync(scene)) {
  gen(['-loop', '1', '-i', portrait, '-f', 'lavfi', '-i', 'color=c=black:s=854x720:r=30:d=6',
    '-filter_complex', '[0:v]scale=-2:720[p];[1:v][p]overlay=140:0:shortest=1[out]', '-map', '[out]', '-t', '6', '-pix_fmt', 'yuv420p', scene]);
}
const mkClip = (name, color) => {
  const p = path.join(TMP, name);
  if (!fs.existsSync(p)) gen(['-f', 'lavfi', '-i', `color=c=${color}:s=640x360:r=30:d=6`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-shortest', '-pix_fmt', 'yuv420p', p]);
  return p;
};
const beachClip = mkClip('beach drone sunset.mp4', '0x2a6f8f');
const interviewClip = mkClip('مقابلة مع خالد.mp4', '0x8f6f2a');
const cityClip = mkClip('city night drive.mp4', '0x222233');
const textClip = mkClip('slides text heavy.mp4', '0xf5efe0');
const probe = async (p) => ({ ...(await ff.probe(p)), path: p });

const env = {
  ...process.env, HOME, DISPLAY: ':99', TMPDIR: TMP,
  VK_ICD_FILENAMES: path.join(process.env.HOME, 'workspace/vulkan/lvp_icd.json'),
  FVE_EXPORT_TARGET: TMP,
};
// First-run flags seeded as seen (same pattern as the other live suites).
fs.mkdirSync(path.join(HOME, '.config'), { recursive: true });
// Fresh profile per run (the HOME scratch is this stream's own): wipe the
// renderer's Local Storage so workspace/index defaults are tested from
// clean state.
// Face model: the app downloads it on first reframe via Electron's net.fetch,
// which fails TLS on this VM — seed it here with node fetch, through the
// app's own install + sha256 verification, so the face-mode flow is testable.
// (Centre mode needs no model at all since P2-42's skip; this is only for
// REFRAME_MODE=face runs.)
const modelDir = path.join(HOME, '.config', 'ClipCraft', 'reframe');
const reframeMod = require('../electron/reframe.cjs');
if (!reframeMod.status(modelDir).installed) await reframeMod.install(modelDir, () => {});
fs.rmSync(path.join(HOME, '.config', 'ClipCraft', 'Local Storage'), { recursive: true, force: true });
fs.rmSync(path.join(TMP, 'ui-export.mp4'), { force: true });
const logFile = path.join(TMP, 'electron-p2e.log');
const logFd = fs.openSync(logFile, 'w');
const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron'),
  ['.', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: ['ignore', logFd, logFd], detached: true });
console.log(`electron pid ${child.pid} (log: ${logFile})`);

let cdp;
try {
  const page = await waitTarget();
  cdp = await connect(page.webSocketDebuggerUrl);
  const ev = async (expr) => {
    const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page exception: ${JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text)}`);
    return r.result.value;
  };
  const until = async (expr, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(300); }
    return false;
  };
  const shot = async (name) => {
    const r = await cdp.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(TMP, 'shots', name), Buffer.from(r.data, 'base64'));
    console.log(`  shot: shots/${name}`);
  };

  await sleep(2500);
  await ev(`(() => { const b = document.querySelector('.welcome-go'); if (b) b.click(); return !!b; })()`);
  await ev(`(() => { const b = document.querySelector('.home-create'); if (b) b.click(); return !!b; })()`);
  check('editor entered', await until(`!!document.querySelector('.play-btn')`, 20000));
  // The first-run Welcome card fires on first project entry, a beat after
  // the flags load — dismiss it whenever it shows, before driving the editor.
  const dismissWelcome = async () => {
    for (let i = 0; i < 20; i += 1) {
      if (await ev(`(() => { const b = document.querySelector('.welcome-go'); if (b) { b.click(); return true; } return false; })()`)) return true;
      await sleep(250);
    }
    return false;
  };
  await dismissWelcome();

  // ---- project: scene (talking head) + text-heavy slides + search media ----
  const project = {
    name: 'P2E check', ratio: '16:9', resolution: 720, width: 1280, height: 720, fps: 30, background: '#000000',
    media: [
      { id: 'm1', ...(await probe(scene)), name: 'portrait scene.mp4' },
      { id: 'm2', ...(await probe(textClip)), name: 'slides text heavy.mp4' },
      { id: 'm3', ...(await probe(beachClip)), name: 'beach drone sunset.mp4' },
      { id: 'm4', ...(await probe(interviewClip)), name: 'مقابلة مع خالد.mp4' },
      { id: 'm5', ...(await probe(cityClip)), name: 'city night drive.mp4' },
    ],
    videoClips: [
      { id: 'v1', mediaId: 'm1', in: 0, out: 6, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null },
      { id: 'v2', mediaId: 'm2', in: 0, out: 6, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null },
    ],
    overlayClips: [], audioClips: [], stickerClips: [], effectClips: [],
    textClips: [
      { id: 't1', start: 0.5, duration: 5, text: 'شاهد Cutflow Pro الآن', font: 'montserrat', size: 64, bold: true, color: '#ffffff', x: 0.5, y: 0.82, caption: false },
      { id: 't2', start: 6.5, duration: 5, text: 'الحلقة 12 من Cutflow', font: 'montserrat', size: 56, bold: true, color: '#ffd400', x: 0.5, y: 0.82, caption: true },
    ],
  };
  await ev(`window.__fve.load(${JSON.stringify(project)})`);
  await dismissWelcome();
  await ev(`window.__fve.seek(1)`);
  await sleep(800);
  check('project loaded (2 video clips, mixed text)', await ev(`window.__fve.exportData().project.videoClips.length === 2`));

  // ---- P2-37 workspaces ----
  const wsSelect = `document.querySelector('.workspace-picker select')`;
  check('workspace picker present in top bar', await ev(`!!${wsSelect}`));
  check('workspace defaults to Default', await ev(`${wsSelect}.value === 'default'`));
  await ev(`${wsSelect}.value = 'audio'; ${wsSelect}.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(900); // debounce save is 400ms; tab switch is immediate
  check('Audio workspace opens the Audio panel', await until(`document.querySelector('.lib-head h2')?.textContent === 'Audio'`, 5000));
  await ev(`${wsSelect}.value = 'color'; ${wsSelect}.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(600);
  check('Color workspace opens the Adjust panel', await until(`document.querySelector('.lib-head h2')?.textContent === 'Adjust'`, 5000));
  await ev(`${wsSelect}.value = 'audio'; ${wsSelect}.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(600);
  check('switching back restores the Audio panel (state preserved)', await until(`document.querySelector('.lib-head h2')?.textContent === 'Audio'`, 5000));
  const wsStored = await ev(`JSON.parse(localStorage.getItem('clipcraft.workspaces.v1') || '{}')`);
  check('workspace state persisted', wsStored.active === 'audio' && wsStored.states?.audio?.tab === 'audio', JSON.stringify(wsStored.active));
  await ev(`document.querySelector('.workspace-picker button[aria-label="Reset workspace layout"]').click();`);
  await sleep(900);
  const wsAfterReset = await ev(`JSON.parse(localStorage.getItem('clipcraft.workspaces.v1') || '{}').states.audio.sizes`);
  check('one-click reset restores the Audio preset sizes', wsAfterReset && wsAfterReset.left === 420 && wsAfterReset.bottom === 460, JSON.stringify(wsAfterReset));
  await ev(`${wsSelect}.value = 'default'; ${wsSelect}.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(600);

  // ---- P2-38 bidi: mixed title in preview ----
  await ev(`window.__fve.seek(1)`);
  await sleep(800);
  const textPixels = await ev(`(() => { const cv = document.querySelector('.stage canvas.text-layer'); if (!cv) return null; const ctx = cv.getContext('2d', { willReadFrequently: true }); const d = ctx.getImageData(0, 0, cv.width, cv.height).data; let lit = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) lit++; return { w: cv.width, h: cv.height, alphaPx: lit }; })()`);
  check('mixed Arabic+Latin title draws pixels on the text layer', textPixels && textPixels.alphaPx > 100, JSON.stringify(textPixels));
  await shot('p2e-bidi-preview.png');
  // Save/reopen: the text survives a project round-trip through exportData.
  const roundTrip = await ev(`window.__fve.exportData().project.textClips.find((c) => c.id === 't1').text`);
  check('mixed text survives save/reopen round-trip', roundTrip === 'شاهد Cutflow Pro الآن', roundTrip);
  // Export: the same canvas renderer draws the text layer into the export.
  // exportNow()'s promise resolves when the job settles — await it with a
  // long timeout (the text-layer canvas renders slowly under contention),
  // then confirm the file on disk (ground truth).
  const exportRes = await (async () => {
    const r = await cdp.callLong('Runtime.evaluate', { expression: `window.__fve.exportNow()`, awaitPromise: true, returnByValue: true }, 600000);
    if (r.exceptionDetails) throw new Error(`page exception: ${JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text)}`);
    return r.result.value;
  })();
  const out = path.join(TMP, 'ui-export.mp4');
  const exported = fs.existsSync(out) ? out : null;
  check('export lands on disk (mixed text in the export path)', !!exported, `${exported || out} — settle: ${JSON.stringify(exportRes)}`);
  if (exported) {
    const info = await ff.probe(exported);
    check('export is 1280x720', info.width === 1280 && info.height === 720, `${info.width}x${info.height}`);
    // Frame at t=1s (title visible): the lower band where the title sits must carry bright pixels.
    const buf = execFileSync(ffmpegPath, ['-v', 'error', '-ss', '1', '-i', exported, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1e8 });
    let lit = 0;
    for (let y = Math.floor(720 * 0.72); y < 720; y += 2) for (let x = 0; x < 1280; x += 2) if (buf[y * 1280 + x] > 128) lit++;
    check('exported frame carries the title in the lower band', lit > 200, `lit px: ${lit}`);
  }

  // ---- P2-39 accessibility ----
  // Open Settings via the top-bar menu, switch to the Accessibility section.
  await ev(`(() => { const b = [...document.querySelectorAll('.topbar button')].find((x) => (x.getAttribute('aria-label') || '') === 'Menu' || x.textContent.trim() === 'Menu'); if (b) b.click(); return !!b; })()`);
  await sleep(400);
  await ev(`(() => { const b = [...document.querySelectorAll('.ctx-menu button')].find((x) => x.textContent.trim() === 'Settings'); if (b) b.click(); return !!b; })()`);
  await sleep(600);
  const openedSettings = await until(`!!document.querySelector('.settings2')`, 5000);
  check('Settings dialog opens', openedSettings);
  await ev(`(() => { const b = [...document.querySelectorAll('.set2-rail button')].find((x) => x.textContent.trim() === 'Accessibility'); if (b) b.click(); return !!b; })()`);
  await sleep(400);
  check('Accessibility section renders', await ev(`!![...document.querySelectorAll('.settings-section')].find((s) => s.textContent.includes('Reduce motion'))`));
  await ev(`(() => { const rows = [...document.querySelectorAll('.settings-section .field.row')]; const clickRow = (label) => { const row = rows.find((r) => r.textContent.includes(label)); const t = row?.querySelector('input[type="checkbox"], button[role="switch"]'); if (t && !t.checked) t.click(); return !!t; }; return clickRow('Reduce motion') && clickRow('Reduce flashing'); })()`);
  await sleep(500);
  await ev(`(() => { const b = document.querySelector('.settings .icon-btn[aria-label="Close settings"], .settings-head .icon-btn'); if (b) b.click(); return !!b; })()`);
  await sleep(800);
  check('Reduce Motion applies the html class', await ev(`document.documentElement.classList.contains('reduce-motion')`));
  const flashDisplay = await ev(`(() => { const el = document.querySelector('.flash'); return el ? getComputedStyle(el).display : 'no-flash-el'; })()`);
  check('flash overlay hidden under Reduce Flashing (class path)', flashDisplay === 'none' || flashDisplay === 'no-flash-el', String(flashDisplay));
  // High-DPI: 200% device scale — top bar + panels must not clip.
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 2, mobile: false });
  await sleep(800);
  await shot('p2e-hidpi-200.png');
  const overflow = await ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
  check('no horizontal overflow at 200% scale', overflow);
  await cdp.call('Emulation.clearDeviceMetricsOverride');
  await sleep(400);

  // ---- P2-41 semantic search ----
  await ev(`(() => { const b = [...document.querySelectorAll('.toprail-btn, .toprail button')].find((x) => x.textContent.trim() === 'Media'); if (b) b.click(); return !!b; })()`);
  await sleep(600);
  const searchBox = `document.querySelector('.media-search input')`;
  const setSearch = async (q) => ev(`(() => { const input = ${searchBox}; if (!input) return false; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(q)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  check('index controls present in Media panel', await ev(`!!document.querySelector('.media-index-row')`));
  await setSearch('شاطئ');
  await sleep(700);
  const beachNames = await ev(`[...document.querySelectorAll('.asset-name')].map((e) => e.textContent)`);
  check("Arabic query 'شاطئ' finds the beach clip (ranked)", beachNames.includes('beach drone sunset.mp4'), JSON.stringify(beachNames));
  check('results marked ranked by relevance', await ev(`document.body.textContent.includes('ranked by relevance')`));
  await setSearch('مقابله');
  await sleep(700);
  const ivNames = await ev(`[...document.querySelectorAll('.asset-name')].map((e) => e.textContent)`);
  check("Arabic query 'مقابله' finds the interview clip (ه spelling)", ivNames.includes('مقابلة مع خالد.mp4'), JSON.stringify(ivNames));
  // Index off: the same Arabic query falls back to the substring scan and finds nothing.
  await ev(`(() => { const b = document.querySelector('.media-index-row .chip'); if (b) b.click(); return !!b; })()`);
  await sleep(700);
  await setSearch('شاطئ');
  await sleep(700);
  const offNames = await ev(`[...document.querySelectorAll('.asset-name')].map((e) => e.textContent)`);
  check('index off: Arabic query finds nothing (plain scan fallback)', !offNames.includes('beach drone sunset.mp4'), JSON.stringify(offNames));
  await ev(`(() => { const b = document.querySelector('.media-index-row .chip'); if (b) b.click(); return !!b; })()`);
  await sleep(500);
  await setSearch('');
  await sleep(500);
  await ev(`(() => { const b = [...document.querySelectorAll('.media-index-row button')].find((x) => x.textContent.includes('Delete index')); if (b) b.click(); return !!b; })()`);
  await sleep(400);
  check('Delete index wipes the saved index', await ev(`localStorage.getItem('clipcraft.mediaIndex.v1') === null`));

  // ---- P2-42 reframe dialog + copy ----
  await ev(`(() => { const b = [...document.querySelectorAll('.topbar button')].find((x) => (x.getAttribute('aria-label') || '') === 'Menu' || x.textContent.trim() === 'Menu'); if (b) b.click(); return !!b; })()`);
  await sleep(400);
  await ev(`(() => { const b = [...document.querySelectorAll('.ctx-menu button')].find((x) => x.textContent.includes('vertical copy')); if (b) b.click(); return !!b; })()`);
  await sleep(600);
  check('reframe dialog opens with mode + text-safe options', await until(`!!document.querySelector('#reframe-title') && !!document.querySelector('input[name="reframe-mode"]')`, 5000));
  // Centre mode + text-safe on: the faceless slides clip must be fitted, the face clip centred.
  // REFRAME_MODE=face runs the same flow in face-following mode instead.
  const reframeMode = process.env.REFRAME_MODE === 'face' ? 0 : 1;
  await ev(`(() => { const radios = [...document.querySelectorAll('input[name="reframe-mode"]')]; const c = radios[${reframeMode}]; if (c) c.click(); return !!c; })()`);
  await sleep(300);
  await ev(`(() => { const b = [...document.querySelectorAll('.modal-actions button')].find((x) => x.textContent.includes('Make vertical copy')); if (b) b.click(); return !!b; })()`);
  const becameVertical = await until(`window.__fve.exportData().project.ratio === '9:16'`, 180000);
  check('reframe produces a 9:16 copy', becameVertical);
  if (becameVertical) {
    const meta = await ev(`window.__fve.exportData().project.reframeMeta`);
    const wantMode = process.env.REFRAME_MODE === 'face' ? 'face' : 'center';
    check('reframeMeta recorded (mode matches the dialog choice)', meta && meta.mode === wantMode, JSON.stringify(meta));
    const clips = await ev(`window.__fve.exportData().project.videoClips.map((c) => ({ id: c.id, scale: c.transform?.scale }))`);
    const fitted = clips.find((c) => c.id === 'v2');
    check('faceless text-carrying slides clip is fitted (scale 1)', fitted && Math.abs(fitted.scale - 1) < 0.01, JSON.stringify(clips));
    if (wantMode === 'face') {
      check('face clip tracked (not fitted) in face mode', meta.tracked.includes('v1') && !meta.fitted.includes('v1'), JSON.stringify(meta));
    }
    await shot('p2e-reframe-vertical.png');
  }
} finally {
  if (cdp) cdp.close();
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
}
const failed = results.filter(([, ok]) => !ok);
console.log(`\ntest-p2e-live: ${results.length - failed.length}/${results.length} PASS${failed.length ? ` — FAILURES: ${failed.map(([n]) => n).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
