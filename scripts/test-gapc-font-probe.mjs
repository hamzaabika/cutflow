// Gap-build C — font-size spy: variant A (maskedLineReveal) paints at
// "900 0.09px" (microscopic) while D (charFade) and E (no anim) paint 158
// bandA pixels with the SAME size: 0.09 clip. Spy the font/rect/transform
// for A, D and E side by side to see where the size diverges.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9250;
const SCRATCH = '/home/hatch/workspace/.tmp-gap-c-live';
const resultsPath = path.join(SCRATCH, 'probe-font.json');
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
  ...process.env, HOME: path.join(SCRATCH, 'home6'), DISPLAY: ':99',
  TMPDIR: path.join(SCRATCH, 'tmp6'),
  VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES || '/home/hatch/workspace/vulkan/lvp_icd.json',
};
for (const d of [path.join(SCRATCH, 'home6'), path.join(SCRATCH, 'tmp6')]) fs.mkdirSync(d, { recursive: true });
const child = spawn('/home/hatch/workspace/.tmp-gap-c-live/electron-gapc-dist/cutflow-gapc',
  ['.', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-sandbox', '--disable-accelerated-video-decode', '--disable-accelerated-video-encode', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: 'pipe', detached: true });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } };
process.on('exit', kill);
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
  await until(`!!window.__fve`, 60000);
  console.log('app boots');
  await ev(`(() => { const b = document.querySelector('[aria-label="Create project"]'); if (b) b.click(); return !!b; })()`).catch(() => {});
  await until(`!!document.querySelector('.play-btn')`, 90000);
  await until(`!!window.__fve`, 30000);
  await ev(`(() => { const b = document.querySelector('button[aria-label="Skip tour"]') || [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) b.click(); return !!b; })()`).catch(() => {});
  await sleep(1500);
  await ev(`(() => {
    window.__spy = { fillText: [], measure: [] };
    const P = CanvasRenderingContext2D.prototype;
    const ft = P.fillText;
    P.fillText = function (text, x, y) {
      const m = this.getTransform();
      window.__spy.fillText.push({ text: String(text).slice(0, 12), x: +x.toFixed(1), y: +y.toFixed(1), alpha: this.globalAlpha, font: String(this.font).slice(0, 50), a: +m.a.toFixed(3), e: +m.e.toFixed(1), f: +m.f.toFixed(1) });
      return ft.call(this, text, x, y);
    };
    return 'spies installed';
  })()`);
  const base = { id: 't1', text: 'MASKED LINE', start: 0.5, duration: 2, y: 0.35, size: 0.09, color: '#ffffff' };
  const variants = {
    'A maskedLineReveal': { ...base, animIn: { id: 'maskedLineReveal', dur: 0.9 } },
    'D charFade+scatter+loop': { ...base, animIn: { id: 'charFade', dur: 0.9 }, animOut: { id: 'charScatter', dur: 0.9 }, animLoop: { id: 'lightsweep', speed: 1 } },
    'E no anim': { ...base },
  };
  const out = {};
  for (const [name, clip] of Object.entries(variants)) {
    const project = {
      name: 'gapc-font-probe', ratio: '16:9', resolution: 360, width: 640, height: 360, fps: 30, background: '#000000',
      media: [], videoClips: [], overlayClips: [], audioClips: [], stickerClips: [], effectClips: [],
      textClips: [clip],
    };
    await ev(`window.__spy.fillText.length = 0`);
    await evFire(`window.__fve.load(${JSON.stringify(project)})`);
    await sleep(1500);
    await ev(`window.__fve.seek(1.2)`);
    await sleep(800);
    out[name] = await ev(`window.__spy.fillText.slice(-4)`);
    console.log(name, JSON.stringify(out[name]));
  }
  fs.writeFileSync(resultsPath, JSON.stringify(out, null, 2));
} catch (e) {
  console.log('PROBE ERROR:', e.message);
  console.log('stderr tail:', stderr.slice(-1500));
}
kill();
console.log('probe-font done');
