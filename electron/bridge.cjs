// Agent draft bridge: a local, token-gated HTTP door through which an external
// agent process (a CLI, another app, or FlowAI itself) can read the project that
// is open in the editor and propose edits to it — without ever touching the
// live document directly.
//
// Safety model (the whole point of the bridge):
// - It listens on 127.0.0.1 ONLY, and only while the user has enabled it in
//   Settings. Disabled means no listener exists at all.
// - Every request needs the per-launch token (minted when the bridge starts,
//   held in memory, shown in Settings so the user can hand it to their tool;
//   it is never written to disk and dies with the bridge).
// - Writes need a session (POST /v1/sessions) and land on a SHADOW draft: a
//   private copy of the project as of a recorded revision. The live project is
//   never mutated by the bridge.
// - The user reviews each shadow in the app (Agent drafts) and accepts or
//   discards it. Accept is a compare-and-swap: it commits ONLY when the live
//   project is still at the shadow's base revision — if the user edited in the
//   meantime, the accept is refused as a conflict instead of overwriting their
//   work. The commit itself goes through the host's transactional save path
//   (draftsafety.cjs), never a raw write from here.
// - Ops accept { dryRun: true }: the would-be diff is computed and returned,
//   and nothing — not even the shadow — changes.
//
// Plain-Node friendly (no Electron imports) so scripts/test-bridge.cjs drives
// the real server end to end. The host (electron/main.cjs) supplies:
//   commit({ projectId, json, file, baseRevision }) — persist an accepted
//     shadow (transactional file write + slot + version snapshot), then call
//     bridge.noteLive(...) with the committed document.
//   listVersions(projectId) — optional; backs GET /v1/project/versions.
//   derivatives() — optional; backs GET /v1/project/derivatives: the state
//     of the derivative engine's cached files for the open project (remux
//     twins, preview proxies, per-clip AudioFx / enhance renders, the fx
//     segment cache). Read-only inspection; returns a JSON value.
//   refreshDerivative({ kind, mediaId, clipId, action }) — optional; backs
//     POST /v1/derivatives/refresh (session-gated, like every write). It
//     WARMS a derivative cache file — the exact file the editor's own
//     upkeep produces; the editor records the pointer through its normal
//     pass. It never mutates the document and never accepts anything:
//     Accept stays a user act on shadow drafts, off the HTTP surface.
//   onChange() — optional; fired whenever shadows/sessions/live state move,
//     so the app can refresh its review surface.

const http = require('node:http');
const crypto = require('node:crypto');

const PREFERRED_PORT = 47617;
const MAX_SHADOWS = 8; // open (pending) shadows at once
const MAX_SESSIONS = 32;
const MAX_BODY = 32 * 1024 * 1024; // a project document is paths + metadata, never media
const TRACK_LISTS = ['videoClips', 'overlayClips', 'textClips', 'audioClips', 'effectClips'];
const EPS = 0.001;

const newId = (prefix) => `${prefix}-${crypto.randomBytes(5).toString('hex')}`;
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

function parseProject(json) {
  try {
    const p = typeof json === 'string' ? JSON.parse(json) : json;
    return p && typeof p === 'object' && !Array.isArray(p) ? p : null;
  } catch {
    return null;
  }
}

// Approximate project duration in seconds (display + range clamping only):
// the main track is sequential; free tracks end at start + length. Speed
// curves are not integrated here — the store's sampler owns exact timing.
function durationOf(p) {
  let end = 0;
  let t = 0;
  for (const c of p.videoClips || []) {
    const span = Math.max(0, (c.out || 0) - (c.in || 0));
    t += c.gap ? span : span / (c.speed || 1);
  }
  end = t;
  for (const key of ['overlayClips', 'audioClips']) {
    for (const c of p[key] || []) {
      const span = c.out != null && c.in != null ? Math.max(0, (c.out - c.in) / (c.speed || 1)) : (c.duration || 0);
      end = Math.max(end, (c.start || 0) + span);
    }
  }
  for (const c of p.textClips || []) end = Math.max(end, (c.start || 0) + (c.duration || 0));
  return end;
}

// The transcript as sentences with ABSOLUTE word timings — the same derivation
// the editor's transcript panel makes from the caption clips (src/transcript.js):
// caption clips are the only transcript; a cue without word timings is one unit.
function transcriptOf(project) {
  return (project.textClips || [])
    .filter((c) => c.caption)
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((c) => {
      const end = c.start + (c.duration || 0);
      const words = (c.words && c.words.length)
        ? c.words.map((w) => ({ text: w.text, start: c.start + w.start, end: c.start + w.end }))
        : [{ text: c.text || '', start: c.start, end }];
      return { clipId: c.id, start: c.start, end, text: c.text || '', hasWords: !!(c.words && c.words.length), words };
    });
}

function changedFields(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const out = [];
  for (const k of keys) {
    if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) out.push(k);
  }
  return out;
}

// Structural diff between two project documents: per-track added / removed /
// changed clips (with the fields that moved), caption text changes spelled
// out, and the duration shift. Capped so a wholesale replace stays readable.
function diffProjects(before, after) {
  const diff = {
    lists: {},
    added: 0, removed: 0, changed: 0,
    changes: [], captionText: [],
    durationBefore: durationOf(before), durationAfter: durationOf(after),
    truncated: false,
  };
  if (before.name !== after.name) diff.nameChanged = { from: before.name || '', to: after.name || '' };
  for (const key of TRACK_LISTS) {
    const b = new Map((before[key] || []).map((c) => [c.id, c]));
    const a = new Map((after[key] || []).map((c) => [c.id, c]));
    const counts = { added: 0, removed: 0, changed: 0 };
    for (const [id, clip] of a) {
      if (!b.has(id)) { counts.added += 1; continue; }
      const prev = b.get(id);
      if (JSON.stringify(prev) === JSON.stringify(clip)) continue;
      counts.changed += 1;
      if (diff.changes.length < 100) {
        const fields = changedFields(prev, clip);
        diff.changes.push({ list: key, clipId: id, fields });
        if (key === 'textClips' && fields.includes('text')) {
          diff.captionText.push({ clipId: id, from: String(prev.text || ''), to: String(clip.text || '') });
        }
      } else diff.truncated = true;
    }
    for (const id of b.keys()) if (!a.has(id)) counts.removed += 1;
    diff.lists[key] = counts;
    diff.added += counts.added; diff.removed += counts.removed; diff.changed += counts.changed;
  }
  return diff;
}

// ---- Shadow ops -------------------------------------------------------------
// Every op mutates a parsed project document (the shadow's copy) and returns a
// short summary. Ops never see the live document.

// Presentational fields of a caption clip (style, layer, position): everything
// except identity and timing/text, so split pieces and replacements keep the
// look of the captions they came from.
function captionStyle(base) {
  if (!base) return { y: 0.8 };
  const { id, text, start, duration, words, ...rest } = base;
  return rest;
}

function pieceFromWords(base, words) {
  const start = words[0].start;
  const end = words[words.length - 1].end;
  return {
    ...captionStyle(base),
    id: newId('cap'),
    text: words.map((w) => w.text).join(' '),
    start,
    duration: Math.max(0.05, end - start),
    words: words.map((w) => ({ text: w.text, start: w.start - start, end: w.end - start })),
    caption: true,
  };
}

function captionFromText(styleSource, start, end, text) {
  const words = text.split(/\s+/).filter(Boolean);
  const span = (end - start) / words.length;
  return {
    ...captionStyle(styleSource),
    id: newId('cap'),
    text,
    start,
    duration: end - start,
    words: words.map((w, i) => ({ text: w, start: i * span, end: (i + 1) * span })),
    caption: true,
  };
}

// Replace the caption content inside [start, end) with `text` (empty text =
// delete). Word-timed clips keep the words that fall outside the range as
// their own clips (head/tail pieces); a cue without word timings is a single
// unit and is removed whole when it intersects the range.
function applyTranscriptRange(doc, start, end, text) {
  const kept = [];
  const pieces = [];
  let styleSource = null;
  let removed = 0;
  for (const c of doc.textClips || []) {
    if (!c.caption) { kept.push(c); continue; }
    const cs = c.start;
    const ce = c.start + (c.duration || 0);
    if (ce <= start + EPS || cs >= end - EPS) { kept.push(c); continue; }
    removed += 1;
    if (!styleSource) styleSource = c;
    if (c.words && c.words.length) {
      const abs = c.words.map((w) => ({ text: w.text, start: cs + w.start, end: cs + w.end }));
      const head = abs.filter((w) => w.end <= start + EPS);
      const tail = abs.filter((w) => w.start >= end - EPS);
      if (head.length) pieces.push(pieceFromWords(c, head));
      if (tail.length) pieces.push(pieceFromWords(c, tail));
    }
  }
  let inserted = false;
  const clean = String(text || '').trim();
  const next = [...kept, ...pieces];
  if (clean) {
    next.push(captionFromText(styleSource, start, end, clean));
    inserted = true;
  }
  next.sort((a, b) => a.start - b.start);
  doc.textClips = next;
  return { removed, keptPieces: pieces.length, inserted };
}

const OPS = {
  // { type: 'transcript.setText', start, end, text }
  'transcript.setText': (doc, op) => {
    const start = Number(op.start);
    const end = Number(op.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < 0.05) {
      throw new Error('transcript.setText needs a range [start, end) of at least 0.05s, in seconds.');
    }
    const dur = durationOf(doc);
    if (dur > 0 && start >= dur) throw new Error('The range starts after the end of the project.');
    const clampedEnd = dur > 0 ? Math.min(end, dur) : end;
    const r = applyTranscriptRange(doc, start, clampedEnd, op.text);
    return { ...r, range: { start, end: clampedEnd } };
  },
  // { type: 'transcript.deleteRange', start, end }
  'transcript.deleteRange': (doc, op) => OPS['transcript.setText'](doc, { ...op, text: '' }),
  // { type: 'clip.patch', list, clipId, patch }
  'clip.patch': (doc, op) => {
    if (!TRACK_LISTS.includes(op.list)) throw new Error(`clip.patch: list must be one of ${TRACK_LISTS.join(', ')}.`);
    const list = doc[op.list] || [];
    const clip = list.find((c) => c.id === op.clipId);
    if (!clip) throw new Error(`clip.patch: no clip ${op.clipId} in ${op.list}.`);
    if (!op.patch || typeof op.patch !== 'object' || Array.isArray(op.patch)) throw new Error('clip.patch: patch must be an object.');
    const patch = { ...op.patch };
    delete patch.id; // identity is not patchable
    Object.assign(clip, patch);
    return { list: op.list, clipId: op.clipId, fields: Object.keys(patch) };
  },
  // { type: 'document.replace', project }
  'document.replace': (doc, op, shadow) => {
    const next = parseProject(op.project);
    if (!next) throw new Error('document.replace: project must be a project document (JSON object).');
    if (next.id !== shadow.projectId) throw new Error('document.replace: the document id must stay the open project\u2019s id.');
    for (const k of Object.keys(doc)) delete doc[k];
    Object.assign(doc, next);
    return { replaced: true };
  },
};

// ---- The bridge --------------------------------------------------------------

function createBridge(host = {}) {
  let server = null;
  let token = null;
  let port = null;
  let live = null; // { id, name, json, hash, revision, file }
  const sessions = new Map(); // id -> { id, client, createdAt }
  const shadows = new Map(); // id -> shadow record

  const changed = () => { try { host.onChange && host.onChange(); } catch { /* a UI refresh must never break the bridge */ } };

  // The main process reports the open project here on every save / autosave /
  // open. The revision is the CAS currency: it moves only when the document
  // content actually changes (hash), and resets when another project opens.
  function noteLive(id, json, file) {
    if (!id || typeof json !== 'string') return;
    const parsed = parseProject(json);
    if (!parsed) return;
    const hash = sha256(json);
    if (!live || live.id !== id) {
      live = { id, name: parsed.name || 'Untitled', json, hash, revision: 1, file: file || null };
    } else {
      if (hash !== live.hash) { live.revision += 1; live.json = json; live.hash = hash; }
      if (file) live.file = file;
      live.name = parsed.name || live.name;
    }
    changed();
  }

  function clearLive() { live = null; changed(); }

  function liveInfo() {
    if (!live) return null;
    const p = parseProject(live.json);
    return {
      projectId: live.id, name: live.name, revision: live.revision, file: live.file,
      duration: p ? durationOf(p) : 0,
      counts: Object.fromEntries(TRACK_LISTS.map((k) => [k, (p?.[k] || []).length])),
      media: (p?.media || []).length,
    };
  }

  function createSession(client) {
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = sessions.keys().next().value;
      sessions.delete(oldest);
    }
    const s = { id: crypto.randomUUID(), client: String(client || 'unknown').slice(0, 80), createdAt: Date.now() };
    sessions.set(s.id, s);
    return s;
  }

  function createShadow(sessionId) {
    if (!sessions.has(sessionId)) return { error: 'Unknown session.', status: 403 };
    if (!live) return { error: 'No project is open in the editor.', status: 409 };
    const pending = [...shadows.values()].filter((s) => s.status === 'pending');
    if (pending.length >= MAX_SHADOWS) return { error: `Too many open shadow drafts (max ${MAX_SHADOWS}). Accept or discard one first.`, status: 409 };
    const doc = parseProject(live.json);
    const shadow = {
      id: newId('shadow'),
      projectId: live.id,
      projectName: live.name,
      baseRevision: live.revision,
      baseJson: live.json,
      doc,
      docJson: live.json,
      sessionId,
      client: sessions.get(sessionId).client,
      createdAt: Date.now(),
      status: 'pending',
      ops: [],
    };
    shadows.set(shadow.id, shadow);
    changed();
    return { shadow };
  }

  function shadowView(shadow, withDiff = true) {
    const view = {
      id: shadow.id,
      projectId: shadow.projectId,
      projectName: shadow.projectName,
      baseRevision: shadow.baseRevision,
      liveRevision: live && live.id === shadow.projectId ? live.revision : null,
      stale: !(live && live.id === shadow.projectId && live.revision === shadow.baseRevision),
      status: shadow.status,
      client: shadow.client,
      createdAt: shadow.createdAt,
      ops: shadow.ops.map((o) => ({ type: o.type, at: o.at, summary: o.summary })),
    };
    if (withDiff && shadow.status === 'pending') {
      view.diff = diffProjects(parseProject(shadow.baseJson), shadow.doc);
    }
    return view;
  }

  function listShadows(withDiff = true) {
    return [...shadows.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => shadowView(s, withDiff));
  }

  function getShadow(id) { return shadows.get(id) || null; }

  // Apply one op to a shadow. dryRun computes against a throwaway copy: the
  // shadow document, its op log and its bytes are all left exactly as they were.
  function applyOp(sessionId, shadowId, op, dryRun = false) {
    const shadow = shadows.get(shadowId);
    if (!shadow) return { error: 'No such shadow draft.', status: 404 };
    if (shadow.sessionId !== sessionId) return { error: 'This shadow belongs to another session.', status: 403 };
    if (shadow.status !== 'pending') return { error: `This shadow was already ${shadow.status}.`, status: 409 };
    if (!op || typeof op.type !== 'string' || !OPS[op.type]) {
      return { error: `Unknown op. Supported: ${Object.keys(OPS).join(', ')}.`, status: 400 };
    }
    const working = dryRun ? parseProject(shadow.docJson) : shadow.doc;
    let summary;
    try {
      summary = OPS[op.type](working, op, shadow);
    } catch (e) {
      return { error: e.message, status: 400 };
    }
    const diff = diffProjects(parseProject(shadow.baseJson), working);
    if (!dryRun) {
      shadow.docJson = JSON.stringify(working);
      shadow.ops.push({ type: op.type, at: Date.now(), summary });
      changed();
    }
    return { ok: true, dryRun: !!dryRun, summary, diff };
  }

  // The compare-and-swap commit. Only the app (the user) calls this — never
  // the HTTP surface. A live revision that moved since the shadow was made is
  // a conflict, and the live project wins: nothing is written.
  function acceptShadow(shadowId) {
    const shadow = shadows.get(shadowId);
    if (!shadow) return { error: 'No such shadow draft.' };
    if (shadow.status !== 'pending') return { error: `This shadow was already ${shadow.status}.` };
    if (!live || live.id !== shadow.projectId) {
      return { conflict: true, reason: 'The project this draft was made from is no longer open.', baseRevision: shadow.baseRevision, liveRevision: live?.revision ?? null };
    }
    if (live.revision !== shadow.baseRevision) {
      return { conflict: true, reason: 'The project changed after this draft was made.', baseRevision: shadow.baseRevision, liveRevision: live.revision };
    }
    try {
      host.commit && host.commit({ projectId: shadow.projectId, json: shadow.docJson, file: live.file, baseRevision: shadow.baseRevision });
    } catch (e) {
      return { error: `The draft could not be saved: ${e.message}` };
    }
    shadow.status = 'accepted';
    changed();
    return { ok: true, json: shadow.docJson, revision: live ? live.revision : shadow.baseRevision };
  }

  function discardShadow(shadowId) {
    const shadow = shadows.get(shadowId);
    if (!shadow) return { error: 'No such shadow draft.' };
    if (shadow.status !== 'pending') return { error: `This shadow was already ${shadow.status}.` };
    shadow.status = 'discarded';
    shadow.doc = null; // drop the copy; the live project was never touched
    changed();
    return { ok: true };
  }

  // ---- HTTP surface ----------------------------------------------------------

  function state() {
    return { listening: !!server, port, token: server ? token : null, version: 1 };
  }

  function send(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new Error('Request body too large.')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw) return resolve({});
        try { resolve(JSON.parse(raw)); } catch { reject(new Error('Request body is not valid JSON.')); }
      });
      req.on('error', reject);
    });
  }

  function authed(req) {
    const h = String(req.headers.authorization || '');
    if (!h.startsWith('Bearer ') || !token) return false;
    const given = Buffer.from(h.slice(7));
    const mine = Buffer.from(token);
    return given.length === mine.length && crypto.timingSafeEqual(given, mine);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const parts = url.pathname.split('/').filter(Boolean);
    if (!authed(req)) return send(res, 401, { error: 'Missing or wrong bridge token.' });
    const sessionId = String(req.headers['x-cutflow-session'] || '');
    const needSession = () => {
      if (!sessions.has(sessionId)) { send(res, 403, { error: 'Missing or unknown session. Create one with POST /v1/sessions.' }); return false; }
      return true;
    };
    try {
      if (req.method === 'GET' && url.pathname === '/v1/status') {
        return send(res, 200, { ok: true, version: 1, projectOpen: !!live, live: liveInfo(), pendingShadows: [...shadows.values()].filter((s) => s.status === 'pending').length });
      }
      if (req.method === 'POST' && url.pathname === '/v1/sessions') {
        const body = await readBody(req);
        const s = createSession(body.client);
        return send(res, 201, { sessionId: s.id, createdAt: s.createdAt });
      }
      if (req.method === 'GET' && url.pathname === '/v1/project') {
        if (!live) return send(res, 409, { error: 'No project is open in the editor.' });
        return send(res, 200, liveInfo());
      }
      if (req.method === 'GET' && url.pathname === '/v1/project/document') {
        if (!live) return send(res, 409, { error: 'No project is open in the editor.' });
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        return res.end(live.json);
      }
      if (req.method === 'GET' && url.pathname === '/v1/project/transcript') {
        if (!live) return send(res, 409, { error: 'No project is open in the editor.' });
        return send(res, 200, { projectId: live.id, revision: live.revision, sentences: transcriptOf(parseProject(live.json)) });
      }
      if (req.method === 'GET' && url.pathname === '/v1/project/versions') {
        if (!live) return send(res, 409, { error: 'No project is open in the editor.' });
        if (!host.listVersions) return send(res, 501, { error: 'Version history is not exposed by this host.' });
        return send(res, 200, { projectId: live.id, versions: host.listVersions(live.id) || [] });
      }
      if (req.method === 'GET' && url.pathname === '/v1/project/derivatives') {
        if (!live) return send(res, 409, { error: 'No project is open in the editor.' });
        if (!host.derivatives) return send(res, 501, { error: 'Derivatives are not exposed by this host.' });
        return send(res, 200, { projectId: live.id, derivatives: host.derivatives() });
      }
      if (req.method === 'POST' && url.pathname === '/v1/derivatives/refresh') {
        if (!needSession()) return;
        if (!host.refreshDerivative) return send(res, 501, { error: 'Derivative refresh is not exposed by this host.' });
        const body = await readBody(req);
        const r = await host.refreshDerivative({ kind: body.kind, mediaId: body.mediaId, clipId: body.clipId, action: body.action });
        if (r && r.error) return send(res, r.status || 400, { error: r.error });
        return send(res, 200, r || { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/v1/shadows') {
        if (!needSession()) return;
        const r = createShadow(sessionId);
        if (r.error) return send(res, r.status || 400, { error: r.error });
        return send(res, 201, shadowView(r.shadow, false));
      }
      if (req.method === 'GET' && url.pathname === '/v1/shadows') {
        return send(res, 200, { shadows: listShadows(false) });
      }
      if (parts[0] === 'v1' && parts[1] === 'shadows' && parts[2]) {
        const shadow = shadows.get(parts[2]);
        if (!shadow) return send(res, 404, { error: 'No such shadow draft.' });
        if (req.method === 'GET' && parts.length === 3) return send(res, 200, shadowView(shadow));
        if (req.method === 'GET' && parts[3] === 'document') {
          if (shadow.status === 'discarded') return send(res, 410, { error: 'This shadow was discarded.' });
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          return res.end(shadow.docJson);
        }
        if (req.method === 'GET' && parts[3] === 'transcript') {
          if (shadow.status === 'discarded' || !shadow.doc) return send(res, 410, { error: 'This shadow was discarded.' });
          return send(res, 200, { shadowId: shadow.id, sentences: transcriptOf(shadow.doc) });
        }
        if (req.method === 'POST' && parts[3] === 'ops') {
          if (!needSession()) return;
          const body = await readBody(req);
          const r = applyOp(sessionId, shadow.id, body.op, body.dryRun === true);
          if (r.error) return send(res, r.status || 400, { error: r.error });
          return send(res, 200, r);
        }
        if (req.method === 'POST' && parts[3] === 'discard') {
          if (!needSession()) return;
          if (shadow.sessionId !== sessionId) return send(res, 403, { error: 'This shadow belongs to another session.' });
          const r = discardShadow(shadow.id);
          if (r.error) return send(res, 409, { error: r.error });
          return send(res, 200, r);
        }
      }
      return send(res, 404, { error: 'No such route.' });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  function start(preferred = PREFERRED_PORT) {
    if (server) return Promise.resolve(state());
    token = crypto.randomBytes(24).toString('hex');
    const srv = http.createServer((req, res) => { handle(req, res).catch(() => { try { send(res, 500, { error: 'Bridge error.' }); } catch { /* socket gone */ } }); });
    server = srv;
    return new Promise((resolve) => {
      const done = () => { port = srv.address() ? srv.address().port : null; resolve(state()); };
      srv.once('error', (e) => {
        if (e.code === 'EADDRINUSE' && preferred !== 0) srv.listen(0, '127.0.0.1', done);
        else { server = null; token = null; port = null; resolve(state()); }
      });
      srv.listen(preferred, '127.0.0.1', done);
    });
  }

  function stop() {
    for (const s of shadows.values()) if (s.status === 'pending') { s.status = 'discarded'; s.doc = null; }
    sessions.clear();
    if (server) { const srv = server; server = null; token = null; port = null; try { srv.close(); } catch { /* already closed */ } }
    changed();
    return Promise.resolve(state());
  }

  return { noteLive, clearLive, liveInfo, createSession, createShadow, applyOp, acceptShadow, discardShadow, listShadows, getShadow, start, stop, state };
}

module.exports = { createBridge, diffProjects, transcriptOf, durationOf, PREFERRED_PORT, TRACK_LISTS };
