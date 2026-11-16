// Gap-build Stream B core checks (pure modules + new store actions).
// Usage: node scripts/test-gap-b-core.mjs
import assert from 'node:assert/strict';
import { normalizeProject, historyReducer, videoLayout } from '../src/store.js';
import {
  applyJCut, applyLCut, copyFxStack, frameHoldSourceOffset, frameHoldWindow,
  moveFx, pasteFxStack, panZoomPatch, setFxBypass, splitScreenPatches,
  trimLinkedAudio, clampSpeedRange, SPEED_PRESETS_NAMED, sourceWindow,
} from '../src/gapB.js';
import { PIXEL_EFFECTS, FX_TRANSITIONS, fxTransition } from '../src/fx/catalog.js';
import { pixelPasses, clipHasPixelFx } from '../src/fx/apply.js';
import { mergeAudioFxLayer, abPreviewPair } from '../src/fx/audioPresets.js';
import { projectToFcpxml } from '../src/fcpxml.js';
import { gradeToCube } from '../src/fx/lutExport.js';
import { wer, cer, evaluateSamples } from '../src/transcriptEval.js';
import {
  lowConfidenceWords, proofreadSentences, labelSpeakers, speakerSegments,
  transcriptSentences,
} from '../src/transcript.js';

const dispatch = (p, a) => historyReducer({ past: [], present: p, future: [] }, a).present;
const mk = (id, len, extra = {}) => ({ id, mediaId: 'm', in: 0, out: len, speed: 1, effects: [], ...extra });
const base = () => ({
  ...normalizeProject({}),
  media: [{ id: 'm', type: 'video', duration: 30, hasAudio: true }],
  videoClips: [mk('a', 10)],
});

// --- FX-01: bypass / reorder / copy-paste ----------------------------------
{
  const clip = mk('a', 10, { effects: ['fx_vhs', 'fx_bloom2', 'fx_grainfine'] });
  assert.equal(setFxBypass(clip, 'fx_bloom2', true).fxBypass.fx_bloom2, true);
  assert.equal(setFxBypass(setFxBypass(clip, 'fx_bloom2', true), 'fx_bloom2', false).fxBypass.fx_bloom2, undefined);
  assert.deepEqual(moveFx(clip, 'fx_bloom2', -1).effects, ['fx_bloom2', 'fx_vhs', 'fx_grainfine']);
  assert.deepEqual(moveFx(clip, 'fx_vhs', -1).effects, ['fx_vhs', 'fx_bloom2', 'fx_grainfine']); // edge: no-op
  const stack = copyFxStack({ ...clip, fxParams: { fx_vhs: { grain: 10 } }, fxStrength: { fx_vhs: 0.5 } });
  const pasted = pasteFxStack(mk('b', 5), stack);
  assert.deepEqual(pasted.effects, clip.effects);
  assert.equal(pasted.fxParams.fx_vhs.grain, 10);
  assert.equal(pasted.fxStrength.fx_vhs, 0.5);
  // Bypassed effect renders as if absent (preview + export share pixelPasses).
  const p = { ...base(), videoClips: [{ ...mk('a', 10, { effects: ['fx_vhs', 'fx_bloom2'] }), fxBypass: { fx_bloom2: true } }] };
  assert.equal(pixelPasses(p, p.videoClips[0], 0, 1).length, 1);
  assert.equal(clipHasPixelFx(p, { ...p.videoClips[0], fxBypass: { fx_vhs: true, fx_bloom2: true } }, 0, 10), false);
  // Store actions round-trip through the reducer.
  let q = dispatch(base(), { type: 'bypassEffect', id: 'video|a|fx_vhs', bypassed: true });
  assert.equal(q.videoClips[0].fxBypass.fx_vhs, true);
  q = dispatch({ ...base(), videoClips: [mk('a', 10, { effects: ['fx_vhs', 'fx_bloom2'] })] }, { type: 'moveEffect', id: 'video|a|fx_bloom2', dir: -1 });
  assert.deepEqual(q.videoClips[0].effects, ['fx_bloom2', 'fx_vhs']);
  q = dispatch(base(), { type: 'pasteFxStack', track: 'video', clipId: 'a', stack });
  assert.deepEqual(q.videoClips[0].effects, clip.effects);
}

// --- New catalog entries ----------------------------------------------------
{
  for (const id of ['fx_dreambloom', 'fx_edgegrain', 'fx_filmgate', 'fx_panzoom']) {
    const e = PIXEL_EFFECTS.find((x) => x.id === id);
    assert.ok(e, `${id} in catalog`);
    assert.ok(typeof e.expr === 'string' && e.expr.length > 10, `${id} has an expression`);
    assert.ok(Array.isArray(e.params) && e.params.length > 0, `${id} is parameterized`);
  }
  const flip = fxTransition('fx_cardflip');
  assert.ok(flip, 'card flip transition exists');
  assert.ok(flip.params.some((x) => x.key === 'direction'), 'card flip has direction');
  const expr = flip.make({ direction: 'horizontal', darken: 0.45 });
  assert.match(expr, /cos\(P\*3\.14159\)/);
  assert.match(flip.make({ direction: 'vertical', darken: 0.45 }), /B\(X, ld\(2\)\)/);
  // Distinct from the neighbours: dream bloom != bloom2, edge grain != fine grain.
  assert.notEqual(PIXEL_EFFECTS.find((x) => x.id === 'fx_dreambloom').expr, PIXEL_EFFECTS.find((x) => x.id === 'fx_bloom2').expr);
  assert.notEqual(PIXEL_EFFECTS.find((x) => x.id === 'fx_edgegrain').expr, PIXEL_EFFECTS.find((x) => x.id === 'fx_grainfine').expr);
  assert.ok(FX_TRANSITIONS.every((t) => t.id !== 'fx_filmburn'), 'removed filmburn transition stays removed');
}

// --- TL-03: J/L cuts + independent linked-audio trim -------------------------
{
  const v = mk('a', 10, { linkId: 'L1' });
  const au = { id: 'au1', mediaId: 'm', start: 0, in: 0, out: 10, speed: 1, linkId: 'L1', linkOff: 0, linkInOff: 0 };
  const p = { ...base(), videoClips: [v], audioClips: [au] };
  const j = applyJCut(p, 'a', 1.5);
  assert.equal(j.audioClips[0].start, 0); // clamped: audio already at 0 cannot lead further
  const p2 = { ...base(), videoClips: [{ ...v }], audioClips: [{ ...au, start: 2 }] };
  const j2 = applyJCut(p2, 'a', 1.5);
  assert.equal(j2.audioClips[0].start, 0.5);
  assert.equal(j2.audioClips[0].linkOff, -1.5);
  const l = applyLCut(p, 'a', 2);
  assert.equal(l.audioClips[0].out, 12);
  const t = trimLinkedAudio({ ...base(), videoClips: [v], audioClips: [{ ...au }] }, { id: 'au1', edge: 'left', delta: 2 });
  assert.equal(t.audioClips[0].in, 2);
  assert.equal(t.audioClips[0].start, 2);
  assert.equal(t.audioClips[0].linkTrimmed, true);
  // Store actions.
  const q = dispatch(p2, { type: 'jCut', id: 'a', delta: 1.5 });
  assert.equal(q.audioClips[0].start, 0.5);
}
// TL-03 + syncLinked: J/L cuts and independent linked-audio trims must move
// ONLY the audio — the picture's in/out never follow. (Regression: syncLinked's
// audio-changed branch recomputed the picture's out from the audio's out,
// so an L-cut stretched the picture and a right-edge trim shrank it; the
// branch now subtracts linkEndOff, the audio's own extension/shortfall.)
{
  const v = mk('a', 3, { linkId: 'L1' }); // in 0, out 3
  const au = { id: 'au1', mediaId: 'm', start: 0.5, in: 0, out: 3, speed: 1, linkId: 'L1', linkOff: 0.5, linkInOff: 0 };
  const pair = () => ({ ...base(), videoClips: [{ ...v }], audioClips: [{ ...au }] });
  const pic = (s) => [s.videoClips[0].in, s.videoClips[0].out];
  const aud = (s) => s.audioClips[0];
  let s = dispatch(pair(), { type: 'jCut', id: 'a', delta: 0.5 });
  assert.deepEqual(pic(s), [0, 3], 'J-cut leaves the picture alone');
  assert.equal(aud(s).start, 0);
  s = dispatch(pair(), { type: 'lCut', id: 'a', delta: 0.5 });
  assert.deepEqual(pic(s), [0, 3], 'L-cut leaves the picture alone');
  assert.equal(aud(s).out, 3.5);
  assert.equal(aud(s).linkEndOff, 0.5);
  s = dispatch(pair(), { type: 'trimLinkedAudio', id: 'au1', edge: 'right', delta: 0.5 });
  assert.deepEqual(pic(s), [0, 3], 'independent right trim leaves the picture alone');
  assert.equal(aud(s).out, 2.5);
  assert.equal(aud(s).linkEndOff, -0.5);
  s = dispatch(pair(), { type: 'trimLinkedAudio', id: 'au1', edge: 'left', delta: 0.5 });
  assert.deepEqual(pic(s), [0, 3], 'independent left trim leaves the picture alone');
  assert.equal(aud(s).in, 0.5);
  assert.equal(aud(s).linkInOff, 0.5);
  // An L-cut survives a later picture trim: the audio keeps its +0.5.
  s = dispatch(pair(), { type: 'lCut', id: 'a', delta: 0.5 });
  s = dispatch(s, { type: 'update', track: 'video', id: 'a', patch: { out: 2.5 } });
  assert.equal(s.videoClips[0].out, 2.5);
  assert.equal(aud(s).out, 3, 'audio keeps its L-cut extension after a picture trim');
}
// J-cut clamp note: applyJCut clamps delta to the audio start, so an audio
// clip already at 0 cannot lead — the UI offers J-cut on the NEXT clip's audio.

// --- P1-50: frame hold -------------------------------------------------------
{
  const clip = mk('a', 10, { frameHold: { at: 4, duration: 2 } });
  const w = frameHoldWindow(clip, 0);
  assert.deepEqual([w.start, w.end, w.at], [4, 6, 4]);
  assert.equal(frameHoldSourceOffset(clip, 5), 4);
  assert.equal(frameHoldSourceOffset(clip, 2), null);
  assert.equal(frameHoldSourceOffset(clip, 7), null);
  const q = dispatch(base(), { type: 'setFrameHold', track: 'video', id: 'a', hold: { at: 3, duration: 1.5 } });
  assert.deepEqual(q.videoClips[0].frameHold, { at: 3, duration: 1.5 });
  const q2 = dispatch(q, { type: 'setFrameHold', track: 'video', id: 'a', hold: null });
  assert.equal(q2.videoClips[0].frameHold, null);
}

// --- Split screen / pan-zoom / speed -----------------------------------------
{
  const p = { ...base(), videoClips: [mk('a', 10)], overlayClips: [mk('b', 10, { start: 0 })] };
  const patches = splitScreenPatches(p, { aTrack: 'video', aId: 'a', bTrack: 'overlay', bId: 'b', mode: 'left-right' });
  assert.equal(patches.length, 2);
  assert.equal(patches[0].patch.transform.x, -0.25);
  assert.equal(patches[1].patch.transform.x, 0.25);
  assert.equal(splitScreenPatches(p, { aTrack: 'video', aId: 'a', bTrack: 'overlay', bId: 'b', mode: 'diagonal' }).length, 0);
  const pz = panZoomPatch(mk('a', 10), { from: { scale: 1, x: 0, y: 0 }, to: { scale: 1.4, x: 0.1, y: -0.05 } });
  assert.ok(pz.effects.includes('fx_panzoom'));
  assert.equal(pz.fxParams.fx_panzoom.span, 10);
  assert.equal(pz.fxParams.fx_panzoom.endScale, 1.4);
  assert.equal(clampSpeedRange(0.01), 0.1);
  assert.equal(clampSpeedRange(500), 100);
  assert.equal(clampSpeedRange(2.5), 2.5);
  assert.deepEqual(SPEED_PRESETS_NAMED.map((x) => x.id), ['montage', 'hero', 'bullet']);
  assert.deepEqual(sourceWindow({ duration: 20 }, { inPoint: 2, outPoint: 5 }), { in: 2, out: 5 });
  assert.equal(sourceWindow({ duration: 20 }, { inPoint: 19, outPoint: 19.05 }), null);
}

// --- AU-04: merge + A/B -------------------------------------------------------
{
  const cur = { denoise: true, eq: { low: 0, mid: 0, high: 0 }, highpass: 0, lowpass: 0, comp: false, limit: false, loudnorm: false, echo: null, pitch: 0 };
  const warm = { eq: { low: 4, mid: 0, high: -3 }, highpass: 0, lowpass: 12000, comp: false, limit: false, denoise: false, loudnorm: false, echo: null, pitch: 0 };
  const merged = mergeAudioFxLayer(cur, warm);
  assert.equal(merged.denoise, true); // kept from current
  assert.equal(merged.eq.low, 4); // taken from preset
  assert.equal(merged.lowpass, 12000);
  const pair = abPreviewPair(cur, warm, 'merge');
  assert.equal(pair.b.denoise, true);
  assert.equal(pair.a.denoise, true);
  const repl = abPreviewPair(cur, warm, 'replace');
  assert.equal(repl.b.denoise, false);
}

// --- FCPXML ------------------------------------------------------------------
{
  const p = { ...base(), name: 'Demo', videoClips: [mk('a', 10)], textClips: [{ id: 't1', text: 'Hello & <world>', start: 1, duration: 2, caption: true, speaker: 'Hamza' }], audioClips: [] };
  const xml = projectToFcpxml(p);
  assert.match(xml, /<fcpxml version="1\.9">/);
  assert.match(xml, /Hello &amp; &lt;world&gt;/);
  assert.match(xml, /Speaker: Hamza/);
  assert.match(xml, /asset-clip ref="r2"/);
  assert.match(xml, /not represented in FCPXML/);
}

// --- LUT export ---------------------------------------------------------------
{
  const cube = gradeToCube({ exposure: 50, saturation: 50, temp: 20 }, 5);
  assert.match(cube, /LUT_3D_SIZE 5/);
  const rows = cube.split('\n').filter((l) => /^\d+\.\d+ \d+\.\d+ \d+\.\d+$/.test(l));
  assert.equal(rows.length, 125);
  const identity = gradeToCube({}, 3);
  const irows = identity.split('\n').filter((l) => /^\d+\.\d+ \d+\.\d+ \d+\.\d+$/.test(l));
  assert.equal(irows[0], '0.00000 0.00000 0.00000');
  assert.equal(irows[irows.length - 1], '1.00000 1.00000 1.00000');
  const withSpatial = gradeToCube({ vignette: 50, sharpen: 40 }, 3);
  assert.match(withSpatial, /NOT baked/);
}

// --- Transcript: confidence / proofreading / speakers / WER-CER ----------------
{
  const s = transcriptSentences({
    textClips: [
      { id: 'c1', caption: true, start: 0, duration: 2, text: 'hello world', words: [{ text: 'hello', start: 0, end: 1, conf: 0.9 }, { text: 'world', start: 1, end: 2, conf: 0.3 }] },
      { id: 'c2', caption: true, start: 2, duration: 2, text: 'hello  world', words: [] },
    ],
  });
  assert.equal(lowConfidenceWords(s, 0.6).length, 1);
  assert.equal(lowConfidenceWords(s, 0.6)[0].text, 'world');
  const { corrections } = proofreadSentences([{ clipId: 'c2', text: 'hello  world . the the cat' }]);
  assert.ok(corrections.some((c) => c.rule === 'double-word'));
  assert.ok(corrections.some((c) => c.rule === 'whitespace'));
  const labelled = labelSpeakers(s, { c1: 'Hamza', c2: 'Hamza' });
  assert.equal(speakerSegments(labelled).length, 1);
  assert.equal(speakerSegments(labelSpeakers(s, { c1: 'A', c2: 'B' })).length, 2);
  const q = dispatch({ ...base(), textClips: [{ id: 't1', text: 'hi', start: 0, duration: 1, caption: true }] }, { type: 'setCaptionSpeaker', clipId: 't1', speaker: 'Hamza' });
  assert.equal(q.textClips[0].speaker, 'Hamza');
  assert.ok(Math.abs(wer('hello world', 'hello world') - 0) < 1e-9);
  assert.ok(Math.abs(wer('hello world', 'hello there') - 0.5) < 1e-9);
  assert.ok(Math.abs(cer('abc', 'abd') - 1 / 3) < 1e-9);
  assert.equal(evaluateSamples([]), null);
  assert.equal(evaluateSamples([{ id: 's1', reference: 'a b', hypothesis: 'a c' }]).meanWer, 0.5);
}

// --- Q/W trim (spec matrix): one store action, magnet is the ripple --------
{
  // Q at t=4 on a 10 s clip (magnet on): left half gone, 6 s remain at 0.
  let q = dispatch(base(), { type: 'qwTrim', track: 'video', id: 'a', t: 4, which: 'q', newId: 'a2' });
  assert.equal(q.videoClips.length, 1);
  assert.equal(videoLayout(q.videoClips)[0].end - videoLayout(q.videoClips)[0].start, 6);
  assert.equal(videoLayout(q.videoClips)[0].start, 0);
  // W at t=4: right half gone, 4 s remain.
  q = dispatch(base(), { type: 'qwTrim', track: 'video', id: 'a', t: 4, which: 'w', newId: 'a2' });
  assert.equal(videoLayout(q.videoClips)[0].end - videoLayout(q.videoClips)[0].start, 4);
  // Too close to the edge: no-op, project unchanged.
  q = dispatch(base(), { type: 'qwTrim', track: 'video', id: 'a', t: 0.05, which: 'q', newId: 'a2' });
  assert.equal(q.videoClips.length, 1);
  assert.equal(videoLayout(q.videoClips)[0].end - videoLayout(q.videoClips)[0].start, 10);
  // Trim mode is recorded on the project.
  q = dispatch(base(), { type: 'setTrimMode', mode: 'qw' });
  assert.equal(q.trimMode, 'qw');
  assert.equal(dispatch(base(), { type: 'setTrimMode', mode: 'bogus' }).trimMode, undefined);
}

console.log('test-gap-b-core: PASS');
