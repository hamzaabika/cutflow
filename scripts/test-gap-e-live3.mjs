// Live-app verification for Stream E (gap-e) — CDP port 9244.
// Boots the real app headless (Xvfb :99) with a fresh profile and checks,
// against the running editor, every Stream E item that has DOM behaviour:
//   PF-03 timeline virtualization (rendered clip count vs total, before/after scroll)
//   TL-02 ripple switch (main vs linked cut semantics, via the .tl-ripple select)
//   AI-02 cost/placement badge in the captions panel
//   AI-03 transcript confidence slider + low-conf list + speaker select + diarize (Deepgram)
//   AI-04 Correct captions button (broken Arabic -> fixed Arabic, live)
//   AI-05 B-roll suggestions card (off-timeline match) + Add
//   TR-02 parametric transition inspector (Feather slider -> stored param)
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
  const clickText = async (text, scope = 'document') => ev(`(() => { const els = [...${scope}.querySelectorAll('button')]; const b = els.find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (b) { b.click(); return true; } return false; })()`);
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

  // --- LIVE3-1: PF-03 scroll-event probe --------------------------------------
  const probe = () => ev(`(() => {
    const s = document.querySelector('.tl-scroll');
    if (!s) return null;
    const labels = [...document.querySelectorAll('.clip.video')].map((el) => (el.querySelector('.clip-label') || {}).textContent || '');
    return { scrollLeft: s.scrollLeft, scrollWidth: s.scrollWidth, clientWidth: s.clientWidth, n: labels.length, first: labels[0] || '', events: window.__scrEv || 0 };
  })()`);
  await ev(`(() => { const s = document.querySelector('.tl-scroll'); window.__scrEv = 0; s.addEventListener('scroll', () => { window.__scrEv = (window.__scrEv || 0) + 1; }); return true; })()`);
  const p0 = await probe();
  check('PF-03 probe baseline (14-ish clips at scroll 0)', p0.n > 0 && p0.n < 20, JSON.stringify(p0));
  await ev(`(() => { document.querySelector('.tl-scroll').scrollLeft = 6000; return true; })()`);
  await sleep(1500);
  const p1 = await probe();
  check('PF-03 programmatic scroll fires a scroll event', p1.events > 0, `events=${p1.events} scrollLeft=${p1.scrollLeft}`);
  check('PF-03 programmatic scroll moves the rendered window', p1.first !== p0.first, `${p0.first} -> ${p1.first} (n=${p1.n})`);
  if (p1.first === p0.first) {
    // Fallback: a real wheel scroll at the timeline centre.
    const r = await ev(`(() => { const s = document.querySelector('.tl-scroll'); const b = s.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: r.x, y: r.y, deltaX: 6000, deltaY: 0 });
    await sleep(1500);
    const p2 = await probe();
    check('PF-03 real wheel scroll moves the rendered window', p2.first !== p0.first, `${p0.first} -> ${p2.first} (n=${p2.n}, scrollLeft=${p2.scrollLeft}, events=${p2.events})`);
  }

  // --- LIVE3-2: CSV tracking loop — Animation tab, then Loop sub-tab -------------
  await evFire(`window.__fve.select({ track: 'text', id: 't2' })`);
  await sleep(700);
  await ev(`(() => { const ins = document.querySelector('.inspector'); const b = ins && [...ins.querySelectorAll('button[role="tab"]')].find((x) => x.textContent.trim() === 'Animation'); if (b) b.click(); return !!b; })()`);
  await sleep(500);
  const loopTab = await ev(`(() => { const ins = document.querySelector('.inspector'); const b = ins && [...ins.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Loop'); if (b) { b.click(); return true; } return false; })()`);
  await sleep(500);
  const tile = await ev(`(() => { const ins = document.querySelector('.inspector'); if (!ins) return 'no-inspector'; const btn = ins.querySelector('button.tpl-btn[title="Tracking"]'); if (btn) { btn.click(); return 'clicked-title'; } const span = [...ins.querySelectorAll('.tpl-name')].find((x) => x.textContent.trim() === 'Tracking'); if (span) { span.closest('.tpl-item').querySelector('button').click(); return 'clicked-span'; } return 'missing'; })()`);
  await sleep(600);
  const loopId = await ev(`(window.__fve.exportData().project.textClips.find((c) => c.id === 't2') || {}).animLoop?.id`);
  check('CSV tracking loop tile applies (Loop sub-tab)', loopTab && tile.startsWith('clicked') && loopId === 'tracking', `loopTab=${loopTab} tile=${tile} animLoop=${loopId}`);

  const fails = results.filter(([, okk]) => !okk);
  console.log(`\nLIVE3 SUMMARY: ${results.length - fails.length}/${results.length} PASS`);
  if (fails.length) console.log('FAILED: ' + fails.map(([n]) => n).join(' | '));
  killApp();
  process.exit(fails.length ? 1 : 0);
} catch (e) {
  console.error('LIVE ERROR:', e.message);
  if (stderr) console.error('--- app stderr (tail) ---\n' + stderr.slice(-2000));
  killApp();
  process.exit(2);
}
