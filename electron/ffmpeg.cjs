// Builds FFmpeg arguments for exporting a project to MP4.
// Pure module (no Electron imports) so it can be tested from plain Node.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
const ffprobePath = require('ffprobe-static').path.replace('app.asar', 'app.asar.unpacked');

const layers = require('./layers.cjs');
const { audioFxFilters, cleanVoiceFilters, cleanVoiceChain, cleanVoiceDuckSpans, duckVolumeExpr, duckSettingsOf, dialogueSpans, standaloneDuckFilters, repairFilters, voiceByIdOf } = require('./audiofx.cjs');
const loudness = require('./loudness.cjs');
const sc = require('./speedcurve.cjs');
const smooth = require('./smoothcut.cjs');
const vk = require('./volkeys.cjs');
const mixer = require('./mixer.cjs');
const { trackExportProc, clearExportPause } = require('./exportPause.cjs');
const { attachExportError } = require('./exportErrors.cjs'); // FB-18 (P1-24): human-readable export failures

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'];

const num = (n) => Number(n).toFixed(3);

// AU-03: every crossfade is equal-power — the outgoing clip fades as
// √(1−x) and the incoming as √x, so their powers sum to 1 through the
// whole overlap and the mix never dips. The curve pair is `squ/squ`,
// not the textbook iqsin/qsin: this ffmpeg evaluates curve1 reversed, and
// its iqsin is 1−sin rather than cos, so iqsin/qsin dips 2.8 dB in the
// first half (measured, scripts/test-audio-fades.mjs) while squ/squ
// measures flat to 0.00 dB. The default tri/tri is linear and dips 3 dB
// at the midpoint. The Smooth Cut blend takes the same path (its effTd
// lands here).
const hex = (c, def = '#ffffff') => (c || def).replace('#', '0x');

// The decode source for a media item: its auto-remux copy when one exists and
// is usable, else the original file. A remux is a stream copy — same streams,
// same timing — in a fast-seeking container (see electron/remux.cjs), so the
// decode-side graphs (video export, audio export) read it transparently; the
// original is never modified and is the fallback the moment the copy is gone.
const mediaMap = (project) => Object.fromEntries((project.media || []).map((m) => [m.id,
  (m && typeof m.remux === 'string' && usableCopyFile(m.remux)) ? { ...m, path: m.remux } : m])
  // P0-01 (#16): only files that exist on disk. A media entry whose file was
  // deleted or moved used to stay in the map, so every graph builder passed
  // the dead path to ffmpeg and the whole export hard-failed with a raw
  // `FFmpeg failed (code 254)` error. Now the existing filters (which already
  // drop clips with no media entry) drop missing-file clips the same way,
  // and missingMediaClips below reports them for the done card. Entries with
  // no filesystem path keep their old behaviour (they are not filtered here).
  .filter(([, m]) => { const p = decodePathOf(m); return typeof p !== 'string' || !p || fs.existsSync(p); }));

// The decode path for a media item: its remux copy when usable, else the original file.
const decodePathOf = (m) => (m && typeof m.remux === 'string' && usableCopyFile(m.remux)) ? m.remux : (m ? m.path : null);

// P0-01 (#16): every clip whose media is gone — entry absent from the
// project, or its file missing from disk — as { track, name }, in timeline
// order, one entry per clip. Same shape as the ZIP export's `missing` list,
// so the done card renders both the same way. Gap clips carry no media.
function missingMediaClips(project) {
  const out = [];
  const byId = Object.fromEntries((project.media || []).map((m) => [m.id, m]));
  const nameOf = (m, c) => (m && (m.name || m.path)) ? String(m.name || path.basename(String(m.path))) : c.id;
  const check = (track, list) => {
    for (const c of list || []) {
      if (c.gap) continue;
      const m = byId[c.mediaId];
      const p = m ? decodePathOf(m) : null;
      if (!m || (typeof p === 'string' && p && !fs.existsSync(p))) out.push({ track, name: nameOf(m, c) });
    }
  };
  check('video', project.videoClips);
  check('audio', project.audioClips);
  check('overlay', project.overlayClips);
  return out;
}

function probe(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file];
    const p = spawn(ffprobePath, args, { windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(err || `ffprobe exited with ${code}`));
      const info = JSON.parse(out);
      const streams = info.streams || [];
      const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
      const a = streams.find((s) => s.codec_type === 'audio');
      const isImage = IMAGE_EXT.includes(ext) && !a;
      // Phones store portrait videos as landscape frames plus a rotation (display matrix): FFmpeg and the player
      // show them turned, so the size we use is the turned one.
      const rotation = v ? Math.round(Number((v.side_data_list || []).find((d) => d.rotation !== undefined)?.rotation ?? (v.tags && v.tags.rotate) ?? 0)) : 0;
      const turned = Math.abs(rotation) % 180 === 90;
      // HDR video (iPhone HLG / Dolby Vision, PQ): converted to normal (SDR) colors wherever we decode it.
      const hdr = !!v && ['arib-std-b67', 'smpte2084'].includes(v.color_transfer);
      resolve({
        type: isImage ? 'image' : v ? 'video' : 'audio',
        duration: isImage ? 0 : parseFloat(info.format && info.format.duration) || 0,
        hasVideo: !!v,
        hasAudio: !!a,
        // Frame rate: the rounded value is the UI number (29.97 -> 30), but the
        // exact rational, the exact float and the source timebase are kept
        // alongside it — the enhancer and the export need the true rate, and a
        // rounded 30 hides both 29.97 and a variable-rate source. VFR is the
        // standard cheap signal: average rate diverging from the nominal rate
        // (r_frame_rate) by more than 2% — a phone screen recording or a
        // -vsync vfr file reports e.g. avg 5.89 against r_frame 30, while a
        // constant-rate file reports the two equal. Near-CFR VFR (avg within
        // 2% of nominal) is NOT caught by this — that needs frame-level PTS
        // analysis, which probe() deliberately does not do on every import.
        fps: v ? Math.round((() => { const r = String(v.avg_frame_rate || v.r_frame_rate || '0/1').split('/'); return (parseFloat(r[0]) || 0) / (parseFloat(r[1]) || 1); })()) : 0,
        fpsRational: v ? String(v.avg_frame_rate || v.r_frame_rate || '') : '',
        fpsExact: v ? (() => { const r = String(v.avg_frame_rate || v.r_frame_rate || '0/1').split('/'); const n = parseFloat(r[0]) || 0; const d = parseFloat(r[1]) || 1; return d ? n / d : 0; })() : 0,
        rFrameRate: v ? (() => { const r = String(v.r_frame_rate || '0/1').split('/'); const n = parseFloat(r[0]) || 0; const d = parseFloat(r[1]) || 1; return d ? n / d : 0; })() : 0,
        timeBase: v ? String(v.time_base || '') : '',
        vfr: v ? (() => {
          const avg = (() => { const r = String(v.avg_frame_rate || '0/1').split('/'); const n = parseFloat(r[0]) || 0; const d = parseFloat(r[1]) || 1; return d ? n / d : 0; })();
          const nom = (() => { const r = String(v.r_frame_rate || '0/1').split('/'); const n = parseFloat(r[0]) || 0; const d = parseFloat(r[1]) || 1; return d ? n / d : 0; })();
          return avg > 0 && nom > 0 && Math.abs(avg - nom) / Math.max(avg, nom) > 0.02;
        })() : false,
        width: v ? (turned ? v.height : v.width) : 0,
        height: v ? (turned ? v.width : v.height) : 0,
        rotation,
        hdr,
        // The source's colour description (Sprint 6): the export tags everything
        // BT.709, so a non-709 source must be CONVERTED, not just retagged — see
        // colorFix below. Absent when the file carries no tags.
        colorSpace: v ? v.color_space || '' : '',
        colorPrimaries: v ? v.color_primaries || '' : '',
        colorTransfer: v ? v.color_transfer || '' : '',
        colorRange: v ? v.color_range || '' : '',
        // What the player needs to know to decide on a preview proxy.
        container: (info.format && info.format.format_name) || '',
        vcodec: v ? v.codec_name : '',
        acodec: a ? a.codec_name : '',
        pixFmt: v ? v.pix_fmt : '',
        profile: v ? v.profile || '' : '',
        // Audio channel count: mono sources get a unity dual-mono pan in the export chains
        // (see monoUp below); media probed before this field existed reads as undefined and
        // simply keeps the old upmix behaviour.
        channels: a ? a.channels || 0 : 0,
      });
    });
  });
}

// Timeline length of a clip: the speed sampler's duration — the curve integral
// for a ramped clip, (out - in) / speed for a constant one (see speedcurve.cjs).
const clipLen = (c) => sc.clipDuration(c);

// HDR (HLG or PQ, BT.2020) to normal BT.709 colors: to linear light, BT.709 primaries, Hable tone curve. Without it
// the picture comes out pale and yellowish, because every later step reads the HDR values as normal ones.
const TONEMAP = 'zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';
const toSdr = (m) => (m && m.hdr ? `,${TONEMAP}` : '');

const { HDR_TRC, toHdr } = require('./hdr.cjs');

// Non-BT.709 SDR sources (Sprint 6, the colour parity row): the output stage tags
// every export BT.709 unconditionally. Before this helper existed, a BT.601 / BT.470 /
// BT.2020-transfer source was decoded with its own matrix and then simply LABELLED
// 709 — every player then decoded it with the wrong matrix and the colours shifted
// (a 601 red reads several percent off in 709). colorFix converts the picture to true
// BT.709 at decode time (the same point where HDR is tonemapped), so the tag the
// output writes is finally true. Conservative by design: it fires only when probe
// captured a colour description that is fully characterised and mappable to the
// colorspace filter's vocabulary; an untagged or partly-unknown source is left
// exactly as before (decoders assume 601/709 by resolution, as they always have).
const CS_SPACE = { bt470: 'bt470', bt470bg: 'bt470bg', smpte170m: 'smpte170m', smpte240m: 'smpte240m', fcc: 'fcc', 'bt2020nc': 'bt2020ncl', 'bt2020c': 'bt2020cl' };
const CS_PRIM = new Set(['bt470m', 'bt470bg', 'smpte170m', 'smpte240m', 'film', 'bt2020', 'smpte428', 'smpte431', 'smpte432', 'ebu3213', 'jedec-p22']);
const CS_TRC = new Set(['gamma22', 'gamma28', 'smpte170m', 'smpte240m', 'linear', 'log100', 'log316', 'iec61966-2-4', 'bt1361e', 'iec61966-2-1', 'bt2020-10', 'bt2020-12', 'smpte428']);
function colorFix(m) {
  if (!m || m.hdr) return '';
  const cs = m.colorSpace || '';
  const cp = m.colorPrimaries || '';
  const ct = m.colorTransfer || '';
  if (cs === 'unknown' || cp === 'unknown' || ct === 'unknown') return '';
  const off = (v) => !!v && v !== 'bt709';
  if (!off(cs) && !off(cp) && !off(ct)) return '';
  if (off(cs) && !CS_SPACE[cs]) return '';
  if (off(cp) && !CS_PRIM.has(cp)) return '';
  if (off(ct) && !CS_TRC.has(ct)) return '';
  // EVERY input component is pinned, not just the non-709 ones: a file may tag only
  // its matrix (smptebars media probes as space=bt470bg with primaries/transfer
  // absent) while its frames carry primaries=unknown — and the colorspace filter
  // REFUSES unknown frame props ("Unsupported input primaries 2"), killing the
  // whole export. Components the source does not claim are pinned to BT.709, the
  // assumption the rest of the pipeline already makes for untagged material.
  const parts = ['all=bt709',
    `ispace=${off(cs) ? CS_SPACE[cs] : 'bt709'}`,
    `iprimaries=${off(cp) ? cp : 'bt709'}`,
    `itrc=${off(ct) ? ct : 'bt709'}`,
    `irange=${m.colorRange === 'pc' ? 'pc' : 'tv'}`,
    'range=tv'];
  return `,colorspace=${parts.join(':')}`;
}

// Where a chain may apply colorFix: AFTER its last scale, never before it. Measured
// on the bundled FFmpeg: a scale filter placed after the conversion silently undoes
// it (swscale re-derives its matrix from the stream's ORIGINAL colour props, so the
// converted values are reinterpreted back — a converted export landed 11.3 mean abs
// from the reference instead of 0.6). Scale-then-convert is exact. Every chain below
// therefore converts as its last colour step: clipVideoFilters on the plain path,
// and the end of the YUV chain in layers.buildLayer on the layered path (before its
// format=rgba step; everything past that is RGBA and composite() re-encodes with an
// explicit BT.709 matrix). The fx-pass decoder needs none: it outputs RGBA frames
// decoded following the source's own props, which is the same correct picture.
// A clip carrying a pre-rendered override is exempt: the fx-pass decoder already
// converted its frames at decode time, so converting again would double-apply.
const colorFixFor = (clip, m) => (clip && clip.videoOverride ? '' : colorFix(m));

function transitionDur(clips, i) {
  const t = clips[i] && clips[i].transition;
  if (!t || i === 0 || t.type === 'none') return 0;
  return Math.max(0, Math.min(t.duration, clipLen(clips[i]) / 2, clipLen(clips[i - 1]) / 2));
}

// Per-transition audio fade (FB-13, P1-10): clip.transition.audioFade =
// { mode: 'auto' | 'custom' | 'off', duration }. auto (or absent) is the
// old behaviour — acrossfade over the video overlap. custom crossfades
// over its own duration, clamped to half of each clip. off is a hard cut
// at the overlap midpoint: A trimmed to the midpoint, B trimmed from it,
// then concat — a plain concat would drift the audio by the overlap after
// the join, and the cut sits where the picture is mid-blend.
function normalizeAudioFade(af) {
  if (!af || typeof af !== 'object') return { mode: 'auto', duration: 0.5 };
  const mode = ['auto', 'custom', 'off'].includes(af.mode) ? af.mode : 'auto';
  const duration = Math.max(0, Number(af.duration) || 0);
  return { mode, duration: mode === 'custom' ? Math.max(0.1, duration || 0.5) : duration };
}
function audioJoinFilters(ca, ai, i, tr, overlap, lenPrev, lenNext, end) {
  const af = normalizeAudioFade(tr && tr.audioFade);
  if (af.mode === 'off' && overlap > 0) {
    const cut = end - overlap / 2;
    return [
      `[${ca}]atrim=start=0:end=${num(cut)},asetpts=PTS-STARTPTS[cutA${i}]`,
      `[${ai}]atrim=start=${num(overlap / 2)},asetpts=PTS-STARTPTS[cutB${i}]`,
      `[cutA${i}][cutB${i}]concat=n=2:v=0:a=1[ja${i}]`,
    ];
  }
  const dur = af.mode === 'custom'
    ? // The fade cannot outlast the video overlap: the join's total is
      // L1 + L2 - overlap, and a longer audio crossfade would either
      // drift the audio past the picture or need material past the
      // clips' ends. So custom clamps to the overlap first, then halves.
      Math.max(0, Math.min(af.duration, overlap, lenPrev / 2, lenNext / 2))
    : overlap;
  if (af.mode === 'custom' && dur > 0 && dur < overlap) {
    // A shorter fade is centred on the video blend's midpoint (the edit
    // point): A trimmed to midpoint + dur/2, B trimmed from midpoint -
    // dur/2, then acrossfade. Without the trims the join would total
    // L1 + L2 - dur and drift the audio past the picture by overlap - dur.
    return [
      `[${ca}]atrim=start=0:end=${num(end - overlap / 2 + dur / 2)},asetpts=PTS-STARTPTS[preA${i}]`,
      `[${ai}]atrim=start=${num(overlap / 2 - dur / 2)},asetpts=PTS-STARTPTS[preB${i}]`,
      `[preA${i}][preB${i}]acrossfade=d=${num(dur)}:${AUDIO_XFADE_CURVE}[ja${i}]`,
    ];
  }
  return dur > 0 ? [audioCrossfade(ca, ai, dur, `ja${i}`)] : [`[${ca}][${ai}]concat=n=2:v=0:a=1[ja${i}]`];
}

// Equal-power crossfade (FB-09, P1-18; curve AU-03): acrossfade's default
// triangular curve dips -2.9 dB at the midpoint of two uncorrelated tracks
// (measured 44.1 and 48 kHz). The pair is squ/squ — the outgoing as
// sqrt(1-x) and the incoming as sqrt(x), so their powers sum to 1 through
// the whole overlap and the mix never dips — not the textbook iqsin/qsin:
// this ffmpeg evaluates curve1 reversed, and its iqsin is 1-sin rather
// than cos, so iqsin/qsin dips 2.8 dB in the first half (measured,
// scripts/test-audio-fades.mjs) while squ/squ measures flat to 0.00 dB.
// 'exp' is NOT equal power — it drops -46 dB mid-fade — and 'log' bumps
// +2.5 dB and clips. Every join in this file goes through here so the
// curve can never silently revert to the default at one site.
const AUDIO_XFADE_CURVE = 'c1=squ:c2=squ';
const audioCrossfade = (a, b, d, out) => `[${a}][${b}]acrossfade=d=${num(d)}:${AUDIO_XFADE_CURVE}[${out}]`;

function atempo(speed) {
  const out = [];
  let s = speed;
  while (s > 2) { out.push('atempo=2'); s /= 2; }
  while (s < 0.5) { out.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-3) out.push(`atempo=${s.toFixed(4)}`);
  return out;
}

// P2-01 rate-stretch pitch mode: 'preserve' (default) retimes with atempo
// (pitch unchanged); 'shift' resamples (asetrate), so the pitch follows the
// speed like varispeed. Speed curves always use atempo (curveAudioGraph).
function speedAudio(clip) {
  const sp = clip.speed || 1;
  if (clip.ratePitch === 'shift' && Math.abs(sp - 1) > 1e-3) {
    return [`asetrate=${Math.round(48000 * sp)}`, 'aresample=48000'];
  }
  return atempo(sp);
}

const f6 = (n) => String(Math.round(n * 1e6) / 1e6);

// The setpts for a speed-ramped clip's picture, built from the shared sampler's
// segments (speedcurve.cjs): within segment k the input time T (seconds from the
// window start) maps to tlStart + (T - srcOff) / speed — one piecewise setpts in
// the same chain position the constant path's setpts=(PTS-STARTPTS)/speed holds,
// so the plain and layered paths consume it identically. A single-segment curve
// degenerates to the constant form.
function speedSetpts(clip) {
  const segs = sc.curveSegments(clip);
  if (segs.length === 1) return `setpts=(PTS-STARTPTS)/${f6(segs[0].speed)}`;
  const T = '((PTS-STARTPTS)*TB)';
  let tl = 0;
  const parts = segs.map((s) => {
    const p = { ...s, tlStart: tl };
    tl += s.tlDur;
    return p;
  });
  let expr = null;
  for (let k = parts.length - 1; k >= 0; k--) {
    const s = parts[k];
    const seg = `(${f6(s.tlStart)}+(${T}-${f6(s.srcOff)})/${f6(s.speed)})`;
    expr = k === parts.length - 1 ? seg : `if(lt(${T},${f6(parts[k + 1].srcOff)}),${seg},${expr})`;
  }
  return `setpts='(${expr})/TB'`;
}

// Retimes a clip's sound along its speed curve: the (already source-trimmed)
// stream `head` is split per sampled segment, each piece is trimmed to the
// segment's source window and atempo'd by the segment's exact average rate, and
// the pieces concat back in order before `tail` runs — the audio twin of
// speedSetpts, from the same segments, so sound and picture land together.
//
// WSOLA (atempo) is not length-faithful on short inputs — a 0.075 s segment can
// come back ~20% short, and with dozens of segments the sound would drift
// audibly off the picture mid-clip. So each piece is trimmed with a tail of
// extra source (SEG_TAIL, clamped to the window) for the stretcher to work
// with, and its output is cut to the segment's exact timeline length: segment
// boundaries land where the sampler puts them, and lengths cannot accumulate
// error. (Measured: per-segment boundaries within ~0.04 s — one stretcher
// grain — and the total exact; scripts/test-speed-curve.mjs proves it.)
const SEG_TAIL = 0.25;
function curveAudioGraph(clip, head, tail, outLabel, tag) {
  const segs = sc.curveSegments(clip);
  if (segs.length === 1) {
    return [head, ...atempo(segs[0].speed), ...tail].join(',') + `[${outLabel}]`;
  }
  const span = sc.spanOf(clip);
  const parts = [`${head},asplit=${segs.length}${segs.map((_, k) => `[${tag}s${k}]`).join('')}`];
  segs.forEach((s, k) => {
    const tempo = atempo(s.speed);
    const end = Math.min(span, s.srcOff + s.srcDur + SEG_TAIL);
    parts.push(`[${tag}s${k}]atrim=start=${num(s.srcOff)}:end=${num(end)},asetpts=PTS-STARTPTS${tempo.length ? `,${tempo.join(',')}` : ''},atrim=end=${num(s.tlDur)},asetpts=PTS-STARTPTS[${tag}p${k}]`);
  });
  parts.push(`${segs.map((_, k) => `[${tag}p${k}]`).join('')}concat=n=${segs.length}:v=0:a=1[${tag}r]`);
  parts.push(tail.length ? `[${tag}r]${tail.join(',')}[${outLabel}]` : `[${tag}r]anull[${outLabel}]`);
  return parts.join(';');
}

// The look of a clip (Adjust settings, GPU filter, grade, effects) is painted by the
// effects pass, never here: since the Sprint 6 unification there is exactly one engine
// for it (src/fx/apply.js pixelPasses — src/fx/adjust.js for clip.adjust, TRACK_CLASSIC
// for the classic effects), and a clip that carries any of it reaches this graph with a
// pre-rendered override file. (The FFmpeg look-filter approximations that used to live
// here — eq with halved brightness, boxblur, noise, vignette — disagreed with both the
// preview and the shader forms and were deleted.)

// The plain picture path: fit in the frame over the background color, look, constant frame rate.
// P2-07 Time interpolation (per-clip clip.interp: 'sample' | 'blend' | 'flow').
// Sample is the historical behaviour (the fps filter duplicates frames). Blend
// and flow REPLACE the fps filter with minterpolate at the project rate, so the
// retimed stream is interpolated rather than duplicated. Only for slowed video:
// at full speed or faster there is nothing to interpolate, and stills / fx-baked
// overrides are already at the project rate. Relative export cost (shown in the
// UI): sample 1x, blend ~2x, flow ~8x and CPU-only.
// Exported for scripts/test-p2b-interp.mjs.
const INTERP_COST = { sample: 1, blend: 2, flow: 8 };
function interpFilter(clip, m, fps) {
  const mode = clip.interp || 'sample';
  if (mode === 'sample' || !m || m.type === 'image' || clip.videoOverride) return `fps=${fps}`;
  const speeds = sc.hasCurve(clip)
    ? [...(clip.speedCurve.points || []).map((p) => p.speed ?? 1), clip.speed || 1]
    : [clip.speed || 1];
  if (Math.min(...speeds) >= 1) return `fps=${fps}`;
  if (mode === 'blend') return `minterpolate=fps=${fps}:mi_mode=blend`;
  if (mode === 'flow') return `minterpolate=fps=${fps}:mi_mode=mci:me_mode=bidir:vsbmc=1:mb_size=8:search_param=32`;
  return `fps=${fps}`;
}

function clipVideoFilters(clip, m, W, H, fps, background, hdr = null) {
  const fix = hdr ? (m && (m.type === 'image' || clip.videoOverride) ? toHdr(m, hdr) : '') : colorFixFor(clip, m);
  return [
    `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${hex(background, '#000000')}`,
    'setsar=1',
    // Non-709 sources convert HERE — after the last scale (see colorFixFor).
    ...(fix ? [fix.slice(1)] : []),
    interpFilter(clip, m, fps),
    `format=${hdr ? 'yuv420p10le' : 'yuv420p'}`,
  ].join(',');
}


// The Voice Enhancer's cached file for a clip, when it is on AND was rendered for the clip's
// current range (a re-trim makes the stored render stale: it is ignored until re-run, exactly
// like the preview). The file covers [clip.in, clip.out], so chains read it from 0.
function enhancePathOf(clip) {
  const e = clip && clip.enhance;
  if (!e || !e.on || !e.path) return null;
  if (Math.abs((e.from ?? -1) - (clip.in || 0)) > 0.02 || Math.abs((e.to ?? -1) - (clip.out ?? -1)) > 0.02) return null;
  return fs.existsSync(e.path) ? e.path : null;
}

// The AudioFx preview derivative for a clip (electron/audiofxrender.cjs), when it was rendered
// for the clip's current range, from its current sound source (the enhanced render when Voice
// Enhance replaces the sound, else the media file), with the chain the clip's current audioFx
// produce. The file already carries the chain's output, so a chain that consumes it must NOT
// apply audioFxFilters again — that is what makes preview and export the same render. Stale
// on any fx / trim / source change: chains then fall back to applying the filters inline.
function audioFxPathOf(clip, m) {
  const r = clip && clip.audioFxRender;
  if (!r || !r.path || !r.chain) return null;
  if (cleanVoiceChain(clip.cleanVoice, clip.audioFx, clip.repair) !== r.chain) return null;
  if (Math.abs((r.from ?? -1) - (clip.in || 0)) > 0.02 || Math.abs((r.to ?? -1) - (clip.out ?? -1)) > 0.02) return null;
  const src = enhancePathOf(clip) || (m && m.path);
  if (src && r.src !== src) return null;
  return fs.existsSync(r.path) ? r.path : null;
}

// Audio stream [a<i>] for main-track clip i (silence for photos, muted or silent clips).
// enhIdx: input index of the clip's enhanced file, when the Voice Enhancer replaces its sound.
// swresample's default mono->stereo upmix renders a mono source 3.01 dB down per channel,
// while the browser plays (and the level meter reads) the same clip at its true level on both
// channels — measured on the app's own mix render (a -1.00 dBFS mono voice rendered at
// -4.01 dBFS). Pan mono sources to dual-mono at unity so the export carries the level the
// preview presented. Only for the media file itself: enhanced renders are always stereo
// (electron/enhance.cjs writes -ac 2), so the enhanced path never takes the pan.
const monoUp = (m, enhanced) => (!enhanced && m && m.channels === 1 ? 'pan=stereo|c0=c0|c1=c0' : null);

// A clip's fade envelope as afade filters (Sprint 10): the same linear ramps
// the preview applies through volKeys.fadeEnv — afade's default curve is the
// same triangle. Fades live on audio-track clips AND on picture clips (a
// video clip's own sound), one model for both; they multiply AFTER the
// volume / volume-keyframe stage (the gain stack in src/volKeys.js).
function audioFades(clip, len) {
  const out = [];
  if (clip.fadeIn > 0) out.push(`afade=t=in:st=0:d=${num(Math.min(clip.fadeIn, len))}`);
  if (clip.fadeOut > 0) out.push(`afade=t=out:st=${num(Math.max(0, len - clip.fadeOut))}:d=${num(Math.min(clip.fadeOut, len))}`);
  return out;
}

// Frame hold audio (P1-50), the sound twin of the pictureSource hold: the
// clip's own sound skips the held source span and stays silent while the
// picture is frozen, so picture and audio stay in sync. `base` is the audio
// input label without brackets (already at the clip's in-point when
// startOff is 0 — every seeked / pre-trimmed input — or clip.in for an
// unseeked one), `span` the source window length, `sp` the constant speed.
// Returns { pre, label }: pre are filter descriptions to push before the
// chain, label the stream to continue from. Segments are normalized to
// 48 kHz stereo float here, so the mono-upmix is skipped downstream. The
// silence segment is hold.duration * sp long in SOURCE time: the chain's
// atempo divides it back to the hold duration in timeline time, like the
// A and C segments around it. Null when the clip has no valid hold.
function holdAudioParts(base, startOff, span, hold, sp, tag) {
  if (!hold) return null;
  const srcAt = hold.at * sp;
  const skipSrc = hold.duration * sp;
  const pre = [];
  const labels = [];
  if (srcAt > 1e-9) {
    pre.push(`[${base}]atrim=start=${num(startOff)}:end=${num(startOff + srcAt)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[${tag}A]`);
    labels.push(`[${tag}A]`);
  }
  pre.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${num(hold.duration * sp)},aformat=sample_fmts=fltp:channel_layouts=stereo[${tag}B]`);
  labels.push(`[${tag}B]`);
  if (srcAt + skipSrc < span - 1e-9) {
    pre.push(`[${base}]atrim=start=${num(startOff + srcAt + skipSrc)}:end=${num(startOff + span)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[${tag}C]`);
    labels.push(`[${tag}C]`);
  }
  if (labels.length === 1) return { pre, label: `${tag}B` };
  pre.push(`${labels.join('')}concat=n=${labels.length}:v=0:a=1[${tag}]`);
  return { pre, label: tag };
}

function clipAudioFilter(clip, m, idx, i, enhIdx = -1, seeked = false, fxIdx = -1, project = null) {
  const len = clipLen(clip);
  if (clip.gap || !m || m.type === 'image' || !m.hasAudio || clip.muted) {
    return `anullsrc=r=48000:cl=stereo,atrim=duration=${num(len)},aformat=sample_fmts=fltp[a${i}]`;
  }
  // Perf B1 (2026-11-01): when the caller input-seeked this clip's input (-ss before -i),
  // the stream already starts at clip.in, so the trim runs from 0 — identical samples,
  // without decoding the skipped prefix. The enhanced branch is pre-trimmed by the
  // enhance render and always reads from 0. The AudioFx derivative (fxIdx) is likewise
  // pre-trimmed and pre-effected: it replaces the source AND the inline audioFxFilters.
  const src = fxIdx >= 0
    ? [`[${fxIdx}:a]atrim=start=0:end=${num(clip.out - clip.in)}`, 'asetpts=PTS-STARTPTS']
    : enhIdx >= 0
      ? [`[${enhIdx}:a]atrim=start=0:end=${num(clip.out - clip.in)}`, 'asetpts=PTS-STARTPTS']
      : seeked
        ? [`[${idx}:a]atrim=start=0:end=${num(clip.out - clip.in)}`, 'asetpts=PTS-STARTPTS']
        : [`[${idx}:a]atrim=start=${num(clip.in)}:end=${num(clip.out)}`, 'asetpts=PTS-STARTPTS'];
  const up = fxIdx >= 0 ? null : monoUp(m, enhIdx >= 0);
  // P2-23: the clip's bus gain rides in the tail (after volume keys + fades),
  // so a bus level applies whether the sound came from the media, the
  // enhancer or an AudioFx derivative.
  const busVol = project ? mixer.busVolumeFilter(project, clip, 'video') : null;
  const tail = [
    ...vk.volChainFor(clip, len), ...audioFades(clip, len), ...(busVol ? [busVol] : []), 'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo',
    // Clean Voice runs before the clip's own audioFx (cleanup first, the
    // user's EQ/comp after) and never touches volume, fades or enhance.
    // Repair runs first of all (fix the source, then clean up, then shape).
    ...(fxIdx >= 0 ? [] : repairFilters(clip.repair)),
    ...(fxIdx >= 0 ? [] : cleanVoiceFilters(clip.cleanVoice)),
    ...(fxIdx >= 0 ? [] : audioFxFilters(clip.audioFx)),
    `apad=whole_dur=${num(len)}`, `atrim=duration=${num(len)}`];
  // A speed curve retimes the sound segment by segment (the presented stream
  // starts at the clip's in-point in every branch above, so the sampler's
  // source offsets address it directly); anything else keeps the one atempo.
  // Frame hold (P1-50): the sound skips the held span and is silent while
  // the picture is frozen. A curve makes the hold invalid (validFrameHold),
  // so this only runs on the constant path.
  const hold = sc.validFrameHold(clip);
  if (hold && !sc.hasCurve(clip)) {
    const base = fxIdx >= 0 ? `${fxIdx}:a` : enhIdx >= 0 ? `${enhIdx}:a` : `${idx}:a`;
    const startOff = (fxIdx >= 0 || enhIdx >= 0 || seeked) ? 0 : (clip.in || 0);
    const parts = holdAudioParts(base, startOff, clip.out - clip.in, hold, clip.speed || 1, `fh${i}`);
    if (parts) {
      return [...parts.pre, `[${parts.label}]${[...speedAudio(clip), ...tail].join(',')}[a${i}]`].join(';');
    }
  }
  if (sc.hasCurve(clip)) {
    return curveAudioGraph(clip, [...src, ...(up ? [up] : [])].join(','), tail, `a${i}`, `ca${i}`);
  }
  return [...src, ...(up ? [up] : []), ...speedAudio(clip), ...tail].join(',') + `[a${i}]`;
}

// Main-track audio only (no music), as 16 kHz mono WAV — the input for auto captions.
// Audio to transcribe, as 16 kHz mono WAV. source: 'all' (video clips + audio track), 'video' or 'audio'.
// Every piece is placed at its timeline position, so caption times match the timeline.
function buildTimelineAudioArgs(project, outWav, source = 'all') {
  const mediaById = mediaMap(project);
  const inputs = [];
  const filters = [];
  const mix = [];
  let n = 0;

  const clips = source === 'audio' ? [] : project.videoClips.filter((c) => c.gap || mediaById[c.mediaId]);
  if (clips.length) {
    clips.forEach((clip, i) => {
      const m = mediaById[clip.mediaId];
      let idx = -1;
      if (m && m.type !== 'image' && m.hasAudio && !clip.muted) {
        inputs.push('-ss', num(clip.in), '-i', m.path); // B1: input seeking, as in exports
        idx = n++;
      }
      filters.push(clipAudioFilter(clip, m, idx, i, -1, idx >= 0));
    });
    let ca = 'a0';
    let end = clipLen(clips[0]);
    for (let i = 1; i < clips.length; i++) {
      const td = transitionDur(clips, i);
      filters.push(...audioJoinFilters(ca, `a${i}`, i, clips[i].transition, td, clipLen(clips[i - 1]), clipLen(clips[i]), end));
      ca = `ja${i}`;
      end = end - td + clipLen(clips[i]);
    }
    filters.push(`[${ca}]aresample=16000,aformat=sample_fmts=fltp:channel_layouts=mono[main]`);
    mix.push('[main]');
  }

  // Checklist #19: a muted audio clip contributes nothing here either —
  // transcription / silence detection must not hear a clip the user silenced.
  const extra = source === 'video' ? [] : project.audioClips.filter((c) => mediaById[c.mediaId] && mediaById[c.mediaId].hasAudio && !c.muted);
  extra.forEach((c, j) => {
    inputs.push('-ss', num(c.in), '-i', mediaById[c.mediaId].path);
    const idx = n++;
    const ms = Math.round(c.start * 1000);
    const alen = clipLen(c);
    filters.push(sc.hasCurve(c)
      ? curveAudioGraph(c, `[${idx}:a]atrim=start=0:end=${num(c.out - c.in)},asetpts=PTS-STARTPTS`,
        [...vk.volChainFor(c, alen), ...audioFades(c, alen), 'aresample=16000', 'aformat=sample_fmts=fltp:channel_layouts=mono', `adelay=${ms}:all=1`], `x${j}`, `tx${j}`)
      : `[${idx}:a]atrim=start=0:end=${num(c.out - c.in)},asetpts=PTS-STARTPTS,${[...atempo(c.speed || 1), ...vk.volChainFor(c, alen), ...audioFades(c, alen)].join(',')},` +
        `aresample=16000,aformat=sample_fmts=fltp:channel_layouts=mono,adelay=${ms}:all=1[x${j}]`);
    mix.push(`[x${j}]`);
  });

  if (!mix.length) {
    throw new Error(source === 'audio'
      ? 'The Audio track is empty. Add an audio clip first.'
      : 'Nothing to transcribe: no clip with sound on the timeline.');
  }
  if (mix.length === 1) filters.push(`${mix[0]}aformat=sample_fmts=s16:channel_layouts=mono[out]`);
  else filters.push(`${mix.join('')}amix=inputs=${mix.length}:duration=longest:normalize=0,aformat=sample_fmts=s16:channel_layouts=mono[out]`);
  return ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-ar', '16000', outWav];
}

function renderTimelineAudio(project, outWav, source) {
  return new Promise((resolve, reject) => {
    let args;
    try {
      args = buildTimelineAudioArgs(project, outWav, source);
    } catch (e) {
      return reject(e);
    }
    const p = spawn(ffmpegPath, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(outWav) : reject(new Error(err.slice(-3000)))));
  });
}

const renderMainAudio = (project, outWav) => renderTimelineAudio(project, outWav, 'video');

// Silent stretches of the main track's sound, as [{ start, end }] in timeline seconds.
// minDur: shortest silence to report; noiseDb: level below which sound counts as silence.
async function detectSilences(project, { minDur = 0.6, noiseDb = -35, source = 'video' } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-sil-'));
  try {
    const wav = await renderTimelineAudio(project, path.join(tmp, 'a.wav'), source);
    const log = await new Promise((resolve, reject) => {
      const p = spawn(ffmpegPath, ['-hide_banner', '-nostats', '-i', wav, '-af', `silencedetect=noise=${noiseDb}dB:d=${minDur}`, '-f', 'null', '-'], { windowsHide: true });
      let err = '';
      p.stderr.on('data', (d) => (err += d));
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(err.slice(-1500)))));
    });
    const total = (() => {
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
      return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Infinity;
    })();
    const out = [];
    let open = null;
    for (const line of log.split(/\r?\n/)) {
      const a = /silence_start:\s*(-?[\d.]+)/.exec(line);
      if (a) open = Math.max(0, Number(a[1]));
      const b = /silence_end:\s*([\d.]+)/.exec(line);
      if (b && open !== null) {
        out.push({ start: open, end: Number(b[1]) });
        open = null;
      }
    }
    if (open !== null) out.push({ start: open, end: total }); // silence that lasts until the end
    return out;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// project: { width, height, fps, background, media[], videoClips[], textClips[], audioClips[] }
// Size of a picture fitted inside the W x H frame (even numbers), as the layered path and the effects pass use.
function fitSize(m, W, H) {
  const mw = (m && m.width) || W;
  const mh = (m && m.height) || H;
  const k = Math.min(W / mw, H / mh);
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  return { fw: even(mw * k), fh: even(mh * k) };
}

// Input options for a still picture shown for `len` seconds. "-loop 1" only exists for still image files; a GIF
// (often animated) is read by FFmpeg's GIF reader, which loops with -stream_loop instead (and plays its animation,
// like the player does).
function stillInput(file, fps, len) {
  if (/\.gif$/i.test(file)) return ['-stream_loop', '-1', '-t', num(len), '-i', file];
  return ['-loop', '1', '-framerate', String(fps), '-t', num(len), '-i', file];
}

// A copy of a clip limited to [from, to] seconds of its own timeline (for the frames of a transition).
function narrowClip(clip, m, from, to) {
  const c = { ...clip, transition: null };
  if (clip.gap) return { ...c, in: 0, out: to - from, speed: 1 };
  if (clip.videoOverride) return { ...c, videoOverride: { ...clip.videoOverride, start: clip.videoOverride.start + from, end: clip.videoOverride.start + to } };
  if (m.type === 'image') return { ...c, in: 0, out: to - from, speed: 1 };
  if (sc.hasCurve(clip)) {
    // The narrowed window's edges map through the curve and the copy keeps the
    // window's slice of it, so transition frames show the ramped motion.
    const fromOff = sc.sourceOffsetAt(clip, from);
    const toOff = sc.sourceOffsetAt(clip, to);
    return { ...c, in: clip.in + fromOff, out: clip.in + toOff, speedCurve: sc.sliceCurve(clip, fromOff, toOff) };
  }
  const sp = clip.speed || 1;
  return { ...c, in: clip.in + from * sp, out: clip.in + to * sp };
}

// Adds the picture input of a clip and returns a filter chain prefix "[n:v]trim...," that gives its frames at
// the clip's own timing. clip.videoOverride ({ file, start, end } in timeline seconds) replaces the media by a file
// the animated-effects pass rendered.
// The AI background matte of a clip (Remove BG > Auto removal), trimmed and timed like the clip's picture; the
// label of the stream, or null when the clip has none. The matte is constant frame rate from 0 s in source time.
function matteSource(clip, m, fps, addInput, tag, filters) {
  if (!clip.bgRemove || !m || m.type !== 'video' || !m.matte || !fs.existsSync(m.matte)) return null;
  const idx = addInput(['-ss', num(clip.in), '-i', m.matte]);
  const timing = sc.hasCurve(clip) ? speedSetpts(clip) : `setpts=(PTS-STARTPTS)/${clip.speed || 1}`;
  filters.push(`[${idx}:v]trim=duration=${num(clip.out - clip.in)},${timing},fps=${fps},` +
    `tpad=stop_mode=clone:stop_duration=1[mt${tag}]`);
  return `mt${tag}`;
}

// Timeline start of a main-track clip (same math as the join loop below).
function videoStart(project, id) {
  const clips = project.videoClips || [];
  let start = 0;
  for (let i = 0; i < clips.length; i++) {
    if (clips[i].id === id) return start;
    if (i + 1 < clips.length) start = start + clipLen(clips[i]) - transitionDur(clips, i + 1);
  }
  return 0;
}

// True track matte (P2-12): the picture of another track, rendered as a
// full-frame layer over the target's window, becomes the target's alpha
// (luma mode: its brightness; alpha mode: its own alpha). Returns the label
// of a grayscale stream, or null when the matte cannot be built — the same
// rules as src/trackMatte.js resolveTrackMatte (no nesting, no ramped
// source, the source must start at or before the target). The source is
// sampled at target time minus the start gap, so the tracks stay in sync;
// when the source ends first its last frame is held (tpad clone).
function trackMatteGray(project, clip, targetStart, o) {
  const { mediaById, fps, W, H, len, addInput, filters, tag, hdr } = o;
  const matte = clip.matte;
  if (!matte || !matte.sourceId) return null;
  const src = (project.videoClips || []).find((c) => c.id === matte.sourceId)
    || (project.overlayClips || []).find((c) => c.id === matte.sourceId);
  if (!src || src.id === clip.id || src.matte?.sourceId || src.videoOverride) return null;
  const m = mediaById[src.mediaId];
  if (!m || m.type === 'audio' || m.missing) return null;
  if (sc.hasCurve(src)) return null;
  const isOverlaySrc = (project.overlayClips || []).includes(src);
  const srcStart = isOverlaySrc ? (src.start || 0) : videoStart(project, src.id);
  const fromLocal = targetStart - srcStart;
  if (fromLocal < -1e-6) return null;
  const synthetic = { ...src, in: (src.in || 0) + fromLocal * (src.speed || 1), frameHold: undefined };
  // A frame hold belongs to the source clip's own local time, not to the
  // matte's shifted window — the matte renders the moving picture.
  const srcChain = pictureSource(synthetic, m, len, fps, addInput, hdr || null);
  filters.push(`${srcChain.chain},fps=${fps}[ms${tag}]`);
  const motion = project.motion && project.motion[src.id] ? layers.shiftCurves(project.motion[src.id], fromLocal) : null;
  const layer = layers.buildLayer({
    clip: synthetic, media: m, W, H, fps, len, tag: `tm${tag}`, srcLabel: `ms${tag}`,
    maskIdx: null, decoIdx: null, motion, matteLabel: null, customMaskIdx: null,
  }, { num, hex, colorFixFor: hdr ? () => (m.type === 'image' ? toHdr(m, hdr) : '') : colorFixFor });
  filters.push(...layer.filters);
  const conv = matte.mode === 'luma' ? 'format=gray' : 'alphaextract';
  filters.push(`[${layer.out}]${conv},tpad=stop_mode=clone:stop_duration=1,trim=duration=${num(len)},setpts=PTS-STARTPTS[mg${tag}]`);
  return `mg${tag}`;
}

// P1-50 — frame hold (gap-build Stream B): a clip with frameHold { at, duration }
// renders as pre-roll + one frozen frame + post-roll. `at` is a SOURCE time
// (absolute in the media file); `duration` is TIMELINE seconds. The picture
// freezes while the clip's audio keeps playing (clipAudioFilter is untouched
// — it still spans the whole clip length). The frozen frame is picked with
// select='eq(n,N)' (N = the source frame at `at`, counted from the -ss seek
// point) and looped; pre/post are ordinary trims. Returns the same shape as
// pictureSource so the caller's layered/plain branches work unchanged.
function heldClipChain(clip, m, len, fps, addInput, filters, tag, hdr = null) {
  const fh = clip.frameHold;
  const sp = clip.speed || 1;
  const srcFps = (m.fpsExact || m.fps || fps) || fps;
  const holdLocal = Math.max(0, Math.min(len, (fh.at - (clip.in || 0)) / sp));
  const holdDur = Math.max(0.05, Math.min(fh.duration, len - holdLocal));
  const preLen = holdLocal;
  const postLen = Math.max(0, len - holdLocal - holdDur);
  const frameNo = Math.max(0, Math.round((fh.at - (clip.in || 0)) * srcFps));
  const idx = addInput(['-ss', num(clip.in), '-i', m.path]);
  const sdr = hdr ? toHdr(m, hdr) : toSdr(m);
  const parts = [];
  if (preLen > 0.01) parts.push('pre');
  parts.push('hold');
  if (postLen > 0.01) parts.push('post');
  const lb = { pre: `hp${tag}`, hold: `hh${tag}`, post: `hq${tag}` };
  // Split once; every output is consumed (an unconnected split output fails the graph).
  filters.push(`[${idx}:v]split=${parts.length}${parts.map((k) => `[${lb[k]}]`).join('')}`);
  const outs = [];
  if (parts.includes('pre')) {
    filters.push(`[${lb.pre}]trim=duration=${num(preLen * sp)},setpts=(PTS-STARTPTS)/${sp},fps=${fps}${sdr}[hpre${tag}]`);
    outs.push(`hpre${tag}`);
  }
  filters.push(`[${lb.hold}]select='eq(n\\,${frameNo})',loop=loop=-1:size=1:start=0,trim=duration=${num(holdDur)},setpts=PTS-STARTPTS,fps=${fps}${sdr}[hhold${tag}]`);
  outs.push(`hhold${tag}`);
  if (parts.includes('post')) {
    // The post-roll resumes PAST the skipped span: the hold froze the frame
    // for holdDur timeline seconds, i.e. holdDur*speed source seconds, so the
    // source restarts at fh.at + holdDur*sp (holdSourceOffsetAt's map), not at
    // fh.at. Starting at fh.at replayed the skipped span (test-frame-hold:
    // post-hold frame matched source 2.5 s, not 4.5 s, diff 12.41).
    filters.push(`[${lb.post}]trim=start=${num((fh.at - (clip.in || 0)) + holdDur * sp)}:end=${num((clip.out || 0) - (clip.in || 0))},setpts=(PTS-STARTPTS)/${sp},fps=${fps}${sdr}[hpost${tag}]`);
    outs.push(`hpost${tag}`);
  }
  let label;
  if (outs.length === 1) label = outs[0];
  else {
    filters.push(`[${outs.join('][')}]concat=n=${outs.length}:v=1:a=0[hc${tag}]`);
    label = `hc${tag}`;
  }
  // The chain must be a filter (not a bare label): the callers continue it
  // with `,${...}` — a trailing null pass-through keeps that syntax valid.
  return { idx, chain: `[${label}]null`, own: true, audioSeeked: true };
}

function pictureSource(clip, m, len, fps, addInput, hdr = null) {
  // Perf B1: media inputs are input-seeked (-ss before -i) to the clip's first frame and
  // the trim runs from 0 — the encoder never decodes the skipped prefix (measured at
  // +48% export time for a clip starting 55 min into its source). `audioSeeked` tells
  // the caller whether THIS input also carries the clip's (already seeked) audio.
  if (clip.videoOverride) {
    const o = clip.videoOverride;
    const idx = addInput(['-ss', num(o.start), '-i', o.file]);
    return { idx, chain: `[${idx}:v]trim=duration=${num(o.end - o.start)},setpts=PTS-STARTPTS`, own: false, audioSeeked: false };
  }
  if (m.type === 'image') {
    const idx = addInput(stillInput(m.path, fps, len));
    return { idx, chain: `[${idx}:v]trim=duration=${num(len)},setpts=PTS-STARTPTS`, own: true, audioSeeked: false };
  }
  // Frame hold (P1-50): a constant-speed video clip with a valid hold renders
  // as three segments off the one input-seeked stream — the moving head, one
  // frozen frame looped for the hold duration, the moving tail after the
  // held source span — concat back to the clip's own length. The chain ends
  // on the concat output (or the single freeze segment when the whole clip
  // is the hold) so the caller's interp filter appends to it as usual.
  const hold = sc.validFrameHold(clip);
  if (hold) {
    const idx = addInput(['-ss', num(clip.in), '-i', m.path]);
    const sp = clip.speed || 1;
    const span = clip.out - clip.in;
    const srcAt = hold.at * sp;
    const skipSrc = hold.duration * sp;
    const segs = [];
    const labels = [];
    if (srcAt > 1e-9) {
      segs.push(`[${idx}:v]trim=start=0:end=${num(srcAt)},setpts=(PTS-STARTPTS)/${sp}[fhA]`);
      labels.push('[fhA]');
    }
    // Frozen frame: one frame at the hold point, cloned for the hold
    // duration. tpad (not loop): loop=-1 never signals EOF, so the concat
    // downstream waits forever — tpad clones a finite number of frames
    // and terminates. No setpts before tpad: normalizing the single
    // frame's PTS to 0 makes tpad lose its frame duration and clone
    // nothing (measured: 1 frame out). The trailing trim reads the
    // ORIGINAL timestamps (hold point .. hold point + duration) and the
    // setpts after it retimes the 60 frozen frames to 0..duration.
    segs.push(`[${idx}:v]trim=start=${num(srcAt)}:end=${num(srcAt + 1 / fps)},tpad=stop_mode=clone:stop_duration=${num(hold.duration)},trim=start=${num(srcAt)}:end=${num(srcAt + hold.duration)},setpts=N/FRAME_RATE/TB[fhB]`);
    labels.push('[fhB]');
    if (srcAt + skipSrc < span - 1e-9) {
      segs.push(`[${idx}:v]trim=start=${num(srcAt + skipSrc)}:end=${num(span)},setpts=(PTS-STARTPTS)/${sp}[fhC]`);
      labels.push('[fhC]');
    }
    const chain = labels.length === 1
      ? segs[0].replace(/\[fhB\]$/, '') + toSdr(m)
      : `${segs.join(';')};${labels.join('')}concat=n=${labels.length}:v=1:a=0,fps=${fps}${toSdr(m)}`;
    return { idx, chain, own: true, audioSeeked: true };
  }
  const idx = addInput(['-ss', num(clip.in), '-i', m.path]);
  const timing = sc.hasCurve(clip) ? speedSetpts(clip) : `setpts=(PTS-STARTPTS)/${clip.speed || 1}`;
  // FX-06: HDR export converts here (zscale, like the SDR tonemap it replaces);
  // SDR pictures that never pass this branch (images, overrides) convert at
  // the fix slot instead — see colorFixForHdr / clipVideoFilters.
  return { idx, chain: `[${idx}:v]trim=duration=${num(clip.out - clip.in)},${timing}${hdr ? toHdr(m, hdr) : toSdr(m)}`, own: true, audioSeeked: true };
}

// opts.raw: only the main track's picture, as raw RGBA frames on stdout (frames for the effects pass).
// opts.encoder: H.264 encoder (see pickEncoder); libx264 when not given.
function buildExportArgs(project, outFile, opts = {}) {
  const { width: W, height: H, fps } = project;
  const bg = project.background || '#000000';
  const eff = effectiveExport(project);
  // FX-06: HDR export (never the raw effects pass — it feeds SDR RGBA frames).
  const hdr = eff.hdr !== 'off' && !opts.raw ? eff.hdr : null;
  if (hdr && !hasLibx265()) throw new Error('HDR export needs H.265 (libx265), which this FFmpeg build does not have — pick SDR export instead.');
  // In HDR mode every video chain ends in 10-bit BT.2020 instead of 8-bit BT.709.
  const fmt = hdr ? 'yuv420p10le' : 'yuv420p';
  // The colour conversion for the layered/plain paths: in HDR mode the
  // decode-time toHdr already normalised video sources, so only SDR pictures
  // that never pass pictureSource (images, pre-rendered overrides) still
  // need one — at the same slot colorFix used (after the last scale).
  const colorFixForHdr = (clip, m) => (hdr
    ? (m && (m.type === 'image' || (clip && clip.videoOverride)) ? toHdr(m, hdr) : '')
    : colorFixFor(clip, m));
  // A GIF maps no audio, so its graph builds none: an audio branch that is built but
  // never consumed fails FFmpeg's graph binding (and trips a scheduler assertion in
  // this FFmpeg build when sunk instead). Video construction is identical either way.
  const wantAudio = eff.format !== 'gif';
  const mediaById = mediaMap(project);
  const inputs = [];
  const filters = [];
  let nInputs = 0;
  const addInput = (args) => { inputs.push(...args); return nInputs++; };

  const clips = project.videoClips.filter((c) => c.gap || mediaById[c.mediaId]);
  // P0-01 (#16): clips whose media is gone are skipped, not fatal — the
  // graph is built from the filtered list, and `skipped` travels back to
  // the done card. A project with nothing left to show still refuses, but
  // plainly, not with a raw ffmpeg error.
  const skipped = missingMediaClips(project);
  if (clips.length === 0) {
    if (skipped.some((s) => s.track === 'video')) throw new Error('All video clips are missing their files — nothing to export.');
    throw new Error('The video track is empty.');
  }

  // 1) Main track: prepare each clip (trim, speed, size, look) with a matching audio stream.
  clips.forEach((clip, i) => {
    const m = mediaById[clip.mediaId];
    const len = clipLen(clip);
    const speed = clip.speed || 1;
    if (clip.gap) {
      // A gap on the main track: the project background, in silence.
      filters.push(`color=c=${hex(bg, '#000000')}:s=${W}x${H}:r=${fps}:d=${num(len)},format=${fmt}[v${i}]`);
      if (!opts.raw && wantAudio) filters.push(clipAudioFilter(clip, null, -1, i, -1, false, -1, project));
      return;
    }
    // Clips with a transform, mask, chroma key, opacity or blend go through the layered render; the rest keep the plain path.
    const motion = project.motion && project.motion[clip.id];
    const layered = layers.isLayered(clip, motion);
    const maskFile = project.maskFiles && project.maskFiles[clip.id];
    const renderLayered = (srcLabel) => {
      const tag = `m${i}`;
      const maskIdx = maskFile ? addInput(['-loop', '1', '-framerate', String(fps), '-t', num(len), '-i', maskFile]) : null;
      const decoFile = maskFile && project.decoFiles && project.decoFiles[clip.id];
      const decoIdx = decoFile ? addInput(['-loop', '1', '-framerate', String(fps), '-t', num(len), '-i', decoFile]) : null;
      const cmFile = project.customMaskFiles && project.customMaskFiles[clip.id];
      const customMaskIdx = cmFile ? addInput(['-loop', '1', '-framerate', String(fps), '-t', num(len), '-i', cmFile]) : null;
      const matteLabel = matteSource(clip, m, fps, addInput, tag, filters);
      const trackMatte = trackMatteGray(project, clip, videoStart(project, clip.id), { mediaById, fps, W, H, len, addInput, filters, tag, hdr });
      const layer = layers.buildLayer({ clip, media: m, W, H, fps, len, tag, srcLabel, maskIdx, decoIdx, motion, matteLabel, customMaskIdx, trackMatte }, { num, hex, colorFixFor: colorFixForHdr });
      filters.push(...layer.filters);
      filters.push(`color=c=${hex(bg, '#000000')}:s=${W}x${H}:r=${fps}:d=${num(len)},format=${fmt}[bg${tag}]`);
      filters.push(...layers.composite({ base: `bg${tag}`, layer: layer.out, blend: clip.blend, tag, out: `v${i}`, hdr }));
    };
    // P1-50: a valid frame hold rebuilds the clip as pre + frozen frame + post.
    // An out-of-range hold is ignored (the clip renders normally) — a stale
    // hold from an earlier trim must never fail an export.
    const fh = clip.frameHold;
    const fhOk = fh && m.type === 'video' && !sc.hasCurve(clip)
      && Number.isFinite(fh.at) && fh.at >= (clip.in || 0) && fh.at <= (clip.out ?? Infinity)
      && Number.isFinite(fh.duration) && fh.duration > 0;
    const src = fhOk ? heldClipChain(clip, m, len, fps, addInput, filters, `h${i}`, hdr) : pictureSource(clip, m, len, fps, addInput, hdr);
    if (layered) {
      filters.push(`${src.chain},${interpFilter(clip, m, fps)}[s${i}]`);
      renderLayered(`s${i}`);
    } else {
      filters.push(`${src.chain},${clipVideoFilters(clip, m, W, H, fps, bg, hdr)}[v${i}]`);
    }
    // Sound comes from the media even when the picture was pre-rendered. A dedicated
    // audio input (picture came from an override file) is input-seeked too (B1).
    const audioIdx = src.own || m.type === 'image' || !m.hasAudio || clip.muted ? src.idx : addInput(['-ss', num(clip.in), '-i', m.path]);
    const enhP = !opts.raw && enhancePathOf(clip);
    const enhIdx = enhP ? addInput(['-i', enhP]) : -1;
    const fxP = !opts.raw && audioFxPathOf(clip, m);
    const fxIdx = fxP ? addInput(['-i', fxP]) : -1;
    if (!opts.raw && wantAudio) filters.push(clipAudioFilter(clip, m, src.own ? src.idx : audioIdx, i, enhIdx, src.own ? !!src.audioSeeked : true, fxIdx, project));
  });

  // 2) Join clips: xfade/acrossfade where a transition is set, plain concat otherwise.
  let cv = 'v0';
  let ca = 'a0';
  let end = clipLen(clips[0]);
  for (let i = 1; i < clips.length; i++) {
    const td = transitionDur(clips, i);
    // P2-06 Smooth Cut blend: a short linear crossfade at a same-source cut with
    // no transition. transitionDur is 0 there, so the blend supplies the overlap
    // (clamped to half of each clip, like a transition — an xfade longer than a
    // side fails the graph, so over-long blends degrade to a hard cut).
    const scd = td > 0 ? 0 : Math.min(smooth.smoothCutBlendDur(clips, i), clipLen(clips[i - 1]) / 2, clipLen(clips[i]) / 2);
    const effTd = Math.max(td, scd);
    const start = end - effTd;
    const seg = td > 0 && project.fxSegments && project.fxSegments[clips[i].id];
    if (seg) {
      // Animated transition rendered by the effects pass: what came before, the transition, the rest of the clip.
      const sIdx = addInput(['-i', seg]);
      filters.push(
        `[${cv}]trim=duration=${num(start)},setpts=PTS-STARTPTS,setsar=1[jA${i}]`,
        `[${sIdx}:v]trim=duration=${num(td)},setpts=PTS-STARTPTS,fps=${fps},scale=${W}:${H},setsar=1,format=${fmt}[jT${i}]`,
        `[v${i}]trim=start=${num(td)},setpts=PTS-STARTPTS,setsar=1[jB${i}]`,
        `[jA${i}][jT${i}][jB${i}]concat=n=3:v=1:a=0[jv${i}]`,
      );
      if (wantAudio) filters.push(...audioJoinFilters(ca, `a${i}`, i, clips[i].transition, td, clipLen(clips[i - 1]), clipLen(clips[i]), end));
    } else if (effTd > 0) {
      // xfade needs both inputs on the same time base AND at a constant
      // frame rate. settb alone is not enough: a segment-concat output
      // (the FX-transition join above) carries no frame rate (1/0), and
      // xfade then fails the whole export with code 234 ("The inputs needs
      // to be a constant frame rate"). The fps filter stamps the project
      // rate onto both inputs; for the ordinary clip inputs (already
      // fps-normalised by their own chains) it is a no-op. Same for a
      // plain concat join feeding an xfade.
      const xfade = clips[i].transition
        ? `xfade=transition=${clips[i].transition.type}:duration=${num(td)}:offset=${num(start)}`
        : `xfade=transition=fade:duration=${num(scd)}:offset=${num(start)}`;
      filters.push(
        `[${cv}]settb=1/${fps},fps=${fps}[xa${i}]`, `[v${i}]settb=1/${fps},fps=${fps}[xb${i}]`,
        `[xa${i}][xb${i}]${xfade}[jv${i}]`,
      );
      if (wantAudio) filters.push(...audioJoinFilters(ca, `a${i}`, i, clips[i].transition, effTd, clipLen(clips[i - 1]), clipLen(clips[i]), end));
    } else {
      filters.push(`[${cv}][v${i}]concat=n=2:v=1:a=0[jv${i}]`);
      if (wantAudio) filters.push(`[${ca}][a${i}]concat=n=2:v=0:a=1[ja${i}]`);
    }
    cv = `jv${i}`;
    if (wantAudio) ca = `ja${i}`;
    end = start + clipLen(clips[i]);
  }
  const total = end;
  if (opts.raw) {
    return {
      args: ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'),
        '-map', `[${cv}]`, '-t', num(total), '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'],
      total,
    };
  }
  // GIF honesty cap: palette generation over a long range produces huge files and doubles
  // the encode work; refuse with the remedy named instead of grinding or silently capping.
  if (eff.format === 'gif' && total > GIF_MAX_SECONDS) {
    throw new Error(`GIF export is limited to ${GIF_MAX_SECONDS} s of timeline — this project is ${total.toFixed(1)} s. Trim the timeline or split it into shorter exports.`);
  }
  const overlayAudio = [];

  // 3) Overlay clips (picture in picture): layered like main clips, padded in time to the whole video, composited in order.
  (project.overlayClips || []).filter((c) => mediaById[c.mediaId] && mediaById[c.mediaId].type !== 'audio').forEach((c, j) => {
    const m = mediaById[c.mediaId];
    const sp = c.speed || 1;
    const len = clipLen(c);
    const start = Math.max(0, c.start);
    if (start >= total - 0.01) return;
    const tag = `o${j}`;
    const src = pictureSource(c, m, len, fps, addInput, hdr);
    filters.push(`${src.chain},${interpFilter(c, m, fps)}[os${j}]`);
    const idx = src.own ? src.idx : m.hasAudio && !c.muted && m.type === 'video' ? addInput(['-ss', num(c.in), '-i', m.path]) : src.idx;
    const maskFile = project.maskFiles && project.maskFiles[c.id];
    const maskIdx = maskFile ? addInput(['-loop', '1', '-framerate', String(fps), '-t', num(len), '-i', maskFile]) : null;
    const decoFile = maskFile && project.decoFiles && project.decoFiles[c.id];
    const decoIdx = decoFile ? addInput(['-loop', '1', '-framerate', String(fps), '-t', num(len), '-i', decoFile]) : null;
    const cmFile = project.customMaskFiles && project.customMaskFiles[c.id];
    const customMaskIdx = cmFile ? addInput(['-loop', '1', '-framerate', String(fps), '-t', num(len), '-i', cmFile]) : null;
    const motion = project.motion && project.motion[c.id];
    const matteLabel = matteSource(c, m, fps, addInput, tag, filters);
    const trackMatte = trackMatteGray(project, c, start, { mediaById, fps, W, H, len, addInput, filters, tag, hdr });
    const layer = layers.buildLayer({ clip: c, media: m, W, H, fps, len, tag, srcLabel: `os${j}`, maskIdx, decoIdx, motion, matteLabel, customMaskIdx, trackMatte }, { num, hex, colorFixFor: colorFixForHdr });
    filters.push(...layer.filters);
    // Transparent frames before and after, so the layer lines up with the video frame for frame.
    const after = Math.max(0, total - start - len);
    filters.push(`[${layer.out}]tpad=start_duration=${num(start)}:stop_duration=${num(after)}:start_mode=add:stop_mode=add:color=black@0,trim=duration=${num(total)}[op${j}]`);
    filters.push(...layers.composite({ base: cv, layer: `op${j}`, blend: c.blend, tag, out: `ov${j}`, hdr }));
    cv = `ov${j}`;
    if (wantAudio && m.hasAudio && !c.muted && m.type === 'video') {
      const enhP = enhancePathOf(c);
      const fxP = audioFxPathOf(c, m);
      overlayAudio.push({ idx: fxP ? addInput(['-i', fxP]) : enhP ? addInput(['-i', enhP]) : idx, c, len, start, sp, enh: !!(enhP || fxP), fx: !!fxP });
    }
  });

  // 3b) Bundled stickers (10/10 step 3): still PNG layers over the overlays and under
  // the text — the same stacking order the preview uses. main.cjs resolves each clip's
  // sticker file name to an absolute path on project.stickerFiles before the export;
  // a clip whose file did not resolve is skipped, never fatal.
  (project.stickerClips || []).filter((c) => project.stickerFiles && project.stickerFiles[c.id]).forEach((c, j) => {
    const len = Math.max(0.05, c.duration || 3);
    const start = Math.max(0, c.start || 0);
    if (start >= total - 0.01) return;
    const tag = `s${j}`;
    const m = { type: 'image', path: project.stickerFiles[c.id], width: c.w || 480, height: c.h || 480 };
    const src = pictureSource(c, m, len, fps, addInput, hdr);
    filters.push(`${src.chain},fps=${fps}[ss${j}]`);
    const layer = layers.buildLayer({ clip: c, media: m, W, H, fps, len, tag, srcLabel: `ss${j}` }, { num, hex, colorFixFor: colorFixForHdr });
    filters.push(...layer.filters);
    const after = Math.max(0, total - start - len);
    filters.push(`[${layer.out}]tpad=start_duration=${num(start)}:stop_duration=${num(after)}:start_mode=add:stop_mode=add:color=black@0,trim=duration=${num(total)}[sp${j}]`);
    filters.push(...layers.composite({ base: cv, layer: `sp${j}`, blend: c.blend, tag, out: `sv${j}`, hdr }));
    cv = `sv${j}`;
  });

  // 4) Text layer: frames drawn by the UI's canvas text renderer (same code as the preview), packed in text.mov.
  if (project.textOverlay && project.textOverlay.count > 0) {
    const idx = addInput(['-i', project.textOverlay.file]);
    // Text layer stays in YUV too (same round-trip bug as composite(): one RGB pass
    // is ~45.6 dB, but it stacks with the overlay passes).
    filters.push(`[${idx}:v]scale=out_color_matrix=bt709:out_range=tv,format=yuva420p[txt]`);
    filters.push(`[${cv}][txt]overlay=0:0:eof_action=pass:format=auto,format=${fmt}[tv]`);
    cv = 'tv';
  }

  // 5) Music track and overlay sound: trim, fade, delay to timeline position, mix with the main audio.
  if (wantAudio) {
  // Clean Voice ducking (P2-25): the spans every voice clip with the duck step
  // on is speaking, computed once for the whole mix.
  const duckSpans = cleanVoiceDuckSpans(project.videoClips, project.audioClips, (id) => videoStart(project, id));
  const voiceById = voiceByIdOf(project);
  // FB-07: dialogue spans for standalone music ducking (Clean Voice duck
  // spans + role:'dialogue' audio clips).
  const dlgSpans = dialogueSpans(project.videoClips, project.audioClips, (id) => videoStart(project, id));
  // Checklist #19: muted audio clips are left out of the mix entirely.
  const music = project.audioClips.filter((c) => mediaById[c.mediaId] && !c.muted);
  const mixLabels = [`[${ca}]`];
  music.forEach((c, j) => {
    const enhP = enhancePathOf(c);
    const fxP = audioFxPathOf(c, mediaById[c.mediaId]);
    // B1: the media input is input-seeked to c.in (the enhanced render and the AudioFx
    // derivative are pre-trimmed), so the trim runs from 0 in every case.
    const idx = addInput(fxP ? ['-i', fxP] : enhP ? ['-i', enhP] : ['-ss', num(c.in), '-i', mediaById[c.mediaId].path]);
    const len = clipLen(c); // timeline length (audio clips carry a speed, e.g. detached ones)
    const delay = Math.round(c.start * 1000);
    const up = monoUp(mediaById[c.mediaId], !!(enhP || fxP));
    const head = [`atrim=start=0:end=${num(c.out - c.in)}`, 'asetpts=PTS-STARTPTS', ...(up ? [up] : [])];
    const tail = [...vk.volChainFor(c, len), ...audioFades(c, len)];
    if (!fxP) tail.push(...repairFilters(c.repair), ...cleanVoiceFilters(c.cleanVoice), ...audioFxFilters(c.audioFx)); // a valid derivative already carries the chain
    const busVol = mixer.busVolumeFilter(project, c, 'audio'); // P2-23: music bus gain
    if (busVol) tail.push(busVol);
    // Duck this music clip under every voice span (not its own: a voiceover
    // with duck on never ducks itself). Only at 1x with no speed curve — the
    // volume expression's `t` is the clip's own time, which maps to timeline
    // time only then. FB-07: the clip's own standalone duck wins over the
    // Clean Voice duck when it is on — the two never stack (no double-dip).
    // AU-02: a baked duck (duckBaked) skips the live expression — the
    // volume keys already carry the curve; and each voice span carries
    // its own depth/ramp from the voice clip's cleanVoice settings.
    if (!sc.hasCurve(c) && (c.speed || 1) === 1 && !c.duckBaked) {
      const stand = standaloneDuckFilters(c, dlgSpans, len);
      if (stand.length) tail.push(...stand);
      else {
        const local = duckSpans.filter((s) => s.id !== c.id)
          .map((s) => ({ start: s.start - (c.start || 0), end: s.end - (c.start || 0), ...duckSettingsOf(voiceById.get(s.id)?.cleanVoice) }))
          .filter((s) => s.end > 0 && s.start < len);
        const duck = duckVolumeExpr(local);
        if (duck) tail.push(duck);
      }
    }
    tail.push('aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', `adelay=${delay}|${delay}`);
    filters.push(sc.hasCurve(c)
      ? curveAudioGraph(c, `[${idx}:a]${head.join(',')}`, tail, `m${j}`, `mu${j}`)
      : `[${idx}:a]${[...head, ...speedAudio(c), ...tail].join(',')}[m${j}]`);
    mixLabels.push(`[m${j}]`);
  });
  overlayAudio.forEach(({ idx, c, len, start, sp, enh, fx }, j) => {
    const delay = Math.round(start * 1000);
    const up = monoUp(mediaById[c.mediaId], !!enh);
    // Frame hold (P1-50): the overlay's sound skips the held span and is
    // silent while its picture is frozen, like a main-track clip's sound.
    const hold = sc.validFrameHold(c);
    const parts = hold && !sc.hasCurve(c) ? holdAudioParts(`${idx}:a`, 0, c.out - c.in, hold, c.speed || 1, `ovh${j}`) : null;
    if (parts) filters.push(...parts.pre);
    const head = parts ? [] : [`atrim=start=0:end=${num(c.out - c.in)}`, 'asetpts=PTS-STARTPTS', ...(up ? [up] : [])];
    const srcLabel = parts ? `[${parts.label}]` : `[${idx}:a]`;
    const busVolO = mixer.busVolumeFilter(project, c, 'overlay'); // P2-23: overlay bus gain
    const tail = [...vk.volChainFor(c, len), ...audioFades(c, len), ...(busVolO ? [busVolO] : []),
      'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', ...(fx ? [] : repairFilters(c.repair)), ...(fx ? [] : cleanVoiceFilters(c.cleanVoice)), ...(fx ? [] : audioFxFilters(c.audioFx)), `adelay=${delay}|${delay}`];
    filters.push(sc.hasCurve(c)
      ? curveAudioGraph(c, `${srcLabel}${head.join(',')}`, tail, `oa${j}`, `ov${j}`)
      : `${srcLabel}${[...head, ...speedAudio(c), ...tail].join(',')}[oa${j}]`);
    mixLabels.push(`[oa${j}]`);
  });
  if (mixLabels.length > 1) {
    filters.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:normalize=0[amix]`);
    ca = 'amix';
  }
  // P2-23: the master bus rides on the finished mix.
  const masterVol = mixer.masterVolumeFilter(project);
  if (masterVol) { filters.push(`[${ca}]${masterVol}[cam]`); ca = 'cam'; }
  }

  // 6) Output stage: the effective export settings' resolution cap (downscale only) and fps resample,
  // applied to the finished picture — every layer above stays at project size.
  let outLabel = cv;
  const stage = [];
  if (eff.outW !== W || eff.outH !== H) stage.push(`scale=${eff.outW}:${eff.outH}:flags=lanczos`);
  if (eff.outFps !== fps) stage.push(`fps=${eff.outFps}`);
  if (stage.length) { filters.push(`[${cv}]${stage.join(',')},format=${fmt}[ovfinal]`); outLabel = 'ovfinal'; }

  // VAAPI encodes from GPU surfaces: as the graph's last step the finished
  // picture is converted to NV12 and uploaded, and the encode runs on the
  // device named by the head option in the final args. Only the MP4/MOV
  // stage consumes an encoder — GIF and WebM never reach it.
  const vaapi = !hdr && opts.encoder === 'h264_vaapi' && opts.vaapiDevice && eff.format !== 'gif' && eff.format !== 'webm' ? opts.vaapiDevice : null;
  if (vaapi) {
    filters.push(`[${outLabel}]format=nv12,hwupload[ovhw]`);
    outLabel = 'ovhw';
  }

  // 7) Per-format output stage. MP4 and MOV share the H.264/H.265 codec stage (MOV is the
  // same streams in the QuickTime muxer, faststart included); WebM is VP9 + Opus with no
  // movflags or colour tags (the WebM muxer rejects both); GIF takes the palette branch
  // and drops the audio map entirely — a GIF has no sound.
  if (eff.format === 'gif') {
    filters.push(
      `[${outLabel}]fps=${eff.gifFps},scale=${eff.gifW}:${eff.gifH}:flags=lanczos,split[gifa][gifb]`,
      '[gifa]palettegen=stats_mode=diff[gifp]',
      '[gifb][gifp]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[gifout]',
    );
    return {
      args: ['-y', '-hide_banner', ...inputs, '-filter_complex', filters.join(';'),
        '-map', '[gifout]', '-loop', '0', '-t', num(total), '-progress', 'pipe:1', '-nostats', outFile],
      total,
    };
  }
  const maps = ['-map', `[${outLabel}]`, '-map', `[${ca}]`];
  let codecArgs;
  if (eff.format === 'webm') {
    codecArgs = [...webmCodecArgs(eff), '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', `${eff.audioKbps}k`];
  } else {
    codecArgs = [
      ...videoCodec2(opts.encoder, eff), ...(vaapi ? [] : ['-pix_fmt', hdr ? 'yuv420p10le' : 'yuv420p']),
      // SDR: the pipeline works in BT.709 throughout (HDR inputs are tone-mapped
      // to BT.709 above); HDR: 10-bit BT.2020 with the chosen transfer. Tag it
      // explicitly — untagged video otherwise probes as color_* "unknown".
      ...(hdr
        ? ['-color_primaries', 'bt2020', '-color_trc', HDR_TRC[hdr], '-colorspace', 'bt2020nc', '-color_range', 'tv']
        : ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv']),
      '-c:a', 'aac', '-b:a', `${eff.audioKbps}k`,
    ];
    // Soft subtitle track (mov_text): the renderer serialized the caption clips to an SRT
    // (subtitles.js) and the export:run handler staged it as project.subtitleFile. Muxed as
    // a switchable stream NEXT TO the burned-in text — both, by design. Caption styling
    // does not survive mov_text (plain text + timings only); that is documented in the UI.
    if (eff.subtitleTrack && project.subtitleFile && fs.existsSync(project.subtitleFile)) {
      const sIdx = addInput(['-i', project.subtitleFile]);
      maps.push('-map', `${sIdx}:s`);
      codecArgs.push('-c:s', 'mov_text');
      if (typeof project.subtitleLang === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]+)?$/.test(project.subtitleLang)) {
        codecArgs.push('-metadata:s:s:0', `language=${project.subtitleLang}`);
      }
    }
    codecArgs.push('-movflags', '+faststart');
  }
  const args = [
    '-y', '-hide_banner',
    ...(vaapi ? ['-vaapi_device', vaapi] : []),
    ...inputs,
    '-filter_complex', filters.join(';'),
    ...maps,
    // Pin the output frame rate to the effective one. The assembled graph's final
    // link carries no frame_rate the CLI can read (concat/xfade outputs don't set
    // one), and when the CLI cannot read a rate it falls back to 25 fps vsync —
    // silently re-gridding EVERY export of a non-25 fps project (a 30 fps project
    // came out as an 85-frame 25 fps file over 3.4 s, its frames re-timed; measured
    // in Sprint 9). The graph already delivers exactly eff.outFps (the stage above
    // resamples when the user picked a different rate), so the pin only names it.
    '-r', String(eff.outFps),
    ...codecArgs,
    '-t', num(total),
    '-progress', 'pipe:1', '-nostats',
    outFile,
  ];
  return { args, total, skipped };
}

// Audio-only export: main track (with crossfades), overlay sound and the audio track, mixed like the video export.
// format: 'mp3' | 'wav' | 'm4a'. The codec stage honours the resolved export settings
// (effectiveExport().audioKbps) — MP3/M4A encode at the chosen rate, never a hardcoded one;
// WAV is lossless PCM, where a bitrate does not apply. opts.floatWav renders the WAV as
// 32-bit float instead (the master-stage intermediate in runAudioExport, so the final
// encode quantizes exactly once).
function buildAudioExportArgs(project, outFile, format = 'mp3', opts = {}) {
  const mediaById = mediaMap(project);
  const inputs = [];
  const filters = [];
  const mix = [];
  let n = 0;
  const addInput = (args) => { inputs.push(...args); return n++; };
  const fmt = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  let sound = false;

  const clips = project.videoClips.filter((c) => c.gap || mediaById[c.mediaId]);
  if (clips.length) {
    clips.forEach((clip, i) => {
      const m = mediaById[clip.mediaId];
      const has = m && m.type === 'video' && m.hasAudio && !clip.muted && !clip.gap;
      if (has) sound = true;
      const enhP = has && enhancePathOf(clip);
      const fxP = has && audioFxPathOf(clip, m);
      // B1: seek the media input to the clip start; clipAudioFilter trims from 0.
      filters.push(clipAudioFilter(clip, m, has ? addInput(['-ss', num(clip.in), '-i', m.path]) : -1, i, enhP ? addInput(['-i', enhP]) : -1, true, fxP ? addInput(['-i', fxP]) : -1, project));
    });
    let ca = 'a0';
    let end = clipLen(clips[0]);
    for (let i = 1; i < clips.length; i++) {
      const td = transitionDur(clips, i);
      filters.push(...audioJoinFilters(ca, `a${i}`, i, clips[i].transition, td, clipLen(clips[i - 1]), clipLen(clips[i]), end));
      ca = `ja${i}`;
      end = end - td + clipLen(clips[i]);
    }
    mix.push(`[${ca}]`);
  }
  (project.overlayClips || []).forEach((c, j) => {
    const m = mediaById[c.mediaId];
    if (!m || m.type !== 'video' || !m.hasAudio || c.muted) return;
    sound = true;
    const delay = Math.round(Math.max(0, c.start) * 1000);
    const enhP = enhancePathOf(c);
    const fxP = audioFxPathOf(c, m);
    const upO = monoUp(m, !!(enhP || fxP));
    const oIdx = addInput(fxP ? ['-i', fxP] : enhP ? ['-i', enhP] : ['-ss', num(c.in), '-i', m.path]);
    const oHead = [`atrim=start=0:end=${num(c.out - c.in)}`, 'asetpts=PTS-STARTPTS', ...(upO ? [upO] : [])];
    const busVolO = mixer.busVolumeFilter(project, c, 'overlay'); // P2-23
    const oTail = [...vk.volChainFor(c, clipLen(c)), ...audioFades(c, clipLen(c)), ...(fxP ? [] : repairFilters(c.repair)), ...(fxP ? [] : cleanVoiceFilters(c.cleanVoice)), ...(fxP ? [] : audioFxFilters(c.audioFx)), ...(busVolO ? [busVolO] : []), 'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', `adelay=${delay}|${delay}`];
    filters.push(sc.hasCurve(c)
      ? curveAudioGraph(c, `[${oIdx}:a]${oHead.join(',')}`, oTail, `oa${j}`, `ao${j}`)
      : `[${oIdx}:a]${[...oHead, ...speedAudio(c), ...oTail].join(',')}[oa${j}]`);
    mix.push(`[oa${j}]`);
  });
  // Checklist #19: muted audio clips are left out of the mix entirely.
  // FB-07: dialogue spans for standalone music ducking, computed once.
  const dlgSpansA = dialogueSpans(project.videoClips, project.audioClips, (id) => videoStart(project, id));
  const voiceByIdA = voiceByIdOf(project);
  project.audioClips.filter((c) => mediaById[c.mediaId] && !c.muted).forEach((c, j) => {
    sound = true;
    const len = clipLen(c);
    const delay = Math.round(c.start * 1000);
    const enhP = enhancePathOf(c);
    const fxP = audioFxPathOf(c, mediaById[c.mediaId]);
    const up = monoUp(mediaById[c.mediaId], !!(enhP || fxP));
    const aIdx = addInput(fxP ? ['-i', fxP] : enhP ? ['-i', enhP] : ['-ss', num(c.in), '-i', mediaById[c.mediaId].path]);
    const head = [`atrim=start=0:end=${num(c.out - c.in)}`, 'asetpts=PTS-STARTPTS', ...(up ? [up] : [])];
    const tail = [...vk.volChainFor(c, len), ...audioFades(c, len)];
    if (!fxP) tail.push(...repairFilters(c.repair), ...cleanVoiceFilters(c.cleanVoice), ...audioFxFilters(c.audioFx)); // a valid derivative already carries the chain
    const busVol = mixer.busVolumeFilter(project, c, 'audio'); // P2-23
    if (busVol) tail.push(busVol);
    // Same ducking as the video export's mix (P2-25 Clean Voice), with the
    // FB-07 standalone duck winning over it when the music clip has it on.
    // AU-02: baked ducks skip the live expression; spans carry per-voice depth/ramp.
    if (!sc.hasCurve(c) && (c.speed || 1) === 1 && !c.duckBaked) {
      const stand = standaloneDuckFilters(c, dlgSpansA, len);
      if (stand.length) tail.push(...stand);
      else {
        const local = cleanVoiceDuckSpans(project.videoClips, project.audioClips, (id) => videoStart(project, id))
          .filter((s) => s.id !== c.id)
          .map((s) => ({ start: s.start - (c.start || 0), end: s.end - (c.start || 0), ...duckSettingsOf(voiceByIdA.get(s.id)?.cleanVoice) }))
          .filter((s) => s.end > 0 && s.start < len);
        const duck = duckVolumeExpr(local);
        if (duck) tail.push(duck);
      }
    }
    tail.push('aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', `adelay=${delay}|${delay}`);
    filters.push(sc.hasCurve(c)
      ? curveAudioGraph(c, `[${aIdx}:a]${head.join(',')}`, tail, `m${j}`, `am${j}`)
      : `[${aIdx}:a]${[...head, ...speedAudio(c), ...tail].join(',')}[m${j}]`);
    mix.push(`[m${j}]`);
  });
  if (!sound) throw new Error('Nothing to export: no clip on the timeline has sound.');
  filters.push(mix.length === 1 ? `${mix[0]}anull[out]` : `${mix.join('')}amix=inputs=${mix.length}:duration=longest:normalize=0[out]`);
  // P2-23: the master bus rides on the finished mix.
  const masterVolA = mixer.masterVolumeFilter(project);
  const outLabel = masterVolA ? 'mout' : 'out';
  if (masterVolA) filters.push(`[out]${masterVolA}[mout]`);
  const eff = effectiveExport(project);
  const codec = {
    mp3: ['-c:a', 'libmp3lame', '-b:a', `${eff.audioKbps}k`],
    wav: ['-c:a', opts.floatWav ? 'pcm_f32le' : 'pcm_s16le'],
    m4a: ['-c:a', 'aac', '-b:a', `${eff.audioKbps}k`],
  }[format];
  if (!codec) throw new Error(`Unknown audio format: ${format}`);
  return ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', `[${outLabel}]`, ...codec, '-progress', 'pipe:1', '-nostats', outFile];
}

// The audio mix's timeline length — the progress denominator for the audio job. Mirrors the
// builder above: the main track's concat/crossfade recurrence, extended by any overlay or
// audio-track clip that ends later (the mix itself runs duration=longest).
function audioExportTotal(project) {
  // P0-01 (#16): the existence-aware mediaMap, so the progress total matches
  // the filtered graph — a missing clip no longer inflates the denominator.
  const mediaById = mediaMap(project);
  let total = 0;
  const clips = (project.videoClips || []).filter((c) => c.gap || mediaById[c.mediaId]);
  if (clips.length) {
    let end = clipLen(clips[0]);
    for (let i = 1; i < clips.length; i++) end = end - transitionDur(clips, i) + clipLen(clips[i]);
    total = end;
  }
  for (const c of project.overlayClips || []) {
    const m = mediaById[c.mediaId];
    if (m && m.type === 'video' && m.hasAudio && !c.muted) total = Math.max(total, Math.max(0, c.start || 0) + clipLen(c));
  }
  for (const c of project.audioClips || []) {
    if (mediaById[c.mediaId] && !c.muted) total = Math.max(total, (c.start || 0) + clipLen(c)); // Checklist #19: muted clips do not extend the export
  }
  return total;
}

// ---- Master loudness stage (audio-only export) ----
// The mix is measured with loudnorm's analysis pass and gained to the resolved
// master target (electron/loudness.cjs — the same targets the video export
// uses), applied once to the whole mix instead of per clip. A measurement fed
// forward as a plain gain (the matrix §3 design: measure, then a volume
// filter), never a second dynamic pass over clips that may already carry
// per-clip loudnorm. Silence / unmeasurable input -> gain 0. The finished
// file is measured again for the loudness report on the done card.
// Audio-only export as a JOB, the runExport pattern: { promise, cancel }, progress events,
// cancel checked at every phase boundary, and a cancelled job leaves no partial file.
// Phases: (A) the timeline mixdown rendered once as a float WAV through buildAudioExportArgs,
// (B) the master loudnorm measurement on that mixdown, (C) master gain + the real encode at
// the resolved settings. Rendering the mixdown once is what lets the master stage measure
// the actual mix instead of guessing from the graph.
function runAudioExport(project, outFile, format = 'mp3', onProgress, runOpts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-audio-'));
  const mixWav = path.join(tmpDir, 'mix.wav');
  // P0-01 (#16): the audio graph drops missing-file clips the same way the
  // video graph does (mediaMap is existence-aware); report them, don't fail.
  const skipped = missingMediaClips(project);
  // The loudness report for the done card (filled once the final encode lands,
  // like `skipped` above): { applied, gainDb, target, measured, final }.
  let loudnessReport = null;
  let proc = null;
  let canceled = false;
  const cancelError = () => new Error('Export canceled');
  const spawnPhase = (args, total, from, to) => new Promise((resolve, reject) => {
    if (canceled) return reject(cancelError());
    proc = trackExportProc(spawn(ffmpegPath, graphFile(args, tmpDir), { windowsHide: true }));
    if (runOpts.nice) { try { os.setPriority(proc.pid, runOpts.nice); } catch { /* not permitted everywhere */ } }
    let log = '';
    const progress = createProgressParser(total, (v) => onProgress?.(from + v * (to - from)));
    proc.stdout.on('data', (d) => progress.feed(d));
    proc.stderr.on('data', (d) => { log += d; if (log.length > 20000) log = log.slice(-20000); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (canceled) return reject(cancelError());
      // FB-18: classify the failure (stable code + failing clip) and keep
      // the raw log on the error — the renderer shows the human string and
      // keeps the log behind a details toggle.
      return code === 0 ? resolve() : reject(attachExportError(new Error(`FFmpeg failed (code ${code}):\n${log.slice(-3000)}`), { log, project }));
    });
  });
  const promise = (async () => {
    try {
      const total = audioExportTotal(project);
      await spawnPhase(buildAudioExportArgs(project, mixWav, 'wav', { floatWav: true }), total, 0, 0.7);
      const eff = effectiveExport(project);
      const target = loudness.resolveLoudnessTarget(eff);
      const measured = target ? await loudness.measureLoudness(ffmpegPath, mixWav) : null;
      let gain = 0;
      if (measured && target) {
        gain = target.I - measured.integrated;
        if (Number.isFinite(measured.truePeak)) gain = Math.min(gain, target.TP - measured.truePeak);
        gain = Math.max(-24, Math.min(24, gain));
      }
      if (canceled) throw cancelError();
      const codec = {
        mp3: ['-c:a', 'libmp3lame', '-b:a', `${eff.audioKbps}k`],
        wav: ['-c:a', 'pcm_s16le'],
        m4a: ['-c:a', 'aac', '-b:a', `${eff.audioKbps}k`],
      }[format];
      if (!codec) throw new Error(`Unknown audio format: ${format}`);
      const applied = !!target && Math.abs(gain) >= 0.05;
      const master = applied ? ['-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=0.98:level=false`] : [];
      await spawnPhase(['-y', '-hide_banner', '-loglevel', 'error', '-i', mixWav, ...master, ...codec, '-progress', 'pipe:1', '-nostats', outFile], total, 0.7, 1);
      if (target) {
        const final = await loudness.measureLoudness(ffmpegPath, outFile);
        loudnessReport = { applied, gainDb: gain, target, measured, final: final ? { ...final, clipped: Number.isFinite(final.truePeak) && final.truePeak > 0 } : null };
      } else {
        // AU-07: mastering off — still measure the finished file, so the done
        // card reports its true loudness instead of saying nothing.
        const final = await loudness.measureLoudness(ffmpegPath, outFile);
        loudnessReport = { applied: false, gainDb: 0, target: null, measured: final, final };
      }
      onProgress?.(1);
      return outFile;
    } catch (e) {
      if (canceled) {
        try { fs.rmSync(outFile, { force: true }); } catch { /* nothing to clean */ }
        throw cancelError();
      }
      throw e;
    } finally {
      // P1-52: the export settled — a pause must never leak into the next job.
      clearExportPause();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })();
  // `skipped` is a getter: it is only filled once the graph is built inside
  // the promise above, which always happens before the promise settles.
  // `loudness` is the same: the report, filled once the final encode lands.
  return { promise, cancel: () => { canceled = true; proc?.kill('SIGKILL'); }, get skipped() { return skipped; }, get loudness() { return loudnessReport; } };
}

// Back-compat thin wrapper: the promise half of the audio job.
function exportAudio(project, outFile, format) {
  return runAudioExport(project, outFile, format).promise;
}

// Windows limits a command line to 32767 characters: a long filter graph (many animated clips) goes in a file.
function graphFile(args, dir = os.tmpdir()) {
  const i = args.indexOf('-filter_complex');
  if (i < 0 || args[i + 1].length < 20000) return args;
  const file = path.join(dir, `fve-graph-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  fs.writeFileSync(file, args[i + 1]);
  return [...args.slice(0, i), '-filter_complex_script', file, ...args.slice(i + 2)];
}

// Runs the export; onProgress receives a 0..1 fraction. Returns { promise, cancel }.
// ---- Video encoder: the graphics card's H.264 encoder when one works, else libx264 on the CPU ----
// A hardware encoder is faster and leaves the processor free, at about the same quality (its quality number is a
// few steps above the CRF to match: h264_qsv at 23 measured like libx264 veryfast at CRF 20).
// ---- Export quality: the effective settings the renderer resolved (src/exportQuality.js) and stamped
// onto the project as project.export. Consumed here verbatim (validated + clamped); projects without a
// stamp (older saves, smoke fixtures) fall back to the historical behavior: CRF (project.crf || 20),
// veryfast, AAC 192k, project size and fps.
const X264_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];
const EXPORT_FORMATS = ['mp4', 'mov', 'webm', 'gif'];
const GIF_MAX_SECONDS = 30; // palette generation on longer ranges is impractical; the error says so
function effectiveExport(project) {
  const e = project.export;
  const W = project.width || 1280;
  const H = project.height || 720;
  const fps = project.fps || 30;
  const clampN = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : dflt);
  // GIF geometry mirrors resolveExport: from the (already capped) output size, scaled so
  // the longest side fits the GIF size preset; never an upscale.
  const withGif = (base) => {
    const k = Math.min(1, base.gifSize / Math.max(base.outW, base.outH));
    return { ...base, gifW: Math.max(2, Math.round(base.outW * k)), gifH: Math.max(2, Math.round(base.outH * k)) };
  };
  if (!e || typeof e !== 'object') {
    return withGif({ codecFamily: 'h264', hdr: 'off', mode: 'crf', crf: project.crf || 20, bitrateMbps: null, encoderPreset: 'veryfast', audioKbps: 192, outW: W, outH: H, outFps: fps, format: 'mp4', subtitleTrack: false, gifSize: 640, gifFps: 15, loudness: 'social', loudnessI: -14, loudnessTargetI: -14 });
  }
  // FX-06: HDR export (PQ/HLG) only exists for MP4/MOV, and only in H.265
  // — H.264 has no HDR story in this build, and WebM/GIF none at all.
  const fmt = EXPORT_FORMATS.includes(e.format) ? e.format : 'mp4';
  const hdr = ['pq', 'hlg'].includes(e.hdr) && ['mp4', 'mov'].includes(fmt) ? e.hdr : 'off';
  return withGif({
    codecFamily: hdr !== 'off' ? 'h265' : (e.codecFamily === 'h265' ? 'h265' : 'h264'),
    hdr,
    mode: e.mode === 'bitrate' ? 'bitrate' : 'crf',
    crf: clampN(e.crf, 0, 51, 20),
    bitrateMbps: e.bitrateMbps == null ? null : clampN(e.bitrateMbps, 0.5, 100, 12),
    encoderPreset: X264_PRESETS.includes(e.encoderPreset) ? e.encoderPreset : 'veryfast',
    audioKbps: clampN(e.audioKbps, 32, 512, 192),
    // Master loudness (P1-14): the profile + custom value, resolved the same
    // way as the renderer's resolveExport; 'social' keeps the audio-only
    // master stage's existing default.
    loudness: ['off', 'social', 'podcast', 'broadcast', 'custom'].includes(e.loudness) ? e.loudness : 'social',
    loudnessI: clampN(e.loudnessI, -30, -8, -14),
    loudnessTargetI: e.loudness === 'off' ? null : (e.loudness === 'custom' ? clampN(e.loudnessI, -30, -8, -14) : ({ social: -14, podcast: -16, broadcast: -23 }[e.loudness] ?? -14)),
    // Never upscale, whatever a stamp claims: the cap can only shrink the project frame.
    outW: Math.max(2, Math.min(W, Math.round(e.outW || W))),
    outH: Math.max(2, Math.min(H, Math.round(e.outH || H))),
    outFps: clampN(e.outFps, 1, 240, fps),
    format: fmt,
    subtitleTrack: !!e.subtitleTrack,
    gifSize: e.gifSize === 320 ? 320 : 640,
    gifFps: clampN(e.gifFps, 1, 60, 15),
  });
}

// Which encoders a given FFmpeg binary carries (its `-encoders` list, parsed
// once per binary and cached). hasEncoder() is the bundled binary — the one
// every pipeline stage except a proven hardware encode runs on.
const encoderSets = new Map();
function binaryHasEncoder(bin, name) {
  if (!encoderSets.has(bin)) {
    const set = new Set();
    try {
      const out = execFileSync(bin, ['-hide_banner', '-encoders'], { windowsHide: true }).toString();
      for (const line of out.split('\n')) {
        const m = line.trim().match(/^\S+\s+(\S+)\s/);
        if (m) set.add(m[1]);
      }
    } catch { /* unusable binary: empty set, everything falls back to libx264 */ }
    encoderSets.set(bin, set);
  }
  return encoderSets.get(bin).has(name);
}
function hasEncoder(name) { return binaryHasEncoder(ffmpegPath, name); }
const hasLibx265 = () => hasEncoder('libx265');
const hasVp9 = () => hasEncoder('libvpx-vp9');

// The hardware H.264 candidates, in probe order (see pickEncoderInfo). The
// argument builders themselves live in videoCodec2 — the export's single
// codec-arg source; this list only names what gets probed. VAAPI is the
// Linux/Intel path (the reference laptop's HD 620 speaks nothing else);
// it needs a DRM render node and a surface upload in the graph, both wired
// in buildExportArgs / probeEncodeArgs.
const HW_LADDER = ['h264_nvenc', 'h264_qsv', 'h264_vaapi', 'h264_amf'];
// The full codec argument set for an effective export config. Hardware encoders get their mapped
// equivalents of the same intent: NVENC preset levels p1..p7 for the x264 speed names, QSV takes the
// names directly, AMF collapses to its three quality levels; rate control follows the mode (CQ for
// CRF intent, a plain target bitrate for bitrate intent). H.265 is software-only in this build
// (libx265, stated rule); without libx265 it falls back to the H.264 path.
const NVENC_PRESET = { ultrafast: 'p1', superfast: 'p1', veryfast: 'p2', faster: 'p2', fast: 'p3', medium: 'p4', slow: 'p5', slower: 'p6', veryslow: 'p7' };
function videoCodec2(encoder, eff) {
  if (eff.codecFamily === 'h265' && hasLibx265()) {
    const rate = eff.mode === 'bitrate' ? ['-b:v', `${eff.bitrateMbps}M`] : ['-crf', String(eff.crf)];
    return ['-c:v', 'libx265', '-preset', eff.encoderPreset, ...rate, '-tag:v', 'hvc1'];
  }
  const rate = eff.mode === 'bitrate'
    ? { hw: ['-b:v', `${eff.bitrateMbps}M`], sw: ['-b:v', `${eff.bitrateMbps}M`, '-maxrate', `${eff.bitrateMbps}M`, '-bufsize', `${eff.bitrateMbps * 2}M`] }
    : null;
  if (encoder === 'h264_nvenc') {
    return eff.mode === 'bitrate'
      ? ['-c:v', 'h264_nvenc', '-preset', NVENC_PRESET[eff.encoderPreset], '-rc', 'vbr', ...rate.hw]
      : ['-c:v', 'h264_nvenc', '-preset', NVENC_PRESET[eff.encoderPreset], '-rc', 'vbr', '-cq', String(eff.crf + 3), '-b:v', '0'];
  }
  if (encoder === 'h264_qsv') {
    return eff.mode === 'bitrate'
      ? ['-c:v', 'h264_qsv', '-preset', eff.encoderPreset, ...rate.hw]
      : ['-c:v', 'h264_qsv', '-preset', eff.encoderPreset, '-global_quality', String(eff.crf + 3)];
  }
  if (encoder === 'h264_amf') {
    const quality = ['slow', 'slower', 'veryslow'].includes(eff.encoderPreset) ? 'quality' : eff.encoderPreset === 'medium' ? 'balanced' : 'speed';
    return eff.mode === 'bitrate'
      ? ['-c:v', 'h264_amf', '-quality', quality, '-rc', 'vbr_peak', ...rate.hw]
      : ['-c:v', 'h264_amf', '-quality', quality, '-rc', 'cqp', '-qp_i', String(eff.crf + 2), '-qp_p', String(eff.crf + 2)];
  }
  if (encoder === 'h264_vaapi') {
    // VAAPI rate control: -qp is its constant-quality knob (the CRF intent); bitrate intent is
    // a plain target. The x264 preset names have no VAAPI equivalent — the
    // driver picks its own speed/quality balance. The matching device option
    // and surface upload are added by buildExportArgs, not here.
    // VAAPI takes the CRF number DIRECTLY, with no +3 bump: the bump was measured for QSV
    // only. (The macroblocking seen on final zakaria v1.mp4, 2026-11-13, was later traced
    // to overlay compositing forcing the base through YUV→RGB→YUV per overlay — see
    // layers.cjs composite() — not to the encoder. Lower QP only ever costs file size,
    // never quality.)
    return eff.mode === 'bitrate'
      ? ['-c:v', 'h264_vaapi', '-b:v', `${eff.bitrateMbps}M`]
      : ['-c:v', 'h264_vaapi', '-qp', String(eff.crf)];
  }
  return ['-c:v', 'libx264', '-preset', eff.encoderPreset, ...(eff.mode === 'bitrate' ? rate.sw : ['-crf', String(eff.crf)])];
}


// WebM's codec stage: libvpx-vp9 carrying the SAME quality intent as the H.264 settings —
// CRF mode becomes VP9's constrained-quality mode (-b:v 0 + -crf), bitrate mode a plain
// target; the x264 speed names map onto VP9's cpu-used ladder under deadline=good (deadline
// "best" is not shippable on CPU). Audio is Opus at the resolved audio rate (output stage).
// The ladder is FLOORED at cpu-used 2 on purpose: VP9's cpu-used 0/1 are unusable on CPU
// at 1080p — measured 2026-11-15 on this VM (5 s 1080x1920, CRF 18, deadline good):
// cpu-used 0 = ~169 s, 1 = 84.7 s, 2 = 40.8 s, 3 = 30.3 s, 4 = 23.7 s, while PSNR vs the
// source is identical to three decimals (26.515 / 26.518 / 26.518 for 0 / 2 / 4) — the
// slow end buys nothing but time. The old map sent the 'high' preset (x264 'slow') to
// cpu-used 0, so the default WebM export took ~4 min for 5 s of video. The ordering is
// kept (a slower x264 preset still maps to a lower cpu-used), only the floor moved.
const VP9_CPU_USED = { ultrafast: 5, superfast: 5, veryfast: 4, faster: 4, fast: 3, medium: 3, slow: 2, slower: 2, veryslow: 2 };
function webmCodecArgs(eff) {
  const base = ['-c:v', 'libvpx-vp9', '-deadline', 'good', '-cpu-used', String(VP9_CPU_USED[eff.encoderPreset] ?? 2), '-row-mt', '1'];
  return eff.mode === 'bitrate' ? [...base, '-b:v', `${eff.bitrateMbps}M`] : [...base, '-b:v', '0', '-crf', String(eff.crf)];
}

// The encoder exports use, picked once by PROOF, not by presence: a hardware
// encoder is picked only when a binary that carries it completes a real
// one-frame test encode on this machine. The bundled ffmpeg-static build
// carries NO hardware encoders at all (its -encoders list is libx264 /
// libx265 / libvpx / libaom only), so the pick also considers a system
// FFmpeg — but a system binary is trusted with the final encode ONLY, after
// its own test encode passes; every other pipeline stage keeps the bundled
// binary, and a failed hardware export falls back to libx264 on the bundled
// binary (see runExport), so a broken system build can never lose an export
// the bundled one would have finished. FVE_ENCODER forces the encoder name
// (tests); FVE_FFMPEG_HW pins the first binary candidate.
let encoderPickPromise = null;
const cpuPick = () => ({ encoder: 'libx264', binary: ffmpegPath, device: null });
function vaapiDevice() {
  for (let i = 128; i < 140; i++) {
    const d = `/dev/dri/renderD${i}`;
    if (fs.existsSync(d)) return d;
  }
  return null;
}
function encoderBinaries() {
  const list = [];
  if (process.env.FVE_FFMPEG_HW) list.push(process.env.FVE_FFMPEG_HW);
  list.push(ffmpegPath);
  if (process.platform === 'linux') list.push('/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg');
  if (process.platform === 'darwin') list.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg');
  list.push('ffmpeg'); // PATH lookup; spawn/execFile resolve it, absence just fails the probe
  return [...new Set(list)];
}
function probeEncodeArgs(encoder, device) {
  const eff = { codecFamily: 'h264', mode: 'crf', crf: 20, bitrateMbps: null, encoderPreset: 'veryfast' };
  const src = ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30'];
  if (encoder === 'h264_vaapi') {
    return ['-vaapi_device', device, ...src, '-vf', 'format=nv12,hwupload', ...videoCodec2(encoder, eff), '-frames:v', '1', '-f', 'null', '-'];
  }
  return [...src, ...videoCodec2(encoder, eff), '-pix_fmt', 'yuv420p', '-frames:v', '1', '-f', 'null', '-'];
}
function pickEncoderInfo() {
  if (process.env.FVE_ENCODER) {
    const encoder = process.env.FVE_ENCODER;
    if (encoder === 'libx264') return Promise.resolve(cpuPick());
    const device = encoder === 'h264_vaapi' ? vaapiDevice() : null;
    const binary = encoderBinaries().find((b) => binaryHasEncoder(b, encoder)) || ffmpegPath;
    return Promise.resolve({ encoder, binary, device });
  }
  encoderPickPromise ||= (async () => {
    for (const name of HW_LADDER) {
      const device = name === 'h264_vaapi' ? vaapiDevice() : null;
      if (name === 'h264_vaapi' && !device) continue; // no DRM render node: cannot work here
      for (const bin of encoderBinaries()) {
        if (!binaryHasEncoder(bin, name)) continue;
        try {
          await runFfmpegOn(bin, probeEncodeArgs(name, device));
          return { encoder: name, binary: bin, device };
        } catch {
          // not on this PC, or not with this binary
        }
      }
    }
    return cpuPick();
  })();
  return encoderPickPromise;
}
// The public contract (main.cjs caps, the Export summary): just the name.
function pickEncoder() {
  return pickEncoderInfo().then((info) => info.encoder);
}
// After a hardware failure mid-export the pick is demoted to the CPU for the
// rest of the process (runExport). Also the test reset.
function resetEncoderPick() {
  encoderPickPromise = Promise.resolve(cpuPick());
}

// ---- Export progress parsing ----
// FFmpeg writes `-progress pipe:1` key=value lines to stdout in chunks that do
// NOT align with lines: one chunk can carry several out_time values, and one
// value can be split across two chunks. The old code regex-matched only the
// FIRST value per chunk, so the reported time lagged and jumped. This parser
// buffers the tail, takes the LAST complete value in each chunk, and never
// reports backwards. `out_time_ms` is accepted alongside `out_time_us`
// (FFmpeg's ms field carries microseconds too).
function parseProgressValues(text) {
  const out = [];
  const re = /out_time_(?:us|ms)=(\d+)/g;
  let m;
  while ((m = re.exec(text))) out.push(Number(m[1]) / 1e6);
  return out;
}

function createProgressParser(total, onProgress) {
  let buf = '';
  let last = 0;
  return {
    feed(chunk) {
      buf += chunk.toString();
      const values = parseProgressValues(buf);
      if (values.length) {
        // Keep only the tail after the last complete value: it may hold a
        // value split across the chunk boundary.
        const cut = buf.lastIndexOf('out_time');
        buf = cut >= 0 ? buf.slice(cut) : '';
        if (buf.length > 64) buf = buf.slice(-64);
        if (total > 0) {
          const v = Math.min(1, values[values.length - 1] / total);
          if (v > last) { last = v; onProgress?.(last); }
        }
      } else if (buf.length > 64) {
        buf = buf.slice(-64);
      }
    },
    get value() { return last; },
  };
}

function runExport(project, outFile, onProgress, runOpts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-'));
  const maskFiles = {};
  for (const [n, [clipId, dataUrl]] of Object.entries(project.maskImages || {}).entries()) {
    const file = path.join(tmpDir, `mask_${n}.png`);
    fs.writeFileSync(file, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
    maskFiles[clipId] = file;
  }
  const decoFiles = {}; // mask outline / glow pictures
  for (const [n, [clipId, dataUrl]] of Object.entries(project.decoImages || {}).entries()) {
    const file = path.join(tmpDir, `deco_${n}.png`);
    fs.writeFileSync(file, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
    decoFiles[clipId] = file;
  }
  const customMaskFiles = {}; // painted removal keep-maps (grayscale, source geometry)
  for (const [n, [clipId, dataUrl]] of Object.entries(project.customMaskImages || {}).entries()) {
    const file = path.join(tmpDir, `cmask_${n}.png`);
    fs.writeFileSync(file, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
    customMaskFiles[clipId] = file;
  }
  const withAssets = {
    ...project,
    maskFiles,
    decoFiles,
    customMaskFiles,
  };
  let proc = null;
  let canceled = false;
  let skipped = []; // P0-01 (#16): clips dropped for missing files, for the done card.
  const once = (info) => new Promise((resolve, reject) => {
    const { args, total, skipped: skippedNow } = buildExportArgs(withAssets, outFile, { encoder: info.encoder, vaapiDevice: info.device });
    skipped = skippedNow || [];
    // A proven hardware pick may live in a system FFmpeg (see pickEncoderInfo);
    // everything else — and every CPU encode — runs the bundled binary.
    proc = trackExportProc(spawn(info.binary || ffmpegPath, graphFile(args, tmpDir), { windowsHide: true }));
    // Perf mode (Low-End): run the encoder below normal priority so the PC stays
    // responsive during exports. Scheduling only — the graph and output are identical.
    if (runOpts.nice) { try { os.setPriority(proc.pid, runOpts.nice); } catch { /* not permitted on every platform */ } }
    let log = '';
    const progress = createProgressParser(total, onProgress);
    proc.stdout.on('data', (d) => progress.feed(d));
    proc.stderr.on('data', (d) => {
      log += d;
      if (log.length > 20000) log = log.slice(-20000);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      // A cancel outranks the exit code: a killed encode exits non-zero (or, racing the
      // final flush, even 0) and either way the job's verdict is "canceled".
      if (canceled) return reject(new Error('Export canceled'));
      return code === 0 ? resolve() : reject(attachExportError(new Error(`FFmpeg failed (code ${code}):\n${log.slice(-3000)}`), { log, project }));
    });
  });
  const promise = (async () => {
    try {
      const info = await pickEncoderInfo();
      // Cancel token, checked at the phase boundary: a cancel that landed while the
      // encoder probe ran (proc still null, nothing to kill) must prevent the spawn —
      // previously it killed nothing and the export started anyway.
      if (canceled) throw new Error('Export canceled');
      try {
        await once(info);
      } catch (e) {
        if (canceled || info.encoder === 'libx264') throw e;
        // The graphics card's encoder failed on this export (driver, size limit…): redo it on the CPU, and keep
        // using the CPU from now on.
        resetEncoderPick();
        onProgress?.(0);
        await once(cpuPick());
      }
      onProgress?.(1);
      return outFile;
    } finally {
      // P1-52: the export settled — a pause must never leak into the next job.
      clearExportPause();
      // A cancelled export leaves no partial file behind: the path is the export's own
      // target (the encoder would have overwritten it anyway), never a finished output —
      // a completed encode resolves before cancel can be observed here.
      if (canceled) { try { fs.rmSync(outFile, { force: true }); } catch { /* nothing to clean */ } }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })();
  // `skipped` is a getter: it is only filled once the graph is built inside
  // the promise above, which always happens before the promise settles.
  return { promise, cancel: () => { canceled = true; proc?.kill('SIGKILL'); }, get skipped() { return skipped; } };
}

// Converts any audio file (e.g. a MediaRecorder .webm voice-over) to .m4a so it has a proper duration.
function toM4a(input, output) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-c:a', 'aac', '-b:a', '160k', output], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve(output) : reject(new Error(err))));
  });
}

function runFfmpegOn(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-2000)))));
  });
}
function runFfmpeg(args) {
  return runFfmpegOn(ffmpegPath, args);
}

// Timeline visuals, cached in `cacheDir` by path + size + mtime:
// - a thumbnail sprite: `thumbCount` frames side by side, frame k shows time k * thumbInterval
//   (thumbW x thumbH each). A fast keyframe-only pass is reported first, then an exact pass.
// - an audio waveform image spanning the whole file.
// onUpdate(partial) is called as each piece becomes available. Failures are non-fatal.
async function makeVisuals(item, cacheDir, onUpdate = () => {}, opts = {}) {
  const st = fs.statSync(item.path);
  // v3 (W4, 2026-11-01): visuals now include a dedicated full-frame poster (below) — the
  // version bump makes media cached under v2 regenerate once so posters appear everywhere.
  // opts.lite (Performance mode / Low-End): a cheaper sprite (half the frames, shorter,
  // keyframe pass only — the exact full-decode pass is skipped) and a narrower waveform.
  // The lite files cache under their own key suffix so the two modes never collide.
  // v4 (P4, 2026-11-10): the waveform render changed (teal, ~0.75 amplitude) —
  // the bump makes media cached under v3 regenerate once so clips repaint.
  const key = require('crypto').createHash('sha1').update(`${item.path}|${st.size}|${st.mtimeMs}|v4${opts.lite ? '|lite1' : ''}`).digest('hex').slice(0, 16);
  fs.mkdirSync(cacheDir, { recursive: true });
  const metaFile = path.join(cacheDir, `${key}-visuals.json`);
  if (fs.existsSync(metaFile)) {
    const cached = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    if ([cached.thumb, cached.wave, cached.poster].every((f) => !f || fs.existsSync(f))) {
      onUpdate(cached);
      return cached;
    }
  }
  const out = {};
  if (item.type === 'video' && item.duration > 0) {
    const count = opts.lite
      ? Math.min(60, Math.max(8, Math.ceil(item.duration / 2)))
      : Math.min(120, Math.max(8, Math.ceil(item.duration)));
    const interval = item.duration / count;
    const th = opts.lite ? 60 : 90;
    const tw = Math.max(2, Math.round((th * (item.width || 16)) / (item.height || 9) / 2) * 2);
    // tpad clones the last frame so fps always produces `count` frames and the tile is complete.
    const vf = `tpad=stop_mode=clone:stop_duration=${(interval * 2).toFixed(3)},fps=1/${interval.toFixed(4)},` +
      `scale=${tw}:${th},tile=${count}x1:padding=0`;
    const meta = { thumbCount: count, thumbInterval: interval, thumbW: tw, thumbH: th };
    const fast = path.join(cacheDir, `${key}-sprite-fast.jpg`);
    await runFfmpeg(['-skip_frame', 'nokey', '-i', item.path, '-an', '-vf', vf, '-frames:v', '1', '-q:v', '6', fast]).catch(() => {});
    if (fs.existsSync(fast)) onUpdate({ ...meta, thumb: fast });
    if (!opts.lite) {
      // The exact pass decodes every sampled frame — the expensive half of the
      // sprite's cost. Lite mode keeps the keyframe sprite and skips it.
      const exact = path.join(cacheDir, `${key}-sprite.jpg`);
      await runFfmpeg(['-i', item.path, '-an', '-vf', vf, '-frames:v', '1', '-q:v', '5', exact]).catch(() => {});
      if (fs.existsSync(exact)) {
        Object.assign(out, meta, { thumb: exact });
        onUpdate({ ...meta, thumb: exact });
      }
    }
    if (!out.thumb && fs.existsSync(fast)) Object.assign(out, meta, { thumb: fast });
    // W4: a dedicated POSTER frame for project cards. The sprite frames are only 90 px
    // tall (a portrait frame is ~52x90) — showing one at card size is the blurry smear
    // Hamza reported. The poster is one frame at 640 px on its long edge, taken a little
    // into the file (min(2 s, ~10% of duration), at least 0.4 s in) so it is a stable,
    // representative frame rather than a fade-in instant or a mid-transition blur.
    const poster = path.join(cacheDir, `${key}-poster.jpg`);
    const pt = Math.min(2, Math.max(0.4, item.duration * 0.1));
    await runFfmpeg(['-ss', pt.toFixed(3), '-i', item.path, '-an', '-frames:v', '1',
      '-vf', 'scale=640:640:force_original_aspect_ratio=decrease', '-q:v', '3', poster]).catch(() => {});
    if (fs.existsSync(poster)) {
      out.poster = poster;
      onUpdate({ poster });
    }
  }
  if (item.hasAudio && item.duration > 0) {
    const wave = path.join(cacheDir, `${key}-wave.png`);
    const w = opts.lite
      ? Math.min(2000, Math.max(300, Math.round(item.duration * 20)))
      : Math.min(8000, Math.max(600, Math.round(item.duration * 60)));
    // P4 (2026-11-10): the wave renders in the timeline's teal (#2dd4bf) on a
    // dark ground, and a volume=0.6 stage before the sqrt-scaled picture keeps
    // speech peaks at ~0.75 of the strip height — the old chain (compand
    // makeup gain straight into sqrt, then a CSS brightness lift) drew a
    // permanently clipped-looking white block.
    await runFfmpeg(['-i', item.path, '-vn', '-filter_complex',
      `aformat=channel_layouts=mono,compand=gain=4,volume=0.6,showwavespic=s=${w}x96:colors=0x2dd4bf:scale=sqrt`, '-frames:v', '1', wave]).catch(() => {});
    if (fs.existsSync(wave)) {
      out.wave = wave;
      onUpdate({ wave });
    }
  }
  fs.writeFileSync(metaFile, JSON.stringify(out), 'utf8');
  return out;
}

// A generated copy only counts if it is a real, non-empty file. A directory, a zero-byte
// stub or a corrupt leftover at the copy path used to be handed to the player as "ready"
// (existsSync was the only check), which produced a permanent black picture with
// MEDIA_ERR_SRC_NOT_SUPPORTED (QA audit #2, 2026-11-05, RC2).
function usableCopyFile(p) {
  try { const s = fs.statSync(p); return s.isFile() && s.size > 0; } catch { return false; }
}

// The cached copy at `out`, or null when there is nothing usable there — in which case
// whatever sits at the path is removed so the copy can be regenerated cleanly.
function cachedCopy(out) {
  if (usableCopyFile(out)) return out;
  if (fs.existsSync(out)) { try { fs.rmSync(out, { recursive: true, force: true }); } catch { /* the regeneration below surfaces the failure */ } }
  return null;
}

// A freshly made copy must actually contain the picture: ffmpeg exits 0 even when it only
// decoded part of a corrupt source, so probe the result and require a video stream whose
// duration covers nearly all of the source (QA2 RC2b). A short copy is deleted and the
// generation counts as failed.
async function assertCopyComplete(out, item) {
  const info = await probe(out).catch(() => null);
  if (!info || info.type !== 'video' || !(info.duration > 0) || (item && item.duration > 0 && info.duration < item.duration * 0.85)) {
    try { fs.rmSync(out, { force: true }); } catch { /* ignore */ }
    throw new Error('The preview copy came out incomplete.');
  }
}

// Containers Chromium cannot be trusted to demux in a <video> element, whatever the codec
// inside: AVI fails outright (MEDIA_ERR_SRC_NOT_SUPPORTED), MKV is marginal — metadata
// and audio load and the clock advances, but frames may never paint (QA audit #2,
// 2026-11-05, RC1). Files in these containers always get a preview copy; the export
// still reads the original.
const PREVIEW_HOSTILE_EXTS = ['mkv', 'avi', 'ts', 'm2ts', 'mts', 'flv', 'wmv', 'mpg', 'mpeg', 'vob', 'asf', 'divx', 'rm', 'rmvb'];

// The player (Chromium) only decodes 8-bit 4:2:0 H.264 / VP8 / VP9 / AV1 smoothly. 10-bit or 4:2:2 video, HEVC,
// ProRes and pictures above 1080p play with a stuck or black picture, so they get a light preview copy (proxy),
// The export always uses the original file.
function needsProxy(info) {
  if (!info || info.type !== 'video') return false;
  const ext = path.extname(info.path || '').slice(1).toLowerCase();
  if (PREVIEW_HOSTILE_EXTS.includes(ext)) return true;
  const okCodec = ['h264', 'vp8', 'vp9', 'av1'].includes(info.vcodec);
  const okPix = ['yuv420p', 'yuvj420p'].includes(info.pixFmt);
  const big = (info.width || 0) * (info.height || 0) > 1920 * 1088;
  return !!info.hdr || !okCodec || !okPix || big || /high 10|4:2:2|4:4:4/i.test(info.profile || '');
}

// Background picture for a scene without footage (intro, title card, end card): one color, or a gradient from
// `color` to `color2` (direction: horizontal, vertical or diagonal). Colors are #rrggbb. Cached per look and size.
async function makeScene({ color, color2, direction = 'diagonal', width, height }, cacheDir) {
  const hex = (c) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? String(c).toLowerCase() : null);
  const c0 = hex(color);
  const c1 = color2 ? hex(color2) : null;
  if (!c0 || (color2 && !c1)) throw new Error('Scene colors must be #rrggbb.');
  const w = Math.max(16, Math.min(4096, Math.round(width / 2) * 2));
  const h = Math.max(16, Math.min(4096, Math.round(height / 2) * 2));
  const dir = ['horizontal', 'vertical', 'diagonal'].includes(direction) ? direction : 'diagonal';
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = path.join(cacheDir, `scene-${c0.slice(1)}${c1 ? `-${c1.slice(1)}-${dir}` : ''}-${w}x${h}.png`);
  if (fs.existsSync(out)) return out;
  let vf = `color=c=${c0.replace('#', '0x')}:s=${w}x${h}`;
  if (c1) {
    // Each channel goes from c0 to c1 along the direction (geq: X, Y, W, H are the pixel and the frame size).
    const t = { horizontal: 'X/W', vertical: 'Y/H', diagonal: '(X/W+Y/H)/2' }[dir];
    const ch = (c, i) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
    const lerp = (i) => `${ch(c0, i)}+(${ch(c1, i) - ch(c0, i)})*${t}`;
    vf = `color=c=black:s=${w}x${h},format=rgb24,geq=r='${lerp(0)}':g='${lerp(1)}':b='${lerp(2)}'`;
  }
  await runFfmpeg(['-f', 'lavfi', '-i', vf, '-frames:v', '1', `${out}.part.png`]);
  fs.renameSync(`${out}.part.png`, out);
  return out;
}

// 720p H.264 copy with a keyframe every half second (fast seeking), same timing and sound. Cached per file.
async function makeProxy(item, cacheDir) {
  const st = fs.statSync(item.path);
  // HDR files get a new, SDR proxy (the key changes), so the player shows the colors the export gives.
  const key = require('crypto').createHash('sha1').update(`${item.path}|${st.size}|${st.mtimeMs}|proxy1${item.hdr ? '-sdr' : ''}`).digest('hex').slice(0, 16);
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = path.join(cacheDir, `${key}-proxy.mp4`);
  const hit = cachedCopy(out);
  if (hit) return hit;
  const part = path.join(cacheDir, `${key}-proxy.part.mp4`);
  // Down to 720p first: the HDR tone mapping works in floating point, so it runs on 9x fewer pixels for 4K.
  // (At 720p libx264 is as fast as a graphics card encoder here: decoding and tone mapping take the time.)
  await runFfmpeg(['-i', item.path, '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', `scale=w='min(1280,iw)':h=-2${item.hdr ? `,${TONEMAP}` : ''},format=yuv420p`,
    ...(item.hdr ? ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-g', '15', '-keyint_min', '15', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', part]);
  fs.renameSync(part, out);
  await assertCopyComplete(out, item);
  return out;
}

// Light proxy for the Proxy setting (weak PCs): every video gets one, 540 px on its shorter side, quick to make
// and to decode (fastdecode), keyframes every half second for fast seeking. Only the player uses it; the export
// always reads the original. Cached per file, next to the other proxies ("-lproxy.mp4").
async function makeLightProxy(item, cacheDir) {
  const st = fs.statSync(item.path);
  const key = require('crypto').createHash('sha1').update(`${item.path}|${st.size}|${st.mtimeMs}|lproxy1${item.hdr ? '-sdr' : ''}`).digest('hex').slice(0, 16);
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = path.join(cacheDir, `${key}-lproxy.mp4`);
  const hitL = cachedCopy(out);
  if (hitL) return hitL;
  const part = path.join(cacheDir, `${key}-lproxy.part.mp4`);
  await runFfmpeg(['-i', item.path, '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', `scale=w='if(gt(iw,ih),-2,min(540,iw))':h='if(gt(iw,ih),min(540,ih),-2)'${item.hdr ? `,${TONEMAP}` : ''},format=yuv420p`,
    ...(item.hdr ? ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'] : []),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'fastdecode', '-crf', '27', '-g', '15', '-keyint_min', '15', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', part]);
  fs.renameSync(part, out);
  await assertCopyComplete(out, item);
  return out;
}

// Playback-quality copy for one level ('high' | 'medium' | 'low'): the picture scaled so its longest
// side is at most the level's cap (1280 / 960 / 640), never upscaled — a source that already fits
// returns null and the player keeps the full-quality chain. Same recipe family as the light proxy
// (fast seeking keyframes, fastdecode); higher levels keep more bitrate. Only the player uses these
// ("-q<level>.mp4" in the cache); the export always reads the original.
const { qualityTargetSize, qualityScaleFilter } = require('./quality.cjs');
async function makeQualityProxy(item, cacheDir, quality) {
  if (!qualityTargetSize(item.width, item.height, quality)) return null;
  const st = fs.statSync(item.path);
  const key = require('crypto').createHash('sha1').update(`${item.path}|${st.size}|${st.mtimeMs}|q${quality}1${item.hdr ? '-sdr' : ''}`).digest('hex').slice(0, 16);
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = path.join(cacheDir, `${key}-q${quality}.mp4`);
  const hitQ = cachedCopy(out);
  if (hitQ) return hitQ;
  const part = path.join(cacheDir, `${key}-q${quality}.part.mp4`);
  const crf = { high: 23, medium: 26, low: 28 }[quality] || 26;
  await runFfmpeg(['-i', item.path, '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', `${qualityScaleFilter(quality)}${item.hdr ? `,${TONEMAP}` : ''},format=yuv420p`,
    ...(item.hdr ? ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'] : []),
    // ultrafast at every level: the copy is preview-only, and the build happens in the background
    // while the original keeps playing — a faster build is worth more than the last bit of
    // compression efficiency. Measured on a 60 s 1080p source in the dev sandbox: High 32.0 s ->
    // 19.0 s, Medium 18.5 s -> 16.4 s, Low 17.0 s -> 13.7 s (decode of the source is the floor).
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'fastdecode', '-crf', String(crf), '-g', '15', '-keyint_min', '15', '-sc_threshold', '0',
    // AAC sound is copied, not re-encoded (the common case for MP4 sources); anything else is
    // re-encoded to AAC so the copy always plays.
    ...(item.acodec === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', quality === 'high' ? '128k' : '96k']),
    '-movflags', '+faststart', part]);
  fs.renameSync(part, out);
  await assertCopyComplete(out, item);
  return out;
}

// Small frames of a clip for Adjust > Auto: `count` pictures spread over [from, to] (source seconds), 160 px wide,
// as raw RGB. HDR is mapped to normal colors first, like the export does. A photo gives one frame.
async function sampleFrames(item, from, to, count = 8) {
  const { spawn } = require('child_process');
  const one = (t) => new Promise((resolve) => {
    const args = ['-v', 'error', ...(t != null ? ['-ss', String(Math.max(0, t))] : []), '-i', item.path, '-frames:v', '1',
      '-vf', `scale=160:-2${toSdr(item)},format=rgb24`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'];
    const p = spawn(ffmpegPath, args, { windowsHide: true });
    const chunks = [];
    p.stdout.on('data', (d) => chunks.push(d));
    p.on('error', () => resolve(null));
    p.on('close', () => {
      const data = Buffer.concat(chunks);
      const width = 160;
      const height = Math.floor(data.length / (width * 3));
      resolve(height > 0 ? { data: new Uint8Array(data.subarray(0, width * height * 3)), width, height } : null); // its own copy for IPC
    });
  });
  if (item.type === 'image') return [await one(null)].filter(Boolean);
  const a = Math.max(0, from || 0);
  const b = Math.max(a + 0.05, Math.min(to || item.duration || a + 1, (item.duration || Infinity) - 0.05));
  const times = Array.from({ length: count }, (_, i) => a + ((i + 0.5) / count) * (b - a));
  return (await Promise.all(times.map(one))).filter(Boolean);
}

module.exports = {
  sampleFrames,
  audioFxPathOf, enhancePathOf, interpFilter, INTERP_COST,
  toSdr, colorFix, stillInput, graphFile, pickEncoder, pickEncoderInfo, resetEncoderPick, binaryHasEncoder, encoderBinaries, probeEncodeArgs, vaapiDevice, hasEncoder, hasLibx265, hasVp9, effectiveExport, makeScene, needsProxy, usableCopyFile, makeProxy, makeLightProxy, makeQualityProxy, ffmpegPath, ffprobePath, probe, fitSize, narrowClip, buildExportArgs, buildAudioExportArgs, buildTimelineAudioArgs, exportAudio, runAudioExport, audioExportTotal, runExport, toM4a, renderMainAudio, renderTimelineAudio, detectSilences, makeVisuals, parseProgressValues, createProgressParser, missingMediaClips };
