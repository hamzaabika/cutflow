// Effect clipboard (FB-27 · P1-42): copy a clip's whole effect stack —
// effects, strengths, timing windows, parameters, regions, intensity
// keyframes and bypass flags — and paste it onto other clips.
//
// Keyframes and timing windows are stored RELATIVE to the source clip
// (fractions of its length), so a paste onto a shorter or longer clip lands
// at the same relative positions instead of the same absolute seconds.
// Solo is deliberately NOT copied: it is a per-clip isolation state, not
// part of the effect. The clipboard lives in memory and in localStorage, so
// it survives a reload; pasting dispatches one updateMany, so a multi-clip
// paste is a single undo step.
import { clipLen } from '../store.js';

const KEY = 'cutflow.fxClipboard.v1';
let memory = null;

function loadStored() {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    memory = raw ? JSON.parse(raw) : null;
  } catch { memory = null; }
  return memory;
}

export function hasEffectClipboard() {
  return !!loadStored();
}

export function getEffectClipboard() {
  return loadStored();
}

export function clearEffectClipboard() {
  memory = null;
  try { localStorage.removeItem(KEY); } catch { /* best-effort */ }
}

// Snapshot a clip's stack. Keyframes become fractions of the source length.
function snapshotClip(clip) {
  const len = clipLen(clip) || 0;
  const snap = {
    sourceLen: len,
    effects: (clip.effects || []).map((id) => ({
      id,
      strength: clip.fxStrength?.[id],
      timing: clip.fxTiming?.[id] ? { ...clip.fxTiming[id] } : null,
      params: clip.fxParams?.[id] ? { ...clip.fxParams[id] } : null,
      region: clip.fxRegions?.[id] ? { ...clip.fxRegions[id] } : null,
      keys: (clip.fxKeys?.[id] || []).map((k) => ({ f: len > 0 ? k.t / len : 0, v: k.v })),
      bypass: !!(clip.fxBypass || {})[id],
    })),
  };
  memory = snap;
  try { localStorage.setItem(KEY, JSON.stringify(snap)); } catch { /* best-effort */ }
  // Keep the multi-stack clipboard in step (FX-02): an inspector copy is
  // pasteable from the App menu too, and vice versa (see copyEffects).
  fxClipboard = snapToStack(snap) ? { version: 1, stacks: [snapToStack(snap)] } : null;
  return snap;
}

export function copyEffectsFromClip(clip) {
  return snapshotClip(clip);
}

// The patch that pastes a snapshot onto one target clip. Existing effects on
// the target keep their place; pasted effects append in source order, and a
// pasted effect that already exists on the target takes the copied state.
export function pasteEffectsPatch(targetClip, snap) {
  if (!snap || !snap.effects?.length) return {};
  const targetLen = clipLen(targetClip) || 0;
  const ratio = snap.sourceLen > 0 && targetLen > 0 ? targetLen / snap.sourceLen : 1;
  const effects = [...(targetClip.effects || [])];
  const fxStrength = { ...(targetClip.fxStrength || {}) };
  const fxTiming = { ...(targetClip.fxTiming || {}) };
  const fxParams = { ...(targetClip.fxParams || {}) };
  const fxRegions = { ...(targetClip.fxRegions || {}) };
  const fxKeys = { ...(targetClip.fxKeys || {}) };
  const fxBypass = { ...(targetClip.fxBypass || {}) };
  for (const e of snap.effects) {
    if (!effects.includes(e.id)) effects.push(e.id);
    if (e.strength == null || e.strength >= 1) delete fxStrength[e.id]; else fxStrength[e.id] = e.strength;
    if (e.timing) {
      const start = Math.min(Math.max(0, e.timing.start * ratio), Math.max(0, targetLen - 0.1));
      const duration = Math.min(Math.max(0.1, e.timing.duration * ratio), Math.max(0.1, targetLen - start));
      fxTiming[e.id] = { start, duration };
    } else delete fxTiming[e.id];
    if (e.params) fxParams[e.id] = { ...e.params }; else delete fxParams[e.id];
    if (e.region) fxRegions[e.id] = { ...e.region }; else delete fxRegions[e.id];
    const keys = (e.keys || [])
      .map((k) => ({ t: Math.min(Math.max(0, k.f * targetLen), targetLen), v: k.v }))
      .sort((a, b) => a.t - b.t);
    if (keys.length) fxKeys[e.id] = keys; else delete fxKeys[e.id];
    if (e.bypass) fxBypass[e.id] = true; else delete fxBypass[e.id];
  }
  const patch = { effects };
  const put = (key, map) => { patch[key] = Object.keys(map).length ? map : undefined; };
  put('fxStrength', fxStrength);
  put('fxTiming', fxTiming);
  put('fxParams', fxParams);
  put('fxRegions', fxRegions);
  put('fxKeys', fxKeys);
  put('fxBypass', fxBypass);
  return patch;
}

// updateMany updates pasting a snapshot onto several clips at once
// ([{ track, clip }], as selectedPictures returns) — one undo step.
export function pasteEffectsUpdates(items, snap) {
  if (!snap || !snap.effects?.length) return [];
  return items.map((it) => ({ track: it.track, id: it.clip.id, patch: pasteEffectsPatch(it.clip, snap) }));
}

// ---- Multi-stack copy/paste (FX-02, gap-d) ---------------------------------
// The same snapshot engine as above, exposed in the stack shape the App
// menu uses: one stack per source clip, keyframe/timing times ABSOLUTE in
// the source clip's local span, round-robin across targets. The two
// clipboards stay in step (see copyEffectsFromClip / copyEffects), so a
// copy from either UI pastes from the other.
// Stack shape: { span, effects: [id], fxParams, fxStrength, fxKeys,
//   fxRegions, fxTiming }. Bypass flags are NOT in the stack (FX-02
//   semantics): a merge never clears the target's bypass flags.

export const clipSpan = (clip) => clipLen(clip) || 0;

function snapToStack(snap) {
  if (!snap || !snap.effects?.length) return null;
  const span = snap.sourceLen || 0;
  const stack = { span, effects: snap.effects.map((e) => e.id), fxParams: {}, fxStrength: {}, fxKeys: {}, fxRegions: {}, fxTiming: {} };
  for (const e of snap.effects) {
    if (e.params) stack.fxParams[e.id] = { ...e.params };
    if (e.strength != null) stack.fxStrength[e.id] = e.strength;
    if (e.keys?.length) stack.fxKeys[e.id] = e.keys.map((k) => ({ t: k.f * span, v: k.v }));
    if (e.region) stack.fxRegions[e.id] = { ...e.region };
    if (e.timing) stack.fxTiming[e.id] = { ...e.timing };
  }
  return stack;
}

function stackToSnap(stack) {
  if (!stack || !Array.isArray(stack.effects) || !stack.effects.length) return null;
  const span = stack.span || 0;
  return {
    sourceLen: span,
    effects: stack.effects.map((id) => ({
      id,
      strength: stack.fxStrength?.[id],
      timing: stack.fxTiming?.[id] ? { ...stack.fxTiming[id] } : null,
      params: stack.fxParams?.[id] ? { ...stack.fxParams[id] } : null,
      region: stack.fxRegions?.[id] ? { ...stack.fxRegions[id] } : null,
      keys: (stack.fxKeys?.[id] || []).map((k) => ({ f: span > 0 ? k.t / span : 0, v: k.v })),
      bypass: false,
    })),
  };
}

// Build one stack without touching either clipboard (pure, like FX-02).
export function copyEffectsStack(clip) {
  if (!clip || !(clip.effects || []).length) return null;
  return snapToStack(snapshotClip(clip));
}

export function pasteEffectsStack(target, stack, mode = 'merge') {
  if (!target || !stack || !Array.isArray(stack.effects) || !stack.effects.length) return null;
  const snap = stackToSnap(stack);
  if (!snap) return null;
  // Replace pastes onto an emptied target, so only the copied state lands.
  const base = mode === 'replace'
    ? { ...target, effects: [], fxStrength: {}, fxTiming: {}, fxParams: {}, fxRegions: {}, fxKeys: {}, fxBypass: {} }
    : target;
  const patch = pasteEffectsPatch(base, snap);
  if (!patch || !Object.keys(patch).length) return null;
  // FX-02 semantics: the stack carries no bypass, so a merge never clears
  // the target's bypass flags for the copied effects.
  if (mode === 'merge' && target.fxBypass) {
    const kept = { ...(patch.fxBypass || {}) };
    for (const id of stack.effects) if (target.fxBypass[id]) kept[id] = true;
    patch.fxBypass = Object.keys(kept).length ? kept : undefined;
  }
  // In merge mode only, pasting the same stack twice is a no-op (no phantom
  // undo step) — same comparison as FX-02, bypass excluded.
  if (mode === 'merge') {
    const same = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
    if (same(patch.effects, target.effects)
      && same(patch.fxParams, target.fxParams)
      && same(patch.fxStrength, target.fxStrength)
      && same(patch.fxKeys, target.fxKeys)
      && same(patch.fxRegions, target.fxRegions)
      && same(patch.fxTiming, target.fxTiming)) return null;
  }
  return patch;
}

// --- the multi-stack clipboard ---------------------------------------------
let fxClipboard = null;

export function setEffectsClipboard(data) {
  fxClipboard = data && data.version === 1 && Array.isArray(data.stacks) && data.stacks.length ? data : null;
  return fxClipboard;
}
export function getEffectsClipboard() { return fxClipboard; }

// Copy the effect stacks of the given clips (one stack per clip that has
// effects). Returns the clipboard, or null when none of them has effects.
export function copyEffects(clips) {
  const stacks = (clips || []).map(copyEffectsStack).filter(Boolean);
  const data = stacks.length ? { version: 1, stacks } : null;
  setEffectsClipboard(data);
  // Keep the single-clip clipboard in step: the first stack is what the
  // inspector's paste reads.
  if (stacks.length) {
    memory = stackToSnap(stacks[0]);
    try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* best-effort */ }
  }
  return fxClipboard;
}

// Paste the clipboard onto each target clip. Stacks round-robin across
// targets (copy A+B, paste onto C+D+E applies A to C, B to D, A to E).
// Returns [{ track, id, patch }] — the caller dispatches one updateMany,
// so the whole paste is a single undo step. Returns [] for a bad clipboard.
export function pasteEffects(targets, data = fxClipboard, mode = 'merge') {
  if (!data || data.version !== 1 || !Array.isArray(data.stacks) || !data.stacks.length) return [];
  const out = [];
  (targets || []).forEach((target, i) => {
    if (!target?.clip) return;
    const patch = pasteEffectsStack(target.clip, data.stacks[i % data.stacks.length], mode);
    if (patch) out.push({ track: target.track, id: target.clip.id, patch });
  });
  return out;
}
