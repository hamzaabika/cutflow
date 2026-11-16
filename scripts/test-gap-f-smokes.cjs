// Stream F (§7) smoke runner — drives the real app in FVE_SMOKE modes that
// the §7 items need, and asserts their result.json:
//   grade     — Adjust Basic + HSL (red/orange desat) + Curves + LUT, preview
//               player colour + a full export (B-H-mask live evidence).
//   screenrec — screen + window recording with the camera bubble (B-H-rec
//               combined-flow live evidence).
//   fx        — GPU vs CPU self-test + VHS/comic/snow/striped preview +
//               a full export through the effects pass (A-F10 live evidence).
// Usage: node scripts/test-gap-f-smokes.cjs [grade|screenrec|fx]  (default: all three)
// Run AFTER `npm run build`. Fixtures are generated here; workdirs land in
// ~/workspace/.tmp-gap-f-smokes/ (on disk, never /tmp).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { ffmpegPath, probe } = require('../electron/ffmpeg.cjs');

const root = path.join(__dirname, '..');
const WORK = path.join(os.homedir(), 'workspace', '.tmp-gap-f-smokes');
fs.mkdirSync(WORK, { recursive: true });
const modes = process.argv[2] ? [process.argv[2]] : ['grade', 'screenrec', 'fx'];
const W = 640, H = 360, FPS = 30;

const assert = (ok, what) => { if (!ok) throw new Error(what); };
// Renamed binary first: sibling streams' `pkill -x electron` cleanups SIGTERM
// every stock-`electron` process (see test-gap-f-live.mjs for the evidence).
const electronBin = process.env.ELECTRON_BIN
  || [path.join(os.homedir(), 'workspace', '.tmp-gap-f-live', 'electron-gapf-dist', 'cutflow-gapf'),
    path.join(root, 'node_modules', 'electron', 'dist', 'electron'),
    path.join(os.homedir(), 'workspace', 'electron-dist', 'electron')].find((p) => fs.existsSync(p));
assert(electronBin, 'electron binary not found (set ELECTRON_BIN)');

async function runMode(mode) {
  const dir = fs.mkdtempSync(path.join(WORK, `fve-${mode}-`));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const clip = path.join(dir, 'clip.mp4');
  gen(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=6`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-shortest', '-pix_fmt', 'yuv420p', clip]);
  const info = await probe(clip);
  const media = [{ id: 'm1', path: clip, name: 'clip.mp4', ...info }];
  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const project = mode === 'fx'
    ? {
      name: 'gapf-fx', ratio: '16:9', resolution: 360, width: W, height: H, fps: FPS, background: '#000000', media,
      videoClips: [
        { ...base, id: 'c1', mediaId: 'm1', in: 0, out: 1 },
        { ...base, id: 'c2', mediaId: 'm1', in: 1, out: 3.5 },
        { ...base, id: 'c3', mediaId: 'm1', in: 3.5, out: 6 },
      ],
      overlayClips: [{ ...base, id: 'o1', mediaId: 'm1', start: 0, in: 0, out: 6 }],
      textClips: [], audioClips: [], stickerClips: [], effectClips: [],
    }
    : {
      name: 'gapf-smoke', ratio: '16:9', resolution: 360, width: W, height: H, fps: FPS, background: '#000000', media,
      videoClips: [{ ...base, id: 'c1', mediaId: 'm1', in: 0, out: 6 }],
      overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
    };
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project, null, 2));
  const child = spawn(electronBin, ['--no-sandbox', '.'], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, DISPLAY: ':99', FVE_SMOKE: dir, FVE_SMOKE_MODE: mode, TMPDIR: path.join(WORK, 'tmp') },
  });
  fs.mkdirSync(path.join(WORK, 'tmp'), { recursive: true });
  const code = await new Promise((resolve) => {
    // 15 min: the fx mode exports through the effects pass under swiftshader,
    // which is slow on the shared VM; 420 s killed a healthy grade run whose
    // export wait was the only slow part.
    const kill = setTimeout(() => { child.kill('SIGKILL'); resolve(-1); }, 900000);
    child.on('exit', (c) => { clearTimeout(kill); resolve(c); });
  });
  assert(code === 0, `${mode}: app exited with ${code}`);
  const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  console.log(`--- ${mode} result (${dir}) ---`);
  console.log(JSON.stringify(result, null, 2).slice(0, 3000));
  if (mode === 'grade') {
    assert(!result.error, `grade smoke error: ${result.error}`);
    assert(result.hsl && result.hsl.red && result.hsl.red.s === -100 && result.hsl.orange && result.hsl.orange.s === -100,
      `HSL red/orange saturation -100 recorded (got ${JSON.stringify(result.hsl)})`);
    assert(result.before && result.afterHslCurves, 'player colours recorded before/after HSL+curves');
    const moved = JSON.stringify(result.before) !== JSON.stringify(result.afterHslCurves);
    assert(moved, `player picture changed after HSL+curves (before ${JSON.stringify(result.before)} after ${JSON.stringify(result.afterHslCurves)})`);
    assert(result.exportDone, `grade export finished (got ${result.exportResult})`);
    assert(result.export && result.source, 'export vs source frame means recorded');
    const expMoved = JSON.stringify(result.export) !== JSON.stringify(result.source);
    assert(expMoved, `export frame differs from source (grade in export: ${JSON.stringify(result.export)} vs ${JSON.stringify(result.source)})`);
    console.log('GRADE SMOKE OK — HSL wiring live: panel -> clip.grade.hsl -> preview pixels -> export pixels');
  }
  if (mode === 'screenrec') {
    assert(!result.error, `screenrec smoke error: ${result.error}`);
    for (const kind of ['screen', 'window']) {
      const r = result[kind];
      assert(r, `${kind} recording result present`);
      // On a bare Xvfb there are no window sources: the window flow reports
      // skipped (verified by a live probe: screenSources() returns only
      // "Entire screen"). That is an environment limit, not a product fail.
      if (r.skipped) { console.log(`screenrec: window flow skipped — ${r.skipped}`); continue; }
      assert(r.recording, `${kind}: recording started (.rec-live)`);
      assert(r.saved, `${kind}: recording saved to media + dialog closed`);
      assert(r.added && r.added.length >= 1, `${kind}: media added (${JSON.stringify(r.added)})`);
    }
    const s = result.screen;
    assert(s.overlay && s.overlay.mask, `screen: camera overlay clip with mask (${JSON.stringify(s.overlay)})`);
    assert(s.bubbleCenter && s.bubbleCenter[1] > 100, `screen: fake-camera bubble shows green camera picture (center ${JSON.stringify(s.bubbleCenter)})`);
    // By design the bubble IS in the screen video (screenrec.cjs + rec.camNoteScreen:
    // "It is recorded with the screen"); the camera clip is placed over it at
    // the same spot, so the two agree. A window recording cannot see it.
    assert(s.bubbleInVideo === true, 'screen: bubble is in the screen video, as designed');
    assert(!s.exportError, `screen: export with camera bubble ok (err: ${s.exportError || 'none'})`);
    console.log('SCREENREC SMOKE OK — combined screen+camera flow live: bubble, overlay clip, export');
  }
  if (mode === 'fx') {
    assert(!result.error, `fx smoke error: ${result.error}`);
    assert(!result.selfTestFailed || result.selfTestFailed.length === 0,
      `GPU vs CPU self-test clean (failed: ${JSON.stringify(result.selfTestFailed)}, worst: ${JSON.stringify(result.selfTestWorst)})`);
    assert(result.vhsCanvas === true, 'VHS effect shows its keyed canvas in preview');
    assert(result.transitionCanvas === true, 'comic transition shows its canvas in preview');
    assert(result.exportDone, 'fx export finished');
    assert(result.exportInfo && result.exportInfo.hasVideo, `fx export is a video (${JSON.stringify(result.exportInfo)})`);
    console.log('FX SMOKE OK — GPU vs CPU self-test clean, preview canvases live, export through the effects pass');
  }
  return dir;
}

(async () => {
  for (const mode of modes) await runMode(mode);
  console.log('GAP-F SMOKES OK');
})().catch((e) => { console.error('GAP-F SMOKES FAIL:', e.message); process.exit(1); });
