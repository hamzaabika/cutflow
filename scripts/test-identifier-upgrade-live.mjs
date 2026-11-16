// FB-22 (P1-40) — Linux upgrade-in-place test for legacy identifiers.
// Seeds a fake "old install" into ~/.config/ClipCraft/ (settings + one
// autosave slot, as a pre-rename build would have left them) and boots the
// current build TWICE against it. Passes only if both launches read the
// seeded settings and slot back, and no ~/.config/Cutflow directory is
// ever created — i.e. an installed user's data survives a reinstall of
// this build, because no identifier in the path changed.
// Run AFTER `npm run build`:  node scripts/test-identifier-upgrade-live.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9228;
const results = [];
const check = (name, cond, extra = '') => { results.push([name, !!cond]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };
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
    ws.onerror = (e) => reject(new Error('ws error ' + (e.message || '')));
    ws.onclose = () => { for (const { rej } of pending.values()) rej(new Error('ws closed')); pending.clear(); };
    ws.onopen = () => resolve({
      call: (method, params = {}) => new Promise((res, rej) => {
        if (ws.readyState !== 1) return rej(new Error('ws not open'));
        const mid = ++id;
        const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)); }, 60000);
        pending.set(mid, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
        try { ws.send(JSON.stringify({ id: mid, method, params })); }
        catch (e) { clearTimeout(timer); pending.delete(mid); rej(e); }
      }),
      close: () => ws.close(),
    });
  });
}

async function waitTarget() {
  // Under sibling-stream load the first paint can take well past 30 s.
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('CDP target never appeared');
}

// ---- Seed a fake old install (what a pre-rename build leaves on disk) ----
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-f4-upgrade-'));
const userData = path.join(home, '.config', 'ClipCraft');
const autosaveDir = path.join(userData, 'autosave');
fs.mkdirSync(autosaveDir, { recursive: true });
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ language: 'fr', quality: 'full', proxy: false }));
const slot = {
  id: 'oldinstall1',
  title: 'Old Install Project',
  file: null,
  ratio: '16:9',
  thumb: null,
  duration: 0,
  updatedAt: 1700000000000,
  trashedAt: null,
  project: { schemaVersion: 1, name: 'Old Install Project', ratio: '16:9', fps: 30, clips: [], media: [] },
};
fs.writeFileSync(path.join(autosaveDir, 'oldinstall1.json'), JSON.stringify(slot));
fs.writeFileSync(path.join(autosaveDir, 'index.json'), JSON.stringify([{ id: slot.id, title: slot.title, file: null, ratio: slot.ratio, thumb: null, duration: 0, updatedAt: slot.updatedAt, trashedAt: null }]));

const tmpDisk = path.join(process.env.HOME, 'workspace', '.tmp-cc-f4-live');
fs.mkdirSync(tmpDisk, { recursive: true });

async function boot(label) {
  const env = {
    ...process.env, HOME: home, DISPLAY: ':99',
    TMPDIR: tmpDisk,
    VK_ICD_FILENAMES: path.join(process.env.HOME, 'workspace', 'vulkan', 'lvp_icd.json'),
  };
  delete env.FVE_SMOKE;
  const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron'),
    ['.', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-sandbox', '--disable-accelerated-video-decode', '--disable-accelerated-video-encode', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`],
    { cwd: ROOT, env, stdio: 'pipe', detached: true });
  child.on('exit', (code, signal) => { console.log(`[child ${label}] electron exited code=${code} signal=${signal}`); });
  const page = await waitTarget();
  const cdp = await connect(page.webSocketDebuggerUrl);
  const ev = async (expr) => (await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;
  // Dismiss the first-run Welcome modal (it swallows pointer hits).
  for (let i = 0; i < 5; i += 1) {
    const gone = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) { b.click(); return false; } return !document.body.innerText.includes('Welcome to Cutflow'); })()`).catch(() => true);
    if (gone) break;
    await sleep(1000);
  }
  const settings = await ev(`window.api.settingsGet?.()`);
  check(`${label}: seeded settings survive (language fr)`, settings?.language === 'fr', JSON.stringify(settings?.language));
  const slots = await ev(`window.api.slotList?.()`);
  const found = Array.isArray(slots) && slots.some((s) => s.id === 'oldinstall1' && s.title === 'Old Install Project');
  check(`${label}: seeded autosave slot survives`, found, `slots=${Array.isArray(slots) ? slots.length : typeof slots}`);
  const slotBack = await ev(`window.api.slotRead?.('oldinstall1')`);
  check(`${label}: seeded slot project reads back`, slotBack?.project?.name === 'Old Install Project');
  check(`${label}: userData dir is still ClipCraft`, fs.existsSync(userData));
  check(`${label}: no Cutflow userData dir created`, !fs.existsSync(path.join(home, '.config', 'Cutflow')));
  cdp.close();
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  await sleep(1500);
}

try {
  await boot('launch 1');
  await boot('launch 2');
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

const fails = results.filter(([, ok]) => !ok).length;
console.log(fails === 0 ? 'test-identifier-upgrade-live: PASS' : `test-identifier-upgrade-live: ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
