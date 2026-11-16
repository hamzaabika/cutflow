// Gap-build Stream B bridge widening (electron/bridge.cjs): the new write ops.
// Real doc edits (detach, beats, track, template, enhance-off, reverse-restore)
// land in the shadow and survive Accept; render-needing ops (reverse, stabilize,
// matting, reframe, enhance-on, Forge) stage a *Request record only — the bridge
// never runs FFmpeg or a model. `record` stays unimplemented by design.
// Accept is in-app only (like the app itself), so the suite calls
// bridge.acceptShadow() directly after driving the HTTP surface.
// Usage: node scripts/test-bridge-gapb.cjs
const assert = require('node:assert/strict');
const bridgeCore = require('../electron/bridge.cjs');

const fixture = () => ({
  id: 'p-gapb',
  name: 'Gap B bridge fixture',
  ratio: '16:9', width: 1280, height: 720, fps: 30, background: '#000000',
  media: [
    { id: 'm1', path: '/media/a.mp4', type: 'video', duration: 12, hasAudio: true },
    { id: 'm2', path: '/media/b.mp4', type: 'video', duration: 8, hasAudio: true },
  ],
  videoClips: [
    { id: 'v1', mediaId: 'm1', in: 0, out: 12, speed: 1 },
    { id: 'v2', mediaId: 'm2', in: 0, out: 8, speed: 1, reversed: { mediaId: 'm2', in: 0, out: 8 } },
  ],
  overlayClips: [],
  textClips: [
    { id: 'cap1', caption: true, text: 'hello world', start: 0, duration: 4, y: 0.8 },
    { id: 'title1', text: 'Title', start: 1, duration: 3, y: 0.2 },
  ],
  audioClips: [],
  effectClips: [],
});

let fakeFile = null;
let commits = 0;
const bridge = bridgeCore.createBridge({
  commit: ({ json }) => {
    commits += 1;
    fakeFile = json;
    const p = JSON.parse(json);
    bridge.noteLive(p.id, json, '/fake/gapb.clipcraft.json');
  },
});

const run = async () => {
  const json0 = JSON.stringify(fixture());
  fakeFile = json0;
  bridge.noteLive('p-gapb', json0, '/fake/gapb.clipcraft.json');
  const started = await bridge.start(0);
  assert.equal(started.listening, true);
  const base = `http://127.0.0.1:${started.port}`;
  const token = started.token;
  const call = async (method, path, { session, body } = {}) => {
    const headers = { authorization: `Bearer ${token}` };
    if (session) headers['x-cutflow-session'] = session;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* raw */ }
    return { status: res.status, json, text };
  };
  const session = (await call('POST', '/v1/sessions', { body: { client: 'gapb-test' } })).json.sessionId;
  assert.ok(session);
  const mk = async () => {
    const r = await call('POST', '/v1/shadows', { session, body: {} });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json.id;
  };
  const apply = (shadowId, op, dryRun = false) => call('POST', `/v1/shadows/${shadowId}/ops`, { session, body: { op, dryRun } });
  const accept = (shadowId) => {
    const r = bridge.acceptShadow(shadowId);
    assert.ok(r.ok, JSON.stringify(r));
    return r;
  };
  const live = () => JSON.parse(fakeFile);
  const resync = () => bridge.noteLive('p-gapb', fakeFile, '/fake/gapb.clipcraft.json');

  // detach: real doc edit — muted video + linked audio clip.
  let sh = await mk();
  let r = await apply(sh, { type: 'clip.detachAudio', list: 'videoClips', clipId: 'v1' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.summary.audioClipId);
  accept(sh);
  assert.equal(live().videoClips[0].muted, true);
  assert.equal(live().audioClips.length, 1);
  assert.equal(live().audioClips[0].linkId, live().videoClips[0].linkId);
  resync();

  // detach again refuses (already linked).
  sh = await mk();
  assert.equal((await apply(sh, { type: 'clip.detachAudio', list: 'videoClips', clipId: 'v1' })).status, 400);

  // beats: real doc edit.
  sh = await mk();
  assert.equal((await apply(sh, { type: 'timeline.beats', beats: { bpm: 120, times: [0, 0.5, 1, 1.5] } })).status, 200);
  accept(sh);
  assert.deepEqual(live().beats.times, [0, 0.5, 1, 1.5]);
  resync();

  // track (pin): real doc edit; bad target refused.
  sh = await mk();
  assert.equal((await apply(sh, { type: 'clip.track', list: 'videoClips', clipId: 'v1', toClipId: 'nope' })).status, 400);
  assert.equal((await apply(sh, { type: 'clip.track', list: 'videoClips', clipId: 'v1', toClipId: 'v2' })).status, 200);
  accept(sh);
  assert.equal(live().videoClips[0].pin.to, 'v2');
  resync();

  // reverse-restore: real doc edit (v2 carries clip.reversed).
  sh = await mk();
  assert.equal((await apply(sh, { type: 'clip.reverse', list: 'videoClips', clipId: 'v2', restore: true })).status, 200);
  accept(sh);
  assert.equal(live().videoClips[1].reversed, null);
  resync();

  // reverse (apply): staged request only — no render, no media change.
  sh = await mk();
  r = await apply(sh, { type: 'clip.reverse', list: 'videoClips', clipId: 'v1' });
  assert.equal(r.status, 200);
  assert.equal(r.json.summary.staged, 'reverseRequest');
  accept(sh);
  assert.equal(live().videoClips[0].reverseRequest.from, 0);
  assert.equal(live().videoClips[0].mediaId, 'm1'); // untouched
  resync();

  // stabilize / matting / reframe / enhance-on: staged requests.
  sh = await mk();
  assert.equal((await apply(sh, { type: 'clip.stabilize', list: 'videoClips', clipId: 'v1', level: 2 })).json.summary.staged, 'stabilizeRequest');
  assert.equal((await apply(sh, { type: 'clip.matting', list: 'videoClips', clipId: 'v1', mode: 'auto' })).json.summary.staged, 'mattingRequest');
  assert.equal((await apply(sh, { type: 'clip.reframe', list: 'videoClips', clipId: 'v1', ratio: '9:16' })).json.summary.staged, 'reframeRequest');
  assert.equal((await apply(sh, { type: 'clip.enhance', list: 'videoClips', clipId: 'v1', on: true, strength: 70 })).json.summary.staged, 'enhanceRequest');
  assert.equal((await apply(sh, { type: 'clip.stabilize', list: 'videoClips', clipId: 'v1', level: 9 })).status, 400);
  assert.equal((await apply(sh, { type: 'clip.reframe', list: 'videoClips', clipId: 'v1', ratio: 'wide' })).status, 400);
  accept(sh);
  assert.equal(live().videoClips[0].stabilizeRequest.level, 2);
  assert.equal(live().videoClips[0].mattingRequest.mode, 'auto');
  assert.equal(live().videoClips[0].reframeRequest.ratio, '9:16');
  assert.equal(live().videoClips[0].enhanceRequest.strength, 70);
  resync();

  // enhance-off clears.
  sh = await mk();
  assert.equal((await apply(sh, { type: 'clip.enhance', list: 'videoClips', clipId: 'v1', on: false })).status, 200);
  accept(sh);
  assert.equal(live().videoClips[0].enhanceRequest, undefined);
  resync();

  // templates: caption style patch, whitelist-only.
  sh = await mk();
  r = await apply(sh, { type: 'document.applyTemplate', kind: 'caption', style: { size: 42, color: '#ffffff', bogus: 1 } });
  assert.equal(r.status, 200);
  assert.equal(r.json.summary.clips, 1);
  assert.deepEqual(r.json.summary.fields, ['size', 'color']);
  accept(sh);
  assert.equal(live().textClips.find((c) => c.id === 'cap1').size, 42);
  assert.equal(live().textClips.find((c) => c.id === 'title1').size, undefined);
  resync();

  // Forge: staged queue entry.
  sh = await mk();
  r = await apply(sh, { type: 'forge.request', prompt: 'a neon city skyline', duration: 3 });
  assert.equal(r.status, 200);
  assert.equal(r.json.summary.staged, 'forgeQueue');
  accept(sh);
  assert.equal(live().forgeQueue.length, 1);
  resync();

  // record: NOT widened — unknown op.
  sh = await mk();
  assert.equal((await apply(sh, { type: 'clip.record', list: 'videoClips', clipId: 'v1' })).status, 400);

  // dry-run changes nothing.
  const before = fakeFile;
  sh = await mk();
  r = await apply(sh, { type: 'timeline.beats', beats: { bpm: 90, times: [0, 1] } }, true);
  assert.equal(r.status, 200);
  assert.equal(r.json.dryRun, true);
  assert.equal(fakeFile, before);

  await bridge.stop();
  assert.ok(commits >= 8, `commits: ${commits}`);
  console.log('test-bridge-gapb: PASS');
};

run().catch((e) => { console.error(e); process.exit(1); });
