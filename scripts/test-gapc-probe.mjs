// Gap-build C — bisection probe: attach to the already-running idle2 app
// (port 9245) and step through the exact live-driver actions one at a time,
// checking liveness after each, to find which step kills the app.
// Writes progress to probe-results.json. Does NOT spawn or kill electron.
import fs from 'node:fs';

const PORT = 9245;
const resultsPath = '/home/hatch/workspace/.tmp-gap-c-live/probe-results.json';
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
        const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)); }, 30000);
        pending.set(mid, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
        ws.send(JSON.stringify({ id: mid, method, params }));
      }),
      close: () => ws.close(),
    });
  });
}

let failed = false;
let skipped = false;
try {
  let list;
  try {
    list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  } catch {
    // Bisection probe, not a battery suite: it attaches to an app the
    // operator already started on port 9245. With no app listening there
    // is nothing to bisect — skip instead of failing the battery.
    console.log(`probe: SKIP — no app listening on 127.0.0.1:${PORT} (start the idle2 app first, then re-run)`);
    skipped = true;
    process.exit(0);
  }
  const page = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
  if (!page) throw new Error('no page target on 9245');
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  const ev = async (expr) => {
    const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const alive = async (label) => {
    try { const v = await ev(`1 + 1`); step(`alive after ${label}`, v === 2); return v === 2; }
    catch (e) { step(`alive after ${label}`, false, e.message); return false; }
  };
  const until = async (expr, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch { return false; } await sleep(1000); }
    return false;
  };

  step('attached to idle2', true);
  await until(`!!window.__fve`, 30000);
  step('harness present', true);
  await ev(`(() => { const b = document.querySelector('[aria-label="Create project"]'); if (b) b.click(); return !!b; })()`).catch(() => {});
  step('editor ready', await until(`!!document.querySelector('.play-btn')`, 60000));
  await until(`!!window.__fve`, 30000);
  await ev(`(() => { const b = document.querySelector('button[aria-label="Skip tour"]') || [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) b.click(); return !!b; })()`).catch(() => {});
  await sleep(1500);
  if (!await alive('entering editor')) throw new Error('dead after entering editor');

  await ev(`window.__fve.tab('text')`);
  await sleep(2000);
  if (!await alive('tab text')) throw new Error('dead after tab text');
  const gfx = await ev(`[...document.querySelectorAll('.lib-group-name')].map((e) => e.textContent.trim()).join('|')`);
  step('graphics group visible', gfx.includes('Graphics'), gfx);

  await ev(`(() => { const b = [...document.querySelectorAll('.tpl-btn')].find((x) => (x.getAttribute('title') || '').startsWith('Progress Ring')); if (b) b.click(); return !!b; })()`);
  await sleep(1500);
  if (!await alive('tile click')) throw new Error('dead after tile click');
  const n = await ev(`window.__fve.exportData().project.textClips.length`);
  step('tile click added clip', n === 1, `clips=${n}`);

  await ev(`window.__fve.dispatch({ type: 'undo' })`);
  await sleep(1000);
  if (!await alive('undo')) throw new Error('dead after undo');

  const { data } = await cdp.call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('/home/hatch/workspace/.tmp-gap-c-live/shots/probe-shot.png', Buffer.from(data, 'base64'));
  if (!await alive('screenshot')) throw new Error('dead after screenshot');

  await ev(`window.__fve.tab('transitions')`);
  await sleep(3000);
  if (!await alive('tab transitions (+3s)')) throw new Error('dead after tab transitions');
  await sleep(12000);
  if (!await alive('tab transitions (+15s)')) throw new Error('dead 15s after tab transitions');
  const tr = await ev(`document.body.textContent.includes('Signal Line Cut')`);
  step('transitions tab shows Signal Line Cut', !!tr);
  await sleep(15000);
  if (!await alive('tab transitions (+30s)')) throw new Error('dead 30s after tab transitions');

  await ev(`window.__fve.tab('effects')`);
  await sleep(3000);
  if (!await alive('tab effects')) throw new Error('dead after tab effects');
  const fx = await ev(`document.body.textContent.includes('Motion Echo')`);
  step('effects tab shows Motion Echo', !!fx);
  console.log('probe: app survived the whole UI walk');
} catch (e) {
  failed = true;
  console.log('PROBE ERROR:', e.message);
}
console.log(failed ? 'probe: FAILED' : 'probe ok');
process.exit(failed ? 1 : 0);
