// Unified inspector levels (FB-29 · P1-44): one selected clip maps to one
// inspector with Basic / Advanced / Presets tabs.
//
//   Basic    — the controls most users need: Strength, Timing, Direction,
//               Enable (transform, blend, crop, filter, colour, effects,
//               transition). Keyframes, curves, masks, tracking, chroma,
//               speed curves and audio tools stay out of the way.
//   Advanced — everything Basic has, plus the technical controls: keyframe
//               graph, segment easing, stabilisation, motion tracking, pin,
//               mask, chroma, animation, audio, speed, smooth cut.
//   Presets  — one-click looks (the filter catalogue) + clear look.
//
// Changed-value state: clipChangedFlags reports, per area, whether the clip
// differs from its authored defaults, so the inspector can show a dot on
// the changed sections and tabs instead of making the user hunt. resetClip
// returns the one patch that restores the clip's look + transform defaults
// (one dispatch, one undo step).
import { DEFAULT_ADJUST } from '../effects.js';
import { hasAdjust } from '../fx/adjust.js';
import { hasFilter } from '../fx/filters.js';
import { hasGrade } from '../fx/grade.js';
import { DEFAULT_CROP, resetTransformPatch, transformOf } from '../visual.js';

export const INSPECTOR_LEVELS = ['basic', 'advanced', 'presets'];

// Inner ClipInspector tabs visible at each level (video tab + adjust tab in
// Basic; everything in Advanced; Presets replaces the tab set entirely).
export function levelTabs(level, isVideo) {
  if (level === 'presets') return [];
  if (level === 'basic') return ['video', 'adjust'];
  const tabs = ['video', 'animation'];
  if (isVideo) tabs.push('audio', 'speed');
  tabs.push('adjust');
  return tabs;
}

// Whether a video-sub section is advanced-only (hidden in Basic).
export function isAdvancedSection(id) {
  return ['video:stabilize', 'video:tracking', 'video:pin', 'video:segment-easing', 'video:keyframe-graph', 'adjust:smoothcut'].includes(id);
}

export function clipChangedFlags(clip) {
  const tf = transformOf(clip);
  const transform = tf.scale !== 1 || tf.x !== 0 || tf.y !== 0 || tf.rot !== 0
    || !!(clip.keyframes && Object.keys(clip.keyframes).length);
  const blend = (clip.opacity ?? 1) !== 1 || (clip.blend || 'normal') !== 'normal';
  const crop = !!clip.crop && Object.values(clip.crop).some((v) => v !== 0);
  const look = hasFilter(clip) || hasAdjust(clip) || hasGrade(clip);
  const effects = !!(clip.effects || []).length;
  const transition = !!clip.transition;
  return { transform, blend, crop, look, effects, transition };
}

export function resetClipPatch(clip, track) {
  return {
    ...resetTransformPatch(clip, track),
    blend: 'normal',
    opacity: 1,
    crop: { ...DEFAULT_CROP },
    filter: 'none',
    grade: undefined,
    adjust: { ...DEFAULT_ADJUST },
  };
}
