import React, { useState } from 'react';
import { CurvesPanel, HslPanel } from './HslCurves.jsx';
import NumBox from './NumBox.jsx';
import { coarseRangeKeyDown } from './Slider.jsx';
import Scopes from './Scopes.jsx';
import { Loader2, RotateCcw, Wand2 } from '../icons.jsx';
import { autoGrade } from '../fx/autocolor.js';
import { frameStats, matchGrade } from '../fx/shotmatch.js';
import { skinOf } from '../fx/skin.js';
import { DEFAULT_ADJUST } from '../effects.js';
import { DEFAULT_GRADE, GRADE_GROUPS } from '../fx/grade.js';
import { BUNDLED_LUTS, LUT_CREDIT_URL, loadLut, lutKey } from '../fx/lut.js';
import { gradeToCube } from '../fx/lutExport.js';
import { colourSpaceLabel, colourAction } from '../colour.js';
import { useT, tr } from '../i18n/index.jsx';
import { libName } from '../i18n/libNames.js';

// One grade row: name, a slider (colored track for Temp / Tint / Saturation), a number box.
// This is the panel's ONE row pattern (P5): every parameter — the grade groups,
// the LUT intensity, and the older Hue / Blur / classic settings in "Other" —
// renders as slider + NumBox. item.step / item.suffix / item.reset adapt it to
// non-integer settings (defaults: step 1, no suffix, double-click resets to 0).
function Row({ item, value, onChange, dispatch }) {
  const step = item.step ?? 1;
  const pct = ((value - item.min) / (item.max - item.min)) * 100;
  const norm = (v) => Number((Math.round(v / step) * step).toFixed(4));
  return (
    <div className="grade-row">
      <div className="grade-top">
        <span>{item.name}</span>
        <NumBox className="grade-numbox" ariaLabel={tr('grade.valueAria', { name: item.name })} step={step} suffix={item.suffix} min={item.min} max={item.max} value={value}
          onChange={(v) => onChange(norm(v))}
          onDragStart={() => dispatch?.({ type: 'beginGesture' })} onDragEnd={() => dispatch?.({ type: 'endGesture' })} />
      </div>
      <input type="range" className={`grade-range ${item.track ? 'colored' : ''}`} min={item.min} max={item.max} step={step} value={value}
        aria-label={item.name} style={{ '--track': item.track || `linear-gradient(90deg, var(--primary) ${pct}%, var(--surface-4) ${pct}%)` }}
        onPointerDown={() => dispatch?.({ type: 'beginGesture' })} onPointerUp={() => dispatch?.({ type: 'endGesture' })}
        onKeyDown={(e) => coarseRangeKeyDown(e, { value, min: item.min, max: item.max, step, onChange: (v) => onChange(norm(v)), dispatch })}
        onDoubleClick={() => onChange(item.reset ?? 0)} onChange={(e) => onChange(norm(Number(e.target.value)))} />
    </div>
  );
}

// LUT: a bundled look or the user's own .cube file, with an intensity.
function LutSection({ lut, onChange, dispatch, lutDuplicate }) {
  const [error, setError] = React.useState('');
  const [imported, setImported] = React.useState([]);
  const current = lut && lut.ref ? lutKey(lut.ref) : '';
  const own = [...imported, ...(lut?.ref?.path && !imported.some((x) => x.path === lut.ref.path) ? [{ path: lut.ref.path, name: lut.name }] : [])];
  const pick = async (ref, name) => {
    setError('');
    if (!ref) return onChange(null);
    const res = await loadLut(ref);
    if (res.error) return setError(res.error);
    onChange({ ref, name, intensity: lut?.intensity ?? 100 });
  };
  const choose = (key) => {
    if (key === '') return pick(null);
    const b = BUNDLED_LUTS.find((x) => lutKey(x.ref) === key);
    if (b) return pick(b.ref, b.name);
    const o = own.find((x) => `p:${x.path}` === key);
    if (o) return pick({ path: o.path }, o.name);
    return null;
  };
  const importOne = async () => {
    const f = await window.api.importLut();
    if (!f) return;
    setImported((l) => [...l.filter((x) => x.path !== f.path), f]);
    pick({ path: f.path }, f.name);
  };
  const k = lut?.intensity ?? 100;
  return (
    <section className="grade-group">
      <div className="grade-title">LUT</div>
      <div className="lut-row">
        <select value={current} aria-label="LUT" onChange={(e) => choose(e.target.value)}>
          <option value="">{tr('el.none')}</option>
          <optgroup label="Cutflow">
            {BUNDLED_LUTS.filter((b) => !b.credit).map((b) => <option key={b.file} value={lutKey(b.ref)}>{libName('lut', b.file.replace(/\.cube$/, ''), b.name)}</option>)}
          </optgroup>
          <optgroup label="slay">
            {BUNDLED_LUTS.filter((b) => b.credit).map((b) => <option key={b.file} value={lutKey(b.ref)}>{libName('lut', b.file.replace(/\.cube$/, ''), b.name)}</option>)}
          </optgroup>
          {own.length > 0 && (
            <optgroup label={tr('grade.imported')}>
              {own.map((o) => <option key={o.path} value={`p:${o.path}`}>{o.name}</option>)}
            </optgroup>
          )}
        </select>
        <button className="btn btn-sm" onClick={importOne} title={tr('grade.importCubeTitle')}>{tr('grade.importCube')}</button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {current && (
        <div className="grade-row">
          <div className="grade-top">
            <span>{tr('fx.intensity')}</span>
            <NumBox className="grade-numbox" ariaLabel={tr('grade.lutIntensityValue')} step={1} min={0} max={100} value={k}
              onChange={(v) => onChange({ ...lut, intensity: Math.round(v) })}
              onDragStart={() => dispatch?.({ type: 'beginGesture' })} onDragEnd={() => dispatch?.({ type: 'endGesture' })} />
          </div>
          <input type="range" className="grade-range" min="0" max="100" step="1" value={k} aria-label={tr('grade.lutIntensity')}
            style={{ '--track': `linear-gradient(90deg, var(--primary) ${k}%, var(--surface-4) ${k}%)` }}
            onPointerDown={() => dispatch?.({ type: 'beginGesture' })} onPointerUp={() => dispatch?.({ type: 'endGesture' })}
            onKeyDown={(e) => coarseRangeKeyDown(e, { value: k, min: 0, max: 100, step: 1, onChange: (v) => onChange({ ...lut, intensity: Math.round(v) }), dispatch })}
            onChange={(e) => onChange({ ...lut, intensity: Number(e.target.value) })} />
        </div>
      )}
      {current && lutDuplicate && <p className="dim small">{tr('grade.lutDuplicate')}</p>}
      {lut?.ref?.bundled && BUNDLED_LUTS.find((b) => b.file === lut.ref.bundled)?.credit && (
        <p className="dim small">{tr('grade.lutBy1')}<button className="link-inline" type="button" onClick={() => window.api.openHelp(LUT_CREDIT_URL)}>slay</button>{tr('grade.lutBy2')}</p>
      )}
    </section>
  );
}

// Adjust > Basic: Color, Lightness and Effects, plus the older Hue / Blur settings.
// grade / adjust: the clip's values; onGrade / onAdjust get the whole new object.
// autoFrom: { media, clip } of the clip, for the Auto button (left out where there is no single clip).
// shotMatch: { refs: [{ id, name, media, clip }] } — other picture clips to match this clip to (P2-19).
export default function GradePanel({ grade = {}, adjust = {}, onGrade, onAdjust, dispatch, onApplyAll, autoFrom, lutDuplicate, shotMatch }) {
  const t = useT();
  const [tab, setTab] = useState('basic');
  const [auto, setAuto] = useState(null); // 'busy' | { error }
  const [match, setMatch] = useState(null); // 'busy' | { error } | { patch }
  const [matchRef, setMatchRef] = useState('');
  const [lutNote, setLutNote] = useState('');
  // LUT export (spec matrix): bake the current grade sliders into a .cube file
  // (17^3) with the same pointwise math the preview/export grade uses. HSL,
  // sharpen, clarity, vignette and particles are NOT baked — see lutExport.js.
  const exportLut = async () => {
    const res = await window.api.saveTextFile({
      title: 'Export grade as LUT',
      defaultName: 'grade.cube',
      content: gradeToCube(g),
      filters: [{ name: '3D LUT (.cube)', extensions: ['cube'] }],
    });
    setLutNote(res?.ok ? `Saved to ${res.path}` : res?.error || '');
  };
  const g = { ...DEFAULT_GRADE, ...grade };
  const tabs = (
    <div className="seg-tabs small grade-tabs" role="tablist" aria-label={t('grade.adjust')}>
      {[['basic', t('grade.basic')], ['hsl', 'HSL'], ['curves', t('grade.curves')]].map(([id, name]) => (
        <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{name}</button>
      ))}
    </div>
  );
  const apply = onApplyAll && (
    <div className="grade-actions">
      <button className="btn btn-sm" onClick={onApplyAll} title={t('grade.applyAllTitle')}>{t('grade.applyAll')}</button>
    </div>
  );
  if (tab === 'hsl') {
    return <div className="grade">{tabs}<HslPanel hsl={g.hsl} dispatch={dispatch} onChange={(hsl) => onGrade({ ...g, hsl })} />{apply}</div>;
  }
  if (tab === 'curves') {
    return <div className="grade">{tabs}<CurvesPanel curves={g.curves} dispatch={dispatch} onChange={(curves) => onGrade({ ...g, curves })} />{apply}</div>;
  }
  const a = { ...DEFAULT_ADJUST, ...adjust };
  const changed = Object.values(grade).some((v) => Number(v)) || Object.keys(adjust).length > 0;
  // The first version's sliders: kept for projects that use them.
  const classic = [['brightness', t('grade.brightness'), -1, 1, 0.01], ['contrast', t('grade.contrastClassic'), 0, 2, 0.01], ['saturation', t('grade.saturationClassic'), 0, 3, 0.01]]
    .filter(([k]) => a[k] !== DEFAULT_ADJUST[k]);
  // Auto: reads a few frames of the clip and sets Temp, Tint, Exposure, Contrast, Highlight, Shadow and
  // Saturation (one undo step; the other sliders, HSL, curves and the LUT stay as they are).
  const m = autoFrom?.media;
  const canAuto = m && (m.type === 'video' || m.type === 'image');
  const runAuto = async () => {
    setAuto('busy');
    const c = autoFrom.clip;
    const res = await window.api.colorSample({ path: m.path, type: m.type, duration: m.duration, hdr: m.hdr }, c.in || 0, c.out ?? m.duration);
    if (res.error) return setAuto({ error: res.error });
    setAuto(null);
    onGrade({ ...g, ...autoGrade(res.frames) });
  };
  // Shot match (P2-19): sample the reference clip and this clip, compute the
  // Basic sliders that move this clip toward the reference, and apply them
  // (one undo step; HSL/curves/LUT stay as they are). Sampling reuses the
  // colorSample IPC the Auto button already uses.
  const refs = shotMatch?.refs || [];
  const runMatch = async () => {
    const ref = refs.find((r) => r.id === matchRef);
    if (!ref || !canAuto) return;
    setMatch('busy');
    const c = autoFrom.clip;
    const [refRes, srcRes] = await Promise.all([
      window.api.colorSample({ path: ref.media.path, type: ref.media.type, duration: ref.media.duration, hdr: ref.media.hdr }, ref.clip.in || 0, ref.clip.out ?? ref.media.duration),
      window.api.colorSample({ path: m.path, type: m.type, duration: m.duration, hdr: m.hdr }, c.in || 0, c.out ?? m.duration),
    ]);
    if (refRes.error || srcRes.error) return setMatch({ error: refRes.error || srcRes.error });
    const patch = matchGrade(frameStats(refRes.frames), frameStats(srcRes.frames));
    if (!patch) return setMatch({ error: t('grade.matchNoFrames') });
    setMatch({ patch });
    onGrade({ ...g, ...patch });
  };
  // Skin (P2-19): the orange HSL band, exposed as skin-tone sliders — the
  // same grade engine the preview and export share, so it cannot diverge.
  const skin = skinOf(g);
  const setSkin = (key, v) => {
    const o = { ...(g.hsl?.orange || {}), [key]: v };
    onGrade({ ...g, hsl: { ...(g.hsl || {}), orange: o } });
  };
  return (
    <div className="grade">
      {tabs}
      {(() => {
        const label = colourSpaceLabel(autoFrom?.media);
        if (!label) return null;
        const action = colourAction(autoFrom.media) === 'tonemap' ? t('grade.sourceTonemap') : t('grade.sourceConvert');
        return <p className="dim small">{t('grade.sourceColour', { label, action })}</p>;
      })()}
      {canAuto && (
        <div className="grade-auto">
          <button className="btn btn-sm btn-primary" onClick={runAuto} disabled={auto === 'busy'}
            title={t('grade.autoTitle')}>
            {auto === 'busy' ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} {t('grade.auto')}
          </button>
          {auto?.error && <span className="error-text small">{auto.error}</span>}
        </div>
      )}
      {refs.length > 0 && canAuto && (
        <section className="grade-group">
          <div className="grade-title">{t('grade.matchTitle')}</div>
          <div className="grade-match">
            <select value={matchRef} onChange={(e) => setMatchRef(e.target.value)} aria-label={t('grade.matchRefAria')}>
              <option value="">{t('grade.matchPick')}</option>
              {refs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <button className="btn btn-sm" disabled={!matchRef || match === 'busy'} onClick={runMatch}>
              {match === 'busy' ? <Loader2 size={14} className="spin" /> : null} {t('grade.match')}
            </button>
          </div>
          {match?.error && <span className="error-text small">{match.error}</span>}
          {match?.patch && <p className="dim small">{t('grade.matchDone', { patch: Object.entries(match.patch).filter(([, v]) => v).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ') || '0' })}</p>}
          <p className="dim small">{t('grade.matchNote')}</p>
        </section>
      )}
      <section className="grade-group">
        <div className="grade-title">{t('grade.skinTitle')}</div>
        <Row item={{ id: 'skinSat', name: t('grade.skinSat'), min: -100, max: 100 }} value={skin.saturation} dispatch={dispatch} onChange={(v) => setSkin('s', v)} />
        <Row item={{ id: 'skinHue', name: t('grade.skinHue'), min: -100, max: 100 }} value={skin.hue} dispatch={dispatch} onChange={(v) => setSkin('h', v)} />
        <Row item={{ id: 'skinLight', name: t('grade.skinLight'), min: -100, max: 100 }} value={skin.lightness} dispatch={dispatch} onChange={(v) => setSkin('l', v)} />
        <p className="dim small">{t('grade.skinNote')}</p>
      </section>
      <div className="grade-actions">
        <button className="btn btn-ghost btn-sm" disabled={!changed} onClick={() => { onGrade({ hsl: g.hsl, curves: g.curves }); onAdjust({}); }}><RotateCcw size={13} /> {t('hsl.resetAll')}</button>
        {onApplyAll && <button className="btn btn-sm" onClick={onApplyAll} title={t('grade.applyAllTitle2')}>{t('grade.applyAll')}</button>}
      </div>
      <LutSection lut={g.lut} dispatch={dispatch} lutDuplicate={lutDuplicate} onChange={(lut) => onGrade({ ...g, lut })} />
      <div className="grade-actions">
        <button className="btn btn-sm" onClick={exportLut} title="Save the current grade sliders as a .cube LUT file">Export grade as .cube</button>
        {lutNote && <span className="dim small">{lutNote}</span>}
      </div>
      <div className="grade-group">
        <div className="grade-group-title">{t('grade.scopes')}</div>
        <Scopes />
      </div>
      {GRADE_GROUPS.map((group) => (
        <section key={group.name} className="grade-group">
          <div className="grade-title">{t('grade.g.' + group.name.toLowerCase())}</div>
          {group.items.map((item) => (
            <Row key={item.id} item={{ ...item, name: t('grade.p.' + item.id) }} value={g[item.id]} dispatch={dispatch} onChange={(v) => onGrade({ ...g, [item.id]: v })} />
          ))}
        </section>
      ))}
      <section className="grade-group">
        <div className="grade-title">{t('grade.other')}</div>
        {[['hue', t('grade.hue'), -180, 180, 1, '°'], ['blur', t('grade.blur'), 0, 20, 0.5], ...classic].map(([k, name, min, max, step, suffix]) => (
          <Row key={k} item={{ id: k, name, min, max, step, suffix, reset: DEFAULT_ADJUST[k] }}
            value={a[k]} dispatch={dispatch} onChange={(v) => onAdjust({ ...a, [k]: v })} />
        ))}
      </section>
      <p className="dim small">{t('grade.dblClick')}</p>
    </div>
  );
}
