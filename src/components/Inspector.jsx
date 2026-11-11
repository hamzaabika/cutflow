import React from 'react';
import { Blend, Film, FxGlyph, Layers, Music, RotateCcw, Settings2, Sparkles, Type, Sticker } from '../icons.jsx';
import { clipLen, formatTime, fxTimingOf, parseEffectKey, videoLayout } from '../store.js';
import { ANIMATIONS, EFFECTS, RATIOS, TRANSITIONS, sizeFor } from '../effects.js';
import Slider from './Slider.jsx';
import PanelHead from '../ui/PanelHead.jsx';
import { InspCard } from '../ui/Section.jsx';
import Dropdown from './Dropdown.jsx';
import CurveEditor from './CurveEditor.jsx';
import NumBox from './NumBox.jsx';
import { NO_STRENGTH, RegionControls, StrengthControl, BoundFxCards, ParamsControls, prunedParams } from './FxControls.jsx';
import BrandSwatches from './BrandSwatches.jsx';

export { DEFAULT_FX_REGION, RegionControls } from './FxControls.jsx';
import TextInspector from './TextInspector.jsx';
import ClipInspector, { PinToTrack } from './ClipInspector.jsx';
import AudioFxControls from './AudioFx.jsx';
import { hasAudioFx } from '../fx/audioFxChain.js';
import { audioFxPathOf } from '../fx/audioFxPreview.js';
import EnhanceVoice from './EnhanceVoice.jsx';
import VolKeyEditor from './VolKeyEditor.jsx';
import { isLookPatch, lookAction, selectedPictures } from '../look.js';
import { clipLenTl, clipStartTl } from '../track.js';
import { useT } from '../i18n/index.jsx';
import { libName } from '../i18n/libNames.js';

function Num({ label, value, onChange, step = 0.1, min, max }) {
  return <NumBox layout="field" label={label} value={value} step={step} min={min} max={max} onChange={onChange} />;
}

const pct = (v) => `${Math.round(v * 100)}%`;

function ProjectDetails({ project, dispatch, duration }) {
  const t = useT();
  const set = (patch) => dispatch({ type: 'setProject', patch });
  const setFormat = (ratio, resolution) => set({ ratio, resolution, ratioLocked: project.ratioLocked || ratio !== project.ratio, ...sizeFor(ratio, resolution) });
  const RESOLUTIONS = [{ id: '480', name: '480p' }, { id: '720', name: t('insp.res720') }, { id: '1080', name: t('insp.res1080') }, { id: '1440', name: t('insp.res1440') }, { id: '2160', name: t('insp.res2160') }];
  // Export quality is NOT set here (Hamza's screenshot review, 2026-11-10): it
  // is chosen at export time, in the Export dialog — whose Quality preset +
  // Custom controls write the same stored settings (src/exportQuality.js) the
  // pipeline resolves, so nothing about the export itself changed when the
  // duplicated section left Project Settings.
  return (
    <div className="fields proj-card">
      <input className="proj-name" type="text" value={project.name} aria-label={t('insp.projectName')}
        onChange={(e) => set({ name: e.target.value })} />
      <div className="proj-group">
        <span className="proj-label">{t('insp.aspectRatio')}</span>
        <div className="proj-ratios" role="radiogroup" aria-label={t('insp.aspectRatio')}>
          {Object.keys(RATIOS).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={project.ratio === r}
              className={`proj-ratio ${project.ratio === r ? 'on' : ''}`} onClick={() => setFormat(r, project.resolution)}>
              <span className="proj-ratio-stage"><span className="proj-ratio-shape" style={{ aspectRatio: r.replace(':', ' / ') }} /></span>
              <span className="proj-ratio-name">{r}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="proj-group">
        <span className="proj-label">{t('insp.resolution')}</span>
        <div className="proj-seg proj-grid3" role="radiogroup" aria-label={t('insp.resolution')}>
          {RESOLUTIONS.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={String(project.resolution) === o.id}
              className={String(project.resolution) === o.id ? 'on' : ''} onClick={() => setFormat(project.ratio, Number(o.id))}>{o.name}</button>
          ))}
        </div>
      </div>
      <div className="proj-group">
        <span className="proj-label">{t('insp.frameRate')}</span>
        <div className="proj-seg proj-grid5" role="radiogroup" aria-label={t('insp.frameRate')}>
          {[24, 25, 30, 50, 60].map((f) => (
            <button key={f} type="button" role="radio" aria-checked={project.fps === f}
              className={project.fps === f ? 'on' : ''} onClick={() => set({ fps: f })}>{f} {t('player.fpsUnit')}</button>
          ))}
        </div>
      </div>
      <label className="field row proj-bg">
        <span>{t('insp.background')}</span>
        <input type="color" value={project.background} onChange={(e) => set({ background: e.target.value })} />
      </label>
      <BrandSwatches onPick={(c) => set({ background: c })} />
      <div className="proj-stats">
        <span><bdi dir="ltr">{project.width}×{project.height}</bdi> · {formatTime(duration)}</span>
        <span>{t('insp.clipsStats', { v: project.videoClips.length, x: project.textClips.length, a: project.audioClips.length })}</span>
      </div>
    </div>
  );
}

// A selected transition (its marker on the timeline), the Transition panel.
function TransitionPanel({ project, selection, dispatch }) {
  const t = useT();
  const clips = project.videoClips;
  const i = clips.findIndex((c) => c.id === selection.id);
  const clip = clips[i];
  const tr = clip && clip.transition;
  if (!tr) return <div className="fields"><div className="info dim">{t('insp.transitionRemoved')}</div></div>;
  const def = TRANSITIONS.find((t) => t.id === tr.type);
  const set = (transition) => dispatch({ type: 'update', track: 'video', id: clip.id, patch: { transition } });
  // A transition can use at most half of each clip it joins.
  const max = Math.max(0.2, Math.min(clipLen(clip), clipLen(clips[i - 1])) / 2);
  const others = clips.filter((c, k) => k > 0 && !c.gap && !clips[k - 1].gap);
  const applyAll = () => {
    dispatch({ type: 'beginGesture' });
    for (const c of others) dispatch({ type: 'update', track: 'video', id: c.id, patch: { transition: { ...tr } } });
    dispatch({ type: 'endGesture' });
  };
  return (
    <div className="fields">
      <div className="fx-head"><span className="fx-icon"><Blend size={18} /></span>
        <div><b>{def ? libName('tr', def.id, def.name) : tr.type}</b><span className="dim">{t('insp.betweenClips', { a: i, b: i + 1 })}</span></div></div>
      <InspCard id="transition:main" title={t('insp.transition')}>
      <label className="field">
        <span>{t('insp.name')}</span>
        <Dropdown value={tr.type} ariaLabel={t('insp.transitionName')}
          options={TRANSITIONS.map((t) => ({ value: t.id, label: libName('tr', t.id, t.name) }))}
          onChange={(id) => {
            const t = TRANSITIONS.find((x) => x.id === id);
            set({ type: t.id, duration: Math.min(max, t.fx ? t.duration : tr.duration), ...(t.fx && /zoom/i.test(t.id) ? { ease: 'smooth' } : {}) });
          }} />
      </label>
      <Slider dispatch={dispatch} label={t('insp.duration')} value={Math.min(tr.duration, max)} min={0.1} max={Number(max.toFixed(2))} step={0.05}
        fmt={(v) => `${v.toFixed(2)}s`} onChange={(duration) => set({ ...tr, duration })} />
      </InspCard>
      <InspCard id="transition:curve" title={t('insp.motionCurve')}>
        {def?.fx ? (
          <CurveEditor value={tr.ease} onChange={(ease) => set(ease === undefined ? { type: tr.type, duration: tr.duration } : { ...tr, ease })} />
        ) : (
          <p className="dim small">{t('insp.curveNote')}</p>
        )}
      </InspCard>
      <div className="row-btns">
        <button className="btn btn-sm" onClick={() => set({ ...tr, duration: Math.min(max, def?.duration || 0.5) })}><RotateCcw size={13} /> {t('common.reset')}</button>
        <button className="btn btn-sm" onClick={applyAll} disabled={others.length < 2} title={t('insp.applyAllTitle')}>{t('insp.applyAll')}</button>
      </div>
      <button className="btn btn-danger" onClick={() => set(null)}>{t('insp.removeTransition')}</button>
    </div>
  );
}

// "Add text" card shared by both effect panels: puts a text clip over exactly the range the
// effect covers, via the app's single add-text path (App's onAddTextOver), which also selects
// the new clip so the text inspector opens ready to type.
function AddTextCard({ onAddTextOver, start, duration }) {
  const t = useT();
  if (!onAddTextOver) return null;
  return (
    <InspCard id="fx:add-text" title={t('insp.textCard')}>
      <p className="dim small">{t('insp.addTextNote')}</p>
      <button className="btn btn-primary" onClick={() => onAddTextOver(start, duration)}><Type size={14} /> {t('insp.addText')}</button>
    </InspCard>
  );
}

function FreeEffectPanel({ project, selection, dispatch, onAddTextOver = null }) {
  const t = useT();
  const c = (project.effectClips || []).find((x) => x.id === selection.id);
  if (!c) return <div className="fields"><div className="info dim">{t('insp.effectRemoved')}</div></div>;
  const e = EFFECTS.find((x) => x.id === c.fx);
  const set = (patch) => dispatch({ type: 'update', track: 'effect', id: c.id, patch });
  return (
    <div className="fields">
      <div className="fx-head"><span className="fx-icon"><FxGlyph group={e?.group} size={15} /></span><div><b>{e?.name || c.fx}</b><span className="dim">{t('insp.onEffectsTrack')}</span></div></div>
      <InspCard id="fxfree:timing" title={t('insp.timing')}>
      <p className="dim small">{t('insp.timingNote')}</p>
      <Num label={t('insp.startS')} value={c.start} min={0} onChange={(start) => set({ start: Math.max(0, start) })} />
      <Num label={t('insp.durationS')} value={c.duration} min={0.1} onChange={(d) => set({ duration: Math.max(0.1, d) })} />
      </InspCard>
      {!NO_STRENGTH.includes(c.fx) && <StrengthControl value={c.strength} dispatch={dispatch}
        onChange={(k) => set({ strength: k >= 1 ? undefined : k })} />}
      <ParamsControls fx={c.fx} values={c.params} dispatch={dispatch}
        onParam={(key, v) => { const pruned = prunedParams(c.fx, c.params, key, v); set({ params: Object.keys(pruned).length ? pruned : undefined }); }} />
      <RegionControls region={c.region || null} dispatch={dispatch}
        onChange={(region) => set({ region: region ?? undefined })} />
      <AddTextCard onAddTextOver={onAddTextOver} start={c.start} duration={c.duration} />
      <button className="btn btn-danger" onClick={() => dispatch({ type: 'delete', track: 'effect', id: c.id })}>{t('insp.removeEffect')}</button>
    </div>
  );
}

function EffectPanel({ project, selection, dispatch, onAddTextOver = null }) {
  const t = useT();
  if (!selection.id.includes('|')) return <FreeEffectPanel project={project} selection={selection} dispatch={dispatch} onAddTextOver={onAddTextOver} />;
  const { track, clipId, fx } = parseEffectKey(selection.id);
  const list = track === 'overlay' ? project.overlayClips || [] : project.videoClips;
  const clip = list.find((c) => c.id === clipId);
  const e = EFFECTS.find((x) => x.id === fx);
  const media = clip && project.media.find((m) => m.id === clip.mediaId);
  if (!clip || !(clip.effects || []).includes(fx)) return <div className="fields"><div className="info dim">This effect was removed.</div></div>;
  const span = clipLenTl(track, clip);
  const win = fxTimingOf(clip, fx) || { start: 0, duration: span };
  return (
    <div className="fields">
      <div className="fx-head"><span className="fx-icon"><FxGlyph group={e?.group} size={15} /></span><div><b>{e?.name || fx}</b><span className="dim">{t('insp.onClipName', { name: media?.name || 'clip' })}</span></div></div>
      <BoundFxCards track={track} clip={clip} fx={fx} dispatch={dispatch} />
      <AddTextCard onAddTextOver={onAddTextOver} start={clipStartTl(project, track, clip) + win.start} duration={win.duration} />
      <button className="btn btn-danger" onClick={() => dispatch({ type: 'removeEffect', id: selection.id })}>{t('insp.removeEffect')}</button>
    </div>
  );
}

export default function Inspector({ project, selection, dispatch, duration, time = 0, onSeek = () => {}, onEnhance = null, onTrackPick = null, onCropEdit = null, onColorPick = null, onAddTextOver = null }) {
  const t = useT();
  const multi = selection?.items && (
    <div className="multi-note" role="status">
      <b>{t('insp.multiTitle', { count: selection.items.length })}</b> {t('insp.multiBody')}
    </div>
  );
  if (selection?.track === 'transition') {
    return (
      <aside className="inspector" aria-label={t('insp.properties')}>
        <PanelHead icon={Blend} title={t('insp.transition')} />
        <div className="inspector-body">{multi}<TransitionPanel project={project} selection={selection} dispatch={dispatch} /></div>
      </aside>
    );
  }
  if (selection?.track === 'effect') {
    return (
      <aside className="inspector" aria-label={t('insp.properties')}>
        <PanelHead icon={Sparkles} title={t('insp.effect')} />
        <div className="inspector-body">{multi}<EffectPanel project={project} selection={selection} dispatch={dispatch} onAddTextOver={onAddTextOver} /></div>
      </aside>
    );
  }
  const track = selection?.track;
  const key = { video: 'videoClips', overlay: 'overlayClips', text: 'textClips', audio: 'audioClips', sticker: 'stickerClips' }[track];
  const clip = key && project[key].find((c) => c.id === selection.id);
  // With several clips selected, a filter or color change made here goes to all of them (one undo step).
  const set = (patch) => {
    const many = selectedPictures(project, selection);
    if (many.length > 1 && isLookPatch(patch) && (track === 'video' || track === 'overlay')) dispatch(lookAction(many, clip, patch));
    else dispatch({ type: 'update', track, id: clip.id, patch });
  };
  const media = clip?.mediaId && project.media.find((m) => m.id === clip.mediaId);
  const S = (p) => <Slider dispatch={dispatch} {...p} />;

  const title = !clip ? t('insp.projectSettings') : clip.gap ? t('insp.gap') : { video: t('insp.videoClip'), overlay: t('insp.overlay'), text: clip?.caption ? t('insp.caption') : t('insp.textTitle'), audio: t('insp.audioTitle'), sticker: t('insp.stickerTitle') }[track];
  const Icon = !clip ? Settings2 : { video: Film, overlay: Layers, text: Type, audio: Music, sticker: Sticker }[track];

  return (
    <aside className="inspector" aria-label={t('insp.properties')}>
      <PanelHead icon={Icon} title={title} />
      <div className="inspector-body">
      {multi}
      {!clip && <ProjectDetails project={project} dispatch={dispatch} duration={duration} />}

      {clip && track === 'text' && <TextInspector key={clip.id} clip={clip} dispatch={dispatch} project={project} />}

      {clip && track === 'video' && clip.gap && (
        <div className="fields">
          <InspCard id="gap:main" title={t('insp.gap')}>
          <div className="info">{t('insp.gapInfo')}</div>
          <NumBox layout="field" label={t('insp.lengthS')} step={0.1} min={0.1} value={Number((clip.out - clip.in).toFixed(2))}
            onChange={(v) => set({ out: Math.max(0.1, v) })} />
          </InspCard>
          <button className="btn" onClick={() => { dispatch({ type: 'delete', track: 'video', id: clip.id }); }}>{t('insp.closeGap')}</button>
        </div>
      )}

      {clip && (track === 'video' || track === 'overlay') && !clip.gap && (
        <ClipInspector key={clip.id} clip={clip} media={media} project={project} set={set} dispatch={dispatch} track={track}
          time={time} onSeek={onSeek} onEnhance={onEnhance} onTrackPick={onTrackPick} onCropEdit={onCropEdit} onColorPick={onColorPick}
          start={track === 'overlay' ? clip.start : videoLayout(project.videoClips).find((l) => l.clip.id === clip.id)?.start ?? 0} />
      )}

      {clip && track === 'sticker' && (
        <div className="fields">
          <InspCard id="sticker:main" title={clip.name || t('insp.stickerTitle')}>
            <div className="info">{t('insp.stickerInfo')}</div>
            {S({ label: t('insp.scale'), value: clip.transform?.scale ?? 0.3, min: 0.05, max: 2, step: 0.01, fmt: pct, numScale: 100, onChange: (scale) => set({ transform: { ...clip.transform, scale } }) })}
            {S({ label: t('insp.positionX'), value: clip.transform?.x ?? 0, min: -0.9, max: 0.9, step: 0.01, fmt: (v) => v.toFixed(2), onChange: (x) => set({ transform: { ...clip.transform, x } }) })}
            {S({ label: t('insp.positionY'), value: clip.transform?.y ?? 0, min: -0.9, max: 0.9, step: 0.01, fmt: (v) => v.toFixed(2), onChange: (y) => set({ transform: { ...clip.transform, y } }) })}
            {S({ label: t('insp.rotation'), value: clip.transform?.rot ?? 0, min: -180, max: 180, step: 1, fmt: (v) => `${Math.round(v)}°`, onChange: (rot) => set({ transform: { ...clip.transform, rot } }) })}
            {S({ label: t('insp.opacity'), value: clip.opacity ?? 1, max: 1, step: 0.01, fmt: pct, numScale: 100, onChange: (opacity) => set({ opacity }) })}
            <Num label={t('insp.timelineStartS')} value={clip.start} min={0} onChange={(start) => set({ start: Math.max(0, start) })} />
            <Num label={t('insp.durationS')} value={clip.duration} min={0.2} onChange={(duration) => set({ duration: Math.max(0.2, duration) })} />
          </InspCard>
          <button className="btn" onClick={() => { dispatch({ type: 'delete', track: 'sticker', id: clip.id }); }}>{t('insp.removeSticker')}</button>
        </div>
      )}

      {clip && track === 'audio' && (
        <div className="fields audio-insp">
          <InspCard id="audio:clip" title={t('insp.clipAudio')}>
            <div className="info">{media?.name}</div>
            {S({ label: t('insp.volume'), value: clip.volume ?? 1, max: 2, fmt: pct, numScale: 100, onChange: (volume) => set({ volume }) })}
            {S({ label: t('insp.fadeIn'), value: clip.fadeIn || 0, max: 5, step: 0.1, fmt: (v) => `${v.toFixed(1)}s`, onChange: (fadeIn) => set({ fadeIn }) })}
            {S({ label: t('insp.fadeOut'), value: clip.fadeOut || 0, max: 5, step: 0.1, fmt: (v) => `${v.toFixed(1)}s`, onChange: (fadeOut) => set({ fadeOut }) })}
            <Num label={t('insp.timelineStartS')} value={clip.start} min={0} onChange={(start) => set({ start: Math.max(0, start) })} />
          </InspCard>
          <InspCard id="audio:volkeys" title={t('insp.volumeKeyframes')}>
            <VolKeyEditor clip={clip} len={clipLen(clip)} set={set} dispatch={dispatch} playheadLt={time - clip.start} />
          </InspCard>
          <InspCard id="audio:fx" title={t('insp.audioEffects')}>
            <AudioFxControls fx={clip.audioFx} onChange={(audioFx) => set({ audioFx })}
              previewState={!hasAudioFx(clip.audioFx) ? null : (audioFxPathOf(clip, media) ? 'ready' : 'pending')} />
          </InspCard>
          <InspCard id="audio:enhance" title={t('insp.enhanceVoice')}>
            <EnhanceVoice clip={clip} media={media} set={set} onEnhance={onEnhance} />
          </InspCard>
        </div>
      )}

      </div>
    </aside>
  );
}
