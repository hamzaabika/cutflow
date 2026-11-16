// Gap-build C — masked-reveal bisection: the live preview paints LIGHT
// SWEEP but never MASKED LINE. Try the clip with each slot stripped to find
// which one hides it: (A) maskedLineReveal alone, (B) + charScatter out,
// (C) + lightsweep loop, (D) charFade in + charScatter out + lightsweep
// loop, (E) no anim at all. Reads bandA (y 28-42%) of the real text layer.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9248;
const SCRATCH = '/home/hatch/workspace/.tmp-gap-c-live';
const resultsPath = path.join(SCRATCH, 'probe-mask.json');
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
  ...process.env, HOME: path.join(SCRATCH, 'home4'), DISPLAY: ':99',
  TMPDIR: path.join(SCRATCH, 'tmp4'),
  VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES || '/home/hatch/workspace/vulkan/lvp_icd.json',
};
for (const d of [path.join(SCRATCH, 'home4'), path.join(SCRATCH, 'tmp4')]) fs.mkdirSync(d, { recursive: true });
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
  const bandA = async (t) => ev(`(async () => {
    window.__fve.seek(${t});
    await new Promise((r) => setTimeout(r, 600));
    const cv = document.querySelector('canvas.text-layer');
    if (!cv) return null;
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const W = cv.width, H = cv.height;
    let n = 0;
    for (let y = Math.floor(H * 0.28); y < H * 0.42; y += 2) for (let x = 0; x < W; x += 2) {
      if (d[(y * W + x) * 4 + 3] > 20) n += 1;
    }
    return n;
  })()`);
  await until(`!!window.__fve`, 60000);
  step('app boots', true);
  await ev(`(() => { const b = document.querySelector('[aria-label="Create project"]'); if (b) b.click(); return !!b; })()`).catch(() => {});
  step('editor ready', await until(`!!document.querySelector('.play-btn')`, 90000));
  await until(`!!window.__fve`, 30000);
  await ev(`(() => { const b = document.querySelector('button[aria-label="Skip tour"]') || [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) b.click(); return !!b; })()`).catch(() => {});
  await sleep(1500);
  const base = { id: 't1', text: 'MASKED LINE', start: 0.5, duration: 2, y: 0.35, size: 32, color: '#ffffff' };
  const variants = {
    'A maskedLineReveal alone': { ...base, animIn: { id: 'maskedLineReveal', dur: 0.9 } },
    'B + charScatter out': { ...base, animIn: { id: 'maskedLineReveal', dur: 0.9 }, animOut: { id: 'charScatter', dur: 0.9 } },
    'C + lightsweep loop': { ...base, animIn: { id: 'maskedLineReveal', dur: 0.9 }, animLoop: { id: 'lightsweep', speed: 1 } },
    'D charFade in + charScatter out + lightsweep loop': { ...base, animIn: { id: 'charFade', dur: 0.9 }, animOut: { id: 'charScatter', dur: 0.9 }, animLoop: { id: 'lightsweep', speed: 1 } },
    'E no anim': { ...base },
  };
  for (const [name, clip] of Object.entries(variants)) {
    const project = {
      name: 'gapc-mask-probe', ratio: '16:9', resolution: 360, width: 640, height: 360, fps: 30, background: '#000000',
      media: [], videoClips: [], overlayClips: [], audioClips: [], stickerClips: [], effectClips: [],
      textClips: [clip],
    };
    await evFire(`window.__fve.load(${JSON.stringify(project)})`);
    await sleep(1500);
    const n = await bandA(1.2);
    step(`${name} paints`, n !== null && n > 0, `bandA pixels=${n}`);
  }
} catch (e) {
  failed = true;
  console.log('PROBE ERROR:', e.message);
  console.log('stderr tail:', stderr.slice(-1500));
}
kill();
if (results.some(([, ok]) => !ok)) failed = true;
console.log(failed ? 'probe-mask: FAILED' : 'probe-mask ok');
process.exit(failed ? 1 : 0);
