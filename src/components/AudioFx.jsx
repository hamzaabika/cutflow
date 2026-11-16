// Audio effects controls (clip.audioFx). The effects are rendered into a preview file
// through the very chain the export uses (electron/audiofxrender.cjs), and preview and
// export both play that render — what you hear is what you export. While a fresh render
// is still landing, the preview plays the original sound and the note below says so.
// Shared by the audio-track inspector and the video-clip inspector: every audio-bearing
// clip gets the same section.
import React, { useState } from 'react';
import { AUDIO_PRESETS, PRESET_CATS, activePreset, LOWPASS_MIN, LOWPASS_MAX, LOWPASS_MAX_ENABLED, clampLowpass, PRESET_MODULES, DEFAULT_MERGE_MODULES, mergeAudioFx, diffAudioFxModules } from '../fx/audioPresets.js';
import { compParams, limitParams } from '../fx/audioFxChain.js';
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
  // P2-21 — advanced dynamics, read back through the chain's own parameter
  // canonicalization so the sliders always show what the export renders.
  // The stored object keeps dB; compParams/limitParams convert to the linear
  // values ffmpeg wants (threshold/makeup), so the round-trip is exact.
  const compDb = (c) => {
    const p = compParams(c);
    return p ? { threshold: Math.round(20 * Math.log10(p.threshold) * 10) / 10, ratio: p.ratio, attack: p.attack, release: p.release, makeup: Math.round(20 * Math.log10(p.makeup) * 10) / 10 } : null;
  };
  const limitDb = (l) => {
    const p = limitParams(l);
    return p ? Math.round(20 * Math.log10(p.limit) * 10) / 10 : null;
  };
  const comp = compDb(f.comp);
  const limDb = limitDb(f.limit);
  // FB-06 — preset apply mode. Replace takes the whole preset; merge takes
  // only the checked modules and keeps the rest of the clip's own settings
  // (EQ excluded by default, so a manual EQ survives). Every apply snapshots
  // the before/after settings for one-step undo and A/B comparison.
  const [mode, setMode] = useState('replace');
  const [mergeMods, setMergeMods] = useState(DEFAULT_MERGE_MODULES);
  const [beforeFx, setBeforeFx] = useState(null);
  const [afterFx, setAfterFx] = useState(null);
  const [ab, setAb] = useState('after');
  const [changed, setChanged] = useState([]);
  const moduleLabel = (m) => ({ eq: t('afx.equalizer'), filters: t('afx.filters'), dynamics: t('afx.dynamics'), cleanup: t('afx.moduleCleanup'), space: t('afx.echo'), pitch: t('afx.pitch'), stereo: t('afx.stereo') })[m];
  const applyPreset = (p) => {
    const before = structuredClone(f);
    const next = mode === 'merge' ? mergeAudioFx(f, p.fx, mergeMods) : structuredClone(p.fx);
    setBeforeFx(before);
    setAfterFx(next);
    setChanged(diffAudioFxModules(before, next));
    setAb('after');
    onChange(next);
  };
  const undoPreset = () => {
    if (!beforeFx) return;
    onChange(structuredClone(beforeFx));
    setBeforeFx(null); setAfterFx(null); setChanged([]);
  };
  const toggleAb = () => {
    const target = ab === 'after' ? beforeFx : afterFx;
    if (!target) return;
    onChange(structuredClone(target));
    setAb(ab === 'after' ? 'before' : 'after');
  };
  const toggleModule = (m) => setMergeMods((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  const bands = Array.isArray(f.eqBands) ? f.eqBands : [];
  const bandAt = (i) => bands[i] || null;
  const setBand = (i, patch) => {
    const next = bands.slice(0, 4);
    next[i] = { ...(next[i] || { f: [100, 400, 1000, 4000][i] || 1000, g: 0, q: 1 }), ...patch };
    set({ eqBands: next });
  };
  const toggleBand = (i, on) => {
    if (on) setBand(i, {});
    else set({ eqBands: bands.filter((_, j) => j !== i) });
  };
  return (
    <div className="afx">
      {previewState === 'ready' ? (
        <div className="afx-note">{t('afx.noteReady')}</div>
      ) : previewState === 'slice' ? (
        <div className="afx-note">{t('afx.noteSlice')}</div>
      ) : previewState === 'pending' ? (
        <div className="afx-note">{t('afx.notePending')}</div>
      ) : (
        <div className="afx-note">{t('afx.noteIdle')}</div>
      )}
      <div className="afx-apply">
        <div className="afx-apply-modes" role="group" aria-label={t('afx.applyMode')}>
          <button type="button" className={`afx-mode ${mode === 'replace' ? 'on' : ''}`} aria-pressed={mode === 'replace'}
            onClick={() => setMode('replace')}>{t('afx.applyReplace')}</button>
          <button type="button" className={`afx-mode ${mode === 'merge' ? 'on' : ''}`} aria-pressed={mode === 'merge'}
            onClick={() => setMode('merge')}>{t('afx.applyMerge')}</button>
        </div>
        {mode === 'merge' && (
          <div className="afx-modules" role="group" aria-label={t('afx.mergeModules')}>
            {PRESET_MODULES.map((m) => (
              <label key={m} className="afx-module">
                <input type="checkbox" checked={mergeMods.includes(m)} onChange={() => toggleModule(m)} /> {moduleLabel(m)}
              </label>
            ))}
          </div>
        )}
      </div>
      {beforeFx && (
        <div className="afx-applied">
          <span className="afx-note">{t('afx.presetChanged', { list: changed.map(moduleLabel).join(', ') || t('afx.off') })}</span>
          <button type="button" className="btn btn-sm" onClick={toggleAb}>{t('afx.compareAB')} · {ab === 'after' ? t('afx.abAfter') : t('afx.abBefore')}</button>
          <button type="button" className="btn btn-sm" onClick={undoPreset}>{t('afx.undoPreset')}</button>
        </div>
      )}
      {PRESET_CATS.map((cat) => (
        <div key={cat} className="afx-pack">
          <div className="afx-group-title">{t('afx.pack', { cat: libName('cat', slugifyPhrase(cat), cat), n: AUDIO_PRESETS.filter((p) => p.cat === cat).length })}</div>
          <div className="afx-presets" role="group" aria-label={t('afx.presetsAria', { cat })}>
            {AUDIO_PRESETS.filter((p) => p.cat === cat).map((p) => (
              <button key={p.id} type="button" className={`afx-chip ${active?.id === p.id ? 'on' : ''}`}
                aria-pressed={active?.id === p.id} title={t('afx.presetTitle', { name: libName('afx', p.id, p.name) })}
                onClick={() => applyPreset(p)}>{libName('afx', p.id, p.name)}</button>
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
          <Range value={f.lowpass || LOWPASS_MAX} min={LOWPASS_MIN} max={LOWPASS_MAX} step={50} aria={t('afx.lowpassAria')}
            fmt={(v) => (v >= LOWPASS_MAX ? t('afx.off') : v < 1000 ? `${v} Hz` : `${(v / 1000).toFixed(1).replace(/\.0$/, '')} kHz`)}
            onChange={(v) => set({ lowpass: v >= LOWPASS_MAX ? 0 : v })} />
          <input type="number" className="afx-num" aria-label={t('afx.lowpassExactAria')}
            min={LOWPASS_MIN} max={LOWPASS_MAX_ENABLED} step={50} key={f.lowpass || 'off'}
            defaultValue={f.lowpass || ''} placeholder={t('afx.off')}
            onBlur={(e) => { const n = Number(e.target.value); set({ lowpass: Number.isFinite(n) && n > 0 ? clampLowpass(n) : 0 }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
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
        <div className="afx-group-title">{t('afx.eqBands')}</div>
        {[0, 1, 2, 3].map((i) => {
          const b = bandAt(i);
          return (
            <React.Fragment key={i}>
              <Toggle label={t('afx.band', { n: i + 1 })} checked={!!b} onChange={(v) => toggleBand(i, v)} />
              {b && (
                <>
                  <Row label={t('afx.freq')}>
                    <Range value={b.f} min={20} max={18000} step={10} fmt={(v) => `${v} Hz`} aria={t('afx.freq')} onChange={(v) => setBand(i, { f: v })} />
                  </Row>
                  <Row label={t('afx.gain')}>
                    <Range value={b.g} min={-15} max={15} step={0.5} fmt={db} aria={t('afx.gain')} onChange={(v) => setBand(i, { g: v })} />
                  </Row>
                  <Row label={t('afx.q')}>
                    <Range value={b.q} min={0.5} max={10} step={0.1} fmt={(v) => `${v}`} aria={t('afx.q')} onChange={(v) => setBand(i, { q: v })} />
                  </Row>
                </>
              )}
            </React.Fragment>
          );
        })}
      </div>
      <div className="afx-group">
        <div className="afx-group-title">{t('afx.stereo')}</div>
        <Row label={t('afx.pan')}>
          <Range value={f.pan || 0} min={-1} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} aria={t('afx.pan')} onChange={(v) => set({ pan: v })} />
        </Row>
        <Row label={t('afx.width')}>
          <Range value={f.width ?? 1} min={0} max={2} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} aria={t('afx.width')} onChange={(v) => set({ width: v })} />
        </Row>
      </div>
      <div className="afx-group">
        <div className="afx-group-title">{t('afx.dynamics')}</div>
        <Toggle label={t('afx.compressor')} checked={!!f.comp} onChange={(v) => set({ comp: v })} />
        {comp && (
          <>
            <Row label={t('afx.threshold')}>
              <Range value={comp.threshold} min={-60} max={0} step={1} fmt={db} aria={t('afx.threshold')} onChange={(v) => set({ comp: { ...comp, threshold: v } })} />
            </Row>
            <Row label={t('afx.ratio')}>
              <Range value={comp.ratio} min={1} max={20} step={0.5} fmt={(v) => `${v}:1`} aria={t('afx.ratio')} onChange={(v) => set({ comp: { ...comp, ratio: v } })} />
            </Row>
            <Row label={t('afx.attack')}>
              <Range value={comp.attack} min={0.1} max={100} step={0.1} fmt={(v) => `${v} ms`} aria={t('afx.attack')} onChange={(v) => set({ comp: { ...comp, attack: v } })} />
            </Row>
            <Row label={t('afx.release')}>
              <Range value={comp.release} min={10} max={1000} step={10} fmt={(v) => `${v} ms`} aria={t('afx.release')} onChange={(v) => set({ comp: { ...comp, release: v } })} />
            </Row>
            <Row label={t('afx.makeup')}>
              <Range value={comp.makeup} min={0} max={24} step={0.5} fmt={db} aria={t('afx.makeup')} onChange={(v) => set({ comp: { ...comp, makeup: v } })} />
            </Row>
          </>
        )}
        <Toggle label={t('afx.limiter')} checked={!!f.limit} onChange={(v) => set({ limit: v })} />
        {limDb != null && (
          <Row label={t('afx.ceiling')}>
            <Range value={limDb} min={-12} max={0} step={0.5} fmt={db} aria={t('afx.ceiling')} onChange={(v) => set({ limit: { ceiling: v } })} />
          </Row>
        )}
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
