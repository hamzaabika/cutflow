// P2-18 Motion presets (+ P2-25 Premium Movement Pack).
//
// A preset is a normalised keyframe recipe: every key sits at u in [0, 1] of
// the clip, so the same preset plays identically on a 2 s clip and an 8 s one
// (rate-independent). Applying a preset writes real keyframes (via anim.js
// setKey, so the Keyframe Graph and the transform sliders stay the handles
// for tweaking it) — except `handheld`, which is a combo (absolute-time shake,
// also duration-independent). Applying a new preset strips the previous
// preset's keys/combo first, so presets never stack.
// `motionBlur` is a per-clip export flag: electron/layers.cjs blends three
// consecutive placed frames (tmix) when it is set. The preview shows the
// motion but not the blur — the UI says so.
//
// Coverage invariant every preset keeps: scale >= 1 and |x|, |y| <= (scale-1)/2
// (plus a base scale bump for the shake/rotation combos), so the picture never
// uncovers the frame — no black edges at any point of any preset.
import { sourceTime, writeKey } from '../anim.js';
import { clipDuration } from '../speedCurve.js';

export const MOTION_PRESETS = [
  {
    id: 'punch-in', name: 'Punch in', pack: 'core', blur: true,
    keys: { scale: [[0, 1, 'smooth'], [0.25, 1.22, 'smooth'], [0.75, 1.22, 'smooth'], [1, 1, 'smooth']] },
  },
  {
    id: 'punch-out', name: 'Punch out', pack: 'core', blur: true,
    keys: { scale: [[0, 1.22, 'smooth'], [0.25, 1, 'smooth'], [0.75, 1, 'smooth'], [1, 1.22, 'smooth']] },
  },
  {
    id: 'snap-zoom', name: 'Snap zoom', pack: 'core', blur: true,
    keys: { scale: [[0, 1], [0.12, 1.3, 'snapIn'], [0.3, 1, 'snapOut']] },
  },
  {
    id: 'slow-push', name: 'Slow push', pack: 'core',
    keys: {
      // Starts at 1.08, not 1.00: the drift needs the (s-1)/2 margin from the
      // first frame, or the edge uncovers at u=0.
      scale: [[0, 1.08, 'linear'], [1, 1.15, 'linear']],
      x: [[0, -0.02, 'linear'], [1, 0.02, 'linear']],
    },
  },
  {
    id: 'drift-float', name: 'Drift + float', pack: 'core',
    keys: {
      scale: [[0, 1.05], [0.5, 1.08], [1, 1.05]],
      y: [[0, 0, 'smooth'], [0.25, -0.02, 'smooth'], [0.5, 0, 'smooth'], [0.75, 0.02, 'smooth'], [1, 0, 'smooth']],
    },
  },
  { id: 'handheld', name: 'Handheld shake', pack: 'core', blur: true, combo: 'handheld' },
  // ---- Premium Movement Pack (P2-25) ----
  {
    id: 'whip-zoom', name: 'Whip zoom', pack: 'premium-movement', blur: true,
    keys: {
      scale: [[0, 1.35], [0.2, 1, 'snapOut'], [1, 1]],
      x: [[0, -0.06], [0.2, 0], [1, 0]],
    },
  },
  {
    id: 'slow-drift', name: 'Slow drift', pack: 'premium-movement',
    keys: {
      scale: [[0, 1.12], [1, 1.12]],
      x: [[0, -0.04, 'linear'], [1, 0.04, 'linear']],
      y: [[0, 0.02, 'linear'], [1, -0.02, 'linear']],
    },
  },
  {
    id: 'snap-focus', name: 'Snap focus', pack: 'premium-movement', blur: true,
    keys: { scale: [[0, 1], [0.08, 1.18, 'snapIn'], [0.2, 1.1, 'smooth'], [0.55, 1.1, 'smooth'], [1, 1, 'smooth']] },
  },
];

export const PREMIUM_MOVEMENT_PACK = {
  id: 'premium-movement',
  name: 'Premium Movement Pack',
  presets: MOTION_PRESETS.filter((p) => p.pack === 'premium-movement').map((p) => p.id),
};

export const motionPresetById = (id) => MOTION_PRESETS.find((p) => p.id === id) || null;

// Local times (source time) of a preset's keys on this clip — the keys the
// preset owns, so re-applying or clearing can remove exactly those. Keys are
// defined at normalised u of the clip's LOCAL time, then converted to source
// time, so trimming or slowing the clip keeps them on the same picture.
function presetKeyTimes(clip, preset) {
  if (!preset || !preset.keys) return {};
  const len = clipDuration(clip);
  const out = {};
  for (const [ch, keys] of Object.entries(preset.keys)) out[ch] = keys.map(([u]) => sourceTime(clip, u * len));
  return out;
}

// The clip's keyframes with a preset's keys removed (only keys at the preset's
// own times are touched; the user's own keys survive).
export function stripPresetKeys(clip, presetId) {
  const preset = motionPresetById(presetId);
  if (!preset || !preset.keys) return clip.keyframes || {};
  const times = presetKeyTimes(clip, preset);
  const out = { ...(clip.keyframes || {}) };
  for (const [ch, ts] of Object.entries(times)) {
    if (!out[ch]) continue;
    out[ch] = out[ch].filter((k) => !ts.some((t) => Math.abs(k.t - t) < 1e-4));
    if (!out[ch].length) delete out[ch];
  }
  return out;
}

// Patch to apply a preset to a clip (feed to set/dispatch update). Returns
// null for an unknown id. `motionPreset` records the id so the next apply or
// a clear knows which keys/combo to strip.
export function applyMotionPreset(clip, presetId) {
  const preset = motionPresetById(presetId);
  if (!preset) return null;
  const patch = { motionPreset: presetId };
  if (clip.motionPreset && clip.motionPreset !== presetId) {
    const prev = motionPresetById(clip.motionPreset);
    if (prev && prev.keys) patch.keyframes = stripPresetKeys(clip, clip.motionPreset);
    if (prev && prev.combo && clip.anim?.combo?.type === prev.combo) {
      const anim = { ...(clip.anim || {}) };
      delete anim.combo;
      patch.anim = anim;
    }
  }
  if (preset.combo) {
    patch.anim = { ...(patch.anim || clip.anim || {}), combo: { type: preset.combo } };
  } else {
    const len = clipDuration(clip);
    let keyframes = patch.keyframes !== undefined ? patch.keyframes : { ...(clip.keyframes || {}) };
    for (const [ch, keys] of Object.entries(preset.keys)) {
      for (const [u, v, e] of keys) keyframes = writeKey(keyframes, ch, sourceTime(clip, u * len), v, e || 'smooth');
    }
    patch.keyframes = keyframes;
  }
  if (preset.blur) patch.motionBlur = true;
  return patch;
}

// Patch to remove the active preset (its keys/combo only; user keys survive).
// Motion blur stays — it is the user's toggle to turn off separately.
export function clearMotionPreset(clip) {
  if (!clip.motionPreset) return null;
  const preset = motionPresetById(clip.motionPreset);
  const patch = { motionPreset: null };
  if (preset && preset.keys) patch.keyframes = stripPresetKeys(clip, clip.motionPreset);
  if (preset && preset.combo && clip.anim?.combo?.type === preset.combo) {
    const anim = { ...(clip.anim || {}) };
    delete anim.combo;
    patch.anim = anim;
  }
  return patch;
}

// Tracking label (P2-18): a text clip pinned to a tracked clip, with the
// gentle float loop so it reads as a label riding the subject rather than a
// static pinned caption. The pin itself is the existing clip.pin mechanism.
export function trackingLabelPatch(targetClipId) {
  return { pin: { to: targetClipId }, animLoop: { id: 'float', speed: 1 } };
}
