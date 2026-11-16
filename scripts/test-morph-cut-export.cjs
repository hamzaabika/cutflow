// True morph cut (P3-03), export proof: a morph segment rendered with the
// CPU reference warp (morph.js renderMorphCPU, the same maths as the WebGL
// shader) joins through the real export pipeline (runExport + fxSegments),
// and the exported mid-transition frame carries the warp — measurably
// different from a dissolve of the same frames, and close to the morph
// reference. The dissimilar pair proves the fallback: its segment is the
// dissolve, and the analysis says so.
// Usage: node scripts/test-morph-cut-export.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { ffmpegPath, probe, runExport } = require('../electron/ffmpeg.cjs');
const { segmentEncoderArgs } = require('../electron/fxjobs.cjs');

const W = 320;
const H = 180;
const FPS = 30;
const TD = 0.6;
const assert = (ok, what) => { if (!ok) throw new Error(what); };

(async () => {
  const { runTransition } = await import('../src/fx/run.js');
  const { analyseMorph, renderMorphCPU } = await import('../src/fx/morph.js');
  const { transitionExpr } = await import('../src/fx/params.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-morph-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const a = path.join(dir, 'a.mp4');
  const b = path.join(dir, 'b.mp4');
  const c = path.join(dir, 'c.mp4');
  // A: a real photo held 2 s. B: the SAME photo shifted 8 px — a true morph
  // pair (one small rigid displacement, no face-zone motion). C: a different
  // pattern. (testsrc2 was tried first: its fast shapes legitimately trip
  // the face-motion guard, so it cannot serve as the morphable fixture.)
  const photo = path.join(__dirname, '..', 'public', 'preview', 'p1015.jpg');
  gen(['-loop', '1', '-i', photo, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-vf', `scale=${W}:${H}`, '-pix_fmt', 'yuv420p', '-t', '2', a]);
  gen(['-i', a, '-vf', `crop=${W - 8}:${H}:8:0,pad=${W}:${H}:0:0`, '-pix_fmt', 'yuv420p', b]);
  gen(['-f', 'lavfi', '-i', `testsrc=size=${W}x${H}:rate=${FPS}:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2', '-shortest', '-pix_fmt', 'yuv420p', c]);
  const media = [];
  for (const [id, p] of [['m1', a], ['m2', b], ['m3', c]]) media.push({ id, path: p, name: path.basename(p), ...(await probe(p)) });

  const decodeFrames = (file, from, len) => {
    const raw = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file,
      '-vf', `trim=start=${from}:duration=${len},setpts=PTS-STARTPTS,fps=${FPS},scale=${W}:${H},format=rgba`,
      '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 28 });
    const size = W * H * 4;
    const frames = [];
    for (let o = 0; o + size <= raw.length; o += size) frames.push(raw.subarray(o, o + size));
    return frames;
  };
  const meanAbs = (x, y) => {
    let s = 0;
    for (let i = 0; i < x.length; i += 4) s += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]);
    return s / (x.length / 4) / 3;
  };
  // Luma-only comparison: the dissolve is a 1 px dither checkerboard, and the
  // export's yuv420p chroma subsampling averages each 2x2 block's chroma —
  // the RGB diff of a dither frame is therefore large (~39) even when the
  // export carries the segment exactly. Luma is full-resolution in yuv420p,
  // so the dither survives there; a crossfade is far away in luma too.
  const lumaAt = (b, i) => 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
  const lumaDiff = (x, y) => {
    let s = 0;
    for (let i = 0; i < x.length; i += 4) s += Math.abs(lumaAt(x, i) - lumaAt(y, i));
    return s / (x.length / 4);
  };
  const extractAt = (file, t) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, 'pipe:1'], { maxBuffer: 1 << 28 });

  // Render one transition segment the way the app's fx pass does: analyse
  // the boundary pair once, then warp every frame (or dissolve on fallback).
  const renderSegment = async (tag, fileA, fileB) => {
    const fa = decodeFrames(fileA, 2 - TD, TD);
    const fb = decodeFrames(fileB, 0, TD);
    const frames = Math.max(1, Math.round(TD * FPS));
    assert(fa.length >= frames - 1 && fb.length >= frames - 1, `${tag}: decoded ${fa.length}/${fb.length} frames`);
    const analysis = analyseMorph(fa[0], fb[0], W, H);
    console.log(`${tag}: analysis score ${analysis.score.toFixed(3)} coverage ${analysis.coverage.toFixed(2)} -> ${analysis.fallback ? `FALLBACK ${analysis.reason}` : 'morph'}`);
    const seg = path.join(dir, `seg-${tag}.mkv`);
    const enc = spawn(ffmpegPath, segmentEncoderArgs(seg, W, H, FPS), { windowsHide: true });
    const done = new Promise((res, rej) => { enc.on('close', (cc) => (cc === 0 ? res() : rej(new Error(`segment encoder ${cc}`)))); enc.on('error', rej); });
    enc.stdin.on('error', () => {});
    const refs = [];
    for (let k = 0; k < frames; k++) {
      const P = (k / FPS) / TD;
      const out = new Uint8ClampedArray(W * H * 4);
      if (analysis.fallback) runTransition(fa[Math.min(k, fa.length - 1)], fb[Math.min(k, fb.length - 1)], out, W, H, P, transitionExpr({ type: 'fx_morphcut' }));
      else renderMorphCPU(fa[Math.min(k, fa.length - 1)], fb[Math.min(k, fb.length - 1)], out, W, H, P, analysis.flow, analysis.gw, analysis.gh, 1);
      refs.push(Buffer.from(out));
      if (!enc.stdin.write(Buffer.from(out))) await new Promise((r) => enc.stdin.once('drain', r));
    }
    enc.stdin.end();
    await done;
    return { seg, refs, analysis, fa, fb, frames };
  };

  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const exportWith = async (tag, mediaB, seg) => {
    const project = {
      name: 'morph', ratio: '16:9', resolution: 180, width: W, height: H, fps: FPS, background: '#000000',
      media: [media[0], mediaB],
      videoClips: [
        { ...base, id: 'c1', mediaId: 'm1', in: 0, out: 2 },
        { ...base, id: 'c2', mediaId: mediaB.id, in: 0, out: 2, transition: { type: 'fx_morphcut', duration: TD } },
      ],
      overlayClips: [], textClips: [], audioClips: [], stickerClips: [],
      fxSegments: { c2: seg },
    };
    const out = path.join(dir, `out-${tag}.mp4`);
    await runExport(project, out, null).promise;
    return out;
  };

  // ---- Morphable pair: the warp survives the export ----
  const m = await renderSegment('morph', a, b);
  assert(!m.analysis.fallback, `morph pair must analyse clean (got ${m.analysis.reason})`);
  const outMorph = await exportWith('morph', media[1], m.seg);
  const info = await probe(outMorph);
  assert(Math.abs(info.duration - 3.4) < 0.2, `morph export duration ${info.duration}, expected ~3.4`);
  assert(info.hasVideo && info.hasAudio, 'morph export has video + audio');
  // Mid-transition frame (transition midpoint sits at 2 - TD/2 = 1.7 s).
  const midK = Math.floor(m.frames / 2);
  const expMid = extractAt(outMorph, 2 - TD / 2);
  const morphRef = m.refs[midK];
  const disRef = new Uint8ClampedArray(W * H * 4);
  runTransition(m.fa[Math.min(midK, m.fa.length - 1)], m.fb[Math.min(midK, m.fb.length - 1)], disRef, W, H, (midK / FPS) / TD, transitionExpr({ type: 'dissolve' }));
  const vsMorph = meanAbs(expMid, morphRef);
  const vsDissolve = meanAbs(expMid, disRef);
  console.log(`morph export mid-frame: vs morph ref ${vsMorph.toFixed(2)}, vs dissolve ref ${vsDissolve.toFixed(2)}`);
  assert(vsMorph < 8, `export mid-frame matches the morph reference (${vsMorph.toFixed(2)})`);
  assert(vsDissolve > 2, `export mid-frame is a warp, not a dissolve (${vsDissolve.toFixed(2)})`);

  // ---- Dissimilar pair: the analysis falls back, the export dissolves ----
  const d = await renderSegment('dissimilar', a, c);
  assert(d.analysis.fallback && d.analysis.reason === "dissimilar", `dissimilar pair must fall back (${d.analysis.reason})`);
  const outDis = await exportWith('dissimilar', media[2], d.seg);
  const infoD = await probe(outDis);
  assert(Math.abs(infoD.duration - 3.4) < 0.2, `dissimilar export duration ${infoD.duration}, expected ~3.4`);
  const expMidD = extractAt(outDis, 2 - TD / 2);
  const disRefD = new Uint8ClampedArray(W * H * 4);
  runTransition(d.fa[Math.min(midK, d.fa.length - 1)], d.fb[Math.min(midK, d.fb.length - 1)], disRefD, W, H, (midK / FPS) / TD, transitionExpr({ type: 'dissolve' }));
  const vsDisD = lumaDiff(expMidD, disRefD);
  const xfD = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < xfD.length; i += 4) for (let ch = 0; ch < 3; ch++) xfD[i + ch] = Math.round(d.fa[Math.min(midK, d.fa.length - 1)][i + ch] * 0.5 + d.fb[Math.min(midK, d.fb.length - 1)][i + ch] * 0.5);
  const vsXfD = lumaDiff(expMidD, xfD);
  console.log(`dissimilar export mid-frame: luma vs dissolve ref ${vsDisD.toFixed(2)}, vs crossfade ref ${vsXfD.toFixed(2)}`);
  assert(vsDisD < 12, `fallback export mid-frame matches the dissolve reference in luma (${vsDisD.toFixed(2)})`);
  assert(vsXfD > 25, `fallback export mid-frame is a dither dissolve, not a crossfade (${vsXfD.toFixed(2)})`);

  console.log('morph-cut-export OK — warp survives export, dissimilar pair falls back to dissolve');
})().catch((e) => { console.error(e); process.exit(1); });
