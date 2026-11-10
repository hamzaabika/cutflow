import React, { useEffect, useState } from 'react';
import { AudioLines, Cable, CircleAlert, CircleCheck, Copy, ExternalLink, Eye, EyeOff, Film, Gauge, Keyboard, Loader2, RotateCcw, Server, ShieldCheck, Sparkles, Trash2, X } from '../icons.jsx';
import Toggle from '../ui/Toggle.jsx';
import { KEY_ACTIONS, actionLabel, applyKeymapOverrides, chordFromEvent, diffOverrides, formatChord, resolveKeymap, setKeyCaptureActive } from '../keymap.js';

const PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini', needsKey: true, hint: 'The easiest key is a free one from Google AI Studio (starts with AIza). Vertex AI express keys (AQ.…) work too once the API is enabled for their project.', keyUrl: 'https://aistudio.google.com/app/apikey', keyUrlLabel: 'Get a free key (AI Studio)' },
  { id: 'groq', name: 'Groq (fast, free tier)', needsKey: true, hint: 'Free key from the Groq console (starts with gsk_). Very fast. Recommended model: openai/gpt-oss-120b (works well with the FlowAI editing tools). "Load models" shows the ones your key can use.', keyUrl: 'https://console.groq.com/keys', keyUrlLabel: 'Get a free key (Groq)' },
  { id: 'ollama', name: 'Ollama (local, free)', needsKey: false, hint: 'Runs on this PC, no key and no internet. Install Ollama and pull a model first.', baseUrl: 'http://localhost:11434', keyUrl: 'https://ollama.com/download', keyUrlLabel: 'Download Ollama' },
  { id: 'openai', name: 'OpenAI', needsKey: true, hint: 'Key from platform.openai.com. Recommended model: gpt-4o-mini or better.', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', keyUrlLabel: 'Get a key (OpenAI)' },
  { id: 'openrouter', name: 'OpenRouter', needsKey: true, hint: 'One key for many models (OpenAI, Anthropic, Meta…). Model ids look like "openai/gpt-4o-mini".', keyUrl: 'https://openrouter.ai/keys', keyUrlLabel: 'Get a key (OpenRouter)' },
  { id: 'claude', name: 'Anthropic Claude', needsKey: true, hint: 'Key from console.anthropic.com.', keyUrl: 'https://console.anthropic.com/settings/keys', keyUrlLabel: 'Open Anthropic console' },
  { id: 'custom', name: 'Custom (OpenAI-compatible)', needsKey: true, hint: 'Any service that speaks the OpenAI chat API: set its address (base URL) and the exact model id below. LM Studio and similar local servers work too — the key may be any value the server accepts.', baseUrl: '' },
];


// Pixabay key for the stock library (Media > Library).
// Key of an online service (stock media), saved encrypted like the AI keys.
function ServiceKey({ saved, onSaved, service, title, icon: Icon, text, url, urlLabel, signupUrl, signupLabel, keyLabel, test }) {
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const hint = saved.serviceKeys?.[service];
  const save = async () => {
    setBusy('save');
    const r = await window.api.settingsSaveServiceKey(service, key);
    setBusy(null);
    if (!r.ok) return setResult({ ok: false, text: r.error });
    setKey('');
    onSaved(r.settings);
    setResult({ ok: true, text: 'Saved.' });
  };
  const runTest = async () => {
    setBusy('test');
    setResult(null);
    setResult(await test(key));
    setBusy(null);
  };
  return (
    <section className="settings-section">
      <div className="settings-title"><Icon size={16} /> {title}</div>
      <p className="muted">{text} Stored encrypted on this PC.</p>
      {signupUrl && (
        <button className="btn btn-ghost btn-sm link-btn" type="button" onClick={() => window.api.openHelp(signupUrl)}>
          <ExternalLink size={13} /> {signupLabel}
        </button>
      )}
      {url && (
        <button className="btn btn-ghost btn-sm link-btn" type="button" onClick={() => window.api.openHelp(url)}>
          <ExternalLink size={13} /> {urlLabel}
        </button>
      )}
      <label className="field">
        <span>{keyLabel} {hint && <b className="key-ok"><ShieldCheck size={13} /> saved {hint}</b>}</span>
        <div className="key-row">
          <input type={show ? 'text' : 'password'} value={key} autoComplete="off" spellCheck={false} aria-label={keyLabel}
            placeholder={hint ? 'Paste a new key to replace the saved one' : 'Paste your key here'} onChange={(e) => setKey(e.target.value)} />
          <button className="icon-btn" type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide key' : 'Show key'}>
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          {hint && (
            <button className="icon-btn" type="button" aria-label={`Delete saved ${keyLabel}`} title="Delete saved key"
              onClick={async () => { onSaved(await window.api.settingsClearServiceKey(service)); setResult(null); }}><Trash2 size={15} /></button>
          )}
        </div>
      </label>
      {result && (
        <div className={`result ${result.ok ? 'ok' : 'bad'}`} role="status">
          {result.ok ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <div className="result-body"><span>{result.text}</span></div>
        </div>
      )}
      <div className="settings-actions">
        <button className="btn" onClick={runTest} disabled={!!busy || (!key.trim() && !hint)}>
          {busy === 'test' ? <Loader2 size={14} className="spin" /> : null} Test key
        </button>
        <button className="btn btn-primary" onClick={save} disabled={!!busy || !key.trim()}>
          {busy === 'save' ? <Loader2 size={14} className="spin" /> : null} Save key
        </button>
      </div>
    </section>
  );
}

function StockSettings(props) {
  return (
    <ServiceKey {...props} service="pixabay" title="Stock videos and photos" icon={Film} keyLabel="Pixabay API key"
      text="Media > Library searches Pixabay. Pixabay keys are free: sign in on pixabay.com and copy the key from the API page."
      url="https://pixabay.com/api/docs/" urlLabel="Get a free Pixabay key" test={(k) => window.api.stockTest(k)} />
  );
}

// Soundza key for the sound-effects section (Audio > Soundza).
function SoundzaSettings(props) {
  return (
    <ServiceKey {...props} service="soundza" title="Sound effects (Soundza)" icon={AudioLines} keyLabel="Soundza API key"
      text="Audio > Soundza searches Soundza's free library of sound effects. Soundza keys are free: create an account, then copy a key from the developer keys page."
      url="https://soundza.com/developers/keys" urlLabel="Get a free Soundza key" test={(k) => window.api.soundzaTest(k)} />
  );
}

// ElevenLabs key: one key powers the ElevenLabs voices (Audio > Text to speech) and the
// ElevenLabs studio in Forge (avatars, Seedance and GPT Image generation). Generation is
// billed by ElevenLabs on the user's own account — photo and video need a Pro plan or
// higher; this key entry is what the studio's "key needed" prompt points at.
function ElevenLabsSettings(props) {
  return (
    <ServiceKey {...props} service="elevenlabs" title="ElevenLabs (voices + generation)" icon={Sparkles} keyLabel="ElevenLabs API key"
      text="Audio > Text to speech can speak with ElevenLabs voices, and Forge > ElevenLabs studio generates avatars, videos and photos with them. Generation runs on your ElevenLabs account and is billed by ElevenLabs; photo and video generation needs a Pro plan or higher."
      url="https://elevenlabs.io/app/settings/api-keys" urlLabel="Get your ElevenLabs key" test={(k) => window.api.ttsTestKey(k)} />
  );
}

// Playback quality: the player can play scaled copies of every video (longest side capped per
// level), so weak PCs edit smoothly. Made once per video, in the background. Export reads originals.
const QUALITY_OPTIONS = [
  ['full', 'Full', 'Original resolution'],
  ['high', 'High', 'Up to 1280 px'],
  ['medium', 'Medium', 'Up to 960 px'],
  ['low', 'Low', 'Up to 640 px'],
];
const PERF_MODE_OPTIONS = [
  ['low-end', 'Low-End (Performance mode)', 'Low playback copies, lighter thumbnails and waveforms, one background job at a time, exports yield CPU to the rest of the PC'],
  ['balanced', 'Balanced', 'Your playback quality, two background jobs at a time'],
  ['high-performance', 'High-Performance', 'Full-quality playback, three background jobs at a time'],
];
function ProxySettings({ onCleared }) {
  const [st, setSt] = useState(null);
  const [mode, setMode] = useState(null);
  useEffect(() => { window.api.proxyStatus().then(setSt).catch(() => {}); }, []);
  useEffect(() => { window.api.perfGetMode?.().then(setMode).catch(() => {}); }, []);
  if (!st) return null;
  const mb = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.max(0, Math.round(b / 1048576))} MB`);
  const clear = async () => {
    const res = await window.api.proxyClear();
    setSt(res);
    onCleared?.(res.deleted || []);
  };
  return (
    <section className="settings-section">
      <div className="settings-title"><Gauge size={16} /> Playback quality (smooth editing on slower PCs)</div>
      <p className="muted">At High, Medium or Low, Cutflow makes a scaled copy of every video and plays that while you edit, so even a
        weak PC stays smooth. Each copy is made once per video, in the background; until it is ready the original plays.
        Export always uses the original files, at full quality.</p>
      <div className="seg-tabs small" role="radiogroup" aria-label="Playback quality">
        {QUALITY_OPTIONS.map(([id, label, hint]) => (
          <button key={id} type="button" role="radio" aria-checked={st.quality === id} className={st.quality === id ? 'on' : ''}
            title={hint} onClick={async () => setSt(await window.api.qualitySet(id))}>{label}</button>
        ))}
      </div>
      <div className="proxy-store">
        <span className="muted">{st.files ? `${st.files} prox${st.files > 1 ? 'ies' : 'y'} · ${mb(st.bytes)} on disk` : 'No proxy on disk.'}</span>
        {st.files > 0 && (
          <button className="btn btn-ghost btn-sm" type="button" onClick={clear} disabled={st.quality !== 'full'}
            title={st.quality !== 'full' ? 'Choose Full quality first' : 'Delete the scaled copies (they are made again if a lower quality is chosen)'}>
            <Trash2 size={13} /> Delete proxies
          </button>
        )}
      </div>
      {st.fxSegments && (
        <>
          <div className="settings-title" style={{ marginTop: 22 }}><Gauge size={16} /> Effect segment cache</div>
          <p className="muted">Rendered effect and transition segments are kept on disk so the next export of the
            same frames is instant. The cache is size-bounded: past the cap, the least recently used segments
            are deleted first (a segment an export is using is never deleted). {st.fxSegments.files
              ? `${st.fxSegments.files} segment${st.fxSegments.files > 1 ? 's' : ''} · ${mb(st.fxSegments.bytes)} on disk.`
              : 'No segments cached yet.'}</p>
          <div className="seg-tabs small" role="radiogroup" aria-label="Effect segment cache size limit">
            {[512, 1024, 2048, 4096, 8192].map((capMB) => (
              <button key={capMB} type="button" role="radio" aria-checked={st.fxSegments.capMB === capMB} className={st.fxSegments.capMB === capMB ? 'on' : ''}
                title="The most disk space the effect segment cache may use"
                onClick={async () => setSt(await window.api.proxySetFxCacheCap(capMB))}>{capMB >= 1024 ? `${capMB / 1024} GB` : `${capMB} MB`}</button>
            ))}
          </div>
        </>
      )}
      <div className="settings-title" style={{ marginTop: 22 }}><Gauge size={16} /> Performance mode</div>
      <p className="muted">Modes trade background work against responsiveness: how many thumbnails, waveforms and copies
        Cutflow builds at once, which playback quality it defaults to, and whether an export yields the PC's
        processor to everything else. A mode never changes export quality — exports always render from the
        original files at your chosen quality settings.</p>
      <div className="seg-tabs small" role="radiogroup" aria-label="Performance mode">
        {PERF_MODE_OPTIONS.map(([id, label, hint]) => (
          <button key={id} type="button" role="radio" aria-checked={mode === id} className={mode === id ? 'on' : ''}
            title={hint} onClick={async () => { const r = await window.api.perfSetMode(id); setMode(r.mode); setSt(r); }}>{label}</button>
        ))}
      </div>
    </section>
  );
}

// Agent draft bridge: a local door for external agent tools (a script, another
// app, an AI agent) to read the open project and propose edits. It listens on
// this PC only (127.0.0.1), only while switched on here, and every proposal
// arrives as a draft the user reviews in the editor — nothing an agent sends
// is ever applied without the user's Accept. The token is minted fresh each
// time the bridge starts and never leaves this PC.
function BridgeSettings() {
  const [st, setSt] = useState(null);
  const [copied, setCopied] = useState('');
  useEffect(() => { window.api.bridgeGetState?.().then(setSt).catch(() => {}); }, []);
  if (!st) return null;
  const toggle = async (on) => { try { setSt(await window.api.bridgeSetEnabled(on)); } catch { /* state stays as shown */ } };
  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1600); } catch { /* clipboard unavailable */ }
  };
  return (
    <section className="settings-section">
      <div className="settings-title"><Cable size={16} /> Agent bridge (local agent access)</div>
      <p className="muted">Lets a tool running on this PC — an automation script, another editor helper, an AI agent —
        read the project you have open and propose edits to it. Proposals never touch your project directly:
        they arrive as drafts under <b>Agent drafts</b> in the top bar, and only the ones you accept are applied.
        The bridge listens on this PC only (127.0.0.1), and while it is off, nothing listens at all.</p>
      <div className="seg-tabs small" role="radiogroup" aria-label="Agent bridge">
        <button type="button" role="radio" aria-checked={!st.enabled} className={!st.enabled ? 'on' : ''}
          onClick={() => toggle(false)}>Off</button>
        <button type="button" role="radio" aria-checked={st.enabled} className={st.enabled ? 'on' : ''}
          onClick={() => toggle(true)}>On</button>
      </div>
      {st.enabled && st.listening && (
        <>
          <label className="field">
            <span>Address (this PC only)</span>
            <div className="key-row">
              <input type="text" readOnly value={`http://127.0.0.1:${st.port}`} aria-label="Bridge address" spellCheck={false} />
              <button className="icon-btn" type="button" aria-label="Copy bridge address" title="Copy address"
                onClick={() => copy(`http://127.0.0.1:${st.port}`, 'address')}>{copied === 'address' ? <CircleCheck size={15} /> : <Copy size={15} />}</button>
            </div>
          </label>
          <label className="field">
            <span>Access token {copied === 'token' && <b className="key-ok">copied</b>}</span>
            <div className="key-row">
              <input type="text" readOnly value={st.token || ''} aria-label="Bridge access token" spellCheck={false} />
              <button className="icon-btn" type="button" aria-label="Copy bridge token" title="Copy token"
                onClick={() => copy(st.token || '', 'token')}>{copied === 'token' ? <CircleCheck size={15} /> : <Copy size={15} />}</button>
            </div>
          </label>
          <p className="muted">Give the address and token to your tool. It opens a session (POST /v1/sessions), reads the
            project (GET /v1/project, /v1/project/document, /v1/project/transcript) and edits a shadow draft
            (POST /v1/shadows, then /v1/shadows/:id/ops). The token is new every time the bridge starts;
            turning the bridge off closes the door and discards any drafts still waiting.</p>
          <p className="muted">{st.live
            ? <>Open project: <b>{st.live.name}</b> · revision {st.live.revision} · {st.pending} draft{st.pending === 1 ? '' : 's'} waiting for review.</>
            : 'No project is open in the editor right now.'}</p>
        </>
      )}
      {st.enabled && !st.listening && (
        <p className="muted">The bridge is switched on but could not start listening. Turning it off and on again usually fixes this.</p>
      )}
    </section>
  );
}

// Keyboard shortcuts + on-screen keystroke display (Sprint 11). The
// catalogue, defaults and chord rules live in src/keymap.js; this section
// is only the rebind surface. Every change persists immediately (only the
// diff from the defaults is stored, settings.cjs) and applies at once —
// the resolved map is pushed into the renderer's shared keymap, so the
// handler, menus and hint labels all move together.
function ShortcutsSettings({ saved, onSaved }) {
  const [bindings, setBindings] = useState(() => resolveKeymap(saved.keymap).bindings);
  const [capturing, setCapturing] = useState(null); // { actionId, slot } — slot == list length means "add"
  const [conflict, setConflict] = useState(null); // { actionId, slot, chord, otherId }

  useEffect(() => { setBindings(resolveKeymap(saved.keymap).bindings); }, [saved.keymap]);

  const persist = async (next) => {
    setBindings(next);
    const overrides = diffOverrides(next);
    const st = await window.api.settingsSetKeymap(overrides);
    applyKeymapOverrides(overrides);
    if (st) onSaved(st);
  };

  // While capturing, the next keydown IS the new binding: capture phase +
  // stopPropagation, and the shared capture flag stands the editor's own
  // handler down, so the key being bound cannot also fire its old action.
  useEffect(() => {
    if (!capturing) return undefined;
    setKeyCaptureActive(true);
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const chord = chordFromEvent(e);
      if (!chord) return; // a modifier on its own, or a dead key: keep waiting
      const { actionId, slot } = capturing;
      const other = KEY_ACTIONS.find((a) => a.id !== actionId && (bindings[a.id] || []).includes(chord));
      if (other) { setConflict({ actionId, slot, chord, otherId: other.id }); return; }
      setConflict(null);
      const cur = bindings[actionId] || [];
      const next = { ...bindings, [actionId]: slot < cur.length ? cur.map((c, i) => (i === slot ? chord : c)) : [...cur, chord] };
      setCapturing(null);
      persist(next);
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); setKeyCaptureActive(false); };
  }, [capturing, bindings]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyConflict = () => {
    const { actionId, slot, chord, otherId } = conflict;
    const next = { ...bindings, [otherId]: (bindings[otherId] || []).filter((c) => c !== chord) };
    const cur = next[actionId] || [];
    next[actionId] = slot < cur.length ? cur.map((c, i) => (i === slot ? chord : c)) : [...cur, chord];
    setConflict(null);
    setCapturing(null);
    persist(next);
  };
  const removeBinding = (actionId, idx) => persist({ ...bindings, [actionId]: (bindings[actionId] || []).filter((_, i) => i !== idx) });
  const resetAction = (id) => persist({ ...bindings, [id]: [...KEY_ACTIONS.find((a) => a.id === id).defaults] });
  const resetAll = () => persist(Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, [...a.defaults]])));
  const setKeystrokes = async (on) => {
    const st = await window.api.settingsSetKeystrokes(on);
    if (st) onSaved(st);
  };

  return (
    <section className="settings-section">
      <div className="settings-title"><Keyboard size={16} /> Keyboard shortcuts</div>
      <p className="muted">Click a key to change it, or + to give an action another key. Changes save immediately and are stored only on this PC. Taking a key that another action uses asks first.</p>
      <div className="scuts">
        {KEY_ACTIONS.map((a) => {
          const list = bindings[a.id] || [];
          const isDefault = list.length === a.defaults.length && list.every((c, i) => c === a.defaults[i]);
          const isCapturing = !!capturing && capturing.actionId === a.id;
          return (
            <div key={a.id} className="scut-row">
              <span className="scut-label">{a.label}</span>
              <span className="scut-keys">
                {list.map((chord, i) => (
                  <span key={`${chord}-${i}`} className="scut-bind">
                    <button type="button" className={`scut-key${isCapturing && capturing.slot === i ? ' capturing' : ''}`}
                      onClick={() => { setConflict(null); setCapturing({ actionId: a.id, slot: i }); }}
                      title="Click, then press the new key">
                      {isCapturing && capturing.slot === i ? 'Press a key…' : formatChord(chord)}
                    </button>
                    <button type="button" className="scut-x" aria-label={`Remove ${formatChord(chord)} from ${a.label}`}
                      onClick={() => removeBinding(a.id, i)}><X size={11} /></button>
                  </span>
                ))}
                {!list.length && <span className="muted">Not bound</span>}
                {list.length < 3 && (
                  <button type="button" className="scut-key add" aria-label={`Add a key for ${a.label}`}
                    onClick={() => { setConflict(null); setCapturing({ actionId: a.id, slot: list.length }); }}
                    title={`Add another key for ${a.label}`}>
                    {isCapturing && capturing.slot === list.length ? 'Press a key…' : '+'}
                  </button>
                )}
                {!isDefault && (
                  <button type="button" className="icon-btn" aria-label={`Reset ${a.label} to the default key`} title="Reset to default"
                    onClick={() => resetAction(a.id)}><RotateCcw size={13} /></button>
                )}
              </span>
              {isCapturing && !conflict && (
                <span className="scut-note">Press the new key…
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCapturing(null)}>Cancel</button>
                </span>
              )}
              {conflict && conflict.actionId === a.id && (
                <span className="scut-note conflict" role="alert">
                  {formatChord(conflict.chord)} is already used by “{actionLabel(conflict.otherId)}”.
                  <button type="button" className="btn btn-sm" onClick={applyConflict}>Use it here instead</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setConflict(null); setCapturing(null); }}>Cancel</button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="settings-actions">
        <button className="btn" onClick={resetAll}>Reset all to defaults</button>
      </div>
      <label className="field row">
        <span>Show keystrokes on screen</span>
        <Toggle checked={!!saved.keystrokes} onChange={(e) => setKeystrokes(e.target.checked)} />
      </label>
      <p className="muted">For tutorials and recordings: shortcut keys appear at the bottom of the window as you press them, so a screen recording shows them too. Only key combinations and shortcut keys are ever shown — never what you type into text fields, and nothing at all in password fields.</p>
    </section>
  );
}

// Settings sections for the left rail (redesign: rail + pane, all controls unchanged inside).
const SECTIONS = [
  { id: 'ai', label: 'AI assistant', icon: Sparkles },
  { id: 'mcp', label: 'MCP servers', icon: Server },
  { id: 'bridge', label: 'Agent bridge', icon: Cable },
  { id: 'quality', label: 'Playback quality', icon: Gauge },
  { id: 'keys', label: 'Keyboard', icon: Keyboard },
  { id: 'stock', label: 'Stock media', icon: Film },
];

export default function SettingsDialog({ onClose, onProxiesCleared }) {
  const [section, setSection] = useState('ai');
  const [saved, setSaved] = useState(null); // public settings from the main process
  const [provider, setProvider] = useState('gemini');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(null); // 'save' | 'test' | 'models'
  const [models, setModels] = useState([]); // model ids offered by the provider
  const [result, setResult] = useState(null); // { ok, text }

  const load = (s, p = s.provider) => {
    setSaved(s);
    setProvider(p);
    setModel(s.models[p] || s.defaultModels[p]);
    setBaseUrl(s.baseUrls[p] || '');
    setApiKey('');
    setResult(null);
    setModels([]);
  };
  useEffect(() => {
    window.api.settingsGet().then((s) => load(s));
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!saved) return null;
  const info = PROVIDERS.find((p) => p.id === provider);
  const hint = saved.keys[provider];
  const draft = { provider, model, baseUrl, apiKey };

  const switchProvider = (p) => {
    setProvider(p);
    setModel(saved.models[p] || saved.defaultModels[p]);
    setBaseUrl(saved.baseUrls[p] || '');
    setApiKey('');
    setResult(null);
    setModels([]);
  };

  const save = async () => {
    setBusy('save');
    const res = await window.api.settingsSave(draft);
    setBusy(null);
    if (!res.ok) return setResult({ ok: false, text: res.error });
    load(res.settings, provider);
    setResult({ ok: true, text: 'Saved.' });
  };

  const test = async () => {
    setBusy('test');
    setResult(null);
    const r = await window.api.aiTest(draft);
    setBusy(null);
    setResult(r.ok ? { ok: true, text: `Connected in ${(r.ms / 1000).toFixed(1)}s. The model replied: "${r.reply}"` } : { ok: false, text: r.error, link: r.link, linkLabel: r.linkLabel, suggestModel: r.suggestModel });
  };

  const loadModels = async () => {
    setBusy('models');
    setResult(null);
    const r = await window.api.aiModels(draft);
    setBusy(null);
    if (!r.ok) return setResult({ ok: false, text: r.error, link: r.link, linkLabel: r.linkLabel });
    setModels(r.models);
    setResult({ ok: true, text: `${r.models.length} models available. Pick one from the Model list.` });
  };

  const removeKey = async () => {
    load(await window.api.settingsClearKey(provider), provider);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings settings2">
        <div className="settings-head">
          <h3 id="settings-title">Settings</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close settings"><X size={16} /></button>
        </div>
        <div className="set2-body">
          <nav className="set2-rail" aria-label="Settings sections">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <button key={s.id} type="button" className={section === s.id ? 'on' : ''} aria-current={section === s.id || undefined}
                  onClick={() => setSection(s.id)}>
                  <Icon size={15} /> <span>{s.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="set2-pane">
        {section === 'ai' && (
        <section className="settings-section">
          <div className="settings-title"><Sparkles size={16} /> AI assistant</div>
          <p className="muted">The assistant (FlowAI) uses this service to understand your requests. Your key is stored encrypted on this PC and is never shown again.</p>

          <label className="field">
            <span>Provider</span>
            <select value={provider} onChange={(e) => switchProvider(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}{saved.keys[p.id] ? '  ✓' : ''}</option>)}
            </select>
          </label>
          <p className="muted">{info.hint}</p>
          {info.keyUrl && (
            <button className="btn btn-ghost btn-sm link-btn" type="button" onClick={() => window.api.openHelp(info.keyUrl)}>
              <ExternalLink size={13} /> {info.keyUrlLabel}
            </button>
          )}

          {info.needsKey && (
            <label className="field">
              <span>
                API key
                {hint && <b className="key-ok"><ShieldCheck size={13} /> saved {hint}</b>}
              </span>
              <div className="key-row">
                <input type={showKey ? 'text' : 'password'} value={apiKey} autoComplete="off" spellCheck={false}
                  placeholder={hint ? 'Paste a new key to replace the saved one' : 'Paste your key here'}
                  onChange={(e) => setApiKey(e.target.value)} />
                <button className="icon-btn" type="button" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? 'Hide key' : 'Show key'}>
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                {hint && <button className="icon-btn" type="button" onClick={removeKey} aria-label="Delete saved key" title="Delete saved key"><Trash2 size={15} /></button>}
              </div>
            </label>
          )}

          <label className="field">
            <span>
              Model
              <button className="btn btn-ghost btn-sm" type="button" onClick={loadModels}
                disabled={!!busy || (info.needsKey && !apiKey.trim() && !hint)}>
                {busy === 'models' ? <Loader2 size={13} className="spin" /> : null} Load models
              </button>
            </span>
            <input type="text" list="model-ids" value={model} spellCheck={false} onChange={(e) => setModel(e.target.value)} />
            <datalist id="model-ids">{models.map((m) => <option key={m} value={m} />)}</datalist>
            <small className="muted">Use the model id (for example gemini-3.8-flash), not the display name. “Load models” lists the real ones.</small>
          </label>

          {(provider === 'ollama' || provider === 'openai' || provider === 'custom' || baseUrl) && (
            <label className="field">
              <span>{provider === 'custom' ? 'Address (required for Custom)' : 'Address (optional for hosted services)'}</span>
              <input type="text" value={baseUrl} spellCheck={false} placeholder={info.baseUrl || 'Default'} onChange={(e) => setBaseUrl(e.target.value)} />
            </label>
          )}

          {!saved.encryption && info.needsKey && (
            <p className="error-text">Secure storage is not available on this PC, so keys cannot be saved.</p>
          )}

          {result && (
            <div className={`result ${result.ok ? 'ok' : 'bad'}`} role="status">
              {result.ok ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
              <div className="result-body">
                <span>{result.text}</span>
                {result.suggestModel && (
                  <button className="btn btn-sm btn-primary" type="button"
                    onClick={() => { setModel(result.suggestModel); setResult(null); }}>
                    Use {result.suggestModel}
                  </button>
                )}
                {result.link && (
                  <button className="btn btn-sm" type="button" onClick={() => window.api.openHelp(result.link)}>
                    <ExternalLink size={13} /> {result.linkLabel || 'Open the Google page'}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="settings-actions">
            <button className="btn" onClick={test} disabled={!!busy || (info.needsKey && !apiKey.trim() && !hint)}>
              {busy === 'test' ? <Loader2 size={14} className="spin" /> : null} Test connection
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!!busy}>
              {busy === 'save' ? <Loader2 size={14} className="spin" /> : null} Save
            </button>
          </div>
        </section>
        )}
        {section === 'mcp' && <McpSettings saved={saved} onSaved={(st) => setSaved(st)} />}
        {section === 'bridge' && <BridgeSettings />}
        {section === 'quality' && <ProxySettings onCleared={onProxiesCleared} />}
        {section === 'keys' && <ShortcutsSettings saved={saved} onSaved={(st) => setSaved(st)} />}
        {section === 'stock' && (
          <>
            <StockSettings saved={saved} onSaved={(st) => setSaved(st)} />
            <SoundzaSettings saved={saved} onSaved={(st) => setSaved(st)} />
            <ElevenLabsSettings saved={saved} onSaved={(st) => setSaved(st)} />
          </>
        )}
          </div>
        </div>
      </div>
    </div>
  );
}

// MCP servers: external tool servers (stdio) whose tools FlowAI can call during an edit.
// Config is name + command + arguments; "Test" starts the server and lists its real tools.
function McpSettings({ saved, onSaved }) {
  const servers = saved.mcpServers || [];
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [envText, setEnvText] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const splitArgs = (s) => s.split(/\s+/).map((x) => x.trim()).filter(Boolean);
  // KEY=VALUE lines (env vars, headers). A value may reference the app's own
  // environment as ${VAR} — expanded when the client connects, so a token
  // can stay in the environment instead of being stored here.
  const parseKv = (text) => {
    const out = {};
    for (const line of String(text || '').split('\n')) {
      const at = line.indexOf('=');
      if (at <= 0) continue;
      const k = line.slice(0, at).trim();
      if (k) out[k] = line.slice(at + 1).trim();
    }
    return out;
  };
  const draft = () => {
    const env = parseKv(envText);
    const headers = parseKv(headersText);
    return {
      name: name.trim(),
      ...(url.trim()
        ? { url: url.trim(), command: '', args: [] }
        : { command: command.trim(), args: splitArgs(args) }),
      ...(Object.keys(env).length ? { env } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
    };
  };
  const canSave = !!name.trim() && (!!command.trim() || !!url.trim());
  const persist = async (list) => {
    const r = await window.api.settingsSetMcpServers(list);
    const st = r?.settings || r;
    if (st && Array.isArray(st.mcpServers)) onSaved(st);
  };
  const add = async () => {
    if (!canSave) return;
    await persist([...servers, draft()]);
    setName(''); setCommand(''); setArgs(''); setUrl(''); setEnvText(''); setHeadersText('');
    setResult({ ok: true, text: 'Server saved. FlowAI will offer its tools on the next request.' });
  };
  const remove = async (i) => { await persist(servers.filter((_, k) => k !== i)); setResult(null); };
  const test = async (server) => {
    setBusy(server.name); setResult(null);
    const r = await window.api.mcpTest(server);
    setBusy('');
    setResult(r.ok
      ? { ok: true, text: `"${server.name}" answered. Tools: ${r.tools.join(', ') || '(none)'}` }
      : { ok: false, text: `"${server.name}" failed: ${r.error}` });
  };
  return (
    <section className="settings-section">
      <div className="settings-title"><Sparkles size={16} /> MCP tool servers</div>
      <p className="muted">Connect Model Context Protocol servers: a local process (command), or a remote one (URL, streamable HTTP). Their tools are given to FlowAI as <i>mcp_&lt;server&gt;_&lt;tool&gt;</i> alongside the editing tools.</p>
      {servers.map((s, i) => (
        <div key={`${s.name}-${i}`} className="key-row" style={{ marginBottom: 6 }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <b>{s.name}</b> <span className="muted">{s.url ? s.url : `${s.command} ${(s.args || []).join(' ')}`}{s.env ? ` · env: ${Object.keys(s.env).join(', ')}` : ''}</span>
          </span>
          <button className="btn btn-sm" type="button" disabled={busy === s.name} onClick={() => test(s)}>{busy === s.name ? 'Testing…' : 'Test'}</button>
          <button className="icon-btn" type="button" aria-label={`Remove ${s.name}`} title="Remove server" onClick={() => remove(i)}><Trash2 size={15} /></button>
        </div>
      ))}
      <label className="field"><span>Name</span>
        <input type="text" value={name} placeholder="e.g. filesystem" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field"><span>Command (local server)</span>
        <input type="text" value={command} spellCheck={false} placeholder="e.g. npx" onChange={(e) => setCommand(e.target.value)} />
      </label>
      <label className="field"><span>Arguments (space-separated)</span>
        <input type="text" value={args} spellCheck={false} placeholder="e.g. -y @modelcontextprotocol/server-filesystem /home/me/files" onChange={(e) => setArgs(e.target.value)} />
      </label>
      <label className="field"><span>URL (remote server — fill this instead of a command)</span>
        <input type="text" value={url} spellCheck={false} placeholder="e.g. https://example.com/mcp" onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label className="field"><span>Environment variables (one KEY=VALUE per line)</span>
        <textarea value={envText} spellCheck={false} rows={2} placeholder={'e.g.\nAPI_KEY=${MY_API_KEY}'} onChange={(e) => setEnvText(e.target.value)} />
      </label>
      <label className="field"><span>HTTP headers (one KEY=VALUE per line, remote servers)</span>
        <textarea value={headersText} spellCheck={false} rows={2} placeholder={'e.g.\nAuthorization=Bearer ${MY_TOKEN}'} onChange={(e) => setHeadersText(e.target.value)} />
      </label>
      <div className="settings-actions">
        <button className="btn" type="button" disabled={!canSave} onClick={add}>Add server</button>
        <button className="btn" type="button" disabled={!canSave || busy === name}
          onClick={() => test(draft())}>{busy === name ? 'Testing…' : 'Test draft'}</button>
      </div>
      {result && (
        <div className={`result ${result.ok ? 'ok' : 'bad'}`} role="status">
          {result.ok ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <div className="result-body"><span>{result.text}</span></div>
        </div>
      )}
    </section>
  );
}
