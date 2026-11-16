// Look edits (filter, color adjustments, effects) applied to every selected picture clip at once.
// An edit is made on one clip (the one the panel shows); only what changed is copied to the others, so each clip
// keeps its own other settings (a brightness change does not overwrite another clip's saturation).
// P2-6: the style is the whole look — filter + grade + adjust + the effect set (list, params,
// strength, keyframes, regions, timing) — so an effect added or tuned on one selected clip lands
// on all of them, and "Apply style" copies the source clip's full current style in one step.
// What is NOT style (and never propagates): transform, crop, mask, transition, timing, speed.

import { DEFAULT_ADJUST } from './effects.js';
import { DEFAULT_GRADE } from './fx/grade.js';
import { clipDuration } from './speedCurve.js';

const LOOK_KEYS = ['filter', 'filterIntensity', 'adjust', 'grade'];
// Effect keys are whole-value copies: the target ends up with exactly the
// source's effect set (an effect the source does not have is removed from the
// target, with its params). fxTiming windows are clamped to each target's own
// span, since windows are clip-local seconds.
const EFFECT_KEYS = ['effects', 'fxParams', 'fxStrength', 'fxKeys', 'fxRegions', 'fxTiming'];
export const STYLE_KEYS = [...LOOK_KEYS, ...EFFECT_KEYS];
const DEFAULTS = { adjust: DEFAULT_ADJUST, grade: DEFAULT_GRADE };
export const isLookPatch = (patch) => Object.keys(patch).length > 0 && Object.keys(patch).every((k) => STYLE_KEYS.includes(k));

const deep = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// A timing window clamped to a clip's own span (mirrors the clamp BoundFxCards
// applies when a window is edited directly).
function clampTiming(win, span) {
  if (!win || typeof win !== 'object') return win;
  const start = Math.min(Math.max(0, Number(win.start) || 0), Math.max(0, span - 0.1));
  const duration = Math.min(Math.max(0.1, Number(win.duration) || 0.1), Math.max(0.1, span - start));
  return { ...win, start, duration };
}

// The patch for `clip`, given the patch made on `base`.
export function lookPatchFor(base, patch, clip) {
  const out = {};
  if ('filter' in patch) out.filter = patch.filter;
  if ('filterIntensity' in patch) out.filterIntensity = patch.filterIntensity;
  for (const key of ['adjust', 'grade']) {
    if (!(key in patch)) continue;
    const next = patch[key] || {};
    if (!Object.keys(next).length) out[key] = {}; // reset
    else {
      // Panels send the full set (defaults filled in): compare with the same, so only the moved slider counts.
      const prev = { ...DEFAULTS[key], ...(base[key] || {}) };
      const changed = Object.keys(next).filter((k) => next[k] !== prev[k]);
      out[key] = { ...(clip[key] || {}), ...Object.fromEntries(changed.map((k) => [k, next[k]])) };
    }
  }
  for (const key of EFFECT_KEYS) {
    if (!(key in patch)) continue;
    if (key === 'fxTiming' && patch.fxTiming) {
      const span = clipDuration(clip);
      const next = {};
      for (const [fx, win] of Object.entries(patch.fxTiming)) next[fx] = clampTiming(win, span);
      out.fxTiming = next;
    } else {
      out[key] = deep(patch[key]);
    }
  }
  return out;
}

// The source clip's full current style, as a patch: every style key it
// carries, deep-copied so targets never share objects with the source.
export function fullStylePatch(clip) {
  const out = {};
  for (const key of STYLE_KEYS) {
    if (clip[key] !== undefined) out[key] = deep(clip[key]);
  }
  return out;
}

// One undoable action that copies the source clip's full style onto every
// target ([{ track, id }], the source itself excluded by the caller).
export function applyStyleAction(items, sourceClip) {
  const patch = fullStylePatch(sourceClip);
  return { type: 'updateMany', updates: items.map((it) => ({ track: it.track, id: it.id, patch: deep(patch) })) };
}

// Selected picture clips (main and overlay), when several are selected; otherwise [].
export function selectedPictures(project, selection) {
  if (!selection?.items) return [];
  const lists = { video: project.videoClips, overlay: project.overlayClips || [] };
  return selection.items
    .filter((it) => lists[it.track])
    .map((it) => ({ track: it.track, clip: lists[it.track].find((c) => c.id === it.id) }))
    .filter((x) => x.clip && !x.clip.gap);
}

// One undoable action that applies a look edit made on `base` to all `items` ([{ track, clip }]).
export function lookAction(items, base, patch) {
  return { type: 'updateMany', updates: items.map((it) => ({ track: it.track, id: it.clip.id, patch: lookPatchFor(base, patch, it.clip) })) };
}
