// P2-30 live test: the hardened shell:open / shell:show IPCs refuse dangerous paths
// end-to-end in the real app, and app:openHelp still refuses unlisted hosts.
// Boots the real app (Xvfb) and calls the preload bridge; the positive paths
// (a real export opens, a real log reveals) are covered by the unit tests
// test-shell-open.cjs / test-help-hosts.cjs, because opening a real file would
// launch the OS default app in this VM.
// Run AFTER `npm run build`:  node scripts/test-p2-30-live.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9229;
const HOME = '/tmp/fve-p2-d';

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
const dir = fs.mkdtempSync(path.join(HOME, 'p2-30-'));
const home = fs.mkdtempSync(path.join(HOME, 'home-'));
const evil = path.join(dir, 'evil.sh');
fs.writeFileSync(evil, '#!/bin/sh\necho pwned > ' + path.join(dir, 'pwned.txt') + '\n');
fs.chmodSync(evil, 0o755);

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

try {
  const page = await waitTarget();
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  const ev = async (expr) => {
    const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
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

  check('bridge exposes openFile/showInFolder/openHelp',
    await ev(`typeof window.api.openFile === 'function' && typeof window.api.showInFolder === 'function' && typeof window.api.openHelp === 'function'`));
  check('openFile refuses an executable script',
    await ev(`window.api.openFile(${JSON.stringify(evil)})`) === false, evil);
  check('openFile refuses a system file',
    await ev(`window.api.openFile('/etc/passwd')`) === false);
  check('showInFolder refuses a system file',
    await ev(`window.api.showInFolder('/etc/passwd')`) === false);
  check('openHelp refuses an unlisted host',
    await ev(`window.api.openHelp('https://example.com/')`) === false);
  check('no side effect: the script never ran',
    !fs.existsSync(path.join(dir, 'pwned.txt')));

  const failed = results.filter(([, ok]) => !ok).length;
  console.log(failed ? `P2-30 LIVE: ${failed} FAILED` : 'P2-30 LIVE OK');
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error('P2-30 LIVE ERROR:', e.message);
  console.error(stderr.slice(-2000));
  process.exitCode = 1;
} finally {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
}
