// Agent draft bridge (electron/bridge.cjs): the real HTTP server, driven end to
// end against a fake host. Covers the safety properties the bridge exists for:
// - off / stopped means NO listener at all; a wrong or missing token is a 401
// - writes need a session, and only the owning session may edit its shadow
// - agent writes land on a shadow; the live project and its "file" stay
//   byte-identical until an accept
// - accept is a revision compare-and-swap: a stale base is refused as a
//   conflict and the commit is never called; discard never calls it either
// - dry-run ops return the would-be diff and change nothing, not even the shadow
// - transcript-range edits land as normal caption clips: word-timed neighbours
//   keep their out-of-range words as pieces, the replacement spans the range
// Usage: node scripts/test-bridge.cjs
const assert = require('node:assert/strict');
const bridgeCore = require('../electron/bridge.cjs');

const fixture = () => ({
  id: 'p-bridge',
  name: 'Bridge fixture',
  ratio: '16:9', width: 1280, height: 720, fps: 30, background: '#000000',
  media: [{ id: 'm1', path: '/media/a.mp4', type: 'video', duration: 12 }],
  videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 12, speed: 1 }],
  overlayClips: [],
  textClips: [
    {
      id: 'cap1', caption: true, text: 'alpha bravo charlie delta', start: 0, duration: 4, y: 0.8,
      words: [
        { text: 'alpha', start: 0, end: 1 }, { text: 'bravo', start: 1, end: 2 },
        { text: 'charlie', start: 2, end: 3 }, { text: 'delta', start: 3, end: 4 },
      ],
    },
    {
      id: 'cap2', caption: true, text: 'echo foxtrot golf hotel', start: 5, duration: 4, y: 0.8,
      words: [
        { text: 'echo', start: 0, end: 1 }, { text: 'foxtrot', start: 1, end: 2 },
        { text: 'golf', start: 2, end: 3 }, { text: 'hotel', start: 3, end: 4 },
      ],
    },
    { id: 'cap3', caption: true, source: 'srt', text: 'imported cue', start: 10, duration: 2, y: 0.8 },
    { id: 'title1', text: 'Title card', start: 1, duration: 3, y: 0.2 },
  ],
  audioClips: [{ id: 'a1', mediaId: 'm1', start: 0, in: 0, out: 12, volume: 0.8 }],
  effectClips: [],
});

// The fake host: an in-memory "project file" + commit counter. commit mirrors
// what main.cjs does — persist, then report the committed document as live.
let fakeFile = null;
let commits = 0;
const bridge = bridgeCore.createBridge({
  commit: ({ json }) => {
    commits += 1;
    fakeFile = json;
    const p = JSON.parse(json);
    bridge.noteLive(p.id, json, '/fake/film.clipcraft.json');
  },
  listVersions: () => [{ file: '1700000000000-abcd1234.json', savedAt: 1700000000000, source: 'save' }],
});

const json0 = JSON.stringify(fixture());
fakeFile = json0;
bridge.noteLive('p-bridge', json0, '/fake/film.clipcraft.json');

const run = async () => {
  // ---- Off means no listener -------------------------------------------------
  assert.equal(bridge.state().listening, false);
  const started = await bridge.start(0); // ephemeral port for the suite
  assert.equal(started.listening, true);
  assert.ok(started.port > 0);
  assert.ok(typeof started.token === 'string' && started.token.length >= 32);
  const base = `http://127.0.0.1:${started.port}`;
  const token = started.token;
  const call = async (method, path, { tok = token, session, body } = {}) => {
    const headers = {};
    if (tok) headers.authorization = `Bearer ${tok}`;
    if (session) headers['x-cutflow-session'] = session;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* document routes return raw JSON too */ }
    return { status: res.status, json, text };
  };

  // ---- Token gate -------------------------------------------------------------
  assert.equal((await call('GET', '/v1/status', { tok: null })).status, 401);
  assert.equal((await call('GET', '/v1/status', { tok: 'wrong-token' })).status, 401);
  const status = await call('GET', '/v1/status');
  assert.equal(status.status, 200);
  assert.equal(status.json.projectOpen, true);
  assert.equal(status.json.live.revision, 1);

  // ---- Reads ------------------------------------------------------------------
  const proj = await call('GET', '/v1/project');
  assert.equal(proj.json.projectId, 'p-bridge');
  assert.equal(proj.json.counts.textClips, 4);
  const tr = await call('GET', '/v1/project/transcript');
  assert.equal(tr.json.sentences.length, 3); // cap1, cap2, cap3 (title1 is not a caption)
  assert.deepEqual(tr.json.sentences[0].words[2], { text: 'charlie', start: 2, end: 3 }); // absolute times
  const versions = await call('GET', '/v1/project/versions');
  assert.equal(versions.status, 200);
  assert.equal(versions.json.versions.length, 1);

  // ---- Sessions ---------------------------------------------------------------
  assert.equal((await call('POST', '/v1/shadows', { body: {} })).status, 403); // no session yet
  const s1 = (await call('POST', '/v1/sessions', { body: { client: 'suite-agent' } })).json.sessionId;
  const s2 = (await call('POST', '/v1/sessions', { body: { client: 'other-agent' } })).json.sessionId;
  assert.ok(s1 && s2 && s1 !== s2);

  // ---- Shadow + transcript-range edit -----------------------------------------
  const created = await call('POST', '/v1/shadows', { session: s1, body: {} });
  assert.equal(created.status, 201);
  const shadowId = created.json.id;
  assert.equal(created.json.baseRevision, 1);

  const op = await call('POST', `/v1/shadows/${shadowId}/ops`, {
    session: s1,
    body: { op: { type: 'transcript.setText', start: 2, end: 7, text: 'replaced words here' } },
  });
  assert.equal(op.status, 200, JSON.stringify(op.json));
  assert.equal(op.json.summary.removed, 2); // cap1 + cap2 intersected the range
  assert.equal(op.json.summary.keptPieces, 2); // their out-of-range words survive as pieces
  assert.equal(op.json.summary.inserted, true);
  assert.equal(op.json.diff.lists.textClips.added, 3);
  assert.equal(op.json.diff.lists.textClips.removed, 2);

  const shadowDoc = JSON.parse((await call('GET', `/v1/shadows/${shadowId}/document`)).text);
  const caps = shadowDoc.textClips.filter((c) => c.caption);
  const byText = (t) => caps.find((c) => c.text === t);
  const head = byText('alpha bravo'); // cap1's words before the range
  assert.ok(head && head.start === 0 && head.duration === 2);
  assert.deepEqual(head.words.map((w) => w.text), ['alpha', 'bravo']);
  const tail = byText('golf hotel'); // cap2's words after the range
  assert.ok(tail && tail.start === 7 && tail.duration === 2);
  const inserted = byText('replaced words here');
  assert.ok(inserted && inserted.start === 2 && inserted.duration === 5);
  assert.equal(inserted.words.length, 3);
  assert.ok(Math.abs(inserted.words[2].end - 5) < 1e-9); // word timings fill the clip, relative to its start
  assert.equal(inserted.y, 0.8); // style inherited from the replaced captions
  assert.ok(byText('imported cue')); // outside the range: untouched
  assert.ok(shadowDoc.textClips.some((c) => c.id === 'title1')); // not a caption: untouched
  assert.ok(!shadowDoc.textClips.some((c) => c.id === 'cap1' || c.id === 'cap2'));

  // The live project and its file are exactly as they were.
  assert.equal((await call('GET', '/v1/project/document')).text, json0);
  assert.equal(fakeFile, json0);
  assert.equal(commits, 0);

  // The shadow's own transcript shows the edit as normal captions.
  const str = await call('GET', `/v1/shadows/${shadowId}/transcript`);
  assert.ok(str.json.sentences.some((s) => s.text === 'replaced words here' && s.start === 2 && s.end === 7));

  // ---- Dry-run changes nothing --------------------------------------------------
  const before = (await call('GET', `/v1/shadows/${shadowId}/document`)).text;
  const dry = await call('POST', `/v1/shadows/${shadowId}/ops`, {
    session: s1,
    body: { dryRun: true, op: { type: 'transcript.deleteRange', start: 10, end: 12 } },
  });
  assert.equal(dry.status, 200);
  assert.equal(dry.json.dryRun, true);
  assert.equal(dry.json.diff.lists.textClips.removed, 3); // would remove the srt cue (diff is vs the base)
  assert.equal((await call('GET', `/v1/shadows/${shadowId}/document`)).text, before);

  // ---- Ownership + other ops ----------------------------------------------------
  assert.equal((await call('POST', `/v1/shadows/${shadowId}/ops`, {
    session: s2, body: { op: { type: 'clip.patch', list: 'audioClips', clipId: 'a1', patch: { volume: 0.1 } } },
  })).status, 403); // another session's shadow
  const patched = await call('POST', `/v1/shadows/${shadowId}/ops`, {
    session: s1, body: { op: { type: 'clip.patch', list: 'audioClips', clipId: 'a1', patch: { volume: 0.5 } } },
  });
  assert.equal(patched.status, 200);
  const doc2 = JSON.parse((await call('GET', `/v1/shadows/${shadowId}/document`)).text);
  assert.equal(doc2.audioClips[0].volume, 0.5);
  assert.equal(JSON.parse(json0).audioClips[0].volume, 0.8); // live still original
  assert.equal((await call('POST', `/v1/shadows/${shadowId}/ops`, {
    session: s1, body: { op: { type: 'document.replace', project: { ...fixture(), id: 'someone-else' } } },
  })).status, 400); // identity is not negotiable

  // ---- Accept commits (the CAS happy path) ---------------------------------------
  const accepted = bridge.acceptShadow(shadowId);
  assert.equal(accepted.ok, true);
  assert.equal(commits, 1);
  assert.equal(fakeFile, (await call('GET', '/v1/project/document')).text);
  assert.equal(JSON.parse(fakeFile).audioClips[0].volume, 0.5);
  assert.equal(bridge.liveInfo().revision, 2); // the commit moved the live revision
  assert.ok(bridge.acceptShadow(shadowId).error); // no double-accept
  assert.equal((await call('POST', `/v1/shadows/${shadowId}/ops`, {
    session: s1, body: { op: { type: 'clip.patch', list: 'audioClips', clipId: 'a1', patch: { volume: 0.2 } } },
  })).status, 409); // an accepted shadow is closed

  // ---- Stale base: conflict, no commit, discard leaves bytes identical ------------
  const created2 = await call('POST', '/v1/shadows', { session: s1, body: {} });
  const shadow2 = created2.json.id;
  assert.equal(created2.json.baseRevision, 2);
  await call('POST', `/v1/shadows/${shadow2}/ops`, {
    session: s1, body: { op: { type: 'clip.patch', list: 'audioClips', clipId: 'a1', patch: { volume: 0.3 } } },
  });
  // The user edits in the app meanwhile: a new live document, a new revision.
  const userEdit = JSON.stringify({ ...JSON.parse(fakeFile), name: 'User edit' });
  bridge.noteLive('p-bridge', userEdit, '/fake/film.clipcraft.json');
  assert.equal(bridge.liveInfo().revision, 3);
  const fileBeforeConflict = fakeFile;
  const conflict = bridge.acceptShadow(shadow2);
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.baseRevision, 2);
  assert.equal(conflict.liveRevision, 3);
  assert.equal(commits, 1); // the commit was never called for the stale draft
  assert.deepEqual(bridge.discardShadow(shadow2), { ok: true });
  assert.equal(fakeFile, fileBeforeConflict); // byte-identical after conflict + discard

  // ---- HTTP discard + stop ---------------------------------------------------------
  const created3 = await call('POST', '/v1/shadows', { session: s1, body: {} });
  assert.equal((await call('POST', `/v1/shadows/${created3.json.id}/discard`, { session: s1, body: {} })).status, 200);
  assert.equal((await call('GET', `/v1/shadows/${created3.json.id}/document`)).status, 410);
  const created4 = await call('POST', '/v1/shadows', { session: s1, body: {} });
  assert.equal(created4.status, 201);
  await bridge.stop();
  assert.equal(bridge.state().listening, false);
  assert.equal(bridge.listShadows(false).find((s) => s.id === created4.json.id).status, 'discarded'); // stopping discards pending drafts
  await assert.rejects(fetch(`${base}/v1/status`, { headers: { authorization: `Bearer ${token}` } })); // nothing listens any more

  console.log('test-bridge: all assertions passed');
};

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
