// P2-27 live test: proxy status is visible at rest, and a lower-res preview
// leaves the export untouched. Boots the real app (Xvfb), loads a 1080p clip,
// switches playback quality to Low, and checks:
//   1. the media panel's proxy status line shows the Low level going ready
//   2. proxy:status reports the level copy on disk (cache files > 0)
//   3. the media tile carries the Proxy badge
//   4. an export made while preview is Low still comes out 1920x1080
//   5. the tray shows the media-cache line while the export job runs
// Run AFTER `npm run build`:  node scripts/test-proxy-status-live.mjs
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9226;
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
const dir = fs.mkdtempSync(path.join(HOME, 'proxystatus-'));
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
  const until = async (expr, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch { /* not yet */ } await sleep(500); }
    return false;
  };
  await until(`!!window.__fve`, 60000);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /got it|dismiss|close|start/i.test(x.textContent)); if (b) b.click(); return !!b; })()`).catch(() => {});
  await ev(`(() => { const b = document.querySelector('[aria-label="Create project"]'); if (b) b.click(); return !!b; })()`).catch(() => {});
  check('editor ready', await until(`!!document.querySelector('.play-btn')`, 60000));
  await ev(`(() => { const b = document.querySelector('button[aria-label="Skip tour"]') || [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) b.click(); return !!b; })()`).catch(() => {});
  await sleep(600);

  const project = {
    name: 'proxy-test', ratio: '16:9', resolution: 1080, width: 1920, height: 1080, fps: 30, background: '#000000',
    media: [{ id: 'm0', path: clip, name: 'clip1080.mp4', ...meta }],
    videoClips: [{ id: 'v1', mediaId: 'm0', in: 0, out: 3, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
    overlayClips: [], audioClips: [], stickerClips: [], effectClips: [], textClips: [],
  };
  await ev(`window.__fve.load(${JSON.stringify(project)})`);
  await sleep(1500);

  // 1. The media panel shows the proxy status line at rest (no export running).
  check('proxy status line renders', await until(`!!document.querySelector('.proxy-status')`, 30000));
  const status0 = await ev(`document.querySelector('.proxy-status')?.textContent || ''`);
  check('status line names the quality level', /Preview (Full|High|Medium|Low)/.test(status0), status0);

  // 2. Switch to Low through the player quality menu (the real path: App's
  // onQualityChange persists the level AND updates the renderer's quality, so
  // the status line, the player and the main process all agree).
  await ev(`(() => { const b = document.querySelector('.quality-btn'); if (b) b.click(); return !!b; })()`);
  await sleep(400);
  const pickedLow = await ev(`(() => { const items = [...document.querySelectorAll('.transport-menu [role="menuitemradio"]')]; const low = items.find((b) => b.textContent.trim().startsWith('Low')); if (low) low.click(); return !!low; })()`);
  check('Low picked in the player quality menu', pickedLow);
  const wentReady = await until(`(document.querySelector('.proxy-status')?.textContent || '').includes('1 ready')`, 120000);
  const status1 = await ev(`document.querySelector('.proxy-status')?.textContent || ''`);
  check('Low copy goes ready in the status line', wentReady, status1);
  const st = await ev(`window.api.proxyStatus()`);
  check('proxy:status reports the copy on disk', st && st.files > 0, JSON.stringify(st && { files: st.files, quality: st.quality }));
  check('proxy:status quality is low', st && st.quality === 'low');
  check('media tile carries the Proxy badge', await until(`!!document.querySelector('.asset-opt.proxy')`, 30000));

  // 3. Export while preview is Low: the output must still be the 1080p original.
  // (The tray poll is blind to a finished job — the file on disk is ground truth.)
  await evFire(`window.__fve.exportNow()`);
  // The tray cache line shows while the job runs.
  const trayCache = await until(`[...document.querySelectorAll('.xjob-note')].some((n) => n.textContent.includes('Media cache:'))`, 60000);
  check('tray shows the media-cache line during the job', trayCache);
  const fileDone = await (async () => {
    const t0 = Date.now();
    let lastSize = -1; let stableSince = 0;
    while (Date.now() - t0 < 240000) {
      if (fs.existsSync(outFile)) {
        const size = fs.statSync(outFile).size;
        if (size === lastSize && size > 10000) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince > 2000) return true;
        } else { lastSize = size; stableSince = 0; }
      }
      await sleep(1000);
    }
    return false;
  })();
  check('export completes (file on disk, size stable)', fileDone);
  check('export file written', fs.existsSync(outFile));
  if (fs.existsSync(outFile)) {
    const p = await ff.probe(outFile);
    check('export is still 1920x1080 (preview Low untouched it)', p.width === 1920 && p.height === 1080, `${p.width}x${p.height}`);
  }

  console.log(`\nPROXY STATUS LIVE: ${results.filter(([, ok]) => ok).length}/${results.length} checks passed — work dir ${dir}`);
  if (results.some(([, ok]) => !ok)) process.exitCode = 1;
} catch (e) {
  console.error('PROXY STATUS LIVE ERROR:', e.message);
  console.error(stderr.slice(-3000));
  process.exitCode = 1;
} finally {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already dead */ }
}
