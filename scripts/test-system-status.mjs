// FB-30 (P1-45) — system status: progress normalisation + the wiring that
// makes every async job visible (snapshot IPC, model retry IPC, captions
// job flag, preload exposure, tray System section). The live rendering is
// covered by scripts/test-f5-system-live.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeProgress } from '../src/systemStatus.js';

let n = 0;
const check = (name, fn) => { fn(); n += 1; console.log(`ok ${n} - ${name}`); };

// --- progress normalisation (the differently-shaped payloads) ---
check('audiofx fraction passes through', () => {
  assert.deepEqual(normalizeProgress('audioFx', { path: '/x.wav', fraction: 0.5 }), { stage: 'audioFx', fraction: 0.5, });
});
check('captions stage/progress maps', () => {
  assert.deepEqual(normalizeProgress('captions', { stage: 'Transcribing', progress: 0.25 }), { stage: 'Transcribing', fraction: 0.25 });
});
check('translate done/total becomes a fraction', () => {
  assert.deepEqual(normalizeProgress('translate', { done: 3, total: 4 }), { stage: 'translate', fraction: 0.75 });
});
check('translate with total 0 is 0, not NaN', () => {
  assert.deepEqual(normalizeProgress('translate', { done: 0, total: 0 }), { stage: 'translate', fraction: 0 });
});
check('esrgan phase becomes the stage', () => {
  assert.deepEqual(normalizeProgress('esrgan', { phase: 'upscale', fraction: 0.1 }), { stage: 'upscale', fraction: 0.1 });
});
check('matting keeps its stage', () => {
  assert.deepEqual(normalizeProgress('matting', { path: '/v.mp4', stage: 'matte', fraction: 1 }), { stage: 'matte', fraction: 1 });
});
check('null payload is null', () => {
  assert.equal(normalizeProgress('audioFx', null), null);
});
check('fraction clamps on translate only where defined', () => {
  assert.equal(normalizeProgress('translate', { done: 9, total: 4 }).fraction, 1);
});

// --- wiring: the main process must expose the snapshot + retry + flags ---
const main = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const preload = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
const tray = fs.readFileSync(new URL('../src/components/ExportJobsTray.jsx', import.meta.url), 'utf8');
const hook = fs.readFileSync(new URL('../src/systemStatus.js', import.meta.url), 'utf8');
check('system:status IPC exists', () => assert.ok(main.includes("ipcMain.handle('system:status'")));
check('models:install IPC exists with an allowlist', () => {
  assert.ok(main.includes("ipcMain.handle('models:install'"));
  assert.ok(main.includes("'whisper-base'"));
  assert.ok(main.includes("Unknown model:"));
});
check('captions:run sets and clears a job flag', () => {
  assert.ok(main.includes('captionsJob = { model:'));
  assert.ok(main.includes('captionsJob = null;'));
});
check('tts:speak sets a job flag', () => assert.ok(main.includes('ttsJob = { engine:')));
check('preload exposes systemStatus + modelsInstall', () => {
  assert.ok(preload.includes("systemStatus: () => ipcRenderer.invoke('system:status')"));
  assert.ok(preload.includes("modelsInstall: (id) => ipcRenderer.invoke('models:install', id)"));
});
check('tray renders the System section with cancel + retry', () => {
  assert.ok(tray.includes('SystemSection'));
  assert.ok(tray.includes('onRetryModel'));
  assert.ok(tray.includes("t('sys.section')"));
});
check('hook subscribes to the previously unsubscribed audiofx channel', () => {
  assert.ok(hook.includes('onAudioFxProgress'));
  assert.ok(hook.includes('onCaptionsProgress'));
  assert.ok(hook.includes('onTranslateProgress'));
  assert.ok(hook.includes('onEnhanceProgress'));
  assert.ok(hook.includes('onMattingProgress'));
  assert.ok(hook.includes('onReframeProgress'));
  assert.ok(hook.includes('onEsrganProgress'));
});
check('hook maps cancel to the existing cancel IPCs', () => {
  assert.ok(hook.includes('audioFxCancel'));
  assert.ok(hook.includes('mattingCancel'));
  assert.ok(hook.includes('translateCancel'));
});

console.log(`SYSTEM STATUS OK (${n} checks)`);
