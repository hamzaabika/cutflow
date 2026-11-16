// Startup measurement (P2-28 before/after): spawn the dev app under Xvfb and
// time spawn -> first CDP target, and spawn -> __fve ready (editor mounted).
// Prints one JSON line per run: { targetMs, readyMs }. Run 3x, take the median.
// Usage: node scripts/measure-startup.mjs [--port 9229]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = Number(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] || 9229);
const HOME = '/tmp/fve-p2-d';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(HOME, { recursive: true });
const home = fs.mkdtempSync(path.join(HOME, 'startup-home-'));
const env = {
  ...process.env, HOME: home, DISPLAY: ':99',
  VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES || '/home/hatch/workspace/vulkan/lvp_icd.json',
  TMPDIR: '/home/hatch/workspace/.tmp-p2-d-tmp',
};
const t0 = Date.now();
const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron'),
  ['.', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: 'ignore', detached: true });
let targetMs = null;
let readyMs = null;
try {
  let page = null;
  for (let i = 0; i < 120 && !page; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
    } catch { /* not up yet */ }
    if (!page) await sleep(250);
  }
  targetMs = Date.now() - t0;
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
    if (r?.result?.value) { readyMs = Date.now() - t0; break; }
    await sleep(250);
  }
  ws.close();
  console.log(JSON.stringify({ targetMs, readyMs }));
  if (readyMs == null) process.exitCode = 1;
} finally {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already dead */ }
}
