import React from 'react';
import { useT } from '../i18n/index.jsx';
import { ChevronLeft, ChevronRight, Diamond } from '../icons.jsx';
import { addKeys, keyAt, keyTimes, removeKeys } from '../anim.js';

// Keyframe control of one or more properties: jump to the previous keyframe, add / remove the
// keyframe at the playhead (filled diamond when there is one), jump to the next keyframe.
// lt: playhead in clip time (null when the playhead is outside the clip). start: clip start on the timeline.
export default function KeyNav({ clip, props, lt, start, fps, set, onSeek, label }) {
  const t = useT();
  const inside = lt !== null;
  const on = inside && props.some((p) => keyAt(clip, p, lt, fps));
  const times = keyTimes(clip, props);
  const eps = 0.5 / fps;
  const prev = inside ? [...times].reverse().find((t) => t < lt - eps) : undefined;
  const next = inside ? times.find((t) => t > lt + eps) : undefined;
  const toggle = () => set(on ? removeKeys(clip, props, lt, fps) : addKeys(clip, props, lt));
  return (
    <span className="keynav" role="group" aria-label={t('keynav.group', { label })}>
      {times.length > 0 && (
        <button type="button" className="kf-step" disabled={prev === undefined} aria-label={t('keynav.prev', { label })}
          title={t('keynav.prevTitle')} onClick={() => onSeek(start + prev)}><ChevronLeft size={12} /></button>
      )}
      <button type="button" className={`kf-btn ${on ? 'on' : ''}`} disabled={!inside} aria-pressed={on}
        aria-label={t(on ? 'keynav.remove' : 'keynav.add', { label })}
        title={inside ? (on ? t('keyframe.remove') : t('keyframe.add')) : t('keyframe.needPlayhead')}
        onClick={toggle}>
        <Diamond size={12} fill={on ? 'currentColor' : 'none'} />
      </button>
      {times.length > 0 && (
        <button type="button" className="kf-step" disabled={next === undefined} aria-label={t('keynav.next', { label })}
          title={t('keynav.nextTitle')} onClick={() => onSeek(start + next)}><ChevronRight size={12} /></button>
      )}
    </span>
  );
}
