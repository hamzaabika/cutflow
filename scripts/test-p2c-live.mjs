// Live verification for P2 stream C (P2-17, P2-19, P2-20, P2-40, P2-43):
// boots the real dev app on CDP 9228 with a fresh profile, loads a project
// with two clips + an Arabic caption, and drives each feature's UI for real.
// Run AFTER `npm run build`:  node scripts/test-p2c-live.mjs
// Screenshots land in the run dir for visual inspection.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9228;
const HOME = '/tmp/fve-p2-c';
const TMP = path.join(process.env.HOME, 'workspace/.tmp-p2-c-live');
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
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

// Two clips with clearly different colour: A = testsrc2 (detailed), B = warm gradients.
const clipA = path.join(TMP, 'clipA.mp4');
const clipB = path.join(TMP, 'clipB.mp4');
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-shortest', '-pix_fmt', 'yuv420p', clipA]);
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'gradients=size=360x640:rate=30:duration=6:c0=ff5522:c1=ffcc33', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-shortest', '-pix_fmt', 'yuv420p', clipB]);
const probeA = await ff.probe(clipA);
const probeB = await ff.probe(clipB);

const env = {
  ...process.env, HOME, DISPLAY: ':99', TMPDIR: TMP,
  VK_ICD_FILENAMES: path.join(process.env.HOME, 'workspace/vulkan/lvp_icd.json'),
  FVE_EXPORT_TARGET: TMP,
};
const logFile = path.join(TMP, 'electron-p2c.log');
const logFd = fs.openSync(logFile, 'w');
// Drain any leftover Electron first: a stale instance still holding the CDP
// port makes the new process fail to bind and the test then drives (and
// loses) the dying old one. Wait until no electron process remains.
for (let i = 0; i < 15; i++) {
  try { execFileSync('pkill', ['-x', 'electron']); } catch {}
  await sleep(1000);
  try { execFileSync('pgrep', ['-x', 'electron']); } catch { break; }
}
const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron'),
  ['.', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: ['ignore', logFd, logFd], detached: true });
console.log(`electron pid ${child.pid} (log: ${logFile})`);

const shot = async (cdp, name) => {
  const r = await cdp.call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(TMP, `${name}.png`), Buffer.from(r.data, 'base64'));
  console.log(`shot ${name}.png`);
};

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
  const clickText = (text, sel = 'button') => ev(`(() => { const b = [...document.querySelectorAll('${sel}')].find((x) => x.textContent.trim() === '${text}'); if (b) { b.click(); return true; } return false; })()`);

  await sleep(2500);
  await ev(`(() => { const b = document.querySelector('.home-create'); if (b) b.click(); return !!b; })()`);
  check('editor entered', await until(`!!document.querySelector('.play-btn')`, 20000));
  // The first-run Welcome card appears on entry into the editor (not on the
  // home screen), so dismiss it here — it swallows pointer hits until gone.
  await until(`(() => { const b = document.querySelector('.welcome-go'); if (b) { b.click(); return true; } return false; })()`, 8000);
  await sleep(600);

  // Seed the brand kit (logos/intro/outro point at the generated clips) so
  // the pack round-trip has real files to relink.
  await ev(`localStorage.setItem('clipcraft.brand', JSON.stringify({ logos: [{ path: ${JSON.stringify(clipA)}, name: 'clipA.mp4' }], colors: ['#825cfb'], font: 'cairo', color: '#825cfb', intro: { path: ${JSON.stringify(clipA)}, name: 'clipA.mp4' }, outro: { path: ${JSON.stringify(clipB)}, name: 'clipB.mp4' } }))`);

  const project = {
    name: 'P2-C check', ratio: '9:16', resolution: 720, width: 360, height: 640, fps: 30, background: '#000000',
    media: [
      { id: 'm0', path: clipA, name: 'clipA.mp4', ...probeA },
      { id: 'm1', path: clipB, name: 'clipB.mp4', ...probeB },
    ],
    videoClips: [
      { id: 'v1', mediaId: 'm0', in: 0, out: 6, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: ['blur'], transition: null },
      { id: 'v2', mediaId: 'm1', in: 0, out: 6, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null },
    ],
    overlayClips: [], audioClips: [], stickerClips: [], effectClips: [],
    textClips: [{
      id: 't1', text: 'صُنع بواسطة Cutflow، وهذا رائع!', caption: true, source: 'srt', start: 0.5, duration: 4,
      words: [
        { text: 'صُنع', start: 0, end: 0.8 }, { text: 'بواسطة', start: 0.8, end: 1.6 },
        { text: 'Cutflow،', start: 1.6, end: 2.4 }, { text: 'وهذا', start: 2.4, end: 3.2 }, { text: 'رائع!', start: 3.2, end: 4 },
      ],
      template: 'cap-arabic', font: 'cairo', size: 64, color: '#ffffff', x: 0.5, y: 0.62,
    }],
  };
  await ev(`window.__fve.load(${JSON.stringify(project)})`);
  await ev(`window.__fve.seek(1)`);
  await sleep(800);
  check('project loaded: 2 clips + Arabic caption', await ev(`(() => { const p = window.__fve.exportData().project; return p.videoClips.length === 2 && p.textClips.length === 1; })()`));

  // ---- P2-43: caption pack on the Arabic transcript -------------------------
  await ev(`window.__fve.select({ track: 'text', id: 't1' })`);
  await sleep(500);
  const packsVisible = await ev(`(() => { const b = [...document.querySelectorAll('button[role="tab"]')].find((x) => x.textContent.trim() === 'Templates'); if (b) b.click(); return !!b; })()`);
  await sleep(700);
  check('Templates tab shows caption packs', packsVisible && await until(`[...document.querySelectorAll('.caption-pack-row')].length === 5`, 10000));
  const packBtn = await ev(`(() => { const b = [...document.querySelectorAll('.caption-pack-row')].find((x) => x.querySelector('.composer-name')?.textContent === 'Arabic Safe'); if (b) { b.click(); return true; } return false; })()`);
  check('Arabic Safe pack row is clickable', packBtn);
  await sleep(500);
  const afterPack = await ev(`(() => { const c = window.__fve.exportData().project.textClips[0]; return { text: c.text, words: c.words.length, font: c.font, uppercase: c.uppercase, template: c.template }; })()`);
  check('Arabic Safe pack: transcript intact, Tajawal applied', afterPack.text === 'صُنع بواسطة Cutflow، وهذا رائع!' && afterPack.words === 5 && afterPack.font === 'tajawal' && afterPack.uppercase === false, JSON.stringify(afterPack));
  await ev(`window.__fve.seek(2)`);
  await sleep(600);
  await shot(cdp, 'arabic-caption');

  // ---- P2-20: intensity keyframes card on the blur effect -------------------
  // The effect cards live in the clip inspector's Adjust tab.
  await ev(`window.__fve.select({ track: 'video', id: 'v1' })`);
  await sleep(500);
  await ev(`(() => { const b = [...document.querySelectorAll('.ci-tabs button[role="tab"]')].find((x) => x.textContent.trim().startsWith('Adjust')); if (b) b.click(); return !!b; })()`);
  await sleep(500);
  const fxCard = await ev(`(() => { const el = [...document.querySelectorAll('*')].find((x) => x.textContent === 'Intensity keyframes'); return !!el; })()`);
  check('fx keyframes card renders for the blur effect', fxCard);
  // Add a key at the playhead (t=2s in clip-local time) via the card button.
  const keyAdded = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /^Add key at /.test(x.textContent.trim())); if (b) { b.click(); return b.textContent.trim(); } return false; })()`);
  await sleep(400);
  const keys = await ev(`window.__fve.exportData().project.videoClips[0].fxKeys`);
  check('Add key stores an intensity keyframe on the clip', !!keyAdded && Array.isArray(keys?.blur) && keys.blur.length === 1 && Math.abs(keys.blur[0].t - 2) < 0.05, `${keyAdded} ${JSON.stringify(keys)}`);

  // ---- P2-19: skin controls + shot match in Adjust --------------------------
  // The left panel's Adjust tab (via __fve.tab('adjust')) renders the same
  // GradePanel but its shot-match refs come from the left panel's `target`,
  // which evidently is not the selected clip here (shot match silently
  // absent while Skin tone and Scopes render). The inspector's GradePanel
  // takes refs from the selected clip directly — open it instead.
  await ev(`(() => { const b = [...document.querySelectorAll('.ci-tabs button[role="tab"]')].find((x) => x.textContent.trim().startsWith('Adjust')); if (b) b.click(); return !!b; })()`);
  await sleep(500);
  check('Skin tone section renders', await ev(`[...document.querySelectorAll('.grade-title')].some((x) => x.textContent === 'Skin tone')`));
  check('Shot match section renders with a reference clip', await ev(`[...document.querySelectorAll('.grade-title')].some((x) => x.textContent === 'Shot match') && !!document.querySelector('.grade-match select')`));
  const matchDone = await ev(`(async () => {
    const sel = document.querySelector('.grade-match select');
    if (!sel || sel.options.length < 2) return 'no-ref';
    sel.value = sel.options[1].value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const b = [...document.querySelectorAll('.grade-match button')].find((x) => x.textContent.includes('Match to reference'));
    if (!b) return 'no-btn';
    b.click();
    return 'clicked';
  })()`);
  await sleep(3000);
  const grade = await ev(`window.__fve.exportData().project.videoClips[0].grade`);
  check('shot match applies a grade patch from the reference clip', matchDone === 'clicked' && grade && (grade.temp || grade.tint || grade.exposure || grade.contrast || grade.saturation), `${matchDone} ${JSON.stringify(grade)}`);
  // Scopes: the panel samples the graded frame.
  check('Scopes panel renders in Adjust', await ev(`!!document.querySelector('.grade-group canvas, .scopes canvas') || [...document.querySelectorAll('.grade-title')].some((x) => x.textContent === 'Scopes')`));
  await ev(`document.querySelector('.scopes')?.scrollIntoView({ block: 'center' })`);
  await sleep(800);
  await shot(cdp, 'grade-scopes');

  // ---- P2-17: LUT preset capture + import with a missing font ---------------
  await ev(`window.__fve.tab('composer')`);
  await sleep(500);
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v1', patch: { filter: 'lut:cf-01-teak.cube', filterIntensity: 90 } })`);
  await sleep(300);
  await ev(`(() => {
    const input = document.querySelector('.preset-save input[type="text"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Teak LUT 90');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await ev(`(() => { const b = [...document.querySelectorAll('.preset-save button')].find((x) => x.textContent.trim() === 'Save'); b.click(); return !!b; })()`);
  await sleep(400);
  const lutPreset = await ev(`JSON.parse(localStorage.getItem('cutflow.creativePresets.v1') || '[]').find((p) => p.name === 'Teak LUT 90')`);
  check('LUT filter captures as a preset with a LUT asset entry', lutPreset?.variant === 'lut:cf-01-teak.cube' && lutPreset?.assets?.[0]?.relPath === 'luts/cf-01-teak.cube', JSON.stringify(lutPreset?.assets));
  // Import a preset whose font asset is absent on this machine.
  const importRes = await ev(`(() => {
    const input = document.querySelector('.composer-panel input[type="file"], input[type="file"]');
    if (!input) return 'no-input';
    const json = JSON.stringify({ kind: 'cutflow.creative-preset', schemaVersion: 1, id: 'cp_p2c1', name: 'No Such Font', target: 'caption', variant: null, params: { style: { font: 'no-such-font-xyz' } }, assets: [{ kind: 'font', name: 'no-such-font-xyz', relPath: 'fonts/no-such-font-xyz.ttf' }], source: 'user', createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z' });
    const dt = new DataTransfer();
    dt.items.add(new File([json], 'preset.json', { type: 'application/json' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'set';
  })()`);
  await sleep(600);
  const importNote = await ev(`document.body.textContent.includes('no-such-font-xyz')`);
  check('import reports the missing font asset instead of substituting', importRes === 'set' && importNote);

  // ---- P2-40: brand pack export -> import round-trip ------------------------
  await ev(`window.__fve.tab('brand')`);
  await sleep(600);
  const brandHasIntro = await ev(`document.body.textContent.includes('clipA.mp4') && document.body.textContent.includes('Intro')`);
  check('Brand panel shows the seeded intro/outro refs', brandHasIntro);
  // Send the download to the run dir (Electron would otherwise pop a save
  // dialog / use the OS Downloads folder under the scratch HOME).
  try { await cdp.call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: TMP }); } catch { /* older CDP: fall back to HOME/Downloads */ }
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Export pack'); b.click(); return !!b; })()`);
  await sleep(1500);
  const dlDir = fs.existsSync(path.join(TMP, 'cutflow-brand-pack.json')) ? TMP : path.join(HOME, 'Downloads');
  const dlFiles = fs.existsSync(dlDir) ? fs.readdirSync(dlDir).filter((f) => f.endsWith('.json')) : [];
  check('brand pack downloads as a .json file', dlFiles.length > 0, dlFiles.join(','));
  let packOk = false;
  let packMissing = '';
  if (dlFiles.length) {
    const packText = fs.readFileSync(path.join(dlDir, dlFiles[0]), 'utf8');
    const pack = JSON.parse(packText);
    packOk = pack.kind === 'cutflow.brand-pack' && pack.schemaVersion === 1 && pack.brand.intro?.name === 'clipA.mp4' && pack.brand.outro?.name === 'clipB.mp4';
    // Wipe the kit, then import the pack back: everything relinks.
    await ev(`localStorage.setItem('clipcraft.brand', JSON.stringify({ logos: [], colors: [], font: '', color: '', intro: null, outro: null }))`);
    await ev(`(() => {
      const inputs = [...document.querySelectorAll('input[type="file"]')];
      const input = inputs[inputs.length - 1];
      const dt = new DataTransfer();
      dt.items.add(new File([\`${packText.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`], 'cutflow-brand-pack.json', { type: 'application/json' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await sleep(1500);
    const kit = await ev(`JSON.parse(localStorage.getItem('clipcraft.brand') || '{}')`);
    packMissing = JSON.stringify(kit);
    packOk = packOk && kit.intro?.path === clipA && kit.outro?.path === clipB && kit.font === 'cairo' && kit.logos?.length === 1;
  }
  check('brand pack re-imports on a clean kit and relinks intro/outro/logo/font', packOk, packMissing);

  const failed = results.filter(([, okk]) => !okk);
  console.log(failed.length ? `P2C-LIVE FAIL (${failed.length}/${results.length})` : `P2C-LIVE OK (${results.length} checks)`);
  if (failed.length) process.exitCode = 1;
} catch (e) {
  console.error('P2C-LIVE ERROR', e);
  process.exitCode = 1;
} finally {
  try { if (cdp) cdp.close(); } catch { /* already closed */ }
  try { child.kill('SIGTERM'); } catch { /* already dead */ }
  await sleep(500);
  try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ }
}
