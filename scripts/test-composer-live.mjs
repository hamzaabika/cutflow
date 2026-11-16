// Live Composer verification (P1-55/56): boots the real dev app on CDP 9225
// with a fresh profile, enters the editor, loads a generated clip, and
// drives the Composer panel for real: migration, apply, undo/redo, save,
// edit (live), delete, import, and a filtered-vs-unfiltered export
// comparison (signalstats SATAVG) as the export-consistency check.
// Run AFTER `npm run build`:  node scripts/test-composer-live.mjs
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { normalizeAudioFx } from '../src/fx/audioPresets.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9225;
// Scratch dirs under the OS tmp (small files only: one 6 s clip, two exports).
const TMP = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'fve-composer-'));
const HOME = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'fve-composer-home-'));
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

const clip = path.join(TMP, 'clip.mp4');
if (!fs.existsSync(clip)) {
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-shortest', '-pix_fmt', 'yuv420p', clip]);
}
const probe = await ff.probe(clip);

const env = {
  ...process.env, HOME, DISPLAY: ':99', TMPDIR: TMP,
  VK_ICD_FILENAMES: path.join(process.env.HOME, 'workspace/vulkan/lvp_icd.json'),
  FVE_EXPORT_TARGET: TMP,
};
const logFile = path.join(TMP, 'electron-item8.log');
const logFd = fs.openSync(logFile, 'w');
const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron'),
  ['.', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: ['ignore', logFd, logFd], detached: true });
console.log(`electron pid ${child.pid} (log: ${logFile})`);

let cdp;
try {
  const page = await waitTarget();
  cdp = await connect(page.webSocketDebuggerUrl);
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

  await sleep(2500);
  // Dismiss the first-run Welcome modal, then enter the editor.
  await ev(`(() => { const b = document.querySelector('.welcome-go'); if (b) b.click(); return !!b; })()`);
  await sleep(800);
  // The first-run Welcome modal can re-render after the first dismiss and
  // swallow the create click; dismiss again before entering the editor.
  await ev(`(() => { const b = document.querySelector('.welcome-go'); if (b) b.click(); return !!b; })()`);
  await sleep(400);
  await ev(`(() => { const b = document.querySelector('.home-create'); if (b) b.click(); return !!b; })()`);
  check('editor entered', await until(`!!document.querySelector('.play-btn')`, 60000));
  await ev(`(() => { const b = document.querySelector('button[aria-label="Skip tour"]') || [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) b.click(); return !!b; })()`);
  await sleep(600);

  // Load a project with the generated clip on the main track.
  const project = {
    name: 'Composer check', ratio: '9:16', resolution: 720, width: 360, height: 640, fps: 30, background: '#000000',
    media: [{ id: 'm0', path: clip, name: 'clip.mp4', ...probe }],
    videoClips: [{ id: 'v1', mediaId: 'm0', in: 0, out: 6, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
    overlayClips: [], audioClips: [], stickerClips: [], effectClips: [], textClips: [],
  };
  await ev(`window.__fve.load(${JSON.stringify(project)})`);
  await ev(`window.__fve.seek(1)`);
  await sleep(800);
  check('clip loaded on timeline', await ev(`window.__fve.exportData().project.videoClips.length === 1`));

  // Seed the LEGACY stores before opening the Composer (migration check).
  await ev(`(() => {
    localStorage.setItem('clipcraft.filterPresets', JSON.stringify([
      { name: 'Golden Hour', filter: 'vivid', filterIntensity: 80, adjust: { brightness: 10 } },
      { name: 'Noir Night', filter: 'noir', filterIntensity: 100, adjust: {} },
    ]));
    localStorage.setItem('clipcraft.captionTemplates', JSON.stringify([
      { name: 'My Caps', patch: { font: 'montserrat', bold: true, color: '#ffffff', size: 64 } },
    ]));
    return true;
  })()`);

  // Open the Composer tab from the rail.
  const opened = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Composer'); if (b) { b.click(); return true; } return false; })()`);
  check('Composer tab opens from rail', opened && await until(`!!document.querySelector('.composer-row')`, 10000));
  await sleep(500);
  const rows = await ev(`[...document.querySelectorAll('.composer-row')].map((r) => r.querySelector('.composer-name')?.textContent)`);
  check('Composer lists 6 seeds + 3 migrated presets', rows.length === 9, `rows: ${JSON.stringify(rows)}`);
  check('migrated filter preset listed', rows.includes('Golden Hour'));
  check('migrated caption preset listed', rows.includes('My Caps'));
  check('legacy filter store left intact', await ev(`JSON.parse(localStorage.getItem('clipcraft.filterPresets')).length === 2`));
  check('migration flag set', await ev(`localStorage.getItem('cutflow.creativePresets.migrated.v1') === '1'`));

  const clipFilter = () => ev(`(() => { const c = window.__fve.exportData().project.videoClips[0]; return { filter: c.filter, intensity: c.filterIntensity }; })()`);

  // Apply the Vivid Pop seed: click its row's apply button.
  await ev(`(() => { const row = [...document.querySelectorAll('.composer-row')].find((r) => r.querySelector('.composer-name')?.textContent === 'Vivid Pop'); row.querySelector('.composer-apply').click(); return !!row; })()`);
  await sleep(400);
  const afterApply = await clipFilter();
  check('apply Vivid Pop sets filter vivid @80', afterApply.filter === 'vivid' && afterApply.intensity === 80, JSON.stringify(afterApply));

  // Undo / redo through the real dispatch.
  await ev(`window.__fve.dispatch({ type: 'undo' })`);
  await sleep(300);
  const afterUndo = await clipFilter();
  check('undo restores filter none', afterUndo.filter === 'none', JSON.stringify(afterUndo));
  await ev(`window.__fve.dispatch({ type: 'redo' })`);
  await sleep(300);
  const afterRedo = await clipFilter();
  check('redo re-applies vivid @80', afterRedo.filter === 'vivid' && afterRedo.intensity === 80, JSON.stringify(afterRedo));

  // Save the current clip (warm @65) as a new preset, via the panel UI.
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v1', patch: { filter: 'warm', filterIntensity: 65 } })`);
  await sleep(300);
  await ev(`(() => {
    const input = document.querySelector('.preset-save input[type="text"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Warm 65');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await ev(`(() => { const b = [...document.querySelectorAll('.preset-save button')].find((x) => x.textContent.trim() === 'Save'); b.click(); return !!b; })()`);
  await sleep(400);
  const saved = await ev(`JSON.parse(localStorage.getItem('cutflow.creativePresets.v1') || '[]').find((p) => p.name === 'Warm 65')`);
  check('save captures warm @65 as v1 preset', saved?.target === 'filter' && saved?.variant === 'warm' && saved?.params?.intensity === 65 && saved?.schemaVersion === 1, JSON.stringify(saved));

  // Edit the saved preset's intensity slider live: 65 -> 40.
  await ev(`(() => { const row = [...document.querySelectorAll('.composer-row')].find((r) => r.querySelector('.composer-name')?.textContent === 'Warm 65'); const b = [...row.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Edit'); b.click(); return !!b; })()`);
  await sleep(400);
  const sliderMoved = await ev(`(() => {
    const row = [...document.querySelectorAll('.composer-row')].find((r) => r.querySelector('.composer-name')?.textContent === 'Warm 65');
    const s = row.querySelector('.composer-edit input[type="range"]');
    if (!s) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(s, '40');
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(600);
  const afterEdit = await clipFilter();
  const storedAfterEdit = await ev(`JSON.parse(localStorage.getItem('cutflow.creativePresets.v1') || '[]').find((p) => p.name === 'Warm 65')`);
  check('edit slider moves live preview to 40', sliderMoved && afterEdit.filter === 'warm' && afterEdit.intensity === 40, JSON.stringify(afterEdit));
  check('edit persists intensity 40 in the stored preset', storedAfterEdit?.params?.intensity === 40, JSON.stringify(storedAfterEdit?.params));

  // Delete the saved preset.
  await ev(`(() => { const row = [...document.querySelectorAll('.composer-row')].find((r) => r.querySelector('.composer-name')?.textContent === 'Warm 65'); const b = row.querySelector('button[aria-label^="Delete preset"]'); b.click(); return !!b; })()`);
  await sleep(400);
  check('delete removes the preset from storage', await ev(`!JSON.parse(localStorage.getItem('cutflow.creativePresets.v1') || '[]').some((p) => p.name === 'Warm 65')`));

  // Import a .json preset through the hidden file input.
  const imported = await ev(`(() => {
    const input = document.querySelector('input[type="file"]');
    if (!input) return 'no-input';
    const json = JSON.stringify({ kind: 'cutflow.creative-preset', schemaVersion: 1, id: 'cp_imported1', name: 'Imported Teal', target: 'filter', variant: 'tealorange', params: { intensity: 55, adjust: {} }, source: 'user', createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z' });
    const dt = new DataTransfer();
    dt.items.add(new File([json], 'preset.json', { type: 'application/json' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'set';
  })()`);
  await sleep(500);
  const importRow = await ev(`[...document.querySelectorAll('.composer-name')].some((n) => n.textContent === 'Imported Teal')`);
  check('import adds a .json preset to the library', imported === 'set' && importRow);

  // Apply the remaining target types live.
  const applyRow = (name) => ev(`(() => { const row = [...document.querySelectorAll('.composer-row')].find((r) => r.querySelector('.composer-name')?.textContent === '${name}'); row.querySelector('.composer-apply').click(); return !!row; })()`);
  await applyRow('Clear Voice');
  await sleep(400);
  const audioFx = await ev(`window.__fve.exportData().project.videoClips[0].audioFx`);
  // The stored form is the NORMALISED chain (presetClipPatch normalises on
  // apply), not the raw preset fx — same comparison as test-creative-presets.
  const clearVoice = normalizeAudioFx({ eq: { low: -3, mid: 2, high: 3 }, highpass: 80, lowpass: 0, comp: true, limit: false, denoise: true, loudnorm: true, echo: null, pitch: 0 });
  check('apply Clear Voice sets the real audio chain', JSON.stringify(audioFx) === JSON.stringify(clearVoice), JSON.stringify(audioFx));
  await applyRow('Soft Crossfade');
  await sleep(400);
  const transition = await ev(`window.__fve.exportData().project.videoClips[0].transition`);
  check('apply Soft Crossfade sets transition fade @0.5s', transition?.type === 'fade' && transition?.duration === 0.5, JSON.stringify(transition));
  // Text: add a text clip, select it, apply the Big Title seed.
  await ev(`window.__fve.dispatch({ type: 'addText', clipId: 't1', at: 0, patch: {} })`);
  await ev(`window.__fve.select({ track: 'text', id: 't1' })`);
  // Wait for the selection to propagate (the text inspector mounts on the
  // same render that hands selectedText to the Composer): a fixed sleep
  // races the panel's re-render under load and the apply then no-ops.
  await until(`!!document.querySelector('.text-inspector')`, 10000);
  await applyRow('Big Title');
  await sleep(400);
  const textClip = await ev(`window.__fve.exportData().project.textClips.find((c) => c.id === 't1')`);
  check('apply Big Title sets the text template', textClip?.template === 'title-bold' && textClip?.font === 'anton', JSON.stringify({ template: textClip?.template, font: textClip?.font }));
  // Caption: add an SRT caption clip, select it, apply the Essential Captions seed.
  await ev(`window.__fve.dispatch({ type: 'addText', clipId: 'c1', at: 0, patch: { caption: true, source: 'srt', text: 'hello' } })`);
  await ev(`window.__fve.select({ track: 'text', id: 'c1' })`);
  await until(`!!document.querySelector('.text-inspector')`, 10000);
  await applyRow('Essential Captions');
  await sleep(400);
  const capClip = await ev(`window.__fve.exportData().project.textClips.find((c) => c.id === 'c1')`);
  check('apply Essential Captions styles the caption clip', capClip?.template === 'cap-classic' && capClip?.font === 'montserrat' && capClip?.bold === true, JSON.stringify({ template: capClip?.template, font: capClip?.font }));
  // Reset the picture clip to a clean baseline for the export comparison.
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v1', patch: { filter: 'none', audioFx: null, transition: null } })`);
  await sleep(300);

  // Export consistency: baseline (no filter) vs Vivid Pop, same clip/frames.
  // Mean per-pixel saturation of frame 30 (t=1s), read back from the file on
  // disk — signalstats metadata is not printed at this log level, so measure
  // the pixels directly: extract a small rgb24 frame and average (max-min)/max.
  const satAvg = (file) => {
    const r = spawnSync(ffmpegPath, ['-v', 'error', '-i', file, '-vf', 'select=eq(n\\,30),scale=90:160', '-vframes', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 });
    const b = r.stdout;
    let sum = 0, n = 0;
    for (let i = 0; i + 2 < b.length; i += 3) {
      const mx = Math.max(b[i], b[i + 1], b[i + 2]), mn = Math.min(b[i], b[i + 1], b[i + 2]);
      if (mx > 0) { sum += (mx - mn) / mx; n += 1; }
    }
    return n ? sum / n : null;
  };
  const exportNow = async () => {
    await ev(`window.__fve.exportNow()`);
    const out = path.join(TMP, 'ui-export.mp4');
    for (let i = 0; i < 120; i += 1) {
      if (fs.existsSync(out)) {
        const size1 = fs.statSync(out).size;
        await sleep(1000);
        if (fs.existsSync(out) && fs.statSync(out).size === size1 && size1 > 10000) return out;
      }
      await sleep(500);
    }
    return null;
  };
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v1', patch: { filter: 'none' } })`);
  await sleep(300);
  const baseFile = await exportNow();
  check('baseline export lands on disk', !!baseFile && fs.existsSync(baseFile), baseFile || 'no file');
  const baseSat = baseFile ? satAvg(baseFile) : null;
  if (baseFile) fs.renameSync(baseFile, path.join(TMP, 'ui-export-base.mp4'));
  await ev(`(() => { const row = [...document.querySelectorAll('.composer-row')].find((r) => r.querySelector('.composer-name')?.textContent === 'Vivid Pop'); row.querySelector('.composer-apply').click(); return !!row; })()`);
  await sleep(400);
  const vividFile = await exportNow();
  check('vivid export lands on disk', !!vividFile && fs.existsSync(vividFile), vividFile || 'no file');
  const vividSat = vividFile ? satAvg(vividFile) : null;
  console.log(`mean saturation baseline=${baseSat?.toFixed(4)} vivid=${vividSat?.toFixed(4)}`);
  check('vivid export is more saturated than baseline (export honours the preset)', baseSat != null && vividSat != null && vividSat > baseSat, `baseline ${baseSat} vs vivid ${vividSat}`);
} catch (e) {
  console.log(`FAIL  driver error — ${e.message}`);
  results.push(['driver completed', false, e.message]);
} finally {
  try { cdp?.close(); } catch { /* already closed */ }
  try { process.kill(child.pid, 'SIGTERM'); } catch { /* already dead */ }
  await sleep(500);
  try { process.kill(child.pid, 'SIGKILL'); } catch { /* already dead */ }
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} live checks passed`);
if (failed.length) { console.log('failures:', failed.map(([n]) => n).join(', ')); process.exitCode = 1; }
