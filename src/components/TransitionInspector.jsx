// Reusable keyframe-aware transition inspector (FB-11 · P1-08).
//
// One component serves the timeline Transition panel (Inspector.jsx) and the
// clip panel (ClipInspector.jsx), so the two paths can never disagree. It
// renders exactly the controls trCapabilities (src/fx/params.js) says are
// wired for this transition — never an irrelevant control:
//
//   direction — the schema's direction option, or the direction-group engine
//     swap (wipeleft ↔ wiperight …) for the classic directionals.
//   softness  — the schema's feather key, under its inspector name.
//   strength  — the schema's strength key (today only fx_morphcut's warp),
//     keyframe-aware: with the playhead inside the transition it shows the
//     value at the playhead and can add a key there; keys live on
//     tr.strengthKeys and are honoured by preview and export alike
//     (morph.js transitionStrengthAt).
//
// Duration and ease are NOT rendered here: duration has its own slider in
// both host panels and ease lives in the motion-curve card. A transition
// with no wired control beyond those gets the fallback note, not an empty
// card and not a fake slider.
import React from 'react';
import { trCapabilities, trDefaults } from '../fx/params.js';
import { directionGroupFor } from '../fx/collections.js';
import { removeFxKey, sanitizeFxKeys, upsertFxKey } from '../fx/fxKeys.js';
import { transitionStrengthAt } from '../fx/morph.js';
import { useT } from '../i18n/index.jsx';
import Slider from './Slider.jsx';

function strengthPatch(tr, keys) {
  const next = { ...tr };
  if (keys.length) next.strengthKeys = keys; else delete next.strengthKeys;
  return next;
}

export default function TransitionInspector({ tr, dispatch, onPatch, onParam, progress = null, showFallbackNote = true }) {
  const t = useT();
  if (!tr) return null;
  const caps = trCapabilities(tr.type);
  const vals = { ...trDefaults(tr.type), ...(tr.params || {}) };
  const pct = (v) => `${Math.round(v * 100)}%`;
  const group = directionGroupFor(tr.type);
  const dirCap = caps.find((c) => c.key === 'direction');
  const softCap = caps.find((c) => c.key === 'softness');
  const strCap = caps.find((c) => c.key === 'strength');
  const hasControls = dirCap || softCap || strCap || group;

  // Keyframe-aware strength (morph only): value at the playhead when the
  // playhead is inside the transition, else the static value. With keys
  // present the slider edits a draft that "Add keyframe" commits at the
  // playhead time (the FxKeyframesCard pattern); without keys it writes the
  // static strength directly.
  const dur = Number(tr.duration) || 0.8;
  const keys = sanitizeFxKeys(tr.strengthKeys || [], dur);
  const atPlayhead = progress == null ? null : transitionStrengthAt(tr, progress);
  const [draft, setDraft] = React.useState(null);
  const shownStrength = draft ?? atPlayhead ?? vals.strength ?? 1;

  return (
    <>
      {(dirCap || group) && (
        <div className="field">
          <span>{t('insp.trDirection')}</span>
          <div className="dir-seg" role="group" aria-label={t('insp.trDirection')}>
            {dirCap ? dirCap.options.map((o) => (
              <button key={o} type="button" className={`btn btn-sm ${o === vals.direction ? 'btn-primary' : ''}`}
                aria-pressed={o === vals.direction} onClick={() => onParam('direction', o)}>
                {t(`insp.trdir.${o}`)}
              </button>
            )) : ['left', 'right', 'up', 'down'].map((d) => (
              <button key={d} type="button" className={`btn btn-sm ${d === group.dir ? 'btn-primary' : ''}`}
                aria-pressed={d === group.dir} title={t('ci.direction', { name: `${group.name} ${t(`ci.dir.${d}`)}` })}
                onClick={() => onPatch({ ...tr, type: group.ids[d] })}>
                {{ left: '←', right: '→', up: '↑', down: '↓' }[d]} {t(`ci.dir.${d}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      {softCap && (
        <Slider dispatch={dispatch} label={t('insp.trSoftness')} value={vals.feather ?? softCap.def}
          min={softCap.min} max={softCap.max} step={softCap.step} fmt={pct} numScale={100}
          onChange={(v) => onParam('feather', v)} />
      )}
      {strCap && (
        <>
          <Slider dispatch={dispatch} label={t('insp.trStrength')} value={shownStrength}
            min={strCap.min} max={strCap.max} step={strCap.step} fmt={pct} numScale={100}
            onChange={(v) => { if (keys.length) setDraft(v); else onParam('strength', v); }} />
          {progress != null && (
            <div className="field">
              <span>{t('insp.trStrengthKeys', { time: (progress * dur).toFixed(2) })}</span>
              <div className="row-btns">
                <button type="button" className="btn btn-sm" onClick={() => {
                  onPatch(strengthPatch(tr, upsertFxKey(keys, progress * dur, shownStrength, dur)));
                  setDraft(null);
                }}>{t('insp.trKeyAdd')}</button>
                {!!keys.length && (
                  <button type="button" className="btn btn-sm" onClick={() => { onPatch(strengthPatch(tr, [])); setDraft(null); }}>
                    {t('insp.trKeysClear')}
                  </button>
                )}
              </div>
              {!!keys.length && (
                <div className="fx-keys">
                  {keys.map((k) => (
                    <div key={k.t} className="fx-key-row">
                      <span>{k.t.toFixed(2)}s · {Math.round(k.v * 100)}%</span>
                      <button type="button" className="icon-btn" aria-label={t('insp.trKeyRemove', { time: k.t.toFixed(2) })}
                        onClick={() => onPatch(strengthPatch(tr, removeFxKey(keys, k.t)))}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
      {!hasControls && showFallbackNote && (
        <p className="dim small">{t('insp.trNoParams')}</p>
      )}
    </>
  );
}

// Prune helper for strength-key edits made through onPatch (kept here so both
// host panels share the one rule).
export function trStrengthKeysPatch(tr, keys) {
  return strengthPatch(tr, keys);
}
