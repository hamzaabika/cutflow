// Focused follow-up probe for the three live-driver failures (run-YisJxg).
//   A. HSL export: does a graded clip's green hue shift reach the export?
//      Minimal project, no toggles: export graded, then export after removing
//      the grade, compare the green half's B channel. Plus: run the exact L2b
//      remove+restore dispatches on the full project and read v5.grade back.
//   B. 234: slider edit — read the stored preset under the REAL key
//      (cutflow.creativePresets.v1, not cutflow.creativePresets).
//   C. 235: select the TRANSITION (track 'transition', v3 fx_irisout — an
//      engine transition, the only kind whose panel shows CurveEditor chips).
// Usage: node scripts/test-gap-f-probe.mjs
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CDP_PORT = 9346;
const FIX = '/home/hatch/workspace/.tmp-gap-f-live/run-YisJxg';
const SCRATCH = fs.mkdtempSync(path.join(os.homedir(), 'workspace', '.tmp-gap-f-live', 'probe-'));
const dir = SCRATCH;
const OUTDIR = dir;
const ff = (await import('../electron/ffmpeg.cjs')).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const fails = [];
const check = (name, ok, detail = '') => { results.push([name, !!ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fails.push(name); };

const electronBin = [path.join(os.homedir(), 'workspace', '.tmp-gap-f-live', 'electron-gapf-dist', 'cutflow-gapf'),
  path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'),
  path.join(os.homedir(), 'workspace', 'electron-dist', 'electron')].find((p) => fs.existsSync(p));
if (!electronBin) throw new Error('electron binary not found');
try {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  if (r.ok) throw new Error(`CDP port ${CDP_PORT} already answers — refusing to drive a foreign app`);
} catch (e) { if (e.message.includes('already answers')) throw e; }

const env = { ...process.env, HOME: path.join(dir, 'home'), DISPLAY: ':99', FVE_EXPORT_TARGET: OUTDIR, TMPDIR: path.join(os.homedir(), 'workspace', '.tmp-gap-f-tmp'), VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES || path.join(os.homedir(), 'workspace', 'vulkan', 'lvp_icd.json') };
delete env.FVE_SMOKE; delete env.FVE_SMOKE_MODE;
const child = spawn(electronBin, ['.', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-sandbox', '--disable-accelerated-video-decode', '--disable-accelerated-video-encode', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${CDP_PORT}`], { cwd: ROOT, env, stdio: 'pipe', detached: true });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } };
process.on('exit', kill);

let cdp = null;
const frameAt = (file, t, w = 640, h = 360) => execFileSync(ff.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, 'pipe:1'], { maxBuffer: 1 << 28 });
const greenB = (raw, w = 640, h = 360) => {
  let b = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w / 2; x++) { const i = (y * w + x) * 3; b += raw[i + 2]; n++; }
  return b / n;
};
try {
  const waitTarget = async () => {
    for (let i = 0; i < 120; i++) {
      try { const l = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); const p = l.find((x) => x.type === 'page' && x.webSocketDebuggerUrl); if (p) return p; } catch {}
      await sleep(500);
    }
    throw new Error('CDP target never appeared');
  };
  const connect = (url) => new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0; const pending = new Map();
    ws.onopen = () => resolve({
      call: (method, params = {}, timeoutMs = 60000) => new Promise((res, rej) => {
        if (ws.readyState !== 1) return rej(new Error('ws not open'));
        const mid = ++id; const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
        pending.set(mid, (m) => { clearTimeout(timer); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); });
        ws.send(JSON.stringify({ id: mid, method, params }));
      }),
      close: () => { try { ws.close(); } catch {} },
    });
    ws.onmessage = (e) => { try { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const f = pending.get(m.id); pending.delete(m.id); f(m); } } catch {} };
    ws.onclose = () => reject(new Error('ws closed'));
    ws.onerror = () => reject(new Error('ws error'));
  });
  const page = await waitTarget();
  cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
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
  const until = async (expr, ms = 120000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch {} await sleep(500); }
    return false;
  };
  const doneCount = async () => ev(`document.querySelectorAll('.xjob-ic.ok').length`);
  const waitJobDone = async (before, ms = 600000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if ((await doneCount()) > before) return true; } catch { return false; } await sleep(1000); }
    return false;
  };
  const waitExport = async (file, ms = 600000) => {
    // Valid duration + stable size across two polls 2 s apart.
    const t0 = Date.now();
    let lastSize = -1, stableSince = 0;
    while (Date.now() - t0 < ms) {
      try {
        const st = fs.statSync(file);
        if (st.size > 0) {
          const r = spawnSync(ff.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
          const dur = Number((r.stdout || '').trim());
          if (Number.isFinite(dur) && dur > 0) {
            if (st.size === lastSize) { if (Date.now() - stableSince >= 2000) return dur; }
            else { lastSize = st.size; stableSince = Date.now(); }
          }
        }
      } catch {}
      await sleep(1000);
    }
    return 0;
  };
  const waitFile = async (file, ms = 600000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        const s = fs.statSync(file);
        if (s.size > 0) {
          const r = spawnSync(ff.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
          const dur = Number((r.stdout || '').trim());
          if (Number.isFinite(dur) && dur > 0) return dur;
        }
      } catch {}
      await sleep(1000);
    }
    return 0;
  };
  const dismissWelcome = async () => {
    for (let i = 0; i < 20; i++) {
      const gone = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) { b.click(); return false; } return !document.body.innerText.includes('Welcome to Cutflow'); })()`).catch(() => true);
      if (gone) return true;
      await sleep(500);
    }
    return false;
  };
  // Wait for React to mount before touching the DOM: window.__fve is set
  // by App after mount, so this also guarantees the Home screen is
  // rendered. Without it the Create click below can land on an empty DOM
  // (the click is a single shot — if React hasn't mounted yet it no-ops,
  // the app stays on Home, '.play-btn' never appears, and every UI
  // section after it fails while the headless __fve exports still pass).
  // Same gate test-gap-f-live.mjs uses.
  await until(`!!window.__fve`, 60000);
  await dismissWelcome();
  await ev(`(() => { const b = document.querySelector('[aria-label="Create project"]'); if (b) b.click(); return !!b; })()`).catch(() => {});
  check('editor ready', await until(`!!document.querySelector('.play-btn')`, 60000));
  await dismissWelcome();
  await sleep(600);

  const two = path.join(FIX, 'two.mp4');
  const grad = path.join(FIX, 'grad.mp4');
  const det = path.join(FIX, 'det.mp4');
  const mkMin = (grade) => ({
    name: 'gap-f-probe-min', fps: 30, width: 640, height: 360, background: '#000000',
    media: [{ id: 'mt', path: two, name: 'two.mp4', type: 'video', duration: 2, width: 640, height: 360 }],
    videoClips: [{ id: 'v1', type: 'video', mediaId: 'mt', start: 0, duration: 2, in: 0, out: 2, ...(grade ? { grade } : {}) }],
    overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
  });
  const GRADE = { hsl: { green: { h: 30, s: 0, l: 0 } } };

  // ---- Phase A1: graded export, no toggles ----
  await evFire(`window.__fve.load(${JSON.stringify(mkMin(GRADE))})`);
  await sleep(800);
  await evFire(`window.__fve.exportNow()`);
  const outA = path.join(dir, 'ui-export.mp4');
  const durA = await waitExport(outA);
  check('A1 graded export completes', Math.abs(durA - 2) < 0.35, `duration ${durA.toFixed(2)}s (expect 2)`);
  fs.copyFileSync(outA, path.join(dir, 'graded.mp4'));
  const bGraded = greenB(frameAt(path.join(dir, 'graded.mp4'), 1.0));
  // ---- Phase A2: remove the grade, export again ----
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v1', patch: { grade: {} } })`);
  await sleep(600);
  try { fs.unlinkSync(outA); } catch {}
  await evFire(`window.__fve.exportNow()`);
  const durB = await waitExport(outA);
  check('A2 ungraded export completes', Math.abs(durB - 2) < 0.35, `duration ${durB.toFixed(2)}s (expect 2)`);
  fs.copyFileSync(outA, path.join(dir, 'ungraded.mp4'));
  const bPlain = greenB(frameAt(path.join(dir, 'ungraded.mp4'), 1.0));
  check('A HSL grade reaches the export', bGraded > bPlain + 5, `green-half B channel: graded export ${bGraded.toFixed(1)} vs ungraded ${bPlain.toFixed(1)} (preview reference: on 29.1 / off 6.5)`);

  // ---- Phase A3: exact L2b remove+restore on the full project — read the grade back ----
  const full = JSON.parse(fs.readFileSync(path.join(FIX, 'full-project.json'), 'utf8').toString().replace(/__TWO__/g, two).replace(/__GRAD__/g, grad).replace(/__DET__/g, det));
  await evFire(`window.__fve.load(${JSON.stringify(full)})`);
  await sleep(800);
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v5', patch: { grade: {} } })`);
  await sleep(500);
  const afterRemove = await ev(`JSON.stringify(window.__fve.exportData().project.videoClips.find((x) => x.id === 'v5').grade || null)`);
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v5', patch: { grade: { hsl: { green: { h: 30, s: 0, l: 0 } } } } })`);
  await sleep(500);
  const afterRestore = await ev(`JSON.stringify(window.__fve.exportData().project.videoClips.find((x) => x.id === 'v5').grade || null)`);
  check('A3 remove clears the grade', afterRemove === '{}' || afterRemove === 'null', `grade after remove: ${afterRemove}`);
  check('A3 restore puts the grade back', afterRestore.includes('"green"') && afterRestore.includes('30'), `grade after restore: ${afterRestore}`);

  // ---- Phase A4: export the FULL project (grade restored) — does the grade reach THIS export? ----
  try { fs.unlinkSync(outA); } catch {}
  await evFire(`window.__fve.exportNow()`);
  const durFull = await waitExport(outA);
  check('A4 full-project export completes', Math.abs(durFull - 12.4) < 0.35, `duration ${durFull.toFixed(2)}s (expect 12.4)`);
  fs.copyFileSync(outA, path.join(dir, 'full-restored.mp4'));
  const bFull = greenB(frameAt(path.join(dir, 'full-restored.mp4'), 7.4));
  check('A4 full-project export carries the restored grade', bFull > 15, `green-half B channel at t=7.4: ${bFull.toFixed(1)} (graded ref 22.0, ungraded ref 0.0)`);

  // ---- Phase B: 234 slider edit, real storage key ----
  await ev(`window.__fve.select({ track: 'video', id: 'v1' })`);
  await sleep(400);
  const composerOpen = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Composer'); if (b) { b.click(); return true; } return false; })()`);
  await sleep(800);
  const presetFile = path.join(dir, 'import-preset.json');
  fs.writeFileSync(presetFile, JSON.stringify({ kind: 'cutflow.creative-preset', schemaVersion: 1, id: 'cp_gapfprobe1', name: 'GapF Probe Vivid', target: 'filter', variant: 'vivid', params: { intensity: 70, adjust: {} }, source: 'user', createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z' }, null, 2));
  const doc = await cdp.call('DOM.getDocument', { depth: -1 });
  const found = await cdp.call('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.composer-io input[type=file]' });
  if (found.nodeId) await cdp.call('DOM.setFileInputFiles', { files: [presetFile], nodeId: found.nodeId });
  await sleep(800);
  const imported = await ev(`[...document.querySelectorAll('.composer-name')].some((s) => s.textContent.includes('GapF Probe Vivid'))`);
  check('B 234 preset imports', composerOpen && imported, `composer=${composerOpen}, row appears=${imported}`);
  await ev(`[...document.querySelectorAll('.composer-row')].find((r) => r.textContent.includes('GapF Probe Vivid'))?.querySelector('.composer-apply')?.click()`);
  await sleep(600);
  await ev(`[...document.querySelectorAll('.composer-row')].find((r) => r.textContent.includes('GapF Probe Vivid'))?.querySelector('.composer-actions .btn')?.click()`);
  await sleep(600);
  const sliders = await ev(`document.querySelectorAll('.composer-edit input[type=range]').length`);
  check('B 234 editor sliders present', sliders >= 1, `${sliders} slider(s)`);
  if (sliders >= 1) {
    await ev(`(() => { const el = document.querySelector('.composer-edit input[type=range]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '40'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(600);
    const after = await ev(`(() => { const c = window.__fve.exportData().project.videoClips.find((x) => x.id === 'v1'); const stored = JSON.parse(localStorage.getItem('cutflow.creativePresets.v1') || '[]'); const p = stored.find((x) => x.name === 'GapF Probe Vivid'); return c.filterIntensity + ':' + (p?.params?.intensity ?? '?'); })()`);
    check('B 234 slider edits preset + live-applies to clip', after === '40:40', `clip intensity:stored intensity = ${after}`);
  }

  // ---- Phase C: 235 transition panel chips ----
  await ev(`window.__fve.select({ track: 'transition', id: 'v3' })`);
  await sleep(800);
  const chips = await ev(`document.querySelectorAll('.curve-chips button, .curve-chips [role=button]').length`);
  check('C 235 easing chips on the transition panel (v3 fx_irisout)', chips >= 4, `${chips} chip(s)`);
  if (chips >= 4) {
    const before = await ev(`window.__fve.exportData().project.videoClips.find((x) => x.id === 'v3').transition.ease`);
    await ev(`[...document.querySelectorAll('.curve-chips button')].find((b) => /bounce/i.test(b.textContent || b.getAttribute('aria-label') || b.title || ''))?.click()`);
    await sleep(500);
    const after = await ev(`window.__fve.exportData().project.videoClips.find((x) => x.id === 'v3').transition.ease`);
    check('C 235 easing preset applies to transition', before !== after, `ease ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  }
} catch (e) {
  console.error('PROBE DRIVER ERROR:', e.message);
  console.error('child stderr tail:', stderr.slice(-2000));
  fails.push('driver: ' + e.message);
} finally {
  try { if (cdp) cdp.close(); } catch {}
  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
}

fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ dir, results }, null, 2));
console.log(`\n== GAP-F PROBE: ${results.filter((r) => r[1]).length} PASS / ${fails.length} FAIL / ${results.length} total; workdir ${dir}`);
if (fails.length) { console.error('FAILURES:\n' + fails.join('\n')); process.exit(1); }
console.log('GAP-F PROBE OK');
