// P2 stream B live verification: drives the real app over CDP and checks every
// item's UI controls in the actual editor, then exports twice and verifies the
// outputs on disk (clock wipe frame mix, smooth-cut duration, motion preset +
// clean voice + ducking in the mix, optical-flow frame counts).
// Run AFTER `npm run build`, with Xvfb :99 up.
//   node scripts/test-p2b-live.mjs
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { probe, ffmpegPath } = require('../electron/ffmpeg.cjs');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9227;
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

// ---- Fixtures ---------------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-p2b-live-'));
const home = fs.mkdtempSync(path.join('/tmp', 'fve-p2-b-'));
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
const clipA = path.join(dir, 'a.mp4');
const clipB = path.join(dir, 'b.mp4');
const music = path.join(dir, 'music.wav');
gen(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipA]);
gen(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4,hue=h=120', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipB]);
gen(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=6', '-ar', '48000', '-ac', '2', music]);
const media = [];
for (const [id, p] of [['m1', clipA], ['m2', clipB], ['m3', music]]) media.push({ id, path: p, name: path.basename(p), ...(await probe(p)) });

const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
const project = {
  name: 'p2b-live', ratio: '16:9', resolution: 180, width: 320, height: 180, fps: 30, background: '#000000', media,
  videoClips: [
    { ...base, id: 'c1', mediaId: 'm1', in: 0, out: 2 },
    { ...base, id: 'c2', mediaId: 'm1', in: 2, out: 4 },
    { ...base, id: 'c3', mediaId: 'm2', in: 0, out: 2 },
  ],
  overlayClips: [], textClips: [],
  audioClips: [{ id: 'a1', mediaId: 'm3', start: 0, in: 0, out: 6, volume: 0.5, fadeIn: 0, fadeOut: 0, speed: 1 }],
  stickerClips: [], effectClips: [],
};
const flowProject = {
  name: 'p2b-live-flow', ratio: '16:9', resolution: 180, width: 320, height: 180, fps: 30, background: '#000000',
  media: [media[0]],
  videoClips: [{ ...base, id: 'c1', mediaId: 'm1', in: 0, out: 2, speed: 0.5, interp: 'flow' }],
  overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
};

const shotDir = '/home/hatch/workspace/cutflow-shots/p2b-live';
fs.mkdirSync(shotDir, { recursive: true });
const exportDir = path.join(dir, 'export');
fs.mkdirSync(exportDir, { recursive: true });

const env = {
  ...process.env, HOME: home, DISPLAY: ':99',
  VK_ICD_FILENAMES: '/home/hatch/workspace/vulkan/lvp_icd.json',
  TMPDIR: '/home/hatch/workspace/.tmp-battery',
  FVE_EXPORT_TARGET: exportDir,
};
const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron'),
  ['.', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: 'pipe', detached: true });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
child.on('exit', (code, signal) => { console.log(`[child] electron exited code=${code} signal=${signal}`); });

const waitExportFile = async (file, ms = 180000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fs.existsSync(file)) {
      try { await probe(file); return true; } catch { /* still writing */ }
    }
    await sleep(2000);
  }
  return false;
};
const decodeFrames = (file, from, len, W = 320, H = 180) => {
  const raw = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file,
    '-vf', `trim=start=${from}:duration=${len},setpts=PTS-STARTPTS,fps=30,scale=${W}:${H},format=rgba`,
    '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 28 });
  const size = W * H * 4; const frames = [];
  for (let o = 0; o + size <= raw.length; o += size) frames.push(raw.subarray(o, o + size));
  return frames;
};
const meanDiff = (f1, f2) => {
  let s = 0;
  for (let i = 0; i < f1.length; i++) s += Math.abs(f1[i] - f2[i]);
  return s / f1.length;
};
const decodeAudio = (file, from, len) => {
  const raw = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file,
    '-vn', '-ss', String(from), '-t', String(len), '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 28 });
  const n = raw.length / 4;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = raw.readFloatLE(i * 4);
  return out;
};
const goertzel = (samples, freq, sr = 48000) => {
  const n = samples.length;
  const k = Math.round((n * freq) / sr);
  const w = (2 * Math.PI * k) / n;
  const cw = Math.cos(w);
  let s1 = 0; let s2 = 0;
  for (let i = 0; i < n; i++) {
    const x = samples[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    const s = x + 2 * cw * s1 - s2;
    s2 = s1; s1 = s;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - 2 * cw * s1 * s2) / n;
};

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
  const shot = async (name) => {
    const { data } = await cdp.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(shotDir, name), Buffer.from(data, 'base64'));
  };
  const until = async (expr, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch { /* not yet */ } await sleep(500); }
    return false;
  };
  const data = async () => ev(`window.__fve.exportData().project`);
  const clipOf = async (id) => {
    const p = await data();
    return p.videoClips.find((c) => c.id === id) || p.audioClips.find((c) => c.id === id);
  };
  const clickTab = async (name) => ev(`(() => { const b = [...document.querySelectorAll('.clip-inspector [role=tab]')].find((x) => x.textContent.trim().startsWith('${name}')); if (b) b.click(); return !!b; })()`);
  // Sections carry no DOM id (Section uses it only for collapse state) — find
  // them by their heading text, then the labelled slider inside.
  const sectionByHeading = (h) => `[...document.querySelectorAll('section.ci-section')].find((s) => s.querySelector('.ci-head b')?.textContent.trim() === '${h}')`;
  const setRangeByLabel = async (heading, labelStart, value) => ev(`(() => {
    const sec = ${sectionByHeading(heading)};
    if (!sec) return 'no-section';
    const lab = [...sec.querySelectorAll('label.field')].find((l) => l.textContent.trim().startsWith('${labelStart}'));
    if (!lab) return 'no-label';
    const input = lab.querySelector('input[type=range]');
    if (!input) return 'no-range';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(${value}));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'set';
  })()`);

  await sleep(2500);
  await ev(`(() => { const b = document.querySelector('.welcome-go'); if (b) b.click(); return !!b; })()`);
  await ev(`(() => { const b = document.querySelector('.home-create'); if (b) b.click(); return !!b; })()`);
  check('editor entered', await until(`!!document.querySelector('.play-btn')`, 30000));
  await ev(`(() => { const b = document.querySelector('button[aria-label="Skip tour"]') || [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) b.click(); return !!b; })()`).catch(() => {});
  await sleep(600);
  check('app harness ready', await until(`!!window.__fve`, 30000));

  await ev(`window.__fve.load(${JSON.stringify(project)})`);
  await sleep(800);
  check('project loaded (3 video clips + music)', await ev(`window.__fve.exportData().project.videoClips.length === 3`));

  // ---- P2-04/05: transition params in the Adjust tab -------------------------
  await ev(`window.__fve.select({ track: 'video', id: 'c3' })`);
  await sleep(400);
  // FB-29 unified inspector defaults to Basic (tabs: video + adjust only).
  // The Speed, Animation and Audio tabs and the Smooth Cut section are
  // Advanced-only — switch once here; Advanced is a superset, so the
  // Basic-visible checks below are unaffected. The levels row only exists
  // while a picture clip is selected, so the switch must run AFTER the
  // select above: before it, .ci-levels is absent and the click silently
  // no-ops, leaving every Advanced-only section unrunnable.
  const advSwitched = await ev(`(() => { const b = [...document.querySelectorAll('.ci-levels button')].find((x) => x.textContent.trim() === 'Advanced'); if (b) b.click(); return !!b; })()`);
  check('inspector switched to Advanced', advSwitched === true);
  await sleep(500);
  await clickTab('Adjust');
  await sleep(400);
  check('transition section renders', await ev(`!!${sectionByHeading('Transition in')}`));
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'c3', patch: { transition: { type: 'fx_clockwipe', duration: 1 } } })`);
  await sleep(500);
  check('clock-wipe params render (feather slider)', await ev(`(() => { const sec = ${sectionByHeading('Transition in')}; return !!sec && [...sec.querySelectorAll('label.field')].some((l) => l.textContent.trim().startsWith('Softness')); })()`));
  check('clock-wipe direction buttons render', await ev(`(() => { const sec = ${sectionByHeading('Transition in')}; return !!sec && !!sec.querySelector('[role=group][aria-label="Direction"]'); })()`));
  await shot('01-clockwipe-params.png');
  const featherRes = await setRangeByLabel('Transition in', 'Softness', 0.15);
  await sleep(400);
  const c3a = await clipOf('c3');
  check('feather slider writes the store', featherRes === 'set' && c3a.transition.params && Math.abs(c3a.transition.params.feather - 0.15) < 0.01, `feather=${c3a.transition?.params?.feather}`);
  await ev(`(() => { const sec = ${sectionByHeading('Transition in')}; const g = sec && sec.querySelector('[role=group][aria-label="Direction"]'); const btns = [...(g ? g.querySelectorAll('button') : [])]; const b = btns.find((x) => /Counter-clockwise/.test(x.textContent)); if (b) b.click(); return btns.map((x) => x.textContent.trim()).join('|'); })()`);
  await sleep(400);
  const c3b = await clipOf('c3');
  check('direction button writes the store', c3b.transition.params && c3b.transition.params.direction === 'ccw', `direction=${c3b.transition?.params?.direction}`);

  // ---- P2-06: Smooth Cut on the same-media pair ------------------------------
  await ev(`window.__fve.select({ track: 'video', id: 'c1' })`);
  await sleep(400);
  await clickTab('Adjust');
  await sleep(400);
  check('first clip has no smooth-cut pair', await ev(`(() => { const sec = ${sectionByHeading('Smooth Cut')}; return !!sec && sec.textContent.includes('Select the second clip'); })()`));
  await ev(`window.__fve.select({ track: 'video', id: 'c2' })`);
  await sleep(400);
  await clickTab('Adjust');
  await sleep(400);
  check('smooth-cut section renders for the pair', await ev(`!!document.querySelector('.sc-cut [aria-label="Smooth Cut"]')`));
  await ev(`(() => { const t = document.querySelector('.sc-cut input[type=checkbox][aria-label="Smooth Cut"]'); if (t) t.click(); return !!t; })()`);
  await sleep(600);
  const c2 = await clipOf('c2');
  check('smooth-cut toggle enables punch', !!c2.smoothCut && c2.smoothCut.mode === 'punch', `mode=${c2.smoothCut?.mode}`);
  check('smooth-cut punch wrote scale keys', Array.isArray(c2.keyframes?.scale) && c2.keyframes.scale.length >= 2, `scale keys=${c2.keyframes?.scale?.length}`);
  check('A/B buttons render', await ev(`!!document.querySelector('[aria-label*="Smooth"], [aria-label*="smooth"]') || [...document.querySelectorAll('.sc-cut button')].some((b) => /\\(A\\)|\\(B\\)/.test(b.textContent))`));
  await shot('02-smoothcut.png');

  // ---- P2-07: interpolation dropdown in the Speed tab -------------------------
  await ev(`window.__fve.select({ track: 'video', id: 'c1' })`);
  await sleep(400);
  await clickTab('Speed');
  await sleep(400);
  check('interpolation dropdown renders', await ev(`!!document.querySelector('button[aria-label="Slow-motion interpolation"]')`));
  await ev(`(() => { const b = document.querySelector('button[aria-label="Slow-motion interpolation"]'); if (b) b.click(); return !!b; })()`);
  await sleep(400);
  check('three interpolation modes listed', await ev(`[...document.querySelectorAll('[role=option]')].map((o) => o.textContent).join('|').includes('Optical flow')`));
  await ev(`(() => { const o = [...document.querySelectorAll('[role=option]')].find((x) => /Optical flow/.test(x.textContent)); if (o) o.click(); return !!o; })()`);
  await sleep(400);
  const c1a = await clipOf('c1');
  check('optical flow sticks in the store', c1a.interp === 'flow', `interp=${c1a.interp}`);
  await shot('03-interp.png');
  // Back to sample for the main export (flow is proven by its own export below).
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'c1', patch: { interp: 'sample' } })`);

  // ---- P2-18: motion presets in the Animation tab ----------------------------
  await clickTab('Animation');
  await sleep(400);
  check('motion presets section renders', await ev(`document.body.textContent.includes('Motion presets')`));
  check('premium movement pack group renders', await ev(`document.body.textContent.includes('Premium Movement Pack')`));
  await ev(`(() => { const b = [...document.querySelectorAll('.anim-panel .tile')].find((x) => x.textContent.trim() === 'Punch in'); if (b) b.click(); return !!b; })()`);
  await sleep(500);
  const c1b = await clipOf('c1');
  check('punch-in preset writes keyframes', c1b.motionPreset === 'punch-in' && Array.isArray(c1b.keyframes?.scale) && c1b.keyframes.scale.length >= 3, `preset=${c1b.motionPreset} keys=${c1b.keyframes?.scale?.length}`);
  check('motion blur is on with the preset', c1b.motionBlur === true, `motionBlur=${c1b.motionBlur}`);
  await shot('04-motion-presets.png');

  // ---- P2-25 Clean Voice in the Audio tab ------------------------------------
  await clickTab('Audio');
  await sleep(400);
  check('clean voice section renders', await ev(`document.body.textContent.includes('Clean Voice')`));
  await ev(`(() => { const rows = [...document.querySelectorAll('.afx .field.row')]; const row = rows.find((r) => r.textContent.includes('Clean Voice')); const t = row && row.querySelector('input[type=checkbox]'); if (t) t.click(); return !!t; })()`);
  await sleep(500);
  check('five clean-voice steps render', await ev(`['Enhance','De-esser','Hum removal','Compressor','Duck music'].every((s) => document.body.textContent.includes(s))`));
  const c1c = await clipOf('c1');
  check('clean voice toggle sticks', !!c1c.cleanVoice && c1c.cleanVoice.on === true, `on=${c1c.cleanVoice?.on}`);
  check('all five steps on by default', c1c.cleanVoice && Object.values(c1c.cleanVoice.steps || {}).filter(Boolean).length === 5, JSON.stringify(c1c.cleanVoice?.steps));
  check('audioFx untouched by clean voice', !c1c.audioFx || Object.keys(c1c.audioFx).length === 0, 'audioFx still empty');
  await shot('05-cleanvoice.png');

  // ---- P2-25 Brand Caption Packs in the Text panel ---------------------------
  await ev(`window.__fve.tab('text')`);
  await sleep(600);
  check('text templates panel opens', await ev(`document.body.textContent.includes('Templates') || document.body.textContent.includes('templates')`));
  const brandNav = await ev(`(() => { const b = [...document.querySelectorAll('.side-nav button')].find((x) => x.textContent.trim().startsWith('Brand')); if (b) b.click(); return !!b; })()`);
  await sleep(600);
  const brandList = await ev(`(() => { const items = [...document.querySelectorAll('.tpl-item')].map((el) => el.textContent.trim()); return items; })()`);
  check('brand category lists the four packs', Array.isArray(brandList) && ['Brand Arabic', 'Brand Darija', 'Brand Bilingual', 'Brand English'].every((n) => brandList.some((t) => t.includes(n))), JSON.stringify(brandList));
  await shot('06-brand-captions.png');
  await ev(`window.__fve.tab('media')`);
  await sleep(400);

  // ---- Export 1: clock wipe + smooth cut + punch-in + clean voice + duck -----
  const outMain = path.join(exportDir, 'ui-export.mp4');
  await evFire(`window.__fve.exportNow()`);
  check('main export lands on disk', await waitExportFile(outMain));
  const mainFile = path.join(dir, 'live-main.mp4');
  fs.renameSync(outMain, mainFile);
  {
    const meta = await probe(mainFile);
    check('main export is 5 s (6 s timeline minus 1 s transition overlap)', Math.abs(meta.duration - 5) < 0.3, `duration=${meta.duration}`);
    const mid = decodeFrames(mainFile, 4.5, 0.033)[0];
    const pureA = decodeFrames(mainFile, 3.9, 0.033)[0];
    const pureB = decodeFrames(mainFile, 4.9, 0.033)[0];
    const dA = meanDiff(mid, pureA);
    const dB = meanDiff(mid, pureB);
    check('mid-wipe frame mixes both clips', dA > 3 && dB > 3, `diff vs A=${dA.toFixed(1)} vs B=${dB.toFixed(1)}`);
    const inSpan = decodeAudio(mainFile, 0.3, 0.6);
    const outSpan = decodeAudio(mainFile, 4.0, 0.9);
    const duckRatio = goertzel(inSpan, 880) / goertzel(outSpan, 880);
    check('music is ducked under the voice in the live export', duckRatio > 0.2 && duckRatio < 0.6, `880 Hz ratio=${duckRatio.toFixed(2)}`);
    check('live export has voice audio', goertzel(decodeAudio(mainFile, 0.3, 0.6), 440) > 0.01, '440 Hz present');
  }

  // ---- Export 2: optical flow slow motion -------------------------------------
  await ev(`window.__fve.load(${JSON.stringify(flowProject)})`);
  await sleep(800);
  await evFire(`window.__fve.exportNow()`);
  check('flow export lands on disk', await waitExportFile(outMain));
  const flowFile = path.join(dir, 'live-flow.mp4');
  fs.renameSync(outMain, flowFile);
  {
    const meta = await probe(flowFile);
    check('flow export is 4 s (0.5x of 2 s)', Math.abs(meta.duration - 4) < 0.3, `duration=${meta.duration}`);
    const frames = decodeFrames(flowFile, 0, 4);
    let changes = 0;
    for (let k = 1; k < frames.length; k++) if (meanDiff(frames[k], frames[k - 1]) > 1.5) changes++;
    // Threshold is 90, not 116: the count varies 98–106 across identical live
    // runs (minterpolate threading + the duplicate-frame threshold on x264
    // noise), while sample mode measures 59 on the same content — flow is
    // still clearly interpolating nearly every frame. The node suite
    // (test-p2b-interp.mjs) holds the deterministic 116/116 assertion.
    check('flow export interpolates nearly every frame', changes > 90, `${changes}/${frames.length - 1} transitions change`);
  }

  await shot('07-done.png');
} catch (e) {
  console.log('DRIVER ERROR:', e.message);
  console.log('electron stderr tail:', stderr.slice(-2000));
} finally {
  try { child.kill('SIGTERM'); } catch {}
  try { execFileSync('pkill', ['-x', 'electron']); } catch {}
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\nP2-B LIVE: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(([n, , x]) => console.log(' -', n, x)); process.exitCode = 1; }
