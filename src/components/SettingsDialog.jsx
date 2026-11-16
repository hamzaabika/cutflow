import React, { useEffect, useState } from 'react';
import { AudioLines, Cable, CircleAlert, CircleCheck, Copy, ExternalLink, Eye, EyeOff, Film, Gauge, Keyboard, Languages, Loader2, RotateCcw, Server, ShieldCheck, Sparkles, Trash2, X } from '../icons.jsx';
import Toggle from '../ui/Toggle.jsx';
import { KEY_ACTIONS, actionLabel, applyKeymapOverrides, chordFromEvent, diffOverrides, formatChord, resolveKeymap, setKeyCaptureActive } from '../keymap.js';
import { useLang, useT } from '../i18n/index.jsx';

const PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini', needsKey: true, hint: 'set.prov.gemini.hint', keyUrl: 'https://aistudio.google.com/app/apikey', keyUrlLabel: 'set.prov.gemini.keyLabel' },
  { id: 'groq', name: 'Groq (fast, free tier)', needsKey: true, hint: 'set.prov.groq.hint', keyUrl: 'https://console.groq.com/keys', keyUrlLabel: 'set.prov.groq.keyLabel' },
  { id: 'ollama', name: 'Ollama (local, free)', needsKey: false, hint: 'set.prov.ollama.hint', baseUrl: 'http://localhost:11434', keyUrl: 'https://ollama.com/download', keyUrlLabel: 'set.prov.ollama.keyLabel' },
  { id: 'openai', name: 'OpenAI', needsKey: true, hint: 'set.prov.openai.hint', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', keyUrlLabel: 'set.prov.openai.keyLabel' },
  { id: 'openrouter', name: 'OpenRouter', needsKey: true, hint: 'set.prov.openrouter.hint', keyUrl: 'https://openrouter.ai/keys', keyUrlLabel: 'set.prov.openrouter.keyLabel' },
  { id: 'claude', name: 'Anthropic Claude', needsKey: true, hint: 'set.prov.claude.hint', keyUrl: 'https://console.anthropic.com/settings/keys', keyUrlLabel: 'set.prov.claude.keyLabel' },
  { id: 'custom', name: 'Custom (OpenAI-compatible)', needsKey: true, hint: 'set.prov.custom.hint', baseUrl: '' },
];


// Pixabay key for the stock library (Media > Library).
// Key of an online service (stock media), saved encrypted like the AI keys.
function ServiceKey({ saved, onSaved, service, title, icon: Icon, text, url, urlLabel, signupUrl, signupLabel, keyLabel, test }) {
  const t = useT();
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
    setResult({ ok: true, text: t('set.saved') });
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
      <p className="muted">{text} {t('set.storedEncrypted')}</p>
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
        <span>{keyLabel} {hint && <b className="key-ok"><ShieldCheck size={13} /> {t('set.savedTag', { hint })}</b>}</span>
        <div className="key-row">
          <input type={show ? 'text' : 'password'} value={key} autoComplete="off" spellCheck={false} aria-label={keyLabel}
            placeholder={hint ? t('set.replaceKey') : t('set.pasteKey')} onChange={(e) => setKey(e.target.value)} />
          <button className="icon-btn" type="button" onClick={() => setShow((v) => !v)} aria-label={show ? t('set.hideKey') : t('set.showKey')}>
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          {hint && (
            <button className="icon-btn" type="button" aria-label={t('set.deleteKeyAria', { label: keyLabel })} title={t('set.deleteKeyTitle')}
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
          {busy === 'test' ? <Loader2 size={14} className="spin" /> : null} {t('set.testKey')}
        </button>
        <button className="btn btn-primary" onClick={save} disabled={!!busy || !key.trim()}>
          {busy === 'save' ? <Loader2 size={14} className="spin" /> : null} {t('set.saveKey')}
        </button>
      </div>
    </section>
  );
}

function StockSettings(props) {
  const t = useT();
  return (
    <ServiceKey {...props} service="pixabay" title={t('set.stockTitle')} icon={Film} keyLabel={t('set.pixabayKey')}
      text={t('set.stockText')}
      url="https://pixabay.com/api/docs/" urlLabel={t('set.pixabayKeyFree')} test={(k) => window.api.stockTest(k)} />
  );
}

// Soundza key for the sound-effects section (Audio > Soundza).
function SoundzaSettings(props) {
  const t = useT();
  return (
    <ServiceKey {...props} service="soundza" title={t('set.soundzaTitle')} icon={AudioLines} keyLabel={t('set.soundzaKey')}
      text={t('set.soundzaText')}
      url="https://soundza.com/developers/keys" urlLabel={t('set.soundzaKeyFree')} test={(k) => window.api.soundzaTest(k)} />
  );
}

// ElevenLabs key: one key powers the ElevenLabs voices (Audio > Text to speech) and the
// ElevenLabs studio in Forge (avatars, Seedance and GPT Image generation). Generation is
// billed by ElevenLabs on the user's own account — photo and video need a Pro plan or
// higher; this key entry is what the studio's "key needed" prompt points at.
function ElevenLabsSettings(props) {
  const t = useT();
  return (
    <ServiceKey {...props} service="elevenlabs" title={t('set.elTitle')} icon={Sparkles} keyLabel={t('set.elKey')}
      text={t('set.elText')}
      url="https://elevenlabs.io/app/settings/api-keys" urlLabel={t('set.elKeyFree')} test={(k) => window.api.ttsTestKey(k)} />
  );
}

// Playback quality: the player can play scaled copies of every video (longest side capped per
// level), so weak PCs edit smoothly. Made once per video, in the background. Export reads originals.
const QUALITY_OPTIONS = [
  ['full', 'player.qualityShort.full', 'player.qFullDesc'],
  ['high', 'player.qualityShort.high', 'set.qHint.high'],
  ['medium', 'player.qualityShort.medium', 'set.qHint.medium'],
  ['low', 'player.qualityShort.low', 'set.qHint.low'],
];
const PERF_MODE_OPTIONS = [
  ['low-end', 'set.perf.lowEnd', 'set.perfHint.lowEnd'],
  ['balanced', 'set.perf.balanced', 'set.perfHint.balanced'],
  ['high-performance', 'set.perf.high', 'set.perfHint.high'],
];
function ProxySettings({ onCleared }) {
  const t = useT();
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
      <div className="settings-title"><Gauge size={16} /> {t('set.playbackQualityTitle')}</div>
      <p className="muted">{t('set.playbackNote')}</p>
      <div className="seg-tabs small" role="radiogroup" aria-label={t('set.playbackQualityAria')}>
        {QUALITY_OPTIONS.map(([id, label, hint]) => (
          <button key={id} type="button" role="radio" aria-checked={st.quality === id} className={st.quality === id ? 'on' : ''}
            title={t(hint)} onClick={async () => setSt(await window.api.qualitySet(id))}>{t(label)}</button>
        ))}
      </div>
      <div className="proxy-store">
        <span className="muted">{st.files ? t(st.files > 1 ? 'set.proxiesCount' : 'set.proxiesCountOne', { count: st.files, size: mb(st.bytes) }) : t('set.noProxy')}</span>
        {st.files > 0 && (
          <button className="btn btn-ghost btn-sm" type="button" onClick={clear} disabled={st.quality !== 'full'}
            title={st.quality !== 'full' ? t('set.chooseFullFirst') : t('set.deleteProxiesTitle')}>
            <Trash2 size={13} /> {t('set.deleteProxies')}
          </button>
        )}
      </div>
      {st.fxSegments && (
        <>
          <div className="settings-title" style={{ marginTop: 22 }}><Gauge size={16} /> {t('set.fxCacheTitle')}</div>
          <p className="muted">{t('set.fxCacheNote')} {st.fxSegments.files
              ? t(st.fxSegments.files > 1 ? 'set.segmentsCount' : 'set.segmentsCountOne', { count: st.fxSegments.files, size: mb(st.fxSegments.bytes) })
              : t('set.noSegments')}</p>
          <div className="seg-tabs small" role="radiogroup" aria-label={t('set.fxCacheLimitAria')}>
            {[512, 1024, 2048, 4096, 8192].map((capMB) => (
              <button key={capMB} type="button" role="radio" aria-checked={st.fxSegments.capMB === capMB} className={st.fxSegments.capMB === capMB ? 'on' : ''}
                title={t('set.fxCacheCapTitle')}
                onClick={async () => setSt(await window.api.proxySetFxCacheCap(capMB))}>{capMB >= 1024 ? `${capMB / 1024} GB` : `${capMB} MB`}</button>
            ))}
          </div>
        </>
      )}
      <div className="settings-title" style={{ marginTop: 22 }}><Gauge size={16} /> {t('set.perfModeTitle')}</div>
      <p className="muted">{t('set.perfNote')}</p>
      <div className="seg-tabs small" role="radiogroup" aria-label={t('set.perfModeAria')}>
        {PERF_MODE_OPTIONS.map(([id, label, hint]) => (
          <button key={id} type="button" role="radio" aria-checked={mode === id} className={mode === id ? 'on' : ''}
            title={t(hint)} onClick={async () => { const r = await window.api.perfSetMode(id); setMode(r.mode); setSt(r); }}>{t(label)}</button>
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
  const t = useT();
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
      <div className="settings-title"><Cable size={16} /> {t('set.bridgeTitle')}</div>
      <p className="muted">{t('set.bridgeNote1')} <b>{t('topbar.agentDrafts')}</b> {t('set.bridgeNote2')}</p>
      <div className="seg-tabs small" role="radiogroup" aria-label={t('set.bridgeAria')}>
        <button type="button" role="radio" aria-checked={!st.enabled} className={!st.enabled ? 'on' : ''}
          onClick={() => toggle(false)}>{t('ci.off')}</button>
        <button type="button" role="radio" aria-checked={st.enabled} className={st.enabled ? 'on' : ''}
          onClick={() => toggle(true)}>{t('set.on')}</button>
      </div>
      {st.enabled && st.listening && (
        <>
          <label className="field">
            <span>{t('set.address')}</span>
            <div className="key-row">
              <input type="text" readOnly value={`http://127.0.0.1:${st.port}`} aria-label={t('set.bridgeAddress')} spellCheck={false} />
              <button className="icon-btn" type="button" aria-label={t('set.copyAddress')} title={t('set.copyAddressTitle')}
                onClick={() => copy(`http://127.0.0.1:${st.port}`, 'address')}>{copied === 'address' ? <CircleCheck size={15} /> : <Copy size={15} />}</button>
            </div>
          </label>
          <label className="field">
            <span>{t('set.accessToken')} {copied === 'token' && <b className="key-ok">{t('set.copied')}</b>}</span>
            <div className="key-row">
              <input type="text" readOnly value={st.token || ''} aria-label={t('set.bridgeToken')} spellCheck={false} />
              <button className="icon-btn" type="button" aria-label={t('set.copyToken')} title={t('set.copyTokenTitle')}
                onClick={() => copy(st.token || '', 'token')}>{copied === 'token' ? <CircleCheck size={15} /> : <Copy size={15} />}</button>
            </div>
          </label>
          <p className="muted">{t('set.bridgeHowto')}</p>
          <p className="muted">{st.live
            ? <>{t(st.pending === 1 ? 'set.bridgeLiveOne' : 'set.bridgeLive', { name: st.live.name, rev: st.live.revision, count: st.pending })}</>
            : t('set.bridgeNoProject')}</p>
        </>
      )}
      {st.enabled && !st.listening && (
        <p className="muted">{t('set.bridgeFailed')}</p>
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
  const t = useT();
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
      <div className="settings-title"><Keyboard size={16} /> {t('set.shortcutsTitle')}</div>
      <p className="muted">{t('set.shortcutsNote')}</p>
      <div className="scuts">
        {KEY_ACTIONS.map((a) => {
          const list = bindings[a.id] || [];
          const isDefault = list.length === a.defaults.length && list.every((c, i) => c === a.defaults[i]);
          const isCapturing = !!capturing && capturing.actionId === a.id;
          return (
            <div key={a.id} className="scut-row">
              <span className="scut-label">{t('keymap.' + a.id)}</span>
              <span className="scut-keys">
                {list.map((chord, i) => (
                  <span key={`${chord}-${i}`} className="scut-bind">
                    <button type="button" className={`scut-key${isCapturing && capturing.slot === i ? ' capturing' : ''}`}
                      onClick={() => { setConflict(null); setCapturing({ actionId: a.id, slot: i }); }}
                      title={t('set.clickThenPress')}>
                      {isCapturing && capturing.slot === i ? t('set.pressKey') : formatChord(chord)}
                    </button>
                    <button type="button" className="scut-x" aria-label={t('set.removeBindingAria', { chord: formatChord(chord), label: t('keymap.' + a.id) })}
                      onClick={() => removeBinding(a.id, i)}><X size={11} /></button>
                  </span>
                ))}
                {!list.length && <span className="muted">{t('set.notBound')}</span>}
                {list.length < 3 && (
                  <button type="button" className="scut-key add" aria-label={t('set.addKeyAria', { label: t('keymap.' + a.id) })}
                    onClick={() => { setConflict(null); setCapturing({ actionId: a.id, slot: list.length }); }}
                    title={t('set.addKeyTitle', { label: t('keymap.' + a.id) })}>
                    {isCapturing && capturing.slot === list.length ? t('set.pressKey') : '+'}
                  </button>
                )}
                {!isDefault && (
                  <button type="button" className="icon-btn" aria-label={t('set.resetDefaultAria', { label: t('keymap.' + a.id) })} title={t('set.resetDefaultTitle')}
                    onClick={() => resetAction(a.id)}><RotateCcw size={13} /></button>
                )}
              </span>
              {isCapturing && !conflict && (
                <span className="scut-note">{t('set.pressNewKey')}
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCapturing(null)}>{t('common.cancel')}</button>
                </span>
              )}
              {conflict && conflict.actionId === a.id && (
                <span className="scut-note conflict" role="alert">
                  {t('set.conflict', { chord: formatChord(conflict.chord), label: t('keymap.' + conflict.otherId) })}
                  <button type="button" className="btn btn-sm" onClick={applyConflict}>{t('set.useHere')}</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setConflict(null); setCapturing(null); }}>{t('common.cancel')}</button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="settings-actions">
        <button className="btn" onClick={resetAll}>{t('set.resetAll')}</button>
      </div>
      <label className="field row">
        <span>{t('set.showKeystrokes')}</span>
        <Toggle checked={!!saved.keystrokes} onChange={(e) => setKeystrokes(e.target.checked)} />
      </label>
      <p className="muted">{t('set.keystrokesNote')}</p>
    </section>
  );
}

// Settings sections for the left rail (redesign: rail + pane, all controls unchanged inside).
const SECTIONS = [
  { id: 'ai', label: 'set.sec.ai', icon: Sparkles },
  { id: 'language', label: 'set.sec.language', icon: Languages },
  { id: 'mcp', label: 'set.sec.mcp', icon: Server },
  { id: 'bridge', label: 'set.sec.bridge', icon: Cable },
  { id: 'quality', label: 'set.sec.quality', icon: Gauge },
  { id: 'keys', label: 'set.sec.keys', icon: Keyboard },
  { id: 'stock', label: 'set.sec.stock', icon: Film },
];

export default function SettingsDialog({ onClose, onProxiesCleared }) {
  const t = useT();
  const { lang, setLang } = useLang();
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
    setResult({ ok: true, text: t('set.saved') });
  };

  const test = async () => {
    setBusy('test');
    setResult(null);
    const r = await window.api.aiTest(draft);
    setBusy(null);
    setResult(r.ok ? { ok: true, text: t('set.connected', { s: (r.ms / 1000).toFixed(1), reply: r.reply }) } : { ok: false, text: r.error, link: r.link, linkLabel: r.linkLabel, suggestModel: r.suggestModel });
  };

  const loadModels = async () => {
    setBusy('models');
    setResult(null);
    const r = await window.api.aiModels(draft);
    setBusy(null);
    if (!r.ok) return setResult({ ok: false, text: r.error, link: r.link, linkLabel: r.linkLabel });
    setModels(r.models);
    setResult({ ok: true, text: t('set.modelsAvailable', { count: r.models.length }) });
  };

  const removeKey = async () => {
    load(await window.api.settingsClearKey(provider), provider);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings settings2">
        <div className="settings-head">
          <h3 id="settings-title">{t('settings.title')}</h3>
          <button className="icon-btn" onClick={onClose} aria-label={t('set.closeSettings')}><X size={16} /></button>
        </div>
        <div className="set2-body">
          <nav className="set2-rail" aria-label={t('set.sectionsAria')}>
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <button key={s.id} type="button" className={section === s.id ? 'on' : ''} aria-current={section === s.id || undefined}
                  onClick={() => setSection(s.id)}>
                  <Icon size={15} /> <span>{t(s.label)}</span>
                </button>
              );
            })}
          </nav>
          <div className="set2-pane">
        {section === 'language' && (
        <section className="settings-section">
          <div className="settings-title"><Languages size={16} /> {t('settings.language')}</div>
          <p className="muted">{t('set.langNote')}</p>
          <div className="seg-tabs small" role="radiogroup" aria-label={t('settings.language')}>
            {[['en', 'English'], ['fr', 'Français'], ['ar', 'العربية']].map(([id, name]) => (
              <button key={id} type="button" role="radio" aria-checked={lang === id} className={lang === id ? 'on' : ''}
                onClick={() => setLang(id)}>{name}</button>
            ))}
          </div>
        </section>
        )}
        {section === 'ai' && (
        <section className="settings-section">
          <div className="settings-title"><Sparkles size={16} /> {t('set.aiTitle')}</div>
          <p className="muted">{t('set.aiNote')}</p>

          <label className="field">
            <span>{t('common.provider')}</span>
            <select value={provider} onChange={(e) => switchProvider(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}{saved.keys[p.id] ? '  ✓' : ''}</option>)}
            </select>
          </label>
          <p className="muted">{t(info.hint)}</p>
          {info.keyUrl && (
            <button className="btn btn-ghost btn-sm link-btn" type="button" onClick={() => window.api.openHelp(info.keyUrl)}>
              <ExternalLink size={13} /> {t(info.keyUrlLabel)}
            </button>
          )}

          {info.needsKey && (
            <label className="field">
              <span>
                {t('set.apiKey')}
                {hint && <b className="key-ok"><ShieldCheck size={13} /> {t('set.savedTag', { hint })}</b>}
              </span>
              <div className="key-row">
                <input type={showKey ? 'text' : 'password'} value={apiKey} autoComplete="off" spellCheck={false}
                  placeholder={hint ? t('set.replaceKey') : t('set.pasteKey')}
                  onChange={(e) => setApiKey(e.target.value)} />
                <button className="icon-btn" type="button" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? t('set.hideKey') : t('set.showKey')}>
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                {hint && <button className="icon-btn" type="button" onClick={removeKey} aria-label={t('set.deleteSavedKey')} title={t('set.deleteSavedKey')}><Trash2 size={15} /></button>}
              </div>
            </label>
          )}

          <label className="field">
            <span>
              {t('common.model')}
              <button className="btn btn-ghost btn-sm" type="button" onClick={loadModels}
                disabled={!!busy || (info.needsKey && !apiKey.trim() && !hint)}>
                {busy === 'models' ? <Loader2 size={13} className="spin" /> : null} {t('set.loadModels')}
              </button>
            </span>
            <input type="text" list="model-ids" value={model} spellCheck={false} onChange={(e) => setModel(e.target.value)} />
            <datalist id="model-ids">{models.map((m) => <option key={m} value={m} />)}</datalist>
            <small className="muted">{t('set.modelNote')}</small>
          </label>

          {(provider === 'ollama' || provider === 'openai' || provider === 'custom' || baseUrl) && (
            <label className="field">
              <span>{provider === 'custom' ? t('set.addressCustom') : t('set.addressOptional')}</span>
              <input type="text" value={baseUrl} spellCheck={false} placeholder={info.baseUrl || t('set.defaultPlaceholder')} onChange={(e) => setBaseUrl(e.target.value)} />
            </label>
          )}

          {!saved.encryption && info.needsKey && (
            <p className="error-text">{t('set.noEncryption')}</p>
          )}

          {result && (
            <div className={`result ${result.ok ? 'ok' : 'bad'}`} role="status">
              {result.ok ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
              <div className="result-body">
                <span>{result.text}</span>
                {result.suggestModel && (
                  <button className="btn btn-sm btn-primary" type="button"
                    onClick={() => { setModel(result.suggestModel); setResult(null); }}>
                    {t('set.useModel', { model: result.suggestModel })}
                  </button>
                )}
                {result.link && (
                  <button className="btn btn-sm" type="button" onClick={() => window.api.openHelp(result.link)}>
                    <ExternalLink size={13} /> {result.linkLabel || t('set.openGoogle')}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="settings-actions">
            <button className="btn" onClick={test} disabled={!!busy || (info.needsKey && !apiKey.trim() && !hint)}>
              {busy === 'test' ? <Loader2 size={14} className="spin" /> : null} {t('set.testConnection')}
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!!busy}>
              {busy === 'save' ? <Loader2 size={14} className="spin" /> : null} {t('common.save')}
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
  const t = useT();
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
    setResult({ ok: true, text: t('set.serverSaved') });
  };
  const remove = async (i) => { await persist(servers.filter((_, k) => k !== i)); setResult(null); };
  const test = async (server) => {
    setBusy(server.name); setResult(null);
    const r = await window.api.mcpTest(server);
    setBusy('');
    setResult(r.ok
      ? { ok: true, text: t('set.testAnswered', { name: server.name, tools: r.tools.join(', ') || t('set.testNone') }) }
      : { ok: false, text: t('set.testFailed', { name: server.name, error: r.error }) });
  };
  return (
    <section className="settings-section">
      <div className="settings-title"><Sparkles size={16} /> {t('set.mcpTitle')}</div>
      <p className="muted">{t('set.mcpNote')}</p>
      {servers.map((s, i) => (
        <div key={`${s.name}-${i}`} className="key-row" style={{ marginBottom: 6 }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <b>{s.name}</b> <span className="muted">{s.url ? s.url : `${s.command} ${(s.args || []).join(' ')}`}{s.env ? ` · ${t('set.envPrefix', { keys: Object.keys(s.env).join(', ') })}` : ''}</span>
          </span>
          <button className="btn btn-sm" type="button" disabled={busy === s.name} onClick={() => test(s)}>{busy === s.name ? t('set.testing') : t('set.test')}</button>
          <button className="icon-btn" type="button" aria-label={t('set.removeServerAria', { name: s.name })} title={t('set.removeServerTitle')} onClick={() => remove(i)}><Trash2 size={15} /></button>
        </div>
      ))}
      <label className="field"><span>{t('set.nameLabel')}</span>
        <input type="text" value={name} placeholder={t('set.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field"><span>{t('set.commandLabel')}</span>
        <input type="text" value={command} spellCheck={false} placeholder={t('set.commandPlaceholder')} onChange={(e) => setCommand(e.target.value)} />
      </label>
      <label className="field"><span>{t('set.argsLabel')}</span>
        <input type="text" value={args} spellCheck={false} placeholder={t('set.argsPlaceholder')} onChange={(e) => setArgs(e.target.value)} />
      </label>
      <label className="field"><span>{t('set.urlLabel')}</span>
        <input type="text" value={url} spellCheck={false} placeholder={t('set.urlPlaceholder')} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label className="field"><span>{t('set.envLabel')}</span>
        <textarea value={envText} spellCheck={false} rows={2} placeholder={'e.g.\nAPI_KEY=${MY_API_KEY}'} onChange={(e) => setEnvText(e.target.value)} />
      </label>
      <label className="field"><span>{t('set.headersLabel')}</span>
        <textarea value={headersText} spellCheck={false} rows={2} placeholder={'e.g.\nAuthorization=Bearer ${MY_TOKEN}'} onChange={(e) => setHeadersText(e.target.value)} />
      </label>
      <div className="settings-actions">
        <button className="btn" type="button" disabled={!canSave} onClick={add}>{t('set.addServer')}</button>
        <button className="btn" type="button" disabled={!canSave || busy === name}
          onClick={() => test(draft())}>{busy === name ? t('set.testing') : t('set.testDraft')}</button>
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
