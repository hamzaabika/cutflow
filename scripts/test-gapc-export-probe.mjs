// Gap-build C — export diagnosis probe: load the exact gapc-live project,
// start exportNow(), and sample the export tray + job state every 15 s so a
// stall or error is visible instead of a bare timeout. Writes probe-export.json.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';

register('./css-stub-loader.mjs', import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9246;
const ff = (await import('../electron/ffmpeg.cjs')).default;
const ffmpegPath = ff.ffmpegPath;
const { graphicTemplateClips } = await import('../src/graphics/catalog.js');
const SCRATCH = '/home/hatch/workspace/.tmp-gap-c-live';
const OUTDIR = path.join(SCRATCH, 'out2');
for (const d of [OUTDIR, path.join(SCRATCH, 'home2'), path.join(SCRATCH, 'tmp2')]) fs.mkdirSync(d, { recursive: true });
const clipA = path.join(SCRATCH, 'clipA.mp4');
const clipB = path.join(SCRATCH, 'clipB.mp4');
const mA = await ff.probe(clipA);
const mB = await ff.probe(clipB);
const resultsPath = path.join(SCRATCH, 'probe-export.json');
const log = [];
const note = (o) => { log.push({ t: new Date().toISOString().slice(11, 19), ...o }); fs.writeFileSync(resultsPath, JSON.stringify(log, null, 2)); console.log(JSON.stringify(log[log.length - 1])); };
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
  ...process.env, HOME: path.join(SCRATCH, 'home2'), DISPLAY: ':99',
  FVE_EXPORT_TARGET: OUTDIR, TMPDIR: path.join(SCRATCH, 'tmp2'),
  VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES || '/home/hatch/workspace/vulkan/lvp_icd.json',
};
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
  const tray = async () => ev(`(() => {
    const jobs = [...document.querySelectorAll('.xjob')].map((j) => j.textContent.replace(/\\s+/g, ' ').slice(0, 200));
    const state = [...document.querySelectorAll('.xjob-state')].map((s) => s.textContent.trim());
    const files = ${JSON.stringify(fs.readdirSync(OUTDIR))};
    return { jobs, state, outDir: files };
  })()`).catch((e) => ({ error: e.message }));
  await until(`!!window.__fve`, 60000);
  note({ step: 'boots' });
  await ev(`(() => { const b = document.querySelector('[aria-label="Create project"]'); if (b) b.click(); return !!b; })()`).catch(() => {});
  await until(`!!document.querySelector('.play-btn')`, 90000);
  await until(`!!window.__fve`, 30000);
  await ev(`(() => { const b = document.querySelector('button[aria-label="Skip tour"]') || [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) b.click(); return !!b; })()`).catch(() => {});
  await sleep(1500);
  const project = {
    name: 'gapc-live', ratio: '16:9', resolution: 360, width: 640, height: 360, fps: 30, background: '#000000',
    media: [
      { id: 'm0', path: clipA, name: 'clipA.mp4', type: 'video', duration: mA.duration, width: mA.width, height: mA.height, hasAudio: true },
      { id: 'm1', path: clipB, name: 'clipB.mp4', type: 'video', duration: mB.duration, width: mB.width, height: mB.height, hasAudio: true },
    ],
    videoClips: [
      { id: 'v1', mediaId: 'm0', in: 0, out: 2, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: ['fx_heathaze'], transition: null },
      { id: 'v2', mediaId: 'm1', in: 0, out: 2, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: ['fx_motionecho'], transition: { type: 'fx_signalline', duration: 0.5 } },
    ],
    overlayClips: [], audioClips: [], stickerClips: [], effectClips: [],
    textClips: [
      ...graphicTemplateClips('progress-ring', 0.5),
      { id: 't-mask', text: 'MASKED LINE', start: 0.5, duration: 2, y: 0.35, size: 32, color: '#ffffff', animIn: { id: 'maskedLineReveal', dur: 0.9 }, animOut: { id: 'charScatter', dur: 0.9 }, animLoop: { id: 'lightsweep', speed: 1 } },
      { id: 't-sweep', text: 'LIGHT SWEEP', start: 0.5, duration: 2, y: 0.65, size: 32, color: '#ffffff', animIn: { id: 'lightSweepReveal', dur: 0.9 }, animLoop: { id: 'typeOsc', speed: 1 } },
    ],
  };
  await evFire(`window.__fve.load(${JSON.stringify(project)})`);
  await sleep(2000);
  note({ step: 'project loaded' });
  await evFire(`window.__fve.exportNow()`);
  note({ step: 'exportNow fired' });
  for (let i = 0; i < 16; i += 1) {
    await sleep(15000);
    const t = await tray();
    note({ step: `t+${(i + 1) * 15}s`, ...t });
    if (t.state && t.state.length) break;
  }
} catch (e) {
  note({ error: e.message, stderrTail: stderr.slice(-1500) });
}
kill();
console.log('probe-export done');
