// F1 live CDP verification — FB-02 / FB-31 / FB-32 / FB-03 / FB-04 in the
// running app. One Electron launch; each item loads its own scene via
// __fve.load, drives the real UI where the acceptance is about the UI,
// and reads the store back via __fve.exportData.
// Usage: node scripts/test-f1-live.mjs
// Exit 0 only when every check passes. Screenshots: ~/workspace/cutflow-shots/f1/
import { execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const execFileP = promisify(execFile);
const require = createRequire(import.meta.url);
const { probe, ffmpegPath } = require('../electron/ffmpeg.cjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9231;
const RUN = fs.mkdtempSync(path.join('/home/hatch/workspace/.tmp-battery', 'fve-f1live-'));
const home = fs.mkdtempSync(path.join(RUN, 'home-'));
const work = fs.mkdtempSync(path.join(RUN, 'work-'));
const SHOTS = '/home/hatch/workspace/cutflow-shots/f1';
fs.mkdirSync(SHOTS, { recursive: true });
console.log(`run dir ${RUN} (kept for evidence)`);

const stamp = () => new Date().toTimeString().slice(0, 8);
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- fixtures: 10 s + 30 s 640x360 testsrc2 + 440 Hz sine -----------------
const clip10 = path.join(work, 'clip10.mp4');
const clip30 = path.join(work, 'clip30.mp4');
for (const [file, dur] of [[clip10, 10], [clip30, 30]]) {
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=30:duration=${dur}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${dur}`, '-shortest',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
}
const meta10 = await probe(clip10);
const meta30 = await probe(clip30);
console.log(`fixtures: clip10 ${meta10.duration.toFixed(1)}s, clip30 ${meta30.duration.toFixed(1)}s`);

// --- CDP harness (same shape as test-export-scale.mjs) --------------------
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => resolve({
      call: (method, params = {}, timeoutMs = 30000) => new Promise((res, rej) => {
        const mid = ++id;
        const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
        pending.set(mid, (m) => { clearTimeout(timer); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); });
        ws.send(JSON.stringify({ id: mid, method, params }));
      }),
      close: () => ws.close(),
    });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    ws.onerror = (e) => reject(e);
  });
}
const waitTarget = async () => {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error('no CDP page target after 30s');
};
let cdp;
const ev = async (expr) => (await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evFire = (expr) => cdp.call('Runtime.evaluate', { expression: expr, returnByValue: true });
const until = async (expr, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await ev(expr)) return true; } catch { /* retry */ }
    await sleep(500);
  }
  return false;
};
const shot = async (name) => {
  // CDP captureScreenshot is throttled to uselessness on this rig
  // (hidden Xvfb window); grab the real X display instead — the
  // PhotoCraft recipe, proven here. Other streams share :99, so bring
  // our window to the front first or the shot shows theirs.
  // A missed shot is evidence lost, not a failed feature — warn and
  // continue.
  try { await ev(`window.__fve.pause()`).catch(() => {}); } catch { /* ignore */ }
  await sleep(300);
  try {
    await cdp.call('Page.bringToFront').catch(() => {});
    await sleep(300);
    execFileSync('/usr/bin/ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'x11grab', '-video_size', '1920x1080', '-i', ':99', '-frames:v', '1',
      path.join(SHOTS, `${name}.png`)]);
    console.log(`${stamp()} shot ${name}.png (x11grab)`);
  } catch (e) {
    console.log(`WARN  shot ${name} failed (${e?.message || e}) — continuing`);
  }
};
// The first-run Welcome modal can appear on Home AND on entering the
// editor, and it can appear AFTER the first dismiss attempt — poll
// until it is really gone. It swallows pointer hits, so every UI
// drive must run after this.
const dismissWelcome = async () => {
  for (let i = 0; i < 20; i++) {
    const gone = await ev(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /^(Start creating|Skip tour)$/.test(x.textContent.trim()));
      if (b) { b.click(); return false; }
      return ![...document.querySelectorAll('*')].some((x) => x.children.length === 0 && x.textContent.trim() === 'Welcome to Cutflow');
    })()`).catch(() => true);
    if (gone) return true;
    await sleep(500);
  }
  return false;
};
const key = async (k, code, vk, modifiers) => {
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
};
const mouse = async (type, x, y, button = 'left') => {
  await cdp.call('Input.dispatchMouseEvent', { type, x, y, button, clickCount: type === 'mousePressed' ? 1 : 0 });
};
const proj = async () => (await ev(`window.__fve.exportData()`)).project;
// A load only counts once the project actually landed (poll the name):
// on this throttled rig a fixed sleep can leave dispatches racing a
// render that has not committed yet.
const load = async (p) => {
  await evFire(`window.__fve.load(${JSON.stringify(p)})`);
  const ok = await until(`window.__fve.exportData().project.name === '${p.name}'`, 15000);
  if (!ok) throw new Error(`project ${p.name} never landed`);
  await sleep(400);
};

// --- launch (hardlinked binary: 'pkill -x electron' cannot see it) --------
const env = {
  ...process.env, HOME: home, DISPLAY: ':99', FVE_EXPORT_TARGET: work, TMPDIR: work,
  VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES || '/home/hatch/workspace/vulkan/lvp_icd.json',
  LIBGL_ALWAYS_SOFTWARE: '1',
};
delete env.FVE_SMOKE;
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
child.stderr.on('data', (d) => { childStderr += d.toString(); });

const killChild = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } };
try {
  const wsUrl = await waitTarget();
  cdp = await connect(wsUrl);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  check('app harness ready', await until(`!!window.__fve`, 120000));
  await dismissWelcome();
  await ev(`(() => { const b = document.querySelector('[aria-label="Create project"]'); if (b) b.click(); return !!b; })()`).catch(() => {});
  check('editor ready', await until(`!!document.querySelector('.play-btn')`, 180000));
  check('welcome modal dismissed', await dismissWelcome());
  await sleep(600);

  // ============ FB-32 · safe-zone toggles + drag guides =====================
  console.log(`${stamp()} --- FB-32 safe zones ---`);
  await load({
    name: 'f1-safezones', ratio: '9:16', resolution: 720, width: 720, height: 1280, fps: 30, background: '#000000',
    media: [{ id: 'm', path: clip10, name: 'clip10.mp4', ...meta10 }],
    videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 10, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
    overlayClips: [], audioClips: [], stickerClips: [], effectClips: [],
    textClips: [{ id: 'tx', text: 'GUIDE TEST', start: 0, duration: 10, x: 0.5, y: 0.25, size: 56 }],
  });
  await ev(`(() => { const b = document.querySelector('[aria-label="Safe zones"]'); if (b) b.click(); return !!b; })()`);
  await sleep(400);
  const menuOpen = await ev(`!!document.querySelector('[role="menu"][aria-label="Safe zones"]')`);
  check('FB-32 safe-zones menu opens', menuOpen);
  await ev(`(() => { const items = [...document.querySelectorAll('[role="menuitemcheckbox"]')]; const t = items.find((x) => /Title safe/.test(x.textContent)); if (t) t.click(); return !!t; })()`);
  await sleep(400);
  let zones = await ev(`document.querySelectorAll('.safe-zone').length`);
  check('FB-32 title-safe rect renders', zones >= 1, `${zones} rect(s)`);
  await ev(`(() => { const items = [...document.querySelectorAll('[role="menuitemcheckbox"]')]; const t = items.find((x) => /Action safe/.test(x.textContent)); if (t) t.click(); return !!t; })()`);
  await sleep(400);
  zones = await ev(`document.querySelectorAll('.safe-zone').length`);
  check('FB-32 action-safe rect renders too', zones >= 2, `${zones} rect(s)`);
  await shot('fb32-safe-zones');
  // Safe zones are view-only: capture the text clip BEFORE the drag
  // below moves it, and assert the toggles left it alone.
  const txBefore = (await proj()).textClips[0];
  check('FB-32 toggles do not touch clips', txBefore.x === 0.5 && txBefore.y === 0.25, `x=${txBefore.x} y=${txBefore.y}`);
  // Drag guides: select the text clip, drag its box toward the stage
  // centre; a .tbox-guide must appear while the centre is within SNAP_PX.
  // Fine steps: the snap zone is only 6 stage-px wide, so coarse steps
  // can jump straight over it between checks.
  await dismissWelcome();
  await ev(`window.__fve.select({track:'text', id:'tx'})`);
  await sleep(600);
  const drag = await ev(`(() => {
    const box = document.querySelector('.tbox');
    const stage = document.querySelector('.stage') || document.querySelector('[class*="stage"]');
    if (!box || !stage) return null;
    const b = box.getBoundingClientRect(), s = stage.getBoundingClientRect();
    return { cx: b.left + b.width / 2, cy: b.top + b.height / 2, sx: s.left + s.width / 2, sy: s.top + s.height / 2 };
  })()`);
  let guideSeen = false;
  if (drag) {
    await mouse('mousePressed', drag.cx, drag.cy);
    await sleep(300);
    const steps = 40;
    for (let i = 1; i <= steps; i++) {
      const x = drag.cx + ((drag.sx - drag.cx) * i) / steps;
      const y = drag.cy + ((drag.sy - drag.cy) * i) / steps;
      await mouse('mouseMoved', x, y);
      await sleep(80);
      if (await ev(`!!document.querySelector('.tbox-guide')`)) { guideSeen = true; break; }
    }
    if (!guideSeen) {
      // Hold exactly on the centre for a beat, then check once more.
      await mouse('mouseMoved', drag.sx, drag.sy);
      await sleep(400);
      guideSeen = await ev(`!!document.querySelector('.tbox-guide')`);
    }
    await mouse('mouseReleased', drag.sx, drag.sy);
    await shot('fb32-drag-guide');
  }
  check('FB-32 centre guides show while dragging', guideSeen, drag ? '' : 'no .tbox found');

  // ============ FB-31 · frame hold as a clip property ======================
  console.log(`${stamp()} --- FB-31 frame hold ---`);
  await load({
    name: 'f1-hold', ratio: '16:9', resolution: 720, width: 1280, height: 720, fps: 30, background: '#000000',
    media: [{ id: 'm', path: clip10, name: 'clip10.mp4', ...meta10 }],
    videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 10, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
    overlayClips: [], audioClips: [], stickerClips: [], effectClips: [], textClips: [],
  });
  await dismissWelcome();
  await ev(`window.__fve.select({track:'video', id:'v'})`);
  // FB-29 unified inspector defaults to Basic, which hides the Speed tab
  // (levelTabs('basic') = video + adjust only) — switch to Advanced first
  // or the Speed click below is a silent no-op and every FB-31 check fails.
  await ev(`(() => { const b = [...document.querySelectorAll('.ci-levels button')].find((x) => x.textContent.trim() === 'Advanced'); if (b) b.click(); return !!b; })()`);
  await sleep(500);
  // __fve.tab() switches the app-level left panel, NOT the inspector's
  // tabs — the Speed tab is a role=tab button inside .ci-tabs.
  await ev(`(() => { const b = [...document.querySelectorAll('.ci-tabs [role="tab"]')].find((x) => x.textContent.trim() === 'Speed'); if (b) b.click(); return !!b; })()`);
  await sleep(500);
  check('FB-31 hold section in Speed tab', await ev(`!![...document.querySelectorAll('.clip-inspector *')].find((x) => x.children.length === 0 && x.textContent === 'Frame hold')`));
  await ev(`window.__fve.seek(2)`);
  await sleep(300);
  await ev(`(() => { const t = document.querySelector('[aria-label="Frame hold"]'); if (t) t.click(); return !!t; })()`);
  await sleep(500);
  const hold = (await proj()).videoClips[0].frameHold;
  check('FB-31 toggle sets the hold at the playhead', !!hold && Math.abs(hold.at - 2) < 0.05 && Math.abs(hold.duration - 1) < 0.05, JSON.stringify(hold));
  await shot('fb31-hold-inspector');
  // Preview freeze: under swiftshader the <video> element decodes its
  // first frame and then stalls (readyState 1, no new frames), so the
  // observable is its clock, not its paused flag: while the playhead
  // runs 2.5 -> ~2.9 inside the hold [2,3), the element must stay seeked
  // to the held frame at 2.0. (A 1.5 s sleep overshoots the hold window
  // and reads the resumed clock at ~4.0.)
  await ev(`window.__fve.seek(2.5)`);
  await ev(`window.__fve.play()`);
  await sleep(400);
  const frozen = await ev(`(() => {
    const v = [...document.querySelectorAll('video')].find((x) => x.readyState >= 1 && x.videoWidth > 0);
    const m = document.body.innerText.match(/(\\d{2}:\\d{2}\\.\\d{2}) \\/ (\\d{2}:\\d{2}\\.\\d{2})/);
    return { ct: v ? +v.currentTime.toFixed(2) : null, paused: v ? v.paused : null, shown: m ? m[1] : null };
  })()`);
  const isFrozen = frozen.ct !== null && Math.abs(frozen.ct - 2) < 0.15;
  check('FB-31 preview freezes inside the hold', isFrozen, `element ct=${frozen.ct} (hold frame 2.0, paused=${frozen.paused}), transport shows ${frozen.shown}`);
  await ev(`window.__fve.pause()`);
  // Export with the hold: frames inside the hold must be pixel-identical
  // (the frozen frame), while frames outside it differ (moving testsrc2).
  await evFire(`window.__fve.exportNow()`);
  let outFile = null;
  {
    const t0 = Date.now();
    let stable = 0, lastSize = -1;
    while (Date.now() - t0 < 300000) {
      const mp4s = fs.readdirSync(work).filter((f) => f.endsWith('.mp4') && f !== 'clip10.mp4' && f !== 'clip30.mp4');
      const cand = mp4s.map((f) => path.join(work, f)).find((f) => fs.statSync(f).size > 1000000);
      if (cand) {
        const size = fs.statSync(cand).size;
        stable = size === lastSize ? stable + 1 : 0;
        lastSize = size;
        if (stable >= 6) {
          try { const pm = await probe(cand); if (pm && pm.width) { outFile = cand; break; } } catch { /* still writing */ }
          stable = 0;
        }
      } else { stable = 0; lastSize = -1; }
      await sleep(2000);
    }
  }
  check('FB-31 hold export completes', !!outFile, outFile || 'no output after 300s');
  if (outFile) {
    const grab = async (t, name) => {
      const png = path.join(work, name);
      execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', outFile, '-frames:v', '1', png]);
      return png;
    };
    const psnrPair = async (a, b) => {
      let out = '';
      try {
        out = (await execFileP(ffmpegPath, ['-hide_banner', '-loglevel', 'info', '-i', a, '-i', b, '-filter_complex', 'psnr', '-f', 'null', '-'])).stderr;
      } catch (e) { out = e.stderr || ''; }
      const m = /average:\s*(inf|[\d.]+)/.exec(out);
      return m ? (m[1] === 'inf' ? 99 : parseFloat(m[1])) : NaN;
    };
    const inHold = await psnrPair(await grab(2.2, 'f22.png'), await grab(2.8, 'f28.png'));
    const outside = await psnrPair(await grab(0.5, 'f05.png'), await grab(1.5, 'f15.png'));
    check('FB-31 exported hold is pixel-static', inHold >= 45, `${inHold} dB`);
    check('FB-31 control: moving frames differ', outside < 30, `${outside} dB`);
  }

  // ============ FB-02 · overlapping cut ranges ============================
  console.log(`${stamp()} --- FB-02 overlapping cuts ---`);
  await load({
    name: 'f1-cut', ratio: '16:9', resolution: 720, width: 1280, height: 720, fps: 30, background: '#000000',
    media: [{ id: 'm', path: clip10, name: 'clip10.mp4', ...meta10 }],
    videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 10, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
    overlayClips: [], audioClips: [], stickerClips: [], effectClips: [],
    textClips: [
      { id: 't1', text: 'first', start: 1, duration: 3, x: 0.5, y: 0.5, size: 56 },
      { id: 't2', text: 'second', start: 5, duration: 4, x: 0.5, y: 0.5, size: 56 },
    ],
  });
  await ev(`window.__fve.dispatch({type:'cutRanges', ranges:[{start:2,end:4},{start:3,end:5}], rippleText:true})`);
  await sleep(500);
  const cut = await proj();
  const dur = await ev(`window.__fve.duration()`);
  check('FB-02 [{2,4},{3,5}] removes exactly 3 s', Math.abs(dur - 7) < 0.01, `duration=${dur}`);
  const t1 = cut.textClips.find((c) => c.id === 't1');
  const t2 = cut.textClips.find((c) => c.id === 't2');
  check('FB-02 text ripples with the cut', t1 && t1.start === 1 && t1.duration === 1 && t2 && t2.start === 2 && t2.duration === 4,
    `t1@${t1?.start}+${t1?.duration} t2@${t2?.start}+${t2?.duration}`);
  check('FB-02 video closes up into 2 pieces', cut.videoClips.length === 2, cut.videoClips.map((c) => c.id).join(','));

  // ============ FB-03 · ripple modes ======================================
  console.log(`${stamp()} --- FB-03 ripple modes ---`);
  // NOTE: the node test's scene uses a bare media entry (no path). That
  // wedges the live app: a media entry without a path blanks the editor
  // tree and every later dispatch becomes a no-op (bisected in diags 5-8;
  // a real project always carries a file + probe meta, so the live scene
  // uses clip30). The bare-media blanking is reported, not fixed here
  // (missing-media robustness is checklist #16 — out of scope).
  const rippleScene = (name = 'f1-ripple') => ({
    name, ratio: '16:9', resolution: 720, width: 1280, height: 720, fps: 30, background: '#000000',
    media: [{ id: 'm', path: clip30, name: 'clip30.mp4', ...meta30 }],
    videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 10, speed: 1, linkId: 'L1', muted: true }],
    audioClips: [
      { id: 'src', mediaId: 'm', start: 0, in: 0, out: 10, speed: 1, linkId: 'L1', linkOff: 0, linkInOff: 0, cleanVoice: { on: true, steps: { duck: true } } },
      { id: 'music', mediaId: 'm', start: 0, in: 0, out: 10, speed: 1, layer: 1 },
    ],
    overlayClips: [
      { id: 'o1', mediaId: 'm', in: 0, out: 2, speed: 1, start: 1 },
      { id: 'o2', mediaId: 'm', in: 0, out: 2, speed: 1, start: 4 },
      { id: 'o3', mediaId: 'm', in: 0, out: 2, speed: 1, start: 7 },
    ],
    textClips: [
      { id: 't1', text: 'first half', start: 0, duration: 5, x: 0.5, y: 0.5, size: 56 },
      { id: 't2', text: 'second half', start: 5, duration: 5, x: 0.5, y: 0.5, size: 56 },
    ],
    effectClips: [{ id: 'e1', kind: 'fx', fx: 'fade', start: 2, duration: 6 }],
    layerState: { 'audio:1': { locked: true } },
  });
  check('FB-03 mode selector in the timeline toolbar',
    await ev(`(() => { const s = document.querySelector('select.ripple-mode'); return s && s.options.length === 3; })()`));
  await shot('fb03-ripple-select');
  // linked: captions + the linked pair ripple; overlays + music stay.
  // Distinct names per load: the load poll matches on name, and three
  // loads all named 'f1-ripple' would make it return instantly.
  await load(rippleScene('f1-ripple-linked'));
  await ev(`window.__fve.dispatch({type:'setProject', patch:{rippleMode:'linked'}, transient:true})`);
  await ev(`window.__fve.dispatch({type:'cutRanges', ranges:[{start:3,end:5}], rippleText:true})`);
  await sleep(500);
  let rp = await proj();
  check('FB-03 linked: picture closes up', rp.videoClips.length === 2, rp.videoClips.map((c) => c.id).join(','));
  const rt1 = rp.textClips.find((c) => c.id === 't1');
  const rt2 = rp.textClips.find((c) => c.id === 't2');
  check('FB-03 linked: captions ripple', rt1?.start === 0 && rt1?.duration === 3 && rt2?.start === 3 && rt2?.duration === 5,
    `t1@${rt1?.start}+${rt1?.duration} t2@${rt2?.start}+${rt2?.duration}`);
  // Repair re-pairs cut pieces as L1 (first) + L1~cut1 (rest): count the
  // linked audio across all of them — 8 s of source for 8 s of picture.
  const linkedAudioLen = rp.audioClips.filter((c) => (c.linkId || '').startsWith('L1')).reduce((s, c) => s + (c.out - c.in), 0);
  check('FB-03 linked: linked audio stays in sync', rp.audioClips.find((c) => c.id === 'src')?.start === 0 && linkedAudioLen === 8,
    `src pieces: ${rp.audioClips.filter((c) => (c.linkId || '').startsWith('L1')).map((c) => `${c.id}@${c.start}[${c.in}..${c.out}]`).join(' ')}`);
  check('FB-03 linked: overlays do not move', rp.overlayClips.find((c) => c.id === 'o1')?.start === 1, `o1@${rp.overlayClips.find((c) => c.id === 'o1')?.start}`);
  check('FB-03 linked: locked music does not move', rp.audioClips.find((c) => c.id === 'music')?.start === 0, `music@${rp.audioClips.find((c) => c.id === 'music')?.start}`);
  // One undo step restores the whole cut (clip count, not duration: the
  // locked 10 s music keeps the project duration at 10 either way).
  await ev(`window.__fve.dispatch({type:'undo'})`);
  await sleep(400);
  check('FB-03 one undo restores the cut', (await proj()).videoClips.length === 1, `video pieces=${(await proj()).videoClips.length}`);
  // all: every unlocked free-track clip ripples too.
  await load(rippleScene('f1-ripple-all'));
  await ev(`window.__fve.dispatch({type:'setProject', patch:{rippleMode:'all'}, transient:true})`);
  await ev(`window.__fve.dispatch({type:'cutRanges', ranges:[{start:3,end:5}], rippleText:true})`);
  await sleep(500);
  rp = await proj();
  check('FB-03 all: overlays ripple', rp.overlayClips.find((c) => c.id === 'o2')?.start === 3 && rp.overlayClips.find((c) => c.id === 'o3')?.start === 5,
    `o2@${rp.overlayClips.find((c) => c.id === 'o2')?.start} o3@${rp.overlayClips.find((c) => c.id === 'o3')?.start}`);
  check('FB-03 all: locked music still does not move', rp.audioClips.find((c) => c.id === 'music')?.start === 0);
  // main: only the picture moves (captions stay without rippleText).
  await load(rippleScene('f1-ripple-main'));
  await ev(`window.__fve.dispatch({type:'setProject', patch:{rippleMode:'main'}, transient:true})`);
  await ev(`window.__fve.dispatch({type:'cutRanges', ranges:[{start:3,end:5}], rippleText:false})`);
  await sleep(500);
  rp = await proj();
  check('FB-03 main: audio + captions + overlays stay', rp.audioClips.find((c) => c.id === 'src')?.start === 0
    && rp.textClips.find((c) => c.id === 't1')?.start === 0 && rp.overlayClips.find((c) => c.id === 'o1')?.start === 1);

  // ============ FB-04 · J-cuts / L-cuts ===================================
  console.log(`${stamp()} --- FB-04 J/L cuts ---`);
  await load({
    name: 'f1-jl', ratio: '16:9', resolution: 720, width: 1280, height: 720, fps: 30, background: '#000000',
    media: [{ id: 'm', path: clip30, name: 'clip30.mp4', ...meta30 }],
    videoClips: [
      { id: 'g', gap: true, in: 0, out: 2 },
      { id: 'v', mediaId: 'm', in: 2, out: 12, speed: 1, muted: true, linkId: 'L1' },
    ],
    audioClips: [
      { id: 'a', mediaId: 'm', start: 2, in: 2, out: 12, speed: 1, linkId: 'L1', linkOff: 0, linkInOff: 0 },
      { id: 'a2', mediaId: 'm', start: 5, in: 3, out: 13, speed: 1, linkId: 'L2', linkOff: 0, linkInOff: 0 },
    ],
    overlayClips: [{ id: 'o', mediaId: 'm', start: 5, in: 3, out: 13, speed: 1, linkId: 'L2' }],
    stickerClips: [], effectClips: [], textClips: [],
  });
  await ev(`window.__fve.select({track:'audio', id:'a'})`);
  await sleep(500);
  // InspCard's id is only a collapse-persistence key — it never lands
  // in the DOM. Find the section by its title text instead.
  check('FB-04 J-cut/L-cut section in the audio inspector', await ev(`[...document.querySelectorAll('.insp-card-title')].some((x) => x.textContent.trim() === 'J-cut / L-cut')`));
  await ev(`window.__fve.dispatch({type:'setAudioTrim', id:'a', lead:1.5, trail:2})`);
  await sleep(400);
  let jl = (await proj()).audioClips.find((c) => c.id === 'a');
  check('FB-04 setAudioTrim moves the audio window, not the picture',
    jl.start === 0.5 && jl.in === 0.5 && jl.out === 14 && jl.audioTrim?.lead === 1.5 && jl.audioTrim?.trail === 2,
    `a@${jl.start}[${jl.in}..${jl.out}] trim=${JSON.stringify(jl.audioTrim)}`);
  const jlLabel = await ev(`(() => { const els = [...document.querySelectorAll('.clip-label, [class*="clip-label"]')]; const t = els.map((e) => e.textContent).join(' | '); return t; })()`);
  check('FB-04 timeline audio label shows J/L tags', /J 1\.50/.test(jlLabel) && /L 2\.00/.test(jlLabel), jlLabel.slice(0, 200));
  await shot('fb04-jl-inspector');
  // Shortcuts: Alt+J with the playhead before the picture sets the lead;
  // Alt+L with the playhead after the picture sets the trail.
  await ev(`window.__fve.select({track:'video', id:'v'})`);
  await ev(`window.__fve.seek(1)`);
  await sleep(300);
  await key('j', 'KeyJ', 74, 1); // Alt
  await sleep(500);
  jl = (await proj()).audioClips.find((c) => c.id === 'a');
  if (!(jl.audioTrim?.lead === 1)) {
    // Fallback: synthetic key event (menu accelerators can swallow Alt+J).
    await ev(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'j', code:'KeyJ', altKey:true, bubbles:true, cancelable:true}))`);
    await sleep(500);
    jl = (await proj()).audioClips.find((c) => c.id === 'a');
  }
  check('FB-04 Alt+J sets the lead to the playhead', jl.audioTrim?.lead === 1 && jl.start === 1, `lead=${jl.audioTrim?.lead} start=${jl.start}`);
  await ev(`window.__fve.seek(13)`);
  await sleep(300);
  await key('l', 'KeyL', 76, 1); // Alt
  await sleep(500);
  jl = (await proj()).audioClips.find((c) => c.id === 'a');
  if (!(jl.audioTrim?.trail === 1)) {
    await ev(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'l', code:'KeyL', altKey:true, bubbles:true, cancelable:true}))`);
    await sleep(500);
    jl = (await proj()).audioClips.find((c) => c.id === 'a');
  }
  check('FB-04 Alt+L sets the trail to the playhead', jl.audioTrim?.trail === 1 && jl.out === 13, `trail=${jl.audioTrim?.trail} out=${jl.out}`);
  // Resync button clears the trims.
  await dismissWelcome();
  await ev(`window.__fve.select({track:'audio', id:'a'})`);
  await sleep(400);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Resync audio'); if (b) b.click(); return !!b; })()`);
  await sleep(400);
  jl = (await proj()).audioClips.find((c) => c.id === 'a');
  check('FB-04 Resync clears the trims', jl.audioTrim === undefined && jl.start === 2 && jl.in === 2 && jl.out === 12,
    `a@${jl.start}[${jl.in}..${jl.out}] trim=${JSON.stringify(jl.audioTrim)}`);
  await shot('fb04-after-resync');
} catch (err) {
  console.error(`F1 LIVE ERROR: ${err?.message || err}`);
  if (childStderr) console.error(childStderr.slice(-3000));
  failures += 1;
} finally {
  killChild();
  try { cdp?.close(); } catch { /* already closed */ }
}
console.log(`\nF1 LIVE: ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURE(S)`} — run dir ${RUN} — shots ${SHOTS}`);
process.exit(failures === 0 ? 0 : 1);
