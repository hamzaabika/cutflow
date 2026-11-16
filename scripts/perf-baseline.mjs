// P2-44 — Performance measurement program (baseline, BEFORE any optimisation).
// Boots the real dev app under Xvfb, drives it over CDP and records:
//   playback frame time (rAF p50/p95/p99) + dropped video frames,
//   seek-to-stable-frame latency, UI interaction latency,
//   proxy creation wall time (main-process makeProxy / makeLightProxy),
//   peak RSS of the Electron process tree + renderer JS heap.
// Writes JSON + Markdown to ~/workspace/cutflow-audit-20261115/p2-44-baseline-20261115.{json,md}
// Run AFTER `npm run build`:  node scripts/perf-baseline.mjs
// Env: DISPLAY=:99, VK_ICD_FILENAMES=~/workspace/vulkan/lvp_icd.json (lavapipe).
// No FVE_SMOKE (interactive run). No .deb, no push.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9229;
const HOME = '/tmp/fve-p2-d';
const OUT_DIR = '/home/hatch/workspace/cutflow-audit-20261115';
const ff = (await import('../electron/ffmpeg.cjs')).default;
const ffmpegPath = ff.ffmpegPath;

const results = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

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

// Peak RSS of the whole Electron tree, sampled on a timer.
let peakRssMB = 0;
let rssTimer = null;
function sampleRss() {
  try {
    let total = 0;
    for (const name of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const cmd = fs.readFileSync(`/proc/${name}/cmdline`, 'utf8');
        if (!cmd.includes('electron')) continue;
        const status = fs.readFileSync(`/proc/${name}/status`, 'utf8');
        const m = status.match(/VmRSS:\s*(\d+)\s*kB/);
        if (m) total += Number(m[1]) / 1024;
      } catch { /* process gone */ }
    }
    if (total > peakRssMB) peakRssMB = total;
  } catch { /* /proc hiccup */ }
}

fs.mkdirSync(HOME, { recursive: true });
const dir = fs.mkdtempSync(path.join(HOME, 'perf-'));
const home = fs.mkdtempSync(path.join(HOME, 'home-'));
const clip = path.join(dir, 'clip1080.mp4');
console.log('generating 1080p30 30s fixture…');
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30', '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip]);
const meta = await ff.probe(clip);
console.log(`fixture: ${meta.width}x${meta.height} ${meta.duration}s ${fs.statSync(clip).size} bytes`);

// Proxy wall time (main-process functions, plain Node — no app needed).
const cache = path.join(dir, 'cache');
const tProxy0 = Date.now();
const proxy = await ff.makeProxy({ path: clip, duration: meta.duration, width: 1920, height: 1080, hasAudio: true }, cache);
const proxyMs = Date.now() - tProxy0;
const tLight0 = Date.now();
const light = await ff.makeLightProxy({ path: clip, duration: meta.duration, width: 1920, height: 1080, hasAudio: true }, cache);
const lightMs = Date.now() - tLight0;
results.proxy = {
  makeProxyMs: proxyMs, makeProxyPath: proxy?.path || proxy || null,
  makeLightProxyMs: lightMs, makeLightProxyPath: light?.path || light || null,
  fixture: { width: meta.width, height: meta.height, duration: meta.duration },
};
console.log(`proxy: makeProxy=${proxyMs}ms light=${lightMs}ms`);

const env = {
  ...process.env, HOME: home, DISPLAY: ':99',
  VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES || '/home/hatch/workspace/vulkan/lvp_icd.json',
  TMPDIR: '/home/hatch/workspace/.tmp-p2-d-tmp',
};
const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron'),
  ['.', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: 'pipe', detached: true });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
rssTimer = setInterval(sampleRss, 500);

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
  const until = async (expr, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch { /* not yet */ } await sleep(250); }
    return false;
  };
  await until(`!!window.__fve`, 60000);

  // Dismiss the first-run Welcome modal (it swallows pointer hits) + tour.
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /got it|dismiss|close|start/i.test(x.textContent)); if (b) b.click(); return !!b; })()`).catch(() => {});
  await ev(`(() => { const b = document.querySelector('[aria-label="Create project"]'); if (b) b.click(); return !!b; })()`).catch(() => {});
  const editorReady = await until(`!!document.querySelector('.play-btn')`, 60000);
  console.log('editor ready:', editorReady);
  await ev(`(() => { const b = document.querySelector('button[aria-label="Skip tour"]') || [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) b.click(); return !!b; })()`).catch(() => {});
  await sleep(600);

  const project = {
    name: 'perf-baseline', ratio: '16:9', resolution: 1080, width: 1920, height: 1080, fps: 30, background: '#000000',
    media: [{ id: 'm0', path: clip, name: 'clip1080.mp4', ...meta }],
    videoClips: [{ id: 'v1', mediaId: 'm0', in: 0, out: 30, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
    overlayClips: [], audioClips: [], stickerClips: [], effectClips: [], textClips: [],
  };
  await ev(`window.__fve.load(${JSON.stringify(project)})`);
  await sleep(1500);

  // --- 1. Playback frame time: 10 s of playback, rAF deltas + video playback quality.
  const playback = await ev(`(async () => {
    const v = document.querySelector('video');
    if (!v) return { error: 'no video element' };
    const deltas = [];
    let last = 0; let frames = 0;
    const t0 = performance.now();
    await new Promise((res) => {
      const tick = (t) => {
        if (last) deltas.push(t - last);
        last = t; frames += 1;
        if (t - t0 < 10000) requestAnimationFrame(tick); else res();
      };
      window.__fve.play();
      requestAnimationFrame(tick);
    });
    window.__fve.pause();
    const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : {};
    const sorted = [...deltas].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p / 100 * sorted.length))];
    return {
      rafSamples: deltas.length, rafP50: at(50), rafP95: at(95), rafP99: at(99),
      rafMax: sorted[sorted.length - 1], rafMean: deltas.reduce((a, b) => a + b, 0) / deltas.length,
      longFramesOver33ms: deltas.filter((d) => d > 33.4).length,
      longFramesOver50ms: deltas.filter((d) => d > 50).length,
      videoTotalFrames: q.totalVideoFrames, videoDroppedFrames: q.droppedVideoFrames,
      videoDroppedPct: q.totalVideoFrames ? 100 * q.droppedVideoFrames / q.totalVideoFrames : null,
      videoCurrentTime: v.currentTime,
    };
  })()`);
  results.playback = playback;
  console.log('playback:', JSON.stringify(playback));

  // --- 2. Seek-to-stable-frame: 5 seeks, time to seeked + 2 rAF paints.
  const seeks = await ev(`(async () => {
    const v = document.querySelector('video');
    if (!v) return { error: 'no video element' };
    const times = [];
    for (const t of [3, 17, 8, 25, 12]) {
      const t0 = performance.now();
      window.__fve.seek(t);
      await new Promise((res) => { const h = () => { v.removeEventListener('seeked', h); res(); }; v.addEventListener('seeked', h); setTimeout(res, 5000); });
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      times.push(performance.now() - t0);
    }
    return { seeksMs: times };
  })()`);
  const seekArr = seeks.seeksMs || [];
  results.seek = { seeksMs: seekArr, p50: pct(seekArr, 50), p95: pct(seekArr, 95), max: seekArr.length ? Math.max(...seekArr) : null };
  console.log('seek:', JSON.stringify(results.seek));

  // --- 3. UI interaction latency: play-button click -> playing state + paint; scrub click -> seeked.
  const ui = await ev(`(async () => {
    const out = {};
    const btn = document.querySelector('.play-btn');
    if (btn) {
      const t0 = performance.now();
      btn.click();
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      out.playClickToPaintMs = performance.now() - t0;
      window.__fve.pause();
    }
    // Timeline ruler click (scrub) -> playhead moves.
    const ruler = document.querySelector('.timeline-ruler, [class*="ruler"], .tl-ruler');
    out.rulerFound = !!ruler;
    if (ruler) {
      const r = ruler.getBoundingClientRect();
      const t0 = performance.now();
      ruler.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left + r.width * 0.5, clientY: r.top + r.height / 2 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      out.scrubClickToPaintMs = performance.now() - t0;
    }
    return out;
  })()`);
  results.uiLatency = ui;
  console.log('ui latency:', JSON.stringify(ui));

  // --- 4. Memory: renderer heap + peak RSS so far.
  const heap = await ev(`(() => { const m = performance.memory || {}; return { jsHeapUsedMB: m.usedJSHeapSize ? m.usedJSHeapSize / 1048576 : null, jsHeapTotalMB: m.totalJSHeapSize ? m.totalJSHeapSize / 1048576 : null }; })()`);
  sampleRss();
  results.memory = { ...heap, peakElectronRssMB: Math.round(peakRssMB * 10) / 10 };
  console.log('memory:', JSON.stringify(results.memory));

  results.meta = {
    date: new Date().toISOString(), host: 'this VM (Xvfb :99, lavapipe software GL, 4 vCPU, 8 GB RAM)',
    electron: await ev(`navigator.userAgent`),
    fixtureDurationS: 30, fixtureRes: '1920x1080', fixtureFps: 30,
    playbackWindowMs: 10000, note: 'Baseline BEFORE any P2 optimisation. rAF deltas measured on the visible Xvfb window (not hidden-window throttled).',
  };
  results.bundle = { js: [], css: [], totalJsBytes: 0, totalCssBytes: 0 };
  const assets = fs.readdirSync(path.join(ROOT, 'dist', 'assets'));
  const js = assets.filter((f) => f.endsWith('.js')).map((f) => ({ file: f, bytes: fs.statSync(path.join(ROOT, 'dist', 'assets', f)).size }));
  const css = assets.filter((f) => f.endsWith('.css')).map((f) => ({ file: f, bytes: fs.statSync(path.join(ROOT, 'dist', 'assets', f)).size }));
  results.bundle = { js, css, totalJsBytes: js.reduce((a, b) => a + b.bytes, 0), totalCssBytes: css.reduce((a, b) => a + b.bytes, 0) };
} catch (e) {
  console.error('PERF BASELINE ERROR:', e.message);
  console.error(stderr.slice(-3000));
  results.error = e.message;
  process.exitCode = 1;
} finally {
  clearInterval(rssTimer);
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already dead */ }
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(OUT_DIR, `p2-44-baseline-${stamp}.json`), JSON.stringify(results, null, 2));
const md = `# P2-44 Performance baseline — ${stamp}

Measured on this VM (Xvfb :99, Mesa lavapipe software GL, 4 vCPU, 8 GB RAM) with the
real dev app, BEFORE any P2 optimisation. Fixture: 1920x1080 H.264 30 fps, 30 s
(testsrc2 + sine). Playback window 10 s. Full machine-readable numbers:
\`p2-44-baseline-${stamp}.json\`.

## Playback frame time (rAF deltas during 10 s playback)
- samples: ${results.playback?.rafSamples ?? 'n/a'}
- p50: ${results.playback?.rafP50?.toFixed(2) ?? 'n/a'} ms, p95: ${results.playback?.rafP95?.toFixed(2) ?? 'n/a'} ms, p99: ${results.playback?.rafP99?.toFixed(2) ?? 'n/a'} ms, mean: ${results.playback?.rafMean?.toFixed(2) ?? 'n/a'} ms, max: ${results.playback?.rafMax?.toFixed(2) ?? 'n/a'} ms
- frames over 33.4 ms: ${results.playback?.longFramesOver33ms ?? 'n/a'}, over 50 ms: ${results.playback?.longFramesOver50ms ?? 'n/a'}
- video element: total ${results.playback?.videoTotalFrames ?? 'n/a'} frames, dropped ${results.playback?.videoDroppedFrames ?? 'n/a'} (${results.playback?.videoDroppedPct?.toFixed(2) ?? 'n/a'}%)

## Seek-to-stable-frame (seek + seeked event + 2 rAF paints)
- seeks (ms): ${(results.seek?.seeksMs || []).map((x) => x.toFixed(0)).join(', ') || 'n/a'}
- p50: ${results.seek?.p50?.toFixed(0) ?? 'n/a'} ms, p95: ${results.seek?.p95?.toFixed(0) ?? 'n/a'} ms, max: ${results.seek?.max?.toFixed(0) ?? 'n/a'} ms

## UI interaction latency (click -> 2 rAF paints)
- play button click to paint: ${results.uiLatency?.playClickToPaintMs?.toFixed(1) ?? 'n/a'} ms
- timeline scrub click to paint: ${results.uiLatency?.scrubClickToPaintMs?.toFixed(1) ?? 'n/a'} ms (ruler found: ${results.uiLatency?.rulerFound ?? 'n/a'})

## Proxy creation wall time (1080p 30 s fixture)
- makeProxy: ${results.proxy?.makeProxyMs ?? 'n/a'} ms
- makeLightProxy: ${results.proxy?.makeLightProxyMs ?? 'n/a'} ms

## Memory
- renderer JS heap used: ${results.memory?.jsHeapUsedMB?.toFixed(1) ?? 'n/a'} MB (total ${results.memory?.jsHeapTotalMB?.toFixed(1) ?? 'n/a'} MB)
- peak Electron process-tree RSS during the run: ${results.memory?.peakElectronRssMB ?? 'n/a'} MB

## Bundle (dist/, ground truth for P2-28 before/after)
- JS total: ${results.bundle?.totalJsBytes ?? 'n/a'} bytes; CSS total: ${results.bundle?.totalCssBytes ?? 'n/a'} bytes
${(results.bundle?.js || []).map((j) => `- ${j.file}: ${j.bytes} bytes`).join('\n')}
${(results.bundle?.css || []).map((c) => `- ${c.file}: ${c.bytes} bytes`).join('\n')}

## Targets (from MASTER-SPEC P2-44 — NOT measured, do not universalise)
p95 frame < ~16.7 ms on 60 Hz for simple 1080p; dropped frames < 1% after warm-up;
seek-to-stable p95 < 250 ms with proxies; UI latency p95 < 100 ms. This baseline is
the "before" these targets are judged against, on this VM only.
`;
fs.writeFileSync(path.join(OUT_DIR, `p2-44-baseline-${stamp}.md`), md);
console.log(`\nPERF BASELINE written: ${OUT_DIR}/p2-44-baseline-${stamp}.{json,md}`);
