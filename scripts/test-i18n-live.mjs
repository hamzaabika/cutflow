// Live-app i18n check: boots the built app headless (Xvfb) with a fresh
// profile whose OS language is Arabic, and asserts the spec end to end:
//   first start follows the OS language → Arabic UI, document dir=rtl;
//   the timeline and the player wrappers stay dir=ltr;
//   a saved Settings › Language choice (French) wins on the next start,
//   applies with dir=ltr and French chrome strings.
// It also captures the three review screenshots into
// ~/workspace/cutflow-shots/structureround/ (12-i18n-ar-home.png,
// 13-i18n-ar-editor.png, 14-i18n-fr-editor.png).
// Run AFTER `npm run build`:  node scripts/test-i18n-live.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9226;
const SHOTS = '/home/hatch/workspace/cutflow-shots/structureround';
const ar = (await import('../src/i18n/ar.js')).default;
const fr = (await import('../src/i18n/fr.js')).default;

fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, cond, extra = '') => { results.push([name, !!cond, extra]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };

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
    ws.onopen = () => resolve({
      call: (method, params = {}) => new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
      }),
      close: () => ws.close(),
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-i18n-live-'));
const env = { ...process.env, HOME: home, DISPLAY: ':99' };
const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron'),
  ['.', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`, '--lang=ar'],
  { cwd: ROOT, env, stdio: 'pipe', detached: true });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });

try {
  const page = await waitTarget();
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const ev = async (expr) => {
    const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await cdp.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
    console.log('shot', name);
  };
  const waitFor = async (expr, label, tries = 40) => {
    for (let i = 0; i < tries; i += 1) { try { if (await ev(expr)) return true; } catch { /* page mid-navigation */ } await sleep(500); }
    throw new Error('timeout waiting for ' + label);
  };

  // ---- First start, OS language Arabic → Arabic RTL home ----
  await waitFor(`!!document.querySelector('.home, .home-screen, main') || document.body.children.length > 0`, 'app shell');
  await waitFor(`document.documentElement.lang === 'ar'`, 'html lang=ar');
  check('first start (OS ar) sets html lang=ar', true);
  check('first start (OS ar) sets document dir=rtl', (await ev('document.documentElement.dir')) === 'rtl');
  check('home shows Arabic chrome', (await ev(`document.body.innerText.includes(${JSON.stringify(ar['home.createProject'])})`)) === true, ar['home.createProject']);
  await shot('12-i18n-ar-home.png');

  // ---- Open a project → editor: timeline + player stay LTR ----
  await ev(`document.querySelector('.home-create')?.click()`);
  await waitFor(`!!document.querySelector('section.timeline')`, 'editor timeline');
  await sleep(1200);
  check('editor: document dir still rtl', (await ev('document.documentElement.dir')) === 'rtl');
  check('editor: timeline wrapper dir=ltr', (await ev(`document.querySelector('section.timeline')?.getAttribute('dir')`)) === 'ltr');
  check('editor: player wrapper dir=ltr', (await ev(`document.querySelector('section.player')?.getAttribute('dir')`)) === 'ltr');
  check('editor: Export button is Arabic', (await ev(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === ${JSON.stringify(ar['topbar.export'])})`)) === true, ar['topbar.export']);
  await shot('13-i18n-ar-editor.png');

  // ---- Saved choice wins: set French, reload → French LTR editor ----
  await ev(`window.api.settingsSetLanguage('fr')`);
  const pub = await ev(`window.api.settingsGet()`);
  check('settings round-trip: language persisted as fr', pub && pub.language === 'fr', JSON.stringify(pub && pub.language));
  await cdp.call('Page.reload');
  await waitFor(`document.documentElement.lang === 'fr'`, 'html lang=fr after reload');
  // After reload the app sits on Home (the Arabic-session project was never
  // saved); open a fresh project the same way, now in French.
  await sleep(800);
  if (!(await ev(`!!document.querySelector('section.timeline')`))) {
    await ev(`document.querySelector('.home-create')?.click()`);
    await waitFor(`!!document.querySelector('section.timeline')`, 'editor after creating a project in French');
  }
  await sleep(800);
  check('saved fr: document dir=ltr', (await ev('document.documentElement.dir')) === 'ltr');
  check('saved fr: Export button is French', (await ev(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === ${JSON.stringify(fr['topbar.export'])})`)) === true, fr['topbar.export']);
  check('saved fr: timeline wrapper dir=ltr', (await ev(`document.querySelector('section.timeline')?.getAttribute('dir')`)) === 'ltr');
  await shot('14-i18n-fr-editor.png');

  cdp.close();
} catch (e) {
  console.error('LIVE ERROR:', e.message);
  console.error(stderr.slice(-800));
  results.push(['live run completed', false, e.message]);
} finally {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  fs.rmSync(home, { recursive: true, force: true });
}

const failed = results.filter(([, c]) => !c);
console.log(failed.length ? `test-i18n-live: FAIL (${failed.length}/${results.length})` : `test-i18n-live: PASS (${results.length} checks)`);
process.exit(failed.length ? 1 : 0);
