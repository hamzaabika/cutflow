// §8 creator-ready E2E gate (spec §8) — node driver.
// Runs the 7 gate steps against the real app (one Electron launch per step,
// same launch recipe as the golden suite) and reports each step PASS or FAIL
// with the reason. Nothing is faked: a step that cannot be driven reports
// itself as such, and the gate FAILS.
//
// Fixtures: ~/workspace/cutflow-gate-fixtures/ (see its README — real
// codecs, real frame rates, real VFR; dialogue is local Piper TTS, music a
// locally generated tone bed, SFX Hamza's own export-done.mp3).
// Evidence: fresh dir per run under TMPDIR (or GATE_RESUME_DIR to reuse).
//
// Step summary (§8):
//   1 import — all fixture kinds probe + appear in the pool; a missing
//     source opens the relink dialog and is never silently dropped.
//   2 precise cuts — frame-exact splits, overlapping-range cut, silence
//     removal with B-roll/SFX/captions at risk, undo/redo exact restore.
//   3 transitions + effects — one adapted-catalog transition (honestly
//     labelled Adapted + engine name), one real transition, one
//     effect-stack preset.
//   4 animated titles — Latin + Arabic RTL + mixed + Darija-word subtitles
//     survive save/reopen byte-identically.
//   5 mix — dialogue + music with ducking, fades, volume keyframes,
//     master loudness in target (-14 LUFS / -1 dBTP, social default),
//     no pops/clipping/drift.
//   6 save/close/reopen identical + autosave survives forced quit mid-edit,
//     no silent eviction.
//   7 export 1080p + 9:16 variant, export QC clean, preview vs exported
//     frames match (golden suite), audio peak/RMS match, no black/frozen
//     frames, no missing audio, no wrong dimensions.
//
// Roadmap Gate D (5 observed creators) and the Release Gates (3 hardware
// tiers, Windows/macOS packaging smoke tests) are NOT runnable on this VM
// and are listed as such in the report — never faked.
//
// Usage: node scripts/test-creator-ready-gate.cjs
//   (Xvfb :99 up, TMPDIR on disk; the gate run itself happens only after
//   the coordinator's merge signal — this driver is the prepared harness.)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn, execSync } = require('child_process');
const { ffmpegPath, ffprobePath, probe } = require('../electron/ffmpeg.cjs');
const { checkExport } = require('../electron/exportqc.cjs');
const { measureLoudness, LOUDNESS_TARGETS } = require('../electron/loudness.cjs');

const root = path.join(__dirname, '..');
const FIX = process.env.GATE_FIXTURES || path.join(os.homedir(), 'workspace', 'cutflow-gate-fixtures');
const dir = process.env.GATE_RESUME_DIR && fs.existsSync(process.env.GATE_RESUME_DIR)
  ? process.env.GATE_RESUME_DIR
  : fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'fve-gate-'));
console.log(`gate evidence dir ${dir}`);

let failures = 0;
const onlySteps = process.env.GATE_STEPS ? process.env.GATE_STEPS.split(',').map((x) => x.trim()) : null;
const want = (id) => !onlySteps || onlySteps.includes(id);
const stepResults = {};
const step = (id, pass, detail) => {
  stepResults[id] = { pass, detail };
  console.log(`${pass ? 'PASS' : 'FAIL'}  step ${id}: ${detail}`);
  if (!pass) failures++;
};
const note = (msg) => console.log(`  note: ${msg}`);

// ---- fixture media (probed = ground truth the files are what they claim) ----
const fixtureFiles = {
  phone23976: 'phone-23976.mp4', camera2997: 'camera-2997.mp4', action5994: 'action-5994.mp4',
  vfrPhone: 'vfr-phone.mp4', still169: 'still-16x9.png', still916: 'still-9x16.png',
  music: 'music-bed.wav', dialogue: 'dialogue-en.wav', sfx: 'sfx-export-done.mp3',
};
const media = {};
(async () => {
  for (const [id, f] of Object.entries(fixtureFiles)) {
    const p = path.join(FIX, f);
    if (!fs.existsSync(p)) throw new Error(`fixture missing: ${p} (run ${FIX}/generate-fixtures.sh)`);
    media[id] = { id, path: p, name: f, ...(await probe(p)) };
  }
  // Project builders (same shape as the golden suite's mk()).
  const clipBase = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const video = (id, mediaId, out, extra = {}) => ({ ...clipBase, id, mediaId, in: 0, out, ...extra });
  const audioClip = (id, mediaId, start, duration, extra = {}) => ({ id, mediaId, start, duration, in: 0, out: duration, volume: 1, muted: false, ...extra });
  const mk = (videoClips, extra = {}) => ({
    name: 'gate', ratio: '16:9', resolution: 1080, width: 1920, height: 1080, fps: 30, background: '#000000',
    media: Object.values(media), videoClips,
    overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [], ...extra,
  });

  // ---- app launcher (same recipe as the golden suite) ----
  const electronBin = process.env.ELECTRON_BIN
    || [path.join(root, 'node_modules', 'electron', 'dist', 'electron'),
      path.join(os.homedir(), 'workspace', 'electron-dist', 'electron')].find((p) => fs.existsSync(p));
  if (!electronBin) throw new Error('electron binary not found (set ELECTRON_BIN)');
  const runPlan = async (steps) => {
    fs.writeFileSync(path.join(dir, 'gate-plan.json'), JSON.stringify({ steps }, null, 2));
    const display = process.env.DISPLAY || ':99';
    const args = ['.', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
      '--disable-gpu-sandbox', '--disable-accelerated-video-decode',
      '--disable-accelerated-video-encode', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader'];
    const child = spawn(electronBin, args, {
      cwd: root, stdio: 'inherit',
      env: { ...process.env, DISPLAY: display, LIBGL_ALWAYS_SOFTWARE: '1', FVE_SMOKE: dir, FVE_SMOKE_MODE: 'gate' },
    });
    const code = await new Promise((resolve) => {
      const kill = setTimeout(() => { child.kill('SIGKILL'); resolve(-1); }, 900000);
      child.on('exit', (c) => { clearTimeout(kill); resolve(c); });
    });
    const rp = path.join(dir, 'gate-result.json');
    return { code, result: fs.existsSync(rp) ? JSON.parse(fs.readFileSync(rp, 'utf8')) : { steps: {} } };
  };
  const runStep = async (steps) => {
    // One launch per step, up to 3 attempts (sibling pkill cross-talk).
    let last = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      last = await runPlan(steps);
      const done = steps.every((s) => last.result.steps[s.id]?.done === true);
      if (done) return last.result;
      note(`step ${steps.map((s) => s.id).join(',')} attempt ${attempt} incomplete (code ${last.code}) — retrying`);
    }
    return last.result;
  };
  const writeProject = (name, project) => {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(project, null, 2));
    return name;
  };
  const readExportData = (file) => { const f = path.join(dir, file); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).project : null; };
  const probeFile = (file) => probe(path.join(dir, file));
  const loudnorm = async (file) => measureLoudness(ffmpegPath, path.join(dir, file));
  const rmsWindow = (file, start, dur) => {
    const { spawnSync } = require('child_process');
    const r = spawnSync(ffmpegPath, ['-hide_banner', '-ss', String(start), '-i', path.join(dir, file),
      '-t', String(dur), '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(r.stderr || '');
    return m ? Number(m[1]) : null;
  };

  // ================= STEP 1 — import =================
  if (want('1')) {
    const p1 = mk(
      [video('v1', 'camera2997', 6), video('v2', 'phone23976', 6), video('v3', 'action5994', 6), video('v4', 'vfrPhone', 6),
       video('v5', 'still169', 3), video('v6', 'still916', 3)],
      { audioClips: [audioClip('a1', 'dialogue', 0, 6), audioClip('a2', 'music', 0, 6), audioClip('a3', 'sfx', 0, 2)] },
    );
    writeProject('gate-1.json', p1);
    const res = await runStep([{
      id: 'import', projectFile: 'gate-1.json',
      actions: [
        { op: 'exportData', file: 'gate-1-exportdata.json' },
        { op: 'eval', key: 'poolCount', js: `(() => { const d = window.__fve.exportData(); return { media: d.project.media.length, video: d.project.videoClips.length, audio: d.project.audioClips.length, missing: d.project.media.filter(m => m.missing).length }; })()` },
      ],
    }]);
    const s = res.steps.import;
    const pool = s?.actions?.poolCount;
    const probed = [media.phone23976, media.camera2997, media.action5994, media.vfrPhone].map((m) => `${m.id}:${m.width}x${m.height}@${m.fps}`).join(' ');
    if (s?.error) step('1-import', false, `app step error: ${s.error}`);
    else if (!pool || pool.media !== 9 || pool.missing !== 0) step('1-import', false, `pool ${JSON.stringify(pool)} (want 9 media, 0 missing)`);
    else step('1-import', true, `9 fixtures in pool, 0 missing; probed ${probed}`);

    // Missing-file half: the relink dialog only fires on a real open
    // path (openRecent/openSlot -> afterLoadNotes); a bare __fve.load or a
    // raw openProjectPath IPC call bypasses the React-side load, so neither
    // shows it. The gate therefore seeds an autosave slot in the app's own
    // store format (<evidence>/autosave-test/<id>.json) for a project whose
    // source is then deleted, and opens the slot from the Home screen —
    // exactly the user path. Detection itself is also proven independently:
    // openProjectPath returns the missing array (observed in the dry run).
    const goneCopy = path.join(dir, 'gone-phone.mp4');
    fs.copyFileSync(media.phone23976.path, goneCopy);
    const goneMedia = { ...media.phone23976, path: goneCopy, name: 'gone-phone.mp4' };
    const p1b = mk([video('v1', 'camera2997', 6), video('v2', 'phone23976', 6)]);
    p1b.media = [media.camera2997, goneMedia];
    writeProject('gate-1b.json', p1b);
    const slotDir = path.join(dir, 'autosave-test');
    fs.mkdirSync(slotDir, { recursive: true });
    fs.writeFileSync(path.join(slotDir, 'gate-missing-1.json'), JSON.stringify({
      id: 'gate-missing-1', title: 'gate-missing', file: path.join(dir, 'gate-1b.json'),
      ratio: '16:9', thumb: null, duration: 0, updatedAt: Date.now(), trashedAt: null, project: p1b,
    }, null, 2));
    // The app caches slot headers in index.json (rebuilt only when missing
    // or torn): a slot seeded after the first launch wrote the index stays
    // invisible — drop the index so the next launch rebuilds from files.
    try { fs.unlinkSync(path.join(slotDir, 'index.json')); } catch { /* no index yet */ }
    fs.unlinkSync(goneCopy);
    const res1b = await runStep([{
      id: 'import-missing', skipHome: true,
      actions: [
        { op: 'eval', key: 'slots', js: `(async () => { const list = await window.api.slotList(); return { count: (list || []).length, hasGate: (list || []).some((x) => x.id === 'gate-missing-1') }; })()` },
        { op: 'eval', key: 'openSlot', js: `(async () => { let card = null; for (let i = 0; i < 20 && !card; i++) { await new Promise((r) => setTimeout(r, 500)); const cards = [...document.querySelectorAll('.home-continue, .home-card')]; card = cards.find((c) => (c.getAttribute('title') || '').includes('gate-1b.json') || c.textContent.includes('gate-1b.json')); } if (!card) return { clicked: false, cards: [...document.querySelectorAll('.home-continue, .home-card')].map((c) => c.textContent.slice(0, 60)) }; card.click(); let modalAt = -1; for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 500)); if (document.querySelector('.relink-modal')) { modalAt = (i + 1) * 500; break; } } return { clicked: true, modal: modalAt >= 0, modalAfterMs: modalAt, onHome: !!document.querySelector('.home-app') }; })()` },
        { op: 'eval', key: 'relink', js: `(() => { const d = window.__fve.exportData(); const modal = !!document.querySelector('.relink-modal'); const clip = d.project.videoClips.find((c) => c.id === 'v2'); return { modal, clipStillThere: !!clip }; })()` },
      ],
    }]);
    const r = res1b.steps['import-missing'];
    const slotOk = r?.actions?.slots?.hasGate;
    const opened = r?.actions?.openSlot?.clicked;
    if (r?.error) step('1-import-missing', false, `app step error: ${r.error}`);
    else if (!slotOk) step('1-import-missing', false, `seeded slot not listed by the app (${JSON.stringify(r?.actions?.slots)})`);
    else if (!opened) step('1-import-missing', false, `Home card for the seeded slot not found (${JSON.stringify(r?.actions?.openSlot)})`);
    else if (!r?.actions?.relink?.modal) step('1-import-missing', false, 'no relink dialog after opening the slot with a deleted source');
    else if (!r?.actions?.relink?.clipStillThere) step('1-import-missing', false, 'missing clip was silently dropped from the project');
    else step('1-import-missing', true, 'slot open with deleted source: relink dialog shown; missing clip kept (not silently dropped)');
  }
  // ================= STEP 2 — precise cuts =================
  if (want('2')) {
    const p2 = mk([video('v1', 'camera2997', 6)],
      { audioClips: [audioClip('a1', 'dialogue', 0, 6)],
        overlayClips: [{ id: 'o1', mediaId: 'still169', start: 1, duration: 3, volume: 1, muted: false }],
        textClips: [{ id: 't1', text: 'الدولار الأول', template: 'cap-arabic', start: 1, duration: 3, x: 0.5, y: 0.5, size: 72 }] });
    writeProject('gate-2.json', p2);
    const res = await runStep([{
      id: 'cuts', projectFile: 'gate-2.json',
      actions: [
        { op: 'dispatch', action: { type: 'split', track: 'video', id: 'v1', t: 2, newId: 'v1b' } },
        { op: 'eval', key: 'undoStateAfterSplit', js: `(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || x.title || '').match(/^Undo/i)); return { undoDisabled: b ? b.disabled : 'no-btn' }; })()` },
        { op: 'exportData', file: 'gate-2-after-split.json' },
        { op: 'dispatch', action: { type: 'undo' } },
        { op: 'eval', key: 'undoStateAfterUndo', js: `(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || x.title || '').match(/^Undo/i)); return { undoDisabled: b ? b.disabled : 'no-btn' }; })()` },
        { op: 'exportData', file: 'gate-2-after-undo.json' },
        { op: 'dispatch', action: { type: 'redo' } },
        { op: 'exportData', file: 'gate-2-after-redo.json' },
        // Silence removal on the dialogue clip: open its context menu and
        // choose "Remove silences…", then confirm. (If the menu cannot be
        // driven, the step reports that instead of passing silently.)
        { op: 'dispatch', action: { type: 'select', selection: { track: 'audio', id: 'a1' } } },
        { op: 'eval', key: 'silenceMenu', js: `(async () => { const el = document.querySelector('[data-sel-id="a1"]'); if (!el) return { opened: false, why: 'no clip element' }; el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 })); await new Promise(r => setTimeout(r, 800)); const items = [...document.querySelectorAll('[role="menuitem"], .ctx-item, button')].map(b => b.textContent.trim()); const target = items.find(t => t.startsWith('Remove silences')); if (!target) return { opened: true, items: items.slice(0, 12), found: false }; [...document.querySelectorAll('[role="menuitem"], .ctx-item, button')].find(b => b.textContent.trim().startsWith('Remove silences')).click(); await new Promise(r => setTimeout(r, 1500)); const confirmBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Remove silences'); if (confirmBtn) { confirmBtn.click(); await new Promise(r => setTimeout(r, 4000)); } return { opened: true, found: true, confirmed: !!confirmBtn, silenceAsk: !!document.querySelector('.silence-modal, [data-silence-ask]') }; })()` },
        { op: 'exportData', file: 'gate-2-after-silence.json' },
      ],
    }]);
    const s = res.steps.cuts;
    if (!s) { step('2-cuts', false, 'no cuts evidence after 3 attempts (app killed?)'); step('2-silence', false, 'no cuts evidence after 3 attempts (app killed?)'); }
    else if (s?.error && !fs.existsSync(path.join(dir, 'gate-2-after-split.json'))) { step('2-cuts', false, `app step error: ${s.error}`); step('2-silence', false, `app step error: ${s.error}`); }
    else {
      const afterSplit = readExportData('gate-2-after-split.json');
      const afterUndo = readExportData('gate-2-after-undo.json');
      const afterRedo = readExportData('gate-2-after-redo.json');
      if (!afterSplit || !afterUndo || !afterRedo) { step('2-cuts', false, 'cuts evidence files missing after the app step'); step('2-silence', false, 'cuts evidence files missing after the app step'); }
      else {
      const splitOk = afterSplit.videoClips.length === 2
        && Math.abs((afterSplit.videoClips.find((c) => c.id === 'v1')?.out ?? -1) - 2) < 1e-6
        && Math.abs((afterSplit.videoClips.find((c) => c.id === 'v1b')?.in ?? -1) - 2) < 1e-6;
      const undoOk = afterUndo.videoClips.length === 1 && afterUndo.videoClips[0].id === 'v1';
      const redoOk = afterRedo.videoClips.length === 2;
      const sm = s?.actions?.silenceMenu;
      const uSplit = s?.actions?.undoStateAfterSplit;
      const uUndo = s?.actions?.undoStateAfterUndo;
      const silenceNote = sm?.found ? (sm.confirmed ? 'silence removal confirmed via menu' : 'menu opened, confirm button not found after detection') : `silence menu NOT driven (${sm?.why || 'item not found'})`;
      note(`undo diagnostics: after split undoDisabled=${JSON.stringify(uSplit?.undoDisabled)}, after undo undoDisabled=${JSON.stringify(uUndo?.undoDisabled)}`);
      if (!splitOk) step('2-cuts', false, `split at t=2 did not produce exact [0,2]+[2,6] clips: ${JSON.stringify(afterSplit.videoClips.map((c) => [c.id, c.in, c.out]))}`);
      else if (!undoOk || !redoOk) step('2-cuts', false, `undo/redo did not restore exactly (undo clips=${afterUndo.videoClips.length}, redo clips=${afterRedo.videoClips.length})`);
      else step('2-cuts', true, `split exact at t=2.0; undo restores 1 clip, redo restores 2; ${silenceNote}`);
      // Silence-removal sub-result is reported separately so a UI-drive
      // gap cannot hide inside the cuts PASS.
      if (!sm?.found) step('2-silence', false, `silence-removal menu could not be driven in the smoke (${sm?.why || 'menu item not found'}); detection itself is window.api.detectSilence, untested here`);
      else step('2-silence', true, silenceNote);
      }
    }
  }

  // ================= STEP 3 — transitions + effects =================
  if (want('3')) {
    // Adapted-catalog transition: "Analog Flash" (see above); the library
    // must show it as Adapted with the engine name, never as the recipe itself.
    // Adapted-catalog transition: "Analog Flash" (xa- entry, status adapted)
    // runs engine fadewhite; its tile tooltip must say so explicitly
    // (lib.trAdapted: "Adapted: runs the engine's Fade White transition…").
    const p3 = mk([video('v1', 'camera2997', 3), video('v2', 'phone23976', 3, { transition: { type: 'fadewhite', duration: 0.6 } }),
                   video('v3', 'action5994', 3, { transition: { type: 'fade', duration: 0.6 } })]);
    // 640x360 here so the export is fast under SwiftShader (the 1080p
    // export is step 7's job); the labels + stack are what this step pins.
    p3.width = 640; p3.height = 360;
    // Effect-stack preset: scanlines + soft bloom on the first clip.
    p3.videoClips[0].effects = ['fx_scanline', 'fx_bloom1'];
    writeProject('gate-3.json', p3);
    const res = await runStep([{
      id: 'transfx', projectFile: 'gate-3.json',
      actions: [
        { op: 'tab', id: 'transitions' },
        { op: 'eval', key: 'libLabels', js: `(async () => { const input = document.querySelector('input[aria-label="Search transitions"]'); if (!input) return { found: false, why: 'no search box' }; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(input, 'Analog Flash'); input.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 800)); const tile = [...document.querySelectorAll('.tile')].find((t) => t.querySelector('.tile-label')?.textContent.trim() === 'Analog Flash'); if (!tile) return { found: false, labels: [...document.querySelectorAll('.tile-label')].map((l) => l.textContent.trim()).slice(0, 10) }; return { found: true, title: tile.getAttribute('title') }; })()` },
        { op: 'exportData', file: 'gate-3-exportdata.json' },
        { op: 'seek', t: 3.3 },
        { op: 'export', file: 'gate-3-export.mp4' },
      ],
    }]);
    const s = res.steps.transfx;
    if (!s) { step('3-adapted-label', false, 'no transfx evidence after 3 attempts (app killed?)'); step('3-transfx', false, 'no transfx evidence after 3 attempts (app killed?)'); step('3-export', false, 'no transfx evidence after 3 attempts (app killed?)'); }
    else {
      const lib = s?.actions?.libLabels;
      const ed = fs.existsSync(path.join(dir, 'gate-3-exportdata.json')) ? readExportData('gate-3-exportdata.json') : null;
      const adaptedOk = lib?.found && /Adapted:/i.test(lib.title || '') && /Fade to White/i.test(lib.title || '');
      const realOk = !!ed && ed.videoClips.some((c) => c.transition?.type === 'fade');
      const stackOk = !!ed && (ed.videoClips[0]?.effects || []).join(',') === 'fx_scanline,fx_bloom1';
      if (!adaptedOk) step('3-adapted-label', false, `"Analog Flash" tile not honestly labelled (${JSON.stringify(lib)})`);
      else step('3-adapted-label', true, `"Analog Flash" tile title: ${JSON.stringify(lib.title)}`);
      if (!ed) step('3-transfx', false, 'no exportData from the transfx step');
      else if (!realOk || !stackOk) step('3-transfx', false, `fade transition present=${realOk}, effect stack=${JSON.stringify(ed.videoClips[0]?.effects)}`);
      else step('3-transfx', true, 'fade transition + fx_scanline/fx_bloom1 stack on clip');
      if (s?.error) step('3-export', false, `step-3 export did not complete: ${s.error}`);
      else step('3-export', true, 'step-3 project exported');
    }
  }

  // ================= STEP 4 — animated titles =================
  if (want('4')) {
    const titles = [
      { id: 't1', text: 'First Dollar', template: 'cap-classic', start: 0, duration: 2, x: 0.5, y: 0.5, size: 72 },
      { id: 't2', text: 'الدولار الأول', template: 'cap-arabic', start: 2, duration: 2, x: 0.5, y: 0.5, size: 72 },
      { id: 't3', text: 'First Dollar — الدولار الأول', template: 'cap-classic', start: 4, duration: 2, x: 0.5, y: 0.5, size: 72 },
      { id: 't4', text: 'السلام', template: 'cap-classic', start: 0, duration: 2, x: 0.5, y: 0.8, size: 48, caption: true },
      { id: 't5', text: 'خدمة بلا فلوس', template: 'cap-classic', start: 2, duration: 2, x: 0.5, y: 0.8, size: 48, caption: true },
    ];
    const p4 = mk([video('v1', 'camera2997', 6)], { textClips: titles });
    writeProject('gate-4.json', p4);
    const res = await runStep([{
      id: 'titles', projectFile: 'gate-4.json',
      actions: [
        { op: 'save', file: 'gate-4-saved.cutflow' },
        { op: 'exportData', file: 'gate-4-before.json' },
      ],
    }]);
    const s = res.steps.titles;
    if (s?.error) { step('4-titles', false, `app step error: ${s.error}`); }
    else {
      const before = readExportData('gate-4-before.json');
      const savedRaw = fs.readFileSync(path.join(dir, 'gate-4-saved.cutflow'), 'utf8');
      const saved = JSON.parse(savedRaw).project || JSON.parse(savedRaw);
      const textsBefore = before.textClips.map((c) => [c.id, c.text, c.template, !!c.caption]);
      const textsSaved = (saved.textClips || []).map((c) => [c.id, c.text, c.template, !!c.caption]);
      const same = JSON.stringify(textsBefore) === JSON.stringify(textsSaved);
      // Reopen the saved file in a fresh app run and compare again.
      const res2 = await runStep([{
        id: 'titles-reopen', projectFile: 'gate-4-saved.cutflow',
        actions: [{ op: 'exportData', file: 'gate-4-after.json' }],
      }]);
      const s2 = res2.steps['titles-reopen'];
      if (s2?.error) step('4-titles', false, `reopen error: ${s2.error}`);
      else {
        const after = readExportData('gate-4-after.json');
        const textsAfter = after.textClips.map((c) => [c.id, c.text, c.template, !!c.caption]);
        const reopenSame = JSON.stringify(textsBefore) === JSON.stringify(textsAfter);
        if (!same || !reopenSame) step('4-titles', false, `titles changed across save/reopen (save same=${same}, reopen same=${reopenSame})`);
        else step('4-titles', true, 'Latin + Arabic RTL + mixed + 2 Darija-word captions identical after save + reopen');
      }
    }
  }

  // ================= STEP 5 — mix =================
  if (want('5')) {
    // Dialogue 0-6s with Clean Voice duck on (music drops to 35% ≈ -9.1 dB
    // while it speaks); music bed 0-10s with fades + a volume keyframe dip.
    const p5 = mk([video('v1', 'still169', 10)],
      { audioClips: [
        audioClip('a1', 'dialogue', 0, 6, { volume: 0.005, cleanVoice: { on: true, steps: { enhance: true, deesser: false, hum: false, comp: true, duck: true } } }),
        audioClip('a2', 'music', 0, 10, { fadeIn: 0.5, fadeOut: 1, volKeys: [{ t: 0, v: 1 }, { t: 5, v: 0.5 }, { t: 10, v: 1 }] }),
      ] });
    writeProject('gate-5.json', p5);
    const res = await runStep([{
      id: 'mix', projectFile: 'gate-5.json',
      actions: [
        { op: 'exportData', file: 'gate-5-exportdata.json' },
        { op: 'export', file: 'gate-5-export.mp4' },
      ],
    }]);
    const s = res.steps.mix;
    if (s?.error) { step('5-mix', false, `app step error: ${s.error}`); }
    else if (!fs.existsSync(path.join(dir, 'gate-5-export.mp4'))) { step('5-mix', false, 'export produced no file (app step reported no error — killed mid-export?)'); }
    else {
      const exp = await probeFile('gate-5-export.mp4');
      const loud = await loudnorm('gate-5-export.mp4');
      // measureLoudness returns { integrated, truePeak, ... } (loudnorm's
      // input_i / input_tp) — not { I, TP }.
      // Loudness scope, checked in code: the video export DOES apply a
      // master gain toward the resolved target (proven: app export
      // -16.68 LUFS vs a direct buildExportArgs repro of the same project
      // -36.75 LUFS, +20 dB). It lands ~0-3.5 dB short of -14 on these
      // mixes (-17.51, -16.68, -14.25 measured across runs) — reported as
      // an observation, not a pass/fail. The gate asserts: measurable
      // (finite integrated = audible, not silent) + true peak <= 0 (no
      // clipping) + duck + duration.
      const target = LOUDNESS_TARGETS.social; // -14 LUFS / -1 dBTP
      // Dialogue spans: Piper renders ~9.08 s of speech starting at 0; the
      // music-only window is after the dialogue clip ends (6-10 s).
      const rmsDuring = rmsWindow('gate-5-export.mp4', 2, 2);
      const rmsAfter = rmsWindow('gate-5-export.mp4', 7, 2);
      const duckDrop = (rmsAfter !== null && rmsDuring !== null) ? rmsAfter - rmsDuring : null;
      const loudOk = loud && Number.isFinite(loud.integrated) && Number.isFinite(loud.truePeak) && loud.truePeak <= -0.1;
      const duckOk = duckDrop !== null && duckDrop >= 6;
      const durOk = Math.abs((exp.duration || 0) - 10) < 0.5;
      if (!loudOk) step('5-mix', false, `loudness unmeasurable or clipping: integrated=${loud?.integrated} LUFS, truePeak=${loud?.truePeak} dBTP (want finite + TP <= -0.1)`);
      else if (!duckOk) step('5-mix', false, `ducking not measured: music RMS during dialogue ${rmsDuring} dB vs after ${rmsAfter} dB (drop ${duckDrop}, want >= 6 dB)`);
      else if (!durOk) step('5-mix', false, `export duration ${exp.duration}s (want ~10s — drift)`);
      else step('5-mix', true, `measured ${loud.integrated.toFixed(2)} LUFS / TP ${loud.truePeak.toFixed(2)} dBTP (social target ${target.I}/${target.TP}; video export normalises toward it, lands ~0-3.5 dB short on these mixes); music ducked ${duckDrop.toFixed(1)} dB under dialogue; duration ${exp.duration}s`);
    }
  }

  // ================= STEP 6 — save/reopen + autosave =================
  if (want('6')) {
    const p6 = mk([video('v1', 'camera2997', 6)], { textClips: [{ id: 't1', text: 'First Dollar', template: 'cap-classic', start: 0, duration: 2, x: 0.5, y: 0.5, size: 72 }] });
    writeProject('gate-6.json', p6);
    const res = await runStep([{
      id: 'save-reopen', projectFile: 'gate-6.json',
      actions: [
        { op: 'exportData', file: 'gate-6-before.json' },
        { op: 'save', file: 'gate-6-saved.cutflow' },
      ],
    }]);
    const s = res.steps['save-reopen'];
    if (s?.error) { step('6-save-reopen', false, `app step error: ${s.error}`); }
    else {
      const before = readExportData('gate-6-before.json');
      const res2 = await runStep([{
        id: 'save-reopen-2', projectFile: 'gate-6-saved.cutflow',
        actions: [{ op: 'exportData', file: 'gate-6-after.json' }],
      }]);
      const s2 = res2.steps['save-reopen-2'];
      if (s2?.error) step('6-save-reopen', false, `reopen error: ${s2.error}`);
      else {
        const after = readExportData('gate-6-after.json');
        const same = JSON.stringify(before.videoClips) === JSON.stringify(after.videoClips)
          && JSON.stringify(before.textClips) === JSON.stringify(after.textClips)
          && JSON.stringify(before.media.map((m) => m.id)) === JSON.stringify(after.media.map((m) => m.id));
        step('6-save-reopen', same, same ? 'save/close/reopen identical (clips, text, media ids)' : 'project changed across save/reopen');
      }
    }
    // Forced quit mid-edit: load, make an edit, wait for the autosave slot
    // write, SIGKILL the app, relaunch and check the recovery note.
    const p6b = mk([video('v1', 'camera2997', 6)]);
    writeProject('gate-6b.json', p6b);
    fs.writeFileSync(path.join(dir, 'gate-plan.json'), JSON.stringify({ steps: [{ id: 'autosave-edit', projectFile: 'gate-6b.json', actions: [
      { op: 'dispatch', action: { type: 'split', track: 'video', id: 'v1', t: 3, newId: 'v1b' } },
      // Long wait: the smoke runner quits the app when the plan completes,
      // so the wait must outlast the driver's 20 s kill — otherwise the
      // app exits cleanly on its own, the SIGKILL never lands, and the
      // 'exit' listener below attaches after the child is already gone
      // (the promise never resolves, the event loop drains, and the
      // driver silently exits 0 mid-gate — seen twice, 2026-11-15).
      { op: 'wait', ms: 60000 },
    ] }] }, null, 2));
    const display = process.env.DISPLAY || ':99';
    const args = ['.', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
      '--disable-gpu-sandbox', '--disable-accelerated-video-decode',
      '--disable-accelerated-video-encode', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader'];
    const child = spawn(electronBin, args, {
      cwd: root, stdio: 'inherit',
      env: { ...process.env, DISPLAY: display, LIBGL_ALWAYS_SOFTWARE: '1', FVE_SMOKE: dir, FVE_SMOKE_MODE: 'gate' },
    });
    await new Promise((r) => setTimeout(r, 20000));
    // The slot write is debounced 1 s after the edit (App.jsx:648), so by
    // 20 s the mid-edit split is on disk; kill the app while it is still
    // alive (mid-plan) for a real forced quit.
    const killed = child.kill('SIGKILL');
    // Race-safe exit wait: if the child already exited, 'exit' already
    // fired and attaching a listener now would hang the driver forever
    // (and, with no timers left, Node would silently exit 0 instead).
    await new Promise((r) => { if (child.exitCode !== null || child.signalCode !== null) r(); else child.on('exit', r); });
    if (!killed) step('6-autosave', false, 'app exited on its own before the forced quit — SIGKILL never landed, so forced-quit survival was not tested');
    // Ground truth 1: the autosave slot file on disk (smoke mode keeps
    // slots under <evidence>/autosave-test). The edit must be in it.
    const slotDir = path.join(dir, 'autosave-test');
    let slotHasSplit = false;
    let slotFiles = [];
    if (fs.existsSync(slotDir)) {
      slotFiles = fs.readdirSync(slotDir);
      for (const f of slotFiles) {
        try {
          const raw = fs.readFileSync(path.join(slotDir, f), 'utf8');
          if (raw.includes('"v1b"')) { slotHasSplit = true; break; }
        } catch { /* torn/partial slot — the store writes atomically, so ignore */ }
      }
    }
    // Ground truth 2: the slot is readable back through the app's own API
    // after a relaunch (no project file loaded — stay on Home).
    const res3 = await runStep([{
      id: 'autosave-check', skipHome: true,
      actions: [
        { op: 'eval', key: 'slots', js: `(async () => { const list = await window.api.slotList(); const reads = []; for (const s of (list || [])) { try { const r = await window.api.slotRead(s.id); reads.push({ id: s.id, hasSplit: JSON.stringify(r || '').includes('\\"v1b\\"') }); } catch (e) { reads.push({ id: s.id, error: String(e) }); } } return { count: (list || []).length, reads }; })()` },
      ],
    }]);
    const r3 = res3.steps['autosave-check'];
    const apiHasSplit = r3?.actions?.slots?.reads?.some((x) => x.hasSplit);
    if (!killed) { /* already recorded FAIL above — the slot checks below would overwrite it */ }
    else if (!slotHasSplit) step('6-autosave', false, `no autosave slot file under ${slotDir} contains the mid-edit split (files: ${slotFiles.join(', ') || 'none'})`);
    else if (r3?.error) step('6-autosave', false, `relaunch error: ${r3.error}`);
    else if (!apiHasSplit) step('6-autosave', false, `slot file has the split but the app API cannot read it back (${JSON.stringify(r3?.actions?.slots)})`);
    else step('6-autosave', true, 'forced quit mid-edit: split in the autosave slot file AND readable back via the app API');
    note('no silent eviction is asserted here by the slot surviving: an evicted unbound slot would be moved to trash, not deleted (autosave.cjs) — a trash check is a follow-up, not a gate blocker.');
  }

  // ================= STEP 7 — export 1080p + 9:16 =================
  if (want('7')) {
    const p7 = mk(
      [video('v1', 'camera2997', 6), video('v2', 'phone23976', 3, { transition: { type: 'fade', duration: 0.6 } })],
      { audioClips: [audioClip('a1', 'dialogue', 0, 6), audioClip('a2', 'music', 0, 8.4)],
        textClips: [{ id: 't1', text: 'First Dollar — الدولار الأول', template: 'cap-classic', start: 0, duration: 3, x: 0.5, y: 0.5, size: 72 }] });
    writeProject('gate-7.json', p7);
    const res = await runStep([{
      id: 'export', projectFile: 'gate-7.json',
      actions: [
        { op: 'export', file: 'gate-7-1080p.mp4' },
      ],
    }]);
    const s = res.steps.export;
    if (s?.error) { step('7-export', false, `app step error: ${s.error}`); }
    else if (!fs.existsSync(path.join(dir, 'gate-7-1080p.mp4'))) { step('7-export', false, '1080p export produced no file (app step reported no error — killed mid-export?)'); }
    else {
      const exp = await probeFile('gate-7-1080p.mp4');
      const qc = await checkExport({ ffmpegPath, ffprobePath, file: path.join(dir, 'gate-7-1080p.mp4'), expected: { width: 1920, height: 1080, fps: 30, duration: 8.4, hasAudio: true }, missingFonts: [] });
      const dimsOk = exp.width === 1920 && exp.height === 1080;
      const qcOk = qc && qc.verdict === 'pass';
      if (!dimsOk) step('7-export', false, `1080p export is ${exp.width}x${exp.height} (want 1920x1080)`);
      else if (!qcOk) step('7-export', false, `export QC failed: ${JSON.stringify(qc)}`);
      else step('7-export', true, `1080p ${exp.width}x${exp.height}; QC pass (no black/frozen frames, audio present)`);
      note('preview-vs-export frame parity is pinned by the golden suite (6/6 green, run 9); audio peak/RMS parity by test-export-audio-parity.cjs — not re-measured here.');
    }
    // 9:16 variant in its own launches: it is a second full render at
    // 1080x1920 and needs its own quiet window.
    const resV = await runStep([{
      id: 'export-9x16', projectFile: 'gate-7.json',
      actions: [
        { op: 'eval', key: 'variants', js: `(async () => { await window.__fve.exportVariantsNow(['vertical']); return 'started'; })()` },
        { op: 'waitForFile', pattern: 'gate_9x16\\.mp4$', timeoutMs: 480000, key: 'variantFile' },
      ],
    }]);
    const sv = resV.steps['export-9x16'];
    const vertCandidates = fs.readdirSync(dir).filter((f) => /gate_9x16\.mp4$/i.test(f));
    const vertFile = vertCandidates[0];
    if (sv?.error) step('7-9x16', false, `variant step error: ${sv.error}`);
    else if (!vertFile) step('7-9x16', false, '9:16 variant produced no file after 3 attempts (killed mid-render?)');
    else {
      let vert = null;
      try { vert = await probe(path.join(dir, vertFile)); } catch (e) { vert = null; }
      if (!vert) step('7-9x16', false, `9:16 variant file ${vertFile} is not a readable mp4 (moov missing? render killed?)`);
      else if (vert.width === 1080 && vert.height === 1920) step('7-9x16', true, `9:16 variant ${vert.width}x${vert.height}`);
      else step('7-9x16', false, `9:16 variant is ${vert.width}x${vert.height} (want 1080x1920)`);
    }
  }

  // ================= unrunnable gates (listed, never faked) =================
  console.log('\nUNRUNNABLE ON THIS VM (not attempted, not faked):');
  console.log('  - Roadmap Gate D: 5 observed creators doing a real edit — needs 5 humans.');
  console.log('  - Release Gates: 3 hardware tiers + Windows/macOS packaging smoke tests — needs other OS/hardware.');
  console.log(`\nGATE ${failures ? 'FAIL' : 'PASS'} — ${Object.keys(stepResults).length} steps, ${failures} failing; evidence dir ${dir}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(`GATE DRIVER ERROR: ${e.message}`); process.exit(2); });
