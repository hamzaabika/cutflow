import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown, ChevronUp, Crop, Eye, EyeOff, FxGlyph, Pipette, RotateCcw, X,
  Copy, ClipboardPaste,
} from '../icons.jsx';
import { clipLen, formatTime, linkedPairInfo, transitionDur, transitionFit, uid } from '../store.js';
import { EFFECTS, FILTERS, TRANSITIONS, DEFAULT_ADJUST } from '../effects.js';
import {
  BLEND_MODES, DEFAULT_CHROMA, DEFAULT_CROP, DEFAULT_MASK, MASK_SHAPES, anchorOf, chromaOf, cropOf, maskOf, resetTransformPatch, scaleXY, transformOf,
} from '../visual.js';
import { CROP_ASPECTS, aspectRatioOf, cropForAspect } from '../cropMath.js';
import { hasCustomMask } from '../customMask.js';
import CustomMaskEditor from './CustomMaskEditor.jsx';
import Slider from './Slider.jsx';
import NumBoxBase from './NumBox.jsx';
import Dropdown from './Dropdown.jsx';
import Toggle from '../ui/Toggle.jsx';
import { InspCard, SectionChevron, useSectionOpen } from '../ui/Section.jsx';
import { BoundFxCards } from './FxControls.jsx';
import { compareOnPatch, moveEffect, resetEffectPatch, toggleFxFlag } from '../fx/effectStack.js';
import { copyEffectsFromClip, getEffectClipboard, hasEffectClipboard } from '../fx/effectClipboard.js';
import BrandSwatches from './BrandSwatches.jsx';
import KeyNav from './KeyNav.jsx';
import KeyframeGraph from './KeyframeGraph.jsx';
import AnimationPanel from './AnimationPanel.jsx';
import GradePanel from './GradePanel.jsx';
import { gradeLutDuplicatesFilter } from '../fx/lut.js';
import { applyStyleAction } from '../look.js';
import { lutFilterRef } from '../fx/filters.js';
import AudioFxControls from './AudioFx.jsx';
import CleanVoiceControls from './CleanVoice.jsx';
import VoiceRepairControls from './VoiceRepair.jsx';
import { audioFxPreviewState } from '../fx/audioFxPreview.js';
import RoleSelect from './RoleSelect.jsx';
import EnhanceVoice from './EnhanceVoice.jsx';
import { planTransitionShift } from '../transitionShift.js';
import { clipChangedFlags, levelTabs } from '../fx/inspectorLevels.js';
import { smoothCutPair, smoothCutPunchPatches, stripSmoothCutKeys } from '../smoothCut.js';
import { trackingLabelPatch } from '../fx/motionPresets.js';
import { MATTE_MODES, matteCandidates, matteModeOf, resolveTrackMatte } from '../trackMatte.js';
import { baseAt, editAt, hasAnyKeys, localTime, nextArrival, segmentEase, setSegmentEase } from '../anim.js';
import { findClipAnywhere, trackedClips } from '../track.js';
import CurveEditor from './CurveEditor.jsx';
import TransitionParams, { trAudioFadePatch, trParamsPatch } from './TransitionParams.jsx';
import TransitionInspector from './TransitionInspector.jsx';
import SpeedCurveEditor from './SpeedCurveEditor.jsx';
import VolKeyEditor from './VolKeyEditor.jsx';
import { hasCurve, sourceOffsetAt } from '../speedCurve.js';
import { tr, useT } from '../i18n/index.jsx';
import { libName } from '../i18n/libNames.js';

const pct = (v) => `${Math.round(v * 100)}%`;
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

// One inspector section: a deck card with a micro-label head (optional enable
// switch, keyframe nav and reset riding along) and a collapsible body — the
// folded state persists per section id (R3, src/ui/Section.jsx), so the panel
// reopens the way the user left it. Children stay mounted while folded.
function Section({ id, title, onReset, children, check, keys }) {
  const t = useT();
  const [open, toggle] = useSectionOpen(id || `clip:${title}`);
  return (
    <section className={`ci-section ${open ? '' : 'collapsed'}`}>
      <div className="ci-head">
        {check}
        <b>{title}</b>
        {keys}
        {onReset && <button className="icon-btn sm" aria-label={t('ci.resetAria', { title })} title={t('common.reset')} onClick={onReset}><RotateCcw size={13} /></button>}
        <SectionChevron open={open} onToggle={toggle} label={open ? t('ci.collapse', { title }) : t('ci.expand', { title })} />
      </div>
      <div className="ci-body">{children}</div>
    </section>
  );
}

function MaskIcon({ type }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 };
  const shapes = {
    none: <path d="M6 6l20 20" {...p} />,
    split: <><rect x="4" y="4" width="24" height="24" rx="2" {...p} /><path d="M4 16h24" {...p} /></>,
    filmstrip: <><rect x="4" y="4" width="24" height="24" rx="2" {...p} /><path d="M4 11h24M4 21h24" {...p} /></>,
    circle: <circle cx="16" cy="16" r="10" {...p} />,
    rectangle: <rect x="7" y="9" width="18" height="14" rx="1" {...p} />,
    star: <path d="M16 5l3.2 7 7.3.6-5.6 4.8 1.8 7.3L16 20.8 9.3 24.7l1.8-7.3-5.6-4.8 7.3-.6z" {...p} />,
    heart: <path d="M16 26C5 18 6 9 11 8c3-.6 4.4 1.6 5 3 .6-1.4 2-3.6 5-3 5 1 6 10-5 18z" {...p} />,
    text: <path d="M9 8h14M16 8v17" {...p} />,
  };
  return <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">{shapes[type]}</svg>;
}

// Track Matte (P2-12): pick another track whose picture drives this clip's
// transparency — luma (brightness) or alpha. The resolver reports why a pick
// cannot work (source starts later, ramped, nested) instead of failing silently.
const MATTE_REASON_KEY = {
  'no-matte': 'prim.matteReasonNoMatte',
  'source-gone': 'prim.matteReasonSourceGone',
  self: 'prim.matteReasonSelf',
  nested: 'prim.matteReasonNested',
  'no-picture': 'prim.matteReasonNoPicture',
  'media-missing': 'prim.matteReasonMediaMissing',
  ramped: 'prim.matteReasonRamped',
  'starts-after': 'prim.matteReasonStartsAfter',
};
const MATTE_NOTE_KEY = { 'held-last-frame': 'prim.matteNoteHeld' };

function TrackMattePicker({ project, clip, track, set }) {
  const t = useT();
  const candidates = matteCandidates(project, clip);
  const mediaById = Object.fromEntries((project.media || []).map((m) => [m.id, m]));
  const res = resolveTrackMatte(project, clip, track);
  const label = (c) => `${mediaById[c.mediaId]?.name || c.id} (${c.start !== undefined && track !== 'video' ? `${c.start.toFixed(1)}s` : 'main'})`;
  return (
    <div role="group" aria-label={t('prim.matteTitle')}>
      <label className="field">
        <span>{t('prim.matteSource')}</span>
        <Dropdown value={clip.matte?.sourceId || 'none'} ariaLabel={t('prim.matteSource')}
          options={[{ value: 'none', label: t('ci.none') }, ...candidates.map(({ clip: c }) => ({ value: c.id, label: label(c) }))]}
          onChange={(v) => set({ matte: v === 'none' ? null : { sourceId: v, mode: clip.matte?.mode || 'luma' } })} />
      </label>
      {clip.matte?.sourceId && (
        <>
          <div className="dir-seg" role="group" aria-label={t('prim.matteMode')}>
            {MATTE_MODES.map((m) => (
              <button key={m.id} type="button" className={`btn btn-sm ${matteModeOf(clip) === m.id ? 'btn-primary' : ''}`}
                aria-pressed={matteModeOf(clip) === m.id}
                onClick={() => set({ matte: { ...clip.matte, mode: m.id } })}>{t(m.id === 'alpha' ? 'prim.matteModeAlpha' : 'prim.matteModeLuma')}</button>
            ))}
          </div>
          {res.ok
            ? <div className="dim small" role="status">{res.note ? t('prim.matteLiveNote', { note: t(MATTE_NOTE_KEY[res.note] || 'prim.matteNoteHeld') }) : t('prim.matteLive')}</div>
            : <div className="dim small" role="alert">{t('prim.matteNotApplied', { reason: t(MATTE_REASON_KEY[res.reason] || 'prim.matteReasonNoMatte') })}</div>}
        </>
      )}
      {!clip.matte?.sourceId && <div className="dim small">{t('prim.matteHint')}</div>}
    </div>
  );
}

// Smooth Cut (P2-06): smooth a jump cut between two clips of the same take.
// Punch-in writes scale keyframes on both sides of the cut (marked sc: true);
// Short blend is a 0.05-0.3 s crossfade rendered at export. The motion check
// scores the frames either side of the cut and falls back to a hard cut when
// the change is large enough to warp a face or hands.
const SC_REASON_KEY = {
  'no-pair': 'ci.scReasonNoPair', 'too-short': 'ci.scReasonTooShort',
  'has-anim': 'ci.scReasonHasAnim', 'has-keys': 'ci.scReasonHasKeys',
};
function SmoothCutSection({ project, clip, media, dispatch, set }) {
  const t = useT();
  const [checking, setChecking] = useState(false);
  const [checkErr, setCheckErr] = useState('');
  const [msg, setMsg] = useState('');
  const sc = clip.smoothCut || null;
  const pair = smoothCutPair(project, clip);
  const fps = project.fps || 30;
  const S = (p) => <Slider dispatch={dispatch} {...p} />;
  const stripBoth = () => {
    const out = [];
    if (pair) {
      const sPrev = stripSmoothCutKeys(pair.prev);
      if (sPrev) out.push({ track: 'video', id: pair.prev.id, patch: sPrev });
    }
    const sNext = stripSmoothCutKeys(clip);
    return { prev: out, next: sNext };
  };
  const applyPunch = (dur) => {
    const res = smoothCutPunchPatches(project, clip, dur);
    if (!res || !res.ok) { setMsg(t(SC_REASON_KEY[res?.reason || 'no-pair'])); return false; }
    dispatch({ type: 'beginGesture' });
    for (const p of res.patches) dispatch({ type: 'update', track: 'video', id: p.id, patch: p.patch });
    set({ smoothCut: { ...(sc || {}), mode: 'punch', dur, preview: 'smooth', fallback: null } });
    dispatch({ type: 'endGesture' });
    setMsg('');
    return true;
  };
  const enable = (mode) => {
    if (mode === 'punch') { applyPunch(sc?.dur || 0.15); return; }
    set({ smoothCut: { ...(sc || {}), mode: 'blend', dur: sc?.dur || 0.12, preview: 'smooth', fallback: null } });
    setMsg('');
  };
  const disable = () => {
    const { prev, next } = stripBoth();
    dispatch({ type: 'beginGesture' });
    for (const u of prev) dispatch({ type: 'update', ...u });
    set({ ...(next || {}), smoothCut: null });
    dispatch({ type: 'endGesture' });
    setMsg('');
  };
  const setMode = (mode) => {
    if (mode === sc?.mode) return;
    if (mode === 'punch') {
      const { prev } = stripBoth();
      dispatch({ type: 'beginGesture' });
      for (const u of prev) dispatch({ type: 'update', ...u });
      dispatch({ type: 'endGesture' });
      applyPunch(sc?.dur || 0.15);
      return;
    }
    const { prev, next } = stripBoth();
    dispatch({ type: 'beginGesture' });
    for (const u of prev) dispatch({ type: 'update', ...u });
    set({ ...(next || {}), smoothCut: { ...(sc || {}), mode: 'blend', dur: sc?.dur || 0.12, preview: 'smooth', fallback: null } });
    dispatch({ type: 'endGesture' });
    setMsg('');
  };
  const setDur = (dur) => {
    if (sc?.mode === 'punch') {
      const { prev, next } = stripBoth();
      dispatch({ type: 'beginGesture' });
      for (const u of prev) dispatch({ type: 'update', ...u });
      if (next) set({ keyframes: next.keyframes });
      dispatch({ type: 'endGesture' });
      applyPunch(dur);
      return;
    }
    set({ smoothCut: { ...(sc || {}), dur } });
  };
  const check = async () => {
    if (!pair || !media?.path) return;
    setChecking(true); setCheckErr('');
    const res = await window.api.smoothCutCheck({
      prevPath: media.path, nextPath: media.path,
      prevAt: Math.max(0, pair.prev.out - 1 / fps), nextAt: clip.in,
    });
    setChecking(false);
    if (!res || res.error) { setCheckErr(res?.error || 'Check failed.'); return; }
    if (res.fallback) {
      // Large motion: the cut stays hard — strip any punch keys so preview and
      // export agree, and keep the reason on the record.
      const { prev, next } = stripBoth();
      dispatch({ type: 'beginGesture' });
      for (const u of prev) dispatch({ type: 'update', ...u });
      set({ ...(next || {}), smoothCut: { ...(sc || {}), psnr: res.psnr, fallback: res.fallback, checkedAt: Date.now() } });
      dispatch({ type: 'endGesture' });
      return;
    }
    set({ smoothCut: { ...(sc || {}), psnr: res.psnr, fallback: null, checkedAt: Date.now() } });
  };
  if (!pair && !sc) return <div className="dim small">{t('ci.scNoPair')}</div>;
  return (
    <div className="sc-cut" role="group" aria-label={t('ci.smoothCut')}>
      <label className="field">
        <span>{t('ci.smoothCut')}</span>
        <Toggle checked={!!sc} aria-label={t('ci.smoothCut')}
          onChange={(e) => (e.target.checked ? enable('punch') : disable())} />
      </label>
      {sc && (
        <>
          <label className="field">
            <span>{t('ci.scMode')}</span>
            <Dropdown value={sc.mode} ariaLabel={t('ci.scMode')}
              options={[{ value: 'punch', label: t('ci.scPunch') }, { value: 'blend', label: t('ci.scBlend') }]}
              onChange={setMode} />
          </label>
          {S({ label: t('ci.scDuration'), value: sc.dur || 0.15, min: 0.05, max: 0.3, step: 0.01,
            fmt: (v) => `${v.toFixed(2)}s`, onChange: setDur })}
          {sc.mode === 'punch' && (
            <div className="dir-seg" role="group" aria-label={t('ci.scAB')}>
              {['smooth', 'hard'].map((m) => (
                <button key={m} type="button" className={`btn btn-sm ${(sc.preview || 'smooth') === m ? 'btn-primary' : ''}`}
                  aria-pressed={(sc.preview || 'smooth') === m}
                  onClick={() => set({ smoothCut: { ...sc, preview: m } })}>
                  {m === 'smooth' ? `${t('ci.scSmooth')} (A)` : `${t('ci.scHard')} (B)`}
                </button>
              ))}
            </div>
          )}
          {sc.mode === 'blend' && <div className="dim small">{t('ci.scBlendNote')}</div>}
          <div className="row-btns">
            <button type="button" className="btn btn-sm" disabled={checking || !pair} onClick={check}>
              {checking ? t('ci.scChecking') : t('ci.scCheck')}
            </button>
          </div>
          {sc.fallback
            ? <div className="dim small" role="alert">{t('ci.scFallback', { psnr: sc.psnr ?? '?' })}</div>
            : sc.psnr != null
              ? <div className="dim small" role="status">{t('ci.scReady', { psnr: sc.psnr })}</div>
              : null}
          {checkErr && <div className="dim small" role="alert">{checkErr}</div>}
          {msg && <div className="dim small" role="alert">{msg}</div>}
        </>
      )}
    </div>
  );
}

// Transition Shifter (P2-09): sync or stagger every transition on the main
// track from this clip's duration, in one undo step.
function TransitionShifter({ project, clip, dispatch }) {
  const t = useT();
  const [mode, setMode] = useState('sync');
  const [step, setStep] = useState(0.1);
  const [msg, setMsg] = useState('');
  const base = clip.transition?.duration || 0.5;
  const apply = () => {
    const plan = planTransitionShift(project.videoClips, { mode, duration: base, step });
    if (!plan.count) { setMsg(t('prim.shiftNone')); return; }
    dispatch({
      type: 'updateMany',
      updates: plan.updates.map((u) => ({ track: 'video', id: u.id, patch: { transition: u.transition } })),
    });
    const durations = plan.durations.map((d) => `${d.toFixed(1)}s`).join(', ');
    const key = mode === 'sync'
      ? (plan.count === 1 ? 'prim.shiftSyncedOne' : 'prim.shiftSyncedMany')
      : (plan.count === 1 ? 'prim.shiftStaggeredOne' : 'prim.shiftStaggeredMany');
    setMsg(t(key, { count: plan.count, durations }));
  };
  return (
    <div className="tr-shift" role="group" aria-label={t('prim.shiftTitle')}>
      <div className="dim small">{t('prim.shiftFrom', { base: base.toFixed(1) })}</div>
      <div className="dir-seg">
        <button type="button" className={`btn btn-sm ${mode === 'sync' ? 'btn-primary' : ''}`} aria-pressed={mode === 'sync'} onClick={() => setMode('sync')}>{t('prim.shiftSync')}</button>
        <button type="button" className={`btn btn-sm ${mode === 'stagger' ? 'btn-primary' : ''}`} aria-pressed={mode === 'stagger'} onClick={() => setMode('stagger')}>{t('prim.shiftStagger')}</button>
        {mode === 'stagger' && (
          <label className="dim small">{t('prim.shiftStepLabel')}
            <input type="range" min={0.05} max={0.5} step={0.05} value={step} aria-label={t('prim.shiftStep')}
              onChange={(e) => setStep(parseFloat(e.target.value))} /> {step.toFixed(2)}s
          </label>
        )}
        <button type="button" className="btn btn-sm" onClick={apply}>{t('prim.shiftApply')}</button>
      </div>
      {msg && <div className="dim small" role="status">{msg}</div>}
    </div>
  );
}

// Auto removal (AI): the people in a video are found on this PC (the model downloads once, about
// 15 MB) and a matte is made once per video; then the background is transparent in the preview and the export.
function AutoRemoval({ clip, media, set, dispatch }) {
  const t = useT();
  const [job, setJob] = useState(null); // { stage: 'download' | 'matte', fraction } while working
  const [error, setError] = useState('');
  useEffect(() => window.api.onMattingProgress((p) => { if (p.path === media.path) setJob({ stage: p.stage, fraction: p.fraction }); }), [media.path]);
  const isVideo = media.type === 'video';
  const ready = !!media.matte;
  const on = !!clip.bgRemove && ready;
  const run = async () => {
    setError('');
    setJob({ stage: 'matte', fraction: 0 });
    const { path, width, height, duration, fps, hdr } = media;
    const res = await window.api.mattingRun({ path, width, height, duration, fps, hdr });
    setJob(null);
    if (res.matte) {
      dispatch({ type: 'mediaVisuals', path, patch: { matte: res.matte } });
      set({ bgRemove: true });
    } else if (res.error) setError(res.error);
  };
  const toggle = (checked) => {
    if (!checked) return set({ bgRemove: false });
    if (ready) return set({ bgRemove: true });
    return run();
  };
  const pctOf = (f) => `${Math.round((f || 0) * 100)}%`;
  return (
    <Section id="removebg:auto" title={t('ci.autoRemoval')}
      check={<Toggle aria-label={t('ci.autoRemoval')} checked={on || !!job} disabled={!isVideo || !!job} onChange={(e) => toggle(e.target.checked)} />}>
      <p className="dim small">
        {isVideo ? t('ci.autoNoteVideo') : t('ci.autoNotePhoto')}
      </p>
      {job && (
        <div className="progress-block" aria-live="polite">
          <span>{job.stage === 'download' ? t('ci.downloadingModel', { pct: pctOf(job.fraction) }) : t('ci.removingBg', { pct: pctOf(job.fraction) })}</span>
          <div className="progress"><div style={{ width: pctOf(job.fraction) }} /></div>
          <button className="btn btn-sm" onClick={() => window.api.mattingCancel()}>{t('common.cancel')}</button>
        </div>
      )}
      {!job && isVideo && !ready && <p className="dim small">{t('ci.autoFirstTime')}</p>}
      {error && <p className="error-text">{error}</p>}
    </Section>
  );
}

// Stabilize: the clip's part of the video is steadied by the main process (vid.stab) into a new file,
// which the clip then plays. clip.stabilize keeps the level and the original { mediaId, in, out }, so Off (or
// another level) starts again from the original.
const STAB_LEVELS = [['off', 'ci.stabOff'], ['minimal', 'ci.stabMinimal'], ['recommended', 'ci.stabRecommended'], ['most', 'ci.stabMost']];
function Stabilize({ clip, media, project, set, dispatch }) {
  const t = useT();
  const [job, setJob] = useState(null); // { fraction } while working
  const [error, setError] = useState('');
  const st = clip.stabilize || null;
  const orig = st ? project.media.find((m) => m.id === st.mediaId) : media;
  useEffect(() => window.api.onStabilizeProgress((p) => { if (p.path === orig?.path) setJob({ fraction: p.fraction }); }), [orig?.path]);
  if (!orig || orig.type !== 'video') return null;
  const choose = async (level) => {
    setError('');
    if (level === 'off') {
      if (st) set({ mediaId: st.mediaId, in: st.in, out: st.out, stabilize: null });
      return;
    }
    const from = st ? st.in : clip.in;
    const to = st ? st.out : clip.out;
    setJob({ fraction: 0 });
    const res = await window.api.stabilizeRun({ path: orig.path, duration: orig.duration, hdr: orig.hdr }, from, to, level);
    setJob(null);
    if (res.canceled) return;
    if (res.error) return setError(res.error);
    let m = project.media.find((x) => x.path === res.path);
    if (!m) {
      m = { ...res, id: uid(), origin: 'stabilize' }; // Media tree: Generated ▸ Processed
      dispatch({ type: 'addMedia', items: [m] });
    }
    set({ mediaId: m.id, in: 0, out: m.duration, stabilize: { level, mediaId: st ? st.mediaId : clip.mediaId, in: from, out: to } });
  };
  return (
    <Section id="video:stabilize" title={t('ci.stabilize')}>
      <p className="dim small">{t('ci.stabNote')}</p>
      <div className="seg-tabs small stab-levels" role="radiogroup" aria-label={t('ci.stabilize')}>
        {STAB_LEVELS.map(([id, name]) => (
          <button key={id} role="radio" aria-checked={(st?.level || 'off') === id} className={(st?.level || 'off') === id ? 'on' : ''}
            disabled={!!job} onClick={() => choose(id)}>{t(name)}</button>
        ))}
      </div>
      {job && (
        <div className="progress-block" aria-live="polite">
          <span>{job.fraction < 0.5 ? t('ci.analyzingShake') : t('ci.stabilizing')} {Math.round(job.fraction * 100)}%</span>
          <div className="progress"><div style={{ width: `${Math.round(job.fraction * 100)}%` }} /></div>
          <button className="btn btn-sm" onClick={() => window.api.stabilizeCancel()}>{t('common.cancel')}</button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </Section>
  );
}

// Motion tracking: the point is picked on the player (App drives the pick mode), the engine follows it
// through the clip in the main process, and the path is stored on the clip (clip.track). Followers pin
// to it with PinToTrack below. Progress and cancel live in App's render-job pill, like the other renders.
function MotionTracking({ clip, media, set, onTrackPick, track }) {
  const t = useT();
  if (!media || media.type !== 'video') return null;
  const tr = clip.track && clip.track.points && clip.track.points.length ? clip.track : null;
  const low = tr ? tr.points.filter((p) => (p.c ?? 1) < 0.35).length : 0;
  return (
    <Section id="video:tracking" title={t('ci.motionTracking')}>
      <p className="dim small">{t('ci.trackNote')}</p>
      {tr ? (
        <>
          <p className="dim small">{t('ci.trackedPoints', { count: tr.points.length })}{low ? t('ci.trackedUncertain', { count: low }) : ''}.</p>
          <div className="row">
            <button className="btn btn-sm" disabled={!onTrackPick} onClick={() => onTrackPick({ track, id: clip.id })}>{t('ci.trackAgain')}</button>
            <button className="btn btn-sm btn-ghost" onClick={() => set({ track: null })}>{t('ci.removeTrack')}</button>
          </div>
        </>
      ) : (
        <button className="btn btn-sm" disabled={!onTrackPick} onClick={() => onTrackPick({ track, id: clip.id })}>{t('ci.trackMotion')}</button>
      )}
    </Section>
  );
}

// Pin to track: this clip keeps its position relative to a tracked point in another clip and follows
// it (src/track.js evaluates the offset live, in the preview and the export alike). Rendered as a
// Section inside ClipInspector and as a card in the text inspector (card prop).
export function PinToTrack({ clip, project, set, card = false }) {
  const t = useT();
  const sources = trackedClips(project).filter((s) => s.clip.id !== clip.id);
  const pinnedTo = clip.pin && clip.pin.to ? findClipAnywhere(project, clip.pin.to) : null;
  const nameOf = (ref) => {
    const m = ref && project.media.find((x) => x.id === ref.clip.mediaId);
    return m?.name || t('ci.aClip');
  };
  const body = pinnedTo ? (
    <>
      <p className="dim small">{t('ci.pinFollowing', { name: nameOf(pinnedTo) })}</p>
      <button className="btn btn-sm" onClick={() => set({ pin: null })}>{t('ci.unpin')}</button>
    </>
  ) : sources.length ? (
    <>
      <p className="dim small">{t('ci.pinNote')}</p>
      {clip.animLoop !== undefined && <p className="dim small">{t('ci.pinLabelNote')}</p>}
      {sources.map((s) => (
        clip.animLoop !== undefined ? (
          <button key={s.clip.id} className="btn btn-sm" onClick={() => set(trackingLabelPatch(s.clip.id))}>{t('ci.pinAsLabel', { name: nameOf(s) })}</button>
        ) : (
          <button key={s.clip.id} className="btn btn-sm" onClick={() => set({ pin: { to: s.clip.id } })}>{t('ci.pinTo', { name: nameOf(s) })}</button>
        )
      ))}
    </>
  ) : (
    <p className="dim small">{t('ci.pinNo')}</p>
  );
  if (card) return <InspCard id="text:pin" title={t('ci.pinToTrack')}>{body}</InspCard>;
  return <Section id="video:pin" title={t('ci.pinToTrack')}>{body}</Section>;
}

// One effect bound to this clip, managed from the clip's own inspector (R3 —
// the §9 dead end: a clip's effects used to be read-only text here). The
// header names the effect and removes it (the same removeEffect action the
// Effects lane uses); the body is the shared Timing/Strength/Region cards,
// writing the clip's fxTiming/fxStrength/fxRegions maps exactly as the
// Effects-lane effect panel does — one behaviour, two doors.
// FB-26: the header is also the stack control — reorder (↑/↓, the array
// order IS the render order in preview and export), solo, bypass and
// per-effect reset.
function FxEntry({ clip, track, fx, dispatch, defaultOpen = false, playheadLt }) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const e = EFFECTS.find((x) => x.id === fx);
  const idx = (clip.effects || []).indexOf(fx);
  const bypassed = !!(clip.fxBypass || {})[fx];
  const soloed = !!(clip.fxSolo || {})[fx];
  const setPatch = (patch) => dispatch({ type: 'update', track, id: clip.id, patch });
  const move = (dir) => {
    const next = moveEffect(clip.effects, fx, dir);
    if (next.join() !== (clip.effects || []).join()) setPatch({ effects: next });
  };
  return (
    <div className={`fx-entry ${bypassed ? 'fx-bypassed' : ''}`}>
      <div className="fx-entry-head">
        <button type="button" className="fx-entry-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="fx-icon"><FxGlyph group={e?.group} size={15} /></span>
          <b>{libName('fx', fx, e?.name || fx)}</b>
          {bypassed && <span className="dim small"> · bypassed</span>}
          <ChevronDown size={14} className={open ? 'rot' : ''} />
        </button>
        <button type="button" className="icon-btn sm" aria-label={t('ci.fxMoveUp')} title={t('ci.fxMoveUp')}
          disabled={idx <= 0} onClick={() => move(-1)}>↑</button>
        <button type="button" className="icon-btn sm" aria-label={t('ci.fxMoveDown')} title={t('ci.fxMoveDown')}
          disabled={idx < 0 || idx >= (clip.effects || []).length - 1} onClick={() => move(1)}>↓</button>
        <button type="button" className={`icon-btn sm ${soloed ? 'on' : ''}`} aria-label={t('ci.fxSolo')} title={t('ci.fxSolo')}
          aria-pressed={soloed} onClick={() => setPatch({ fxSolo: toggleFxFlag(clip.fxSolo, fx) })}>S</button>
        <button type="button" className={`icon-btn sm ${bypassed ? 'on' : ''}`} aria-label={t('ci.fxBypass')} title={t('ci.fxBypass')}
          aria-pressed={bypassed} onClick={() => setPatch({ fxBypass: toggleFxFlag(clip.fxBypass, fx) })}>⏸</button>
        <button type="button" className="icon-btn sm" aria-label={t('ci.fxReset')} title={t('ci.fxReset')}
          onClick={() => setPatch(resetEffectPatch(clip, fx))}><RotateCcw size={13} /></button>
        <button type="button" className="icon-btn sm fx-entry-remove" aria-label={t('ci.removeFxAria', { name: libName('fx', fx, e?.name || fx) })}
          title={t('insp.removeEffect')} onClick={() => dispatch({ type: 'removeEffect', id: `${track}|${clip.id}|${fx}` })}>
          <X size={13} />
        </button>
      </div>
      {open && <BoundFxCards track={track} clip={clip} fx={fx} dispatch={dispatch} playheadLt={playheadLt} />}
    </div>
  );
}

// Properties of a picture clip (main track or overlay), the clip properties panel.
// time: playhead; start: where the clip starts on the timeline (values and keyframes follow the playhead).
export default function ClipInspector({ clip, media, project, set, dispatch, track, time = 0, start = 0, onSeek = () => {}, onEnhance = null, onTrackPick = null, onCropEdit = null, onColorPick = null, onPasteEffects = null, level = 'advanced', styleTargets = [] }) {
  const t = useT();
  const [tab, setTab] = useState('video');
  const [sub, setSub] = useState('basic');
  // Frame-hold editor state (P1-50): source time of the held frame + hold length.
  const [holdAt, setHoldAt] = useState(null);
  const [holdDur, setHoldDur] = useState(2);
  // Split-screen partner + mode (spec matrix).
  const [splitPartner, setSplitPartner] = useState('');
  const [splitMode, setSplitMode] = useState('left-right');
  // Pan & Zoom editor state (spec matrix).
  const [pzFrom, setPzFrom] = useState(1);
  const [pzTo, setPzTo] = useState(1.15);
  const [pzX, setPzX] = useState(0);
  const [pzY, setPzY] = useState(0);
  useEffect(() => { setHoldAt(null); setSplitPartner(''); }, [clip.id]);
  const [maskEdit, setMaskEdit] = useState(false);
  // FB-27 effect clipboard: copy this clip's stack, paste it (via the host's
  // updateMany, so a multi-clip paste is one undo step).
  const [hasClipboard, setHasClipboard] = useState(() => hasEffectClipboard());
  const copyStack = () => { copyEffectsFromClip(clip); setHasClipboard(true); };
  const pasteStack = () => {
    const snap = getEffectClipboard();
    if (snap && onPasteEffects) onPasteEffects(snap);
  };
  // FB-26 before/after comparison: bypasses every effect on the clip while
  // on, and restores the exact previous bypass map when switched off.
  const [compareOn, setCompareOn] = useState(false);
  const comparePrev = useRef(null);
  const toggleCompare = () => {
    if (compareOn) {
      set({ fxBypass: comparePrev.current });
      setCompareOn(false);
    } else {
      comparePrev.current = clip.fxBypass ? { ...clip.fxBypass } : undefined;
      set(compareOnPatch(clip));
      setCompareOn(true);
    }
  };
  const S = (p) => <Slider dispatch={dispatch} {...p} />;
  // The shared scrub field, with a scrub wrapped in a single undo gesture. The wrapper's identity
  // must be STABLE across renders (useRef), or React remounts the field mid-scrub and kills the drag.
  const numBoxRef = useRef(null);
  if (!numBoxRef.current) {
    numBoxRef.current = (p) => <NumBoxBase {...p}
      onDragStart={() => dispatch({ type: 'beginGesture' })} onDragEnd={() => dispatch({ type: 'endGesture' })} />;
  }
  const NumBox = numBoxRef.current;
  const W = project.width;
  const H = project.height;
  const isVideo = media?.type === 'video';
  // P2-19: media lookup for the shot-match reference list below.
  const mediaById = Object.fromEntries((project.media || []).map((m) => [m.id, m]));

  const len = clipLen(clip);
  // TR-03: transition fit for the clip's incoming transition (same source of
  // truth as the Inspector Transition panel); 'none' when there is none.
  const trFit = track === 'video' ? transitionFit(project.videoClips, project.videoClips.findIndex((c) => c.id === clip.id)) : { state: 'none' };
  const fps = project.fps || 30;
  const inside = time >= start - 1e-6 && time <= start + len + 1e-6;
  const lt = inside ? Math.min(len, Math.max(0, time - start)) : null;
  // Values at the playhead (keyframes applied); an edit of a keyframed value adds a keyframe there.
  const at = baseAt(clip, lt ?? 0);
  const tf = { ...transformOf(clip), scale: at.scale, x: at.x, y: at.y, rot: at.rot };
  const { sx } = scaleXY(tf);
  const setT = (patch) => set(editAt(clip, patch, lt ?? 0));
  const keys = (props, label) => (
    <KeyNav clip={clip} props={props} lt={lt} start={start} fps={fps} set={set} onSeek={onSeek} label={t('lib.prop.' + label)} />
  );
  const dropKeys = (props) => {
    const k = { ...(clip.keyframes || {}) };
    props.forEach((p) => delete k[p]);
    return k;
  };
  const chroma = chromaOf(clip);
  const setC = (patch) => set({ chroma: { ...chroma, ...patch } });
  const mask = maskOf(clip);
  const setM = (patch) => set({ mask: { ...mask, ...patch } });

  // Align the scaled picture to a frame edge or center (rotation ignored).
  const cropNow = cropOf(clip);
  const fitW = media?.width ? Math.min(1, (media.width / media.height) / (W / H)) : 1;
  const fitH = media?.width ? Math.min(1, (media.height / media.width) / (H / W)) : 1;
  const { sx: ex, sy: ey } = scaleXY(tf);
  // Align pad anchors for one axis, from the scaled picture's size on it as a fraction of the
  // frame (w). Smaller than the frame: flush inside it (left cell = picture's left edge on the
  // frame's left edge). Larger: pan, so the chosen edge of the picture meets the frame's edge
  // and the picture keeps covering the frame. Exactly filling the axis (|w − 1| within half a
  // percent): edge alignment is vacuous — the picture already touches both edges at once, so
  // every flush anchor collapses to the centred position and the pad could never move the clip
  // (the dead pad on a full-frame clip at 100%). There the centre snaps to the frame's
  // third-points instead, so the cells still take the clip where their labels say.
  const axisAnchors = (w) => {
    if (w > 1.005) { const a = (w - 1) / 2; return [a, 0, -a]; }
    if (w < 0.995) { const a = (1 - w) / 2; return [-a, 0, a]; }
    return [-1 / 3, 0, 1 / 3];
  };
  const anchorsX = axisAnchors(fitW * ex);
  const anchorsY = axisAnchors(fitH * ey);
  // The pad reflects the current anchor only when BOTH axes sit on one (within a rounding pixel).
  const matchAxis = (v, anchors, eps) => {
    for (let i = 0; i < 3; i++) if (Math.abs(v - anchors[i]) <= eps) return i;
    return -1;
  };
  const acol = matchAxis(tf.x, anchorsX, 0.6 / W);
  const arow = matchAxis(tf.y, anchorsY, 0.6 / H);
  const activeAnchor = acol >= 0 && arow >= 0 ? arow * 3 + acol : -1;
  const PAD_LABELS = ['ci.alignTopLeft', 'ci.alignTop', 'ci.alignTopRight', 'ci.alignLeft', 'ci.alignCenter', 'ci.alignRight', 'ci.alignBottomLeft', 'ci.alignBottom', 'ci.alignBottomRight'];
  const alignPad = PAD_LABELS.map((labelKey, i) => ({
    label: t(labelKey),
    patch: { x: anchorsX[i % 3], y: anchorsY[Math.floor(i / 3)] },
    dot: { left: `${[14, 50, 86][i % 3]}%`, top: `${[18, 50, 82][Math.floor(i / 3)]}%` },
  }));

  // Pick samples a color from the player itself (an App stage mode, like track-pick): the
  // OS EyeDropper it used before silently rejects under Electron on Linux, so the button
  // did nothing there. The in-app sampler behaves the same on every platform.

  // Fit / Fill (item 13): the transform's scale 1 is the contain fit in both preview and
  // export, so Fit = scale 1 centred, and Fill = the cover/contain ratio, centred. Both write
  // through setT like every other transform control (keyframe-safe).
  const fitFill = (mode) => {
    if (!media?.width || !media?.height || !W || !H) return;
    if (mode === 'fit') { setT({ uniform: true, scale: 1, x: 0, y: 0 }); return; }
    const contain = Math.min(W / media.width, H / media.height);
    const cover = Math.max(W / media.width, H / media.height);
    setT({ uniform: true, scale: Math.min(4, cover / contain), x: 0, y: 0 });
  };

  // FB-29 unified inspector: Basic hides the technical tabs/sections
  // (progressive disclosure); Presets replaces the tab set with one-click
  // looks. `showTab` is the visible tab after the level filter.
  const basic = level === 'basic';
  const changed = clipChangedFlags(clip);
  const dot = (on) => (on ? <span className="ci-changed" title={t('insp.changed')} aria-label={t('insp.changed')}>•</span> : null);
  const allTabs = [['video', t('ci.tabVideo')], ['animation', t('ci.tabAnimation')], ...(isVideo ? [['audio', t('ci.tabAudio')], ['speed', t('ci.tabSpeed')]] : []), ['adjust', t('panel.tab.adjust')]];
  const visibleTabs = levelTabs(level, isVideo);
  const tabs = allTabs.filter(([id]) => visibleTabs.includes(id));
  const showTab = tabs.some(([id]) => id === tab) ? tab : 'video';
  const tabDot = (id) => (id === 'video'
    ? (changed.transform || changed.blend || changed.crop)
    : id === 'adjust' ? (changed.look || changed.effects || changed.transition) : false);
  const subTabs = basic ? [['basic', t('ci.subBasic')]] : [['basic', t('ci.subBasic')], ['removebg', t('ci.removeBg')], ['mask', t('ci.mask')]];
  const showSub = subTabs.some(([id]) => id === sub) ? sub : 'basic';

  // FB-29 Presets level: one-click looks instead of the tab set.
  if (level === 'presets') {
    return (
      <div className="clip-inspector">
        <div className="info">{media?.name}<br />
          <span className="dim">{media?.width}×{media?.height}{isVideo ? ` · ${formatTime(media.duration)}` : ` · ${t('ci.photo')}`} · {t('ci.onTimeline', { dur: clipLen(clip).toFixed(2) })}</span>
        </div>
        <Section id="presets:looks" title={t('insp.presetsLooks')}>
          <div className="chips">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className={`chip ${(clip.filter || 'none') === f.id ? 'on' : ''}`}
                aria-pressed={(clip.filter || 'none') === f.id}
                onClick={() => set({ filter: f.id })}>{f.name}</button>
            ))}
          </div>
          <p className="dim small">{t('insp.presetsNote')}</p>
        </Section>
        <button type="button" className="btn" onClick={() => set({ filter: 'none', grade: undefined, adjust: { ...DEFAULT_ADJUST } })}>{t('insp.presetClear')}</button>
      </div>
    );
  }

  return (
    <div className="clip-inspector">
      <div className="ci-tabs" role="tablist">
        {tabs.map(([id, name]) => (
          <button key={id} role="tab" aria-selected={showTab === id} className={showTab === id ? 'on' : ''} onClick={() => setTab(id)}>{name}{dot(tabDot(id))}</button>
        ))}
      </div>
      <div className="info">{media?.name}<br />
        <span className="dim">{media?.width}×{media?.height}{isVideo ? ` · ${formatTime(media.duration)}` : ` · ${t('ci.photo')}`} · {t('ci.onTimeline', { dur: clipLen(clip).toFixed(2) })}</span>
      </div>

      {showTab === 'video' && (
        <>
          <div className="seg-tabs small" role="tablist">
            {subTabs.map(([id, name]) => (
              <button key={id} role="tab" aria-selected={showSub === id} className={showSub === id ? 'on' : ''} onClick={() => setSub(id)}>{name}</button>
            ))}
          </div>

          {showSub === 'basic' && (
            <>
              <Section id="video:transform" title={t('ci.transform')} keys={keys(['scale', 'x', 'y', 'rot'], 'transform')}
                check={dot(changed.transform)}
                onReset={() => set(resetTransformPatch(clip, track))}>
                {S({ label: t('insp.scale'), value: tf.scale, min: 0.05, max: 4, step: 0.01, fmt: pct, numScale: 100, onChange: (scale) => setT({ scale }), extra: keys(['scale'], 'scale') })}
                <div className="fitfill-row">
                  <button type="button" className="btn btn-sm" onClick={() => fitFill('fit')}
                    title={t('ci.fitTitle')}>{t('ci.fit')}</button>
                  <button type="button" className="btn btn-sm" onClick={() => fitFill('fill')}
                    title={t('ci.fillTitle')}>{t('ci.fill')}</button>
                  <span className="dim small">{t('ci.fitFillNote')}</span>
                </div>
                <label className="field row">
                  <span>{t('ci.uniformScale')}</span>
                  <Toggle checked={tf.uniform} onChange={(e) => setT({ uniform: e.target.checked })} />
                </label>
                {!tf.uniform && (
                  <>
                    {S({ label: t('ci.scaleWidth'), value: tf.scaleX, min: 0.05, max: 4, step: 0.01, fmt: pct, numScale: 100, onChange: (scaleX) => setT({ scaleX }) })}
                    {S({ label: t('ci.scaleHeight'), value: tf.scaleY, min: 0.05, max: 4, step: 0.01, fmt: pct, numScale: 100, onChange: (scaleY) => setT({ scaleY }) })}
                  </>
                )}
                <div className="numrow keyed">
                  <span className="numrow-label">{t('ci.position')}</span>
                  <NumBox label="X" value={Number((tf.x * W).toFixed(1))} precision={1} suffix="px" onChange={(v) => setT({ x: v / W })} />
                  <NumBox label="Y" value={Number((tf.y * H).toFixed(1))} precision={1} suffix="px" onChange={(v) => setT({ y: v / H })} />
                  {keys(['x', 'y'], 'position')}
                </div>
                {S({ label: t('ci.rotate'), value: tf.rot, min: -180, max: 180, step: 1, fmt: (v) => `${Number(v.toFixed(1))}°`, onChange: (rot) => setT({ rot }), extra: keys(['rot'], 'rotation') })}
                {S({ label: t('prim.anchorX'), value: anchorOf(clip).x, min: 0, max: 1, step: 0.01, fmt: pct, onChange: (x) => set({ transform: { ...transformOf(clip), anchor: { ...anchorOf(clip), x } } }) })}
                {S({ label: t('prim.anchorY'), value: anchorOf(clip).y, min: 0, max: 1, step: 0.01, fmt: pct, onChange: (y) => set({ transform: { ...transformOf(clip), anchor: { ...anchorOf(clip), y } } }) })}
                <div className="align-wrap">
                  <div className="align-pad" role="group" aria-label={t('ci.alignToFrame')}>
                    {alignPad.map((cell, i) => (
                      <button key={cell.label} type="button" className={i === activeAnchor ? 'on' : ''}
                        aria-label={cell.label} aria-pressed={i === activeAnchor} title={cell.label}
                        onClick={() => setT(cell.patch)}><i style={cell.dot} /></button>
                    ))}
                  </div>
                  <span className="dim small">{t('ci.alignNote')}</span>
                </div>
                <span className="dim small">{t('ci.scaleKfNote', { pct: pct(sx) })}</span>
              </Section>
              {hasAnyKeys(clip) && lt !== null && nextArrival(clip, lt, fps) !== null && !basic && (
                <Section id="video:segment-easing" title={t('ci.segmentEasing')}>
                  <span className="dim small">{t('ci.segEaseNote', { time: localTime(clip, nextArrival(clip, lt, fps)).toFixed(2) })}</span>
                  <CurveEditor compact value={segmentEase(clip, lt, fps)} resetValue="smooth"
                    onChange={(ease) => set(setSegmentEase(clip, lt, ease, fps))} />
                </Section>
              )}
              {hasAnyKeys(clip) && !basic && (
                <Section id="video:keyframe-graph" title={t('ci.keyGraph')}>
                  <KeyframeGraph clip={clip} len={len} fps={fps} W={W} H={H} lt={lt} set={set} dispatch={dispatch} />
                </Section>
              )}
              <Section id="video:blend" title={t('ci.blend')} check={dot(changed.blend)} onReset={() => set({ blend: 'normal', opacity: 1, keyframes: dropKeys(['opacity']) })}>
                <label className="field">
                  <span>{t('ci.mode')}</span>
                  <Dropdown value={clip.blend || 'normal'} ariaLabel={t('ci.blendMode')}
                    options={BLEND_MODES.map((b) => ({ value: b.id, label: libName('blend', b.id, b.name) }))}
                    onChange={(blend) => set({ blend })} />
                </label>
                {S({ label: t('insp.opacity'), value: at.opacity, min: 0, max: 1, step: 0.01, fmt: pct, numScale: 100, onChange: (opacity) => setT({ opacity }), extra: keys(['opacity'], 'opacity') })}
                {['mirror', 'flipv'].map((id) => (
                  <label className="field row" key={id}>
                    <span>{id === 'mirror' ? t('ci.flipH') : t('ci.flipV')}</span>
                    <Toggle aria-label={id === 'mirror' ? t('ci.flipH') : t('ci.flipV')}
                      checked={(clip.effects || []).includes(id)}
                      onChange={(e) => {
                        const fx = clip.effects || [];
                        set({ effects: e.target.checked ? [...fx.filter((x) => x !== id), id] : fx.filter((x) => x !== id) });
                      }} />
                  </label>
                ))}
              </Section>
              <Section id="video:track-matte" title={t('prim.matteTitle')} onReset={() => set({ matte: null })}>
                <TrackMattePicker project={project} clip={clip} track={track} set={set} />
              </Section>
              <Section id="video:crop" title={t('ci.crop')} check={dot(changed.crop)} onReset={() => set({ crop: { ...DEFAULT_CROP }, cropAspect: 'free' })}>
                <p className="dim small">{t('ci.cropNote')}</p>
                <div className="chips pad-x" role="group" aria-label={t('ci.cropAspect')}>
                  {CROP_ASPECTS.map((a) => {
                    const cur = (clip.cropAspect || 'free') === a.id;
                    return (
                      <button key={a.id} type="button" className={`chip ${cur ? 'on' : ''}`} aria-pressed={cur}
                        onClick={() => {
                          if (a.id === 'free') { set({ cropAspect: 'free' }); return; }
                          const R = aspectRatioOf(a.id, media?.width, media?.height);
                          if (!R) return;
                          set({ crop: cropForAspect(cropNow, media.width, media.height, R), cropAspect: a.id });
                        }}>{a.id === 'free' || a.id === 'original' ? libName('crop', a.id, a.label) : a.label}</button>
                    );
                  })}
                </div>
                {[['l', t('ci.left')], ['t', t('ci.top')], ['r', t('ci.right')], ['b', t('ci.bottom')]].map(([k, name]) => (
                  <div className="numrow" key={k}>
                    <span className="numrow-label">{name}</span>
                    <NumBox label="" value={Number((cropNow[k] * 100).toFixed(1))} step={1} precision={1} min={0} max={90} suffix="%"
                      onChange={(v) => set({ crop: { ...cropNow, [k]: Math.min(90, Math.max(0, v)) / 100 }, cropAspect: 'free' })} />
                  </div>
                ))}
                <button type="button" className="btn btn-sm" disabled={!onCropEdit || !media}
                  onClick={() => onCropEdit && onCropEdit({ track, id: clip.id })}>
                  <Crop size={13} /> {t('ci.cropOnPlayer')}
                </button>
                <p className="dim small">{t('ci.cropPlayerNote')}</p>
              </Section>
              {!basic && media && <Stabilize clip={clip} media={media} project={project} set={set} dispatch={dispatch} />}
              {!basic && media && <MotionTracking clip={clip} media={media} set={set} onTrackPick={onTrackPick} track={track} />}
              {!basic && track === 'overlay' && <PinToTrack clip={clip} project={project} set={set} />}
              {isVideo && (
                <Section id="video:framehold" title="Frame hold">
                  <p className="dim small">Freeze one frame while the clip’s audio keeps playing. The held frame is a source time; the duration is timeline seconds.</p>
                  <div className="numrow">
                    <span className="numrow-label">Hold frame</span>
                    <NumBox label="" step={0.1} suffix="s" value={holdAt ?? Number(((clip.in || 0) + sourceOffsetAt(clip, lt ?? 0)).toFixed(2))} onChange={(v) => setHoldAt(v)} />
                    <span className="numrow-label">Duration</span>
                    <NumBox label="" step={0.1} suffix="s" value={clip.frameHold?.duration ?? holdDur} onChange={(v) => setHoldDur(Math.max(0.1, v))} />
                  </div>
                  <div className="chips">
                    <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: 'setFrameHold', track, id: clip.id, hold: { at: holdAt ?? (clip.in || 0) + sourceOffsetAt(clip, lt ?? 0), duration: clip.frameHold?.duration ?? holdDur } })}>Hold frame at playhead</button>
                    {clip.frameHold && <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: 'setFrameHold', track, id: clip.id, hold: null })}>Clear hold</button>}
                  </div>
                  {clip.frameHold && <p className="dim small">Holding source {Number(clip.frameHold.at).toFixed(2)}s for {Number(clip.frameHold.duration).toFixed(2)}s.</p>}
                </Section>
              )}
              {clip.linkId && (() => {
                const partner = (project.audioClips || []).find((a) => a.linkId === clip.linkId);
                if (!partner) return null;
                return (
                  <Section id="video:linked-audio" title="Linked audio — J / L cuts">
                    <p className="dim small">Move the linked audio without moving the picture. J-cut: the audio starts early. L-cut: the audio runs past the cut. The trim buttons below edit the audio clip on its own — the picture never moves.</p>
                    <div className="chips" role="group" aria-label="J-cut and L-cut">
                      <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: 'jCut', id: clip.id, delta: 0.5 })}>J-cut −0.5s</button>
                      <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: 'jCut', id: clip.id, delta: 1 })}>J-cut −1s</button>
                      <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: 'lCut', id: clip.id, delta: 0.5 })}>L-cut +0.5s</button>
                      <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: 'lCut', id: clip.id, delta: 1 })}>L-cut +1s</button>
                    </div>
                    <div className="chips" role="group" aria-label="Trim linked audio only">
                      <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: 'trimLinkedAudio', id: partner.id, edge: 'left', delta: 0.5 })}>Audio in +0.5s</button>
                      <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: 'trimLinkedAudio', id: partner.id, edge: 'left', delta: -0.5 })}>Audio in −0.5s</button>
                      <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: 'trimLinkedAudio', id: partner.id, edge: 'right', delta: 0.5 })}>Audio out −0.5s</button>
                      <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: 'trimLinkedAudio', id: partner.id, edge: 'right', delta: -0.5 })}>Audio out +0.5s</button>
                    </div>
                  </Section>
                );
              })()}
              {isVideo && (() => {
                const partners = [
                  ...project.videoClips.filter((c) => !c.gap && c.id !== clip.id).map((c) => ({ track: 'video', clip: c })),
                  ...(project.overlayClips || []).map((c) => ({ track: 'overlay', clip: c })),
                ];
                const chosen = partners.find((x) => x.clip.id === splitPartner);
                return (
                  <Section id="video:splitscreen" title="Split screen">
                    <p className="dim small">Place this clip and another picture clip side by side (or stacked) — each at half size.</p>
                    <label className="field">
                      <span>Partner clip</span>
                      <Dropdown value={splitPartner} ariaLabel="Partner clip"
                        options={[{ value: '', label: 'Choose a clip…' }, ...partners.map((x) => ({ value: x.clip.id, label: (mediaById[x.clip.mediaId]?.name || x.clip.id) + (x.track === 'overlay' ? ' (overlay)' : '') }))]}
                        onChange={(v) => setSplitPartner(v)} />
                    </label>
                    <div className="chips" role="group" aria-label="Split screen layout">
                      {[['left-right', 'Left / Right'], ['right-left', 'Right / Left'], ['top-bottom', 'Top / Bottom'], ['bottom-top', 'Bottom / Top']].map(([id, name]) => (
                        <button key={id} type="button" className={`chip ${splitMode === id ? 'on' : ''}`} aria-pressed={splitMode === id} onClick={() => setSplitMode(id)}>{name}</button>
                      ))}
                    </div>
                    <button type="button" className="btn btn-sm" disabled={!chosen}
                      onClick={() => chosen && dispatch({ type: 'applySplitScreen', aTrack: track, aId: clip.id, bTrack: chosen.track, bId: chosen.clip.id, mode: splitMode })}>
                      Apply split screen
                    </button>
                  </Section>
                );
              })()}
              {isVideo && (
                <Section id="video:panzoom" title="Pan & Zoom">
                  <p className="dim small">A Ken Burns move across the whole clip (adds the Pan &amp; Zoom effect).</p>
                  <div className="numrow">
                    <span className="numrow-label">Start zoom</span>
                    <NumBox label="" step={0.05} value={pzFrom} onChange={(v) => setPzFrom(Math.max(0.5, Math.min(3, v)))} />
                    <span className="numrow-label">End zoom</span>
                    <NumBox label="" step={0.05} value={pzTo} onChange={(v) => setPzTo(Math.max(0.5, Math.min(3, v)))} />
                  </div>
                  <div className="numrow">
                    <span className="numrow-label">Pan X</span>
                    <NumBox label="" step={0.05} value={pzX} onChange={(v) => setPzX(Math.max(-0.5, Math.min(0.5, v)))} />
                    <span className="numrow-label">Pan Y</span>
                    <NumBox label="" step={0.05} value={pzY} onChange={(v) => setPzY(Math.max(-0.5, Math.min(0.5, v)))} />
                  </div>
                  <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: 'setPanZoom', track, id: clip.id, panZoom: { from: { scale: pzFrom, x: 0, y: 0 }, to: { scale: pzTo, x: pzX, y: pzY } } })}>Apply Pan &amp; Zoom</button>
                  {clip.effects?.includes('fx_panzoom') && <p className="dim small">Pan &amp; Zoom is on this clip — tune it in Adjust › Effects.</p>}
                </Section>
              )}            </>
          )}

          {showSub === 'removebg' && media && <AutoRemoval clip={clip} media={media} set={set} dispatch={dispatch} />}
          {showSub === 'removebg' && (
            <Section id="removebg:chroma" title={t('ci.chromaKey')} onReset={() => set({ chroma: { ...DEFAULT_CHROMA } })}
              check={<Toggle aria-label={t('ci.chromaKey')} checked={chroma.on} onChange={(e) => setC({ on: e.target.checked })} />}>
              <p className="dim small">{t('ci.chromaNote')}</p>
              <div className="numrow">
                <span className="numrow-label">{t('ci.color')}</span>
                <input type="color" value={chroma.color} aria-label={t('ci.keyColor')} onChange={(e) => setC({ on: true, color: e.target.value })} />
                <button className="btn btn-sm" disabled={!onColorPick} onClick={() => onColorPick && onColorPick({ track, id: clip.id })} title={t('ci.pickTitle')}><Pipette size={13} /> {t('ci.pick')}</button>
                <span className="chips">
                  {['#00ff00', '#00b140', '#0047bb', '#ffffff', '#000000'].map((c) => (
                    <button key={c} className="swatch" style={{ background: c }} aria-label={t('ci.keyAria', { color: c })} onClick={() => setC({ on: true, color: c })} />
                  ))}
                </span>
              </div>
              <BrandSwatches onPick={(c) => setC({ on: true, color: c })} />
              {S({ label: t('ci.intensity'), value: chroma.intensity, min: 0, max: 100, step: 1, onChange: (intensity) => setC({ intensity }) })}
              {S({ label: t('ci.featherEdge'), value: chroma.feather, min: 0, max: 100, step: 1, onChange: (feather) => setC({ feather }) })}
              {S({ label: t('ci.spill'), value: chroma.spill, min: 0, max: 100, step: 1, onChange: (spill) => setC({ spill }) })}
            </Section>
          )}
          {showSub === 'removebg' && (
            <Section id="removebg:custom" title={t('ci.customRemoval')}>
              <p className="dim small">{t('ci.customNote')}</p>
              {hasCustomMask(clip) && <p className="dim small">{t(clip.customMask.strokes.length === 1 ? 'ci.strokesOne' : 'ci.strokesOther', { count: clip.customMask.strokes.length })}</p>}
              <div className="fitfill-row">
                <button type="button" className="btn btn-sm" onClick={() => setMaskEdit(true)}>{t('ci.paintRemoval')}</button>
                {hasCustomMask(clip) && <button type="button" className="btn btn-sm" onClick={() => set({ customMask: null })}>{t('common.clear')}</button>}
              </div>
            </Section>
          )}

          {showSub === 'mask' && (
            <>
              <Section id="mask:mask" title={t('ci.mask')} onReset={() => set({ mask: { ...DEFAULT_MASK } })}>
                <div className="mask-grid">
                  {[{ id: 'none', name: t('ci.none') }, ...MASK_SHAPES].map((m) => (
                    <button key={m.id} className={`mask-tile ${mask.type === m.id ? 'on' : ''}`} aria-pressed={mask.type === m.id}
                      onClick={() => setM(['circle', 'star', 'heart'].includes(m.id)
                        ? { type: m.id, h: Math.min(2, (mask.w * W) / H) } // square in pixels
                        : { type: m.id })}>
                      <MaskIcon type={m.id} /><span>{m.id === 'none' ? m.name : libName('mask', m.id, m.name)}</span>
                    </button>
                  ))}
                </div>
              </Section>
              {mask.type !== 'none' && (
                <Section id="mask:settings" title={t('ci.maskSettings')}>
                  {mask.type === 'text' && (
                    <label className="field">
                      <span>{t('ci.textLabel')}</span>
                      <input type="text" value={mask.text} onChange={(e) => setM({ text: e.target.value })} />
                    </label>
                  )}
                  <div className="numrow">
                    <span className="numrow-label">{t('ci.position')}</span>
                    <NumBox label="X" value={Number((mask.x * W).toFixed(1))} precision={1} suffix="px" onChange={(v) => setM({ x: v / W })} />
                    <NumBox label="Y" value={Number((mask.y * H).toFixed(1))} precision={1} suffix="px" onChange={(v) => setM({ y: v / H })} />
                  </div>
                  {S({ label: t('ci.rotate'), value: mask.rot, min: -180, max: 180, step: 1, fmt: (v) => `${v}°`, onChange: (rot) => setM({ rot }) })}
                  {mask.type !== 'split' && S({ label: mask.type === 'filmstrip' ? t('ci.bandHeight') : t('ci.height'), value: mask.h, min: 0.02, max: 2, step: 0.01, fmt: pct, numScale: 100, onChange: (h) => setM({ h }) })}
                  {!['split', 'filmstrip', 'text'].includes(mask.type) && S({ label: t('ci.width'), value: mask.w, min: 0.02, max: 2, step: 0.01, fmt: pct, numScale: 100, onChange: (w) => setM({ w }) })}
                  {mask.type === 'rectangle' && S({ label: t('ci.roundCorners'), value: mask.round, min: 0, max: 1, step: 0.01, fmt: pct, numScale: 100, onChange: (round) => setM({ round }) })}
                  {S({ label: t('ci.feather'), value: mask.feather, min: 0, max: 100, step: 1, onChange: (feather) => setM({ feather }) })}
                  <label className="field row">
                    <span>{t('ci.invert')}</span>
                    <Toggle checked={mask.invert} onChange={(e) => setM({ invert: e.target.checked })} />
                  </label>
                </Section>
              )}
              {mask.type !== 'none' && (
                <Section id="mask:outline" title={t('ci.outlineGlow')} onReset={() => setM({ stroke: 0, strokeColor: DEFAULT_MASK.strokeColor, glow: 0, glowColor: DEFAULT_MASK.glowColor, glowStrength: DEFAULT_MASK.glowStrength })}>
                  <div className="numrow">
                    <span className="numrow-label">{t('ci.stroke')}</span>
                    <input type="color" value={mask.strokeColor} aria-label={t('ci.strokeColor')} onChange={(e) => setM({ strokeColor: e.target.value, stroke: mask.stroke || 6 })} />
                    <span className="chips">
                      {['#ffffff', '#000000', '#ec4899', '#facc15', '#22d3ee'].map((c) => (
                        <button key={c} className="chip-color" style={{ background: c }} aria-label={t('ci.strokeAria', { color: c })} onClick={() => setM({ strokeColor: c, stroke: mask.stroke || 6 })} />
                      ))}
                    </span>
                  </div>
                  <BrandSwatches onPick={(c) => setM({ strokeColor: c, stroke: mask.stroke || 6 })} />
                  {S({ label: t('ci.strokeWidth'), value: mask.stroke, min: 0, max: 40, step: 1, fmt: (v) => (v ? `${v}px` : t('ci.off')), onChange: (stroke) => setM({ stroke }) })}
                  <div className="numrow">
                    <span className="numrow-label">{t('ci.glow')}</span>
                    <input type="color" value={mask.glowColor} aria-label={t('ci.glowColor')} onChange={(e) => setM({ glowColor: e.target.value, glow: mask.glow || 20 })} />
                    <span className="chips">
                      {['#ec4899', '#a855f7', '#22d3ee', '#22c55e', '#facc15', '#ffffff'].map((c) => (
                        <button key={c} className="chip-color" style={{ background: c }} aria-label={t('ci.glowAria', { color: c })} onClick={() => setM({ glowColor: c, glow: mask.glow || 20 })} />
                      ))}
                    </span>
                  </div>
                  <BrandSwatches onPick={(c) => setM({ glowColor: c, glow: mask.glow || 20 })} />
                  {S({ label: t('ci.glowSize'), value: mask.glow, min: 0, max: 80, step: 1, fmt: (v) => (v ? `${v}px` : t('ci.off')), onChange: (glow) => setM({ glow }) })}
                  {mask.glow > 0 && S({ label: t('ci.glowStrength'), value: mask.glowStrength, min: 5, max: 100, step: 1, fmt: (v) => `${v}%`, onChange: (glowStrength) => setM({ glowStrength }) })}
                </Section>
              )}
            </>
          )}
        </>
      )}

      {showTab === 'animation' && <AnimationPanel clip={clip} len={len} set={set} dispatch={dispatch} />}

      {showTab === 'audio' && (
        <>
          {clip.linkId && (() => {
            // J/L-cut sync label (P1-03): the picture side of a linked pair
            // states how its audio sits — in sync, leading (J-cut) or
            // trailing (L-cut) — with a one-click resync.
            const info = linkedPairInfo(project, track, clip);
            if (!info) return null;
            return (
              <Section id="audio:link" title={t('ci.linkedAudio')}>
                <div className="info">
                  {info.lead > 0 && info.trail > 0 ? t('insp.jlBoth', { lead: info.lead.toFixed(2), trail: info.trail.toFixed(2) })
                    : info.lead > 0 ? t('insp.jlJOnly', { lead: info.lead.toFixed(2) })
                    : info.trail > 0 ? t('insp.jlLOnly', { trail: info.trail.toFixed(2) })
                    : t('insp.jlSync')}
                </div>
                {(info.lead > 0 || info.trail > 0) && (
                  <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: 'setAudioTrim', id: info.aud.id, lead: 0, trail: 0 })}>{t('insp.jlResync')}</button>
                )}
              </Section>
            );
          })()}
          <Section id="audio:basic" title={t('ci.basic')}>
            {S({ label: t('insp.volume'), value: clip.volume ?? 1, max: 2, fmt: pct, numScale: 100, onChange: (volume) => set({ volume }) })}
            {S({ label: t('insp.fadeIn'), value: clip.fadeIn || 0, max: 5, step: 0.1, fmt: (v) => `${v.toFixed(1)}s`, onChange: (fadeIn) => set({ fadeIn }) })}
            {S({ label: t('insp.fadeOut'), value: clip.fadeOut || 0, max: 5, step: 0.1, fmt: (v) => `${v.toFixed(1)}s`, onChange: (fadeOut) => set({ fadeOut }) })}
            <AudioFxControls fx={clip.audioFx} onChange={(audioFx) => set({ audioFx })}
              previewState={audioFxPreviewState(clip, media)} />
            <RoleSelect clip={clip} track={track} dispatch={dispatch} />
            <CleanVoiceControls cv={clip.cleanVoice} onChange={(cleanVoice) => set({ cleanVoice })}
              project={project} dispatch={dispatch} clipId={clip.id} />
            <VoiceRepairControls clip={clip} media={media} set={set} />
            <label className="field row">
              <span>{t('ci.mute')}</span>
              <Toggle checked={!!clip.muted} onChange={(e) => set({ muted: e.target.checked })} />
            </label>
          </Section>
          <Section id="audio:volkeys" title={t('insp.volumeKeyframes')}>
            <VolKeyEditor clip={clip} len={len} set={set} dispatch={dispatch} playheadLt={time - start} />
          </Section>
          <Section id="audio:enhance" title={t('insp.enhanceVoice')}>
            <EnhanceVoice clip={clip} media={media} set={set} onEnhance={onEnhance} />
          </Section>
        </>
      )}

      {showTab === 'speed' && (
        <>
        <Section id="speed:standard" title={t('ci.standard')}>
          <label className="field">
            <span>{t('ci.speed')} <b>{clip.speed || 1}×</b></span>
            <div className="chips">
              {SPEEDS.map((s) => (
                <button key={s} className={`chip ${(clip.speed || 1) === s ? 'on' : ''}`} onClick={() => set({ speed: s })}>{s}×</button>
              ))}
            </div>
          </label>
          {hasCurve(clip) && <p className="dim small">{t('ci.speedCurveNote')}</p>}
          <label className="field">
            <span>{t('ci.interp')}</span>
            <Dropdown value={clip.interp || 'sample'} ariaLabel={t('ci.interp')}
              options={[
                { value: 'sample', label: t('ci.interpSample') },
                { value: 'blend', label: t('ci.interpBlend') },
                { value: 'flow', label: t('ci.interpFlow') },
              ]}
              onChange={(interp) => set({ interp })} />
          </label>
          <p className="dim small">
            {(clip.interp || 'sample') === 'sample' ? t('ci.interpSampleNote')
              : (clip.interp === 'blend' ? t('ci.interpBlendNote') : t('ci.interpFlowNote'))}
          </p>
          <p className="dim small">{t('ci.interpPreviewNote')}</p>
          <div className="numrow">
            <span className="numrow-label">{t('ci.source')}</span>
            <NumBox label={t('ci.in')} step={0.1} value={clip.in} onChange={(v) => set({ in: Math.max(0, Math.min(v, clip.out - 0.1)) })} />
            <NumBox label={t('ci.out')} step={0.1} value={clip.out} onChange={(v) => set({ out: Math.max(clip.in + 0.1, Math.min(v, media?.duration ?? v)) })} />
          </div>
        </Section>
        <Section id="speed:hold" title={t('ci.frameHold')}
          check={<Toggle aria-label={t('ci.frameHold')} checked={!!clip.frameHold} disabled={hasCurve(clip)}
            onChange={(e) => set({ frameHold: e.target.checked ? { at: Math.min(Math.max(0, lt ?? 0), Math.max(0, len - 0.5)), duration: Math.min(1, Math.max(0.1, len - Math.min(Math.max(0, lt ?? 0), Math.max(0, len - 0.5)))) } : null })} />}>
          <p className="dim small">{t('ci.frameHoldNote')}</p>
          {hasCurve(clip) && <p className="dim small">{t('ci.frameHoldCurveNote')}</p>}
          {!!clip.frameHold && (
            <div className="numrow">
              <span className="numrow-label">{t('ci.frameHoldAt')}</span>
              <NumBox label={t('ci.frameHoldAt')} step={0.1} value={clip.frameHold.at}
                onChange={(v) => set({ frameHold: { ...clip.frameHold, at: Math.max(0, Math.min(v, len - clip.frameHold.duration)) } })} />
              <span className="numrow-label">{t('ci.frameHoldFor')}</span>
              <NumBox label={t('ci.frameHoldFor')} step={0.1} value={clip.frameHold.duration}
                onChange={(v) => set({ frameHold: { ...clip.frameHold, duration: Math.max(0.1, Math.min(v, len - clip.frameHold.at)) } })} />
              <button className="btn btn-sm" disabled={lt === null}
                onClick={() => set({ frameHold: { ...clip.frameHold, at: Math.max(0, Math.min(lt, len - clip.frameHold.duration)) } })}>{t('ci.frameHoldAtPlayhead')}</button>
            </div>
          )}
        </Section>
        <Section id="speed:curve" title={t('ci.speedCurve')}>
          <SpeedCurveEditor clip={clip} set={set} dispatch={dispatch} />
        </Section>
        </>
      )}

      {maskEdit && media && (
        <CustomMaskEditor clip={clip} media={media}
          onClose={() => setMaskEdit(false)}
          onSave={(strokes) => { set({ customMask: strokes.length ? { strokes } : null }); setMaskEdit(false); }} />
      )}
      {showTab === 'adjust' && (
        <>
          <Section id="adjust:filter" title={t('ci.filter')} check={dot(changed.look)} onReset={() => set({ filter: 'none' })}>
            <Dropdown value={clip.filter || 'none'} ariaLabel={t('ci.filter')}
              options={FILTERS.map((f) => ({ value: f.id, label: f.name }))}
              onChange={(filter) => set({ filter })} />
          </Section>
          <Section id="adjust:color" title={t('ci.colorSection')} check={dot(changed.look)}>
            <GradePanel grade={clip.grade} adjust={clip.adjust} dispatch={dispatch} autoFrom={media ? { media, clip } : undefined}
              shotMatch={track === 'video' ? { refs: project.videoClips.filter((c) => !c.gap && c.id !== clip.id).map((c) => ({ id: c.id, name: mediaById[c.mediaId]?.name || c.id, media: mediaById[c.mediaId], clip: c })).filter((r) => r.media) } : undefined}
              lutDuplicate={gradeLutDuplicatesFilter(clip.grade?.lut, lutFilterRef(clip))}
              onGrade={(grade) => set({ grade })} onAdjust={(adjust) => set({ adjust })}
              onApplyAll={() => dispatch({ type: 'updateMany', updates: [
                ...project.videoClips.filter((c) => !c.gap).map((c) => ({ track: 'video', id: c.id, patch: { grade: { ...(clip.grade || {}) }, adjust: { ...(clip.adjust || {}) } } })),
                ...(project.overlayClips || []).map((c) => ({ track: 'overlay', id: c.id, patch: { grade: { ...(clip.grade || {}) }, adjust: { ...(clip.adjust || {}) } } })),
              ] })} />
          </Section>
          {styleTargets.length > 0 && (
            <Section id="adjust:style" title={t('ci.applyStyle')}>
              <p className="dim small">{t('ci.applyStyleNote', { count: styleTargets.length })}</p>
              <button className="btn" data-testid="apply-style" onClick={() => dispatch(applyStyleAction(styleTargets, clip))}>{t('ci.applyStyleBtn', { count: styleTargets.length })}</button>
            </Section>
          )}
          {(clip.effects?.length || hasClipboard) && (
            <Section id="adjust:effects" title={t('ci.effects')} check={dot(changed.effects)}>
              <div className="row-btns">
                <button type="button" className={`btn btn-sm ${compareOn ? 'btn-primary' : ''}`} aria-pressed={compareOn}
                  onClick={toggleCompare}>{compareOn ? t('ci.fxCompareOff') : t('ci.fxCompare')}</button>
                <button type="button" className="btn btn-sm" disabled={!clip.effects?.length} onClick={copyStack}>{t('ci.fxCopy')}</button>
                <button type="button" className="btn btn-sm" disabled={!hasClipboard} onClick={pasteStack}>{t('ci.fxPaste')}</button>
              </div>
              {!clip.effects?.length && <p className="dim small">{t('ci.fxEmpty')}</p>}
              {clip.effects.map((fx) => (
                <FxEntry key={fx} clip={clip} track={track} fx={fx} dispatch={dispatch} defaultOpen={clip.effects.length === 1} playheadLt={lt} />
              ))}
            </Section>
          )}
          {track === 'video' && (
            <Section id="adjust:transition" title={t('ci.transitionIn')} check={dot(changed.transition)}>
              <Dropdown value={clip.transition?.type || 'none'} ariaLabel={t('ci.transitionIn')}
                options={[{ value: 'none', label: t('ci.none') }, ...TRANSITIONS.map((o) => ({ value: o.id, label: libName('tr', o.id, o.name) }))]}
                onChange={(v) => set({ transition: v === 'none' ? null : { type: v, duration: clip.transition?.duration || 0.5, ...(/zoom|push|pull|seamless|whip/i.test(v) ? { ease: 'smooth' } : {}) } })} />
              {clip.transition && S({
                label: t('insp.duration'), value: clip.transition.duration, min: 0.2, max: 2, step: 0.1, fmt: (v) => `${v.toFixed(1)}s`,
                onChange: (d) => set({ transition: { ...clip.transition, duration: d } }),
              })}
              {clip.transition && trFit.state === 'clamped' && (
                <div className="tr-warn" data-testid="tr-clamped">
                  <b>{t('insp.trTooLong')}</b>
                  {t('insp.trTooLongDetail', { effective: trFit.effective.toFixed(2), requested: trFit.requested.toFixed(2), max: trFit.max.toFixed(2) })}
                  <button className="btn btn-sm" onClick={() => set({ transition: { ...clip.transition, duration: trFit.max } })}>{t('insp.trShortenFit', { max: trFit.max.toFixed(2) })}</button>
                </div>
              )}
              {clip.transition && trFit.state === 'zero' && (
                <div className="tr-error" data-testid="tr-zero">
                  <b>{t('insp.trZeroHandle')}</b>
                  {t('insp.trZeroHandleDetail', { prev: trFit.prevLen.toFixed(2), next: trFit.nextLen.toFixed(2) })}
                  <button className="btn btn-sm btn-danger" onClick={() => set({ transition: null })}>{t('insp.removeTransition')}</button>
                </div>
              )}
              {clip.transition && (
                <TransitionParams tr={clip.transition} dispatch={dispatch} maxDur={2}
                  onChange={(key, value) => set({ transition: trParamsPatch(clip.transition, key, value) })}
                  onAudioFade={(af) => set({ transition: trAudioFadePatch(clip.transition, af) })} />
              )}
              {clip.transition && (
                <TransitionInspector tr={clip.transition} dispatch={dispatch}
                  progress={(() => {
                    // FB-11: keyframe-aware strength needs the playhead's progress
                    // through the transition (clip-local time over its length).
                    if (track !== 'video' || lt == null) return null;
                    const i = project.videoClips.findIndex((c) => c.id === clip.id);
                    const td = i > 0 ? transitionDur(project.videoClips, i) : 0;
                    return td > 0 && lt <= td ? lt / td : null;
                  })()}
                  onPatch={(next) => set({ transition: next })}
                  onParam={(key, value) => set({ transition: trParamsPatch(clip.transition, key, value) })} />
              )}
              {clip.transition && <TransitionShifter project={project} clip={clip} dispatch={dispatch} />}
            </Section>
          )}
          {!basic && track === 'video' && (
            <Section id="adjust:smoothcut" title={t('ci.smoothCut')}>
              <SmoothCutSection project={project} clip={clip} media={media} dispatch={dispatch} set={set} />
            </Section>
          )}
          {track === 'overlay' && (
            <Section id="adjust:timeline" title={t('ci.timeline')}>
              <div className="numrow">
                <span className="numrow-label">{t('ci.start')}</span>
                <NumBox label="" step={0.1} suffix="s" value={clip.start} onChange={(v) => set({ start: Math.max(0, v) })} />
              </div>
            </Section>
          )}
          {!isVideo && (
            <Section id="adjust:photo" title={t('ci.photoSection')}>
              <div className="numrow">
                <span className="numrow-label">{t('insp.duration')}</span>
                <NumBox label="" step={0.1} suffix="s" value={clip.out} onChange={(v) => set({ in: 0, out: Math.max(0.1, v) })} />
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}


