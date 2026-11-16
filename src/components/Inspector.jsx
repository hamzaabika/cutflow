import React, { useEffect, useState } from 'react';
import { getMorphReport, morphCacheKey } from '../fx/morph.js';
import { Blend, Film, FxGlyph, Layers, Music, RotateCcw, Settings2, Sparkles, Type, Sticker } from '../icons.jsx';
import { clipLen, formatTime, fxTimingOf, linkedPairInfo, parseEffectKey, transitionDur, transitionFit, videoLayout } from '../store.js';
import { ANIMATIONS, EFFECTS, FILTERS, RATIOS, TRANSITIONS, sizeFor } from '../effects.js';
import Slider from './Slider.jsx';
import Toggle from '../ui/Toggle.jsx';
import PanelHead from '../ui/PanelHead.jsx';
import { InspCard } from '../ui/Section.jsx';
import Dropdown from './Dropdown.jsx';
import CurveEditor from './CurveEditor.jsx';
import TransitionParams, { trAudioFadePatch, trParamsPatch } from './TransitionParams.jsx';
import TransitionInspector from './TransitionInspector.jsx';
import NumBox from './NumBox.jsx';
import { NO_STRENGTH, RegionControls, StrengthControl, BoundFxCards, ParamsControls, prunedParams } from './FxControls.jsx';
import { pruneFxParams } from '../fx/params.js';
import BrandSwatches from './BrandSwatches.jsx';

export { DEFAULT_FX_REGION, RegionControls } from './FxControls.jsx';
import TextInspector from './TextInspector.jsx';
import ClipInspector, { PinToTrack } from './ClipInspector.jsx';
import AudioFxControls from './AudioFx.jsx';
import CleanVoiceControls from './CleanVoice.jsx';
import DuckingControls from './Ducking.jsx';
import VoiceRepairControls from './VoiceRepair.jsx';
import { audioFxPreviewState } from '../fx/audioFxPreview.js';
import RoleSelect from './RoleSelect.jsx';
import EnhanceVoice from './EnhanceVoice.jsx';
import VolKeyEditor from './VolKeyEditor.jsx';
import { isLookPatch, lookAction, selectedPictures } from '../look.js';
import { pasteEffectsUpdates } from '../fx/effectClipboard.js';
import { INSPECTOR_LEVELS, resetClipPatch } from '../fx/inspectorLevels.js';
import { clipLenTl, clipStartTl } from '../track.js';
import { sequenceById, sequenceDuration } from '../sequences.js';

// A nested sequence clip (P2-02): ClipInspector assumes a media clip and
// would crash on the missing media, so a sequence clip gets its own panel —
// what it plays, its source window, and a way into the source sequence.
function SequenceClipPanel({ clip, project, dispatch, onSelect }) {
  const t = useT();
  const source = sequenceById(project, clip.sequenceId);
  const name = source?.name || clip.sequenceName || '?';
  const dur = source ? sequenceDuration(project, source.id) : 0;
  return (
    <div className="fields">
      <InspCard id="seqclip:main" title={t('seqs.nestedTitle')}>
        <div className="info">{t('seqs.nestedInfo', { name })}</div>
        <div className="info">{t('seqs.sourceLength', { dur: formatTime(dur) })}</div>
        <div className="info">{t('seqs.window', { start: formatTime(clip.in || 0), end: formatTime(clip.out || 0) })}</div>
      </InspCard>
      <button className="btn btn-primary" disabled={!source}
        onClick={() => { dispatch({ type: 'switchSequence', id: clip.sequenceId }); if (onSelect) onSelect(null); }}>
        {t('seqs.openSequence')}
      </button>
      <button className="btn" onClick={() => { dispatch({ type: 'delete', track: 'video', id: clip.id }); if (onSelect) onSelect(null); }}>
        {t('seqs.deleteClip')}
      </button>
    </div>
  );
}
import GradePanel from './GradePanel.jsx';
import { gradeLutDuplicatesFilter, lutOn } from '../fx/lut.js';
import { filterName, lutFilterRef } from '../fx/filters.js';
import { FRAME_RATES } from '../frames.js';
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
          {FRAME_RATES.map((r) => (
            <button key={r.id} type="button" role="radio" aria-checked={project.fps === r.fps}
              className={project.fps === r.fps ? 'on' : ''} onClick={() => set({ fps: r.fps })}>{r.label} {t('player.fpsUnit')}</button>
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

// P3-03 morph quality readout: the preview (and the export) write their
// analysis decision into morph.js as they render, so this panel reports
// what actually happened — warped with the flow, or fell back to dissolve
// and why. It polls while open because the preview updates the report as
// the playhead moves through the transition.
function MorphQuality({ clip, prevClip }) {
  const t = useT();
  const [report, setReport] = useState(null);
  const key = prevClip ? morphCacheKey(`${prevClip.id}:${prevClip.mediaId}`, `${clip.id}:${clip.mediaId}`) : null;
  useEffect(() => {
    const tick = () => setReport(getMorphReport(key));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [key]);
  if (!report) return <p className="dim small">{t('insp.morphPending')}</p>;
  const pct = Math.round(report.score * 100);
  return (
    <InspCard id="transition:morph" title={t('insp.morphQuality')}>
      <p className="small">
        {t('insp.morphScore', { score: pct })} — {report.usedFallback
          ? t('insp.morphFallback', { reason: t(`insp.morphReason.${report.reason}`) })
          : t('insp.morphWarped')}
      </p>
    </InspCard>
  );
}

// A selected transition (its marker on the timeline), the Transition panel.
function TransitionPanel({ project, selection, dispatch, time = 0 }) {
  const t = useT();
  const clips = project.videoClips;
  const i = clips.findIndex((c) => c.id === selection.id);
  const clip = clips[i];
  const tr = clip && clip.transition;
  if (!tr) return <div className="fields"><div className="info dim">{t('insp.transitionRemoved')}</div></div>;
  const def = TRANSITIONS.find((t) => t.id === tr.type);
  const set = (transition) => dispatch({ type: 'update', track: 'video', id: clip.id, patch: { transition } });
  // TR-03: a transition can use at most half of each clip it joins — fit is
  // the single source of truth (see transitionFit in store.js); the slider
  // caps at the true max and the warnings below explain the clamp.
  const fit = transitionFit(clips, i);
  const max = fit.max;
  // FB-11: playhead progress through the transition, for the keyframe-aware
  // strength control (null when the playhead is outside the transition).
  const td = transitionDur(clips, i);
  const start = videoLayout(clips).find((l) => l.clip.id === clip.id)?.start ?? 0;
  const progress = td > 0 && time >= start && time <= start + td ? (time - start) / td : null;
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
            set({ type: t.id, duration: Math.min(max, t.fx ? t.duration : tr.duration), ...(t.fx && /zoom|push|pull|seamless|whip/i.test(t.id) ? { ease: 'smooth' } : {}) });
          }} />
      </label>
      {fit.state !== 'zero' && (
        <Slider dispatch={dispatch} label={t('insp.duration')} value={Math.min(tr.duration, max)} min={Math.min(0.1, max)} max={Number(max.toFixed(2))} step={0.05}
          fmt={(v) => `${v.toFixed(2)}s`} onChange={(duration) => set({ ...tr, duration })} />
      )}
      {fit.state === 'clamped' && (
        <div className="tr-warn" data-testid="tr-clamped">
          <b>{t('insp.trTooLong')}</b>
          {t('insp.trTooLongDetail', { effective: fit.effective.toFixed(2), requested: fit.requested.toFixed(2), max: fit.max.toFixed(2) })}
          <button className="btn btn-sm" onClick={() => set({ ...tr, duration: fit.max })}>{t('insp.trShortenFit', { max: fit.max.toFixed(2) })}</button>
        </div>
      )}
      {fit.state === 'zero' && (
        <div className="tr-error" data-testid="tr-zero">
          <b>{t('insp.trZeroHandle')}</b>
          {t('insp.trZeroHandleDetail', { prev: fit.prevLen.toFixed(2), next: fit.nextLen.toFixed(2) })}
          <button className="btn btn-sm btn-danger" onClick={() => set(null)}>{t('insp.removeTransition')}</button>
        </div>
      )}
      <TransitionParams tr={tr} dispatch={dispatch} maxDur={max} onChange={(key, value) => set(trParamsPatch(tr, key, value))} onAudioFade={(af) => set(trAudioFadePatch(tr, af))} />
      <TransitionInspector tr={tr} dispatch={dispatch} progress={progress}
        onPatch={(next) => set(next)} onParam={(key, value) => set(trParamsPatch(tr, key, value))} />
      </InspCard>
      <InspCard id="transition:curve" title={t('insp.motionCurve')}>
        {def?.fx ? (
          <CurveEditor value={tr.ease} onChange={(ease) => set(ease === undefined ? { type: tr.type, duration: tr.duration } : { ...tr, ease })} />
        ) : (
          <p className="dim small">{t('insp.curveNote')}</p>
        )}
      </InspCard>
      {tr.type === 'fx_morphcut' && <MorphQuality project={project} clip={clip} prevClip={clips[i - 1]} />}
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
  // P2-16 — a grade layer grades every picture clip under its span (pre-composite),
  // so its inspector is the clip look controls, not a catalog effect's parameters.
  const isGrade = c.kind === 'grade';
  return (
    <div className="fields">
      <div className="fx-head"><span className="fx-icon">{isGrade ? <Layers size={15} /> : <FxGlyph group={e?.group} size={15} />}</span><div><b>{isGrade ? (c.name || t('insp.adjustmentLayer')) : (e?.name || c.fx)}</b><span className="dim">{isGrade ? t('insp.gradesAllBelow') : t('insp.onEffectsTrack')}</span></div></div>
      <InspCard id="fxfree:timing" title={t('insp.timing')}>
      <p className="dim small">{t('insp.timingNote')}</p>
      <label className="field row">
        <span>{t('insp.fxBypass')}</span>
        <Toggle checked={!!c.disabled} aria-label={t('insp.fxBypass')}
          onChange={(e) => set({ disabled: e.target.checked ? true : undefined })} />
      </label>
      <Num label={t('insp.startS')} value={c.start} min={0} onChange={(start) => set({ start: Math.max(0, start) })} />
      <Num label={t('insp.durationS')} value={c.duration} min={0.1} onChange={(d) => set({ duration: Math.max(0.1, d) })} />
      </InspCard>
      {isGrade && (
        <>
          <InspCard id="fxfree:filter" title={t('ci.filter')} onReset={() => set({ filter: 'none' })}>
            <Dropdown value={c.filter || 'none'} ariaLabel={t('ci.filter')}
              options={FILTERS.map((f) => ({ value: f.id, label: f.name }))}
              onChange={(filter) => set({ filter })} />
            {c.filter && c.filter !== 'none' && (
              <Slider dispatch={dispatch} label={t('panel.filters.intensity', { name: filterName(c.filter) })} value={c.filterIntensity ?? 100} min={0} max={100} step={1}
                fmt={(v) => `${Math.round(v)}`} onChange={(v) => set({ filterIntensity: v })} />
            )}
          </InspCard>
          <InspCard id="fxfree:grade" title={t('ci.colorSection')}>
            <GradePanel grade={c.grade} adjust={c.adjust} dispatch={dispatch}
              lutDuplicate={gradeLutDuplicatesFilter(c.grade?.lut, lutFilterRef({ filter: c.filter, filterIntensity: c.filterIntensity }))}
              onGrade={(grade) => set({ grade })} onAdjust={(adjust) => set({ adjust })} />
            {lutOn(c.grade?.lut) && c.region && <p className="dim small">{t('insp.layerLutNote')}</p>}
          </InspCard>
        </>
      )}
      {!NO_STRENGTH.includes(c.fx) && <StrengthControl value={c.strength} dispatch={dispatch}
        onChange={(k) => set({ strength: k >= 1 ? undefined : k })} />}
      {!isGrade && (
        <ParamsControls fx={c.fx} values={c.params} dispatch={dispatch}
          onParam={(key, v) => { const pruned = prunedParams(c.fx, c.params, key, v); set({ params: Object.keys(pruned).length ? pruned : undefined }); }}
          onPreset={(pr) => { const pruned = pruneFxParams(c.fx, pr.params); set({ params: Object.keys(pruned).length ? pruned : undefined }); }} />
      )}
      <RegionControls region={c.region || null} dispatch={dispatch}
        onChange={(region) => set({ region: region ?? undefined })} />
      <AddTextCard onAddTextOver={onAddTextOver} start={c.start} duration={c.duration} />
      <button className="btn btn-danger" onClick={() => dispatch({ type: 'delete', track: 'effect', id: c.id })}>{t('insp.removeEffect')}</button>
    </div>
  );
}

function EffectPanel({ project, selection, dispatch, onAddTextOver = null, time = 0 }) {
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
      <BoundFxCards track={track} clip={clip} fx={fx} dispatch={dispatch} playheadLt={time - clipStartTl(project, track, clip)} />
      <AddTextCard onAddTextOver={onAddTextOver} start={clipStartTl(project, track, clip) + win.start} duration={win.duration} />
      <button className="btn btn-danger" onClick={() => dispatch({ type: 'removeEffect', id: selection.id })}>{t('insp.removeEffect')}</button>
    </div>
  );
}

export default function Inspector({ project, selection, dispatch, duration, time = 0, onSeek = () => {}, onEnhance = null, onTrackPick = null, onCropEdit = null, onColorPick = null, onAddTextOver = null, onSelect = null }) {
  const t = useT();
  // FB-29 unified inspector level: Basic / Advanced / Presets for the
  // selected picture clip (other selections keep their own panels).
  const [level, setLevel] = useState('basic');
  const multi = selection?.items && (
    <div className="multi-note" role="status">
      <b>{t('insp.multiTitle', { count: selection.items.length })}</b> {t('insp.multiBody')}
    </div>
  );
  if (selection?.track === 'transition') {
    return (
      <aside className="inspector" aria-label={t('insp.properties')}>
        <PanelHead icon={Blend} title={t('insp.transition')} />
        <div className="inspector-body">{multi}<TransitionPanel project={project} selection={selection} dispatch={dispatch} time={time} /></div>
      </aside>
    );
  }
  if (selection?.track === 'effect') {
    return (
      <aside className="inspector" aria-label={t('insp.properties')}>
        <PanelHead icon={Sparkles} title={t('insp.effect')} />
        <div className="inspector-body">{multi}<EffectPanel project={project} selection={selection} dispatch={dispatch} onAddTextOver={onAddTextOver} time={time} /></div>
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

  const title = !clip ? t('insp.projectSettings') : clip.gap ? t('insp.gap') : clip.sequenceId ? t('seqs.nestedTitle') : { video: t('insp.videoClip'), overlay: t('insp.overlay'), text: clip?.caption ? t('insp.caption') : t('insp.textTitle'), audio: t('insp.audioTitle'), sticker: t('insp.stickerTitle') }[track];
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

      {clip && track === 'video' && clip.sequenceId && (
        <SequenceClipPanel clip={clip} project={project} dispatch={dispatch} onSelect={onSelect} />
      )}

      {clip && (track === 'video' || track === 'overlay') && !clip.gap && !clip.sequenceId && (
        <>
        <div className="ci-levels" role="tablist" aria-label={t('insp.levels')}>
          {INSPECTOR_LEVELS.map((l) => (
            <button key={l} type="button" role="tab" aria-selected={level === l} className={level === l ? 'on' : ''}
              onClick={() => setLevel(l)}>{t(`insp.level.${l}`)}</button>
          ))}
          <button type="button" className="btn btn-sm" title={t('insp.resetClip')}
            onClick={() => dispatch({ type: 'update', track, id: clip.id, patch: resetClipPatch(clip, track) })}>
            <RotateCcw size={13} /> {t('insp.resetClip')}</button>
        </div>
        <ClipInspector key={clip.id} clip={clip} media={media} project={project} set={set} dispatch={dispatch} track={track}
          styleTargets={(track === 'video' || track === 'overlay') ? selectedPictures(project, selection).filter((x) => x.clip.id !== clip.id).map((x) => ({ track: x.track, id: x.clip.id })) : []}
          time={time} onSeek={onSeek} onEnhance={onEnhance} onTrackPick={onTrackPick} onCropEdit={onCropEdit} onColorPick={onColorPick}
          level={level}
          onPasteEffects={(snap) => {
            // FB-27: paste onto every selected picture clip (or just this one)
            // as one updateMany — a single undo step.
            const many = selectedPictures(project, selection);
            const items = many.length > 1 ? many : [{ track, clip }];
            dispatch({ type: 'updateMany', updates: pasteEffectsUpdates(items, snap) });
          }}
          start={track === 'overlay' ? clip.start : videoLayout(project.videoClips).find((l) => l.clip.id === clip.id)?.start ?? 0} />
        </>
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
            <RoleSelect clip={clip} track={track} dispatch={dispatch} />
            <Num label={t('insp.timelineStartS')} value={clip.start} min={0} onChange={(start) => set({ start: Math.max(0, start) })} />
          </InspCard>
          {(() => {
            // J-cuts / L-cuts (P1-03): a linked audio clip may start before
            // its picture (lead) or end after it (trail). The numbers edit
            // the trims; the line under them states the sync in words.
            const info = linkedPairInfo(project, 'audio', clip);
            if (!info) return null;
            const setTrim = (lead, trail) => dispatch({ type: 'setAudioTrim', id: clip.id, lead, trail });
            return (
              <InspCard id="audio:jcut" title={t('insp.jlCut')}>
                <div className="info">
                  {info.lead > 0 && info.trail > 0 ? t('insp.jlBoth', { lead: info.lead.toFixed(2), trail: info.trail.toFixed(2) })
                    : info.lead > 0 ? t('insp.jlJOnly', { lead: info.lead.toFixed(2) })
                    : info.trail > 0 ? t('insp.jlLOnly', { trail: info.trail.toFixed(2) })
                    : t('insp.jlSync')}
                </div>
                <Num label={t('insp.jlLead')} value={info.lead} min={0} step={0.1} onChange={(lead) => setTrim(Math.max(0, lead), info.trail)} />
                <Num label={t('insp.jlTrail')} value={info.trail} min={0} step={0.1} onChange={(trail) => setTrim(info.lead, Math.max(0, trail))} />
                <div className="info dim">{t('insp.jlNote')}</div>
                {(info.lead > 0 || info.trail > 0) && (
                  <button className="btn btn-sm" onClick={() => setTrim(0, 0)}>{t('insp.jlResync')}</button>
                )}
              </InspCard>
            );
          })()}
          <InspCard id="audio:volkeys" title={t('insp.volumeKeyframes')}>
            <VolKeyEditor clip={clip} len={clipLen(clip)} set={set} dispatch={dispatch} playheadLt={time - clip.start} />
          </InspCard>
          <InspCard id="audio:fx" title={t('insp.audioEffects')}>
            <AudioFxControls fx={clip.audioFx} onChange={(audioFx) => set({ audioFx })}
              previewState={audioFxPreviewState(clip, media)} />
            <CleanVoiceControls cv={clip.cleanVoice} onChange={(cleanVoice) => set({ cleanVoice })}
              project={project} dispatch={dispatch} clipId={clip.id} />
            <DuckingControls clip={clip} project={project} set={set} />
          </InspCard>
          <InspCard id="audio:enhance" title={t('insp.enhanceVoice')}>
            <EnhanceVoice clip={clip} media={media} set={set} onEnhance={onEnhance} />
          </InspCard>
          <InspCard id="audio:repair" title={t('insp.repairVoice')}>
            <VoiceRepairControls clip={clip} media={media} set={set} />
          </InspCard>
        </div>
      )}

      </div>
    </aside>
  );
}

