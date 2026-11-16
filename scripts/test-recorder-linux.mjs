// Screen recorder Linux gaps (P1-29): the Stop bar cannot be hidden from a
// capture on Linux (setContentProtection is Windows/macOS-only), so it must
// not be shown for screen recordings; loopback audio is Chromium's
// 'loopback' device on Linux too (PipeWire/PulseAudio monitor), so the
// dialog documents it instead of disabling it.
//   1) The pure rule barVisibleOn(platform, sourceId): Linux + screen -> no
//      bar; Linux + window -> bar; Windows/macOS + screen -> bar; unknown
//      source kind -> bar (the old behaviour).
//   2) The screen:bar IPC handler, driven through an Electron stub: on this
//      Linux machine a screen source returns { shown: false,
//      reason: 'linux-screen' } and constructs NO BrowserWindow, while a
//      window source constructs one and returns { shown: true }.
//   3) Wiring: preload exposes screenBar; the hook notifies when the bar is
//      skipped; the dialog renders the Linux audio + bar notes and the Linux
//      footnote variant; the new i18n keys exist in all three catalogues
//      (parity is also pinned by test-i18n).
// Usage: node scripts/test-recorder-linux.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repo = path.join(path.dirname(new URL(import.meta.url).pathname), '..');

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- Electron stub
// NOTE: the stub must be installed BEFORE screenrec is required anywhere —
// the module reads `electron` at load time, and a later stub cannot replace
// an already-cached real require.
const smoke = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-reclinux-'));
const ipcHandlers = new Map();
let createdWindows = 0;
{
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: {
      BrowserWindow: class {
        constructor() { createdWindows++; this._closed = false; }
        setShape() {}
        setContentProtection() {}
        setAlwaysOnTop() {}
        loadFile() { return Promise.resolve(); }
        once(_e, fn) { if (_e === 'ready-to-show') setTimeout(fn, 0); }
        on() {}
        showInactive() {}
        isDestroyed() { return this._closed; }
        close() { this._closed = true; }
        getBounds() { return { x: 0, y: 0, width: 254, height: 38 }; }
        webContents = { send() {} };
      },
      desktopCapturer: { getSources: async () => [] },
      ipcMain: { handle: (ch, fn) => ipcHandlers.set(ch, fn), on: () => {} },
      screen: { getAllDisplays: () => [{ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }], getPrimaryDisplay: () => ({ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }), getDisplayMatching: () => null },
      session: { defaultSession: { setDisplayMediaRequestHandler: () => {} } },
    },
  };
}

// ---------------------------------------------------------------- 1. The rule
{
  const screenrec = require('../electron/screenrec.cjs');
  ok(typeof screenrec.barVisibleOn === 'function', 'rule: screenrec exports barVisibleOn');
  const f = screenrec.barVisibleOn;
  ok(f('linux', 'screen:1:0') === false, 'rule: Linux + screen source -> no bar (it would be burned into the video)');
  ok(f('linux', 'screen:396:0') === false, 'rule: Linux + screen source (real id shape) -> no bar');
  ok(f('linux', 'window:2:0') === true, 'rule: Linux + window source -> bar (a window capture never sees it)');
  ok(f('win32', 'screen:1:0') === true, 'rule: Windows + screen -> bar (setContentProtection hides it)');
  ok(f('darwin', 'screen:1:0') === true, 'rule: macOS + screen -> bar');
  ok(f('linux', undefined) === true, 'rule: Linux + unknown source -> bar (conservative: the old behaviour)');
  ok(f('linux', '') === true, 'rule: Linux + empty source id -> bar');
  ok(f('linux', 'screen:') === false, 'rule: Linux + bare screen: prefix -> no bar');
}

// ------------------------------------------------- 2. The handler (Electron stub)
{
  const screenrec = require('../electron/screenrec.cjs');
  screenrec.install({ app: { getPath: () => smoke }, getWin: () => null, ffmpegPath: 'ffmpeg', probeAll: async () => [] });
  const bar = ipcHandlers.get('screen:bar');
  ok(typeof bar === 'function', 'handler: the screen:bar handler is installed');
  ok(process.platform === 'linux', `handler: running on Linux (got ${process.platform}) — the skip path is the live one here`);
  createdWindows = 0;
  const skipped = await bar(null, true, 'screen:1:0');
  ok(skipped && skipped.shown === false && skipped.reason === 'linux-screen',
    `handler: Linux screen source -> { shown: false, reason: 'linux-screen' } (got ${JSON.stringify(skipped)})`);
  ok(createdWindows === 0, `handler: no bar window is constructed for a Linux screen recording (got ${createdWindows})`);
  await sleep(50);
  const shown = await bar(null, true, 'window:2:0');
  ok(shown && shown.shown === true, `handler: Linux window source -> { shown: true } (got ${JSON.stringify(shown)})`);
  ok(createdWindows === 1, `handler: a bar window IS constructed for a window recording (got ${createdWindows})`);
  const hidden = await bar(null, false);
  ok(hidden && hidden.shown === false, 'handler: hiding the bar reports { shown: false }');
}

// ---------------------------------------------------------------- 3. Wiring
{
  const preload = fs.readFileSync(path.join(repo, 'electron/preload.cjs'), 'utf8');
  ok(/screenBar: \(show, sourceId\) => ipcRenderer\.invoke\('screen:bar', show, sourceId\)/.test(preload),
    'wiring: preload exposes screenBar and returns the handler result');
  const hook = fs.readFileSync(path.join(repo, 'src/useScreenRecorder.js'), 'utf8');
  ok(/res\.shown === false/.test(hook) && /new Notification\(t\('rec\.linuxBarHiddenTitle'\)/.test(hook),
    'wiring: the hook notifies (translated) when the bar is skipped');
  ok(/loopback/.test(hook) && /PulseAudio\/PipeWire/.test(hook),
    'wiring: the hook documents the Linux loopback mechanism instead of assuming Windows-only');
  const dialog = fs.readFileSync(path.join(repo, 'src/components/ScreenRecordDialog.jsx'), 'utf8');
  ok(/const isLinux = \(navigator\.platform/.test(dialog), 'wiring: the dialog detects Linux from navigator.platform');
  ok(/t\('rec\.linuxAudioNote'\)/.test(dialog), 'wiring: the dialog renders the Linux audio note');
  ok(/kind === 'screen' && <p className="muted small">{t\('rec\.linuxBarNote'\)}<\/p>/.test(dialog),
    'wiring: the dialog renders the Linux bar note for screen sources only');
  ok(/t\(isLinux && kind === 'screen' \? 'rec\.footNoteLinux' : 'rec\.footNote'/.test(dialog),
    'wiring: the dialog swaps in the Linux footnote for screen recordings (the old footnote promises a bar)');
  for (const lang of ['en', 'fr', 'ar']) {
    const cat = fs.readFileSync(path.join(repo, `src/i18n/${lang}.js`), 'utf8');
    for (const key of ['rec.linuxAudioNote', 'rec.linuxBarNote', 'rec.linuxBarHiddenTitle', 'rec.linuxBarHiddenBody', 'rec.footNoteLinux']) {
      ok(cat.includes(`"${key}"`), `wiring: ${lang} has ${key}`);
    }
  }
}

if (fails.length) { console.log(`\nRECORDER LINUX FAIL (${fails.length})`); process.exit(1); }
console.log('\nRECORDER LINUX OK');
