// Beat grid editor (P2-22, AU-08) — manual BPM / first-beat offset, tap
// tempo, and the beat-snapping toggle. Pops over the timeline toolbar from
// the BPM badge; Apply writes a manual grid (setBeatGrid), which replaces
// a detected grid until Detect runs again.
import React, { useRef, useState } from 'react';
import { useT } from '../i18n/index.jsx';
import { clampBpm, isManualBeatGrid, tapTempo } from '../beats.js';

export default function BeatGridPanel({ project, dispatch, onClose }) {
  const t = useT();
  const beats = project.beats;
  const [bpm, setBpm] = useState(beats?.bpm ? Math.round(beats.bpm) : 120);
  const [offset, setOffset] = useState(beats?.offset || 0);
  const tapsRef = useRef([]);
  const [tapBpm, setTapBpm] = useState(null);
  const tap = () => {
    const now = performance.now() / 1000;
    const taps = [...tapsRef.current, now].filter((x) => now - x < 4).slice(-8);
    tapsRef.current = taps;
    const b = tapTempo(taps);
    setTapBpm(b);
    if (b) setBpm(b);
  };
  return (
    <div className="tl-popover" role="dialog" aria-label={t('beat.panelTitle')}>
      <div className="tl-pop-head">
        <span>{t('beat.panelTitle')}</span>
        <button type="button" className="tl-pop-x" aria-label={t('beat.close')} onClick={onClose}>×</button>
      </div>
      {beats && (
        <div className="tl-pop-note">
          {isManualBeatGrid(project) ? t('beat.manualNote') : t('beat.detectedNote', { bpm: Math.round(beats.bpm) })}
        </div>
      )}
      <label className="tl-pop-row">
        <span>{t('beat.bpm')}</span>
        <input type="number" min={40} max={240} step={1} value={bpm} aria-label={t('beat.bpm')}
          onChange={(e) => setBpm(clampBpm(e.target.value))} />
        <span className="tl-pop-unit">BPM</span>
      </label>
      <label className="tl-pop-row">
        <span>{t('beat.offset')}</span>
        <input type="range" min={-0.5} max={0.5} step={0.01} value={offset} aria-label={t('beat.offset')}
          onChange={(e) => setOffset(Number(e.target.value))} />
        <span className="tl-pop-unit">{offset > 0 ? '+' : ''}{offset.toFixed(2)}s</span>
      </label>
      <div className="tl-pop-row">
        <button type="button" className="tl-pop-btn" onClick={tap}>{t('beat.tap')}</button>
        <span className="tl-pop-unit">{tapBpm ? `${tapBpm} BPM` : t('beat.tapHint')}</span>
      </div>
      <label className="tl-pop-row">
        <span>{t('beat.snap')}</span>
        <input type="checkbox" checked={project.beatSnap !== false}
          onChange={(e) => dispatch({ type: 'setBeatSnap', on: e.target.checked })} />
      </label>
      <div className="tl-pop-actions">
        <button type="button" className="tl-pop-btn primary"
          onClick={() => { dispatch({ type: 'setBeatGrid', bpm, offset }); onClose(); }}>
          {t('beat.apply')}
        </button>
        {beats && (
          <button type="button" className="tl-pop-btn"
            onClick={() => { dispatch({ type: 'setBeatOffset', offset }); onClose(); }}>
            {t('beat.nudgeOnly')}
          </button>
        )}
      </div>
    </div>
  );
}
