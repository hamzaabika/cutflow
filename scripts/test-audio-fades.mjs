// AU-03 — audio fades, equal-power crossfades, drag handles.
//  - Every acrossfade in the export is equal-power (squ/squ): a live
//    render of two tones must hold its RMS through the overlap, while the
//    old linear (tri/tri) control dips ~3 dB.
//  - Fade handles exist on the timeline for every sounding clip (video,
//    audio, overlay) and are keyboard-adjustable.
// Usage: node scripts/test-audio-fades.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ff = require('../electron/ffmpeg.cjs');
const { ffmpegPath, buildExportArgs, buildAudioExportArgs, buildTimelineAudioArgs } = ff;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-fades-'));
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
const v1 = path.join(dir, 'v1.mp4');
const v2 = path.join(dir, 'v2.mp4');
gen(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
  '-af', 'volume=0.5', '-shortest', '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', v1]);
gen(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=4',
  '-af', 'volume=0.5', '-shortest', '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', v2]);

const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
const project = {
  name: 'fades', ratio: '16:9', width: 320, height: 180, fps: 30, background: '#000000',
  media: [
    { id: 'm1', path: v1, type: 'video', hasAudio: true },
    { id: 'm2', path: v2, type: 'video', hasAudio: true },
  ],
  videoClips: [
    { ...base, id: 'c1', mediaId: 'm1', in: 0, out: 4 },
    { ...base, id: 'c2', mediaId: 'm2', in: 0, out: 4, transition: { type: 'fade', duration: 1 } },
  ],
  audioClips: [], overlayClips: [], textClips: [], stickerClips: [], effectClips: [],
};

// ---- 1) Every crossfade in every audio path is equal-power ----
{
  const flat = (args) => args.join(' ');
  const ve = flat(buildExportArgs(project, path.join(dir, 'out.mp4')).args);
  const ae = flat(buildAudioExportArgs(project, path.join(dir, 'out.mp3')));
  const ta = flat(buildTimelineAudioArgs(project, path.join(dir, 'mix.wav')));
  for (const [name, s] of [['video export', ve], ['audio export', ae], ['timeline mix', ta]]) {
    assert.ok(s.includes('acrossfade=d=1.000:c1=squ:c2=squ'), `${name}: equal-power acrossfade in the graph`);
    assert.ok(!s.replaceAll('acrossfade=d=1.000:c1=squ:c2=squ', '').includes('acrossfade'), `${name}: no other acrossfade left`);
  }
  // Fades still render as afades.
  const faded = { ...project, videoClips: [{ ...project.videoClips[0], fadeIn: 0.5, fadeOut: 0.5 }, project.videoClips[1]] };
  const ff2 = flat(buildExportArgs(faded, path.join(dir, 'out2.mp4')).args);
  assert.ok(ff2.includes('afade=t=in:st=0:d=0.500') && ff2.includes('afade=t=out'), 'clip fades render as afade filters');
}

// ---- 2) Live: RMS holds through the overlap (equal power), dips for tri ----
const rmsWindow = (file, from, to) => {
  const buf = fs.readFileSync(file);
  // Minimal WAV reader: RIFF header, fmt chunk (float32), data chunk.
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF', 'wav header');
  let off = 12; let fmt = null; let data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(off + 8), channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12) };
    if (id === 'data') data = { off: off + 8, size };
    off += 8 + size + (size % 2);
  }
  assert.ok(fmt && data, 'wav fmt + data chunks');
  assert.ok(fmt.format === 3 || fmt.format === 1, `wav is float32 or s16 (got ${fmt.format})`);
  const bytes = fmt.format === 3 ? 4 : 2;
  const n = data.size / bytes;
  const sr = fmt.rate;
  const a = Math.floor(from * sr); const b = Math.min(n, Math.floor(to * sr));
  let sum = 0;
  for (let i = a; i < b; i++) {
    const v = fmt.format === 3 ? buf.readFloatLE(data.off + i * 4) : buf.readInt16LE(data.off + i * 2) / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / Math.max(1, b - a));
};
const db = (r) => 20 * Math.log10(Math.max(1e-9, r));
{
  const mix = path.join(dir, 'mix.wav');
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...buildTimelineAudioArgs(project, mix)]);
  // Clip 1 runs [0,4], clip 2 starts at 3 (1s transition) — the overlap is [3,4], mid 3.5.
  const e1 = db(rmsWindow(mix, 0.5, 2.5));
  const mid = db(rmsWindow(mix, 3.4, 3.6));
  const e2 = db(rmsWindow(mix, 5, 6.5));
  console.log(`  equal-power RMS: edge1 ${e1.toFixed(2)} dB, mid-fade ${mid.toFixed(2)} dB, edge2 ${e2.toFixed(2)} dB`);
  assert.ok(Math.abs(mid - e1) < 0.8 && Math.abs(mid - e2) < 0.8, `no dip at mid-fade (edges ${e1.toFixed(1)}/${e2.toFixed(1)} dB, mid ${mid.toFixed(1)} dB)`);
  // Control: the same two tones through a linear (tri/tri) acrossfade —
  // no adelay: acrossfade overlaps the tail of the first input with the
  // head of the second, which is exactly the timeline geometry.
  const ctl = path.join(dir, 'ctl.wav');
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error',
    '-i', v1, '-i', v2, '-filter_complex',
    '[0:a]atrim=0:4,asetpts=PTS-STARTPTS[a0];[1:a]atrim=0:4,asetpts=PTS-STARTPTS[a1];[a0][a1]acrossfade=d=1:c1=tri:c2=tri,aresample=16000,aformat=sample_fmts=flt:channel_layouts=mono[out]',
    '-map', '[out]', ctl]);
  const c1 = db(rmsWindow(ctl, 0.5, 2.5));
  const cm = db(rmsWindow(ctl, 3.4, 3.6));
  console.log(`  linear control RMS: edge ${c1.toFixed(2)} dB, mid-fade ${cm.toFixed(2)} dB (dip ${(c1 - cm).toFixed(2)} dB)`);
  assert.ok(c1 - cm > 2, `the control dips as expected (${(c1 - cm).toFixed(1)} dB) — the measurement can see a dip`);
}

// ---- 3) Fade-handle wiring ----
{
  const tl = fs.readFileSync(new URL('../src/components/Timeline.jsx', import.meta.url), 'utf8');
  const ov = fs.readFileSync(new URL('../src/components/TimelineOverlays.jsx', import.meta.url), 'utf8');
  assert.ok(ov.includes('export function FadeHandles'), 'FadeHandles component exists (TimelineOverlays.jsx, split out of Timeline.jsx by the A-F7 size guard)');
  assert.ok(tl.includes("import { FadeHandles, VolLine } from './TimelineOverlays.jsx'"), 'Timeline imports the overlays');
  assert.ok(tl.includes('startFadeDrag') && tl.includes('keyFade'), 'fade drag + keyboard handlers exist');
  assert.ok((tl.match(/<FadeHandles /g) || []).length === 3, 'handles render on video, audio and overlay lanes');
  assert.ok(tl.includes("onDragFade={(e, which) => startFadeDrag(e, 'video'"), 'video lane wires the drag');
  assert.ok(tl.includes("onDragFade={(e, which) => startFadeDrag(e, 'audio'"), 'audio lane wires the drag');
  assert.ok(tl.includes("onDragFade={(e, which) => startFadeDrag(e, 'overlay'"), 'overlay lane wires the drag');
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.fade-handle') && css.includes('.fade-handle.on'), 'fade-handle styles exist');
  for (const lang of ['en', 'fr', 'ar']) {
    const dict = fs.readFileSync(new URL(`../src/i18n/${lang}.js`, import.meta.url), 'utf8');
    for (const k of ['"tl.fadeInTitle"', '"tl.fadeInAria"', '"tl.fadeOutTitle"', '"tl.fadeOutAria"']) {
      assert.ok(dict.includes(k), `${lang}: ${k}`);
    }
  }
}

console.log('audio-fades: all checks passed');
