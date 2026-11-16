import React, { useEffect, useRef, useState } from 'react';
import { AppWindow, Camera, Circle, Loader2, Mic, Monitor, Pause, Play, RefreshCw, Square, SquareDashed, Volume2, VolumeX, X } from '../icons.jsx';
import { useT } from '../i18n/index.jsx';

const pad = (v) => String(Math.floor(v)).padStart(2, '0');
const clock = (s) => `${pad(s / 60)}:${pad(s % 60)}`;

// Media > Record screen: pick a screen or a window, the sounds and the camera, then record.
export default function ScreenRecordDialog({ rec, at, onClose }) {
  const t = useT();
  const [sources, setSources] = useState(null);
  const [kind, setKind] = useState('screen');
  const [pick, setPick] = useState(null);
  const [opts, setOpts] = useState({ systemAudio: true, mic: false, micId: '', camera: false, cameraId: '', camShape: 'circle', hideApp: true,
    camStroke: 0, camStrokeColor: '#ffffff', camGlow: 0, camGlowColor: '#825cfb' });
  const [devices, setDevices] = useState({ mics: [], cams: [] });
  const [micWarn, setMicWarn] = useState(false);
  const [loadError, setLoadError] = useState('');
  // Where finished recordings land, spelled the way this OS spells it
  // (the folder is the Videos folder's Cutflow subfolder on every OS).
  const recDir = `Videos${(navigator.platform || '').toLowerCase().startsWith('win') ? String.fromCharCode(92) : '/'}Cutflow`;
  // Device names are only given once a device was allowed; list them again after the camera / microphone opens.
  const listDevices = () => navigator.mediaDevices.enumerateDevices().then((all) => setDevices({
    mics: all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications'),
    cams: all.filter((d) => d.kind === 'videoinput'),
  })).catch(() => {});
  useEffect(() => {
    listDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', listDevices);
    const off = window.api.onScreenCamConfig((c) => setOpts((o) => ({ ...o, camShape: c.shape })));
    return () => { navigator.mediaDevices.removeEventListener?.('devicechange', listDevices); off(); };
  }, []);
  // Start from the last microphone choice (kept in the app settings, like
  // the camera below is kept by the main process).
  useEffect(() => {
    window.api.settingsGet().then((s) => {
      const r = s && s.recorder;
      if (r) setOpts((o) => ({ ...o, mic: r.mic === true, micId: typeof r.micId === 'string' ? r.micId : '' }));
    }).catch(() => {});
  }, []);
  // Start from the last camera and shape (kept by the main process between recordings).
  const camReady = useRef(false);
  useEffect(() => {
    window.api.screenCamera(false, {}).then((c) => {
      camReady.current = true;
      setOpts((o) => ({ ...o, camShape: c.shape, cameraId: c.deviceId || '',
        camStroke: c.stroke || 0, camStrokeColor: c.strokeColor || '#ffffff', camGlow: c.glow || 0, camGlowColor: c.glowColor || '#825cfb' }));
    });
  }, []);
  // The camera bubble follows the Camera option, the chosen camera and the shape.
  useEffect(() => {
    if (rec.active || !camReady.current) return;
    window.api.screenCamera(opts.camera, {
      deviceId: opts.cameraId, shape: opts.camShape,
      stroke: opts.camStroke, strokeColor: opts.camStrokeColor, glow: opts.camGlow, glowColor: opts.camGlowColor,
    }).then(() => opts.camera && setTimeout(listDevices, 1500));
  }, [opts.camera, opts.cameraId, opts.camShape, opts.camStroke, opts.camStrokeColor, opts.camGlow, opts.camGlowColor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (!rec.active) window.api.screenCamera(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setO = (patch) => setOpts((o) => ({ ...o, ...patch }));
  const load = () => {
    setSources(null);
    setLoadError('');
    window.api.screenSources().then((list) => {
      setSources(list);
      setPick((p) => (list.some((s) => s.id === p) ? p : list.find((s) => s.kind === 'screen')?.id || list[0]?.id || null));
    }).catch(() => setLoadError('1'));
  };
  useEffect(load, []);
  const set = (k) => (e) => setOpts((o) => ({ ...o, [k]: e.target.checked }));
  // The microphone choice is remembered: every change is written to the
  // app settings, and the dialog opens with the saved choice restored.
  const saveMic = (mic, micId) => window.api.settingsSetRecorderPrefs({ mic, micId }).catch(() => {});
  const onMicToggle = (e) => {
    const mic = e.target.checked;
    setO({ mic });
    if (mic) { setMicWarn(false); setTimeout(listDevices, 800); }
    saveMic(mic, opts.micId);
  };
  const onMicDevice = (e) => {
    setO({ micId: e.target.value });
    saveMic(opts.mic, e.target.value);
  };
  const turnMicOn = () => {
    setO({ mic: true });
    setMicWarn(false);
    setTimeout(listDevices, 800);
    saveMic(true, opts.micId);
  };
  const doStart = () => rec.start({ ...opts, sourceId: pick, at });
  // Starting with the microphone off first asks — it never starts silently.
  const tryStart = () => { if (!opts.mic) { setMicWarn(true); return; } doStart(); };
  const shown = (sources || []).filter((s) => s.kind === kind);
  const close = () => { if (!rec.active) { rec.dismissNotice?.(); onClose(); } };

  if (rec.phase === 'countdown') {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('rec.startsAria')}>
        <div className="modal rec-modal">
          <div className="rec-count" aria-live="assertive">{rec.count}</div>
          <p className="muted">{t('rec.starts')}</p>
          <button className="btn" onClick={rec.cancel}>{t('common.cancel')}</button>
        </div>
      </div>
    );
  }
  if (rec.phase === 'recording' || rec.phase === 'saving') {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('rec.savingAria')}>
        <div className="modal rec-modal">
          {rec.phase === 'saving' ? (
            <>
              <Loader2 size={30} className="spin" />
              <h3>{t('rec.saving')}</h3>
              <p className="muted">{t('rec.savingNote', { dir: recDir })}</p>
            </>
          ) : (
            <>
              <div className={`rec-live ${rec.paused ? 'paused' : ''}`}><span className="rec-dot" /> {clock(rec.seconds)}</div>
              <p className="muted">{rec.paused ? t('rec.pausedFull') : t('rec.recordingFull')}</p>
              <div className="modal-actions">
                <button className="btn" onClick={rec.togglePause}>{rec.paused ? <Play size={14} /> : <Pause size={14} />} {rec.paused ? t('rec.resume') : t('rec.pause')}</button>
                <button className="btn btn-danger" onClick={() => rec.stop()}><Square size={12} fill="currentColor" /> {t('tl.stop')}</button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rec-title" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="modal rec-pick">
        <div className="rec-head">
          <h3 id="rec-title">{t('rec.title')}</h3>
          <button className="icon-btn" aria-label={t('common.close')} onClick={close}><X size={16} /></button>
        </div>
        <div className="rec-tabs">
          <div className="seg-tabs small" role="tablist" aria-label={t('rec.whatToRecord')}>
            {[['screen', t('rec.screens'), Monitor], ['window', t('rec.windows'), AppWindow]].map(([id, name, Icon]) => (
              <button key={id} role="tab" aria-selected={kind === id} className={kind === id ? 'on' : ''} onClick={() => setKind(id)}><Icon size={14} /> {name}</button>
            ))}
          </div>
          <button className="icon-btn" aria-label={t('rec.refreshList')} title={t('common.refresh')} onClick={load}><RefreshCw size={15} /></button>
        </div>
        {rec.notice && (
          <div className="rec-notice" role="alert">
            <VolumeX size={16} />
            <div className="rec-notice-text">
              <b>{t('recorder.noSoundTitle')}</b>
              <p>{t('recorder.noSoundBody')}</p>
            </div>
            <button className="btn btn-sm" onClick={() => rec.dismissNotice()}>{t('common.close')}</button>
          </div>
        )}
        <div className="rec-sources" role="listbox" aria-label={kind === 'screen' ? t('rec.screens') : t('rec.windows')}>
          {!sources && !loadError && <div className="lib-loading"><Loader2 size={15} className="spin" /> {t('rec.looking')}</div>}
          {loadError && (
            <div className="rec-srcerror" role="alert">
              <b>{t('recorder.sourcesErrorTitle')}</b>
              <p className="muted">{t('recorder.sourcesErrorBody')}</p>
              <button className="btn btn-sm" onClick={load}>{t('recorder.retry')}</button>
            </div>
          )}
          {sources && !shown.length && <p className="muted">{t('rec.nothing')}</p>}
          {shown.map((s) => (
            <button key={s.id} role="option" aria-selected={pick === s.id} className={`rec-source ${pick === s.id ? 'on' : ''}`} onClick={() => setPick(s.id)} title={s.name}>
              {s.thumb ? <img src={s.thumb} alt="" /> : <span className="rec-nothumb"><AppWindow size={22} /></span>}
              <span className="rec-name">{s.icon && <img src={s.icon} alt="" />}{s.name}</span>
            </button>
          ))}
        </div>
        <div className="rec-opts">
          <label><input type="checkbox" checked={opts.systemAudio} onChange={set('systemAudio')} /> <Volume2 size={14} /> {t('rec.computerSound')}</label>
          <label><input type="checkbox" checked={opts.hideApp} onChange={set('hideApp')} /> {t('rec.hideApp')}</label>
        </div>
        <div className="rec-devices">
          <div className="rec-device">
            <label><input type="checkbox" checked={opts.mic} onChange={onMicToggle} /> <Mic size={14} /> {t('rec.microphone')}</label>
            <select value={opts.micId} disabled={!opts.mic} aria-label={t('rec.microphone')} onChange={onMicDevice}>
              <option value="">{t('rec.defaultMic')}</option>
              {devices.mics.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || t('rec.micN', { n: i + 1 })}</option>)}
            </select>
          </div>
          <div className="rec-device">
            <label><input type="checkbox" checked={opts.camera} onChange={set('camera')} /> <Camera size={14} /> {t('rec.camera')}</label>
            <select value={opts.cameraId} disabled={!opts.camera} aria-label={t('rec.camera')} onChange={(e) => setO({ cameraId: e.target.value })}>
              <option value="">{t('rec.defaultCam')}</option>
              {devices.cams.filter((d) => d.deviceId).map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || t('rec.cameraN', { n: i + 1 })}</option>)}
            </select>
            <div className="seg-tabs small rec-shape" role="radiogroup" aria-label={t('rec.cameraShape')}>
              {[['circle', t('rec.round'), Circle], ['square', t('rec.square'), SquareDashed]].map(([id, name, Icon]) => (
                <button key={id} role="radio" aria-checked={opts.camShape === id} className={opts.camShape === id ? 'on' : ''} disabled={!opts.camera}
                  onClick={() => setO({ camShape: id })}><Icon size={13} /> {name}</button>
              ))}
            </div>
          </div>
          {opts.camera && (
            <div className="rec-camstyle">
              <div className="rec-camstyle-row">
                <span>{t('rec.outline')}</span>
                <input type="color" value={opts.camStrokeColor} aria-label={t('rec.outlineColor')}
                  onChange={(e) => setO({ camStrokeColor: e.target.value, camStroke: opts.camStroke || 6 })} />
                <span className="chips">
                  {['#ffffff', '#000000', '#ec4899', '#facc15', '#22d3ee'].map((c) => (
                    <button key={c} className="chip-color" style={{ background: c }} aria-label={t('rec.outlineAria', { color: c })} onClick={() => setO({ camStrokeColor: c, camStroke: opts.camStroke || 6 })} />
                  ))}
                </span>
                <input type="range" min="0" max="20" step="1" value={opts.camStroke} aria-label={t('rec.outlineWidth')}
                  onChange={(e) => setO({ camStroke: Number(e.target.value) })} />
                <span className="rec-camstyle-val">{opts.camStroke ? `${opts.camStroke}px` : t('ci.off')}</span>
              </div>
              <div className="rec-camstyle-row">
                <span>{t('rec.glow')}</span>
                <input type="color" value={opts.camGlowColor} aria-label={t('rec.glowColor')}
                  onChange={(e) => setO({ camGlowColor: e.target.value, camGlow: opts.camGlow || 20 })} />
                <span className="chips">
                  {['#ec4899', '#a855f7', '#22d3ee', '#22c55e', '#facc15'].map((c) => (
                    <button key={c} className="chip-color" style={{ background: c }} aria-label={t('rec.glowAria', { color: c })} onClick={() => setO({ camGlowColor: c, camGlow: opts.camGlow || 20 })} />
                  ))}
                </span>
                <input type="range" min="0" max="60" step="1" value={opts.camGlow} aria-label={t('rec.glowSize')}
                  onChange={(e) => setO({ camGlow: Number(e.target.value) })} />
                <span className="rec-camstyle-val">{opts.camGlow ? `${opts.camGlow}px` : t('ci.off')}</span>
              </div>
            </div>
          )}
          {opts.camera && (
            <p className="muted small">
              {kind === 'window' ? t('rec.camNoteWindow') : t('rec.camNoteScreen')}
            </p>
          )}
        </div>
        {micWarn && (
          <div className="rec-micwarn" role="alert">
            <Mic size={16} />
            <div className="rec-micwarn-text">
              <b>{t('recorder.micOffTitle')}</b>
              <p>{t('recorder.micOffBody')}</p>
            </div>
            <div className="rec-micwarn-actions">
              <button className="btn btn-primary btn-sm rec-micwarn-on" onClick={turnMicOn}>{t('recorder.turnMicOn')}</button>
              <button className="btn btn-sm rec-micwarn-anyway" onClick={() => { setMicWarn(false); doStart(); }}>{t('recorder.recordAnyway')}</button>
            </div>
          </div>
        )}
        {rec.error && <p className="error-text">{rec.error}</p>}
        <p className="muted small">{t('rec.footNote', { dir: recDir })}</p>
        <div className="modal-actions">
          <button className="btn" onClick={close}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={!pick} onClick={tryStart}>
            <span className="rec-dot" /> {t('rec.start')}
          </button>
        </div>
      </div>
    </div>
  );
}
