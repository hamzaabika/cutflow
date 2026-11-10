import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, ExternalLink, Film, FolderOpen, Image as ImageIcon, KeyRound, Layers, Loader2, Plus, Sparkles, Trash2, UserRound, X } from '../icons.jsx';
import { toFileUrl } from '../store.js';
import Dropdown from './Dropdown.jsx';
import Toggle from '../ui/Toggle.jsx';
import { STAGE_LABELS, clampOpts, createJobRunner, defaultOpts, genKind, modelDef, modelOptions } from '../genStudio.js';

// ElevenLabs studio — the gen.cjs backend's surface, living inside the Forge panel
// (one generation home, two engines). What it adds over Forge: talking avatars from a
// photo + speech, the Seedance video family (longer clips, more ratios, reference
// videos, start/end frames), Veo with role references and a negative prompt, and the
// GPT Image / Seedream photo models with reference photos, quality and backgrounds.
// Everything here runs on the USER's own ElevenLabs key and is billed by ElevenLabs —
// the panel says so up front; the rest of Cutflow (including Forge's free photos)
// stays free. Jobs run through genStudio's runner over the gen IPC: main holds one
// AbortController per job, progress arrives as gen:progress stages, results land in
// the generated folder and are listed by gen:list.
export default function ElevenLabsStudio(props) {
  const [status, setStatus] = useState(null); // { hasKey, tier, pro, left, limit, proUrl }
  const [catalog, setCatalog] = useState(null);
  const [mode, setMode] = useState('photo'); // photo | video | avatar
  const [prompt, setPrompt] = useState('');
  const [models, setModels] = useState({ photo: '', video: '' });
  const [form, setForm] = useState({}); // ratio/resolution/duration/quality/background/audio/negative for the active model
  const [refs, setRefs] = useState([]); // [{ path, role }] — photo refs keep role unused
  const [frames, setFrames] = useState({ start: '', end: '' });
  const [videoRefs, setVideoRefs] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [shelf, setShelf] = useState([]);
  const runnerRef = useRef(null);

  const refreshShelf = useCallback(async () => {
    const s = await window.api.genList();
    if (Array.isArray(s)) setShelf(s);
  }, []);

  useEffect(() => {
    let live = true;
    window.api.genStatus().then((s) => live && setStatus(s || { hasKey: false }));
    window.api.genModels().then((c) => live && setCatalog(c));
    refreshShelf();
    const runner = createJobRunner(
      { genRun: window.api.genRun, genStop: window.api.genStop, onGenProgress: window.api.onGenProgress },
      (list) => { setJobs(list); if (list.some((j) => j.status === 'done')) refreshShelf(); },
    );
    runnerRef.current = runner;
    return () => { live = false; runner.dispose(); };
  }, [refreshShelf]);

  const kind = mode;
  const modelId = mode === 'avatar' ? '' : models[mode];
  const def = catalog && mode !== 'avatar' ? modelDef(catalog, kind, modelId) : null;

  // Seed the form whenever the model changes (first load included).
  useEffect(() => {
    if (!catalog) return;
    if (mode === 'avatar') return;
    if (!models[mode]) {
      const first = modelOptions(catalog, mode)[0]?.value || '';
      if (first) setModels((m) => ({ ...m, [mode]: first }));
      return;
    }
    setForm(defaultOpts(catalog, kind, modelId));
    setRefs([]);
    setFrames({ start: '', end: '' });
    setVideoRefs([]);
  }, [catalog, mode, modelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const imageChoices = useMemo(() => {
    const fromMedia = (props.media || []).filter((m) => m.type === 'image').map((m) => ({ path: m.path, name: m.name }));
    const fromShelf = shelf.filter((e) => e.kind === 'image').map((e) => ({ path: e.path, name: e.prompt?.slice(0, 34) || 'Generated photo' }));
    const fromForge = (props.forgeShelf || []).filter((e) => e.kind === 'photo').map((e) => ({ path: e.path, name: e.prompt?.slice(0, 34) || 'Forged photo' }));
    return [...fromMedia, ...fromShelf, ...fromForge];
  }, [props.media, shelf, props.forgeShelf]);
  const videoChoices = useMemo(() => (props.media || []).filter((m) => m.type === 'video').map((m) => ({ path: m.path, name: m.name })), [props.media]);

  const generate = () => {
    if (mode === 'avatar') return; // the avatar form has its own button
    const raw = {
      model: modelId, prompt, ratio: form.ratio, resolution: form.resolution, duration: form.duration,
      quality: form.quality, background: form.background, audio: form.audio, negative: form.negative,
      refs, videoRefs, start: frames.start || undefined, end: frames.end || undefined,
    };
    const opts = clampOpts(catalog, kind, raw);
    if (opts) runnerRef.current?.start(genKind(kind), opts, prompt.slice(0, 48));
  };

  const addToMedia = async (entry) => {
    if ((props.media || []).some((m) => m.path === entry.path)) return;
    const [res] = await window.api.probePaths([entry.path]);
    if (res && !res.error) props.dispatch({ type: 'addMedia', items: [res] });
  };

  const running = jobs.filter((j) => j.status === 'running');
  const recent = jobs.filter((j) => j.status !== 'running').slice(0, 4);
  const canGenerate = !!def && prompt.trim().length > 0 && running.length === 0;

  return (
    <div className="el-studio">
      <div className="tpl-sec-head store">
        <span className="tab-title"><Sparkles size={15} /> ElevenLabs studio</span>
      </div>
      <p className="muted small">Avatars, Seedance videos and more photo models — powered by the ElevenLabs generation backend. It runs on <b>your own ElevenLabs key</b> and ElevenLabs bills it (photo and video need a Pro plan or higher). This part is not free; everything else in Cutflow is.</p>

      {status && !status.hasKey ? (
        <div className="forge-nokey">
          <p><strong><KeyRound size={13} /> ElevenLabs key needed.</strong> Add your key once and it also powers ElevenLabs voice-over. The key is stored encrypted on this PC and never shown again.</p>
          <button className="btn btn-primary btn-sm" onClick={() => props.onOpenSettings?.()}>Open Settings → ElevenLabs</button>
          <button className="btn btn-ghost btn-sm" onClick={() => window.api.openHelp('https://elevenlabs.io')}><ExternalLink size={13} /> Get a key at elevenlabs.io</button>
        </div>
      ) : !catalog ? (
        <p className="muted small"><Loader2 size={13} className="spin" /> Loading the model catalog…</p>
      ) : (
        <>
          {status?.pro === false && (
            <p className="error-text">Your ElevenLabs plan{status.tier ? ` (${status.tier})` : ''} cannot use photo and video generation — it needs Pro or higher. <button className="btn btn-ghost btn-sm" onClick={() => window.api.openHelp(status.proUrl)}>See plans</button></p>
          )}
          {status?.left != null && status?.limit > 0 && (
            <p className="muted small">ElevenLabs credits: <b>{status.left.toLocaleString('en-US')}</b> of {status.limit.toLocaleString('en-US')} left this month.</p>
          )}
          <div className="seg-tabs" role="tablist" aria-label="ElevenLabs mode">
            <button className={mode === 'photo' ? 'on' : ''} role="tab" aria-selected={mode === 'photo'} onClick={() => setMode('photo')}><ImageIcon size={13} /> Photo</button>
            <button className={mode === 'video' ? 'on' : ''} role="tab" aria-selected={mode === 'video'} onClick={() => setMode('video')}><Film size={13} /> Video</button>
            <button className={mode === 'avatar' ? 'on' : ''} role="tab" aria-selected={mode === 'avatar'} onClick={() => setMode('avatar')}><UserRound size={13} /> Avatar</button>
          </div>

          {mode === 'avatar' ? (
            <AvatarForm props={props} runnerRef={runnerRef} shelf={shelf} imageChoices={imageChoices} />
          ) : def ? (
            <>
              <label className="forge-label" htmlFor="el-prompt">Prompt</label>
              <textarea id="el-prompt" className="forge-prompt" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)}
                placeholder={mode === 'photo' ? 'A product photo of a brass lamp on a linen cloth…' : 'A tracking shot through a spice market at golden hour…'} />
              <label className="forge-label" htmlFor="el-model">Model</label>
              <Dropdown ariaLabel="ElevenLabs model" value={modelId} onChange={(v) => setModels((m) => ({ ...m, [mode]: v }))}
                options={modelOptions(catalog, kind).map((o) => ({ value: o.value, label: o.label }))} />
              {def.note && <p className="muted small">{def.note}</p>}

              <label className="forge-label">Ratio</label>
              <div className="chips" role="group" aria-label="Ratio">
                {(def.ratios || []).map((r) => (
                  <button key={r} className={`chip ${form.ratio === r ? 'on' : ''}`} aria-pressed={form.ratio === r} onClick={() => setForm((f) => ({ ...f, ratio: r }))}>{r}</button>
                ))}
              </div>

              {def.resolutions && (
                <>
                  <label className="forge-label" htmlFor="el-res">Resolution</label>
                  <Dropdown ariaLabel="Resolution" value={form.resolution} onChange={(v) => setForm((f) => ({ ...f, resolution: v }))}
                    options={def.resolutions.map((r) => ({ value: r, label: r }))} />
                </>
              )}

              {mode === 'photo' && def.quality && (
                <>
                  <label className="forge-label" htmlFor="el-quality">Quality</label>
                  <Dropdown ariaLabel="Quality" value={form.quality} onChange={(v) => setForm((f) => ({ ...f, quality: v }))}
                    options={def.quality.map((qv) => ({ value: qv, label: qv }))} />
                </>
              )}
              {mode === 'photo' && def.background && (
                <>
                  <label className="forge-label" htmlFor="el-bg">Background</label>
                  <Dropdown ariaLabel="Background" value={form.background} onChange={(v) => setForm((f) => ({ ...f, background: v }))}
                    options={['auto', 'transparent', 'opaque'].map((b) => ({ value: b, label: b }))} />
                </>
              )}

              {mode === 'video' && (
                <>
                  <label className="forge-label">Duration</label>
                  {def.durations ? (
                    <div className="chips" role="group" aria-label="Duration">
                      {def.durations.map((d) => (
                        <button key={d} className={`chip ${form.duration === d ? 'on' : ''}`} aria-pressed={form.duration === d} onClick={() => setForm((f) => ({ ...f, duration: d }))}>{d}s</button>
                      ))}
                    </div>
                  ) : (
                    <label className="field">
                      <span><b>{form.duration || def.range?.[0]}s</b> <span className="muted">({def.range?.[0]}–{def.range?.[1]}s)</span></span>
                      <input type="range" min={def.range?.[0]} max={def.range?.[1]} step={1} value={form.duration || def.range?.[0]} aria-label="Duration in seconds"
                        onChange={(e) => setForm((f) => ({ ...f, duration: Number(e.target.value) }))} />
                    </label>
                  )}
                  <label className="field row-field">
                    <span>Generate sound</span>
                    <Toggle checked={form.audio !== false} onChange={(e) => setForm((f) => ({ ...f, audio: e.target.checked }))} aria-label="Generate sound" />
                  </label>
                  {def.family === 'veo' && (
                    <>
                      <label className="forge-label" htmlFor="el-negative">Negative prompt <span className="muted">(optional)</span></label>
                      <textarea id="el-negative" className="forge-prompt" rows={2} value={form.negative || ''} onChange={(e) => setForm((f) => ({ ...f, negative: e.target.value }))}
                        placeholder="What to keep out: text, watermark, extra people…" />
                    </>
                  )}
                  <FramePick label="Start frame" value={frames.start} choices={imageChoices} onChange={(v) => setFrames((s) => ({ ...s, start: v }))} />
                  <FramePick label="End frame" value={frames.end} choices={imageChoices} onChange={(v) => setFrames((s) => ({ ...s, end: v }))} />
                </>
              )}

              {!(mode === 'video' && (frames.start || frames.end)) && (
                <RefPicker label={mode === 'photo' ? 'Reference photos' : 'Reference photos'}
                  max={def.refs || 0} refs={refs} setRefs={setRefs} choices={imageChoices} roles={mode === 'video' && !!def.refRoles} />
              )}
              {mode === 'video' && !!def.videoRefs && (
                <RefPicker label="Reference videos" max={def.videoRefs} refs={videoRefs.map((p) => ({ path: p }))}
                  setRefs={(next) => setVideoRefs(next.map((r) => r.path))} choices={videoChoices} />
              )}

              <button className="btn btn-primary forge-go" disabled={!canGenerate} onClick={generate}>
                <Sparkles size={14} /> Generate {mode} with {def.name}
              </button>
              <p className="muted small">Billed by ElevenLabs on your account. Failed generations are not charged.</p>
            </>
          ) : null}
        </>
      )}

      {(running.length > 0 || recent.length > 0) && (
        <div className="forge-jobs">
          {running.map((j) => (
            <div key={j.id} className="forge-job">
              <Loader2 size={13} className="spin" />
              <span className="forge-job-prompt">{j.kind === 'avatar' ? '🧑' : j.kind === 'video' ? '🎞' : '🖼'} {j.label || 'Generation'}</span>
              <span className="muted small">{STAGE_LABELS[j.stage] || j.stage}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => runnerRef.current?.stop(j.id)}>Stop</button>
            </div>
          ))}
          {recent.map((j) => (
            <div key={j.id} className={`forge-job ${j.status}`}>
              <span className="forge-job-prompt">{j.kind === 'avatar' ? '🧑' : j.kind === 'video' ? '🎞' : '🖼'} {j.label || 'Generation'}</span>
              {j.status === 'done' && <span className="forge-job-state ok">Done</span>}
              {j.status === 'stopped' && <span className="forge-job-state">Stopped — a generation that already started may still use credits</span>}
              {j.status === 'error' && <span className="forge-job-state err">{j.error}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="tpl-sec-head">
        <span className="tab-title">ElevenLabs shelf</span>
        <span className="muted small">kept on this PC</span>
      </div>
      {shelf.length === 0 ? (
        <p className="empty-note">Nothing generated with ElevenLabs yet.</p>
      ) : (
        <div className="forge-grid">
          {shelf.map((e) => (
            <div key={e.path} className="forge-card">
              <span className="forge-thumb">
                {e.kind === 'image'
                  ? <img src={toFileUrl(e.path)} alt="" draggable={false} />
                  : <video src={toFileUrl(e.path)} muted loop playsInline onMouseEnter={(ev) => ev.currentTarget.play()} onMouseLeave={(ev) => ev.currentTarget.pause()} />}
              </span>
              <span className="forge-card-prompt" title={e.prompt}>{e.prompt || (e.kind === 'avatar' ? 'Talking avatar' : '')}</span>
              <span className="forge-card-actions">
                <button title="Add to media library" aria-label="Add to media library" onClick={() => addToMedia(e)}><Download size={13} /></button>
                <button title="Add to timeline" aria-label="Add to timeline" onClick={() => props.onAddFile?.(e.path, 'main')}><Plus size={13} /></button>
                <button title="Add as overlay" aria-label="Add as overlay" onClick={() => props.onAddFile?.(e.path, 'overlay')}><Layers size={13} /></button>
                <button title="Reveal in folder" aria-label="Reveal in folder" onClick={() => window.api.genReveal(e.path)}><FolderOpen size={13} /></button>
                <button title="Delete" aria-label="Delete" onClick={() => window.api.genRemove(e.path).then((s) => Array.isArray(s) && setShelf(s))}><Trash2 size={13} /></button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FramePick({ label, value, choices, onChange }) {
  return (
    <>
      <label className="forge-label">{label} <span className="muted">(optional — frames and references cannot be combined)</span></label>
      <Dropdown ariaLabel={label} value={value || ''} onChange={onChange}
        options={[{ value: '', label: 'None' }, ...choices.map((c) => ({ value: c.path, label: c.name }))]} />
    </>
  );
}

// A capped list of reference files picked from what is already on this PC (project
// media and generated results — generation references must be real local files).
function RefPicker({ label, max, refs, setRefs, choices, roles = false }) {
  if (!max) return null;
  const add = (path) => {
    if (!path || refs.some((r) => r.path === path) || refs.length >= max) return;
    setRefs([...refs, { path, role: 'subject' }]);
  };
  return (
    <>
      <label className="forge-label">{label} <span className="muted">({refs.length}/{max})</span></label>
      {refs.map((r) => (
        <div key={r.path} className="forge-startframe">
          <img src={toFileUrl(r.path)} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
          <span title={r.path}>{r.path.split(/[\\/]/).pop()}</span>
          {roles && (
            <Dropdown ariaLabel="Reference role" value={r.role || 'subject'}
              onChange={(v) => setRefs(refs.map((x) => (x.path === r.path ? { ...x, role: v } : x)))}
              options={[{ value: 'subject', label: 'Subject' }, { value: 'style', label: 'Style' }]} />
          )}
          <button className="icon-btn" aria-label="Remove reference" onClick={() => setRefs(refs.filter((x) => x.path !== r.path))}><X size={13} /></button>
        </div>
      ))}
      {refs.length < max && (
        <Dropdown ariaLabel={`Add ${label}`} value="" onChange={add}
          options={[{ value: '', label: choices.length ? 'Add from this PC…' : 'No files available yet' },
            ...choices.filter((c) => !refs.some((r) => r.path === c.path)).map((c) => ({ value: c.path, label: c.name }))]} />
      )}
    </>
  );
}

// Talking avatar: a person's photo + what they say — typed words are spoken with an
// ElevenLabs voice in the main process; an audio file from the project works too
// (other formats are converted there). Photos kept in "My avatars" are reusable
// across projects.
function AvatarForm({ props, runnerRef, imageChoices }) {
  const [avatars, setAvatars] = useState([]);
  const [photo, setPhoto] = useState('');
  const [speech, setSpeech] = useState('text'); // text | audio
  const [text, setText] = useState('');
  const [voices, setVoices] = useState([]);
  const [voiceId, setVoiceId] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const [audio, setAudio] = useState('');
  const [resolution, setResolution] = useState('720p');
  const [note, setNote] = useState('');

  const loadAvatars = useCallback(async () => {
    const list = await window.api.avatarsList();
    if (Array.isArray(list)) setAvatars(list);
  }, []);

  useEffect(() => {
    loadAvatars();
    window.api.ttsElevenVoices().then((r) => {
      if (r?.voices?.length) { setVoices(r.voices); setVoiceId((v) => v || r.voices[0].id); }
      else if (r?.error) setVoiceError(r.error);
    });
  }, [loadAvatars]);

  const addAvatar = async () => {
    const r = await window.api.avatarsAdd();
    if (r?.error) { setNote(r.error); return; }
    if (Array.isArray(r?.list)) setAvatars(r.list);
    if (r?.added?.[0]) setPhoto(r.added[0]);
  };
  const removeAvatar = async (file) => {
    const list = await window.api.avatarsRemove(file);
    if (Array.isArray(list)) setAvatars(list);
    if (photo === file) setPhoto('');
  };

  const audioChoices = (props.media || []).filter((m) => m.type === 'audio');
  const ready = !!photo && (speech === 'text' ? !!text.trim() && !!voiceId : !!audio);

  const generate = () => {
    const opts = { photo, resolution, ...(speech === 'text' ? { text, voiceId } : { audio }) };
    runnerRef.current?.start('avatar', opts, 'Talking avatar');
  };

  return (
    <>
      <label className="forge-label">Person</label>
      {avatars.length > 0 && (
        <div className="el-avatars">
          {avatars.map((a) => (
            <span key={a.path} className={`el-avatar ${photo === a.path ? 'on' : ''}`}>
              <button type="button" onClick={() => setPhoto(a.path)} title={a.name}>
                <img src={toFileUrl(a.path)} alt="" draggable={false} />
              </button>
              <button type="button" className="el-avatar-x" aria-label={`Remove ${a.name}`} onClick={() => removeAvatar(a.path)}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="row-btns">
        <button className="btn btn-sm" onClick={addAvatar}><Plus size={13} /> Add a photo to My avatars</button>
      </div>
      <label className="forge-label" htmlFor="el-avatar-photo">…or use a photo from this project</label>
      <Dropdown ariaLabel="Avatar photo" value={avatars.some((a) => a.path === photo) ? '' : photo} onChange={setPhoto}
        options={[{ value: '', label: avatars.length ? 'Pick from My avatars above' : 'Choose a photo…' },
          ...imageChoices.map((c) => ({ value: c.path, label: c.name }))]} />

      <label className="forge-label">What they say</label>
      <div className="seg-tabs" role="tablist" aria-label="Speech source">
        <button className={speech === 'text' ? 'on' : ''} role="tab" aria-selected={speech === 'text'} onClick={() => setSpeech('text')}>Type the words</button>
        <button className={speech === 'audio' ? 'on' : ''} role="tab" aria-selected={speech === 'audio'} onClick={() => setSpeech('audio')}>Use an audio file</button>
      </div>
      {speech === 'text' ? (
        <>
          <textarea className="forge-prompt" rows={3} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Write what the person says…" aria-label="Words for the avatar" />
          <label className="forge-label" htmlFor="el-voice">Voice</label>
          <Dropdown ariaLabel="ElevenLabs voice" value={voiceId} onChange={setVoiceId}
            options={voices.map((v) => ({ value: v.id, label: `${v.name}${v.gender ? ` (${v.gender}${v.accent ? `, ${v.accent}` : ''})` : ''}` }))} />
          {voiceError && <p className="error-text">{voiceError}</p>}
        </>
      ) : (
        <>
          <label className="forge-label" htmlFor="el-audio">Audio from this project</label>
          <Dropdown ariaLabel="Speech audio" value={audio} onChange={setAudio}
            options={[{ value: '', label: audioChoices.length ? 'Choose audio…' : 'No audio in this project yet' },
              ...audioChoices.map((m) => ({ value: m.path, label: m.name }))]} />
          <p className="muted small">MP3 and WAV are used as-is; anything else is converted once.</p>
        </>
      )}

      <label className="forge-label">Resolution</label>
      <div className="chips" role="group" aria-label="Avatar resolution">
        {['480p', '720p'].map((r) => (
          <button key={r} className={`chip ${resolution === r ? 'on' : ''}`} aria-pressed={resolution === r} onClick={() => setResolution(r)}>{r}</button>
        ))}
      </div>
      {note && <p className="error-text">{note}</p>}
      <button className="btn btn-primary forge-go" disabled={!ready} onClick={generate}>
        <Sparkles size={14} /> Generate talking avatar
      </button>
      <p className="muted small">Billed by ElevenLabs on your account. Only use photos and voices you have the right to use.</p>
    </>
  );
}
