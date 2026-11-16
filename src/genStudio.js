// ElevenLabs studio logic for the Forge panel, kept pure so it is testable without the
// DOM: how the gen.cjs catalog becomes form options, how raw form state is clamped into
// options gen.buildRequest accepts, and the job lifecycle around the gen IPC surface
// (one invoke per run, progress events, an AbortController per job in the main process).
// electron/gen.cjs stays the only place that knows the ElevenLabs API; this module only
// shapes what the panel hands it.

export const uid = () => Math.random().toString(36).slice(2, 10);

const pick = (list, v, fallback) => (list && list.includes(v) ? v : fallback);

// The panel speaks photo/video/avatar (Forge's words); gen.cjs and its catalog speak
// image/video/avatar. This is the one translation, used by every helper below and by
// the job the panel starts.
export const genKind = (mode) => (mode === 'photo' ? 'image' : mode);

// Dropdown options for one kind from the gen catalog ({ video: {id: def}, image: {...} }).
export function modelOptions(catalog, kind) {
  const models = (catalog && catalog[genKind(kind)]) || {};
  return Object.entries(models).map(([id, def]) => ({ value: id, label: def.name || id, def }));
}

export const modelDef = (catalog, kind, id) => (catalog && catalog[genKind(kind)] && catalog[genKind(kind)][id]) || null;

// The starting form state for a model: its first ratio, its default resolution/quality,
// a mid duration. The panel seeds its state from this whenever the model changes.
export function defaultOpts(catalog, kind, id) {
  const def = modelDef(catalog, kind, id);
  if (!def) return {};
  const out = { model: id, ratio: pick(def.ratios, '1:1', def.ratios?.[0]) };
  if (def.resolutions) out.resolution = pick(def.resolutions, genKind(kind) === 'image' ? '1K' : '720p', def.resolutions[0]);
  if (def.quality) out.quality = def.defaultQuality || def.quality[Math.floor(def.quality.length / 2)];
  if (def.background) out.background = 'auto';
  if (kind === 'video') {
    out.duration = def.durations ? def.durations[def.durations.length - 1] : def.range ? Math.min(8, def.range[1]) : 5;
    out.audio = true;
  }
  return out;
}

// Raw form state -> the opts object gen:run hands to gen.buildRequest. Every value is
// clamped to what the model actually accepts (buildRequest clamps again — this pass
// exists so the panel never *shows* a combination the model would silently rewrite):
// reference counts are cut to the model's limit, start/end frames and references are
// mutually exclusive (frames win — they were picked deliberately), video references are
// dropped for models that cannot take them, and the negative prompt only rides Veo.
export function clampOpts(catalog, kind, raw = {}) {
  kind = genKind(kind);
  if (kind === 'avatar') {
    // gen:run resolves text -> speech in the main process; the panel passes exactly one
    // speech source: typed text (+ voice) or an audio file.
    const o = { photo: raw.photo || '', resolution: pick(['480p', '720p'], raw.resolution, '720p') };
    if (raw.text && String(raw.text).trim()) { o.text = String(raw.text).trim(); o.voiceId = raw.voiceId || ''; }
    else if (raw.audio) o.audio = raw.audio;
    return o;
  }
  const def = modelDef(catalog, kind, raw.model);
  if (!def) return null;
  const out = { model: raw.model, prompt: String(raw.prompt || '').trim() };
  out.ratio = pick(def.ratios, raw.ratio, pick(def.ratios, '1:1', def.ratios?.[0]));
  if (def.resolutions) out.resolution = pick(def.resolutions, raw.resolution, def.resolutions[0]);
  if (kind === 'image') {
    if (def.quality) out.quality = pick(def.quality, raw.quality, def.defaultQuality || 'medium');
    if (def.background) out.background = pick(['auto', 'transparent', 'opaque'], raw.background, 'auto');
    const refs = (raw.refs || []).filter(Boolean).slice(0, def.refs || 0);
    if (refs.length) out.refs = refs;
    return out;
  }
  if (kind === 'video') {
    out.duration = def.durations
      ? pick(def.durations, Number(raw.duration), def.durations[def.durations.length - 1])
      : Math.round(Math.min(def.range[1], Math.max(def.range[0], Number(raw.duration) || def.range[0])));
    out.audio = raw.audio !== false;
    const frames = !!(raw.start || raw.end);
    if (frames) {
      if (raw.start) out.start = raw.start;
      if (raw.end) out.end = raw.end;
    } else {
      const refs = (raw.refs || []).filter((r) => r && r.path).slice(0, def.refs || 0);
      if (refs.length) out.refs = def.refRoles ? refs.map((r) => ({ path: r.path, role: r.role === 'style' ? 'style' : 'subject' })) : refs.map((r) => ({ path: r.path }));
      const videoRefs = def.videoRefs ? (raw.videoRefs || []).filter(Boolean).slice(0, def.videoRefs) : [];
      if (videoRefs.length) out.videoRefs = videoRefs;
    }
    if (def.family === 'veo' && String(raw.negative || '').trim()) out.negative = String(raw.negative).trim();
    return out;
  }
  return null;
}

// The stages the main process reports, in the words the panel prints.
export const STAGE_LABELS = {
  voicing: 'Speaking the words…', sending: 'Sending…', pending: 'Waiting in line…',
  generating: 'Generating…', saving: 'Saving to this PC…',
};

// Job lifecycle over the gen IPC seam. `api` is the slice of window.api the studio uses
// ({ genRun, genStop, onGenProgress }) — injected so tests drive the exact same code with
// a stubbed transport. Jobs: [{ id, kind, label, stage, status, error, code, result }].
export function createJobRunner(api, onChange = () => {}) {
  const jobs = new Map();
  const emit = () => onChange([...jobs.values()].sort((a, b) => b.createdAt - a.createdAt));
  const off = api.onGenProgress(({ jobId, stage }) => {
    const job = jobs.get(jobId);
    if (job && job.status === 'running') { job.stage = stage; emit(); }
  });
  return {
    list: () => [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt),
    async start(kind, opts, label = '') {
      const id = `g${uid()}`;
      const job = { id, kind, label, stage: 'sending', status: 'running', error: '', code: '', result: null, createdAt: Date.now() };
      jobs.set(id, job);
      emit();
      const res = await api.genRun(id, kind, opts);
      if (res && res.error) {
        job.status = res.code === 'stopped' ? 'stopped' : 'error';
        job.error = res.error;
        job.code = res.code || '';
      } else {
        job.status = 'done';
        job.result = res;
      }
      emit();
      return job;
    },
    stop(id) {
      const job = jobs.get(id);
      if (job && job.status === 'running') api.genStop(id);
    },
    dispose: off,
  };
}
