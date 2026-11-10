// Export jobs tray (R4): the non-modal home of every export job — queued,
// running, done, failed. The export dialog is only a settings form; starting
// an export enqueues a job here and the user keeps editing. Each card tells
// the truth about its job: the phases it actually passes through (src/
// exportJobs.js derives them from the pipeline's own branches), the overall
// progress, and on completion the format, duration, size, file location and
// cover outcome — including when the cover could NOT be embedded, in the
// export's own words.
import React from 'react';
import { Check, CircleAlert, CircleCheck, Clock, FolderOpen, Loader2, Play, X } from '../icons.jsx';
import { phaseStates } from '../exportJobs.js';

const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;
const fmtMB = (bytes) => (bytes / 1e6 >= 100 ? (bytes / 1e6).toFixed(0) : (bytes / 1e6).toFixed(1));
const baseName = (file) => String(file || '').split(/[\\/]/).pop();

function Phases({ job }) {
  const states = phaseStates(job.phases || [], job.phase, job.status);
  if (!states.length) return null;
  return (
    <div className="xjob-phases" aria-label="Export phases">
      {states.map((p) => (
        <span key={p.id} className={`xjob-phase ${p.state}`}>
          {p.state === 'done' ? <Check size={11} /> : p.state === 'active' ? <Loader2 size={11} className="spin" /> : null}
          {p.label}
        </span>
      ))}
    </div>
  );
}

function JobCard({ job, onCancelJob, onDismissJob, onShow, onOpen }) {
  const pct = Math.round((job.progress || 0) * 100);
  const active = (job.phases || []).find((p) => p.id === job.phase);
  return (
    <div className="xjob" role="status">
      <div className="xjob-head">
        {job.status === 'done' ? <CircleCheck size={15} className="xjob-ic ok" />
          : job.status === 'error' ? <CircleAlert size={15} className="xjob-ic error" />
            : job.status === 'queued' ? <Clock size={15} className="xjob-ic" />
              : <Loader2 size={15} className="spin xjob-ic" />}
        <b className="xjob-title" title={job.file || job.title}>{baseName(job.file) || job.title}</b>
        <span className="xjob-fmt">{job.formatLabel}</span>
        {(job.status === 'done' || job.status === 'error') && (
          <button type="button" className="icon-btn sm" aria-label="Dismiss" onClick={() => onDismissJob(job.id)}><X size={13} /></button>
        )}
      </div>

      {job.status === 'queued' && (
        <div className="xjob-line">
          <span>Queued — starts when the current export finishes.{job.kind === 'audio' ? ' The save dialog opens when it starts.' : ''}</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onCancelJob(job.id)}>Cancel</button>
        </div>
      )}

      {job.status === 'running' && (
        <>
          <div className="xjob-line">
            <span aria-live="polite">{active ? active.stage : job.stage || 'Exporting'}…</span>
            <span className="xjob-pct">{pct}%</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onCancelJob(job.id)}>Cancel</button>
          </div>
          <div className="progress xjob-bar"><div style={{ width: `${pct}%` }} /></div>
          <Phases job={job} />
        </>
      )}

      {job.status === 'done' && (
        <>
          <div className="xjob-state">Export complete</div>
          <div className="xjob-meta">
            {[job.formatLabel, job.duration != null ? fmtDur(job.duration) : null, job.size ? `${fmtMB(job.size)} MB` : null]
              .filter(Boolean).join(' · ')}
          </div>
          <div className="xjob-path" title={job.file}>{job.file}</div>
          {job.cover === 'embedded' && <div className="xjob-note">Cover picture embedded.</div>}
          {job.coverNote && <div className="xjob-note">{job.coverNote}</div>}
          <div className="xjob-actions">
            <button type="button" className="btn btn-sm" onClick={() => onShow(job.file)}><FolderOpen size={13} /> Show in folder</button>
            <button type="button" className="btn btn-sm" onClick={() => onOpen(job.file)}><Play size={13} /> Open file</button>
          </div>
        </>
      )}

      {job.status === 'error' && (
        <>
          <div className="xjob-err-title">Export failed</div>
          <pre className="xjob-error">{job.error}</pre>
        </>
      )}
    </div>
  );
}

export default function ExportJobsTray({ jobs, onCancelJob, onDismissJob, onShow, onOpen }) {
  if (!jobs.length) return null;
  return (
    <div className="xjobs" aria-label="Export jobs">
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} onCancelJob={onCancelJob} onDismissJob={onDismissJob} onShow={onShow} onOpen={onOpen} />
      ))}
    </div>
  );
}
