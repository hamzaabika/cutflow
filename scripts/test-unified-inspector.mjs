// Unified inspector acceptance test (FB-29 · P1-44).
// Run: node scripts/test-unified-inspector.mjs
import assert from 'assert/strict';
import { INSPECTOR_LEVELS, clipChangedFlags, isAdvancedSection, levelTabs, resetClipPatch } from '../src/fx/inspectorLevels.js';

const clip = (over = {}) => ({ id: 'c1', in: 0, out: 6, ...over });

// Levels and tab visibility (progressive disclosure).
assert.deepEqual(INSPECTOR_LEVELS, ['basic', 'advanced', 'presets']);
assert.deepEqual(levelTabs('basic', true), ['video', 'adjust'], 'Basic shows video + adjust only');
assert.deepEqual(levelTabs('advanced', true), ['video', 'animation', 'audio', 'speed', 'adjust']);
assert.deepEqual(levelTabs('advanced', false), ['video', 'animation', 'adjust'], 'photos have no audio/speed tabs');
assert.deepEqual(levelTabs('presets', true), [], 'Presets replaces the tab set');
assert.ok(isAdvancedSection('video:stabilize'));
assert.ok(isAdvancedSection('video:keyframe-graph'));
assert.ok(isAdvancedSection('adjust:smoothcut'));
assert.ok(!isAdvancedSection('video:transform'));
assert.ok(!isAdvancedSection('adjust:effects'));
// Changed-value states: a plain clip is unchanged everywhere…
{
  const f = clipChangedFlags(clip());
  assert.deepEqual(f, { transform: false, blend: false, crop: false, look: false, effects: false, transition: false });
}
// …and each edit lights its own flag only.
assert.equal(clipChangedFlags(clip({ transform: { scale: 1.5 } })).transform, true);
assert.equal(clipChangedFlags(clip({ opacity: 0.5 })).blend, true);
assert.equal(clipChangedFlags(clip({ crop: { l: 0.1, t: 0, r: 0, b: 0 } })).crop, true);
assert.equal(clipChangedFlags(clip({ filter: 'noir' })).look, true);
assert.equal(clipChangedFlags(clip({ adjust: { brightness: 0.2, contrast: 1, saturation: 1, hue: 0, blur: 0 } })).look, true);
assert.equal(clipChangedFlags(clip({ effects: ['grain'] })).effects, true);
assert.equal(clipChangedFlags(clip({ transition: { type: 'dissolve', duration: 0.5 } })).transition, true);
assert.equal(clipChangedFlags(clip({ filter: 'none' })).look, false, 'filter none is not a change');
// Reset restores defaults (and the flags go dark again).
{
  const c = clip({ transform: { scale: 2, x: 0.1, y: 0, rot: 10 }, opacity: 0.5, blend: 'screen', crop: { l: 0.1, t: 0, r: 0, b: 0 }, filter: 'noir', effects: ['grain'] });
  const p = resetClipPatch(c, 'video');
  assert.equal(p.filter, 'none');
  assert.equal(p.opacity, 1);
  assert.equal(p.blend, 'normal');
  assert.deepEqual(p.crop, { l: 0, t: 0, r: 0, b: 0 });
  assert.equal(p.grade, undefined);
  assert.deepEqual(p.adjust, { brightness: 0, contrast: 1, saturation: 1, hue: 0, blur: 0 });
  // Applying the reset (as the store's update would) clears every flag.
  const after = { ...c, ...p };
  const f = clipChangedFlags(after);
  assert.equal(f.transform, false, 'transform reset');
  assert.equal(f.blend, false, 'blend reset');
  assert.equal(f.crop, false, 'crop reset');
  assert.equal(f.look, false, 'look reset');
}
console.log('unified-inspector OK: Basic/Advanced/Presets levels, changed flags per area, reset restores defaults');
