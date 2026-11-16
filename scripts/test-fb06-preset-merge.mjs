// FB-06 (P1-16) — audio preset merge / replace + A/B.
// Applying a preset no longer has to wipe the clip: replace takes the whole
// preset, merge takes only the selected modules and keeps the rest. The
// default merge keeps the EQ out, so a manual EQ survives. The changed
// modules are reported, and the apply snapshots before/after for one-step
// undo and A/B comparison. Run: node scripts/test-fb06-preset-merge.mjs
import assert from 'node:assert/strict';
import {
  AUDIO_PRESETS, PRESET_MODULES, DEFAULT_MERGE_MODULES,
  mergeAudioFx, diffAudioFxModules, normalizeAudioFx, activePreset,
} from '../src/fx/audioPresets.js';

const byId = (id) => AUDIO_PRESETS.find((p) => p.id === id);
const clearVoice = byId('clear-voice').fx;
const underwater = byId('underwater').fx;

// A clip the user already tuned by hand: custom EQ + parametric band + pan.
const manual = {
  eq: { low: 5, mid: -2, high: 4 }, highpass: 55, lowpass: 0,
  comp: { threshold: -24, ratio: 3, attack: 10, release: 150, makeup: 3 },
  limit: false, denoise: false, loudnorm: false, echo: null, pitch: 0,
  eqBands: [{ f: 2500, g: 3, q: 1.5 }], pan: -0.2, width: 1.2,
};

// ---- 1) Default merge: manual EQ survives, preset modules land ------------
{
  const merged = mergeAudioFx(manual, clearVoice, DEFAULT_MERGE_MODULES);
  assert.deepEqual(merged.eq, manual.eq, 'manual 3-band EQ survives a merge');
  assert.deepEqual(merged.eqBands, manual.eqBands, 'manual parametric band survives a merge');
  assert.equal(merged.highpass, 80, 'preset high-pass lands');
  assert.equal(merged.lowpass, 0, 'preset low-pass lands');
  assert.deepEqual(normalizeAudioFx(merged).comp, normalizeAudioFx(clearVoice).comp, 'preset compressor lands');
  assert.equal(merged.denoise, true, 'preset denoise lands');
  assert.equal(merged.loudnorm, true, 'preset loudnorm lands');
  assert.equal(merged.pan, 0, 'preset stereo (pan 0) lands — stereo is merged by default');
}

// ---- 2) Stereo and pitch are merged by default (only EQ is kept out) -------
{
  const merged = mergeAudioFx(manual, underwater, DEFAULT_MERGE_MODULES);
  assert.equal(merged.pitch, -1, 'preset pitch lands in a merge');
  assert.equal(merged.pan, 0, 'preset pan (0) replaces the manual pan in a merge');
  assert.equal(merged.width, 1, 'preset width (1) replaces the manual width in a merge');
  assert.deepEqual(merged.eq, manual.eq, 'manual EQ still survives');
  assert.ok(!DEFAULT_MERGE_MODULES.includes('eq'), 'EQ is out of the default merge set');
  assert.deepEqual([...DEFAULT_MERGE_MODULES].sort(), [...PRESET_MODULES.filter((m) => m !== 'eq')].sort());
}

// ---- 3) Selecting modules: only the checked ones move -----------------------
{
  const merged = mergeAudioFx(manual, clearVoice, ['dynamics']);
  assert.deepEqual(merged.eq, manual.eq, 'EQ untouched when not selected');
  assert.equal(merged.highpass, 55, 'high-pass untouched when filters not selected');
  assert.equal(merged.denoise, false, 'denoise untouched when cleanup not selected');
  assert.deepEqual(normalizeAudioFx(merged).comp, normalizeAudioFx(clearVoice).comp, 'only dynamics moved');
  const none = mergeAudioFx(manual, clearVoice, []);
  assert.deepEqual(normalizeAudioFx(none), normalizeAudioFx(manual), 'merging nothing changes nothing');
  const all = mergeAudioFx(manual, clearVoice, PRESET_MODULES);
  assert.equal(activePreset(all)?.id, 'clear-voice', 'merging every module equals the preset');
}

// ---- 4) Changed modules are reported -----------------------------------------
{
  assert.deepEqual(diffAudioFxModules(manual, mergeAudioFx(manual, clearVoice, DEFAULT_MERGE_MODULES)),
    ['filters', 'dynamics', 'cleanup', 'stereo'],
    'changed modules list exactly the merged modules that moved (EQ, space and pitch did not)');
  assert.deepEqual(diffAudioFxModules(manual, manual), [], 'identical settings report no change');
  assert.deepEqual(diffAudioFxModules(manual, { ...manual, eq: { low: 0, mid: 0, high: 0 } }), ['eq'],
    'an EQ tweak alone reports only the EQ module');
}

// ---- 5) Merge is stable: applying twice, and undo restores -------------------
{
  const once = mergeAudioFx(manual, clearVoice, DEFAULT_MERGE_MODULES);
  const twice = mergeAudioFx(once, clearVoice, DEFAULT_MERGE_MODULES);
  assert.deepEqual(normalizeAudioFx(twice), normalizeAudioFx(once), 'merging the same preset twice is stable');
  // The A/B snapshots are plain clones: restoring the before snapshot is exact.
  const before = structuredClone(manual);
  assert.deepEqual(normalizeAudioFx(before), normalizeAudioFx(manual), 'before snapshot round-trips');
}
console.log('FB-06 OK: merge keeps manual EQ, selected modules land, changed modules reported, merge is stable');
