// F2 live verification (FB-05, FB-06, FB-07, FB-08, FB-09, FB-13): boots the
// real app headless (Xvfb), drives each feature's UI through CDP, and measures
// the audio that comes out of real exports — levels/FFT, not just UI state.
// One boot, five small projects, four real video exports (ui-export.mp4):
//   A: FB-05 + FB-06 — AudioFx panel: lowpass slider floor + numeric entry,
//      Underwater preset, merge mode keeping manual EQ, undo. Export: the
//      3000 Hz tone is cut while 300 Hz survives.
//   B: FB-07 — Ducking panel on a music clip under a dialogue clip. Export:
//      music level during dialogue is ~0.2x the level outside it.
//   C: FB-08 — VoiceRepair panel on a humming clip. Export: 50 Hz hum falls
//      >= 10 dB relative to the 700 Hz voice.
//   D: FB-09 — fade handles on the waveform: two .vol-fade-handle rects per
//      sounding clip; a real CDP pointer drag writes clip.fadeIn.
//   E: FB-13 — transition panel audio-fade seg. Export: total stays 5 s,
//      midpoint dip < 1.5 dB.
// Run AFTER `npm run build`:  node scripts/test-f2-live.mjs
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9228;
const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length);
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((x) => x.trim().toUpperCase())) : null;
const runSection = (letter) => !ONLY || ONLY.has(letter);
const ff = (await import('../electron/ffmpeg.cjs')).default;
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
    ws.onerror = (e) => reject(new Error('ws error ' + (e.message || '')));
    ws.onclose = () => { for (const { rej } of pending.values()) rej(new Error('ws closed')); pending.clear(); };
    ws.onopen = () => resolve({
      call: (method, params = {}) => new Promise((res, rej) => {
        if (ws.readyState !== 1) return rej(new Error('ws not open'));
        const mid = ++id;
        const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)); }, 180000);
        pending.set(mid, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
        try { ws.send(JSON.stringify({ id: mid, method, params })); }
        catch (e) { clearTimeout(timer); pending.delete(mid); rej(e); }
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

// ---- audio measurement (node side, on exported files) ----
const decode = (file, from, len, sr = 48000) => {
  const raw = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ss', String(from), '-t', String(len), '-ac', '1', '-ar', String(sr), '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 28 });
  const n = raw.length / 4; const o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = raw.readFloatLE(i * 4); return o;
};
const goertzel = (s, freq, sr = 48000) => {
  const n = s.length, k = Math.round((n * freq) / sr), w = (2 * Math.PI * k) / n, cw = Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const x = s[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))); const v = x + 2 * cw * s1 - s2; s2 = s1; s1 = v; }
  return Math.sqrt(s1 * s1 + s2 * s2 - 2 * cw * s1 * s2) / n;
};
const rms = (s) => { let a = 0; for (let i = 0; i < s.length; i++) a += s[i] * s[i]; return Math.sqrt(a / s.length); };
const db = (r) => 20 * Math.log10(Math.max(1e-9, r));
const fileDuration = (file) => parseFloat(execFileSync(ff.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-f2live-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-f2live-home-'));
const outFile = path.join(dir, 'ui-export.mp4');
const gen = (a) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...a]);

// Fixtures: small 320x180 mp4s with sound.
const mkMp4 = (name, audioArgs, dur = 3) => {
  const out = path.join(dir, name);
  gen(['-f', 'lavfi', '-i', `testsrc=size=320x180:rate=30:duration=${dur}`,
    ...audioArgs, '-shortest', '-ar', '48000', '-ac', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
  return out;
};
const toneA = mkMp4('toneA.mp4', ['-f', 'lavfi', '-i', 'sine=frequency=300:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=3000:duration=3',
  '-filter_complex', '[1:a][2:a]amix=inputs=2:normalize=0,volume=0.25[a]', '-map', '0:v', '-map', '[a]']);
const noiseWav = path.join(dir, 'noise.wav');
gen(['-f', 'lavfi', '-i', 'anoisesrc=color=white:duration=6:amplitude=0.5:seed=7', '-ar', '48000', '-ac', '2', noiseWav]);
const voiceWav = path.join(dir, 'voice.wav');
gen(['-f', 'lavfi', '-i', 'sine=frequency=700:duration=2', '-filter_complex', '[0:a]volume=0.4[a]', '-map', '[a]', '-ar', '48000', '-ac', '2', voiceWav]);
const humMp4 = mkMp4('hum.mp4', ['-f', 'lavfi', '-i', 'sine=frequency=300:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=700:duration=3',
  '-f', 'lavfi', '-i', 'sine=frequency=1200:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=50:duration=3',
  '-filter_complex', '[1:a][2:a][3:a][4:a]amix=inputs=4:normalize=0,volume=0.25[a]', '-map', '0:v', '-map', '[a]']);
const tone440 = mkMp4('t440.mp4', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-filter_complex', '[1:a]volume=0.4[a]', '-map', '0:v', '-map', '[a]']);
const tone880 = mkMp4('t880.mp4', ['-f', 'lavfi', '-i', 'sine=frequency=880:duration=3', '-filter_complex', '[1:a]volume=0.4[a]', '-map', '0:v', '-map', '[a]']);
const picMp4 = mkMp4('pic.mp4', ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000:duration=6',
  '-filter_complex', '[1:a]volume=0[a]', '-map', '0:v', '-map', '[a]'], 6);

const probe = async (f) => ff.probe(f);
const mToneA = await probe(toneA);
const mNoise = await probe(noiseWav);
const mVoice = await probe(voiceWav);
const mHum = await probe(humMp4);
const m440 = await probe(tone440);
const m880 = await probe(tone880);
const mPic = await probe(picMp4);

const base = { name: 'f2-live', ratio: '16:9', resolution: 180, width: 320, height: 180, fps: 30, background: '#000000', overlayClips: [], textClips: [], stickerClips: [], effectClips: [] };
const vclip = (id, mediaId, media, extra = {}) => ({ id, mediaId, in: 0, out: 3, volume: 1, fadeIn: 0, fadeOut: 0, speed: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, ...extra });
const projectA = { ...base, media: [{ id: 'm1', path: toneA, name: 'toneA.mp4', ...mToneA }], videoClips: [vclip('v1', 'm1')], audioClips: [] };
const projectB = {
  ...base,
  media: [
    { id: 'mv', path: picMp4, name: 'pic.mp4', ...mPic },
    { id: 'm1', path: noiseWav, name: 'noise.wav', ...mNoise },
    { id: 'm2', path: voiceWav, name: 'voice.wav', ...mVoice },
  ],
  videoClips: [{ ...vclip('v1', 'mv'), out: 6, muted: true }],
  audioClips: [
    { id: 'a1', mediaId: 'm1', start: 0, in: 0, out: 6, volume: 1, fadeIn: 0, fadeOut: 0, role: 'music' },
    { id: 'a2', mediaId: 'm2', start: 0.5, in: 0, out: 2, volume: 1, fadeIn: 0, fadeOut: 0, role: 'dialogue' },
  ],
};
const projectC = { ...base, media: [{ id: 'm1', path: humMp4, name: 'hum.mp4', ...mHum }], videoClips: [vclip('v1', 'm1')], audioClips: [] };
const projectD = {
  ...base,
  media: [
    { id: 'mv', path: picMp4, name: 'pic.mp4', ...mPic },
    { id: 'm1', path: noiseWav, name: 'noise.wav', ...mNoise },
  ],
  videoClips: [{ ...vclip('v1', 'mv'), out: 6, muted: true }],
  audioClips: [{ id: 'a1', mediaId: 'm1', start: 0, in: 0, out: 4, volume: 1, fadeIn: 0, fadeOut: 0, role: 'music' }],
};
const projectE = {
  ...base,
  media: [
    { id: 'm1', path: tone440, name: 't440.mp4', ...m440 },
    { id: 'm2', path: tone880, name: 't880.mp4', ...m880 },
  ],
  videoClips: [vclip('c1', 'm1'), { ...vclip('c2', 'm2'), transition: { type: 'fade', duration: 1 } }],
  audioClips: [],
};

const env = { ...process.env, HOME: home, DISPLAY: ':99', FVE_EXPORT_TARGET: dir };
const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron'),
  ['.', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-sandbox',
   '--disable-accelerated-video-decode', '--disable-accelerated-video-encode',
   '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
   `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: 'pipe', detached: true });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
child.on('exit', (code, signal) => { console.log(`[child] electron exited code=${code} signal=${signal}`); });
child.on('error', (e) => { console.log(`[child] spawn error: ${e.message}`); });

try {
  const page = await waitTarget();
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const ev = async (expr, tries = 3) => {
    let lastErr;
    for (let i = 0; i < tries; i += 1) {
      try {
        const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
      } catch (e) { lastErr = e; await sleep(5000); }
    }
    throw lastErr;
  };
  const evFire = async (expr) => {
    const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: false, returnByValue: true });
    if (r.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const until = async (expr, ms = 120000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch { /* not yet */ } await sleep(500); }
    return false;
  };
  const state = async () => ev(`window.__fve.exportData().project`);
  // Click the first button whose visible text matches (exact or includes),
  // optionally scoped to a container selector.
  const clickBtn = (text, exact = true, scope = '') => ev(`(() => {
    const root = ${JSON.stringify(scope)} ? document.querySelector(${JSON.stringify(scope)}) : document;
    if (!root) return false;
    const b = [...root.querySelectorAll('button')].find((x) => ${exact ? 'x.textContent.trim() === ' + JSON.stringify(text) : 'x.textContent.includes(' + JSON.stringify(text) + ')'});
    if (b) { b.click(); return true; } return false;
  })()`);
  // Set a controlled range input (React) by aria-label.
  const setRange = (aria, value) => ev(`(() => {
    const el = document.querySelector('input[type=range][aria-label=${JSON.stringify(aria)}]');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(${JSON.stringify(value)}));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  // Set the shared Slider (no aria-label on its range) by its label text.
  const setSliderByLabel = (labelText, value) => ev(`(() => {
    const lab = [...document.querySelectorAll('label.field')].find((l) => l.querySelector('span')?.textContent.includes(${JSON.stringify(labelText)}));
    const el = lab?.querySelector('input[type=range]');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(${JSON.stringify(value)}));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  const waitExport = async (ms = 150000) => {
    const t0 = Date.now();
    let lastSize = -1, stable = 0;
    while (Date.now() - t0 < ms) {
      try {
        const st = fs.statSync(outFile);
        if (st.size === lastSize) { stable += 1; if (stable >= 3 && st.size > 10000) return true; }
        else { stable = 0; lastSize = st.size; }
      } catch { /* not yet */ }
      await sleep(500);
    }
    return fs.existsSync(outFile);
  };

  await until(`!!window.__fve`, 60000);
  // Enter the editor (fresh profiles start on Home).
  await ev(`(() => { const b = document.querySelector('[aria-label="Create project"]'); if (b) b.click(); return !!b; })()`).catch(() => {});
  check('editor ready', await until(`!!document.querySelector('.play-btn')`, 60000));
  await ev(`(() => { const b = document.querySelector('button[aria-label="Skip tour"]') || [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) b.click(); return !!b; })()`).catch(() => {});
  await sleep(600);
  // The first-run Welcome card opens on entry into the editor, a beat after
  // the editor renders — its dim overlay swallows every real pointer hit
  // until dismissed, so poll for it (JS clicks below would not notice it).
  // tourSeen starts null until the persisted flags load, so the card can
  // open AFTER an early check finds nothing — only return once the dim has
  // been absent across two consecutive checks.
  const dismissWelcome = async () => {
    let goneTwice = 0;
    for (let i = 0; i < 30; i += 1) {
      const st = await ev(`(() => {
        const b = document.querySelector('.welcome-go');
        if (b) { b.click(); return 'clicked'; }
        return document.querySelector('.welcome-dim') ? 'waiting' : 'gone';
      })()`).catch(() => 'gone');
      if (st === 'gone') { goneTwice += 1; if (goneTwice >= 2) return true; }
      else goneTwice = 0;
      await sleep(500);
    }
    return false;
  };
  check('welcome card dismissed (no dim over the editor)', await dismissWelcome());

  // ---------- Project A: FB-05 + FB-06 ----------
  if (runSection('A')) {
  await evFire(`window.__fve.load(${JSON.stringify(projectA)})`);
  await sleep(800);
  await ev(`window.__fve.select({ track: 'video', id: 'v1' })`);
  await sleep(400);
  // FB-29: the inspector defaults to Basic, which hides the audio tab —
  // the audio tools live under Advanced.
  await clickBtn('Advanced', true, '.ci-levels');
  await sleep(300);
  await clickBtn('Audio', true, '.ci-tabs');
  await sleep(400);
  const lp = await ev(`(() => {
    const el = document.querySelector('input[type=range][aria-label="Low-pass filter cutoff"]');
    const num = document.querySelector('input.afx-num');
    return el ? { min: el.min, max: el.max, num: !!num } : null;
  })()`);
  check('FB-05 lowpass slider floor is 100 Hz', lp && lp.min === '100', JSON.stringify(lp));
  check('FB-05 precise numeric Hz entry exists', !!(lp && lp.num));
  const uw = await clickBtn('Underwater');
  await sleep(400);
  const fxA = (await state()).videoClips[0].audioFx;
  check('FB-05 Underwater preset applies lowpass 900', uw && fxA && fxA.lowpass === 900, JSON.stringify(fxA));
  // FB-06: manual EQ first, then merge mode must keep it.
  await ev(`window.__fve.dispatch({ type: 'update', track: 'video', id: 'v1', patch: { audioFx: { eq: { low: 5, mid: 0, high: 0 } } } })`);
  await sleep(300);
  const mergeOn = await clickBtn('Merge as layer');
  await sleep(300);
  const modules = await ev(`!!document.querySelector('.afx-modules')`);
  check('FB-06 merge mode shows module checkboxes', mergeOn && modules);
  await clickBtn('Underwater');
  await sleep(400);
  const fxM = (await state()).videoClips[0].audioFx;
  check('FB-06 merge keeps manual EQ, preset lowpass lands', fxM && fxM.eq && fxM.eq.low === 5 && fxM.lowpass === 900, JSON.stringify(fxM));
  const abBtn = await ev(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Compare A/B'))`);
  check('FB-06 Compare A/B button exists', abBtn);
  await clickBtn('Undo preset');
  await sleep(300);
  const fxU = (await state()).videoClips[0].audioFx;
  check('FB-06 one-step Undo preset restores manual EQ', fxU && fxU.eq && fxU.eq.low === 5 && !fxU.lowpass, JSON.stringify(fxU));
  // Back to Underwater (replace) for the audible export.
  await clickBtn('Replace all');
  await sleep(200);
  await clickBtn('Underwater');
  await sleep(400);
  fs.rmSync(outFile, { force: true });
  await evFire(`window.__fve.exportNow()`);
  check('FB-05 export completes', await waitExport());
  {
    // Underwater pitch-shifts a semitone (pitch -1), so the tones land at
    // 283/2828 Hz — measure there, not at the nominal 300/3000.
    const g283 = goertzel(decode(outFile, 0.5, 2), 283);
    const g2828 = goertzel(decode(outFile, 0.5, 2), 2828);
    const cut = db(g2828 / g283);
    console.log(`  FB-05 live: 283 Hz ${g283.toFixed(5)}, 2828 Hz ${g2828.toFixed(5)} (highs vs voice: ${cut.toFixed(1)} dB)`);
    check('FB-05 live: Underwater cuts the highs in the real export', cut < -10, `${cut.toFixed(1)} dB`);
  }

  } // A
  // ---------- Project B: FB-07 ----------
  if (runSection('B')) {
  await evFire(`window.__fve.load(${JSON.stringify(projectB)})`);
  await sleep(800);
  await ev(`window.__fve.select({ track: 'audio', id: 'a1' })`);
  await sleep(500);
  const duckSeen = await ev(`!!document.querySelector('[aria-label="Music ducking"]')`);
  check('FB-07 ducking panel renders on a music clip', duckSeen);
  await ev(`(() => { const t = document.querySelector('[aria-label="Music ducking"]'); if (t) t.click(); return !!t; })()`);
  await sleep(300);
  const duckSet = await setRange('Duck to', 0.2);
  await sleep(400);
  const duck = (await state()).audioClips.find((c) => c.id === 'a1').duck;
  check('FB-07 duck amount writes state (on, to 0.2)', duckSet && duck && duck.on === true && Math.abs(duck.to - 0.2) < 1e-9, JSON.stringify(duck));
  fs.rmSync(outFile, { force: true });
  await evFire(`window.__fve.exportNow()`);
  check('FB-07 export completes', await waitExport());
  {
    // Music is white noise; dialogue is a 700 Hz tone at 0.5–2.5 s.
    // Highpassed RMS isolates the music (the tone is filtered out).
    // A single-bin Goertzel on AAC noise is unreliable — one 6 kHz bin
    // can quantize to zero in the quiet passage — so broadband RMS it is.
    const hpRms = (from, len) => {
      const raw = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', outFile, '-vn', '-ss', String(from), '-t', String(len), '-af', 'highpass=f=5000', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 28 });
      const n = raw.length / 4; let a = 0;
      for (let i = 0; i < n; i++) { const x = raw.readFloatLE(i * 4); a += x * x; }
      return Math.sqrt(a / n);
    };
    const ducked = hpRms(1.0, 1.0);
    const open = hpRms(4.0, 1.0);
    const ratio = ducked / open;
    console.log(`  FB-07 live: music hp-rms ducked ${ducked.toFixed(4)} vs open ${open.toFixed(4)} (ratio ${ratio.toFixed(2)})`);
    check('FB-07 live: music ducks to ~0.2x under dialogue', ratio > 0.12 && ratio < 0.32, `ratio ${ratio.toFixed(2)}`);
  }

  } // B
  // ---------- Project C: FB-08 ----------
  if (runSection('C')) {
  await evFire(`window.__fve.load(${JSON.stringify(projectC)})`);
  await sleep(800);
  await ev(`window.__fve.select({ track: 'video', id: 'v1' })`);
  await sleep(400);
  // FB-29: the inspector defaults to Basic, which hides the audio tab.
  await clickBtn('Advanced', true, '.ci-levels');
  await sleep(300);
  await clickBtn('Audio', true, '.ci-tabs');
  await sleep(400);
  const repairSeen = await ev(`!!document.querySelector('[aria-label="Voice repair"]')`);
  check('FB-08 repair panel renders on a video clip', repairSeen);
  await ev(`(() => { const t = document.querySelector('[aria-label="Voice repair"]'); if (t) t.click(); return !!t; })()`);
  await sleep(300);
  // The monitor seg renders only once repair is on.
  const monitorSeen = await ev(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Original') && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Repaired')`);
  check('FB-08 Original/Repaired monitor exists', monitorSeen);
  await ev(`(() => {
    const s = document.querySelector('select[aria-label="Mains hum notch"]');
    if (!s) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(s, 'auto');
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(400);
  const rep = (await state()).videoClips[0].repair;
  check('FB-08 repair toggle + hum auto write state', rep && rep.on === true && rep.hum === 'auto', JSON.stringify(rep));
  fs.rmSync(outFile, { force: true });
  await evFire(`window.__fve.exportNow()`);
  check('FB-08 export completes', await waitExport());
  {
    // Hum/voice ratio before (fixture) vs after (export): the bus gain cancels.
    const fixHum = goertzel(decode(humMp4, 0.5, 2), 50);
    const fixVoice = goertzel(decode(humMp4, 0.5, 2), 700);
    const expHum = goertzel(decode(outFile, 0.5, 2), 50);
    const expVoice = goertzel(decode(outFile, 0.5, 2), 700);
    const drop = db((expHum / expVoice) / (fixHum / fixVoice));
    console.log(`  FB-08 live: hum/voice fixture ${(fixHum / fixVoice).toFixed(3)} -> export ${(expHum / expVoice).toFixed(3)} (${drop.toFixed(1)} dB)`);
    check('FB-08 live: mains hum falls >= 10 dB vs voice in the real export', drop < -10, `${drop.toFixed(1)} dB`);
  }

  } // C
  // ---------- Project D: FB-09 ----------
  if (runSection('D')) {
  await evFire(`window.__fve.load(${JSON.stringify(projectD)})`);
  await sleep(800);
  // Dismiss AFTER the load: entering the project is what (re)opens the card.
  await dismissWelcome();
  // The audio lane sits below the fold at 1920x1080 (handles measured
  // y~1105) and a raw CDP pointer event outside the viewport never
  // reaches the handle, so the drag silently writes nothing. Scroll the
  // fade-in handle into view first, then re-read its rect (scrolling
  // moves it).
  await ev(`(() => { const h = document.querySelector('.vol-fade-handle'); if (h) h.scrollIntoView({ block: 'nearest' }); return true; })()`);
  await sleep(300);
  const handles = await ev(`(() => {
    const hs = [...document.querySelectorAll('.vol-fade-handle')];
    return hs.map((h) => { const r = h.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: h.getAttribute('aria-label') }; });
  })()`);
  check('FB-09 two fade handles render on the sounding audio clip', Array.isArray(handles) && handles.length === 2, JSON.stringify(handles));
  if (Array.isArray(handles) && handles.length >= 1) {
    const h = handles[0]; // fade-in handle at the clip's left edge
    const before = (await state()).audioClips.find((c) => c.id === 'a1').fadeIn || 0;
    await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: h.x, y: h.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 6; i += 1) {
      await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h.x + i * 10, y: h.y, button: 'left' });
      await sleep(60);
    }
    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: h.x + 60, y: h.y, button: 'left', clickCount: 1 });
    await sleep(400);
    const after = (await state()).audioClips.find((c) => c.id === 'a1').fadeIn || 0;
    console.log(`  FB-09 live: fadeIn ${before} -> ${after} after a 60 px right drag`);
    check('FB-09 live: dragging the fade-in handle writes clip.fadeIn', after > before + 0.1, `fadeIn=${after}`);
  }

  } // D
  // ---------- Project E: FB-13 ----------
  if (runSection('E')) {
  await evFire(`window.__fve.load(${JSON.stringify(projectE)})`);
  await sleep(800);
  await ev(`window.__fve.select({ track: 'transition', id: 'c2' })`);
  await sleep(500);
  const afSeen = await ev(`document.body.textContent.includes('Audio fade')`);
  check('FB-13 audio-fade field renders in the transition panel', afSeen);
  const customOn = await clickBtn('Custom');
  await sleep(300);
  const durSet = await setSliderByLabel('Audio fade duration', 0.3);
  await sleep(400);
  const tr = (await state()).videoClips.find((c) => c.id === 'c2').transition;
  check('FB-13 custom audio fade writes state (0.3 s)', customOn && durSet && tr && tr.audioFade && tr.audioFade.mode === 'custom' && Math.abs(tr.audioFade.duration - 0.3) < 1e-9, JSON.stringify(tr && tr.audioFade));
  fs.rmSync(outFile, { force: true });
  await evFire(`window.__fve.exportNow()`);
  check('FB-13 export completes', await waitExport());
  {
    const dur = fileDuration(outFile);
    const dip = db(rms(decode(outFile, 2.45, 0.1)) / rms(decode(outFile, 0.5, 1)));
    console.log(`  FB-13 live: export duration ${dur.toFixed(2)} s, midpoint dip ${dip.toFixed(2)} dB`);
    check('FB-13 live: custom-fade export stays 5 s, dip < 1.5 dB', Math.abs(dur - 5) < 0.1 && Math.abs(dip) < 1.5, `dur=${dur.toFixed(2)} dip=${dip.toFixed(2)}`);
  }

  } // E
  console.log(`\nF2 LIVE${ONLY ? ' [' + [...ONLY].join(',') + ']' : ''}: ${results.filter(([, ok]) => ok).length}/${results.length} checks passed — work dir ${dir}`);
  if (results.some(([, ok]) => !ok)) process.exitCode = 1;
} catch (e) {
  console.error('F2 LIVE ERROR:', e.message);
  console.error(stderr.slice(-3000));
  process.exitCode = 1;
} finally {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already dead */ }
}
