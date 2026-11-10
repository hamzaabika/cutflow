// ElevenLabs studio: the Forge panel's studio logic (src/genStudio.js) — catalog
// options, option clamping into requests the REAL gen.buildRequest accepts verbatim,
// and the job lifecycle over a stubbed IPC transport (progress stages, completion,
// error codes, stop). Plus the no-key boundary and the gen:remove guard the new IPC
// relies on. The backend itself is covered by test-gen.cjs; no key, no network here.
// Usage: node scripts/test-gen-studio.mjs
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { STAGE_LABELS, clampOpts, createJobRunner, defaultOpts, modelOptions } from '../src/genStudio.js';

const require = createRequire(import.meta.url);
const gen = require('../electron/gen.cjs');
const catalog = gen.catalog();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-gen-studio-'));
const png = path.join(tmp, 'ref.png');
fs.writeFileSync(png, Buffer.from('89504e47', 'hex'));
const mp4 = path.join(tmp, 'ref.mp4');
fs.writeFileSync(mp4, Buffer.alloc(200));
const mp3 = path.join(tmp, 'speech.mp3');
fs.writeFileSync(mp3, Buffer.alloc(200));

// ---- catalog -> form options ----
const photoModels = modelOptions(catalog, 'photo');
const videoModels = modelOptions(catalog, 'video');
assert.equal(photoModels.length, Object.keys(gen.IMAGE_MODELS).length);
assert.equal(videoModels.length, Object.keys(gen.VIDEO_MODELS).length);
assert.ok(photoModels.some((o) => o.value === 'gpt-image-2'), 'GPT Image is offered');
assert.ok(videoModels.some((o) => o.value === 'bytedance-seedance-v2.5'), 'Seedance 2.5 is offered');
assert.equal(photoModels.find((o) => o.value === 'gpt-image-2').label, 'GPT Image 2');
for (const [kind, opts] of [['photo', photoModels], ['video', videoModels]]) {
  for (const o of opts) {
    const d = defaultOpts(catalog, kind, o.value);
    assert.ok(o.def.ratios.includes(d.ratio), `${o.value}: default ratio is one of the model's`);
    if (o.def.resolutions) assert.ok(o.def.resolutions.includes(d.resolution), `${o.value}: default resolution valid`);
    if (kind === 'video') {
      const want = o.def.durations ? o.def.durations.includes(d.duration) : d.duration >= o.def.range[0] && d.duration <= o.def.range[1];
      assert.ok(want, `${o.value}: default duration valid`);
    }
  }
}
assert.ok(STAGE_LABELS.generating && STAGE_LABELS.voicing, 'stage labels cover the avatar voicing stage');
console.log('catalog options ok');

// ---- clamping: what the form holds becomes what buildRequest sends ----
{
  // Veo with start frame AND references: frames win, references are dropped (the API refuses both).
  const o = clampOpts(catalog, 'video', { model: 'veo-3.1-generate-001', prompt: ' x ', start: png, refs: [{ path: png, role: 'style' }], duration: 4, ratio: '16:9' });
  assert.equal(o.prompt, 'x');
  assert.equal(o.start, png);
  assert.equal(o.refs, undefined);
  const body = gen.buildRequest('video', o);
  assert.ok(body.start_frame && !body.images, 'frames reach the request, references do not');

  // Veo references keep their roles and force 8 seconds in the request.
  const o2 = clampOpts(catalog, 'video', { model: 'veo-3.1-fast-generate-001', prompt: 'x', refs: [{ path: png, role: 'style' }, { path: png }], negative: ' text ' });
  assert.deepEqual(o2.refs, [{ path: png, role: 'style' }, { path: png, role: 'subject' }]);
  const b2 = gen.buildRequest('video', o2);
  assert.equal(b2.duration_secs, 8);
  assert.equal(b2.negative_prompt, 'text');

  // Seedance: an over-long duration clamps to the model's range; video refs are capped.
  const o3 = clampOpts(catalog, 'video', { model: 'bytedance-seedance-v2-mini', prompt: 'x', duration: 99, videoRefs: [mp4, mp4, mp4, mp4] });
  assert.equal(o3.duration, 15);
  assert.equal(o3.videoRefs.length, 3, 'video refs capped at the model limit');
  assert.equal(gen.buildRequest('video', o3).videos.length, 3);

  // A model without video refs drops them silently.
  const o4 = clampOpts(catalog, 'video', { model: 'veo-3.1-generate-001', prompt: 'x', videoRefs: [mp4] });
  assert.equal(o4.videoRefs, undefined);

  // GPT Image: quality is clamped to the model's own list; background rides along; refs cap.
  const o5 = clampOpts(catalog, 'image', { model: 'gpt-image-1', prompt: 'x', quality: 'max', background: 'transparent', refs: [png, png, png, png, png, png] });
  assert.ok(gen.IMAGE_MODELS['gpt-image-1'].quality.includes(o5.quality), 'quality clamped to a value the model takes');
  assert.equal(o5.background, 'transparent');
  assert.equal(o5.refs.length, 5);
  assert.equal(gen.buildRequest('image', o5).images.length, 5);

  // Invalid ratio/resolution fall back to model values; unknown model -> null (the form cannot send it).
  const o6 = clampOpts(catalog, 'image', { model: 'gemini-2.5-flash-image', prompt: 'x', ratio: '7:3', resolution: '9K' });
  assert.equal(o6.ratio, '1:1');
  assert.equal(o6.resolution, undefined, 'a model without resolutions sends none');
  assert.equal(clampOpts(catalog, 'image', { model: 'sora', prompt: 'x' }), null);

  // Avatar: exactly one speech source reaches the request.
  const a1 = clampOpts(catalog, 'avatar', { photo: png, text: ' hello ', voiceId: 'v1', audio: mp3, resolution: '1080p' });
  assert.deepEqual(a1, { photo: png, resolution: '720p', text: 'hello', voiceId: 'v1' });
  const a2 = clampOpts(catalog, 'avatar', { photo: png, audio: mp3 });
  assert.deepEqual(a2, { photo: png, resolution: '720p', audio: mp3 });
  assert.equal(gen.buildRequest('avatar', a2).model_id, gen.AVATAR_MODEL);
}
console.log('option clamping ok');

// ---- job lifecycle over a stubbed transport ----
{
  const listeners = new Set();
  const stopped = [];
  let resolveRun = null;
  const api = {
    genRun: () => new Promise((res) => { resolveRun = res; }),
    genStop: (id) => { stopped.push(id); resolveRun({ error: 'Stopped.', code: 'stopped' }); },
    onGenProgress: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
  const emit = (p) => listeners.forEach((fn) => fn(p));
  let changes = 0;
  const runner = createJobRunner(api, () => { changes++; });

  const done = runner.start('video', { prompt: 'x' }, 'A rocket');
  const job = runner.list()[0];
  assert.equal(job.status, 'running');
  assert.equal(job.stage, 'sending');
  emit({ jobId: 'someone-else', stage: 'generating' });
  assert.equal(runner.list()[0].stage, 'sending', 'progress for other jobs is ignored');
  emit({ jobId: job.id, stage: 'generating' });
  assert.equal(runner.list()[0].stage, 'generating');
  resolveRun({ path: '/tmp/out.mp4', kind: 'video' });
  const finished = await done;
  assert.equal(finished.status, 'done');
  assert.equal(finished.result.path, '/tmp/out.mp4');

  const failed = runner.start('image', { prompt: 'y' }, 'A bottle');
  resolveRun({ error: 'Video and photo generation needs an ElevenLabs Pro plan or higher.', code: 'pro_required' });
  const failedJob = await failed;
  assert.equal(failedJob.status, 'error');
  assert.equal(failedJob.code, 'pro_required', 'the error code survives for the UI hint');
  assert.match(failedJob.error, /Pro plan/);

  const halted = runner.start('avatar', { photo: png }, 'Talking avatar');
  const haltedJob = runner.list().find((j) => j.status === 'running');
  runner.stop(haltedJob.id);
  assert.deepEqual(stopped, [haltedJob.id], 'stop reaches the transport with the job id');
  assert.equal((await halted).status, 'stopped');
  assert.ok(changes >= 6, 'every transition notified the panel');
  runner.dispose();
  assert.equal(listeners.size, 0, 'dispose unsubscribes the progress listener');
}
console.log('job lifecycle ok');

// ---- the no-key boundary: exactly what Generate hits with no key saved ----
{
  let fetches = 0;
  const fetchImpl = async () => { fetches++; throw new Error('must not be called'); };
  await assert.rejects(
    gen.run(fetchImpl, '', tmp, 'image', { prompt: 'x', model: 'gemini-2.5-flash-image' }),
    (e) => e.code === 'no_key' && /Settings/.test(e.message),
  );
  assert.equal(fetches, 0, 'no request leaves the PC without a key');
}
console.log('no-key boundary ok');

// ---- gen.remove: the shelf delete the new IPC exposes ----
{
  const outDir = path.join(tmp, 'generated');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'image-1.png');
  fs.writeFileSync(file, Buffer.alloc(300));
  fs.writeFileSync(`${file}.json`, JSON.stringify({ kind: 'image', prompt: 'x', model: 'm', createdAt: 1 }));
  assert.equal(gen.list(outDir).length, 1);
  assert.throws(() => gen.remove(outDir, path.join(tmp, 'elsewhere.png')), /Not a generated file/);
  gen.remove(outDir, file);
  assert.ok(!fs.existsSync(file) && !fs.existsSync(`${file}.json`), 'file and its description are deleted');
  assert.equal(gen.list(outDir).length, 0);
}
console.log('gen remove ok');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('GEN STUDIO OK');
