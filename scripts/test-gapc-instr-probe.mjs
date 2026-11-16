// Gap-build C — masked-reveal instrumentation: wrap the real 2D context's
// fillText/clip/rect/save/restore in the live app, load the masked clip
// alone, seek 1.2, and dump exactly what the renderer did — did fillText
// run, with what alpha/fill/transform, and what clip rect was installed?
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9249;
const SCRATCH = '/home/hatch/workspace/.tmp-gap-c-live';
const resultsPath = path.join(SCRATCH, 'probe-instr.json');
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
  ...process.env, HOME: path.join(SCRATCH, 'home5'), DISPLAY: ':99',
  TMPDIR: path.join(SCRATCH, 'tmp5'),
  VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES || '/home/hatch/workspace/vulkan/lvp_icd.json',
};
for (const d of [path.join(SCRATCH, 'home5'), path.join(SCRATCH, 'tmp5')]) fs.mkdirSync(d, { recursive: true });
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
  // Install the spies on the 2D prototype BEFORE loading the project.
  await ev(`(() => {
    window.__spy = { fillText: [], clip: [], rect: [] };
    const P = CanvasRenderingContext2D.prototype;
    const ft = P.fillText;
    P.fillText = function (text, x, y, maxWidth) {
      const m = this.getTransform();
      window.__spy.fillText.push({ text: String(text).slice(0, 20), x: +x.toFixed(1), y: +y.toFixed(1), alpha: this.globalAlpha, fill: String(this.fillStyle).slice(0, 30), font: String(this.font).slice(0, 40), a: +m.a.toFixed(3), d: +m.d.toFixed(3), e: +m.e.toFixed(1), f: +m.f.toFixed(1), filter: String(this.filter || '') });
      return ft.call(this, text, x, y, maxWidth);
    };
    const cl = P.clip;
    P.clip = function () { window.__spy.clip.push({ count: window.__spy.clip.length }); return cl.call(this); };
    const rc = P.rect;
    P.rect = function (x, y, w, h) { window.__spy.rect.push({ x: +x.toFixed(1), y: +y.toFixed(1), w: +w.toFixed(1), h: +h.toFixed(1) }); return rc.call(this, x, y, w, h); };
    return 'spies installed';
  })()`);
  const project = {
    name: 'gapc-instr', ratio: '16:9', resolution: 360, width: 640, height: 360, fps: 30, background: '#000000',
    media: [], videoClips: [], overlayClips: [], audioClips: [], stickerClips: [], effectClips: [],
    textClips: [
      { id: 't1', text: 'MASKED LINE', start: 0.5, duration: 2, y: 0.35, size: 0.09, color: '#ffffff', animIn: { id: 'maskedLineReveal', dur: 0.9 } },
    ],
  };
  await evFire(`window.__fve.load(${JSON.stringify(project)})`);
  await sleep(1500);
  await ev(`window.__fve.seek(1.2)`);
  await sleep(800);
  const spy = await ev(`(() => {
    const s = window.__spy;
    return {
      fillTextCalls: s.fillText.length,
      fillText: s.fillText.slice(-6),
      clipCalls: s.clip.length,
      rects: s.rect.slice(-6),
      canvas: (() => { const cv = document.querySelector('canvas.text-layer'); return cv ? [cv.width, cv.height] : null; })(),
    };
  })()`);
  console.log(JSON.stringify(spy, null, 2));
  fs.writeFileSync(resultsPath, JSON.stringify(spy, null, 2));
} catch (e) {
  console.log('PROBE ERROR:', e.message);
  console.log('stderr tail:', stderr.slice(-1500));
}
kill();
console.log('probe-instr done');
