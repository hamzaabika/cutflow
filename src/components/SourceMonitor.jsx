// Source Monitor (spec matrix): watch a library item before it is on the
// timeline, mark a source In / Out range, and insert only that range at the
// playhead. Insert goes through the store's addToTimeline, which already
// honours an { in, out } source window (see src/store.js).
import React, { useEffect, useRef, useState } from 'react';
import { formatTime, toFileUrl } from '../store.js';

export default function SourceMonitor({ media, onInsert, onClose }) {
  const elRef = useRef(null);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(media.duration || 0);
  const [playing, setPlaying] = useState(false);
  const [markIn, setMarkIn] = useState(null);
  const [markOut, setMarkOut] = useState(null);
  useEffect(() => {
    setPos(0); setMarkIn(null); setMarkOut(null); setPlaying(false);
    setDur(media.duration || 0);
  }, [media.id]);
  const seek = (v) => {
    const el = elRef.current;
    setPos(v);
    if (el && el.currentTime != null) el.currentTime = v;
  };
  const togglePlay = () => {
    const el = elRef.current;
    if (!el || !el.play) return;
    if (playing) el.pause();
    else el.play().catch(() => {});
    setPlaying(!playing);
  };
  const rangeIn = markIn ?? 0;
  const rangeOut = markOut ?? dur;
  const validRange = dur > 0 && rangeOut > rangeIn;
  const insert = () => {
    if (!onInsert) return;
    onInsert(media.id, validRange ? { in: rangeIn, out: rangeOut } : {});
  };
  return (
    <div className="source-monitor" aria-label={`Source monitor — ${media.name}`}>
      <div className="source-monitor-head">
        <b className="source-monitor-name" title={media.name}>{media.name}</b>
        <button type="button" className="icon-btn sm" aria-label="Close source monitor" onClick={onClose}>✕</button>
      </div>
      {media.type === 'video' && (
        <video ref={elRef} className="source-monitor-media" src={toFileUrl(media.path)} preload="metadata" muted
          onTimeUpdate={(e) => setPos(e.target.currentTime)}
          onLoadedMetadata={(e) => setDur(e.target.duration || media.duration || 0)} />
      )}
      {media.type === 'image' && (
        <img className="source-monitor-media" src={toFileUrl(media.path)} alt={media.name} draggable={false} />
      )}
      {media.type === 'audio' && (
        <audio ref={elRef} src={toFileUrl(media.path)} preload="metadata"
          onTimeUpdate={(e) => setPos(e.target.currentTime)}
          onLoadedMetadata={(e) => setDur(e.target.duration || media.duration || 0)} />
      )}
      {media.type === 'audio' && media.wave && (
        <img className="source-monitor-wave" src={toFileUrl(media.wave)} alt="" draggable={false} />
      )}
      <div className="source-monitor-scrub">
        <button type="button" className="btn btn-sm" onClick={togglePlay} aria-label={playing ? 'Pause source' : 'Play source'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <input type="range" min={0} max={dur || 0} step={0.01} value={Math.min(pos, dur || 0)} aria-label="Source position"
          disabled={!(dur > 0)} onChange={(e) => seek(Number(e.target.value))} />
        <span className="dim small">{formatTime(pos)} / {formatTime(dur || 0)}</span>
      </div>
      <div className="source-monitor-marks">
        <button type="button" className="btn btn-sm" onClick={() => setMarkIn(pos)} title="Mark source In at the current position">Mark In <b>{markIn == null ? '—' : formatTime(markIn)}</b></button>
        <button type="button" className="btn btn-sm" onClick={() => setMarkOut(pos)} title="Mark source Out at the current position">Mark Out <b>{markOut == null ? '—' : formatTime(markOut)}</b></button>
        {(markIn != null || markOut != null) && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMarkIn(null); setMarkOut(null); }}>Clear marks</button>
        )}
      </div>
      <div className="source-monitor-insert">
        <button type="button" className="btn btn-primary btn-sm" onClick={insert}>
          Insert at playhead{validRange ? ` (${formatTime(rangeIn)} – ${formatTime(rangeOut)})` : ''}
        </button>
        <span className="dim small">Inserts only the marked range; no marks inserts the whole clip.</span>
      </div>
    </div>
  );
}
