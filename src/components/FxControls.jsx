import React from 'react';
import { tr, useT } from '../i18n/index.jsx';
import { libName } from '../i18n/libNames.js';
import { fxTimingOf, withFxTiming } from '../store.js';
import { fxSchema, fxDefaults } from '../fx/params.js';
import { clipLenTl } from '../track.js';
import Slider from './Slider.jsx';
import NumBox from './NumBox.jsx';
import Toggle from '../ui/Toggle.jsx';
import { InspCard } from '../ui/Section.jsx';

// Effect-instance controls, shared by the two surfaces that manage an effect:
// the Effects-lane effect panel (Inspector.jsx) and, since R3, the selected
// clip's own inspector (ClipInspector.jsx "Effects" section) — one
// implementation, so a strength/region/timing edit behaves identically
// wherever it is made. All writes go through the same store actions the
// Effects lane has always used; nothing here owns value semantics.

// ---- Effect region: confine an effect to one area of the frame ----
// Stored per effect instance: on the effect clip itself (region) for Effects-track effects,
// or in the clip's fxRegions map for effects attached to a clip. The renderer applies it as
// mix(original, effected, regionMask) for shader effects (src/fx/apply.js) and as a masked
// layer for particle/light effects, so the same controls serve every effect in the catalog.
export const DEFAULT_FX_REGION = { x: 0.3, y: 0.3, w: 0.4, h: 0.4, feather: 0.05, shape: 'rect', invert: false };

export function RegionControls({ region, onChange, dispatch }) {
  const on = !!region;
  const r = region || DEFAULT_FX_REGION;
  const set = (p) => onChange({ ...r, ...p });
  const pct = (v) => `${Math.round(v * 100)}%`;
  const S = (p) => <Slider dispatch={dispatch} {...p} />;
  return (
    <InspCard id="fx:region" title={tr('fx.region')}
      right={<Toggle checked={on} aria-label={tr('fx.limitRegion')}
        onChange={(e) => onChange(e.target.checked ? { ...DEFAULT_FX_REGION } : null)} />}>
      {!on && <p className="dim small">{tr('fx.regionNote')}</p>}
      {on && (
        <>
          <div className="chips">
            {[['rect', tr('fx.shape.rect')], ['ellipse', tr('fx.shape.ellipse')]].map(([id, name]) => (
              <button key={id} className={`chip ${r.shape === id ? 'on' : ''}`} onClick={() => set({ shape: id })}>{name}</button>
            ))}
            <button className={`chip ${r.invert ? 'on' : ''}`} aria-pressed={!!r.invert} onClick={() => set({ invert: !r.invert })}>{tr('fx.invert')}</button>
          </div>
          {S({ label: tr('fx.posX'), value: r.x, min: 0, max: 0.95, step: 0.01, fmt: pct, numScale: 100, onChange: (x) => set({ x }) })}
          {S({ label: tr('fx.posY'), value: r.y, min: 0, max: 0.95, step: 0.01, fmt: pct, numScale: 100, onChange: (y) => set({ y }) })}
          {S({ label: tr('fx.width'), value: r.w, min: 0.05, max: 1, step: 0.01, fmt: pct, numScale: 100, onChange: (w) => set({ w }) })}
          {S({ label: tr('fx.height'), value: r.h, min: 0.05, max: 1, step: 0.01, fmt: pct, numScale: 100, onChange: (h) => set({ h }) })}
          {S({ label: tr('fx.feather'), value: r.feather, min: 0, max: 0.3, step: 0.01, fmt: pct, numScale: 100, onChange: (feather) => set({ feather }) })}
          <p className="dim small">{tr('fx.regionNote2')}</p>
        </>
      )}
    </InspCard>
  );
}

// ---- Effect strength: how strongly an effect instance lands (0..1, absent = 1) ----
// Shader effects take it as a mix with the untouched picture and particle layers as
// opacity (src/fx/apply.js); a classic effect on a clip is routed through its shader
// form as soon as the strength drops below 1. Mirror and Flip are geometric — they
// have no in-between — so they get no strength control.
export const NO_STRENGTH = ['mirror', 'flipv'];
export function StrengthControl({ value, onChange, dispatch }) {
  const pct = (v) => `${Math.round(v * 100)}%`;
  const S = (p) => <Slider dispatch={dispatch} {...p} />;
  return (
    <InspCard id="fx:strength" title={tr('fx.strength')}>
      {S({ label: tr('fx.intensity'), value: value ?? 1, min: 0, max: 1, step: 0.01, fmt: pct, numScale: 100, onChange })}
      <p className="dim small">{tr('fx.intensityNote')}</p>
    </InspCard>
  );
}

// ---- Effect parameters: the effect's own knobs, driven by its §5 schema ----
// The schema (src/fx/params.js) declares each parameter's key, label, range,
// default and step; this card is generated from it — there is no per-effect UI
// code. Values are stored sparsely: only values that differ from the default
// land on the instance (clip.fxParams / effect clip .params), so an untouched
// parameter costs nothing and renders exactly as the effect always has.
export function ParamsControls({ fx, values, onParam, dispatch }) {
  const schema = fxSchema(fx);
  if (!schema) return null;
  const defs = fxDefaults(fx);
  const vals = { ...defs, ...(values || {}) };
  const pct = (v) => `${Math.round(v * 100)}%`;
  const S = (p) => <Slider dispatch={dispatch} {...p} />;
  return (
    <InspCard id="fx:params" title={tr('fx.parameters')}>
      {schema.map((p) => S({
        key: p.key, label: libName('fxparam', fx + '.' + p.key, p.name), value: vals[p.key], min: p.min, max: p.max, step: p.step,
        ...(p.fmt === 'pct' ? { fmt: pct, numScale: 100 } : {}),
        onChange: (v) => onParam(p.key, v),
      }))}
      <p className="dim small">{tr('fx.tunesNote')}</p>
    </InspCard>
  );
}

// Prune an instance's parameter map after one value changes: keys sitting at
// their default are dropped, and an all-default map disappears entirely.
export function prunedParams(fx, current, key, value) {
  const defs = fxDefaults(fx);
  const next = { ...defs, ...(current || {}), [key]: value };
  for (const k of Object.keys(next)) if (next[k] === defs[k]) delete next[k];
  return next;
}

// The cards for one effect bound to a clip (clip.effects): timing window,
// strength, parameters and region, stored in the clip's fxTiming / fxStrength /
// fxParams / fxRegions maps — the same writes the Effects-lane panel has always made.
export function BoundFxCards({ track, clip, fx, dispatch }) {
  const setRegion = (region) => {
    const next = { ...(clip.fxRegions || {}) };
    if (region) next[fx] = region; else delete next[fx];
    dispatch({ type: 'update', track, id: clip.id, patch: { fxRegions: next } });
  };
  const setStrength = (k) => {
    const next = { ...(clip.fxStrength || {}) };
    if (k == null || k >= 1) delete next[fx]; else next[fx] = k;
    dispatch({ type: 'update', track, id: clip.id, patch: { fxStrength: next } });
  };
  // Timing storage likewise: the clip's fxTiming map (absent = the whole clip), in
  // clip-local seconds — the same window the effect's bar trims on the Effects lane.
  const span = clipLenTl(track, clip);
  const win = fxTimingOf(clip, fx) || { start: 0, duration: span };
  const setTiming = (p) => {
    const start = Math.min(Math.max(0, p.start ?? win.start), Math.max(0, span - 0.1));
    const duration = Math.min(Math.max(0.1, p.duration ?? win.duration), Math.max(0.1, span - start));
    dispatch({ type: 'update', track, id: clip.id, patch: { fxTiming: withFxTiming(clip, fx, { start, duration }, span) } });
  };
  return (
    <>
      <InspCard id="fx:timing" title={tr('fx.timing')}>
        <p className="dim small">{fxTimingOf(clip, fx)
          ? tr('fx.partNote')
          : tr('fx.wholeNote')}</p>
        <NumBox layout="field" label={tr('fx.startInClip')} value={win.start} step={0.1} min={0} onChange={(start) => setTiming({ start })} />
        <NumBox layout="field" label={tr('fx.windowDuration')} value={win.duration} step={0.1} min={0.1} onChange={(duration) => setTiming({ duration })} />
      </InspCard>
      {!NO_STRENGTH.includes(fx) && <StrengthControl value={clip.fxStrength?.[fx]} dispatch={dispatch} onChange={setStrength} />}
      <ParamsControls fx={fx} values={clip.fxParams?.[fx]} dispatch={dispatch}
        onParam={(key, v) => {
          const next = { ...(clip.fxParams || {}) };
          const pruned = prunedParams(fx, clip.fxParams?.[fx], key, v);
          if (Object.keys(pruned).length) next[fx] = pruned; else delete next[fx];
          dispatch({ type: 'update', track, id: clip.id, patch: { fxParams: next } });
        }} />
      <RegionControls region={clip.fxRegions?.[fx] || null} dispatch={dispatch} onChange={setRegion} />
    </>
  );
}
