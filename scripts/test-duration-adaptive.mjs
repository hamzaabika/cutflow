// Duration-Adaptive Presets (P2-11): a preset inserted on a short clip
// adapts its timing instead of truncating, and a trim rescales the stored
// preset timing and reports what it could not adapt.
import assert from 'node:assert';
import { adaptClipPresets, animOf, presetAdaptReport } from '../src/anim.js';
import { trimClip } from '../src/store.js';

const base = { id: 'c', mediaId: 'm', in: 0, out: 4, speed: 1, transform: { scale: 1, x: 0, y: 0, rot: 0 } };

// Scaling: a 4s clip with a 0.5s fade-in and a 1s fade-out, trimmed to 2s,
// halves both durations (stored, not just clamped at playback).
const withAnim = { ...base, anim: { in: { type: 'fade_in', duration: 0.5 }, out: { type: 'fade_out', duration: 1 } }, transition: { type: 'fade', duration: 1 } };
const r1 = adaptClipPresets(withAnim, 4, 2);
assert.deepStrictEqual(r1.patch.anim.in.duration, 0.25, 'in anim halves');
assert.deepStrictEqual(r1.patch.anim.out.duration, 0.5, 'out anim halves');
assert.deepStrictEqual(r1.patch.transition.duration, 0.5, 'transition halves');
assert.ok(r1.report.scaled.length === 3, 'report lists the three scalings');
assert.deepStrictEqual(r1.report.unhandled, [], 'nothing unhandled on a plain clip');
// The adapted preset still fits and plays: animOf reads the stored values.
assert.deepStrictEqual(animOf({ ...withAnim, ...r1.patch }, 2).in.duration, 0.25, 'adapted in anim fits the short clip');

// In+out that together exceed the new length are fitted together.
const over = { ...base, anim: { in: { type: 'fade_in', duration: 1.5 }, out: { type: 'fade_out', duration: 1.5 } } };
const r2 = adaptClipPresets(over, 4, 2);
assert.ok(r2.patch.anim.in.duration + r2.patch.anim.out.duration <= 2 + 1e-9, 'in+out fitted to the short clip');

// Keyframes past the new end are reported, not rescaled (they stay glued
// to the picture); speed ramps and pins are reported too.
const keyed = {
  ...base,
  keyframes: { scale: [{ t: 0, v: 1 }, { t: 3.5, v: 2 }] },
  speedCurve: { points: [{ t: 0, speed: 1 }, { t: 4, speed: 2 }] },
  pin: { track: 'overlay', id: 'o1' },
};
const r3 = adaptClipPresets(keyed, 4, 2);
assert.strictEqual(r3.patch.anim, undefined, 'no stored animation to scale');
assert.ok(r3.patch.adaptReport && r3.patch.adaptReport.unhandled.length === 3, 'report is stored on the patch');
assert.ok(r3.report.unhandled.some((e) => e.key === 'prim.adaptKeysPastEndOne'), `keyframes reported: ${JSON.stringify(r3.report.unhandled)}`);
assert.ok(r3.report.unhandled.some((e) => e.key === 'prim.adaptSpeedCurve'), 'speed curve reported');
assert.ok(r3.report.unhandled.some((e) => e.key === 'prim.adaptPinned'), 'pin reported');
assert.ok(presetAdaptReport(keyed, 2).unhandled.length === 3, 'reporter lists the same three');

// Text-clip anims scale the same way.
const text = { id: 't', start: 0, duration: 4, animIn: { id: 'fade', dur: 0.8 }, animOut: { id: 'fade', dur: 0.4 } };
const r4 = adaptClipPresets(text, 4, 1);
assert.deepStrictEqual(r4.patch.animIn.dur, 0.2, 'text animIn scales');
assert.deepStrictEqual(r4.patch.animOut.dur, 0.1, 'text animOut scales');

// No change when the length does not change.
assert.strictEqual(adaptClipPresets(withAnim, 2, 2).patch, null, 'same length -> no patch');

// Store wiring: trimming a clip through trimClip adapts its preset timing
// and records the report on the clip.
const project = {
  media: [{ id: 'm', type: 'video', duration: 10, width: 1280, height: 720 }],
  videoClips: [
    { ...withAnim, id: 'v1' },
    { id: 'v2', mediaId: 'm', in: 0, out: 4, speed: 1 },
  ],
  overlayClips: [], textClips: [], audioClips: [], effectClips: [], stickerClips: [],
  magnet: {},
};
const trimmed = trimClip(project, { track: 'video', id: 'v1', edge: 'right', delta: 2 });
const v1 = trimmed.videoClips.find((c) => c.id === 'v1');
assert.deepStrictEqual(v1.anim.in.duration, 0.25, 'trim rescales the in animation');
assert.deepStrictEqual(v1.anim.out.duration, 0.5, 'trim rescales the out animation');
assert.deepStrictEqual(v1.transition.duration, 0.5, 'trim rescales the transition');
assert.ok(v1.adaptReport && v1.adaptReport.scaled.length === 3, 'trim records the adaptation report');

console.log('test-duration-adaptive: PASS');
