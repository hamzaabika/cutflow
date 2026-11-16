// Export jobs tray (R4): the non-modal home of every export job — queued,
// running, done, failed. The export dialog is only a settings form; starting
// an export enqueues a job here and the user keeps editing. Each card tells
// the truth about its job: the phases it actually passes through (src/
// exportJobs.js derives them from the pipeline's own branches), the overall
// progress, and on completion the format, duration, size, file location and
// cover outcome — including when the cover could NOT be embedded, in the
// export's own words.
import React, { useState } from 'react';
import { Check, CircleAlert, CircleCheck, Clock, FolderOpen, Loader2, Pause, Play, X } from '../icons.jsx';
import { canPauseRunning, phaseStates } from '../exportJobs.js';
import { loudnessVerdict } from '../loudnessReport.js';
import { useT } from '../i18n/index.jsx';

const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;
const fmtMB = (bytes) => (bytes / 1e6 >= 100 ? (bytes / 1e6).toFixed(0) : (bytes / 1e6).toFixed(1));
const fmtLoud = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
const baseName = (file) => String(file || '').split(/[\\/]/).pop();

// FB-18 (P1-24): a failed export says what happened in plain language,
// naming the clip when the failure names its file. The raw ffmpeg log is
// NOT the message anymore — it lives behind a details toggle for the cases
// where it is actually needed. Jobs from before this change carry no
// errorCode and keep showing their stored error text as before.
function ErrorCard({ job, onRetryJob }) {
  const t = useT();
  const [showRaw, setShowRaw] = useState(false);
  const code = typeof job.errorCode === 'string' && job.errorCode ? job.errorCode : null;
  const human = code ? t('exportErr.' + code, { clip: job.errorClip ? `“${job.errorClip}”` : t('exportErr.aClip') }) : null;
  const raw = job.errorRaw || job.error || '';
  return (
    <>
      <div className="xjob-err-title">{t('tray.failed')}{(job.attempts || 1) > 1 ? ` · ${t('tray.attempt', { n: job.attempts })}` : ''}</div>
      {human ? <div className="xjob-note error" role="alert">{human}</div> : <pre className="xjob-error">{raw}</pre>}
      {raw && human && (
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? t('exportErr.hideDetails') : t('exportErr.showDetails')}
          </button>
          {showRaw && <pre className="xjob-error">{raw}</pre>}
        </>
      )}
      <div className="xjob-actions">
        <button type="button" className="btn btn-sm" onClick={() => onRetryJob(job.id)}>{t('tray.retry')}</button>
      </div>
    </>
  );
}

function Phases({ job }) {
  const t = useT();
  const states = phaseStates(job.phases || [], job.phase, job.status);
  if (!states.length) return null;
  return (
    <div className="xjob-phases" aria-label={t('tray.phases')}>
      {states.map((p) => (
        <span key={p.id} className={`xjob-phase ${p.state}`}>
          {p.state === 'done' ? <Check size={11} /> : p.state === 'active' ? <Loader2 size={11} className="spin" /> : null}
          {t('exp.phase.' + p.id)}
        </span>
      ))}
    </div>
  );
}

// AU-07: the loudness report, as a visible block — not one line. Target
// (profile + integrated/true-peak ceilings), what was measured before
// mastering, the gain applied, and the final numbers with a verdict (on
// target / over the true-peak ceiling / off target). When mastering was off
// the report is measurement-only: no target, no gain, no verdict beyond the
// numbers themselves. Nothing renders when nothing was measured (silence /
// no audio).
function LoudnessReport({ loudness }) {
  const t = useT();
  if (!loudness || !loudness.final || !Number.isFinite(loudness.final.integrated)) return null;
  const { target, measured, final } = loudness;
  const verdict = loudnessVerdict(loudness);
  const profile = target ? (target.id === 'custom' ? t('exp.loudnessCustom') : t('exp.loudness' + target.id[0].toUpperCase() + target.id.slice(1))) : null;
  const gain = (loudness.gainDb >= 0 ? '+' : '') + fmtLoud(loudness.gainDb);
  return (
    <div className="xjob-loudness" role="group" aria-label={t('tray.loudnessTitle')}>
      <div className="xjob-loud-title">{t('tray.loudnessTitle')}</div>
      {target && <div className="xjob-note">{t('tray.loudnessTarget', { profile, i: fmtLoud(target.I), tp: fmtLoud(target.TP) })}</div>}
      {measured && measured !== final && <div className="xjob-note">{t('tray.loudnessMeasured', { i: fmtLoud(measured.integrated), tp: fmtLoud(measured.truePeak) })}</div>}
      {target && <div className="xjob-note">{t('tray.loudnessGain', { g: gain })}</div>}
      <div className="xjob-note">{t('tray.loudnessFinal', { i: fmtLoud(final.integrated), lra: fmtLoud(final.lra), tp: fmtLoud(final.truePeak) })}</div>
      {verdict === 'on-target' && <div className="xjob-note">{t('tray.loudnessOnTarget')}</div>}
      {verdict === 'off-target' && <div className="xjob-note">{t('tray.loudnessOffTarget', { i: fmtLoud(target.I) })}</div>}
      {verdict === 'over-tp' && <div className="xjob-note error" role="alert">{t('tray.loudnessClipped', { tp: fmtLoud(final.truePeak) })}</div>}
      {verdict === 'measured-only' && <div className="xjob-note">{t('tray.loudnessMeasuredOnly')}</div>}
    </div>
  );
}

// P1-57: the automatic export quality check, as reported on the done card.
// A pass is one quiet line; a warn/fail lists every finding in the user's
// language, with the first run's timestamp so they can find it in the file.
function QcReport({ qc }) {
  const t = useT();
  if (!qc || !qc.findings) return null;
  if (qc.verdict === 'pass') return <div className="xjob-note">{t('tray.qcPass')}</div>;
  const totalSecs = (runs) => (runs || []).reduce((s, r) => s + Math.max(0, r.end - r.start), 0);
  const line = (f) => {
    switch (f.id) {
      case 'dims': return t('tray.qcDims', { ew: f.expected.width, eh: f.expected.height, aw: f.actual.width, ah: f.actual.height });
      case 'fps': return t('tray.qcFps', { ef: f.expected.fps, af: (+f.actual.fps).toFixed(2) });
      case 'duration': return t('tray.qcDuration', { ed: (+f.expected.duration).toFixed(1), ad: (+f.actual.duration).toFixed(1) });
      case 'no-audio': return t('tray.qcNoAudio');
      case 'silent-all': return t('tray.qcSilentAll');
      case 'black': return t('tray.qcBlack', { n: f.runs.length, s: totalSecs(f.runs).toFixed(1), at: fmtDur(f.runs[0].start) });
      case 'frozen': return t('tray.qcFrozen', { n: f.runs.length, s: totalSecs(f.runs).toFixed(1), at: fmtDur(f.runs[0].start) });
      case 'silent': return t('tray.qcSilent', { n: f.runs.length, s: totalSecs(f.runs).toFixed(1), at: fmtDur(f.runs[0].start) });
      case 'font': return t('tray.qcFont', { font: f.font });
      default: return f.detail || f.id;
    }
  };
  return (
    <>
      <div className={`xjob-note ${qc.verdict === 'fail' ? 'error' : ''}`} role={qc.verdict === 'fail' ? 'alert' : undefined}>
        {qc.verdict === 'fail' ? t('tray.qcFail') : t('tray.qcWarn')}
      </div>
      {qc.findings.map((f, i) => (
        <div key={i} className={`xjob-note ${f.level === 'fail' ? 'error' : ''}`}>{line(f)}</div>
      ))}
    </>
  );
}

function JobCard({ job, onCancelJob, onDismissJob, onPauseJob, onResumeJob, onRetryJob, onShow, onOpen }) {
  const t = useT();
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
        {job.paused && (job.status === 'queued' || job.status === 'running') && (
          <span className="xjob-fmt">{t('tray.paused')}</span>
        )}
        {(job.status === 'done' || job.status === 'error') && (
          <button type="button" className="icon-btn sm" aria-label={t('tray.dismiss')} onClick={() => onDismissJob(job.id)}><X size={13} /></button>
        )}
      </div>

      {job.status === 'queued' && (
        <div className="xjob-line">
          <span>{t('tray.queued')}{job.kind === 'audio' ? t('tray.queuedAudio') : ''}</span>
          {job.paused
            ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => onResumeJob(job.id)}><Play size={13} /> {t('tray.resume')}</button>
            : <button type="button" className="btn btn-sm btn-ghost" onClick={() => onPauseJob(job.id)}><Pause size={13} /> {t('tray.pause')}</button>}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onCancelJob(job.id)}>{t('common.cancel')}</button>
        </div>
      )}

      {job.status === 'running' && (
        <>
          <div className="xjob-line">
            <span aria-live="polite">{job.paused ? t('tray.pausedNote') : active ? t('exp.stage.' + active.id) : job.stage || t('tray.exporting')}…</span>
            <span className="xjob-pct">{pct}%</span>
            {job.paused
              ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => onResumeJob(job.id)}><Play size={13} /> {t('tray.resume')}</button>
              : canPauseRunning(job)
                ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => onPauseJob(job.id)}><Pause size={13} /> {t('tray.pause')}</button>
                : null}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onCancelJob(job.id)}>{t('common.cancel')}</button>
          </div>
          <div className="progress xjob-bar"><div style={{ width: `${pct}%` }} /></div>
          <Phases job={job} />
        </>
      )}

      {job.status === 'done' && (
        <>
          <div className="xjob-state">{t('tray.complete')}</div>
          <div className="xjob-meta">
            {[job.formatLabel, job.duration != null ? fmtDur(job.duration) : null, job.size ? `${fmtMB(job.size)} MB` : null]
              .filter(Boolean).join(' · ')}
          </div>
          <div className="xjob-path" title={job.file}>{job.file}</div>
          {job.loudness && <LoudnessReport loudness={job.loudness} />}
          {job.qc && <QcReport qc={job.qc} />}
          {job.cover === 'embedded' && <div className="xjob-note">{t('tray.coverEmbedded')}</div>}
          {job.coverNote && <div className="xjob-note">{job.coverNote}</div>}
          {job.note && <div className="xjob-note">{job.note}</div>}
          <div className="xjob-actions">
            <button type="button" className="btn btn-sm" onClick={() => onShow(job.file)}><FolderOpen size={13} /> {t('tray.showInFolder')}</button>
            <button type="button" className="btn btn-sm" onClick={() => onOpen(job.file)}><Play size={13} /> {t('tray.openFile')}</button>
          </div>
        </>
      )}

      {job.status === 'error' && (
        <ErrorCard job={job} onRetryJob={onRetryJob} />
      )}
    </div>
  );
}

// P1-52 — Background: proxy / visuals work runs in the main process and
// must not be silent. While a preview copy is being made the tray shows it;
// when one failed, the tray says which file and offers one Retry for all of
// them (the same forced re-queue the Library tile's Retry button makes).
// The media-cache line is the polled proxy:status figure (null = unknown).
function BackgroundSection({ proxy, onRetryProxies }) {
  const t = useT();
  const optimizing = proxy?.optimizing || [];
  const failed = proxy?.failed || [];
  if (!optimizing.length && !failed.length) return null;
  return (
    <div className="xjob" role="status">
      <div className="xjob-head">
        <Loader2 size={15} className={optimizing.length ? 'spin xjob-ic' : 'xjob-ic'} />
        <b className="xjob-title">{t('tray.background')}</b>
      </div>
      {optimizing.map((m) => (
        <div key={m.id || m.path} className="xjob-line">
          <span>{baseName(m.name || m.path)}</span>
          <span className="xjob-pct">{t('tray.optimizing')}</span>
        </div>
      ))}
      {failed.map((m) => (
        <div key={m.id || m.path} className="xjob-line">
          <span>{baseName(m.name || m.path)}</span>
          <span className="xjob-pct">{t('tray.proxyFailed')}</span>
        </div>
      ))}
      {failed.length > 0 && (
        <div className="xjob-actions">
          <button type="button" className="btn btn-sm" onClick={onRetryProxies}>{t('tray.retryProxies')}</button>
        </div>
      )}
    </div>
  );
}

// The proxy cache line belongs to the tray itself, not to the background section:
// it is the answer to "did my preview copies finish, and how much disk do they
// take?" — and the background section returns null exactly when nothing is
// building, i.e. exactly when the user would check. Shown whenever the tray is
// open and the polled figure is known.
function CacheLine({ cache }) {
  const t = useT();
  if (!cache) return null;
  return <div className="xjob-note">{t('tray.cacheLine', { files: cache.files, mb: fmtMB(cache.bytes) })}</div>;
}

// ---- System status (FB-30 / P1-45) ----
// Every async job in one place, so none runs silently: proxy copies,
// AI model downloads and readiness, audio-preview renders, the effect
// cache, and the live main-process jobs (captions, translate, matting,
// reframe, enhance, audio effects). Progress comes from the main
// process's own progress events (several of which previously had NO
// subscriber anywhere — the audio-preview renders especially ran
// invisible); cancel goes to the existing cancel IPCs; a missing model
// offers Retry, which re-runs its install. The section renders whenever
// the tray is open; the tray itself opens whenever a system job is active.
function JobRow({ job, onCancel }) {
  const t = useT();
  const pct = job.fraction == null ? null : Math.round(job.fraction * 100);
  return (
    <div className="xjob-line">
      <span>{t(`sys.job.${job.kind}`)}{job.stage && job.stage !== job.kind ? ` · ${job.stage}` : ''}</span>
      {pct != null && <span className="xjob-pct">{pct}%</span>}
      {pct == null && <Loader2 size={13} className="spin" />}
      {job.cancelable && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onCancel(job.kind)}>{t('common.cancel')}</button>
      )}
      {pct != null && (
        <span className="progress xjob-bar" aria-hidden="true" style={{ display: 'inline-block', width: 80, verticalAlign: 'middle' }}>
          <span style={{ display: 'block', width: `${pct}%` }} />
        </span>
      )}
    </div>
  );
}

function ModelRow({ label, state, retryId, onRetryModel }) {
  const t = useT();
  if (state == null) return null;
  return (
    <div className="xjob-line">
      <span>{label}</span>
      <span className="xjob-pct">{state}</span>
      {retryId && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onRetryModel(retryId)}>{t('common.retry')}</button>
      )}
    </div>
  );
}

function SystemSection({ system, audioPreview, onRetryModel }) {
  const t = useT();
  if (!system?.snapshot) return null;
  const { snapshot, jobs, cancel } = system;
  const models = snapshot.models || {};
  const fx = snapshot.fxCache || {};
  const w = models.whisper;
  const piper = models.piper;
  const piperVoices = piper?.voices || [];
  const piperReady = piperVoices.filter((v) => v.downloaded).length;
  const audio = audioPreview || {};
  return (
    <div className="xjob" role="status" aria-label={t('sys.section')}>
      <div className="xjob-head">
        <Loader2 size={15} className={jobs.length ? 'spin xjob-ic' : 'xjob-ic'} />
        <b className="xjob-title">{t('sys.section')}</b>
      </div>
      {jobs.map((job) => <JobRow key={job.kind} job={job} onCancel={cancel} />)}
      <ModelRow label={t('sys.modelWhisper')} state={w == null ? null : w.installed ? t('sys.modelReady', { detail: t('sys.whisperModels', { n: Object.values(w.models || {}).filter(Boolean).length }) }) : t('sys.modelMissing')} retryId={w && !w.installed ? 'whisper-base' : null} onRetryModel={onRetryModel} />
      <ModelRow label={t('sys.modelMatting')} state={models.matting == null ? null : models.matting.installed ? t('sys.modelReadyShort') : t('sys.modelMissing')} retryId={models.matting && !models.matting.installed ? 'matting' : null} onRetryModel={onRetryModel} />
      <ModelRow label={t('sys.modelReframe')} state={models.reframe == null ? null : models.reframe.installed ? t('sys.modelReadyShort') : t('sys.modelMissing')} retryId={models.reframe && !models.reframe.installed ? 'reframe' : null} onRetryModel={onRetryModel} />
      <ModelRow label={t('sys.modelPiper')} state={piper == null ? null : piper.installed ? t('sys.modelReady', { detail: t('sys.piperVoices', { n: piperReady, total: piperVoices.length }) }) : t('sys.modelMissing')} retryId={piper && !piper.installed ? 'piper' : null} onRetryModel={onRetryModel} />
      <div className="xjob-line">
        <span>{t('sys.audioPreview')}</span>
        <span className="xjob-pct">
          {audio.rendering ? t('sys.audioRendering', { pct: audio.fraction == null ? '' : ` ${Math.round(audio.fraction * 100)}%` })
            : audio.pending ? t('sys.audioPending', { n: audio.pending })
              : audio.failed ? t('sys.audioFailed', { n: audio.failed })
                : t('sys.audioReady')}
        </span>
        {audio.rendering && audio.cancelable && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => cancel('audioFx')}>{t('common.cancel')}</button>
        )}
      </div>
      <div className="xjob-line">
        <span>{t('sys.fxCache')}</span>
        <span className="xjob-pct">{t('sys.fxCacheState', { n: fx.entries ?? 0, mb: fmtMB(fx.bytes || 0), cap: Math.round(((fx.capBytes || 0) / 1e6)) })}{fx.active ? ` · ${t('sys.fxActive', { n: fx.active })}` : ''}</span>
      </div>
      {!jobs.length && <div className="xjob-note">{t('sys.idleNote')}</div>}
    </div>
  );
}

export default function ExportJobsTray({ jobs, onCancelJob, onDismissJob, onPauseJob, onResumeJob, onRetryJob, proxy, onRetryProxies, onShow, onOpen, system, audioPreview, onRetryModel }) {
  const t = useT();
  const hasBackground = (proxy?.optimizing?.length || 0) + (proxy?.failed?.length || 0) > 0;
  if (!jobs.length && !hasBackground && !(system?.jobs?.length) && !(audioPreview?.rendering || audioPreview?.pending)) return null;
  return (
    <div className="xjobs" aria-label={t('tray.jobs')}>
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} onCancelJob={onCancelJob} onDismissJob={onDismissJob}
          onPauseJob={onPauseJob} onResumeJob={onResumeJob} onRetryJob={onRetryJob} onShow={onShow} onOpen={onOpen} />
      ))}
      {hasBackground && <BackgroundSection proxy={proxy} onRetryProxies={onRetryProxies} />}
      {!hasBackground && <CacheLine cache={proxy?.cache} />}
      <SystemSection system={system} audioPreview={audioPreview} onRetryModel={onRetryModel} />
    </div>
  );
}
