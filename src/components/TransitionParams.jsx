// Parameter controls for a parametric transition (P2-04): feather sliders and
// direction / shape option buttons, rendered from the transition's schema
// (trSchema in fx/params.js — the specific params plus the generic B-F05
// {duration, direction, ease, strength, center, softness, motionBlur} schema).
// One component serves both the timeline Transition panel (Inspector.jsx) and
// the clip panel (ClipInspector.jsx), so the two paths can never disagree.
// Values live on clip.transition.params; only non-default values are stored
// (prunedTrParams), an absent value IS the default. Entries with live:false
// (generic strength / motion blur on transitions whose engine cannot consume
// them yet) are in the schema and round-trip, but render no dead slider.
// A generic direction change switches the transition TYPE to the sibling
// variant (wipe left -> wipe right), like the old direction buttons did.
// FB-13: the audio-fade field lives here too, so both panels edit the same
// clip.transition.audioFade — it renders for every transition type, not just
// the parameterised ones (the schema section below stays gated on trSchema).
import React from 'react';
import { normalizeAudioFade, trDefaults, trSchema } from '../fx/params.js';
import { useT } from '../i18n/index.jsx';
import Slider from './Slider.jsx';

// trParamsPatch lives in fx/params.js (B-F05: a direction change switches the
// variant type, duration/ease write top-level fields); re-exported here so
// the Inspector/ClipInspector import path is unchanged.
export { trParamsPatch } from '../fx/params.js';

const OPT_LABEL_KEY = { direction: 'trdir', shape: 'trshape', center: 'trcenter', ease: 'trease' };

// FB-11: the generic keys (direction / feather / strength) are owned by the
// reusable TransitionInspector (capabilities-gated, keyframe-aware); this
// component renders only the remaining schema keys (e.g. shape), so a
// parameter never gets two controls.
const GENERIC_KEYS = new Set(['direction', 'feather', 'strength']);

// Audio-fade patch (FB-13): 'auto' prunes the field — absent IS auto.
export function trAudioFadePatch(tr, audioFade) {
  const af = normalizeAudioFade(audioFade);
  if (af.mode === 'auto') {
    const next = { ...tr };
    delete next.audioFade;
    return next;
  }
  return { ...tr, audioFade: af };
}

export default function TransitionParams({ tr, dispatch, onChange, onAudioFade, maxDur = 2 }) {
  const t = useT();
  const af = normalizeAudioFade(tr?.audioFade);
  const audioFadeField = (
    <div className="field" key="audioFade">
      <span>{t('insp.trAudioFade')}</span>
      <div className="dir-seg" role="group" aria-label={t('insp.trAudioFade')}>
        {['auto', 'custom', 'off'].map((m) => (
          <button key={m} type="button" className={`btn btn-sm ${af.mode === m ? 'btn-primary' : ''}`}
            aria-pressed={af.mode === m}
            onClick={() => onAudioFade?.(m === 'auto' ? { mode: 'auto' } : m === 'off' ? { mode: 'off' } : { mode: 'custom', duration: af.duration })}>
            {t(`insp.trAudioFade.${m}`)}
          </button>
        ))}
      </div>
      {af.mode === 'custom' && (
        <Slider dispatch={dispatch} label={t('insp.trAudioFadeDuration')} value={Math.min(af.duration, maxDur)} min={0.1} max={maxDur} step={0.05}
          fmt={(v) => `${v.toFixed(2)}s`}
          onChange={(duration) => onAudioFade?.({ mode: 'custom', duration })} />
      )}
      {af.mode === 'off' && <p className="dim small">{t('insp.trAudioFadeOffNote')}</p>}
    </div>
  );
  // FB-11: only the non-generic schema keys render here; the generic ones
  // live in TransitionInspector. When none remain, the audio-fade field
  // still renders (FB-13: it shows for every transition type).
  // B-F05: entries with live:false render no dead slider, and field entries
  // (duration/ease — top-level fields) are owned by TransitionInspector too.
  const schema = (trSchema(tr?.type) || []).filter((p) => !GENERIC_KEYS.has(p.key) && !p.field && p.live !== false);
  if (!schema.length) return <>{audioFadeField}</>;
  const vals = { ...trDefaults(tr.type), ...(tr.params || {}) };
  const pct = (v) => `${Math.round(v * 100)}%`;
  return (
    <>
      {audioFadeField}
      {schema.map((p) => {
        if (p.options) {
          const ns = p.optLabelKey || OPT_LABEL_KEY[p.key] || 'trdir';
          const label = p.label ? t(p.label) : t(`insp.${p.key === 'shape' ? 'trShape' : p.key === 'center' ? 'trCenter' : 'trDirection'}`);
          return (
            <div className="field" key={p.key}>
              <span>{label}</span>
              <div className="dir-seg" role="group" aria-label={label}>
                {p.options.map((o) => (
                  <button key={o} type="button" className={`btn btn-sm ${o === vals[p.key] ? 'btn-primary' : ''}`}
                    aria-pressed={o === vals[p.key]} onClick={() => onChange(p.key, o)}>
                    {t(`insp.${ns}.${o}`)}
                  </button>
                ))}
              </div>
            </div>
          );
        }
        return (
          <Slider key={p.key} dispatch={dispatch} label={t(p.label || 'insp.trFeather')} value={vals[p.key]}
            min={p.min} max={p.max} step={p.step}
            {...(p.fmt === 'pct' ? { fmt: pct, numScale: 100 } : {})}
            onChange={(v) => onChange(p.key, v)} />
        );
      })}
    </>
  );
}
