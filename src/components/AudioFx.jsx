// Audio effects controls (clip.audioFx). The effects are rendered into a preview file
// through the very chain the export uses (electron/audiofxrender.cjs), and preview and
// export both play that render — what you hear is what you export. While a fresh render
// is still landing, the preview plays the original sound and the note below says so.
// Shared by the audio-track inspector and the video-clip inspector: every audio-bearing
// clip gets the same section.
import React from 'react';
import { AUDIO_PRESETS, PRESET_CATS, activePreset } from '../fx/audioPresets.js';
import KitToggle from '../ui/Toggle.jsx';
import { coarseRangeKeyDown } from './Slider.jsx';
import { useT } from '../i18n/index.jsx';
import { libName, slugifyPhrase } from '../i18n/libNames.js';

const Row = ({ label, children }) => (
  <div className="afx-row">
    <span className="afx-label">{label}</span>
    <span className="afx-ctl">{children}</span>
  </div>
);
const Range = ({ value, min, max, step = 1, fmt, onChange, aria }) => (
  <>
    <input type="range" min={min} max={max} step={step} value={value} aria-label={aria || 'value'}
      onKeyDown={(e) => coarseRangeKeyDown(e, { value, min, max, step, onChange })}
      onChange={(e) => onChange(Number(e.target.value))} />
    <span className="afx-val">{fmt ? fmt(value) : value}</span>
  </>
);
const Toggle = ({ label, checked, onChange, hint }) => (
  <Row label={label}>
    <KitToggle checked={checked} aria-label={label} title={hint}
      onChange={(e) => onChange(e.target.checked)} />
  </Row>
);

export default function AudioFxControls({ fx, onChange, previewState }) {
  const t = useT();
  const f = fx || {};
  const eq = f.eq || { low: 0, mid: 0, high: 0 };
  const set = (patch) => onChange({ ...f, ...patch });
  const setEq = (band, v) => set({ eq: { ...eq, [band]: v } });
  const db = (v) => `${v > 0 ? '+' : ''}${v} dB`;
  const active = activePreset(f);
  return (
    <div className="afx">
      {previewState === 'ready' ? (
        <div className="afx-note">{t('afx.noteReady')}</div>
      ) : previewState === 'pending' ? (
        <div className="afx-note">{t('afx.notePending')}</div>
      ) : (
        <div className="afx-note">{t('afx.noteIdle')}</div>
      )}
      {PRESET_CATS.map((cat) => (
        <div key={cat} className="afx-pack">
          <div className="afx-group-title">{t('afx.pack', { cat: libName('cat', slugifyPhrase(cat), cat), n: AUDIO_PRESETS.filter((p) => p.cat === cat).length })}</div>
          <div className="afx-presets" role="group" aria-label={t('afx.presetsAria', { cat })}>
            {AUDIO_PRESETS.filter((p) => p.cat === cat).map((p) => (
              <button key={p.id} type="button" className={`afx-chip ${active?.id === p.id ? 'on' : ''}`}
                aria-pressed={active?.id === p.id} title={t('afx.presetTitle', { name: libName('afx', p.id, p.name) })}
                onClick={() => onChange(structuredClone(p.fx))}>{libName('afx', p.id, p.name)}</button>
            ))}
          </div>
        </div>
      ))}
      <div className="afx-group">
        <div className="afx-group-title">{t('afx.filters')}</div>
        <Row label={t('afx.highpass')}>
          <Range value={f.highpass || 0} min={0} max={400} step={5} aria={t('afx.highpassAria')}
            fmt={(v) => (v < 20 ? t('afx.off') : `${v} Hz`)} onChange={(v) => set({ highpass: v })} />
        </Row>
        <Row label={t('afx.lowpass')}>
          <Range value={f.lowpass || 20000} min={4000} max={20000} step={500} aria={t('afx.lowpassAria')}
            fmt={(v) => (v >= 20000 ? t('afx.off') : `${(v / 1000).toFixed(1).replace(/\.0$/, '')} kHz`)}
            onChange={(v) => set({ lowpass: v >= 20000 ? 0 : v })} />
        </Row>
      </div>
      <div className="afx-group">
        <div className="afx-group-title">{t('afx.equalizer')}</div>
        <Row label={t('afx.eqLow')}>
          <Range value={eq.low} min={-15} max={15} fmt={db} aria={t('afx.eqLowAria')} onChange={(v) => setEq('low', v)} />
        </Row>
        <Row label={t('afx.eqMid')}>
          <Range value={eq.mid} min={-15} max={15} fmt={db} aria={t('afx.eqMidAria')} onChange={(v) => setEq('mid', v)} />
        </Row>
        <Row label={t('afx.eqHigh')}>
          <Range value={eq.high} min={-15} max={15} fmt={db} aria={t('afx.eqHighAria')} onChange={(v) => setEq('high', v)} />
        </Row>
        <Row label={t('afx.pitch')}>
          <Range value={f.pitch || 0} min={-12} max={12} fmt={(v) => `${v > 0 ? '+' : ''}${v} st`} aria={t('afx.pitchAria')} onChange={(v) => set({ pitch: v })} />
        </Row>
      </div>
      <div className="afx-group">
        <div className="afx-group-title">{t('afx.dynamics')}</div>
        <Toggle label={t('afx.compressor')} checked={!!f.comp} onChange={(v) => set({ comp: v })} />
        <Toggle label={t('afx.limiter')} checked={!!f.limit} onChange={(v) => set({ limit: v })} />
        <Toggle label={t('afx.denoise')} checked={!!f.denoise} onChange={(v) => set({ denoise: v })} />
        <Toggle label={t('afx.loudnorm')} checked={!!f.loudnorm} onChange={(v) => set({ loudnorm: v })}
          hint={t('afx.loudnormHint')} />
        <Row label={t('afx.echo')}>
          <KitToggle checked={!!f.echo} aria-label={t('afx.echo')}
            onChange={(e) => set({ echo: e.target.checked ? { delay: 180, decay: 0.3 } : null })} />
        </Row>
        {f.echo && (
          <>
            <Row label={t('afx.echoDelay')}>
              <Range value={f.echo.delay} min={20} max={900} step={10} fmt={(v) => `${v} ms`} aria={t('afx.echoDelay')} onChange={(v) => set({ echo: { ...f.echo, delay: v } })} />
            </Row>
            <Row label={t('afx.echoDecay')}>
              <Range value={f.echo.decay} min={0.05} max={0.8} step={0.05} fmt={(v) => v.toFixed(2)} aria={t('afx.echoDecay')} onChange={(v) => set({ echo: { ...f.echo, decay: v } })} />
            </Row>
          </>
        )}
      </div>
    </div>
  );
}
