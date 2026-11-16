// Gap-build C — text-anim paint probe: the live preview/export show the
// progress ring but NOT the two new text anims (maskedLineReveal,
// lightSweepReveal), although the node stub test paints them. Load a project
// with ONLY the two text clips and read the real text-layer canvas pixels —
// if it paints, the anims work and the full-project difference is elsewhere;
// if it stays blank, the new anims have a real-canvas bug (stub clip() is a
// no-op, so it cannot see a degenerate clip path).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9247;
const SCRATCH = '/home/hatch/workspace/.tmp-gap-c-live';
const resultsPath = path.join(SCRATCH, 'probe-text.json');
const results = [];
const step = (name, ok, extra = '') => {
  results.push([name, !!ok, extra]);
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};
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
const env = {
  ...process.env, HOME: path.join(SCRATCH, 'home3'), DISPLAY: ':99',
  TMPDIR: path.join(SCRATCH, 'tmp3'),
  VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES || '/home/hatch/workspace/vulkan/lvp_icd.json',
};
for (const d of [path.join(SCRATCH, 'home3'), path.join(SCRATCH, 'tmp3')]) fs.mkdirSync(d, { recursive: true });
const child = spawn('/home/hatch/workspace/.tmp-gap-c-live/electron-gapc-dist/cutflow-gapc',
  ['.', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-sandbox', '--disable-accelerated-video-decode', '--disable-accelerated-video-encode', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: 'pipe', detached: true });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } };
process.on('exit', kill);
let failed = false;
try {
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl)) break;
    } catch {}
    await sleep(500);
  }
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
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
  const until = async (expr, ms = 90000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch { return false; } await sleep(1000); }
    return false;
  };
  // Reads the REAL text-layer canvas: total painted pixels + painted pixels
  // in the MASKED LINE band (y 28-42% of height) and LIGHT SWEEP band
  // (y 58-72%), where the ring never reaches.
  const layerStats = async (t) => ev(`(async () => {
    window.__fve.seek(${t});
    await new Promise((r) => setTimeout(r, 600));
    const cv = document.querySelector('canvas.text-layer');
    if (!cv) return null;
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const W = cv.width, H = cv.height;
    let total = 0, bandA = 0, bandB = 0, whiteA = 0;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      const a = d[(y * W + x) * 4 + 3];
      if (a > 20) {
        total += 1;
        const fy = y / H;
        if (fy > 0.28 && fy < 0.42) { bandA += 1; if (d[(y * W + x) * 4] > 200 && d[(y * W + x) * 4 + 1] > 200 && d[(y * W + x) * 4 + 2] > 200) whiteA += 1; }
        if (fy > 0.58 && fy < 0.72) bandB += 1;
      }
    }
    return { total, bandA, bandB, whiteA, w: W, h: H };
  })()`);
  await until(`!!window.__fve`, 60000);
  step('app boots', true);
  await ev(`(() => { const b = document.querySelector('[aria-label="Create project"]'); if (b) b.click(); return !!b; })()`).catch(() => {});
  step('editor ready', await until(`!!document.querySelector('.play-btn')`, 90000));
  await until(`!!window.__fve`, 30000);
  await ev(`(() => { const b = document.querySelector('button[aria-label="Skip tour"]') || [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) b.click(); return !!b; })()`).catch(() => {});
  await sleep(1500);

  // Project with ONLY the two new text anims (no ring, no video) on a black
  // background, so any painted pixel must be one of the two clips.
  const project = {
    name: 'gapc-text-probe', ratio: '16:9', resolution: 360, width: 640, height: 360, fps: 30, background: '#000000',
    media: [], videoClips: [], overlayClips: [], audioClips: [], stickerClips: [], effectClips: [],
    textClips: [
      { id: 't-mask', text: 'MASKED LINE', start: 0.5, duration: 2, y: 0.35, size: 32, color: '#ffffff', animIn: { id: 'maskedLineReveal', dur: 0.9 }, animOut: { id: 'charScatter', dur: 0.9 }, animLoop: { id: 'lightsweep', speed: 1 } },
      { id: 't-sweep', text: 'LIGHT SWEEP', start: 0.5, duration: 2, y: 0.65, size: 32, color: '#ffffff', animIn: { id: 'lightSweepReveal', dur: 0.9 }, animLoop: { id: 'typeOsc', speed: 1 } },
    ],
  };
  await evFire(`window.__fve.load(${JSON.stringify(project)})`);
  await sleep(2000);
  const s07 = await layerStats(0.7);
  step('masked text paints at lt=0.2 (mid-reveal)', s07 && s07.bandA > 0, JSON.stringify(s07));
  const s12 = await layerStats(1.2);
  step('masked text paints at lt=0.7 (revealed)', s12 && s12.bandA > 0 && s12.whiteA > 0, JSON.stringify(s12));
  step('light sweep paints at lt=0.7', s12 && s12.bandB > 0, JSON.stringify(s12));
  const s20 = await layerStats(2.0);
  step('text still paints at lt=1.5 (animOut scattering)', s20 && (s20.bandA > 0 || s20.bandB > 0), JSON.stringify(s20));
  // Control: the SAME clips with a plain built-in anim (slideUp) must paint —
  // if they do, the fault is in the new anims, not the clips/project.
  const control = {
    ...project,
    textClips: [
      { id: 't-c', text: 'CONTROL TEXT', start: 0.5, duration: 2, y: 0.5, size: 32, color: '#ffffff', animIn: { id: 'slideUp', dur: 0.5 } },
    ],
  };
  await evFire(`window.__fve.load(${JSON.stringify(control)})`);
  await sleep(2000);
  const sc = await layerStats(1.2);
  step('control clip (slideUp) paints', sc && sc.total > 0, JSON.stringify(sc));
} catch (e) {
  failed = true;
  console.log('PROBE ERROR:', e.message);
  console.log('stderr tail:', stderr.slice(-1500));
}
kill();
if (results.some(([, ok]) => !ok)) failed = true;
console.log(failed ? 'probe-text: FAILED' : 'probe-text ok');
process.exit(failed ? 1 : 0);
