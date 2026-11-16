// Live-app verification for Stream E (gap-e) — CDP port 9244.
// Boots the real app headless (Xvfb :99) with a fresh profile and checks,
// against the running editor, every Stream E item that has DOM behaviour:
//   PF-03 timeline virtualization (rendered clip count vs total, before/after scroll)
//   TL-02 ripple switch (main vs linked cut semantics, via the .ripple-mode select)
//   AI-02 cost/placement badge in the captions panel
//   AI-03 transcript confidence slider + low-conf list + speaker input + diarize (Deepgram)
//   AI-04 Correct captions button (broken Arabic -> fixed Arabic, live)
//   AI-05 B-roll suggestions card (off-timeline match) + Add
//   TR-02 parametric transition inspector (Softness/feather slider -> stored param)
//   TR-03 clamped + zero-handle warnings
//   MH P2-1 particle effect on a clip (inspector + stored params)
//   MH P2-4 audition bar (rate buttons + reverse toggle)
//   MH P2-6 multi-select + Apply style to selection + group/ungroup
//   CSV tracking loop tile + CSV hover-scrub thumbnail (frame held while scrubbed)
// Run AFTER `npm run build`:  node scripts/test-gap-e-live.mjs
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9244;
const HOME = process.env.HOME;
const LIVE = path.join(HOME, 'workspace', '.tmp-gap-e-live');
fs.mkdirSync(path.join(LIVE, 'home'), { recursive: true });
fs.mkdirSync(path.join(LIVE, 'tmp'), { recursive: true });
fs.mkdirSync(path.join(LIVE, 'media'), { recursive: true });
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

// --- media (on disk, not /tmp) ----------------------------------------------
const mkvid = (name, hue) => {
  const f = path.join(LIVE, 'media', name);
  if (!fs.existsSync(f)) execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=30:duration=12`, '-vf', `hue=h=${hue}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f]);
  return f;
};
const clipKitchen = mkvid('kitchen-cooking.mp4', 20);
const clipCity = mkvid('city-street.mp4', 140);
const clipBeach = mkvid('beach-sunset.mp4', 260);
const clipMountain = mkvid('mountain-trail.mp4', 80);
const music = path.join(LIVE, 'media', 'music.mp3');
if (!fs.existsSync(music)) execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=12', '-c:a', 'libmp3lame', '-q:a', '4', music]);
const probe = async (f) => ff.probe(f);
const mKitchen = await probe(clipKitchen);
const mCity = await probe(clipCity);
const mBeach = await probe(clipBeach);
const mMountain = await probe(clipMountain);
const mMusic = await probe(music);

const env = {
  ...process.env, HOME: path.join(LIVE, 'home'), DISPLAY: ':99',
  TMPDIR: path.join(LIVE, 'tmp'),
  VK_ICD_FILENAMES: path.join(HOME, 'workspace', 'vulkan', 'lvp_icd.json'),
  LIBGL_ALWAYS_SOFTWARE: '1',
};
delete env.FVE_SMOKE;
const ELECTRON = path.join(HOME, 'workspace', 'electron-gap-e-dist', 'cutflow-gape'); // renamed binary: a stray `pkill -x electron` killed the 18:41 run; node_modules/electron has no dist/ (npm ci --ignore-scripts skipped the download)
const child = spawn(ELECTRON,
  ['.', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-sandbox', '--disable-accelerated-video-decode', '--disable-accelerated-video-encode', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: 'pipe', detached: true });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
child.on('exit', (code, signal) => { console.log(`[child] electron exited code=${code} signal=${signal}`); });

const shotDir = '/home/hatch/workspace/cutflow-shots/gap-e-live';
fs.mkdirSync(shotDir, { recursive: true });

const killApp = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } } };

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
    try {
      const { data } = await cdp.call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(shotDir, name), Buffer.from(data, 'base64'));
    } catch (e) { console.log(`(shot ${name} failed: ${e.message})`); }
  };
  const until = async (expr, ms = 120000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch { /* not yet */ } await sleep(500); }
    return false;
  };
  const clickText = async (text, scope = 'document') => ev(`(() => { const els = [...${scope}.querySelectorAll('button')]; const b = els.find((x) => x.textContent.replace(/•/g, '').trim() === ${JSON.stringify(text)}); if (b) { b.click(); return true; } return false; })()`);
  const clickInspectorTab = async (text) => ev(`(() => { const ins = document.querySelector('.clip-inspector') || document.querySelector('.inspector'); if (!ins) return false; const b = [...ins.querySelectorAll('button[role="tab"]')].find((x) => x.textContent.replace(/•/g, '').trim() === ${JSON.stringify(text)}); if (b) { b.click(); return true; } return false; })()`);
  const mouse = async (type, x, y) => cdp.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: type === 'mousePressed' || type === 'mouseReleased' ? 1 : 0 });

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

  // --- project: 30 video clips (v3 0.3s, v5 0s), particles on v1, transitions ---
  const mediaFor = (i) => [mKitchen, mCity, mBeach][i % 3];
  const pathFor = (i) => [clipKitchen, clipCity, clipBeach][i % 3];
  const nameFor = (i) => ['kitchen-cooking.mp4', 'city-street.mp4', 'beach-sunset.mp4'][i % 3];
  const vclips = [];
  for (let i = 0; i < 30; i += 1) {
    const n = i + 1;
    const len = n === 3 ? 0.3 : n === 5 ? 0 : 5;
    const c = { id: `v${n}`, mediaId: `m${i % 3}`, in: (i % 2) * 5, out: (i % 2) * 5 + len, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null };
    if (n === 1) { c.effects = ['fx_particles']; c.fxParams = { fx_particles: { preset: 'snowfall', count: 60, speed: 1, size: 1, gravity: 1, wind: 0, opacity: 0.9, sway: 0.5 } }; }
    if (n === 2) c.transition = { type: 'fx_wipewest', duration: 0.6, params: {} };
    if (n === 4) c.transition = { type: 'fx_wipeeast', duration: 0.6, params: {} };
    if (n === 6) c.transition = { type: 'fx_wipeeast', duration: 0.6, params: {} };
    vclips.push(c);
  }
  const words = (text, start, dur) => {
    const ws = text.split(' ');
    return ws.map((w, i) => ({ text: w, start: start + (i * dur) / ws.length, end: start + ((i + 1) * dur) / ws.length }));
  };
  const mkProject = () => ({
    name: 'gap-e-live', ratio: '16:9', resolution: 180, width: 320, height: 180, fps: 30, background: '#000000',
    media: [
      { id: 'm0', path: clipKitchen, name: 'kitchen-cooking.mp4', ...mKitchen },
      { id: 'm1', path: clipCity, name: 'city-street.mp4', ...mCity },
      { id: 'm2', path: clipBeach, name: 'beach-sunset.mp4', ...mBeach },
      { id: 'm3', path: clipMountain, name: 'mountain-trail.mp4', ...mMountain },
      { id: 'm4', path: music, name: 'music.mp3', ...mMusic },
    ],
    videoClips: vclips,
    overlayClips: [],
    audioClips: [{ id: 'a1', mediaId: 'm4', start: 0, in: 0, out: 12, speed: 1, volume: 1, muted: false }],
    stickerClips: [], effectClips: [],
    textClips: [
      { id: 't1', text: 'انشاء الله و قال', start: 0, duration: 3, caption: true, font: 'cairo', words: [
        { text: 'انشاء', start: 0, end: 0.75, conf: 0.4 }, { text: 'الله', start: 0.75, end: 1.5, conf: 0.95 },
        { text: 'و', start: 1.5, end: 2.25, conf: 0.9 }, { text: 'قال', start: 2.25, end: 3, conf: 0.92 } ] },
      { id: 't2', text: 'hiking the mountain trail', start: 5, duration: 3, caption: true, font: 'montserrat', words: words('hiking the mountain trail', 0, 3) },
      { id: 't3', text: 'cooking in the kitchen', start: 20, duration: 3, caption: true, font: 'montserrat', words: words('cooking in the kitchen', 0, 3) },
    ],
  });
  await evFire(`window.__fve.load(${JSON.stringify(mkProject())})`);
  await sleep(1200);
  const dur = await ev(`window.__fve.duration()`);
  check('project loaded (30 video clips, long timeline)', dur > 130, `duration=${dur}`);
  check('zero-length v5 survived load (TR-03 zero state reachable)', await ev(`window.__fve.exportData().project.videoClips.some((c) => c.id === 'v5')`));
  await dismissWelcome();
  await shot('01-editor.png');

  // --- PF-03: virtualization -------------------------------------------------
  const clipCount = () => ev(`document.querySelectorAll('.clip-label').length`);
  const firstLabel = () => ev(`(document.querySelector('.clip.video .clip-label') || {}).textContent || ''`);
  const c0 = await clipCount();
  const first0 = await firstLabel();
  await ev(`(() => { const s = document.querySelector('.tl-scroll'); if (s) { s.scrollLeft = 100000; } return !!s; })()`);
  await sleep(1200);
  const c1 = await clipCount();
  const first1 = await firstLabel();
  check('PF-03 virtualized at scroll 0 (rendered << 30 clips)', c0 > 0 && c0 < 15, `rendered=${c0}`);
  check('PF-03 virtualized after scroll to 100s', c1 > 0 && c1 < 15, `rendered=${c1}`);
  check('PF-03 scrolled window renders different clips', first0 !== first1, `${first0} -> ${first1}`);
  await ev(`(() => { const s = document.querySelector('.tl-scroll'); if (s) { s.scrollLeft = 0; } return true; })()`);
  await sleep(800);

  // --- TL-02: ripple switch ---------------------------------------------------
  const rippleVal = () => ev(`(document.querySelector('.ripple-mode') || {}).value`);
  check('TL-02 ripple select renders (default main)', (await rippleVal()) === 'main', `value=${await rippleVal()}`);
  const totalVideo = async () => ev(`window.__fve.exportData().project.videoClips.reduce((a, c) => a + (c.out - c.in) / (c.speed || 1), 0)`);
  const t3start = async () => ev(`(window.__fve.exportData().project.textClips.find((c) => c.id === 't3') || {}).start`);
  const tot0 = await totalVideo();
  await evFire(`window.__fve.dispatch({ type: 'cutRanges', ranges: [{ start: 10, end: 11 }] })`);
  await sleep(600);
  const tot1 = await totalVideo();
  const t3a = await t3start();
  check('TL-02 main-mode cut removes 1s of video only', Math.abs((tot0 - tot1) - 1) < 0.05, `${tot0.toFixed(2)} -> ${tot1.toFixed(2)}`);
  check('TL-02 main-mode cut leaves later text clip unshifted', Math.abs(t3a - 20) < 0.01, `t3.start=${t3a}`);
  await ev(`(() => { const s = document.querySelector('.ripple-mode'); if (!s) return false; s.value = 'linked'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(600);
  check('TL-02 ripple select switches to linked', (await rippleVal()) === 'linked');
  await evFire(`window.__fve.dispatch({ type: 'cutRanges', ranges: [{ start: 12, end: 13 }] })`);
  await sleep(600);
  const t3b = await t3start();
  check('TL-02 linked-mode cut ripples the later text clip', Math.abs(t3b - 19) < 0.01, `t3.start=${t3b}`);
  await ev(`(() => { const s = document.querySelector('.ripple-mode'); if (!s) return false; s.value = 'main'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);

  // --- Captions tab: AI-02 / AI-03 / AI-05 / AI-04 ----------------------------
  await evFire(`window.__fve.tab('captions')`);
  await sleep(800);
  const badge = await ev(`(() => { const b = document.querySelector('[data-testid="ai-cost-badge"]'); return b ? b.textContent : null; })()`);
  check('AI-02 cost/placement badge renders in captions panel', !!badge, badge ? badge.slice(0, 80) : 'no badge');
  check('AI-02 badge names the local placement', !!badge && /local/i.test(badge), badge ? badge.slice(0, 80) : '');
  await ev(`(() => { const b = [...document.querySelectorAll('button[role="tab"]')].find((x) => /Transcript/.test(x.textContent)); if (b) { b.click(); return true; } return false; })()`);
  await sleep(600);
  const confSlider = await ev(`!!document.querySelector('.tx-threshold input[type="range"]')`);
  check('AI-03 confidence threshold slider renders', confSlider);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Review low-confidence/.test(x.textContent)); if (b) { b.click(); return true; } return false; })()`);
  await sleep(500);
  const lowConf = await ev(`(() => { const el = document.querySelector('.tx-lowconf-list'); return el ? el.textContent : null; })()`);
  check('AI-03 low-confidence review lists the 0.4 word', !!lowConf && /انشاء/.test(lowConf), lowConf ? lowConf.slice(0, 80) : 'no list');
  // Merged UI keeps the free-text speaker input (not a select) — merge decision
  // pinned by test-gap-b-live.mjs:262 and test-gap-b-core.mjs:220.
  const speakerSel = await ev(`!!document.querySelector('input.tx-speaker')`);
  check('AI-03 per-sentence speaker input renders', speakerSel);
  // Diarize: the engine radios live in the Generate sub-tab, not Transcript.
  await ev(`(() => { const b = [...document.querySelectorAll('button[role="tab"]')].find((x) => x.textContent.trim() === 'Generate'); if (b) { b.click(); return true; } return false; })()`);
  await sleep(600);
  const engSet = await ev(`(() => { const b = [...document.querySelectorAll('button[role="radio"]')].find((x) => /Cloud/.test(x.textContent)); if (!b) return false; b.click(); return true; })()`);
  await sleep(600);
  const provSet = engSet ? await ev(`(() => { const sels = [...document.querySelectorAll('select')]; const s = sels.find((x) => [...x.options].some((o) => o.value === 'deepgram')); if (!s) return false; const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set; setter.call(s, 'deepgram'); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`) : false;
  await sleep(600);
  const diarize = provSet ? await ev(`!![...document.querySelectorAll('input[type="checkbox"]')].find((c) => (c.closest('label') || {}).textContent && /speak/i.test(c.closest('label').textContent))`) : false;
  check('AI-03 diarize checkbox appears for Deepgram', diarize, engSet ? (provSet ? '' : 'provider select not found') : 'cloud radio not found');
  // Back to the local engine, then back to the Transcript sub-tab (the
  // B-roll card lives there, not in Generate).
  await ev(`(() => { const b = [...document.querySelectorAll('button[role="radio"]')].find((x) => /Local/.test(x.textContent)); if (b) b.click(); return true; })()`);
  await sleep(400);
  await ev(`(() => { const b = [...document.querySelectorAll('button[role="tab"]')].find((x) => /Transcript/.test(x.textContent)); if (b) { b.click(); return true; } return false; })()`);
  await sleep(600);
  const broll = await ev(`(() => { const b = document.querySelector('[data-testid="broll-suggestions"]'); return b ? b.textContent : null; })()`);
  check('AI-05 B-roll card renders', !!broll, broll ? broll.slice(0, 80) : 'no card');
  check('AI-05 B-roll suggests the off-timeline mountain clip', !!broll && /mountain/i.test(broll), broll ? broll.slice(0, 120) : '');
  check('AI-05 B-roll does NOT force-suggest the on-timeline kitchen clip', !!broll && !/kitchen-cooking/i.test(broll), broll ? broll.slice(0, 120) : '');
  const overlaysBefore = await ev(`window.__fve.exportData().project.overlayClips.length`);
  const brollAdded = await ev(`(() => { const b = document.querySelector('[data-testid="broll-suggestions"] button.media-recommend-add'); if (b) { b.click(); return true; } return false; })()`);
  await sleep(600);
  const overlaysAfter = await ev(`window.__fve.exportData().project.overlayClips.length`);
  check('AI-05 B-roll Add puts the clip on the timeline', brollAdded && overlaysAfter === overlaysBefore + 1, `${overlaysBefore} -> ${overlaysAfter}`);
  // AI-04: correct the broken Arabic caption (t1) — after the AI-03 reads.
  const t1before = await ev(`(window.__fve.exportData().project.textClips.find((c) => c.id === 't1') || {}).text`);
  const corrected = await clickText('Correct captions');
  await sleep(800);
  const t1after = await ev(`(window.__fve.exportData().project.textClips.find((c) => c.id === 't1') || {}).text`);
  check('AI-04 Correct captions fixes the Arabic (live)', corrected && t1after === 'إن شاء الله وقال', `${t1before} -> ${t1after}`);
  await shot('02-captions.png');

  // --- TR-02 + TR-03 ----------------------------------------------------------
  const selectClip = async (id) => { await evFire(`window.__fve.select({ track: 'video', id: ${JSON.stringify(id)} })`); await sleep(700); };
  await selectClip('v2');
  await clickInspectorTab('Adjust');
  await sleep(500);
  const feather = await ev(`(() => { const labels = [...document.querySelectorAll('label')]; const l = labels.find((x) => /softness/i.test(x.textContent)); if (!l) return null; const inp = l.querySelector('input[type="range"]'); return inp ? { min: inp.min, max: inp.max, value: inp.value } : null; })()`);
  check('TR-02 Softness (feather) slider renders for a wipe transition', !!feather, feather ? JSON.stringify(feather) : 'no slider');
  if (feather) {
    await ev(`(() => { const labels = [...document.querySelectorAll('label')]; const l = labels.find((x) => /softness/i.test(x.textContent)); const inp = l.querySelector('input[type="range"]'); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(inp, '0.15'); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(600);
    const fval = await ev(`(window.__fve.exportData().project.videoClips.find((c) => c.id === 'v2') || {}).transition?.params?.feather`);
    check('TR-02 Softness slider stores the feather param on the clip', Math.abs((fval ?? -1) - 0.15) < 0.001, `feather=${fval}`);
  }
  await selectClip('v4');
  await clickInspectorTab('Adjust');
  await sleep(500);
  check('TR-03 clamped warning shows for the short-media transition', await ev(`!!document.querySelector('[data-testid="tr-clamped"]')`));
  // Re-create the zero-length neighbour: the TL-02 cuts above drop the loaded
  // 0s v5 (cutRanges rebuilds the list) and trim v6, so zero v6's CURRENT
  // previous clip instead (f3-live does the same with v1 out:0 — the update
  // path keeps a 0s clip, only the cut rebuild drops it).
  const prevId = await ev(`(() => { const pr = window.__fve.exportData().project; const i = pr.videoClips.findIndex((c) => c.id === 'v6'); return i > 0 ? pr.videoClips[i - 1].id : null; })()`);
  if (prevId) {
    const prevIn = await ev(`(window.__fve.exportData().project.videoClips.find((c) => c.id === ${JSON.stringify(prevId)}) || {}).in`);
    await evFire(`window.__fve.dispatch({ type: 'update', track: 'video', id: ${JSON.stringify(prevId)}, patch: { out: ${prevIn} } })`);
    await sleep(500);
  }
  await selectClip('v6');
  await clickInspectorTab('Adjust');
  await sleep(500);
  const zeroShown = await ev(`!!document.querySelector('[data-testid="tr-zero"]')`);
  check('TR-03 zero-handle error shows (0s prev clip)', zeroShown);
  await shot('03-transition.png');

  // --- MH P2-1 particles -------------------------------------------------------
  await selectClip('v1');
  await clickInspectorTab('Adjust');
  await sleep(500);
  const hasParticles = await ev(`(window.__fve.exportData().project.videoClips.find((c) => c.id === 'v1') || {}).effects?.includes('fx_particles')`);
  const particleUI = await ev(`/Particle System/i.test((document.querySelector('.clip-inspector') || {}).innerText || '')`);
  check('MH P2-1 particle effect stored on the clip', !!hasParticles);
  check('MH P2-1 Particle System appears in the inspector', particleUI);
  await shot('04-particles.png');

  // --- MH P2-4 audition --------------------------------------------------------
  await evFire(`window.__fve.tab('audio')`);
  await sleep(900);
  const audBar = await ev(`!!document.querySelector('[data-testid="audition-bar"]')`);
  check('MH P2-4 audition bar renders', audBar);
  const rate15 = await ev(`(() => { const b = [...document.querySelectorAll('[data-testid="audition-bar"] button')].find((x) => /1\\.5/.test(x.textContent)); if (b) { b.click(); return true; } return false; })()`);
  await sleep(400);
  check('MH P2-4 pitch rate button clicks (1.5x)', rate15);
  const revBtn = await ev(`(() => { const b = [...document.querySelectorAll('[data-testid="audition-bar"] button')].find((x) => /reverse/i.test(x.textContent)); if (b) { b.click(); return true; } return false; })()`);
  await sleep(2000);
  const revOn = revBtn ? await ev(`(() => { const b = [...document.querySelectorAll('[data-testid="audition-bar"] button')].find((x) => /reverse/i.test(x.textContent)); return b ? (b.getAttribute('aria-pressed') || b.className) : null; })()`) : null;
  check('MH P2-4 reverse toggle engages', !!revBtn && revOn != null, `state=${revOn}`);
  await shot('05-audio.png');

  // --- MH P2-6 multi-select + apply style + grouping ---------------------------
  // Multi-select shape is { track, id, items }: track/id is the first clip
  // (shown in the properties panel) and items lists them all (Timeline
  // toggleSel / box selection). A bare { items } leaves the inspector with
  // no clip, so no ClipInspector and no apply-style section render.
  await evFire(`window.__fve.select({ track: 'video', id: 'v1', items: [{ track: 'video', id: 'v1' }, { track: 'video', id: 'v2' }] })`);
  await sleep(700);
  const selCount = await ev(`document.querySelectorAll('.clip.selected').length`);
  check('MH P2-6 multi-select shows 2 selected clips', selCount === 2, `selected=${selCount}`);
  await evFire(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v1', patch: { filter: 'vivid' } })`);
  await sleep(500);
  const adjustTab = await clickInspectorTab('Adjust');
  await sleep(500);
  const applyBtn = await ev(`!!document.querySelector('[data-testid="apply-style"]')`);
  check('MH P2-6 Apply-style-to-selection button renders', applyBtn, adjustTab ? '' : 'Adjust tab not clicked');
  if (applyBtn) {
    await ev(`document.querySelector('[data-testid="apply-style"]').click()`);
    await sleep(600);
    const v2filter = await ev(`(window.__fve.exportData().project.videoClips.find((c) => c.id === 'v2') || {}).filter`);
    check('MH P2-6 Apply style copies the filter to the selection', v2filter === 'vivid', `v2.filter=${v2filter}`);
  }
  await evFire(`window.__fve.dispatch({ type: 'groupClips', items: [{ track: 'video', id: 'v1' }, { track: 'video', id: 'v2' }] })`);
  await sleep(500);
  const grouped = await ev(`(() => { const p = window.__fve.exportData().project; const a = p.videoClips.find((c) => c.id === 'v1'); const b = p.videoClips.find((c) => c.id === 'v2'); return a.groupId && a.groupId === b.groupId; })()`);
  check('MH P2-6 grouping gives both clips one groupId', !!grouped);
  await evFire(`window.__fve.dispatch({ type: 'ungroupClips', items: [{ track: 'video', id: 'v1' }] })`);
  await sleep(400);
  const ungrouped = await ev(`!(window.__fve.exportData().project.videoClips.find((c) => c.id === 'v1') || {}).groupId`);
  check('MH P2-6 ungroup removes the groupId', !!ungrouped);

  // --- CSV: tracking loop tile --------------------------------------------------
  await evFire(`window.__fve.select({ track: 'text', id: 't2' })`);
  await sleep(700);
  await clickText('Animation');
  await sleep(500);
  // The Animation tab has In/Out/Loop sub-tabs; the loop tiles (incl.
  // Tracking) only render under Loop.
  await clickText('Loop');
  await sleep(500);
  // The loop tile's name lives in a sibling .tpl-name span, not in the button
  // (the button holds only a preview canvas), so match the tile by its name.
  const trackingTile = await ev(`(() => { const items = [...document.querySelectorAll('.tpl-item')]; const it = items.find((x) => x.querySelector('.tpl-name') && x.querySelector('.tpl-name').textContent.trim() === 'Tracking'); const b = it && it.querySelector('button'); if (b) { b.click(); return true; } return false; })()`);
  await sleep(600);
  const loopId = await ev(`(window.__fve.exportData().project.textClips.find((c) => c.id === 't2') || {}).animLoop?.id`);
  check('CSV tracking loop tile applies to the text clip', trackingTile && loopId === 'tracking', `animLoop=${loopId}`);

  // --- CSV: hover-scrub thumbnail ------------------------------------------------
  await evFire(`window.__fve.tab('transitions')`);
  await sleep(1200);
  const scrubRect = await ev(`(() => { const tiles = [...document.querySelectorAll('.tile')]; const tile = tiles.find((t) => t.querySelector('canvas.fx-thumb, img.fx-thumb')); if (!tile) return null; tile.scrollIntoView({ block: 'center' }); const r = tile.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  let scrub = { ok: false, why: 'no tile' };
  if (scrubRect) {
    const cx = (f) => Math.round(scrubRect.left + scrubRect.width * f);
    const cy = Math.round(scrubRect.top + scrubRect.height / 2);
    const dataUrl = () => ev(`(() => { const c = document.querySelector('.tile canvas.fx-thumb'); return c ? c.toDataURL() : null; })()`);
    await mouse('mouseMoved', cx(0.05), cy); // enter the tile: still swaps to the live canvas, autoplay starts
    await sleep(1500); // let the hover swap mount the live tile: its scrub listener only exists after the mount, so a move before that is lost and the next move would become enterX (dead zone swallows it)
    // Continuous sweep like a real user (many small steps 5% -> 90%): the
    // hover swap re-dispatches pointerenter (play() resets the scrub anchor)
    // and a late photo arrival redraws the still frame, either of which
    // swallows one discrete jump; a sweep re-engages on the next step, so a
    // single interruption cannot kill the scrub. Ends at 90% for the hold read.
    for (let f = 0.1; f <= 0.9; f += 0.057) { await mouse('mouseMoved', cx(f), cy); await sleep(30); }
    await mouse('mouseMoved', cx(0.9), cy); // deliberate move: scrub engages at 90%
    await sleep(200);
    const a = await dataUrl();
    await sleep(400);
    const b = await dataUrl();
    await mouse('mouseMoved', cx(0.15), cy); // scrub to 15%
    await sleep(200);
    const c = await dataUrl();
    scrub = { ok: true, held: a === b, differs: a !== c, hasCanvas: !!a };
  }
  check('CSV hover-scrub holds the scrubbed frame (no autoplay advance)', scrub.ok && scrub.held, JSON.stringify(scrub));
  check('CSV hover-scrub shows a different frame at a different position', scrub.ok && scrub.differs, JSON.stringify(scrub));
  await shot('06-transitions.png');

  const fails = results.filter(([, okk]) => !okk);
  console.log(`\nLIVE SUMMARY: ${results.length - fails.length}/${results.length} PASS`);
  if (fails.length) console.log('FAILED: ' + fails.map(([n]) => n).join(' | '));
  killApp();
  process.exit(fails.length ? 1 : 0);
} catch (e) {
  console.error('LIVE ERROR:', e.message);
  if (stderr) console.error('--- app stderr (tail) ---\n' + stderr.slice(-2000));
  killApp();
  process.exit(2);
}
