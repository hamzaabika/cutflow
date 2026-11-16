// Font-load probe for FB-33 (before/after): boots the app, waits for
// ready + 3 s of idle, and reports document.fonts.size, the woff2
// resources fetched by startup, and the JS heap. The before build loads
// every bundled face at startup (fontsReady); the after build loads
// none until a font is used.
// Usage: node scripts/probe-fonts.mjs <root> <port>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2]);
const PORT = Number(process.argv[3] || 9251);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-fontprobe-'));
const env = {
  ...process.env, HOME: home, DISPLAY: ':99',
  VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES || '/home/hatch/workspace/vulkan/lvp_icd.json',
  TMPDIR: '/home/hatch/workspace/.tmp-battery',
};
const child = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'),
  ['.', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: 'ignore', detached: true });
try {
  let page = null;
  for (let i = 0; i < 120 && !page; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
    } catch { /* not up yet */ }
    if (!page) await sleep(250);
  }
  if (!page) throw new Error('CDP target never appeared');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  };
  const call = (method, params = {}) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await call('Runtime.enable');
  for (let i = 0; i < 120; i += 1) {
    const r = await call('Runtime.evaluate', { expression: `!!(window.__fve && document.querySelector('#root') && document.querySelector('#root').children.length)`, returnByValue: true });
    if (r?.result?.value) break;
    await sleep(250);
  }
  await sleep(3000);
  const r = await call('Runtime.evaluate', {
    expression: `(() => {
      const faces = [...document.fonts].map(f => f.family + ' ' + f.weight + ' ' + f.style);
      const woff2 = performance.getEntriesByType('resource').filter(e => e.name.endsWith('.woff2')).map(e => e.name.split('/').pop());
      const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null;
      return { faces: faces.length, woff2Fetched: woff2.length, woff2, heapUsedMB: mem,
        bundledFaces: faces.filter(f => !/^(Inter|Arial|Georgia|Garamond|Times|Impact|Segoe|Calibri|Verdana|Trebuchet|Comic|Consolas|Brush|Showcard|Cooper|Stencil|Broadway|Sakkal|Tahoma|Bahnschrift|Ink)/.test(f)).length };
    })()`,
    returnByValue: true,
  });
  console.log(JSON.stringify({ root: ROOT, ...r.result.value }));
  ws.close();
} finally {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already dead */ }
}
