import React from 'react';
import { MonitorCog, ShieldCheck } from '../icons.jsx';
import { useT } from '../i18n/index.jsx';

// Shown when media placed on the main track does not match the project sequence
// (resolution, aspect ratio or frame rate). Nothing changes until the user picks:
// adopt the clip's settings as the sequence, or keep the sequence and adapt the clip.
export default function SequenceDialog({ media, mismatch, onChangeSettings, onKeepSettings }) {
  const t = useT();
  const { video, project, fields } = mismatch;
  const rows = [
    { key: 'resolution', label: t('insp.resolution'), v: `${video.w} × ${video.h}`, p: `${project.w} × ${project.h}` },
    { key: 'ratio', label: t('insp.aspectRatio'), v: video.ratio || '—', p: project.ratio || '—' },
    { key: 'fps', label: t('insp.frameRate'), v: video.fps ? `${video.fps} ${t('player.fpsUnit')}` : t('seq.unknown'), p: project.fps ? `${project.fps} ${t('player.fpsUnit')}` : t('seq.unknown') },
  ];
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="seq-title">
      <div className="modal seq-modal">
        <h3 id="seq-title">{t('seq.title')}</h3>
        <p className="muted">{t('seq.differs', { name: media.name })}</p>
        <div className="seq-diff">
          <div className="seq-col">
            <span className="seq-col-title">{t('seq.imported')}</span>
            {rows.map((r) => (
              <div key={r.key} className={`seq-row ${fields.includes(r.key) ? 'diff' : ''}`}>
                <span>{r.label}</span><b>{r.v}</b>
              </div>
            ))}
          </div>
          <div className="seq-col">
            <span className="seq-col-title">{t('seq.thisProject')}</span>
            {rows.map((r) => (
              <div key={r.key} className={`seq-row ${fields.includes(r.key) ? 'diff' : ''}`}>
                <span>{r.label}</span><b>{r.p}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-actions seq-actions">
          <button className="btn btn-primary" onClick={onChangeSettings}>
            <MonitorCog size={15} /> {t('seq.changeSettings')}
          </button>
          <button className="btn" onClick={onKeepSettings}>
            <ShieldCheck size={15} /> {t('seq.keepSettings')}
          </button>
        </div>
        <p className="muted small">{t('seq.note', { size: `${video.w} × ${video.h}`, fpsText: video.fps ? t('seq.noteFps', { fps: Math.round(video.fps) }) : '' })}</p>
      </div>
    </div>
  );
}
