// The animated-effects pass of the export. FFmpeg decodes the frames an effect or a transition needs and sends them
// to the interface, which draws them with the same WebGL shaders as the preview (src/fxExport.js); the results come
// back and FFmpeg stores them losslessly. The final export then uses those files (clip.videoOverride and
// project.fxSegments) instead of rendering the effects itself.
//
// Segment store (Sprint 9): segments are stored as ffv1 in Matroska, converted with an explicit
// BT.709 matrix and tagged BT.709 / tv range. Before Sprint 9 the RGBA->YUV conversion ran with
// swscale's default (BT.601) matrix and no tags, while the export graph tags its output BT.709 —
// saturated colours landed up to ~19 channel units off the main graph (measured in
// scripts/test-transition-parity.cjs). With the recipe below and the export's output-rate pin
// (electron/ffmpeg.cjs), the same measurement reads ~1.
//
// Segment cache (Sprint 9, parity-matrix Arch-2): a finished segment is also published to
// <userData>/media-cache/fx-segments/<key>.mkv, keyed by a hash of everything that determines
// its frames (segment definition + source fingerprints; see segmentKeyFor). A later export —
// in this session or a future one — whose key matches reuses the file instead of re-rendering
// every frame through the decode/paint/encode round trip. Any parameter change changes the
// key, so a wrong reuse cannot happen; scripts/test-fx-cache.cjs pins that.
//
// Cache eviction (10/10 step 4, the Sprint 9 deferral): the cache is size-bounded.
// Entries are lossless 444 segments — a few MB per second of timeline — so without a
// bound the folder grows with every distinct fx render the user ever makes. The
// policy is LRU over the file mtimes: a cache HIT refreshes the entry's mtime, a
// publish appends the newest entry, and whenever a publish leaves the folder over
// the cap the oldest entries are deleted until it fits. Entries a live job of THIS
// FxJobs instance is using (a cached job's file feeds an in-flight export; a
// rendering job's file is its publish source) are never evicted — deleting a file
// an export is decoding would fail that export. The cap is configurable (the host
// wires it to Settings; DEFAULT_CACHE_CAP_BYTES when unwired) and eviction is
// best-effort: a cache that cannot evict simply stays over the cap, never an error.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { ffmpegPath, buildExportArgs, fitSize, graphFile, narrowClip, stillInput, toSdr } = require('./ffmpeg.cjs');
const { shiftCurves } = require('./layers.cjs');
const sc = require('./speedcurve.cjs');

// A clip's timeline length is the speed sampler's duration (curve integral for
// ramped clips, the constant quotient otherwise) — same as ffmpeg.cjs.
const clipLen = (c) => sc.clipDuration(c);
function transitionDur(clips, i) {
  const t = clips[i] && clips[i].transition;
  if (!t || i === 0 || t.type === 'none') return 0;
  return Math.max(0, Math.min(t.duration, clipLen(clips[i]) / 2, clipLen(clips[i - 1]) / 2));
}
const num = (n) => Number(n).toFixed(3);

// Reads fixed-size frames from a process's stdout, pausing the process while frames wait to be used.
class FrameReader {
  constructor(proc, size) {
    this.proc = proc;
    this.size = size;
    this.chunks = [];
    this.bytes = 0;
    this.ended = false;
    this.waiters = [];
    this.err = '';
    proc.stderr.on('data', (d) => { this.err = (this.err + d).slice(-3000); });
    proc.stdout.on('data', (d) => {
      this.chunks.push(d);
      this.bytes += d.length;
      if (this.bytes > size * 3) proc.stdout.pause();
      this.wake();
    });
    proc.stdout.on('end', () => { this.ended = true; this.wake(); });
    proc.on('error', (e) => { this.err = e.message; this.ended = true; this.wake(); });
  }

  wake() {
    while (this.waiters.length && (this.bytes >= this.size || this.ended)) this.waiters.shift()();
  }

  async next() {
    while (this.bytes < this.size && !this.ended) await new Promise((r) => this.waiters.push(r));
    if (this.bytes < this.size) return null;
    const all = Buffer.concat(this.chunks);
    const frame = all.subarray(0, this.size);
    const rest = all.subarray(this.size);
    this.chunks = rest.length ? [rest] : [];
    this.bytes = rest.length;
    if (this.bytes <= this.size * 3) this.proc.stdout.resume();
    return Buffer.from(frame);
  }
}

// The segment-store recipe version. Bump this whenever anything that determines a segment's
// frames changes meaning: the encoder below, the export splice, the effect expressions or the
// bundled LUTs. Cache entries from older recipes then miss instead of being reused wrongly
// (the proxy makers in ffmpeg.cjs use the same convention: 'proxy1', 'lproxy1', ...).
const SEGMENT_RECIPE = 'fxseg2-bt709';

// The one place the segment encode recipe lives; the parity suites import it so the artefact
// they measure is the artefact the app writes (they used to copy the args inline and could
// silently drift from the app).
function segmentEncoderArgs(file, w, h, fps) {
  return ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`,
    '-r', String(fps), '-i', 'pipe:0',
    // RGBA frames are full-range BT.709 pictures (the preview's canvas): convert with the 709
    // matrix into limited-range 444 and SAY SO on the stream, so every later conversion in the
    // export graph (444 -> 420 for the encoder) stays in 709 instead of guessing.
    '-vf', 'scale=in_color_matrix=bt709:out_color_matrix=bt709:out_range=tv,format=yuv444p',
    '-c:v', 'ffv1', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', file];
}

function encoder(file, w, h, fps) {
  const p = spawn(ffmpegPath, segmentEncoderArgs(file, w, h, fps), { windowsHide: true });
  let err = '';
  p.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
  const done = new Promise((resolve, reject) => {
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(file) : reject(new Error(err || `encoder exited with ${code}`))));
  });
  p.stdin.on('error', () => {});
  done.catch(() => {}); // awaited in end(); a canceled job must not raise an unhandled rejection
  return { p, done };
}

const decoder = (args) => spawn(ffmpegPath, args, { windowsHide: true });

// ---- Segment cache keys -----------------------------------------------------
// A segment's frames are a pure function of: the segment definition (the clip or
// clip pair, their media, the effects that paint them) and the recipe above.
// The key hashes a canonical form of exactly those inputs. Canonicalisation:
// object keys sorted, undefined/functions dropped, strings longer than 512
// chars replaced by their sha1 (mask pictures travel as data URLs and would
// otherwise dominate the hash input — their content is what matters, and the
// hash carries it). Media items are stripped of generated pointers (thumbnails,
// waveforms, preview copies — they change without the picture changing) and
// gain a stat fingerprint of the file itself, so a source replaced on disk
// misses the cache even under the same path.
const GENERATED_KEYS = ['thumb', 'thumbCount', 'thumbInterval', 'thumbW', 'thumbH', 'wave', 'proxy', 'lightProxy', 'proxies', 'poster', 'optimizing', 'proxyFailed', 'remux', 'remuxFailed'];
const statFp = (p) => {
  try { const s = fs.statSync(p); return { size: s.size, mtime: Math.round(s.mtimeMs) }; } catch { return null; }
};
function canon(v) {
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > 512 ? `sha1:${crypto.createHash('sha1').update(v).digest('hex')}` : v;
  if (Array.isArray(v)) return v.map(canon);
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) {
      if (v[k] !== undefined && typeof v[k] !== 'function') o[k] = canon(v[k]);
    }
    return o;
  }
  return String(v);
}
const hashKey = (parts) => crypto.createHash('sha1').update(JSON.stringify(canon(parts))).digest('hex');
function mediaForKey(m) {
  if (!m) return null;
  const o = {};
  for (const k of Object.keys(m)) if (!GENERATED_KEYS.includes(k)) o[k] = m[k];
  o.__stat = statFp(m.path);
  if (m.matte) o.__matteStat = statFp(m.matte);
  return o;
}
// User-supplied LUT files are read from disk at paint time; their path is in
// the clip, so fingerprint the file too (bundled LUTs are app content, covered
// by SEGMENT_RECIPE).
function lutFps(clip) {
  const p = clip && clip.grade && clip.grade.lut && clip.grade.lut.ref && clip.grade.lut.ref.path;
  return typeof p === 'string' ? [{ path: p, stat: statFp(p) }] : [];
}

// The default segment-cache cap: 2 GiB. Lossless segments run a few MB per
// timeline second, so this holds roughly ten-plus minutes of distinct fx
// renders — generous for one user's active projects, small enough that the
// cache can never quietly eat a disk. Settings can raise or lower it.
const DEFAULT_CACHE_CAP_BYTES = 2 * 1024 * 1024 * 1024;

class FxJobs {
  // cacheDirFn: () => directory for the persistent segment cache, or null for
  // session-only segments (the pre-Sprint-9 behaviour; used by tests).
  // cacheCapFn: () => cap in bytes for the eviction policy, or null for the
  // default above. Read at eviction time, so a Settings change applies to the
  // next publish without a restart.
  constructor(cacheDirFn = null, cacheCapFn = null) {
    this.jobs = new Map();
    this.dir = null;
    this.n = 0;
    this.cacheDirFn = cacheDirFn;
    this.cacheCapFn = cacheCapFn;
  }

  cacheDir() {
    if (!this.cacheDirFn) return null;
    try {
      const d = this.cacheDirFn();
      if (!d) return null;
      fs.mkdirSync(d, { recursive: true });
      return d;
    } catch { return null; }
  }

  cacheCapBytes() {
    try {
      const v = this.cacheCapFn ? Number(this.cacheCapFn()) : NaN;
      return Number.isFinite(v) && v > 0 ? v : DEFAULT_CACHE_CAP_BYTES;
    } catch { return DEFAULT_CACHE_CAP_BYTES; }
  }

  cacheHit(key) {
    const dir = key && this.cacheDir();
    if (!dir) return null;
    const f = path.join(dir, `${key}.mkv`);
    try {
      if (fs.statSync(f).size > 0) {
        // A hit is a use: the entry becomes the most-recently-used, which is
        // what the eviction order reads. Best-effort — a read-only cache dir
        // just keeps the publish order instead.
        try { const now = new Date(); fs.utimesSync(f, now, now); } catch { /* LRU touch is best-effort */ }
        return f;
      }
    } catch { /* a miss */ }
    return null;
  }

  // The cache entries on disk: [{ file, bytes, mtimeMs }] for finished
  // segments only (.part files are publishes in flight, never entries).
  cacheEntries() {
    const dir = this.cacheDir();
    if (!dir) return [];
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.mkv')) continue;
      const file = path.join(dir, name);
      try {
        const st = fs.statSync(file);
        if (st.isFile()) out.push({ file, bytes: st.size, mtimeMs: st.mtimeMs });
      } catch { /* a vanished entry is skipped */ }
    }
    return out;
  }

  cacheStats() {
    const entries = this.cacheEntries();
    return { entries: entries.length, bytes: entries.reduce((n, e) => n + e.bytes, 0), capBytes: this.cacheCapBytes() };
  }

  // Files an in-flight export may be reading RIGHT NOW: the file of every
  // live job of this instance (a cached job's cache file, a rendering job's
  // session file — the latter never sits in the cache dir, but the check is
  // by absolute path so the rule stays one line). Eviction and clearing both
  // refuse these, unconditionally.
  inUseFiles() {
    const out = new Set();
    for (const j of this.jobs.values()) if (j.file) out.add(path.resolve(j.file));
    return out;
  }

  // Evict least-recently-used entries until the cache fits the cap. The
  // just-published entry (extraBytes counts it as already present when the
  // caller passes its size ahead of the rename) and every in-use file are
  // untouchable; when only protected entries remain over the cap, the cache
  // stays over — an export in flight outranks the cap. Returns the files
  // actually deleted.
  evictIfNeeded() {
    const dir = this.cacheDir();
    if (!dir) return [];
    const cap = this.cacheCapBytes();
    const entries = this.cacheEntries();
    let total = entries.reduce((n, e) => n + e.bytes, 0);
    if (total <= cap) return [];
    const inUse = this.inUseFiles();
    const deleted = [];
    for (const e of entries.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total <= cap) break;
      if (inUse.has(path.resolve(e.file))) continue;
      try {
        fs.rmSync(e.file, { force: true });
        total -= e.bytes;
        deleted.push(e.file);
      } catch { /* an undeletable entry is skipped, never fatal */ }
    }
    return deleted;
  }

  // Drop every cached segment that is not in use (the Settings / bridge
  // "clear the cache" operation). Returns the files actually deleted.
  clearSegmentCache() {
    const inUse = this.inUseFiles();
    const deleted = [];
    for (const e of this.cacheEntries()) {
      if (inUse.has(path.resolve(e.file))) continue;
      try {
        fs.rmSync(e.file, { force: true });
        deleted.push(e.file);
      } catch { /* skipped, never fatal */ }
    }
    return deleted;
  }

  // After a segment renders completely, publish it under its key (atomic
  // rename; a cache failure must never fail an export), then bound the cache.
  publish(j) {
    if (!j.key || j.written !== j.frames) return;
    const dir = this.cacheDir();
    if (!dir) return;
    const dst = path.join(dir, `${j.key}.mkv`);
    try {
      if (fs.existsSync(dst)) return;
      const part = `${dst}.part`;
      fs.copyFileSync(j.file, part);
      fs.renameSync(part, dst);
    } catch { /* cache is an optimisation, not a requirement */ return; }
    // The job that produced this entry is still live in this.jobs, so the
    // new file is in-use-protected while its own export finishes; older
    // entries make room for it.
    try { this.evictIfNeeded(); } catch { /* eviction is housekeeping, never an export failure */ }
  }

  // The cache key of the job that produced a file in this session (a baked
  // clip's override feeding a transition), or null when it did not.
  keyOfFile(file) {
    for (const j of this.jobs.values()) if (j.file === file && j.key) return j.key;
    return null;
  }

  // The key for a segment about to be begun, from the RESOLVED project (job
  // ids already turned into files). A baked override contributes the key of
  // the job that rendered it — the transition's frames depend on that render,
  // and its key names the render exactly; a foreign file (never produced by
  // this session) falls back to its stat fingerprint.
  segmentKeyFor(project, spec, ctx) {
    const { width: W, height: H, fps } = project;
    const clipForKey = (clip) => {
      if (!clip) return null;
      const o = { ...clip };
      delete o.videoOverride;
      if (clip.videoOverride) {
        const segKey = clip.videoOverride.file ? this.keyOfFile(clip.videoOverride.file) : null;
        o.__override = {
          start: clip.videoOverride.start, end: clip.videoOverride.end,
          seg: segKey, stat: segKey ? null : statFp(clip.videoOverride.file),
        };
      }
      return o;
    };
    if (spec.kind === 'clip') {
      const { clip, media } = ctx;
      return hashKey({
        r: SEGMENT_RECIPE, kind: 'clip', track: spec.track, W, H, fps,
        clip: clipForKey(clip), media: mediaForKey(media),
        fx: project.effectClips || [], lut: lutFps(clip),
      });
    }
    const { a, b, mediaA, mediaB } = ctx;
    return hashKey({
      r: SEGMENT_RECIPE, kind: 'transition', W, H, fps, bg: project.background || null,
      a: clipForKey(a), b: clipForKey(b), ma: mediaForKey(mediaA), mb: mediaForKey(mediaB),
      motionA: (project.motion || {})[a.id] ?? null, motionB: (project.motion || {})[b.id] ?? null,
      maskA: (project.maskImages || {})[a.id] || null, maskB: (project.maskImages || {})[b.id] || null,
      cmaskA: (project.customMaskImages || {})[a.id] || null, cmaskB: (project.customMaskImages || {})[b.id] || null,
      decoA: (project.decoImages || {})[a.id] || null, decoB: (project.decoImages || {})[b.id] || null,
      lut: [...lutFps(a), ...lutFps(b)],
    });
  }

  tmp() {
    if (!this.dir) this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-fx-'));
    return this.dir;
  }

  // Replaces job ids in a project by the files they produced (only finished jobs of this session).
  resolve(project) {
    const file = (id, kind) => {
      const j = this.jobs.get(id);
      if (!j || j.kind !== kind || !j.file) throw new Error('An effect render is missing; export again.');
      return j.file;
    };
    const fix = (c) => (c.videoOverride && c.videoOverride.job ? { ...c, videoOverride: { ...c.videoOverride, file: file(c.videoOverride.job, 'clip') } } : c);
    const segs = {};
    for (const [clipId, id] of Object.entries(project.fxSegments || {})) segs[clipId] = file(id, 'transition');
    return { ...project, videoClips: project.videoClips.map(fix), overlayClips: (project.overlayClips || []).map(fix), fxSegments: segs };
  }

  // spec: { kind: 'clip', track: 'video' | 'overlay', clipId } or { kind: 'transition', clipId } (the incoming clip).
  begin(projectIn, spec) {
    let project = this.resolve(projectIn);
    // Masks travel as data URLs (like for the export); transitions need them as files.
    if (project.maskImages && !project.maskFiles) {
      const maskFiles = {};
      Object.entries(project.maskImages).forEach(([clipId, dataUrl], n) => {
        const f = path.join(this.tmp(), `mask_${this.n}_${n}.png`);
        fs.writeFileSync(f, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
        maskFiles[clipId] = f;
      });
      project = { ...project, maskFiles };
    }
    if (project.customMaskImages && !project.customMaskFiles) {
      const customMaskFiles = {};
      Object.entries(project.customMaskImages).forEach(([clipId, dataUrl], n) => {
        const f = path.join(this.tmp(), `cmask_${this.n}_${n}.png`);
        fs.writeFileSync(f, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
        customMaskFiles[clipId] = f;
      });
      project = { ...project, customMaskFiles };
    }
    const { width: W, height: H, fps } = project;
    const mediaById = Object.fromEntries(project.media.map((m) => [m.id, m]));
    const id = `fx${++this.n}`;
    const out = path.join(this.tmp(), `${id}.mkv`);

    if (spec.kind === 'clip') {
      const list = spec.track === 'overlay' ? project.overlayClips || [] : project.videoClips;
      const clip = list.find((c) => c.id === spec.clipId);
      const m = clip && mediaById[clip.mediaId];
      if (!clip || !m || m.type === 'audio') throw new Error('Clip not found for the effect render.');
      const len = clipLen(clip);
      const { fw, fh } = fitSize(m, W, H);
      const frames = Math.max(1, Math.round(len * fps));
      const key = this.segmentKeyFor(project, spec, { clip, media: m });
      const hit = this.cacheHit(key);
      if (hit) {
        this.jobs.set(id, { kind: 'clip', file: hit, cached: true, key, frames });
        return { id, width: fw, height: fh, frames, fps, len, cached: true };
      }
      const input = m.type === 'image'
        ? stillInput(m.path, fps, len)
        : ['-i', m.path];
      const pre = m.type === 'image'
        ? `trim=duration=${num(len)},setpts=PTS-STARTPTS`
        : `trim=start=${num(clip.in)}:end=${num(clip.out)},setpts=(PTS-STARTPTS)/${clip.speed || 1}${toSdr(m)}`;
      const dec = decoder(['-hide_banner', '-loglevel', 'error', ...input, '-filter_complex',
        `[0:v]${pre},fps=${fps},scale=${fw}:${fh},setsar=1,format=rgba[o]`, '-map', '[o]', '-t', num(len),
        '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
      const enc = encoder(out, fw, fh, fps);
      this.jobs.set(id, { kind: 'clip', readers: [new FrameReader(dec, fw * fh * 4)], decs: [dec], enc, out, frames, written: 0, key });
      return { id, width: fw, height: fh, frames, fps, len };
    }

    // Transition: the last td seconds of the outgoing clip and the first td of the incoming one, as they look
    // on the main track (fitted on the background, with their look and pre-rendered effects).
    const clips = project.videoClips.filter((c) => c.gap || mediaById[c.mediaId]);
    const i = clips.findIndex((c) => c.id === spec.clipId);
    const td = transitionDur(clips, i);
    if (i < 1 || td <= 0) throw new Error('Transition not found for the effect render.');
    const A = clips[i - 1];
    const B = clips[i];
    const lenA = clipLen(A);
    // Animated clips keep their motion: the outgoing one from where its last td seconds start.
    const mini = (clip, from) => ({
      ...project, videoClips: [clip], overlayClips: [], textClips: [], audioClips: [], fxSegments: {},
      motion: project.motion && project.motion[clip.id] ? { [clip.id]: shiftCurves(project.motion[clip.id], from) } : {},
    });
    const frames = Math.max(1, Math.round(td * fps));
    const key = this.segmentKeyFor(project, spec, { a: A, b: B, mediaA: mediaById[A.mediaId], mediaB: mediaById[B.mediaId] });
    const hit = this.cacheHit(key);
    if (hit) {
      this.jobs.set(id, { kind: 'transition', file: hit, cached: true, key, frames });
      return { id, width: W, height: H, frames, fps, len: td, cached: true };
    }
    const decs = [[narrowClip(A, mediaById[A.mediaId], lenA - td, lenA), lenA - td], [narrowClip(B, mediaById[B.mediaId], 0, td), 0]]
      .map(([c, from]) => decoder(graphFile(buildExportArgs(mini(c, from), null, { raw: true }).args)));
    const enc = encoder(out, W, H, fps);
    this.jobs.set(id, { kind: 'transition', readers: decs.map((d) => new FrameReader(d, W * H * 4)), decs, enc, out, frames, written: 0, key });
    return { id, width: W, height: H, frames, fps, len: td };
  }

  async read(id) {
    const j = this.jobs.get(id);
    if (!j) throw new Error('Unknown effect render');
    if (j.cached) return null; // nothing to paint: the file already holds every frame
    const frames = await Promise.all(j.readers.map((r) => r.next()));
    if (frames.some((f) => !f)) {
      const err = j.readers.map((r) => r.err).find(Boolean);
      if (err && j.written === 0) throw new Error(err);
      return null;
    }
    return frames.length === 1 ? frames[0] : { a: frames[0], b: frames[1] };
  }

  async write(id, bytes) {
    const j = this.jobs.get(id);
    if (!j) throw new Error('Unknown effect render');
    if (j.cached) return; // the segment is already rendered; see read()
    j.written++;
    if (!j.enc.p.stdin.write(Buffer.from(bytes))) await new Promise((r) => j.enc.p.stdin.once('drain', r));
  }

  async end(id) {
    const j = this.jobs.get(id);
    if (!j) throw new Error('Unknown effect render');
    if (j.cached) return { ok: true, frames: j.frames };
    j.decs.forEach((d) => d.kill());
    j.enc.p.stdin.end();
    j.file = await j.enc.done;
    this.publish(j);
    return { ok: true, frames: j.written };
  }

  // Stops every job and deletes their files (after an export, or when it is canceled).
  // Cached jobs hold no processes and their files live in the segment cache, not in
  // the session dir — they are neither killed nor deleted here.
  clear() {
    for (const j of this.jobs.values()) {
      if (j.cached) continue;
      j.decs.forEach((d) => d.kill());
      try { j.enc.p.kill(); } catch { /* already closed */ }
    }
    this.jobs.clear();
    if (this.dir) fs.rmSync(this.dir, { recursive: true, force: true });
    this.dir = null;
  }
}

module.exports = { FxJobs, FrameReader, segmentEncoderArgs, SEGMENT_RECIPE, DEFAULT_CACHE_CAP_BYTES };
