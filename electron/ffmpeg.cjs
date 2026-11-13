// Builds FFmpeg arguments for exporting a project to MP4.
// Pure module (no Electron imports) so it can be tested from plain Node.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
const ffprobePath = require('ffprobe-static').path.replace('app.asar', 'app.asar.unpacked');

const layers = require('./layers.cjs');
const { audioFxFilters } = require('./audiofx.cjs');
const sc = require('./speedcurve.cjs');
const vk = require('./volkeys.cjs');

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'];

const num = (n) => Number(n).toFixed(3);
const hex = (c, def = '#ffffff') => (c || def).replace('#', '0x');

// The decode source for a media item: its auto-remux copy when one exists and
// is usable, else the original file. A remux is a stream copy — same streams,
// same timing — in a fast-seeking container (see electron/remux.cjs), so the
// decode-side graphs (video export, audio export) read it transparently; the
// original is never modified and is the fallback the moment the copy is gone.
const mediaMap = (project) => Object.fromEntries((project.media || []).map((m) => [m.id,
  (m && typeof m.remux === 'string' && usableCopyFile(m.remux)) ? { ...m, path: m.remux } : m]));

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
        // Frame rate from the stream's average (or nominal) rate, rounded (29.97 -> 30).
        fps: v ? Math.round((() => { const r = String(v.avg_frame_rate || v.r_frame_rate || '0/1').split('/'); return (parseFloat(r[0]) || 0) / (parseFloat(r[1]) || 1); })()) : 0,
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

function atempo(speed) {
  const out = [];
  let s = speed;
  while (s > 2) { out.push('atempo=2'); s /= 2; }
  while (s < 0.5) { out.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-3) out.push(`atempo=${s.toFixed(4)}`);
  return out;
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
function clipVideoFilters(clip, m, W, H, fps, background) {
  const fix = colorFixFor(clip, m);
  return [
    `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${hex(background, '#000000')}`,
    'setsar=1',
    // Non-709 sources convert HERE — after the last scale (see colorFixFor).
    ...(fix ? [fix.slice(1)] : []),
    `fps=${fps}`,
    'format=yuv420p',
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
  if (audioFxFilters(clip.audioFx).join(',') !== r.chain) return null;
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

function clipAudioFilter(clip, m, idx, i, enhIdx = -1, seeked = false, fxIdx = -1) {
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
  const tail = [
    ...vk.volChainFor(clip, len), ...audioFades(clip, len), 'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo',
    ...(fxIdx >= 0 ? [] : audioFxFilters(clip.audioFx)),
    `apad=whole_dur=${num(len)}`, `atrim=duration=${num(len)}`];
  // A speed curve retimes the sound segment by segment (the presented stream
  // starts at the clip's in-point in every branch above, so the sampler's
  // source offsets address it directly); anything else keeps the one atempo.
  if (sc.hasCurve(clip)) {
    return curveAudioGraph(clip, [...src, ...(up ? [up] : [])].join(','), tail, `a${i}`, `ca${i}`);
  }
  return [...src, ...(up ? [up] : []), ...atempo(clip.speed || 1), ...tail].join(',') + `[a${i}]`;
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
    for (let i = 1; i < clips.length; i++) {
      const td = transitionDur(clips, i);
      filters.push(td > 0 ? `[${ca}][a${i}]acrossfade=d=${num(td)}[ja${i}]` : `[${ca}][a${i}]concat=n=2:v=0:a=1[ja${i}]`);
      ca = `ja${i}`;
    }
    filters.push(`[${ca}]aresample=16000,aformat=sample_fmts=fltp:channel_layouts=mono[main]`);
    mix.push('[main]');
  }

  const extra = source === 'video' ? [] : project.audioClips.filter((c) => mediaById[c.mediaId] && mediaById[c.mediaId].hasAudio);
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

function pictureSource(clip, m, len, fps, addInput) {
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
  const idx = addInput(['-ss', num(clip.in), '-i', m.path]);
  const timing = sc.hasCurve(clip) ? speedSetpts(clip) : `setpts=(PTS-STARTPTS)/${clip.speed || 1}`;
  return { idx, chain: `[${idx}:v]trim=duration=${num(clip.out - clip.in)},${timing}${toSdr(m)}`, own: true, audioSeeked: true };
}

// opts.raw: only the main track's picture, as raw RGBA frames on stdout (frames for the effects pass).
// opts.encoder: H.264 encoder (see pickEncoder); libx264 when not given.
function buildExportArgs(project, outFile, opts = {}) {
  const { width: W, height: H, fps } = project;
  const bg = project.background || '#000000';
  const eff = effectiveExport(project);
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
  if (clips.length === 0) throw new Error('The video track is empty.');

  // 1) Main track: prepare each clip (trim, speed, size, look) with a matching audio stream.
  clips.forEach((clip, i) => {
    const m = mediaById[clip.mediaId];
    const len = clipLen(clip);
    const speed = clip.speed || 1;
    if (clip.gap) {
      // A gap on the main track: the project background, in silence.
      filters.push(`color=c=${hex(bg, '#000000')}:s=${W}x${H}:r=${fps}:d=${num(len)},format=yuv420p[v${i}]`);
      if (!opts.raw && wantAudio) filters.push(clipAudioFilter(clip, null, -1, i));
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
      const layer = layers.buildLayer({ clip, media: m, W, H, fps, len, tag, srcLabel, maskIdx, decoIdx, motion, matteLabel, customMaskIdx }, { num, hex, colorFixFor });
      filters.push(...layer.filters);
      filters.push(`color=c=${hex(bg, '#000000')}:s=${W}x${H}:r=${fps}:d=${num(len)},format=yuv420p[bg${tag}]`);
      filters.push(...layers.composite({ base: `bg${tag}`, layer: layer.out, blend: clip.blend, tag, out: `v${i}` }));
    };
    const src = pictureSource(clip, m, len, fps, addInput);
    if (layered) {
      filters.push(`${src.chain},fps=${fps}[s${i}]`);
      renderLayered(`s${i}`);
    } else {
      filters.push(`${src.chain},${clipVideoFilters(clip, m, W, H, fps, bg)}[v${i}]`);
    }
    // Sound comes from the media even when the picture was pre-rendered. A dedicated
    // audio input (picture came from an override file) is input-seeked too (B1).
    const audioIdx = src.own || m.type === 'image' || !m.hasAudio || clip.muted ? src.idx : addInput(['-ss', num(clip.in), '-i', m.path]);
    const enhP = !opts.raw && enhancePathOf(clip);
    const enhIdx = enhP ? addInput(['-i', enhP]) : -1;
    const fxP = !opts.raw && audioFxPathOf(clip, m);
    const fxIdx = fxP ? addInput(['-i', fxP]) : -1;
    if (!opts.raw && wantAudio) filters.push(clipAudioFilter(clip, m, src.own ? src.idx : audioIdx, i, enhIdx, src.own ? !!src.audioSeeked : true, fxIdx));
  });

  // 2) Join clips: xfade/acrossfade where a transition is set, plain concat otherwise.
  let cv = 'v0';
  let ca = 'a0';
  let end = clipLen(clips[0]);
  for (let i = 1; i < clips.length; i++) {
    const td = transitionDur(clips, i);
    const start = end - td;
    const seg = td > 0 && project.fxSegments && project.fxSegments[clips[i].id];
    if (seg) {
      // Animated transition rendered by the effects pass: what came before, the transition, the rest of the clip.
      const sIdx = addInput(['-i', seg]);
      filters.push(
        `[${cv}]trim=duration=${num(start)},setpts=PTS-STARTPTS,setsar=1[jA${i}]`,
        `[${sIdx}:v]trim=duration=${num(td)},setpts=PTS-STARTPTS,fps=${fps},scale=${W}:${H},setsar=1,format=yuv420p[jT${i}]`,
        `[v${i}]trim=start=${num(td)},setpts=PTS-STARTPTS,setsar=1[jB${i}]`,
        `[jA${i}][jT${i}][jB${i}]concat=n=3:v=1:a=0[jv${i}]`,
      );
      if (wantAudio) filters.push(`[${ca}][a${i}]acrossfade=d=${num(td)}[ja${i}]`);
    } else if (td > 0) {
      // xfade needs both inputs on the same time base (after an animated transition the video so far has another one).
      filters.push(
        `[${cv}]settb=1/${fps}[xa${i}]`, `[v${i}]settb=1/${fps}[xb${i}]`,
        `[xa${i}][xb${i}]xfade=transition=${clips[i].transition.type}:duration=${num(td)}:offset=${num(start)}[jv${i}]`,
      );
      if (wantAudio) filters.push(`[${ca}][a${i}]acrossfade=d=${num(td)}[ja${i}]`);
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
    const src = pictureSource(c, m, len, fps, addInput);
    filters.push(`${src.chain},fps=${fps}[os${j}]`);
    const idx = src.own ? src.idx : m.hasAudio && !c.muted && m.type === 'video' ? addInput(['-ss', num(c.in), '-i', m.path]) : src.idx;
    const maskFile = project.maskFiles && project.maskFiles[c.id];
    const maskIdx = maskFile ? addInput(['-loop', '1', '-framerate', String(fps), '-t', num(len), '-i', maskFile]) : null;
    const decoFile = maskFile && project.decoFiles && project.decoFiles[c.id];
    const decoIdx = decoFile ? addInput(['-loop', '1', '-framerate', String(fps), '-t', num(len), '-i', decoFile]) : null;
    const cmFile = project.customMaskFiles && project.customMaskFiles[c.id];
    const customMaskIdx = cmFile ? addInput(['-loop', '1', '-framerate', String(fps), '-t', num(len), '-i', cmFile]) : null;
    const motion = project.motion && project.motion[c.id];
    const matteLabel = matteSource(c, m, fps, addInput, tag, filters);
    const layer = layers.buildLayer({ clip: c, media: m, W, H, fps, len, tag, srcLabel: `os${j}`, maskIdx, decoIdx, motion, matteLabel, customMaskIdx }, { num, hex, colorFixFor });
    filters.push(...layer.filters);
    // Transparent frames before and after, so the layer lines up with the video frame for frame.
    const after = Math.max(0, total - start - len);
    filters.push(`[${layer.out}]tpad=start_duration=${num(start)}:stop_duration=${num(after)}:start_mode=add:stop_mode=add:color=black@0,trim=duration=${num(total)}[op${j}]`);
    filters.push(...layers.composite({ base: cv, layer: `op${j}`, blend: c.blend, tag, out: `ov${j}` }));
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
    const src = pictureSource(c, m, len, fps, addInput);
    filters.push(`${src.chain},fps=${fps}[ss${j}]`);
    const layer = layers.buildLayer({ clip: c, media: m, W, H, fps, len, tag, srcLabel: `ss${j}` }, { num, hex, colorFixFor });
    filters.push(...layer.filters);
    const after = Math.max(0, total - start - len);
    filters.push(`[${layer.out}]tpad=start_duration=${num(start)}:stop_duration=${num(after)}:start_mode=add:stop_mode=add:color=black@0,trim=duration=${num(total)}[sp${j}]`);
    filters.push(...layers.composite({ base: cv, layer: `sp${j}`, blend: c.blend, tag, out: `sv${j}` }));
    cv = `sv${j}`;
  });

  // 4) Text layer: frames drawn by the UI's canvas text renderer (same code as the preview), packed in text.mov.
  if (project.textOverlay && project.textOverlay.count > 0) {
    const idx = addInput(['-i', project.textOverlay.file]);
    filters.push(`[${idx}:v]format=rgba[txt]`);
    filters.push(`[${cv}][txt]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[tv]`);
    cv = 'tv';
  }

  // 5) Music track and overlay sound: trim, fade, delay to timeline position, mix with the main audio.
  if (wantAudio) {
  const music = project.audioClips.filter((c) => mediaById[c.mediaId]);
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
    if (!fxP) tail.push(...audioFxFilters(c.audioFx)); // a valid derivative already carries the chain
    tail.push('aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', `adelay=${delay}|${delay}`);
    filters.push(sc.hasCurve(c)
      ? curveAudioGraph(c, `[${idx}:a]${head.join(',')}`, tail, `m${j}`, `mu${j}`)
      : `[${idx}:a]${[...head, ...atempo(c.speed || 1), ...tail].join(',')}[m${j}]`);
    mixLabels.push(`[m${j}]`);
  });
  overlayAudio.forEach(({ idx, c, len, start, sp, enh, fx }, j) => {
    const delay = Math.round(start * 1000);
    const up = monoUp(mediaById[c.mediaId], !!enh);
    // B1: idx always names an input seeked to c.in (or a pre-trimmed enhanced / effected render),
    // so the trim runs from 0.
    const head = [`atrim=start=0:end=${num(c.out - c.in)}`, 'asetpts=PTS-STARTPTS', ...(up ? [up] : [])];
    const tail = [...vk.volChainFor(c, len), ...audioFades(c, len),
      'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', ...(fx ? [] : audioFxFilters(c.audioFx)), `adelay=${delay}|${delay}`];
    filters.push(sc.hasCurve(c)
      ? curveAudioGraph(c, `[${idx}:a]${head.join(',')}`, tail, `oa${j}`, `ov${j}`)
      : `[${idx}:a]${[...head, ...atempo(sp), ...tail].join(',')}[oa${j}]`);
    mixLabels.push(`[oa${j}]`);
  });
  if (mixLabels.length > 1) {
    filters.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:normalize=0[amix]`);
    ca = 'amix';
  }
  }

  // 6) Output stage: the effective export settings' resolution cap (downscale only) and fps resample,
  // applied to the finished picture — every layer above stays at project size.
  let outLabel = cv;
  const stage = [];
  if (eff.outW !== W || eff.outH !== H) stage.push(`scale=${eff.outW}:${eff.outH}:flags=lanczos`);
  if (eff.outFps !== fps) stage.push(`fps=${eff.outFps}`);
  if (stage.length) { filters.push(`[${cv}]${stage.join(',')},format=yuv420p[ovfinal]`); outLabel = 'ovfinal'; }

  // VAAPI encodes from GPU surfaces: as the graph's last step the finished
  // picture is converted to NV12 and uploaded, and the encode runs on the
  // device named by the head option in the final args. Only the MP4/MOV
  // stage consumes an encoder — GIF and WebM never reach it.
  const vaapi = opts.encoder === 'h264_vaapi' && opts.vaapiDevice && eff.format !== 'gif' && eff.format !== 'webm' ? opts.vaapiDevice : null;
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
      ...videoCodec2(opts.encoder, eff), ...(vaapi ? [] : ['-pix_fmt', 'yuv420p']),
      // The pipeline works in BT.709 SDR throughout (HDR inputs are tone-mapped to BT.709 above);
      // tag it explicitly — untagged yuv420p otherwise probes as color_* "unknown".
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
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
  return { args, total };
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
      filters.push(clipAudioFilter(clip, m, has ? addInput(['-ss', num(clip.in), '-i', m.path]) : -1, i, enhP ? addInput(['-i', enhP]) : -1, true, fxP ? addInput(['-i', fxP]) : -1));
    });
    let ca = 'a0';
    for (let i = 1; i < clips.length; i++) {
      const td = transitionDur(clips, i);
      filters.push(td > 0 ? `[${ca}][a${i}]acrossfade=d=${num(td)}[ja${i}]` : `[${ca}][a${i}]concat=n=2:v=0:a=1[ja${i}]`);
      ca = `ja${i}`;
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
    const oTail = [...vk.volChainFor(c, clipLen(c)), ...audioFades(c, clipLen(c)), ...(fxP ? [] : audioFxFilters(c.audioFx)), 'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', `adelay=${delay}|${delay}`];
    filters.push(sc.hasCurve(c)
      ? curveAudioGraph(c, `[${oIdx}:a]${oHead.join(',')}`, oTail, `oa${j}`, `ao${j}`)
      : `[${oIdx}:a]${[...oHead, ...atempo(c.speed || 1), ...oTail].join(',')}[oa${j}]`);
    mix.push(`[oa${j}]`);
  });
  project.audioClips.filter((c) => mediaById[c.mediaId]).forEach((c, j) => {
    sound = true;
    const len = clipLen(c);
    const delay = Math.round(c.start * 1000);
    const enhP = enhancePathOf(c);
    const fxP = audioFxPathOf(c, mediaById[c.mediaId]);
    const up = monoUp(mediaById[c.mediaId], !!(enhP || fxP));
    const aIdx = addInput(fxP ? ['-i', fxP] : enhP ? ['-i', enhP] : ['-ss', num(c.in), '-i', mediaById[c.mediaId].path]);
    const head = [`atrim=start=0:end=${num(c.out - c.in)}`, 'asetpts=PTS-STARTPTS', ...(up ? [up] : [])];
    const tail = [...vk.volChainFor(c, len), ...audioFades(c, len)];
    if (!fxP) tail.push(...audioFxFilters(c.audioFx)); // a valid derivative already carries the chain
    tail.push('aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', `adelay=${delay}|${delay}`);
    filters.push(sc.hasCurve(c)
      ? curveAudioGraph(c, `[${aIdx}:a]${head.join(',')}`, tail, `m${j}`, `am${j}`)
      : `[${aIdx}:a]${[...head, ...atempo(c.speed || 1), ...tail].join(',')}[m${j}]`);
    mix.push(`[m${j}]`);
  });
  if (!sound) throw new Error('Nothing to export: no clip on the timeline has sound.');
  filters.push(mix.length === 1 ? `${mix[0]}anull[out]` : `${mix.join('')}amix=inputs=${mix.length}:duration=longest:normalize=0[out]`);
  const eff = effectiveExport(project);
  const codec = {
    mp3: ['-c:a', 'libmp3lame', '-b:a', `${eff.audioKbps}k`],
    wav: ['-c:a', opts.floatWav ? 'pcm_f32le' : 'pcm_s16le'],
    m4a: ['-c:a', 'aac', '-b:a', `${eff.audioKbps}k`],
  }[format];
  if (!codec) throw new Error(`Unknown audio format: ${format}`);
  return ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', ...codec, '-progress', 'pipe:1', '-nostats', outFile];
}

// The audio mix's timeline length — the progress denominator for the audio job. Mirrors the
// builder above: the main track's concat/crossfade recurrence, extended by any overlay or
// audio-track clip that ends later (the mix itself runs duration=longest).
function audioExportTotal(project) {
  const mediaById = Object.fromEntries((project.media || []).map((m) => [m.id, m]));
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
    if (mediaById[c.mediaId]) total = Math.max(total, (c.start || 0) + clipLen(c));
  }
  return total;
}

// ---- Master loudness stage (audio-only export) ----
// The mix is measured with loudnorm's analysis pass and gained to the product's master
// target — the same -14 LUFS / -1 dBTP the per-clip loudnorm uses (audiofx.cjs), applied
// once to the whole mix instead of per clip. A measurement fed forward as a plain gain
// (the matrix §3 design: measure, then a volume filter), never a second dynamic pass over
// clips that may already carry per-clip loudnorm. Silence / unmeasurable input -> gain 0.
const MASTER_LOUDNORM = { I: -14, TP: -1 };
function measureMasterGain(file) {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', () => resolve(0));
    p.on('close', () => {
      const m = err.match(/"input_i"\s*:\s*"([^"]+)"[\s\S]*?"input_tp"\s*:\s*"([^"]+)"/);
      if (!m) return resolve(0);
      const I = Number(m[1]);
      const TP = Number(m[2]);
      if (!Number.isFinite(I)) return resolve(0); // silence measures as -inf: nothing to normalize
      let gain = MASTER_LOUDNORM.I - I;
      if (Number.isFinite(TP)) gain = Math.min(gain, MASTER_LOUDNORM.TP - TP);
      resolve(Math.max(-24, Math.min(24, gain)));
    });
  });
}

// Audio-only export as a JOB, the runExport pattern: { promise, cancel }, progress events,
// cancel checked at every phase boundary, and a cancelled job leaves no partial file.
// Phases: (A) the timeline mixdown rendered once as a float WAV through buildAudioExportArgs,
// (B) the master loudnorm measurement on that mixdown, (C) master gain + the real encode at
// the resolved settings. Rendering the mixdown once is what lets the master stage measure
// the actual mix instead of guessing from the graph.
function runAudioExport(project, outFile, format = 'mp3', onProgress, runOpts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-audio-'));
  const mixWav = path.join(tmpDir, 'mix.wav');
  let proc = null;
  let canceled = false;
  const cancelError = () => new Error('Export canceled');
  const spawnPhase = (args, total, from, to) => new Promise((resolve, reject) => {
    if (canceled) return reject(cancelError());
    proc = spawn(ffmpegPath, graphFile(args, tmpDir), { windowsHide: true });
    if (runOpts.nice) { try { os.setPriority(proc.pid, runOpts.nice); } catch { /* not permitted everywhere */ } }
    let log = '';
    const progress = createProgressParser(total, (v) => onProgress?.(from + v * (to - from)));
    proc.stdout.on('data', (d) => progress.feed(d));
    proc.stderr.on('data', (d) => { log += d; if (log.length > 20000) log = log.slice(-20000); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (canceled) return reject(cancelError());
      return code === 0 ? resolve() : reject(new Error(`FFmpeg failed (code ${code}):\n${log.slice(-3000)}`));
    });
  });
  const promise = (async () => {
    try {
      const total = audioExportTotal(project);
      await spawnPhase(buildAudioExportArgs(project, mixWav, 'wav', { floatWav: true }), total, 0, 0.7);
      const gain = await measureMasterGain(mixWav);
      if (canceled) throw cancelError();
      const eff = effectiveExport(project);
      const codec = {
        mp3: ['-c:a', 'libmp3lame', '-b:a', `${eff.audioKbps}k`],
        wav: ['-c:a', 'pcm_s16le'],
        m4a: ['-c:a', 'aac', '-b:a', `${eff.audioKbps}k`],
      }[format];
      if (!codec) throw new Error(`Unknown audio format: ${format}`);
      const master = Math.abs(gain) >= 0.05 ? ['-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=0.98:level=false`] : [];
      await spawnPhase(['-y', '-hide_banner', '-loglevel', 'error', '-i', mixWav, ...master, ...codec, '-progress', 'pipe:1', '-nostats', outFile], total, 0.7, 1);
      onProgress?.(1);
      return outFile;
    } catch (e) {
      if (canceled) {
        try { fs.rmSync(outFile, { force: true }); } catch { /* nothing to clean */ }
        throw cancelError();
      }
      throw e;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })();
  return { promise, cancel: () => { canceled = true; proc?.kill('SIGKILL'); } };
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
    return withGif({ codecFamily: 'h264', mode: 'crf', crf: project.crf || 20, bitrateMbps: null, encoderPreset: 'veryfast', audioKbps: 192, outW: W, outH: H, outFps: fps, format: 'mp4', subtitleTrack: false, gifSize: 640, gifFps: 15 });
  }
  return withGif({
    codecFamily: e.codecFamily === 'h265' ? 'h265' : 'h264',
    mode: e.mode === 'bitrate' ? 'bitrate' : 'crf',
    crf: clampN(e.crf, 0, 51, 20),
    bitrateMbps: e.bitrateMbps == null ? null : clampN(e.bitrateMbps, 0.5, 100, 12),
    encoderPreset: X264_PRESETS.includes(e.encoderPreset) ? e.encoderPreset : 'veryfast',
    audioKbps: clampN(e.audioKbps, 32, 512, 192),
    // Never upscale, whatever a stamp claims: the cap can only shrink the project frame.
    outW: Math.max(2, Math.min(W, Math.round(e.outW || W))),
    outH: Math.max(2, Math.min(H, Math.round(e.outH || H))),
    outFps: clampN(e.outFps, 1, 240, fps),
    format: EXPORT_FORMATS.includes(e.format) ? e.format : 'mp4',
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
    // only, and VAAPI's CQP at crf+3 produced visible macroblocking on real footage
    // (final zakaria v1.mp4, 1080x1920, est. 4.5 Mbps, 2026-11-13) where libx264 at the
    // same CRF measured clean (PSNR 40.4 dB on a stress source). Lower QP only ever
    // costs file size, never quality.
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
const VP9_CPU_USED = { ultrafast: 5, superfast: 5, veryfast: 4, faster: 3, fast: 2, medium: 1, slow: 0, slower: 0, veryslow: 0 };
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
  const once = (info) => new Promise((resolve, reject) => {
    const { args, total } = buildExportArgs(withAssets, outFile, { encoder: info.encoder, vaapiDevice: info.device });
    // A proven hardware pick may live in a system FFmpeg (see pickEncoderInfo);
    // everything else — and every CPU encode — runs the bundled binary.
    proc = spawn(info.binary || ffmpegPath, graphFile(args, tmpDir), { windowsHide: true });
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
      return code === 0 ? resolve() : reject(new Error(`FFmpeg failed (code ${code}):\n${log.slice(-3000)}`));
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
      // A cancelled export leaves no partial file behind: the path is the export's own
      // target (the encoder would have overwritten it anyway), never a finished output —
      // a completed encode resolves before cancel can be observed here.
      if (canceled) { try { fs.rmSync(outFile, { force: true }); } catch { /* nothing to clean */ } }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })();
  return { promise, cancel: () => { canceled = true; proc?.kill('SIGKILL'); } };
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
  audioFxPathOf, enhancePathOf,
  toSdr, colorFix, stillInput, graphFile, pickEncoder, pickEncoderInfo, resetEncoderPick, binaryHasEncoder, encoderBinaries, probeEncodeArgs, vaapiDevice, hasEncoder, hasLibx265, hasVp9, effectiveExport, makeScene, needsProxy, usableCopyFile, makeProxy, makeLightProxy, makeQualityProxy, ffmpegPath, ffprobePath, probe, fitSize, narrowClip, buildExportArgs, buildAudioExportArgs, buildTimelineAudioArgs, exportAudio, runAudioExport, audioExportTotal, runExport, toM4a, renderMainAudio, renderTimelineAudio, detectSilences, makeVisuals, parseProgressValues, createProgressParser };
