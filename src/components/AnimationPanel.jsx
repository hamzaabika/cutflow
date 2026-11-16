import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/index.jsx';
import { libName, slugifyPhrase } from '../i18n/libNames.js';
import { Ban } from '../icons.jsx';
import { ANIMATIONS, DEFAULT_ANIM_DURATION, animOf, previewState } from '../anim.js';
import { MOTION_PRESETS, PREMIUM_MOVEMENT_PACK, applyMotionPreset, clearMotionPreset } from '../fx/motionPresets.js';
import { samplePhotoUrl, samplePictureUrl } from '../fx/previews.jsx';
import Slider from './Slider.jsx';

const KINDS = [['in', 'In'], ['out', 'Out'], ['combo', 'Combo']];

// Tile picture: the sample photo moving like the animation, playing while the pointer is over the tile.
export function AnimThumb({ kind, id }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const show = (st) => {
      el.style.transform = `translate(${st.x * 100}%, ${st.y * 100}%) rotate(${st.r}deg) scale(${st.s})`;
      el.style.opacity = String(st.o);
    };
    const still = () => show(previewState(kind, id, kind === 'combo' ? 0.15 : 0.6));
    still();
    const tile = el.closest('.tile') || el;
    let raf = 0;
    const play = () => {
      const t0 = performance.now();
      const loop = () => {
        const s = (performance.now() - t0) / 1000;
        // In / Out: play the move in 0.8 s, then hold half a second. Combo: loops.
        const p = kind === 'combo' ? (s % 2.4) / 2.4 : Math.min(1, (s % 1.3) / 0.8);
        show(previewState(kind, id, p));
        raf = requestAnimationFrame(loop);
      };
      cancelAnimationFrame(raf);
      loop();
    };
    const stop = () => { cancelAnimationFrame(raf); still(); };
    tile.addEventListener('pointerenter', play);
    tile.addEventListener('pointerleave', stop);
    return () => {
      cancelAnimationFrame(raf);
      tile.removeEventListener('pointerenter', play);
      tile.removeEventListener('pointerleave', stop);
    };
  }, [kind, id]);
  return (
    <span className="anim-stage">
      <img ref={ref} src={samplePhotoUrl(id)} onError={(e) => { e.currentTarget.src = samplePictureUrl(); }} alt="" draggable={false} />
    </span>
  );
}

// Clip panel > Animation: In, Out and Combo animations. A Combo replaces In and Out.
export default function AnimationPanel({ clip, len, set, dispatch }) {
  const t = useT();
  const current = animOf(clip, len);
  const [kind, setKind] = useState(current.combo ? 'combo' : current.out && !current.in ? 'out' : 'in');
  const chosen = clip.anim?.[kind]?.type || null;
  const pick = (id) => {
    const a = { ...(clip.anim || {}) };
    if (!id) delete a[kind];
    else if (kind === 'combo') {
      delete a.in;
      delete a.out;
      a.combo = { type: id };
    } else {
      delete a.combo;
      a[kind] = { type: id, duration: a[kind]?.duration ?? Math.min(DEFAULT_ANIM_DURATION, len / 2) };
    }
    set({ anim: a });
  };
  const cats = [...new Set(ANIMATIONS[kind].map((a) => a.cat))];
  const dur = current[kind]?.duration;
  // P2-18 motion presets: normalised keyframe recipes (rate-independent) plus
  // the handheld combo. A preset writes real keyframes, so the Keyframe Graph
  // and the transform sliders stay the handles for tweaking it.
  const activePreset = clip.motionPreset || null;
  const applyPreset = (id) => {
    const patch = applyMotionPreset(clip, id);
    if (patch) set(patch);
  };
  const removePreset = () => {
    const patch = clearMotionPreset(clip);
    if (patch) set(patch);
  };
  const presetGroups = [
    { title: t('anim.motionCore'), presets: MOTION_PRESETS.filter((p) => p.pack === 'core') },
    { title: PREMIUM_MOVEMENT_PACK.name, presets: MOTION_PRESETS.filter((p) => p.pack === 'premium-movement') },
  ];
  return (
    <div className="anim-panel">
      <div className="anim-cat">
        <div className="anim-cat-title">{t('anim.motionPresets')}</div>
        <p className="dim small">{t('anim.motionPresetsNote')}</p>
        {presetGroups.map((g) => (
          <div key={g.title} className="anim-cat">
            <div className="anim-cat-title">{g.title}</div>
            <div className="anim-grid">
              {g.presets.map((p) => (
                <button key={p.id} className={`tile ${activePreset === p.id ? 'on' : ''}`} aria-pressed={activePreset === p.id}
                  title={libName('motion', p.id, p.name)} onClick={() => applyPreset(p.id)}>
                  <span className="tile-label">{libName('motion', p.id, p.name)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {activePreset && (
          <button className="btn btn-sm" onClick={removePreset}>{t('anim.motionRemove')}</button>
        )}
        <label className="field check">
          <input type="checkbox" checked={!!clip.motionBlur} disabled={!activePreset}
            onChange={(e) => set({ motionBlur: e.target.checked })} />
          <span>{t('anim.motionBlur')}</span>
        </label>
        <p className="dim small">{t('anim.motionBlurNote')}</p>
      </div>
      <div className="seg-tabs small" role="tablist" aria-label={t('anim.type')}>
        {KINDS.map(([id, name]) => (
          <button key={id} role="tab" aria-selected={kind === id} className={kind === id ? 'on' : ''} onClick={() => setKind(id)}>
            {t('anim.kind.' + id)}{clip.anim?.[id] ? ' •' : ''}
          </button>
        ))}
      </div>
      <p className="dim small">
        {t(kind === 'in' ? 'anim.inNote' : kind === 'out' ? 'anim.outNote' : 'anim.loopNote')}
        {' '}{t('anim.hoverPreview')}
      </p>
      {clip.adaptReport && (clip.adaptReport.scaled?.length || clip.adaptReport.unhandled?.length) ? (
        <div className="adapt-report" role="status">
          {clip.adaptReport.scaled?.map((e, i) => (<div key={i} className="dim small">{t('prim.adapted', { line: t(e.key, e.params || {}) })}</div>))}
          {clip.adaptReport.unhandled?.map((e, i) => (<div key={i} className="dim small">{t('prim.adaptUnhandled', { line: t(e.key, e.params || {}) })}</div>))}
        </div>
      ) : null}
      <div className="anim-grid">
        <button className={`tile ${!chosen ? 'on' : ''}`} aria-pressed={!chosen} onClick={() => pick(null)}>
          <span className="tile-preview anim-none"><Ban size={22} /></span>
          <span className="tile-label">{t('el.none')}</span>
        </button>
      </div>
      {cats.map((cat) => (
        <div key={cat} className="anim-cat">
          <div className="anim-cat-title">{libName('cat', slugifyPhrase(cat), cat)}</div>
          <div className="anim-grid">
            {ANIMATIONS[kind].filter((a) => a.cat === cat).map((a) => (
              <button key={a.id} className={`tile ${chosen === a.id ? 'on' : ''}`} aria-pressed={chosen === a.id} title={libName('canim', kind + '.' + a.id, a.name)} onClick={() => pick(a.id)}>
                <span className="tile-preview"><AnimThumb kind={kind} id={a.id} /></span>
                <span className="tile-label">{libName('canim', kind + '.' + a.id, a.name)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {chosen && kind !== 'combo' && Number.isFinite(dur) && (
        <Slider dispatch={dispatch} label={t('insp.duration')} value={dur} min={0.1} max={Math.max(0.2, Math.min(5, len))} step={0.1}
          fmt={(v) => `${v.toFixed(1)}s`} onChange={(d) => set({ anim: { ...clip.anim, [kind]: { ...clip.anim[kind], duration: d } } })} />
      )}
    </div>
  );
}
