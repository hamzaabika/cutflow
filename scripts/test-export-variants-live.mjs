// P2-26 live test: one batch export produces all three variants with correct
// framing. Boots the real app (Xvfb), loads a 16:9 project, runs the batch via
// the __fve hook (FVE_EXPORT_TARGET preset dir, no save dialog), then probes
// each output: dimensions must be 640x360 / 360x640 / 360x360, and the vertical
// frame's left/right edges must not be black (cover fill, not pillarbox).
// Also opens the Export dialog and checks the variants section renders.
// Run AFTER `npm run build`:  node scripts/test-export-variants-live.mjs
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9228;
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
const dir = fs.mkdtempSync(path.join(HOME, 'variants-'));
const home = fs.mkdtempSync(path.join(HOME, 'home-'));
const clip = path.join(dir, 'clip.mp4');
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
const meta = await ff.probe(clip);

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

const edgeLuma = (file, x) => {
  // Mean luma of a 10 px vertical strip at the frame's left/right edge, 1 s in.
  // signalstats stores its numbers as frame metadata; metadata=print emits them.
  const res = spawnSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'info', '-ss', '1', '-i', file, '-frames:v', '1',
    '-vf', `crop=10:ih:${x}:0,signalstats,metadata=print:key=lavfi.signalstats.YAVG`, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = (res.stderr || '').match(/lavfi\.signalstats\.YAVG=(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
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
    name: 'variants-test', ratio: '16:9', resolution: 360, width: 640, height: 360, fps: 30, background: '#000000',
    media: [{ id: 'm0', path: clip, name: 'clip.mp4', ...meta }],
    videoClips: [{ id: 'v1', mediaId: 'm0', in: 0, out: 3, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
    overlayClips: [], audioClips: [], stickerClips: [], effectClips: [],
    textClips: [{ id: 't1', text: 'Hello', start: 0, duration: 3, x: 0.5, y: 0.5 }],
  };
  await ev(`window.__fve.load(${JSON.stringify(project)})`);
  await sleep(1000);

  // The Export dialog shows the variants section with all three checked.
  await ev(`(() => { const b = document.querySelector('.btn-export'); if (b) b.click(); return !!b; })()`);
  check('export dialog opens', await until(`!!document.querySelector('.export-modal')`, 30000));
  const dialogText = await ev(`document.querySelector('.export-modal')?.innerText || ''`);
  check('dialog shows variants section', /Export variants/i.test(dialogText), dialogText.slice(0, 200));
  check('dialog shows batch button', /Export 3 variants/.test(dialogText));
  check('dialog shows variant sizes', /640×360/.test(dialogText) && /360×640/.test(dialogText) && /360×360/.test(dialogText));
  await ev(`(() => { const b = [...document.querySelectorAll('.export-modal button')].find((x) => x.textContent.trim() === 'Cancel'); if (b) b.click(); return !!b; })()`);
  await sleep(500);

  // Run the batch (all three variants) and wait for every file on disk.
  await evFire(`window.__fve.exportVariantsNow()`);
  const files = {
    horizontal: path.join(dir, 'variants-test_16x9.mp4'),
    vertical: path.join(dir, 'variants-test_9x16.mp4'),
    square: path.join(dir, 'variants-test_1x1.mp4'),
  };
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    if (Object.values(files).every((f) => fs.existsSync(f) && fs.statSync(f).size > 10000)) break;
    await sleep(1000);
  }
  for (const [id, f] of Object.entries(files)) {
    check(`${id} file written`, fs.existsSync(f) && fs.statSync(f).size > 10000, f);
  }
  const dims = {};
  for (const [id, f] of Object.entries(files)) {
    if (fs.existsSync(f)) {
      const p = await ff.probe(f);
      dims[id] = `${p.width}x${p.height}`;
    }
  }
  check('horizontal is 640x360', dims.horizontal === '640x360', dims.horizontal);
  check('vertical is 360x640', dims.vertical === '360x640', dims.vertical);
  check('square is 360x360', dims.square === '360x360', dims.square);

  // Correct framing: the vertical export must be a cover fill — its left/right
  // edge strips carry picture (testsrc2), not the black pillarbox bars a
  // scale-down+pad fit would leave.
  if (fs.existsSync(files.vertical)) {
    const left = edgeLuma(files.vertical, 0);
    const right = edgeLuma(files.vertical, 350);
    check('vertical frame filled (left edge not black)', left != null && left > 20, `YAVG left=${left}`);
    check('vertical frame filled (right edge not black)', right != null && right > 20, `YAVG right=${right}`);
  }

  console.log(`\nEXPORT VARIANTS LIVE: ${results.filter(([, ok]) => ok).length}/${results.length} checks passed — work dir ${dir}`);
  if (results.some(([, ok]) => !ok)) process.exitCode = 1;
} catch (e) {
  console.error('EXPORT VARIANTS LIVE ERROR:', e.message);
  console.error(stderr.slice(-3000));
  process.exitCode = 1;
} finally {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already dead */ }
}
