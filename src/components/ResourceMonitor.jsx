import React, { useEffect, useState } from 'react';
import { Gauge, X } from '../icons.jsx';
import { useT } from '../i18n/index.jsx';

// Built-in resource monitor (P2-36): live CPU / RAM / GPU numbers plus the
// per-job cost of finished exports. It polls the main process every 2 s —
// never per frame, and its state lives only in this dialog, so the monitor
// itself costs no frames: opening it does not re-render the editor.
const fmtMB = (n) => (n == null ? '—' : n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${Math.round(n)} MB`);
const fmtSecs = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export default function ResourceMonitor({ open, onClose, jobs = [] }) {
  const t = useT();
  const [metrics, setMetrics] = useState(null);
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const m = await window.api.systemMetrics();
        if (alive) setMetrics(m);
      } catch { /* the dialog just keeps its last numbers */ }
    };
    tick();
    const id = setInterval(tick, 2000);
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => { alive = false; clearInterval(id); window.removeEventListener('keydown', esc); };
  }, [open, onClose]);
  if (!open) return null;
  const done = jobs.filter((j) => j.status === 'done' && j.cost);
  const running = jobs.find((j) => j.status === 'running');
  const sysUsed = metrics ? metrics.system.totalMB - metrics.system.freeMB : null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="resources-title"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal resources-modal">
        <button className="icon-btn about-close" aria-label={t('common.close')} onClick={onClose}><X size={16} /></button>
        <h3 id="resources-title" className="shortcuts-title"><Gauge size={15} aria-hidden="true" /> {t('res.title')}</h3>
        <p className="muted small">{t('res.live')}</p>
        <dl className="resources-grid">
          <dt>{t('res.cpu')}</dt>
          <dd>
            <span className="res-big">{metrics ? `${metrics.app.cpuPercent}%` : '…'}</span>
            <span className="muted"> {t('res.app')} · {t('res.load')} {metrics ? `${metrics.system.load1} / ${metrics.system.cores}` : '…'}</span>
          </dd>
          <dt>{t('res.memory')}</dt>
          <dd>
            <span className="res-big">{metrics ? fmtMB(metrics.app.rssMB) : '…'}</span>
            <span className="muted"> {t('res.app')} · {t('res.system')} {metrics ? `${fmtMB(sysUsed)} / ${fmtMB(metrics.system.totalMB)}` : '…'}</span>
            {metrics && (
              <span className="res-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (sysUsed / metrics.system.totalMB) * 100)}%` }} /></span>
            )}
          </dd>
          <dt>{t('res.gpu')}</dt>
          <dd>
            <span>{metrics ? metrics.gpu.name : '…'}</span>
            <span className="muted"> · {t('res.raster')} {metrics ? metrics.gpu.raster : '…'} · {t('res.videoDecode')} {metrics ? metrics.gpu.videoDecode : '…'}</span>
            <br /><span className="muted small">{t('res.vramUnknown')}</span>
          </dd>
        </dl>
        {metrics?.app.processes?.length > 0 && (
          <table className="resources-table">
            <thead><tr><th>{t('res.process')}</th><th>{t('res.cpu')}</th><th>{t('res.memory')}</th></tr></thead>
            <tbody>
              {metrics.app.processes.slice(0, 5).map((p) => (
                <tr key={`${p.type}-${p.pid}`}><td>{p.type}</td><td>{p.cpu}%</td><td>{fmtMB(p.rssMB)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <h4 className="resources-sub">{t('res.perJob')}</h4>
        {running && (
          <p className="res-running">{running.name || running.title} — {Math.round((running.progress || 0) * 100)}%{running.phase ? ` · ${running.phase}` : ''}</p>
        )}
        {done.length === 0 && !running && <p className="muted">{t('res.noJobs')}</p>}
        {done.length > 0 && (
          <table className="resources-table">
            <thead><tr><th>{t('res.job')}</th><th>{t('res.wall')}</th><th>{t('res.peakRss')}</th><th>{t('res.speed')}</th><th>{t('res.size')}</th></tr></thead>
            <tbody>
              {done.slice(-5).reverse().map((j) => (
                <tr key={j.id}>
                  <td>{j.name || j.title || j.file?.split(/[\\/]/).pop()}</td>
                  <td>{fmtSecs(j.cost.wallMs)}</td>
                  <td>{fmtMB(j.cost.peakRssMB)}</td>
                  <td>{j.cost.speed ? `${j.cost.speed.toFixed(1)}×` : '—'}</td>
                  <td>{j.size ? fmtMB(j.size / 1048576) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
