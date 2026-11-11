// Screen recorder: microphone memory, mic-off warning, silent-recording
// notice, and the Wayland capture fix.
//   1) The post-recording sound check (electron/recsound.cjs): the
//      volumedetect log parser on synthetic logs, then the real FFmpeg
//      pass over generated tone / silent / quiet / no-audio fixtures.
//   2) The timeout wrapper + the screenrec IPC handlers, driven through
//      an Electron stub: listings pass through, Wayland listings skip
//      thumbnails/icons (the capture-opening work that hangs there), a
//      HANGING source list settles as a timeout error instead of
//      spinning forever, and a hanging display-media lookup denies the
//      request (so the renderer's getDisplayMedia fails visibly).
//   3) Recorder preferences through the real settings store
//      (electron/settings.cjs against a temp dir): defaults, round-trip,
//      restart re-read, sanitisation, public surface.
//   4) Wiring: settings IPC, preload, dialog restore + save, the mic-off
//      warning flow, the notice surface, the finish-time sound flag, the
//      per-platform saved-path text, and the i18n keys in all three
//      catalogues.
//   5) The real app (CDP, fresh profile): seeded recorder prefs restore
//      the mic ON in the dialog; starting with the mic off shows the
//      warning and does NOT start; "Turn microphone on" clears it;
//      "Record without microphone" lets the start through; the toggles
//      persist back to settings.json. The warning state is screenshotted
//      to ~/workspace/cutflow-shots/structureround/15-recorder-mic-warning.png.
// Usage: node scripts/test-recorder-mic.mjs   (section 5 needs a build: dist/)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repo = path.join(path.dirname(new URL(import.meta.url).pathname), '..');

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 1. Sound check
{
  const rs = require('../electron/recsound.cjs');
  ok(rs.SILENT_PEAK_DB === -50, `sound: the silence threshold is -50 dB (got ${rs.SILENT_PEAK_DB})`);
  const loud = rs.parseVolumeLog('[Parsed_volumedetect_0 @ 0x1] mean_volume: -27.3 dB\n[Parsed_volumedetect_0 @ 0x1] max_volume: -6.0 dB');
  ok(loud.hasAudio === true && loud.peakDb === -6.0, 'sound parser: a max_volume line gives the peak');
  const dig = rs.parseVolumeLog('[Parsed_volumedetect_0 @ 0x1] max_volume: -inf dB');
  ok(dig.hasAudio === true && dig.peakDb === -Infinity, 'sound parser: -inf is digital silence');
  const none = rs.parseVolumeLog('Input #0, mov,mp4, from x:\n  Stream #0:0: Video: h264');
  ok(none.hasAudio === false && none.peakDb === null, 'sound parser: no max_volume line means no audio stream');
  ok(rs.parseVolumeLog('').hasAudio === false, 'sound parser: an empty log has no audio');

  const { ffmpegPath } = require('../electron/ffmpeg.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-recsound-'));
  const gen = (name, args) => {
    const f = path.join(dir, name);
    const r = spawnSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args, f], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`${name}: ${r.stderr}`);
    return f;
  };
  const VID = ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=10'];
  const tone = gen('tone.mp4', [...VID, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-af', 'volume=0.5', '-c:v', 'libx264', '-c:a', 'aac', '-shortest']);
  const silent = gen('silent.mp4', [...VID, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-c:v', 'libx264', '-c:a', 'aac', '-shortest']);
  const quiet = gen('quiet.mp4', [...VID, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-af', 'volume=0.0001', '-c:v', 'libx264', '-c:a', 'aac', '-shortest']);
  const noaudio = gen('noaudio.mp4', [...VID, '-c:v', 'libx264']);
  const t = await rs.checkRecordingSound(tone);
  ok(t.hasAudio === true && t.silent === false && t.peakDb > -50, `sound: a tone recording passes (peak ${t.peakDb} dB)`);
  const s = await rs.checkRecordingSound(silent);
  ok(s.hasAudio === true && s.silent === true, `sound: a digital-silence recording is flagged (peak ${s.peakDb} dB)`);
  const q = await rs.checkRecordingSound(quiet);
  ok(q.silent === true, `sound: a near-silent recording is flagged (peak ${q.peakDb} dB)`);
  const n = await rs.checkRecordingSound(noaudio);
  ok(n.hasAudio === false && n.silent === true, 'sound: a recording with no audio stream is flagged');
  const strict = await rs.checkRecordingSound(tone, { thresholdDb: -10 });
  ok(strict.silent === (strict.peakDb <= -10), 'sound: a caller threshold is honoured, not ignored');
  const missing = await rs.checkRecordingSound(path.join(dir, 'gone.mp4'));
  ok(missing.silent === false && !!missing.error, 'sound: an unanalysable file is NOT branded silent');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ------------------------------------------------------- Electron stub for 2 + 3
const smoke = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-recmic-'));
process.env.FVE_SMOKE = smoke;
let dcImpl = async () => [];
const ipcHandlers = new Map();
let dmHandler = null;
{
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: {
      app: { getPath: () => smoke },
      safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
      BrowserWindow: class {},
      desktopCapturer: { getSources: (opts) => dcImpl(opts) },
      ipcMain: { handle: (ch, fn) => ipcHandlers.set(ch, fn), on: () => {} },
      screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }), getDisplayMatching: () => null },
      session: { defaultSession: { setDisplayMediaRequestHandler: (fn) => { dmHandler = fn; } } },
    },
  };
}

// ------------------------------------------- 2. Timeout + screenrec handler logic
{
  const screenrec = require('../electron/screenrec.cjs');
  ok(typeof screenrec.withTimeout === 'function', 'timeout: screenrec exports the withTimeout wrapper');
  ok(screenrec.SOURCES_TIMEOUT_MS === 8000, `timeout: the source-listing budget is 8s (got ${screenrec.SOURCES_TIMEOUT_MS})`);
  ok(await screenrec.withTimeout(Promise.resolve(42), 1000) === 42, 'timeout: a fast promise resolves through');
  const slow = await screenrec.withTimeout(new Promise(() => {}), 60).then(() => 'resolved', (e) => e.message);
  ok(/Timed out/.test(slow), `timeout: a hanging promise rejects as a timeout (got "${slow}")`);

  screenrec.install({ app: { getPath: () => smoke }, getWin: () => null, ffmpegPath: 'ffmpeg', probeAll: async () => [] });
  ok(typeof ipcHandlers.get('screen:sources') === 'function', 'sources: the screen:sources handler is installed');
  ok(typeof dmHandler === 'function', 'wayland: the display-media request handler is registered');

  const src = (id, name) => ({ id, name, thumbnail: { isEmpty: () => true, toDataURL: () => '' }, appIcon: null });
  let seenOpts = null;
  dcImpl = async (opts) => { seenOpts = opts; return [src('screen:1:0', 'Screen 1'), src('window:2:0', 'Window A')]; };
  const list = await ipcHandlers.get('screen:sources')();
  ok(Array.isArray(list) && list.length === 2 && list[0].kind === 'screen' && list[1].kind === 'window', 'sources: screens and windows pass through with kinds');
  ok(seenOpts && seenOpts.thumbnailSize && seenOpts.thumbnailSize.width === 320, 'sources: X11/Windows listings still fetch thumbnails');

  process.env.XDG_SESSION_TYPE = 'wayland';
  seenOpts = null;
  await ipcHandlers.get('screen:sources')();
  ok(seenOpts && seenOpts.thumbnailSize.width === 0 && seenOpts.fetchWindowIcons === false,
    'wayland: listings skip thumbnails and icons (the capture work that hangs under the portal)');
  delete process.env.XDG_SESSION_TYPE;

  dcImpl = () => new Promise(() => {});
  const t0 = Date.now();
  const hang = await ipcHandlers.get('screen:sources')().then(() => 'resolved', (e) => e.message);
  const elapsed = Date.now() - t0;
  ok(/Timed out/.test(hang) && elapsed >= 7500 && elapsed < 15000, `wayland: a hanging source list settles as a timeout error, never a spinner (${elapsed}ms: "${hang}")`);

  // Display-media: a hanging lookup inside the request handler must deny
  // (the renderer's getDisplayMedia then fails visibly) — never hang.
  await ipcHandlers.get('screen:choose')(null, 'screen:1:0', false);
  const t1 = Date.now();
  const cbResult = await new Promise((resolve) => dmHandler({}, resolve));
  const elapsed2 = Date.now() - t1;
  ok(eq(cbResult, {}) && elapsed2 < 15000, `wayland: a hanging display-media lookup denies the request (${elapsed2}ms)`);

  dcImpl = async () => [src('screen:1:0', 'Screen 1')];
  await ipcHandlers.get('screen:choose')(null, 'screen:1:0', false);
  const cbOk = await new Promise((resolve) => dmHandler({}, resolve));
  ok(cbOk && cbOk.video && cbOk.video.id === 'screen:1:0' && !('audio' in cbOk), 'display-media: the chosen screen resolves through the handler');
  await ipcHandlers.get('screen:choose')(null, 'screen:1:0', true);
  const cbAudio = await new Promise((resolve) => dmHandler({}, resolve));
  ok(cbAudio && cbAudio.audio === 'loopback' && cbAudio.video.id === 'screen:1:0', 'display-media: system sound rides as loopback when asked');
}

// ------------------------------------------------------ 3. Settings round-trip
{
  const settingsPath = require.resolve('../electron/settings.cjs');
  delete require.cache[settingsPath];
  const settings = require(settingsPath);
  ok(eq(settings.getRecorderPrefs(), { mic: false, micId: '' }), 'prefs: a fresh install defaults to mic off, default device');
  settings.setRecorderPrefs({ mic: true, micId: 'dev-123' });
  ok(eq(settings.getRecorderPrefs(), { mic: true, micId: 'dev-123' }), 'prefs: setRecorderPrefs persists the mic choice');
  ok(eq(settings.getPublic().recorder, { mic: true, micId: 'dev-123' }), 'prefs: the choice is on the public settings surface');
  settings.setRecorderPrefs({ micId: 'dev-999' });
  ok(eq(settings.getRecorderPrefs(), { mic: true, micId: 'dev-999' }), 'prefs: a partial patch merges (mic stays on)');
  settings.setRecorderPrefs({ mic: 'yes', micId: 42 });
  ok(eq(settings.getRecorderPrefs(), { mic: true, micId: 'dev-999' }), 'prefs: malformed values are refused, the saved choice stands');
  delete require.cache[settingsPath];
  const again = require(settingsPath);
  ok(eq(again.getRecorderPrefs(), { mic: true, micId: 'dev-999' }), 'prefs: the mic choice survives a restart (read back from settings.json)');
  const onDisk = JSON.parse(fs.readFileSync(path.join(smoke, 'settings-test', 'settings.json'), 'utf8'));
  ok(onDisk.recorder && onDisk.recorder.mic === true && onDisk.recorder.micId === 'dev-999', 'prefs: settings.json on disk carries the recorder section');
}

// ------------------------------------------------------------------ 4. Wiring
{
  const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');
  const settings = read('electron/settings.cjs');
  const main = read('electron/main.cjs');
  const preload = read('electron/preload.cjs');
  const screenrec = read('electron/screenrec.cjs');
  const hook = read('src/useScreenRecorder.js');
  const dialog = await import('node:fs').then(() => read('src/components/ScreenRecordDialog.jsx'));
  const app = read('src/App.jsx');
  ok(settings.includes('getRecorderPrefs') && settings.includes('setRecorderPrefs'), 'wiring: settings.cjs carries the recorder prefs');
  ok(main.includes("'settings:setRecorderPrefs'"), 'wiring: main exposes the settings:setRecorderPrefs IPC');
  ok(preload.includes('settingsSetRecorderPrefs'), 'wiring: preload bridges settingsSetRecorderPrefs');
  ok(preload.includes('expectAudio'), 'wiring: preload passes the sound expectation to screen:begin');
  ok(screenrec.includes("require('./recsound.cjs')") && screenrec.includes('soundMissing'), 'wiring: screen:finish runs the sound check and flags silent recordings');
  ok(screenrec.includes('withTimeout') && screenrec.includes('getSources'), 'wiring: source listing and the display-media lookup are timeout-wrapped');
  ok(hook.includes('expectAudio') && hook.includes('soundMissing') && hook.includes('dismissNotice'), 'wiring: the recorder hook forwards the expectation and surfaces the notice');
  ok(dialog.includes('settingsGet') && dialog.includes('settingsSetRecorderPrefs'), 'wiring: the dialog restores and persists the mic choice');
  ok(dialog.includes('micWarn') && dialog.includes('role="alert"'), 'wiring: the dialog has the mic-off warning state');
  ok(dialog.includes('loadError') || dialog.includes('sourcesError'), 'wiring: the dialog has a source-listing error state');
  ok(!dialog.includes('Videos\\Cutflow'), 'wiring: no Windows-style saved path is hardcoded in the dialog');
  ok(app.includes('screenRec.notice'), 'wiring: App keeps the dialog mounted while a notice is pending');

  const en = (await import('../src/i18n/en.js')).default;
  const fr = (await import('../src/i18n/fr.js')).default;
  const ar = (await import('../src/i18n/ar.js')).default;
  const KEYS = ['recorder.micOffTitle', 'recorder.micOffBody', 'recorder.turnMicOn', 'recorder.recordAnyway',
    'recorder.noSoundTitle', 'recorder.noSoundBody', 'recorder.sourcesErrorTitle', 'recorder.sourcesErrorBody', 'recorder.retry'];
  for (const k of KEYS) {
    ok(typeof en[k] === 'string' && en[k] && typeof fr[k] === 'string' && fr[k] && typeof ar[k] === 'string' && ar[k],
      `i18n: "${k}" exists in en, fr and ar`);
  }
}
fs.rmSync(smoke, { recursive: true, force: true });

// ------------------------------------------------------------- 5. The real app
{
  const distIndex = path.join(repo, 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) {
    console.log('SKIP  app: dist/ not built — section 5 skipped (build first, then re-run)');
  } else {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-recmic-app-'));
    // Seed + read back through the app's REAL settings file under the temp
    // HOME — deliberately NOT the FVE_SMOKE seam used in section 3: an
    // FVE_SMOKE boot runs main.cjs's built-in smoke driver, which quits the
    // app a few seconds in, long before this drive finishes. With a plain
    // temp HOME the app keeps its normal userData (.config/ClipCraft) and
    // stays up for the whole drive.
    const settingsFile = path.join(profile, '.config', 'ClipCraft', 'settings.json');
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify({ recorder: { mic: true, micId: '' } }));
    const port = 9227;
    const electron = path.join(repo, 'node_modules', '.bin', 'electron');
    const appEnv = { ...process.env, HOME: profile, DISPLAY: process.env.DISPLAY || ':99' };
    delete appEnv.FVE_SMOKE;
    delete appEnv.FVE_SMOKE_MODE;
    const child = spawn(electron, ['.', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`], {
      cwd: repo, detached: true,
      env: appEnv,
      stdio: 'ignore',
    });
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } };
    try {
      let page = null;
      for (let i = 0; i < 60 && !page; i++) {
        await sleep(500);
        try {
          const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
          page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        } catch { /* not up yet */ }
      }
      ok(!!page, 'app: the app launched with a debug page');
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        let mid = 0;
        const pending = new Map();
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
        };
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        const call = (method, params = {}) => new Promise((res, rej) => { const id = ++mid; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
        await call('Page.enable');
        await call('Runtime.enable');
        const ev = async (expr) => {
          const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate failed');
          return r.result.value;
        };
        const waitFor = async (expr, ms, label) => {
          const t0 = Date.now();
          while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(400); }
          throw new Error(`timed out waiting for ${label}`);
        };
        await waitFor('!!window.__fve', 30000, 'the app harness');
        await sleep(1500);
        // A first-run welcome may cover the home screen; dismiss it if present.
        await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /start creating/i.test(x.textContent || '')); if (b) { b.click(); return true; } return false; })()`);
        await sleep(800);
        const opened = await ev(`(() => { const b = [...document.querySelectorAll('button.home-action')].find((x) => /record/i.test(x.textContent || '')); if (b) { b.click(); return true; } return false; })()`);
        ok(opened, 'app: the Home "Record screen" quick tool opened the recorder');
        await waitFor(`!!document.querySelector('.rec-pick')`, 15000, 'the record dialog');
        await waitFor(`!!document.querySelector('.rec-source')`, 15000, 'the source list');
        const micChecked = () => ev(`(() => { const d = document.querySelectorAll('.rec-device')[0]; const c = d && d.querySelector('input[type="checkbox"]'); return !!c && c.checked; })()`);
        ok(await micChecked() === true, 'app: the mic comes back ON from the saved prefs (remembered)');
        // Turn it off, then try to start: the warning must block the start.
        await ev(`(() => { const d = document.querySelectorAll('.rec-device')[0]; d.querySelector('input[type="checkbox"]').click(); return true; })()`);
        await sleep(300);
        ok(await micChecked() === false, 'app: the mic toggles off');
        await ev(`(() => { document.querySelector('.rec-pick .btn-primary').click(); return true; })()`);
        await sleep(600);
        const warned = await ev(`(() => { const w = document.querySelector('.rec-micwarn'); return !!w && !!document.querySelector('.rec-pick') && !document.querySelector('.rec-count'); })()`);
        ok(warned, 'app: starting with the mic off shows the warning and does NOT start');
        await call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
        await sleep(700);
        const shotDir = path.join(os.homedir(), 'workspace', 'cutflow-shots', 'structureround');
        fs.mkdirSync(shotDir, { recursive: true });
        const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
        fs.writeFileSync(path.join(shotDir, '15-recorder-mic-warning.png'), Buffer.from(shot.data, 'base64'));
        // Turn the mic on from the warning: warning clears, mic is on.
        const turnedOn = await ev(`(() => { const b = document.querySelector('.rec-micwarn .rec-micwarn-on'); if (b) { b.click(); return true; } return false; })()`);
        await sleep(400);
        ok(turnedOn && (await micChecked()) === true && (await ev(`!document.querySelector('.rec-micwarn')`)) === true,
          'app: "Turn microphone on" clears the warning and switches the mic on');
        // Off again, start, then explicitly record anyway: the start goes through.
        await ev(`(() => { const d = document.querySelectorAll('.rec-device')[0]; d.querySelector('input[type="checkbox"]').click(); return true; })()`);
        await sleep(300);
        await ev(`(() => { document.querySelector('.rec-pick .btn-primary').click(); return true; })()`);
        await sleep(600);
        const anyway = await ev(`(() => { const b = document.querySelector('.rec-micwarn .rec-micwarn-anyway'); if (b) { b.click(); return true; } return false; })()`);
        ok(anyway, 'app: the warning offers "Record without microphone"');
        await sleep(1500);
        const wentThrough = await ev(`(() => !document.querySelector('.rec-micwarn') && (!!document.querySelector('.rec-count') || !!document.querySelector('.rec-live') || !!document.querySelector('.rec-pick .error-text') || !document.querySelector('.rec-pick')))()`);
        ok(wentThrough, 'app: recording anyway leaves the warning (countdown, recording, or a surfaced error)');
        // If a recording really started in this Xvfb, stop it and let it save.
        const wasRecording = await ev(`!!document.querySelector('.rec-live')`);
        if (wasRecording) {
          await ev(`(() => { const b = [...document.querySelectorAll('.modal button')].find((x) => /stop/i.test(x.textContent || '')); if (b) b.click(); return true; })()`);
          await sleep(4000);
        }
        await sleep(500);
        const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        ok(saved.recorder && saved.recorder.mic === false, 'app: the mic-off choice persisted back to settings.json');
        ws.close();
      }
    } catch (e) {
      ok(false, `app: ${e.message}`);
    } finally {
      kill();
      await sleep(500);
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }
}

console.log(fails.length ? `\nRECORDER-MIC FAIL — ${fails.length} assertion(s)` : '\nRECORDER-MIC OK — sound check, handler timeouts, prefs round-trip, wiring, app drive');
process.exit(fails.length ? 1 : 0);
