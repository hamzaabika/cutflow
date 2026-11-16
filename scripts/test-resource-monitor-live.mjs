// P2-36 live test: the built-in resource monitor in the real app.
// Boots the app (Xvfb), loads a 1080p clip, and checks:
//   1. the Resources dialog opens and shows live CPU / RAM / GPU numbers
//      (GPU name + feature status; VRAM honestly marked as not reported)
//   2. playback keeps advancing while the monitor is open (the monitor's
//      2 s poll costs no frames)
//   3. after a real export, the finished job's cost row shows wall time,
//      peak RAM and speed (x realtime)
// Run AFTER `npm run build`:  node scripts/test-resource-monitor-live.mjs
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9229;
const HOME = '/tmp/fve-p2-d';
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

fs.mkdirSync(HOME, { recursive: true });
const dir = fs.mkdtempSync(path.join(HOME, 'resmon-'));
const home = fs.mkdtempSync(path.join(HOME, 'home-'));
const clip = path.join(dir, 'clip1080.mp4');
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
const meta = await ff.probe(clip);
const outFile = path.join(dir, 'ui-export.mp4');

const env = {
  ...process.env, HOME: home, DISPLAY: ':99', FVE_EXPORT_TARGET: dir,
  VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES || '/home/hatch/workspace/vulkan/lvp_icd.json',
  TMPDIR: '/home/hatch/workspace/.tmp-p2-d-tmp',
};
const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron'),
  ['.', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: 'pipe', detached: true });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });

try {
  const page = await waitTarget();
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  const ev = async (expr) => {
    const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const until = async (expr, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch { /* not yet */ } await sleep(500); }
    return false;
  };
  await until(`!!window.__fve`, 60000);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /got it|dismiss|close|start/i.test(x.textContent)); if (b) b.click(); return !!b; })()`).catch(() => {});
  await ev(`(() => { const b = document.querySelector('[aria-label="Create project"]') || document.querySelector('.home-create'); if (b) b.click(); return !!b; })()`).catch(() => {});
  await until(`!!document.querySelector('.play-btn')`, 60000);
  await ev(`(() => { const b = document.querySelector('button[aria-label="Skip tour"]') || [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) b.click(); return !!b; })()`).catch(() => {});

  const project = {
    name: 'resmon-test', ratio: '16:9', resolution: 1080, width: 1920, height: 1080, fps: 30, background: '#000000',
    media: [{ id: 'm0', path: clip, name: 'clip1080.mp4', ...meta }],
    videoClips: [{ id: 'v1', mediaId: 'm0', in: 0, out: 3, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
    overlayClips: [], audioClips: [], stickerClips: [], effectClips: [], textClips: [],
  };
  await ev(`window.__fve.load(${JSON.stringify(project)})`);
  await sleep(1500);

  // 1. The monitor opens and shows live numbers.
  await ev(`window.__fve.resources()`);
  await until(`!!document.querySelector('.resources-modal')`, 15000);
  await sleep(2500); // let the first 2 s poll land
  const monText = await ev(`document.querySelector('.resources-modal')?.textContent || ''`);
  check('monitor dialog renders', /Resources/.test(monText));
  check('CPU % shown', /\d+(\.\d+)?%/.test(monText), monText.slice(0, 160));
  check('RAM shown', /(MB|GB)/.test(monText));
  check('GPU device shown', /GPU/.test(monText) && monText.length > 100);
  check('VRAM honestly marked not reported', /not reported/i.test(monText));
  check('no exports yet note', /No exports yet/.test(monText));

  // 2. Playback keeps advancing while the monitor is open.
  await ev(`window.__fve.play()`);
  const t0 = await ev(`document.querySelector('video')?.currentTime ?? -1`);
  await sleep(3000);
  const t1 = await ev(`document.querySelector('video')?.currentTime ?? -1`);
  check('playback advances with monitor open', t1 > t0, `t ${t0} -> ${t1}`);
  await ev(`window.__fve.pause()`);

  // 3. A real export leaves a cost row (wall time, peak RAM, speed).
  await ev(`window.__fve.exportNow()`);
  let done = false;
  for (let i = 0; i < 120; i += 1) {
    await sleep(2000);
    if (fs.existsSync(outFile)) {
      const s1 = fs.statSync(outFile).size;
      await sleep(2000);
      if (fs.statSync(outFile).size === s1 && s1 > 0) { done = true; break; }
    }
  }
  check('export finished on disk', done && fs.statSync(outFile).size > 0);
  await sleep(1500); // let the tray settle the job
  const monText2 = await ev(`document.querySelector('.resources-modal')?.textContent || ''`);
  check('cost row shows wall time + peak RAM + speed', /\d+(\.\d+)?( s| ms)/.test(monText2) && /(MB|GB)/.test(monText2) && /×/.test(monText2), monText2.slice(-300));

  const failed = results.filter(([, ok]) => !ok).length;
  console.log(failed ? `P2-36 LIVE: ${failed} FAILED` : 'P2-36 LIVE OK');
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error('P2-36 LIVE ERROR:', e.message);
  console.error(stderr.slice(-2000));
  process.exitCode = 1;
} finally {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
}
