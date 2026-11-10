// Bridge derivative surface (10/10 step 4, closing the S8 deferral): the
// agent bridge can INSPECT the derivative engine's state for the open
// project and REFRESH (warm) a derivative cache file, under the bridge's
// unchanged safety posture — loopback only, per-launch token on every
// request, a session for writes, and no Accept verb anywhere on HTTP.
//
// The host here is a faithful miniature of electron/main.cjs's host: the
// inspect states come from ffmpeg.cjs's own audioFxPathOf (the function
// the export graph consults), and the refresh runs the REAL renderAudioFx
// over a synthesized WAV. After the warm, the fake host performs the
// editor's upkeep step (recording clip.audioFxRender, as the renderer's
// pass does) and the inspect state must flip pending -> ready through
// audioFxPathOf itself — proving the warmed file is the file the editor
// uses, not a parallel cache.
// Usage: node scripts/test-bridge-derivatives.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const { createBridge } = require('../electron/bridge.cjs');
const { renderAudioFx } = require('../electron/audiofxrender.cjs');
const { hasAudioFx } = require('../electron/audiofx.cjs');
const ff = require('../electron/ffmpeg.cjs');

const SR = 16000;
function writeWav(file, seconds) {
  const n = SR * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(0.5 * Math.sin(2 * Math.PI * 440 * (i / SR)) * 32767), 44 + i * 2);
  fs.writeFileSync(file, buf);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-bridge-deriv-'));
  const cacheDir = path.join(dir, 'cache');
  const wav = path.join(dir, 'tone.wav');
  writeWav(wav, 2);

  const doc = {
    id: 'p-deriv', name: 'Derivatives',
    media: [{ id: 'm1', path: wav, name: 'tone.wav', type: 'audio', duration: 2, channels: 1 }],
    videoClips: [], overlayClips: [], textClips: [],
    audioClips: [{ id: 'a1', mediaId: 'm1', in: 0, out: 2, audioFx: { eq: { low: 6, mid: 0, high: 0 } } }],
  };
  // The fake host: same semantics as main's derivativeInspect /
  // derivativeRefresh, over this in-memory document.
  const host = {
    derivatives: () => {
      const fileState = (f) => (typeof f === 'string' && f ? (fs.existsSync(f) ? 'ready' : 'missing') : 'none');
      const media = doc.media.map((m) => ({ mediaId: m.id, remux: fileState(m.remux), lightProxy: fileState(m.lightProxy) }));
      const clips = [];
      for (const c of doc.audioClips) {
        const m = doc.media.find((x) => x.id === c.mediaId);
        const audioFx = !hasAudioFx(c.audioFx) ? 'none'
          : ff.audioFxPathOf(c, m) ? 'ready'
            : (c.audioFxRender && c.audioFxRender.path ? 'stale' : 'pending');
        if (audioFx !== 'none') clips.push({ clipId: c.id, track: 'audio', audioFx });
      }
      return { media, clips, fxSegments: { files: 0, bytes: 0, capMB: 2048 } };
    },
    refreshDerivative: async (req) => {
      if (req.kind === 'fxsegments') {
        if (req.action !== 'clear') return { error: "The fxsegments refresh supports action: 'clear' only." };
        return { ok: true, kind: req.kind, cleared: 0, bytes: 0 };
      }
      if (req.kind !== 'audiofx') return { error: `Unknown derivative kind '${req.kind}'.` };
      const clip = doc.audioClips.find((c) => c.id === req.clipId);
      if (!clip) return { error: 'No such clip in the open project.', status: 404 };
      const m = doc.media.find((x) => x.id === clip.mediaId);
      const res = await renderAudioFx({ srcPath: m.path, from: clip.in, to: clip.out, fx: clip.audioFx, channels: m.channels, cacheDir, ffmpegPath: ff.ffmpegPath });
      if (!res) return { error: 'No audio effects to render.' };
      // The editor's upkeep step, as the renderer's pass performs it: the
      // pointer is recorded on the clip once the warmed file exists.
      clip.audioFxRender = { path: res.path, chain: res.chain, from: clip.in, to: clip.out, src: m.path };
      return { ok: true, kind: 'audiofx', clipId: clip.id, path: res.path };
    },
  };

  // A host WITHOUT the hooks: both routes answer 501, the listVersions pattern.
  {
    const bare = createBridge({});
    const st = await bare.start(0);
    const base = `http://127.0.0.1:${st.port}`;
    const headers = { authorization: `Bearer ${st.token}` };
    bare.noteLive('p-deriv', JSON.stringify(doc), null);
    const r1 = await fetch(`${base}/v1/project/derivatives`, { headers });
    assert.equal(r1.status, 501, 'inspect without the host hook is a 501');
    const sess = await (await fetch(`${base}/v1/sessions`, { method: 'POST', headers, body: '{}' })).json();
    const r2 = await fetch(`${base}/v1/derivatives/refresh`, {
      method: 'POST', headers: { ...headers, 'x-cutflow-session': sess.sessionId }, body: JSON.stringify({ kind: 'audiofx', clipId: 'a1' }),
    });
    assert.equal(r2.status, 501, 'refresh without the host hook is a 501');
    await bare.stop();
    console.log('PASS  a host without the derivative hooks answers 501 on both routes');
  }

  const bridge = createBridge(host);
  const started = await bridge.start(0);
  assert.equal(started.listening, true);
  const base = `http://127.0.0.1:${started.port}`;
  const token = started.token;
  const call = async (method, route, { tok = token, session, body } = {}) => {
    const headers = {};
    if (tok) headers.authorization = `Bearer ${tok}`;
    if (session) headers['x-cutflow-session'] = session;
    const res = await fetch(`${base}${route}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  // Gating: the token guards reads, a session guards the write.
  assert.equal((await call('GET', '/v1/project/derivatives', { tok: 'wrong' })).status, 401, 'a wrong token is refused');
  assert.equal((await call('GET', '/v1/project/derivatives', { tok: null })).status, 401, 'a missing token is refused');
  assert.equal((await call('POST', '/v1/derivatives/refresh', { body: { kind: 'audiofx', clipId: 'a1' } })).status, 403, 'a refresh without a session is refused');
  console.log('PASS  gating: token on reads, session on the refresh write');

  // No live project yet: inspect is a 409, like the other project routes.
  assert.equal((await call('GET', '/v1/project/derivatives')).status, 409, 'inspect with no open project is a 409');
  bridge.noteLive('p-deriv', JSON.stringify(doc), null);

  // Inspect: the clip's render is pending, the media has no twins.
  {
    const r = await call('GET', '/v1/project/derivatives');
    assert.equal(r.status, 200);
    assert.equal(r.json.projectId, 'p-deriv');
    const d = r.json.derivatives;
    assert.equal(d.clips.length, 1, 'exactly the one effected clip is listed');
    assert.equal(d.clips[0].clipId, 'a1');
    assert.equal(d.clips[0].audioFx, 'pending', 'an unrendered effected clip reads pending');
    assert.equal(d.media[0].remux, 'none');
    assert.equal(typeof d.fxSegments.capMB, 'number');
    console.log('PASS  inspect reports the pending render and the empty caches');
  }

  // Refresh: warm the render through the bridge; the file lands in the
  // real content-addressed cache and the state flips to ready.
  const sess = await call('POST', '/v1/sessions', { body: { client: 'suite' } });
  assert.equal(sess.status, 201);
  const session = sess.json.sessionId;
  {
    const r = await call('POST', '/v1/derivatives/refresh', { session, body: { kind: 'audiofx', clipId: 'a1' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.ok, true);
    assert.ok(fs.existsSync(r.json.path), 'the warmed render exists on disk');
    const after = await call('GET', '/v1/project/derivatives');
    assert.equal(after.json.derivatives.clips[0].audioFx, 'ready', 'after the warm + upkeep record, audioFxPathOf itself calls it ready');
    console.log('PASS  refresh warms the real render; inspect then reads ready');
  }

  // Honest refusals.
  assert.equal((await call('POST', '/v1/derivatives/refresh', { session, body: { kind: 'bogus' } })).status, 400, 'an unknown kind is refused');
  assert.equal((await call('POST', '/v1/derivatives/refresh', { session, body: { kind: 'audiofx', clipId: 'nope' } })).status, 404, 'an unknown clip is a 404');
  {
    const r = await call('POST', '/v1/derivatives/refresh', { session, body: { kind: 'fxsegments', action: 'clear' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    console.log('PASS  fxsegments clear runs through the same session-gated route');
  }

  await bridge.stop();
  assert.equal(bridge.state().listening, false);

  // Wiring: main exposes the real host; ffmpeg.cjs exports the state fns.
  {
    const repo = path.join(__dirname, '..');
    const main = fs.readFileSync(path.join(repo, 'electron', 'main.cjs'), 'utf8');
    const bridgeSrc = fs.readFileSync(path.join(repo, 'electron', 'bridge.cjs'), 'utf8');
    assert.ok(main.includes('derivatives: () => derivativeInspect()') && main.includes('refreshDerivative: (req) => derivativeRefresh(req)'), 'main wires the derivative host hooks');
    assert.ok(main.includes('fxJobs.cacheStats()') && main.includes('audioFxJob'), 'main inspect reads the segment cache and shares the audiofx job guard');
    assert.ok(bridgeSrc.includes("'/v1/project/derivatives'") && bridgeSrc.includes("'/v1/derivatives/refresh'"), 'the bridge carries both routes');
    assert.ok(!bridgeSrc.includes("parts[3] === 'accept'") && !bridgeSrc.includes('/accept'), 'no Accept verb exists on the HTTP surface');
    console.log('PASS  wiring: main host, bridge routes, and still no Accept on HTTP');
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('BRIDGE DERIVATIVES OK — inspect + session-gated warm refresh over the real derivative engines');
})().catch((e) => { console.error('BRIDGE DERIVATIVES FAIL —', e.message); process.exit(1); });
