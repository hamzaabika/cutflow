// One-click Clean Voice (P2-25): an additive voice-cleanup layer over the
// clip's own sound. It never replaces volume, fades, Voice Enhance or the
// Audio FX panel — its filters run before audioFx in the export chain, and
// each step is a transparent toggle the user can edit. Ducking lowers the
// music track under this voice (it does nothing when there is no music).
// AU-02: the duck depth (music level under the voice) and ramp are editable
// here, and the duck curve can be baked into the music clips' volume
// keyframes (editable in the volume keyframe editor) — baked clips skip the
// live duck expression, so the keys are the truth; removing the bake
// restores live ducking.
import React from 'react';
import KitToggle from '../ui/Toggle.jsx';
import Slider from './Slider.jsx';
import { useT } from '../i18n/index.jsx';
import { bakeDuckKeys, duckSettingsOf, duckSpansFor } from '../duckKeys.js';
import { videoLayout } from '../store.js';

const STEPS = ['enhance', 'deesser', 'hum', 'comp', 'duck'];

export default function CleanVoiceControls({ cv, onChange, project, dispatch, clipId }) {
  const t = useT();
  const cur = cv || {};
  const steps = cur.steps || {};
  const setSteps = (patch) => onChange({ ...cur, on: true, steps: { ...steps, ...patch } });
  const turnOn = () => onChange({ on: true, steps: { enhance: true, deesser: true, hum: true, comp: true, duck: true } });
  const duckOn = cur.on && steps.duck !== false;
  const { duckTo, duckRamp } = duckSettingsOf(cur);
  const baked = (project?.audioClips || []).some((c) => c.duckBaked?.voiceId === clipId);
  const bake = () => {
    if (!project || !dispatch || !clipId) return;
    const spans = duckSpansFor(project.videoClips, project.audioClips,
      (id) => videoLayout(project.videoClips).find((l) => l.clip.id === id)?.start ?? NaN)
      .filter((s) => s.id === clipId);
    const updates = [];
    for (const m of project.audioClips || []) {
      if (m.muted || m.id === clipId) continue;
      const bakedKeys = bakeDuckKeys(m, spans);
      if (!bakedKeys) continue;
      updates.push({ track: 'audio', id: m.id, patch: { volKeys: bakedKeys.volKeys, duckBaked: { voiceId: clipId, times: bakedKeys.times } } });
    }
    if (updates.length) dispatch({ type: 'updateMany', updates });
  };
  const unbake = () => {
    if (!project || !dispatch || !clipId) return;
    const updates = [];
    for (const m of project.audioClips || []) {
      if (!m.duckBaked || m.duckBaked.voiceId !== clipId) continue;
      const times = new Set((m.duckBaked.times || []).map((x) => Math.round(x * 1000) / 1000));
      updates.push({ track: 'audio', id: m.id, patch: { volKeys: (m.volKeys || []).filter((p) => !times.has(Math.round(p.t * 1000) / 1000)), duckBaked: null } });
    }
    if (updates.length) dispatch({ type: 'updateMany', updates });
  };
  return (
    <div className="afx">
      <label className="field row">
        <span>{t('cv.title')}</span>
        <KitToggle checked={!!cur.on} aria-label={t('cv.title')}
          onChange={(e) => (e.target.checked ? turnOn() : onChange({ ...cur, on: false }))} />
      </label>
      {cur.on && (
        <>
          {STEPS.map((id) => (
            <div key={id} className="afx-row">
              <span className="afx-label">{t('cv.step.' + id)}</span>
              <span className="afx-ctl">
                <KitToggle checked={steps[id] !== false} aria-label={t('cv.step.' + id)}
                  onChange={(e) => setSteps({ [id]: e.target.checked })} />
              </span>
              <span className="dim small">{t('cv.desc.' + id)}</span>
            </div>
          ))}
          {duckOn && (
            <>
              <Slider label={t('cv.duckDepth')} value={duckTo} min={0.05} max={1} step={0.01} numScale={100}
                fmt={(v) => `${Math.round(v * 100)}%`} dispatch={dispatch}
                onChange={(v) => onChange({ ...cur, duckTo: v })} />
              <Slider label={t('cv.duckRamp')} value={duckRamp} min={0.02} max={1} step={0.01}
                fmt={(v) => `${v.toFixed(2)}s`} dispatch={dispatch}
                onChange={(v) => onChange({ ...cur, duckRamp: v })} />
              {project && dispatch && clipId && (
                <div className="afx-row">
                  <span className="afx-label">{t('cv.bake')}</span>
                  <span className="afx-ctl">
                    {baked
                      ? <button type="button" className="btn btn-sm" onClick={unbake}>{t('cv.unbake')}</button>
                      : <button type="button" className="btn btn-sm" onClick={bake}>{t('cv.bakeBtn')}</button>}
                  </span>
                  <span className="dim small">{baked ? t('cv.bakedNote') : t('cv.bakeNote')}</span>
                </div>
              )}
            </>
          )}
          <div className="afx-note">{t('cv.note')}</div>
        </>
      )}
      {!cur.on && <div className="afx-note">{t('cv.offNote')}</div>}
    </div>
  );
}
