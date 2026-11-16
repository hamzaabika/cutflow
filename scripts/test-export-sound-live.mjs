// Live-app export-sound check: boots the real app headless (Xvfb) with a fresh
// profile and asserts the export-finished sound end to end:
//   1. the bundled export-done.mp3 decodes in Chromium (duration ~1.67 s)
//   2. a successful video export plays it exactly once (Audio.play called with
//      the export-done.mp3 URL)
//   3. with the Settings toggle off, a successful export plays nothing
//   4. a cancelled export plays nothing
//   5. the Settings › Quality toggle renders with the right label
// Run AFTER `npm run build`:  node scripts/test-export-sound-live.mjs
import { spawn, execFileSync } from 'node:child_process';
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
        pending.set(mid, { res, rej });
        const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)); }, 60000);
        const origRes = res; const origRej = rej;
        pending.set(mid, { res: (v) => { clearTimeout(timer); origRes(v); }, rej: (e) => { clearTimeout(timer); origRej(e); } });
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-exportsound-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-exportsound-home-'));
// No stubbing window.api.exportBegin: window.api is frozen (contextBridge), so a
// renderer-side stub silently never sticks and the real native save dialog hangs
// the export forever. Instead the main process takes its target from
// FVE_EXPORT_TARGET (electron/main.cjs, export:begin) — a preset path, no dialog.
// The file name matches the hook: ui-export.<fmt>, here mp4.
const outFile = path.join(dir, 'ui-export.mp4');
const clip = path.join(dir, 'clip.mp4');
const longClip = path.join(dir, 'long.mp4');
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', longClip]);
const probe = async (f) => ff.probe(f);
const mClip = await probe(clip);
const mLong = await probe(longClip);

const env = { ...process.env, HOME: home, DISPLAY: ':99', FVE_EXPORT_TARGET: dir };
const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron'),
  ['.', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: 'pipe', detached: true });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
child.on('exit', (code, signal) => { console.log(`[child] electron exited code=${code} signal=${signal}`); });
child.on('error', (e) => { console.log(`[child] spawn error: ${e.message}`); });

const shotDir = '/home/hatch/workspace/cutflow-shots/exportsound';
fs.mkdirSync(shotDir, { recursive: true });

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
  // Fire-and-forget: returns as soon as the expression STARTS, without
  // waiting for any promise it returns (exportNow resolves only when the
  // export finishes — awaiting it here would hang the harness).
  const evFire = async (expr) => {
    const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: false, returnByValue: true });
    if (r.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const shot = async (name) => {
    const { data } = await cdp.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(shotDir, name), Buffer.from(data, 'base64'));
  };
  const until = async (expr, ms = 120000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch { /* not yet */ } await sleep(500); }
    return false;
  };

  // Install the Audio.play probe BEFORE any export can complete. It is
  // (re)installed after every navigation-prone step: entering the editor and
  // loading a project can reload the page, which would drop the probe.
  const installProbe = async () => ev(`(() => {
    if (window.__soundProbeInstalled) { window.__soundProbe.length = 0; return 'probe re-armed'; }
    window.__soundProbe = [];
    window.__soundProbeInstalled = true;
    HTMLAudioElement.prototype.play = function () {
      try { window.__soundProbe.push({ src: this.currentSrc || this.src || '', at: Date.now() }); } catch {}
      return Promise.resolve();
    };
    return 'probe installed';
  })()`);
  await installProbe();
  await until(`!!window.__fve`, 60000);

  // 1. The bundled file decodes in Chromium with the expected duration.
  const decoded = await ev(`(async () => {
    const p = await window.api.bundledPath('sfx', 'export-done.mp3');
    const url = 'file:///' + p.replace(/\\\\/g, '/').split('/').map((s, i) => (i === 0 && /^[a-zA-Z]:$/.test(s) ? s : encodeURIComponent(s))).join('/');
    const a = new Audio();
    a.src = url;
    await new Promise((res, rej) => { a.onloadedmetadata = res; a.onerror = () => rej(new Error('audio error')); setTimeout(() => rej(new Error('metadata timeout')), 10000); });
    return { path: p, duration: a.duration };
  })()`);
  check('export-done.mp3 decodes in Chromium', decoded && Math.abs(decoded.duration - 1.67) < 0.15, `duration=${decoded?.duration}`);

  // Enter the editor (fresh profiles start on Home; the tour must be dismissed first).
  // The create tile is a div[role=button][aria-label="Create project"], not a <button>.
  await ev(`(() => { const b = document.querySelector('[aria-label="Create project"]'); if (b) b.click(); return !!b; })()`).catch(() => {});
  check('editor ready', await until(`!!document.querySelector('.play-btn')`, 60000));
  await ev(`(() => { const b = document.querySelector('button[aria-label="Skip tour"]') || [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) b.click(); return !!b; })()`).catch(() => {});
  await sleep(600);

  // The setting defaults ON for a fresh profile.
  const st0 = await ev(`window.api.settingsGet()`);
  check('export sound defaults ON', st0 && st0.exportSound === true, `exportSound=${st0?.exportSound}`);

  const mkProject = (media, meta, dur, extra = {}) => ({
    name: 'sound-test', ratio: '16:9', resolution: 180, width: 320, height: 180, fps: 30, background: '#000000',
    media: [{ id: 'm0', path: media, name: 'clip.mp4', ...meta }],
    videoClips: [{ id: 'v1', mediaId: 'm0', in: 0, out: dur, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
    overlayClips: [], audioClips: [], stickerClips: [], effectClips: [], textClips: [], ...extra,
  });

  // The native save dialog is bypassed by FVE_EXPORT_TARGET (see top of file):
  // exportBegin returns the preset target, so everything downstream (job queue,
  // tray, finishExportJob, the chime) runs for real — only the file-picker step
  // is skipped.
  check('export target preset via FVE_EXPORT_TARGET', fs.existsSync(dir));

  // 2. Successful export plays the chime exactly once.
  await evFire(`window.__fve.load(${JSON.stringify(mkProject(clip, mClip, 3))})`);
  await sleep(500);
  await installProbe();
  await evFire(`window.__fve.exportNow()`);
  check('export completes', await until(`!!document.querySelector('.xjob-state')`, 120000));
  const plays1 = await ev(`window.__soundProbe`);
  check('chime plays once on successful export', plays1.length === 1 && plays1[0].src.includes('export-done.mp3'), JSON.stringify(plays1));
  check('export file written', fs.existsSync(outFile));

  // 3. Toggle off: a successful export plays nothing.
  const stOff = await ev(`window.api.settingsSetExportSound(false)`);
  check('toggle off persists', stOff && stOff.exportSound === false);
  await installProbe();
  fs.rmSync(outFile, { force: true });
  await evFire(`window.__fve.exportNow()`);
  check('second export completes', await until(`!!document.querySelector('.xjob-state')`, 120000));
  const plays2 = await ev(`window.__soundProbe`);
  check('no chime when toggle is off', plays2.length === 0, JSON.stringify(plays2));

  // 4. Cancelled export plays nothing (toggle back on first).
  await ev(`window.api.settingsSetExportSound(true)`);
  await evFire(`window.__fve.load(${JSON.stringify(mkProject(longClip, mLong, 20, { exportSettings: { preset: 'ultra', custom: {} } }))})`);
  await sleep(500);
  await installProbe();
  await evFire(`window.__fve.exportNow()`);
  const running = await until(`!![...document.querySelectorAll('.xjob button')].find((b) => b.textContent.trim() === 'Cancel')`, 60000);
  check('long export reaches running state', running);
  if (running) {
    await ev(`[...document.querySelectorAll('.xjob button')].find((b) => b.textContent.trim() === 'Cancel').click()`);
    await sleep(3000);
  }
  const plays3 = await ev(`window.__soundProbe`);
  check('no chime on cancelled export', plays3.length === 0, JSON.stringify(plays3));

  // 5. The Settings › Playback quality toggle renders. The dialog has a left
  // rail; the export-sound section lives in the 'Playback quality' section
  // (set.sec.quality), NOT a tab literally called 'Quality', and the dialog
  // opens on the AI section by default.
  await ev(`(() => { const b = document.querySelector('button[aria-label="Menu"]'); if (b) b.click(); return !!b; })()`);
  await sleep(400);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Settings'); if (b) b.click(); return !!b; })()`);
  await sleep(500);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Playback quality'); if (b) b.click(); return !!b; })()`);
  await sleep(500);
  const toggleSeen = await ev(`document.body.innerText.includes('Play a sound when an export finishes')`);
  check('Settings Quality toggle renders', toggleSeen);
  await shot('settings-export-sound.png');

  console.log(`\nEXPORT SOUND LIVE: ${results.filter(([, ok]) => ok).length}/${results.length} checks passed — work dir ${dir}`);
  if (results.some(([, ok]) => !ok)) process.exitCode = 1;
} catch (e) {
  console.error('EXPORT SOUND LIVE ERROR:', e.message);
  console.error(stderr.slice(-3000));
  process.exitCode = 1;
} finally {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already dead */ }
}
