// AudioFx live audition — the slice (P1-13): a preset change is heard in ~1 s
// through a 6 s render of the new chain from the playhead, while the full-clip
// derivative still renders after it. Asserted:
//  1. Slice windows: media/enhanced source ranges, clamping at the clip end,
//     out-of-range playheads -> null.
//  2. Slice validity: chain / source / in-point alignment / window coverage —
//     a re-trim or an fx edit makes the slice inert, never silently stale.
//  3. Panel state: null (no fx) / pending / slice / ready.
//  4. substitutedSoundOf precedence (full derivative > slice > enhance > null)
//     and the slice's file offset (srcOff - srcOff0).
//  5. A real slice render: the file covers the window, its samples match an
//     independent ffmpeg render of the same chain (not the raw sound), and the
//     slice and the full render are different cache files.
//  6. The export never sees a slice: a clip with only audioFxSlice exports with
//     the chain inline and never references the slice file.
//  7. Wiring: Preview substitutes through substitutedSoundOf, App queues the
//     slice first, the panel has the slice state, i18n noteSlice x3.
// Usage: node scripts/test-audiofx-slice.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { audioFxFilters } = require('../electron/audiofx.cjs');
const { renderAudioFx } = require('../electron/audiofxrender.cjs');
const { buildExportArgs, probe, ffmpegPath, ffprobePath } = require('../electron/ffmpeg.cjs');
const preview = await import('../src/fx/audioFxPreview.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afxslice-'));
const cacheDir = path.join(dir, 'cache');
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
const read = (f) => fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', f), 'utf8');
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };

// ---- 1. Slice windows ---------------------------------------------------------------
{
  const media = { path: '/m.wav', duration: 30 };
  const clip = { in: 10, out: 25, audioFx: { pitch: 12 } };
  const w = preview.audioFxSliceSourceFor(clip, media, 2);
  ok(w && w.srcPath === '/m.wav' && w.from === 12 && w.to === 18 && w.srcOff0 === 2, `slice window: media source [in+srcOff, +6s] (got ${w && `${w.from}..${w.to}`})`);
  const tail = preview.audioFxSliceSourceFor(clip, media, 13);
  ok(tail && tail.from === 23 && tail.to === 25, `slice window: clamps at the clip end (got ${tail && `${tail.from}..${tail.to}`})`);
  ok(preview.audioFxSliceSourceFor(clip, media, 15) === null, 'slice window: a playhead past the clip end renders nothing');
  ok(preview.audioFxSliceSourceFor(clip, media, -1) === null, 'slice window: a negative offset renders nothing');
  const enh = { on: true, path: '/e.wav', from: 10, to: 25 };
  const ew = preview.audioFxSliceSourceFor({ ...clip, enhance: enh }, media, 3);
  ok(ew && ew.srcPath === '/e.wav' && ew.from === 3 && ew.to === 9 && ew.srcOff0 === 3, `slice window: enhanced source runs on the enhanced file's own timeline (got ${ew && `${ew.from}..${ew.to}`})`);
  const etail = preview.audioFxSliceSourceFor({ ...clip, enhance: enh }, media, 13);
  ok(etail && etail.from === 13 && etail.to === 15, 'slice window: enhanced source clamps at the clip length');
  ok(preview.AUDIO_FX_SLICE_SECONDS === 6, 'slice length is 6 s');
}

// ---- 2+3+4. Validity, panel state, precedence ----------------------------------------
{
  const fx = { pitch: 12 };
  const chain = audioFxFilters(fx).join(',');
  const media = { path: '/m.wav', duration: 30 };
  const slice = { path: '/s.wav', from: 12, to: 18, chain, src: '/m.wav', srcOff0: 2 };
  const clip = { in: 10, out: 25, audioFx: fx, audioFxSlice: slice };
  const got = preview.audioFxSliceOf(clip, media, 4);
  ok(got && got.path === '/s.wav' && got.delta === -2, `slice covers the playhead: file offset is srcOff - srcOff0 (delta ${got && got.delta})`);
  ok(preview.audioFxSliceOf(clip, media, 2) && preview.audioFxSliceOf(clip, media, 7.9), 'slice covers its whole window [srcOff0, srcOff0+len)');
  ok(preview.audioFxSliceOf(clip, media, 1.9) === null, 'slice does not cover before its window');
  ok(preview.audioFxSliceOf(clip, media, 8) === null, 'slice does not cover past its window end');
  ok(preview.audioFxSliceOf({ ...clip, audioFx: { pitch: 4 } }, media, 4) === null, 'fx edited -> slice is inert');
  ok(preview.audioFxSliceOf({ ...clip, in: 11 }, media, 4) === null, 're-trimmed (in moved) -> slice is inert');
  ok(preview.audioFxSliceOf({ ...clip, audioFxSlice: { ...slice, src: '/other.wav' } }, media, 4) === null, 'other source -> slice is inert');
  ok(preview.audioFxPreviewState(clip, media) === 'slice', 'panel state is slice while the full render is still landing');
  ok(preview.audioFxPreviewState({ ...clip, audioFxSlice: undefined }, media) === 'pending', 'panel state is pending with no render at all');
  ok(preview.audioFxPreviewState({ ...clip, audioFx: null }, media) === null, 'panel state is null with no effects');
  const full = { path: '/f.wav', from: 10, to: 25, chain, src: '/m.wav' };
  ok(preview.audioFxPreviewState({ ...clip, audioFxRender: full }, media) === 'ready', 'panel state is ready once the full derivative lands');
  const enh = { on: true, path: '/e.wav', from: 10, to: 25 };
  // With enhance on, the slice must have been rendered FROM the enhanced file
  // (its timeline starts at the in-point, so from == srcOff0) — a slice from
  // the raw media is stale while enhance is on, exactly like a full render.
  const enhSlice = { path: '/s.wav', from: 2, to: 8, chain, src: '/e.wav', srcOff0: 2 };
  const sub = preview.substitutedSoundOf({ ...clip, enhance: enh, audioFxSlice: enhSlice }, media, 4);
  ok(sub && sub.path === '/s.wav' && sub.delta === -2, 'substituted sound prefers the slice over the enhancer file');
  const fullEnh = { path: '/f.wav', from: 10, to: 25, chain, src: '/e.wav' };
  const subFull = preview.substitutedSoundOf({ ...clip, enhance: enh, audioFxSlice: enhSlice, audioFxRender: fullEnh }, media, 4);
  ok(subFull && subFull.path === '/f.wav' && subFull.delta === 0, 'substituted sound prefers the full derivative over the slice');
  const subEnh = preview.substitutedSoundOf({ ...clip, audioFxSlice: undefined, enhance: enh }, media, 4);
  ok(subEnh && subEnh.path === '/e.wav' && subEnh.delta === 0, 'substituted sound falls back to the enhancer file');
  ok(preview.substitutedSoundOf({ ...clip, audioFxSlice: undefined }, media, 4) === null, 'substituted sound is null for the original sound');
  // Enhanced-source slice: from == srcOff0 on the enhanced timeline.
  const eslice = { path: '/es.wav', from: 3, to: 9, chain, src: '/e.wav', srcOff0: 3 };
  const eclip = { ...clip, enhance: enh, audioFxSlice: eslice };
  const egot = preview.audioFxSliceOf(eclip, media, 5);
  ok(egot && egot.path === '/es.wav' && egot.delta === -3, 'enhanced slice: offset from the enhanced timeline');
  ok(preview.audioFxSliceOf({ ...eclip, audioFxSlice: { ...eslice, from: 4 } }, media, 5) === null, 'enhanced slice with a shifted window is inert');
}

// ---- 5. A real slice render ----------------------------------------------------------
// 44.1 kHz stereo fixture (two detuned sines), so the render's 48 kHz resample is real.
const srcWav = path.join(dir, 'src.wav');
gen(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=1320:duration=12',
  '-filter_complex', '[0][1]amix=inputs=2:weights=0.7 0.3', '-ar', '44100', '-ac', '2', srcWav]);
const decode = (file) => execFileSync(ffmpegPath, ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', '48000', '-'], { maxBuffer: 64 * 1024 * 1024 });
function compare(aFile, bFile, label) {
  const a = decode(aFile);
  const b = decode(bFile);
  assert.equal(a.length, b.length, `${label}: frame counts differ (${a.length} vs ${b.length})`);
  let maxAbs = 0; let sumSq = 0; const n = a.length / 4;
  for (let i = 0; i < a.length; i += 4) { const d = Math.abs(a.readFloatLE(i) - b.readFloatLE(i)); if (d > maxAbs) maxAbs = d; sumSq += d * d; }
  const rms = Math.sqrt(sumSq / n);
  assert.ok(maxAbs <= 0.002, `${label}: max abs diff ${maxAbs} exceeds 0.002`);
  assert.ok(rms <= 0.0005, `${label}: diff RMS ${rms} exceeds 0.0005`);
  console.log(`  parity ${label}: max abs diff ${maxAbs.toExponential(2)}, diff RMS ${rms.toExponential(2)}`);
}
{
  const fx = { pitch: 12 };
  const slice = await renderAudioFx({ srcPath: srcWav, from: 2, to: 8, fx, channels: 2, cacheDir, ffmpegPath });
  ok(slice && slice.path && fs.existsSync(slice.path), 'slice renders to a file');
  const dur = Number(execFileSync(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', slice.path]).toString().trim());
  ok(Math.abs(dur - 6) < 0.05, `slice covers exactly its 6 s window (got ${dur.toFixed(2)} s)`);
  const ref = path.join(dir, 'ref-slice.wav');
  gen(['-ss', '2', '-t', '6', '-i', srcWav, '-map', '0:a:0', '-vn',
    '-af', ['aresample=48000', ...audioFxFilters(fx)].join(','), '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', ref]);
  compare(slice.path, ref, 'slice == independent chain render');
  const rawPath = path.join(dir, 'raw.wav');
  gen(['-ss', '2', '-t', '6', '-i', srcWav, '-map', '0:a:0', '-vn', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', rawPath]);
  const sl = decode(slice.path); const rw = decode(rawPath);
  let maxAbs = 0; for (let i = 0; i < sl.length; i += 4) maxAbs = Math.max(maxAbs, Math.abs(sl.readFloatLE(i) - rw.readFloatLE(i)));
  ok(maxAbs > 0.1, `slice is the NEW chain, not the raw sound (max abs diff vs raw ${maxAbs.toFixed(3)})`);
  const full = await renderAudioFx({ srcPath: srcWav, from: 0, to: 12, fx, channels: 2, cacheDir, ffmpegPath });
  ok(full && full.path !== slice.path, 'the slice and the full render are different cache files');
}

// ---- 6. The export never sees a slice -------------------------------------------------
{
  const vid = path.join(dir, 'vid.mp4');
  gen(['-f', 'lavfi', '-i', 'testsrc=size=640x480:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest', '-ar', '44100', vid]);
  const media = [{ id: 'm1', path: vid, name: 'vid.mp4', ...(await probe(vid)) }];
  const fx = { pitch: 12 };
  const slicePath = '/tmp/slice-abcdef.wav';
  const project = {
    name: 'afx-slice', ratio: '16:9', resolution: 720, width: 640, height: 480, fps: 30, background: '#101010', media,
    videoClips: [{ id: 'c1', mediaId: 'm1', in: 0, out: 4, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1,
      audioFx: fx, audioFxSlice: { path: slicePath, from: 0, to: 4, chain: audioFxFilters(fx).join(','), src: vid, srcOff0: 0 } }],
    overlayClips: [], textClips: [], audioClips: [],
  };
  const args = buildExportArgs(project, path.join(dir, 'out.mp4')).args.join(' ');
  ok(!args.includes(slicePath), 'export graph never references the slice file');
  ok(args.includes('asetrate'), 'export applies the pitch chain inline when only a slice exists');
}

// ---- 7. Wiring -------------------------------------------------------------------------
{
  const app = read('src/App.jsx');
  ok(app.includes('audioFxSliceSourceFor') && app.includes("field: 'audioFxSlice'"), 'wiring: App queues the slice render before the full render');
  ok(app.includes('timeRef.current') && app.includes('audioFxSliceSourceFor'), 'wiring: the slice starts from the playhead');
  const prev = read('src/components/Preview.jsx');
  const sites = (prev.match(/substitutedSoundOf\(c, m, srcOff\)/g) || []).length;
  ok(sites === 3, `wiring: Preview substitutes through substitutedSoundOf at all 3 sound sites (found ${sites})`);
  ok(prev.includes('srcOff + sp.delta') && prev.includes('sp.path'), 'wiring: Preview shifts the slice by its delta');
  ok(!prev.includes('audioFxPathOf(c, m) || enhPath(c)'), 'wiring: no call site still uses the old two-way resolution');
  const afx = read('src/components/AudioFx.jsx');
  ok(afx.includes("previewState === 'slice'") && afx.includes('afx.noteSlice'), 'wiring: the panel has the slice state and note');
  for (const f of ['src/components/ClipInspector.jsx', 'src/components/Inspector.jsx']) {
    ok(read(f).includes('audioFxPreviewState(clip, media)'), `wiring: ${f} reports the preview state`);
  }
  for (const lang of ['en', 'fr', 'ar']) ok(read(`src/i18n/${lang}.js`).includes('"afx.noteSlice"'), `wiring: ${lang} has afx.noteSlice`);
  ok(!read('electron/ffmpeg.cjs').includes('audioFxSlice'), 'wiring: the export engine never mentions a slice');
  ok(read('src/fx/audioFxPreview.js').includes('AUDIO_FX_SLICE_SECONDS = 6'), 'wiring: the slice length is one named constant');
}

if (process.exitCode) console.log('\nAUDIOFX SLICE FAIL');
else console.log('\nAUDIOFX SLICE OK');
