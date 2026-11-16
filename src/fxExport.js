// The animated-effects pass of the export: every frame that needs an animated effect or transition is decoded by
// FFmpeg (electron/fxjobs.cjs), drawn here with the preview's WebGL shaders, and stored for the final export.
import { videoLayout } from './store.js';
import { clipDuration } from './speedCurve.js';
import { FX_TRANSITIONS } from './fx/catalog.js';
import { transitionExpr } from './fx/params.js';
import { analyseRawPair, morphCacheKey, renderMorphFrame } from './fx/morph.js';
import { clipHasPixelFx, isPixel, isShaderFx, pixelPasses } from './fx/apply.js';
import { fxGL } from './fx/gl.js';
import { easeValue } from './fx/easing.js';

const fxTr = (c) => c.transition && FX_TRANSITIONS.find((t) => t.id === c.transition.type);
const unwrap = (r) => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

// Picture clips to send through the effects pass: [{ track, clip, start, len }].
function fxClipsOf(project) {
  const out = [];
  for (const l of videoLayout(project.videoClips)) {
    if (!l.clip.gap && clipHasPixelFx(project, l.clip, l.start, l.end - l.start)) out.push({ track: 'video', clip: l.clip, start: l.start, len: l.end - l.start });
  }
  for (const c of project.overlayClips || []) {
    const len = clipDuration(c);
    if (clipHasPixelFx(project, c, c.start, len)) out.push({ track: 'overlay', clip: c, start: c.start, len });
  }
  return out;
}

// Returns the frames to render, so the export can show progress (0 when the project has no animated effect).
export function fxWork(project) {
  const fps = project.fps;
  let frames = fxClipsOf(project).reduce((n, j) => n + j.len * fps, 0);
  for (const l of videoLayout(project.videoClips)) if (l.trans > 0 && fxTr(l.clip)) frames += l.trans * fps;
  return Math.round(frames);
}

// Returns the project to export: clips with animated effects point at their rendered files, animated transitions
// at their rendered segments. Returns null when canceled.
// B-F07: frames cross the main<->renderer IPC in batches of 4 instead of
// one round trip per frame (measured: ~9 ms of structured-clone work per
// 720p RGBA frame in node, before any decode/paint/encode). The bytes are
// unchanged — only the per-call overhead drops, 2 IPC calls/frame to 0.5.
// window.__fveFxPass records the pass so the saving is observable live.
export const FX_BATCH = 4;

export async function renderFxPass(projectIn, onProgress, isCanceled, isPaused) {
  const total = fxWork(projectIn);
  if (!total) return projectIn;
  const gl = fxGL();
  let done = 0;
  const ipc = { frames: 0, readCalls: 0, writeCalls: 0 };
  let project = { ...projectIn, fxSegments: {} };
  const step = () => { done++; if (done % 4 === 0) onProgress(Math.min(1, done / total)); };
  // P1-52: wait out a pause between frames, like renderTextFrames does.
  const waitPaused = async () => { while (isPaused?.() && !isCanceled()) await new Promise((r) => setTimeout(r, 150)); };

  // 1) Picture clips under animated effects (their own, or effects on the Effects track), main track and overlays.
  const run = async ({ track, clip, start }) => {
    const job = unwrap(await window.api.fxBegin(project, { kind: 'clip', track, clipId: clip.id }));
    // A cached segment (Sprint 9) already holds this clip's rendered frames: no
    // decode/paint/encode round trip, the baked clip below points at the same job.
    for (let base = 0; base < (job.cached ? 0 : job.frames); base += FX_BATCH) {
      if (isCanceled()) return false;
      await waitPaused();
      if (isCanceled()) return false;
      const frames = unwrap(await window.api.fxReadMany(job.id, Math.min(FX_BATCH, job.frames - base)));
      ipc.readCalls++;
      if (!frames.length) break;
      const painted = [];
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const passes = pixelPasses(projectIn, clip, start, (base + i) / job.fps);
        if (passes.length) {
          gl.effects({ data: frame }, job.width, job.height, passes);
          // gl.read() returns the SHARED readback buffer (PF-04): copy it
          // before batching, or all four frames in the batch alias the
          // last-painted frame and the export steps 4 frames at a time.
          painted.push(gl.read(job.width, job.height).slice());
        } else {
          painted.push(frame);
        }
        ipc.frames++;
        step();
      }
      unwrap(await window.api.fxWriteMany(job.id, painted));
      ipc.writeCalls++;
    }
    unwrap(await window.api.fxEnd(job.id));
    // Everything the passes painted is inside the override file now: shader effects,
    // classic effects (shader forms since Sprint 6) and the Adjust settings all come
    // off the baked clip, so nothing downstream can paint them a second time. Only
    // overlay effects (particles / light) survive — they are drawn by their own pass.
    const baked = { ...clip, adjust: {}, effects: (clip.effects || []).filter((id) => !isShaderFx(id)), videoOverride: { job: job.id, start: 0, end: job.len } };
    const key = track === 'overlay' ? 'overlayClips' : 'videoClips';
    project = { ...project, [key]: project[key].map((c) => (c.id === clip.id ? baked : c)) };
    return true;
  };
  for (const j of fxClipsOf(projectIn)) if (!(await run(j))) return null;
  // Effects on the Effects track are now inside the clips' pictures (shader effects and the
  // classic effects' shader forms alike); particle/light overlays stay for their own pass.
  // P2-16 — grade layers are baked the same way (their passes ran inside pixelPasses for
  // every clip under them), so they come off too: leaving one in the baked project would
  // re-grade the already-graded pictures if the fx pass ever ran again on it.
  project = { ...project, effectClips: (project.effectClips || []).filter((e) => !isShaderFx(e.fx) && e.kind !== 'grade') };

  // 2) Animated transitions, from the clips as they now look.
  const layout = videoLayout(project.videoClips);
  for (const l of layout) {
    const t = l.trans > 0 && fxTr(l.clip);
    if (!t) continue;
    const job = unwrap(await window.api.fxBegin(project, { kind: 'transition', clipId: l.clip.id }));
    // P3-03: a morph analyses its boundary pair once — the first decoded
    // pair IS the boundary pair (fxjobs decodes the last td of A and the
    // first td of B) — and every frame renders from that one analysis, the
    // same key the preview uses, so preview and export warp identically.
    let morphAnalysis = null;
    let morphKey = null;
    for (let base = 0; base < (job.cached ? 0 : job.frames); base += FX_BATCH) {
      if (isCanceled()) return null;
      await waitPaused();
      if (isCanceled()) return null;
      const pairs = unwrap(await window.api.fxReadMany(job.id, Math.min(FX_BATCH, job.frames - base)));
      ipc.readCalls++;
      if (!pairs.length) break;
      const painted = [];
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const k = base + i;
        const P = easeValue(l.clip.transition?.ease, k / job.fps / job.len);
      if (t.morph) {
        if (!morphAnalysis) {
          const idx = layout.findIndex((x) => x.clip.id === l.clip.id);
          const out = layout[idx - 1];
          morphKey = morphCacheKey(`${out.clip.id}:${out.clip.mediaId}`, `${l.clip.id}:${l.clip.mediaId}`);
          morphAnalysis = analyseRawPair(pair.a, pair.b, job.width, job.height, morphKey);
        }
        renderMorphFrame(gl, { data: pair.a }, { data: pair.b }, job.width, job.height, P, morphAnalysis, l.clip.transition, morphKey);
      } else {
        gl.transition({ data: pair.a }, { data: pair.b }, job.width, job.height, P, transitionExpr(l.clip.transition));
      }
        // Same shared-buffer rule as step 1: copy before batching.
        painted.push(gl.read(job.width, job.height).slice());
        ipc.frames++;
        step();
      }
      unwrap(await window.api.fxWriteMany(job.id, painted));
      ipc.writeCalls++;
    }
    unwrap(await window.api.fxEnd(job.id));
    project = { ...project, fxSegments: { ...project.fxSegments, [l.clip.id]: job.id } };
  }
  if (typeof window !== 'undefined') window.__fveFxPass = { ...ipc };
  onProgress(1);
  return project;
}
