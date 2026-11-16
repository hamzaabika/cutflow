// Audio roles + track mixer (P2-23, AU-09): mirror parity, smart defaults,
// bus mute/solo folding, export graph filters, and a real render proving
// bus levels move the mix.
// Usage: node scripts/test-mixer.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { emptyProject, historyReducer, newVideoClip, renderable } from '../src/store.js';
import * as rmx from '../src/mixer.js';

const require = createRequire(import.meta.url);
const emx = require('../electron/mixer.cjs');
const { buildExportArgs, buildAudioExportArgs, ffmpegPath } = require('../electron/ffmpeg.cjs');

const state = (project) => ({ past: [], present: project, future: [] });

// ---- 1. Mirror parity -------------------------------------------------------
{
  const corpus = [
    [{}, 'dialogue'], [{ role: 'music' }, 'video'], [{ role: 'sfx' }, 'audio'],
    [{ role: 'bogus' }, 'audio'], [{ role: 'ambience' }, 'overlay'], [null, 'video'],
  ];
  for (const [clip, track] of corpus) {
    assert.equal(rmx.roleOf(clip, track), emx.roleOf(clip, track), `roleOf ${JSON.stringify(clip)} ${track}`);
  }
  const mixers = [
    {}, { music: -6 }, { dialogue: -20, master: -6 },
    { muted: { music: true } }, { solo: { dialogue: true } }, { solo: { music: true }, muted: { sfx: true } },
    { dialogue: 99, music: -99, master: 99, muted: { bogus: true }, solo: { dialogue: true } },
    { music: 'loud', master: null },
  ];
  for (const m of mixers) {
    const p = { mixer: m };
    for (const r of ['dialogue', 'music', 'sfx', 'ambience']) {
      assert.equal(rmx.roleGainDb(p, r), emx.roleGainDb(p, r), `roleGainDb ${JSON.stringify(m)} ${r}`);
      assert.equal(rmx.busAudible(p, r), emx.busAudible(p, r), `busAudible ${JSON.stringify(m)} ${r}`);
      assert.equal(rmx.busGainLinear(p, {}, r === 'music' ? 'audio' : 'video'), emx.busGainLinear(p, {}, r === 'music' ? 'audio' : 'video'), `busGainLinear ${JSON.stringify(m)} ${r}`);
    }
    assert.equal(rmx.masterGainDb(p), emx.masterGainDb(p), `masterGainDb ${JSON.stringify(m)}`);
    assert.equal(rmx.busVolumeFilter ? undefined : undefined, undefined);
    assert.deepEqual(rmx.sanitizeMixer(m), emx.sanitizeMixer(m), `sanitizeMixer ${JSON.stringify(m)}`);
  }
  // Filter builders (electron only): unity is null, gains render as volume=.
  assert.equal(emx.busVolumeFilter({ mixer: {} }, {}, 'video'), null, 'unity bus is no filter');
  assert.equal(emx.busVolumeFilter({ mixer: { music: -6 } }, {}, 'audio'), 'volume=0.501', 'music -6 dB is volume 0.501');
  assert.equal(emx.busVolumeFilter({ mixer: { muted: { music: true } } }, {}, 'audio'), 'volume=0', 'muted bus is volume 0');
  assert.equal(emx.masterVolumeFilter({ mixer: {} }), null, 'unity master is no filter');
  assert.equal(emx.masterVolumeFilter({ mixer: { master: -20 } }), 'volume=0.1', 'master -20 dB');
  console.log('  mirror: role / gain / audible / sanitize agree');
}

// ---- 2. Smart defaults + actions -------------------------------------------
{
  const m = { id: 'm0', type: 'video', duration: 40, hasAudio: true };
  assert.equal(newVideoClip('v1', m).role, 'dialogue', 'picture clips default to dialogue');
  let s = state({ ...emptyProject(), media: [m, { id: 'a0', type: 'audio', duration: 40, hasAudio: true }] });
  s = historyReducer(s, { type: 'addToTimeline', mediaId: 'a0', clipId: 'au1', at: 0 });
  assert.equal(s.present.audioClips[0].role, 'music', 'audio clips default to music');
  s = historyReducer(s, { type: 'addToTimeline', mediaId: 'm0', clipId: 'v1', at: 0 });
  assert.equal(s.present.videoClips[0].role, 'dialogue', 'added video defaults to dialogue');
  s = historyReducer(s, { type: 'setClipRole', track: 'audio', id: 'au1', role: 'sfx' });
  assert.equal(s.present.audioClips[0].role, 'sfx', 'role is assignable');
  s = historyReducer(s, { type: 'setClipRole', track: 'audio', id: 'au1', role: 'bogus' });
  assert.equal(s.present.audioClips[0].role, 'sfx', 'unknown role refuses');
  s = historyReducer(s, { type: 'setMixer', patch: { music: -12, master: -3 } });
  assert.equal(s.present.mixer.music, -12, 'mixer gain is set');
  assert.equal(s.present.mixer.master, -3, 'master gain is set');
  s = historyReducer(s, { type: 'setMixer', patch: { music: 99 } });
  assert.equal(s.present.mixer.music, 12, 'mixer gain clamps at +12 dB');
  s = historyReducer(s, { type: 'setMixer', patch: { muted: { music: true } } });
  assert.equal(s.present.mixer.muted.music, true, 'bus mute is set');
  s = historyReducer(s, { type: 'setMixer', patch: { solo: { dialogue: true } } });
  assert.equal(s.present.mixer.muted.music, true, 'mute map merges, it does not replace');
  assert.equal(s.present.mixer.solo.dialogue, true, 'bus solo is set');
  s = historyReducer(s, { type: 'undo' });
  assert.equal(s.present.mixer.solo.dialogue, undefined, 'mixer edits undo');
  // Role change on a locked layer refuses.
  const locked = { ...s.present, layerState: { 'audio:0': { locked: true } } };
  let ls = state(locked);
  const before = ls.present;
  ls = historyReducer(ls, { type: 'setClipRole', track: 'audio', id: 'au1', role: 'ambience' });
  assert.equal(ls.present, before, 'locked layer refuses a role change');
  console.log('  defaults + actions: roles assignable, gains clamp, locks refuse');
}

// ---- 3. renderable folds bus mute/solo into the mix -------------------------
{
  const p = {
    ...emptyProject(),
    media: [{ id: 'm0', type: 'video', duration: 40, hasAudio: true }],
    videoClips: [{ id: 'v1', mediaId: 'm0', in: 0, out: 5, speed: 1, volume: 1, role: 'dialogue' }],
    audioClips: [{ id: 'a1', mediaId: 'm0', start: 0, in: 0, out: 5, speed: 1, volume: 1, role: 'music' }],
  };
  const muted = renderable({ ...p, mixer: { ...rmx.DEFAULT_MIXER, muted: { music: true } } });
  assert.equal(muted.audioClips.length, 0, 'muted music bus drops its clips from the mix');
  assert.equal(muted.videoClips[0].muted, undefined, 'dialogue keeps sounding');
  const soloed = renderable({ ...p, mixer: { ...rmx.DEFAULT_MIXER, solo: { dialogue: true } } });
  assert.equal(soloed.audioClips.length, 0, 'soloing dialogue silences the music bus');
  assert.equal(soloed.videoClips[0].muted, undefined, 'soloed dialogue keeps sounding');
  const plain = renderable(p);
  assert.equal(plain, p, 'no bus fx, no copy');
  console.log('  renderable: bus mute/solo fold into the mix');
}

// ---- 4. Export graph + real render ------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-mixer-'));
const vid = path.join(dir, 'vid.mp4');
const mus = path.join(dir, 'mus.wav');
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-ar', '48000', '-ac', '2', vid]);
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=4', '-ar', '48000', '-ac', '2', mus]);
const media = [
  { id: 'v1', path: vid, type: 'video', duration: 4, hasAudio: true, width: 320, height: 180 },
  { id: 'mu', path: mus, type: 'audio', duration: 4, hasAudio: true },
];
const proj = (mixer) => ({
  width: 320, height: 180, fps: 30, background: '#000000', media, mixer,
  videoClips: [{ id: 'v', mediaId: 'v1', in: 0, out: 4, speed: 1, volume: 1, muted: false, role: 'dialogue', filter: 'none', adjust: {}, effects: [], transition: null }],
  overlayClips: [], textClips: [], stickerClips: [], effectClips: [],
  audioClips: [{ id: 'a', mediaId: 'mu', start: 0, in: 0, out: 4, speed: 1, volume: 1, role: 'music' }],
});
const graphOf = (p) => {
  const { args } = buildExportArgs(renderable(p), path.join(dir, 'out.mp4'));
  return args[args.indexOf('-filter_complex') + 1];
};
{
  const g = graphOf(proj({ ...rmx.DEFAULT_MIXER, music: -20 }));
  assert.ok(g.includes('volume=0.1'), `music -20 dB lands in the graph: ${g.slice(0, 400)}`);
  const gm = graphOf(proj({ ...rmx.DEFAULT_MIXER, master: -6 }));
  assert.ok(gm.includes('[amix]volume=0.501[cam]'), `master -6 dB lands on the mix: ${gm.slice(-200)}`);
  const unity = { dialogue: 0, music: 0, sfx: 0, ambience: 0, master: 0, muted: {}, solo: {} };
  const gu = graphOf(proj(unity));
  // volChainFor already emits one volume=1 per chain; a unity mixer adds none.
  assert.equal((gu.match(/volume=/g) || []).length, 2, 'unity mixer adds no bus volume filter');
  const gdef = graphOf(proj({ ...rmx.DEFAULT_MIXER }));
  assert.ok(gdef.includes('volume=0.501'), 'the smart-default music level (-6 dB) is in the graph');
  console.log('  graph: bus + master filters land where the mix is built');
}
// Real audio render: muting the music bus drops the mix by ~3 dB (half the
// power: two equal sines), the master drops it by its own dB.
const meanVol = (file) => {
  const r = spawnSync(ffmpegPath, ['-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(r.stderr || '');
  assert.ok(m, `volumedetect read ${file}`);
  return Number(m[1]);
};
const renderAudio = (name, mixer) => {
  const out = path.join(dir, `${name}.wav`);
  const args = buildAudioExportArgs(renderable(proj(mixer)), out, 'wav', {});
  execFileSync(ffmpegPath, args);
  return out;
};
{
  // Unity gains for the render checks, so each source carries equal power:
  // muting one of two equal sines drops the mix by 10·log10(2) ≈ 3 dB.
  const unity = { dialogue: 0, music: 0, sfx: 0, ambience: 0, master: 0, muted: {}, solo: {} };
  const full = meanVol(renderAudio('full', unity));
  const noMusic = meanVol(renderAudio('nomusic', { ...unity, muted: { music: true } }));
  assert.ok(noMusic < full - 2, `muting music drops the mix (${full} -> ${noMusic} dB)`);
  const masterDown = meanVol(renderAudio('master', { ...unity, master: -20 }));
  assert.ok(Math.abs((full - masterDown) - 20) < 1.5, `master -20 dB drops the mix ~20 dB (${full} -> ${masterDown} dB)`);
  const musicDown = meanVol(renderAudio('musicdown', { ...unity, music: -20 }));
  assert.ok(musicDown < full - 1 && musicDown > noMusic - 1.5, `music -20 dB drops the mix toward music-off (${full} -> ${musicDown} -> ${noMusic} dB)`);
  console.log(`  render: full ${full} dB, music muted ${noMusic} dB, master -20 ${masterDown} dB, music -20 ${musicDown} dB`);
}
console.log('test-mixer: all checks passed');
