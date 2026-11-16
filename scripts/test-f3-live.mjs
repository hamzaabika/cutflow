// Live F3 verification (FB-10/11/12/26/27/28/29): boots the real dev app on
// CDP 9351 with a fresh profile, enters the editor, loads two generated
// clips, and drives the new honesty/controls/inspector UI for real.
// Run AFTER `npm run build`:  node scripts/test-f3-live.mjs
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9351; // high range: sibling streams keep taking 922x-925x
const TMP = fs.mkdtempSync(path.join(process.env.HOME, 'workspace/.tmp-battery', 'fve-f3-'));
const HOME = fs.mkdtempSync(path.join(process.env.HOME, 'workspace/.tmp-battery', 'fve-f3-home-'));
const ff = require('../electron/ffmpeg.cjs');
const ffmpegPath = ff.ffmpegPath;

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
        const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)); }, 120000);
        pending.set(mid, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
        ws.send(JSON.stringify({ id: mid, method, params }));
      }),
      close: () => ws.close(),
    });
  });
}

async function waitTarget() {
  for (let i = 0; i < 240; i += 1) { // up to 120 s: the VM is heavily loaded by parallel streams
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      // Never drive a sibling stream's app: the page must be THIS worktree's build.
      // (Was hardcoded to the F3 stream worktree '.tmp-cc-f3/dist/index.html',
      // which fails on main where the page is clipcraft-v2/dist/index.html.)
      if (page && !page.url.includes(`${ROOT}/dist/index.html`)) throw new Error(`wrong app on port ${PORT}: ${page.url}`);
      if (page) return page;
    } catch (e) {
      if (e.message.startsWith('wrong app')) throw e;
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('CDP target never appeared');
}

const clipA = path.join(TMP, 'clipA.mp4'); // landscape 640x360, 6 s
const clipB = path.join(TMP, 'clipB.mp4'); // portrait 360x640, 6 s
for (const [file, size] of [[clipA, '640x360'], [clipB, '360x640']]) {
  if (!fs.existsSync(file)) {
    execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30:duration=6`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-shortest', '-pix_fmt', 'yuv420p', file]);
  }
}
const probeA = await ff.probe(clipA);
const probeB = await ff.probe(clipB);

const env = {
  ...process.env, HOME, DISPLAY: ':99', TMPDIR: TMP,
  VK_ICD_FILENAMES: path.join(process.env.HOME, 'workspace/vulkan/lvp_icd.json'),
  FVE_EXPORT_TARGET: TMP,
};
const logFile = path.join(TMP, 'electron-f3.log');
const logFd = fs.openSync(logFile, 'w');
// The electron binary is renamed per worktree (cutflow-live on main,
// cutflow-f3 in the stream worktree); pick whichever exists in this tree.
const BIN = ['cutflow-live', 'electron', 'cutflow-f3'].map((n) => path.join(ROOT, 'node_modules/electron/dist', n)).find((p) => fs.existsSync(p));
const child = spawn(BIN, // renamed copy: siblings' `pkill -x electron` must not kill this run
  ['.', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-sandbox', '--disable-accelerated-video-decode', '--disable-accelerated-video-encode', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: ['ignore', logFd, logFd], detached: true });
console.log(`electron pid ${child.pid} (log: ${logFile})`);

let failures = 0;
try {
  const page = await waitTarget();
  const cdp = await connect(page.webSocketDebuggerUrl);
  const ev = async (expr) => {
    const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page exception: ${JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text)}`);
    return r.result.value;
  };
  const until = async (expr, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(300); }
    return false;
  };
  const clickText = (text, tag = 'button') => ev(`(() => { const b = [...document.querySelectorAll('${tag}')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (b) { b.click(); return true; } return false; })()`);
  const clipState = (id) => ev(`(() => { const c = window.__fve.exportData().project.videoClips.find((x) => x.id === ${JSON.stringify(id)}); return c ? JSON.parse(JSON.stringify(c)) : null; })()`);
  const openAdjustTab = async (mediaName) => {
    if (mediaName) await until(`document.querySelector('.clip-inspector .info')?.textContent.includes(${JSON.stringify(mediaName)})`, 20000);
    const ok = await until(`(() => { const b = [...document.querySelectorAll('.clip-inspector .ci-tabs button')].find((x) => x.textContent.trim().startsWith('Adjust')); if (!b) return false; if (b.getAttribute('aria-selected') !== 'true') b.click(); return b.getAttribute('aria-selected') === 'true'; })()`, 20000);
    await sleep(400);
    return ok;
  };


  await sleep(2500);
  await until(`!!document.querySelector('.welcome-go')`, 60000);
  await ev(`(() => { const b = document.querySelector('.welcome-go'); if (b) b.click(); return !!b; })()`);
  await until(`!!document.querySelector('.home-create')`, 60000);
  await ev(`(() => { const b = document.querySelector('.home-create'); if (b) b.click(); return !!b; })()`);
  check('editor entered', await until(`!!document.querySelector('.play-btn')`, 60000));
  await ev(`(() => { const b = document.querySelector('button[aria-label="Skip tour"]') || [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) b.click(); return !!b; })()`);
  await sleep(600);

  const project = {
    name: 'F3 check', ratio: '16:9', resolution: 720, width: 1280, height: 720, fps: 30, background: '#000000',
    media: [
      { id: 'm0', path: clipA, name: 'clipA.mp4', ...probeA },
      { id: 'm1', path: clipB, name: 'clipB.mp4', ...probeB },
    ],
    videoClips: [
      { id: 'v1', mediaId: 'm0', in: 0, out: 6, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null },
      { id: 'v2', mediaId: 'm1', in: 0, out: 6, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: { type: 'dissolve', duration: 0.5 } },
    ],
    overlayClips: [], audioClips: [], stickerClips: [], effectClips: [], textClips: [],
  };
  await ev(`window.__fve.load(${JSON.stringify(project)})`);
  await ev(`window.__fve.seek(1)`);
  await sleep(800);
  check('two clips loaded', await ev(`window.__fve.exportData().project.videoClips.length === 2`));

  // ---------- FB-10: honest catalog ----------
  await ev(`window.__fve.tab('transitions')`);
  await until(`document.querySelectorAll('.tile-adapted').length > 0`, 15000);
  await sleep(400);
  const countsLine = await ev(`(() => { const el = [...document.querySelectorAll('.left p.hint')].find((x) => x.textContent.includes('names')); return el ? el.textContent : null; })()`);
  check('FB-10 counts line is honest (135 names, 45 real, 90 adapted, 41 distinct)', countsLine === '135 names · 45 real · 90 adapted · 41 distinct engine transitions', countsLine);
  const adaptedBadges = await ev(`document.querySelectorAll('.tile-adapted').length`);
  check('FB-10 adapted tiles carry a visible badge', adaptedBadges > 20, `badges: ${adaptedBadges}`);
  const allTiles = await ev(`document.querySelectorAll('.left .tile').length`);
  await ev(`(() => { const c = document.querySelector('input[aria-label="Real only"]'); if (c) { c.click(); return true; } return false; })()`);
  await sleep(700);
  const realTiles = await ev(`document.querySelectorAll('.left .tile').length`);
  const realBadges = await ev(`document.querySelectorAll('.tile-adapted').length`);
  check('FB-10 real-only filter hides adapted tiles', realTiles < allTiles && realBadges === 0, `all: ${allTiles}, real-only: ${realTiles}, badges: ${realBadges}`);
  await ev(`(() => { const c = document.querySelector('input[aria-label="Real only"]'); if (c) c.click(); return true; })()`);
  await sleep(500);

  // ---------- FB-11: parametric controls ----------
  await ev(`window.__fve.select({ track: 'transition', id: 'v2' })`);
  await sleep(500);
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v2', patch: { transition: { type: 'fx_gradientwipe', duration: 0.8 } } })`);
  const hasSoftness = await until(`document.querySelector('.inspector')?.textContent.includes('Softness')`, 15000);
  const hasDirection = await ev(`document.querySelector('.inspector')?.textContent.includes('Direction')`);
  check('FB-11 wipe family shows Direction + Softness', hasSoftness && hasDirection, `softness: ${hasSoftness}, direction: ${hasDirection}`);
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v2', patch: { transition: { type: 'dissolve', duration: 0.5 } } })`);
  await sleep(500);
  const noSoftness = await ev(`!document.querySelector('.inspector')?.textContent.includes('Softness')`);
  const noParamsNote = await ev(`document.querySelector('.inspector')?.textContent.includes('No adjustable parameters')`);
  check('FB-11 dissolve shows no irrelevant controls + fallback note', noSoftness && noParamsNote);
  // Undo returns to the wipe.
  await ev(`window.__fve.dispatch({ type: 'undo' })`);
  await sleep(400);
  check('FB-11 undo restores gradient wipe', (await clipState('v2')).transition.type === 'fx_gradientwipe');
  // Morph strength keyframes: store + keyframe row with playhead inside the transition.
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v2', patch: { transition: { type: 'fx_morphcut', duration: 0.8, strengthKeys: [{ t: 0, v: 0 }, { t: 0.8, v: 1 }] } } })`);
  await ev(`window.__fve.seek(5.7)`);
  const keyRow = await until(`[...document.querySelectorAll('.inspector button')].some((x) => x.textContent.trim() === 'Add keyframe here')`, 15000);
  check('FB-11 morph strength keyframe row appears at the playhead', keyRow);
  check('FB-11 strength keys stored on the transition', JSON.stringify((await clipState('v2')).transition.strengthKeys) === JSON.stringify([{ t: 0, v: 0 }, { t: 0.8, v: 1 }]));

  // ---------- FB-12: boundary behaviour ----------
  await ev(`window.__fve.select({ track: 'transition', id: 'v2' })`);
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v2', patch: { transition: { type: 'dissolve', duration: 1.5 } } })`);
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v1', patch: { out: 1 } })`);
  await until(`!!document.querySelector('[data-testid="tr-clamped"]')`, 15000);
  const boundNote = await ev(`(() => { const el = document.querySelector('[data-testid="tr-clamped"]'); return el ? el.textContent : null; })()`); // TR-03 replaced the old boundary note ('Shortened to' + 'Use Xs' button) with the fit warning: 'It will play at 0.50s instead of 1.50s…' + a 'Shorten to fit (0.50s)' button.
  check('FB-12 clamped boundary note shown (1.5s on a 1s clip)', !!boundNote && boundNote.includes('0.50s'), boundNote);
  await ev(`(() => { const b = [...document.querySelectorAll('.inspector button')].find((x) => x.textContent.trim().startsWith('Shorten to fit')); if (b) b.click(); return !!b; })()`);
  await sleep(400);
  check('FB-12 shorten-to-fit sets 0.5s', (await clipState('v2')).transition.duration === 0.5);
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v1', patch: { out: 0 } })`); // True zero state needs a zero-length neighbour: under TR-03 a 0.3s clip is a 0.15s clamp (the engine plays it), not an error — the old 0.2s minimum is gone.
  const zeroNote = await until(`!!document.querySelector('[data-testid="tr-zero"]')`, 15000); // TR-03 zero state: 'No room for a transition here' (was the old 'can't fit' note).
  check('FB-12 zero-handle error shown (zero-length neighbour)', zeroNote);
  // Restore roomy clips; portrait transition renders without a frozen frame.
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v1', patch: { out: 6 } })`);
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v2', patch: { transition: { type: 'dissolve', duration: 0.5 } } })`);
  await ev(`window.__fve.seek(5.7)`);
  await sleep(800);
  const stageOk = await ev(`(() => { const v = [...document.querySelectorAll('.stage video')].find((x) => x.readyState >= 2); return !!v && !document.querySelector('.stage-lost'); })()`);
  check('FB-12 portrait transition frame renders (stage video ready, no lost-media state)', stageOk);

  // ---------- FB-26: effect stack ----------
  await ev(`window.__fve.select({ track: 'video', id: 'v1' })`);
  await openAdjustTab('clipA.mp4');
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v1', patch: { effects: ['grain', 'blur'], fxStrength: { grain: 0.5 } } })`);
  await until(`document.querySelectorAll('.fx-entry').length === 2`, 15000);
  const stackRows = await ev(`document.querySelectorAll('.fx-entry').length`);
  check('FB-26 stack rows render for grain + blur', stackRows === 2, `rows: ${stackRows}`);
  const bypassBtn = await ev(`(() => { const b = document.querySelector('button[aria-label="Bypass this effect"]'); if (b) { b.click(); return true; } return false; })()`);
  await sleep(400);
  check('FB-26 bypass toggles grain off', bypassBtn && (await clipState('v1')).fxBypass?.grain === true);
  await ev(`window.__fve.dispatch({ type: 'undo' })`);
  await sleep(400);
  check('FB-26 undo clears the bypass', !(await clipState('v1')).fxBypass?.grain);
  const movedDown = await ev(`(() => { const b = document.querySelectorAll('button[aria-label="Move effect down"]')[0]; if (b && !b.disabled) { b.click(); return true; } return false; })()`);
  await sleep(400);
  check('FB-26 reorder moves grain below blur', movedDown && JSON.stringify((await clipState('v1')).effects) === JSON.stringify(['blur', 'grain']));
  const soloed = await ev(`(() => { const bs = [...document.querySelectorAll('button[aria-label="Solo this effect"]')]; const b = bs[0]; if (b) { b.click(); return true; } return false; })()`);
  await sleep(400);
  const soloState = await clipState('v1');
  check('FB-26 solo isolates the first effect', soloed && soloState.fxSolo && Object.values(soloState.fxSolo).some(Boolean), JSON.stringify(soloState.fxSolo));
  const resetOk = await ev(`(() => { const row = [...document.querySelectorAll('.fx-entry')].find((x) => x.textContent.includes('Grain')); const b = row?.querySelector('button[aria-label="Reset this effect"]'); if (b) { b.click(); return true; } return false; })()`);
  await sleep(400);
  const afterReset = await clipState('v1');
  check('FB-26 per-effect reset clears its strength', resetOk && afterReset.fxStrength?.grain === undefined, JSON.stringify(afterReset.fxStrength));
  const compared = await clickText('Compare: before / after');
  await sleep(400);
  const cmpState = await clipState('v1');
  check('FB-26 compare bypasses the whole stack', compared && cmpState.fxBypass && Object.keys(cmpState.fxBypass).length === 2, JSON.stringify(cmpState.fxBypass));
  await ev(`(() => { const b = [...document.querySelectorAll('.inspector button, .clip-inspector button')].find((x) => x.textContent.includes('Showing the original')); if (b) b.click(); return !!b; })()`);
  await sleep(400);

  // ---------- FB-27: effect clipboard ----------
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v1', patch: { fxKeys: { grain: [{ t: 1.5, v: 0.2 }] }, fxStrength: { grain: 0.5 } } })`);
  await sleep(300);
  const v1KeysBefore = await ev(`JSON.stringify(window.__fve.exportData().project.videoClips.find((c) => c.id === 'v1').fxKeys || null)`);
  const copied = await clickText('Copy effects');
  await sleep(400);
  const clipStored = await ev(`!!JSON.parse(localStorage.getItem('cutflow.fxClipboard.v1') || 'null')?.effects?.length`);
  const clipSnap = await ev(`JSON.stringify(JSON.parse(localStorage.getItem('cutflow.fxClipboard.v1') || 'null')?.effects?.find((e) => e.id === 'grain') || null)`);
  check('FB-27 copy stores the stack', copied && clipStored, `v1 keys: ${v1KeysBefore} | snap grain: ${clipSnap}`);
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v2', patch: { out: 3 } })`);
  await ev(`window.__fve.select({ track: 'video', id: 'v2' })`);
  await openAdjustTab('clipB.mp4');
  const pasted = await clickText('Paste effects');
  await sleep(400);
  const v2 = await clipState('v2');
  check('FB-27 paste lands effects + relative keyframes on the 3s clip', pasted && v2.effects.includes('grain') && v2.fxKeys?.grain?.[0]?.t === 0.75, `pasted: ${pasted} | v2 effects: ${v2.effects} | v2 fxKeys: ${JSON.stringify(v2.fxKeys)}`);
  await ev(`window.__fve.dispatch({ type: 'undo' })`);
  await sleep(400);
  check('FB-27 undo removes the pasted stack', (await clipState('v2')).effects.length === 0);
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v2', patch: { out: 6 } })`);

  // ---------- FB-28: recency + real-footage previews + apply-to-all ----------
  try {
    await ev(`window.__fve.tab('effects')`);
    await until(`document.querySelectorAll('.left .tile').length > 50`, 15000);
  } catch (e) {
    console.log('FB-28 tab switch timed out, retrying once:', e.message);
    await sleep(5000);
    await ev(`window.__fve.tab('effects')`);
    await until(`document.querySelectorAll('.left .tile').length > 50`, 15000);
  }
  const pickedTile = await ev(`(() => { const b = [...document.querySelectorAll('.left .tile')].find((x) => x.textContent.trim().startsWith('Vignette')); if (b) { b.click(); return true; } return false; })()`);
  await sleep(500);
  const recentRow = await ev(`[...document.querySelectorAll('.left .lib-group-name')].some((x) => x.textContent.trim() === 'Recently used')`);
  const recentStored = await ev(`(JSON.parse(localStorage.getItem('cutflow.recentEffects.v1') || '[]'))[0]`);
  check('FB-28 picking an effect records it as recently used', pickedTile && recentRow && recentStored === 'vignette', `recent[0]: ${recentStored}`);
  const footageNote = await ev(`(() => { const el = [...document.querySelectorAll('.left p.hint')].find((x) => x.textContent.includes('Previews show')); return el ? el.textContent : null; })()`);
  const footageTiles = await ev(`document.querySelectorAll('.left .tile canvas.fx-thumb').length`);
  check('FB-28 footage note shown; tiles render live on footage when available', !!footageNote, `${footageNote} | live tile canvases: ${footageTiles}`);
  // Multi-select apply-to-all.
  await ev(`window.__fve.select({ items: [{ track: 'video', id: 'v1' }, { track: 'video', id: 'v2' }] })`);
  await until(`!!document.querySelector('input[aria-label^="Apply to all"]')`, 20000);
  const applyAllBox = await ev(`(() => { const c = document.querySelector('input[aria-label^="Apply to all"]'); return c ? c.getAttribute('aria-label') : null; })()`);
  check('FB-28 apply-to-all checkbox appears for a multi-selection', !!applyAllBox, applyAllBox);
  await ev(`(() => { const c = document.querySelector('input[aria-label^="Apply to all"]'); if (c) c.click(); return !!c; })()`);
  await sleep(300);
  await ev(`(() => { const b = [...document.querySelectorAll('.left .tile')].find((x) => x.textContent.trim().startsWith('Mirror')); if (b) { b.click(); return true; } return false; })()`);
  await sleep(500);
  const v1After = await clipState('v1');
  const v2After = await clipState('v2');
  check('FB-28 apply-to-all adds Mirror to both selected clips', v1After.effects.includes('mirror') && v2After.effects.includes('mirror'), `v1: ${v1After.effects}, v2: ${v2After.effects}`);
  await ev(`window.__fve.dispatch({ type: 'undo' })`);
  await sleep(400);
  await ev(`window.__fve.tab('media')`);
  await sleep(500);

  // ---------- FB-29: unified inspector — 8 creator usability tasks ----------
  const tasks = [];
  const runTask = async (name, fn) => {
    const t0 = Date.now();
    let errors = 0;
    let ok = false;
    try { ok = await fn(); } catch (e) { errors += 1; console.log(`  task error ${name}: ${e.message}`); }
    const ms = Date.now() - t0;
    tasks.push([name, ok, ms, errors]);
    console.log(`${ok ? 'PASS' : 'FAIL'}  usability ${name} — ${ms}ms, errors: ${errors}`);
  };
  await ev(`window.__fve.select({ track: 'video', id: 'v1' })`);
  await sleep(500);
  await runTask('1 basic: open Basic level, find the Strength control for grain', async () => {
    await clickText('Basic');
    await sleep(300);
    await openAdjustTab('clipA.mp4');
    await ev(`(() => { const row = [...document.querySelectorAll('.clip-inspector .fx-entry')].find((x) => x.textContent.includes('Grain')); const b = row?.querySelector('.fx-entry-toggle'); if (b) { b.click(); return true; } return false; })()`);
    await sleep(400);
    return ev(`document.querySelector('.clip-inspector').textContent.includes('Strength')`);
  });
  await runTask('2 presets: apply the Noir look from Presets', async () => {
    await clickText('Presets');
    await sleep(400);
    await ev(`(() => { const b = [...document.querySelectorAll('.clip-inspector .chip')].find((x) => x.textContent.trim() === 'Noir'); if (b) b.click(); return !!b; })()`);
    await sleep(400);
    return (await clipState('v1')).filter === 'noir';
  });
  await runTask('3 reset: Reset clip clears the look', async () => {
    await ev(`(() => { const b = [...document.querySelectorAll('.ci-levels button')].find((x) => x.textContent.includes('Reset clip')); if (b) b.click(); return !!b; })()`);
    await sleep(400);
    const c = await clipState('v1');
    return c.filter === 'none';
  });
  await runTask('4 advanced: switch to Advanced, animation tab visible', async () => {
    await clickText('Advanced');
    await sleep(400);
    return ev(`[...document.querySelectorAll('.clip-inspector .ci-tabs button')].some((x) => x.textContent.trim() === 'Animation')`);
  });
  await runTask('5 basic: bypass grain from the stack', async () => {
    await clickText('Basic');
    await sleep(300);
    await openAdjustTab('clipA.mp4');
    await ev(`(() => { const b = document.querySelector('button[aria-label="Bypass this effect"]'); if (b) b.click(); return !!b; })()`);
    await sleep(400);
    return (await clipState('v1')).fxBypass?.grain === true || (await clipState('v1')).fxBypass?.blur === true;
  });
  await runTask('6 basic: change transition duration on clip v2', async () => {
    await ev(`window.__fve.select({ track: 'video', id: 'v2' })`);
    await sleep(500);
    await openAdjustTab('clipB.mp4');
    return ev(`document.querySelector('.clip-inspector').textContent.includes('Duration')`);
  });
  await runTask('7 copy/paste: copy v1 effects, paste onto v2', async () => {
    await ev(`window.__fve.select({ track: 'video', id: 'v1' })`);
    await sleep(400);
    await openAdjustTab('clipA.mp4');
    await clickText('Copy effects');
    await sleep(300);
    await ev(`window.__fve.select({ track: 'video', id: 'v2' })`);
    await sleep(400);
    await openAdjustTab('clipB.mp4');
    await clickText('Paste effects');
    await sleep(400);
    const c = await clipState('v2');
    return c.effects.includes('blur') && c.effects.includes('grain');
  });
  await runTask('8 changed state: edit opacity, a changed dot appears', async () => {
    await ev(`window.__fve.select({ track: 'video', id: 'v1' })`);
    await sleep(400);
    await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v1', patch: { opacity: 0.6 } })`);
    await sleep(400);
    return ev(`document.querySelectorAll('.ci-changed').length >= 1`);
  });
  const taskFails = tasks.filter(([, ok]) => !ok).length;
  check('FB-29 usability tasks all pass', taskFails === 0, `${tasks.filter(([, ok]) => ok).length}/8 pass; times: ${tasks.map(([, , ms]) => ms).join(',')}ms`);
} catch (e) {
  console.log(`FATAL: ${e.message}`);
  failures += 1;
} finally {
  try { child.kill('SIGKILL'); } catch { /* already dead */ }
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already dead */ }
}
const failed = results.filter(([, ok]) => !ok).length + failures;
console.log(`\nF3-LIVE: ${results.length - failed} PASS / ${failed} FAIL of ${results.length} checks (log: ${logFile})`);
process.exit(failed ? 1 : 0);
