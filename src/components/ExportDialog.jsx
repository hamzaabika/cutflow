// Export dialog: the SETTINGS FORM for an export job (cover + output + quality).
// Starting the export enqueues a job and closes this dialog — progress, the
// queue and the completion card live in the jobs tray (ExportJobsTray.jsx), so
// the user keeps editing while exports run. Every number on the form comes
// from the SAME resolved settings object the encoder consumes
// (src/exportQuality.js) — the form writes the stored settings, App
// re-resolves, and the summary below is that object, never display text.
// Durations likewise come from the encoder's own basis, exportDuration() in
// src/store.js — the video-track layout end the pipeline totals in
// electron/ffmpeg.cjs — never projectDuration(), which also counts text/audio
// ends the encode does not follow. Capability honesty is stated up front, in
// the form: WebM is disabled when the build lacks VP9, and a GIF timeline over
// the engine's own 30 s limit (GIF_MAX_SECONDS in electron/ffmpeg.cjs) is
// refused here with the engine's wording instead of failing after the fact.
import React, { useEffect, useState } from 'react';
import { ChevronDown, Clapperboard, ImagePlus, X } from '../icons.jsx';
import {
  AUDIO_RATES, CUSTOM_DEFAULTS, ENCODER_PRESETS, EXPORT_PRESETS, EXPORT_PRESET_ORDER, FPS_CHOICES,
  GIF_FPS_CHOICES, GIF_SIZES, estimateExport, settingsPatch, storedExportSettings, summaryRows,
} from '../exportQuality.js';
import { GIF_MAX_SECONDS, gifLimitMessage } from '../exportJobs.js';
import { exportDuration, toFileUrl } from '../store.js';
import { coverTargetFor, posterFracAt, posterSourceFor, spriteFrameStyle } from '../recents.js';
import Dropdown from './Dropdown.jsx';
import Slider from './Slider.jsx';
import NumBox from './NumBox.jsx';
import Toggle from '../ui/Toggle.jsx';

const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;
const fmtMB = (mb) => (mb >= 100 ? mb.toFixed(0) : mb.toFixed(1));

// The cover preview ALWAYS shows a full-resolution frame of the original media at the cover
// time (grabbed by the main process via media:frame — never a proxy, never a thumbnail-sprite
// frame; the sprite only fills in for the first instant while the grab is on its way, and the
// previous grab stays up while scrubbing until the new one lands). The frame shown is the
// frame the export embeds: coverTargetFor maps the timeline time exactly like the embed does.
// Two honesty guards (Part 4, 2026-11-10): the sprite stand-in shows the frame nearest the
// chosen cover time (posterFracAt), not always frame 0; and if the full-res grab fails even
// after one retry, a note says the stand-in is only a preview — never a silent blur.
function Cover({ project, coverT, setCoverT, choosing, setChoosing, onPosterAt }) {
  const dur = exportDuration(project);
  const target = coverTargetFor(project, coverT);
  const tKey = target && target.kind === 'video' ? `${target.media.path}|${target.at.toFixed(2)}` : null;
  const [frame, setFrame] = useState(null); // { key, url } — the latest full-res grab
  const [grabFailed, setGrabFailed] = useState(false); // for the CURRENT target key
  useEffect(() => {
    if (!tKey || !window.api?.frameGrab) return undefined;
    let live = true;
    setGrabFailed(false);
    const attempt = (n) => {
      window.api.frameGrab(target.media.path, target.at)
        .then((r) => {
          if (!live) return;
          if (r && r.ok) setFrame({ key: tKey, url: toFileUrl(r.path) });
          else if (n < 1) setTimeout(() => { if (live) attempt(n + 1); }, 600);
          else setGrabFailed(true);
        })
        .catch(() => {
          if (!live) return;
          if (n < 1) setTimeout(() => { if (live) attempt(n + 1); }, 600);
          else setGrabFailed(true);
        });
    };
    const h = setTimeout(() => attempt(0), 120);
    return () => { live = false; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tKey]);
  const sprite = !frame && target && target.kind === 'video' ? posterSourceFor(project, toFileUrl) : null;
  const spriteStyle = sprite && sprite.kind === 'sprite' ? spriteFrameStyle(sprite.thumb, posterFracAt(project, coverT) ?? 0) : null;
  return (
    <div className="x-cover-col">
      <div className="x-cover" style={{ ...(spriteStyle || {}), aspectRatio: `${project.width} / ${project.height}` }}>
        {target && target.kind === 'image' && <img src={toFileUrl(target.media.path)} alt="" draggable={false} />}
        {target && target.kind === 'video' && frame && <img src={frame.url} alt="" draggable={false} />}
        {!target && <Clapperboard size={30} className="x-cover-icon" />}
        {target && target.kind === 'video' && !frame && !spriteStyle && <Clapperboard size={30} className="x-cover-icon" />}
      </div>
      <button type="button" className="btn btn-sm x-cover-btn" onClick={() => setChoosing(!choosing)}>
        <ImagePlus size={14} /> {choosing ? 'Done' : 'Choose cover'}
      </button>
      {grabFailed && target && target.kind === 'video' && (
        <span className="x-cover-warn">Full-quality frame unavailable — showing a preview stand-in. The exported cover still grabs from the original file.</span>
      )}
      {choosing && (
        <div className="x-cover-pick">
          <input type="range" min="0" max={Math.max(0.1, dur)} step={1 / (project.fps || 30)} value={coverT}
            aria-label="Cover frame time"
            onChange={(e) => { const t = Number(e.target.value); setCoverT(t); onPosterAt(t); }} />
          <span className="x-cover-time">Cover at {fmtDur(coverT)} — also becomes the project card picture.</span>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }) {
  return <div className="x-row"><span className="x-row-label">{label}</span><div className="x-row-ctl">{children}</div></div>;
}

function Group({ title, children }) {
  return (
    <div className="x-group">
      <div className="x-group-title">{title}</div>
      {children}
    </div>
  );
}

export default function ExportDialog({ state, onClose, onStart, onPickTarget, onRename, onSettings, onResolution, onPosterAt }) {
  const [choosing, setChoosing] = useState(false);
  const [details, setDetails] = useState(false);
  const [coverT, setCoverT] = useState(() => (typeof state.project?.posterAt === 'number' ? state.project.posterAt : 0));

  const { project, eff } = state;
  const stored = storedExportSettings(project);
  const custom = { ...CUSTOM_DEFAULTS, ...(stored.custom || {}) };
  const setCustom = (field) => onSettings(settingsPatch(project, { preset: 'custom', custom: { ...custom, ...field } }));
  const dur = exportDuration(project);
  const est = estimateExport(eff, dur);
  const longest = Math.max(project.width, project.height);
  const capsList = [2160, 1440, 1080, 720, 480];
  const captionCount = (project.textClips || []).filter((c) => c.caption).length;
  const setFormatField = (field) => onSettings(settingsPatch(project, { preset: stored.preset, custom, ...field }));
  // The format's own honesty notes, stated where the choice is made rather than
  // only inside the collapsed summary: the WebM capability/CPU notes, the GIF
  // scope note, and the subtitle-track scope note when the toggle is on.
  const gifOver = eff.format === 'gif' && dur > GIF_MAX_SECONDS;
  const formatNotes = eff.notes.filter((n) => (
    n.startsWith('WebM') || n.startsWith('The subtitle track') || (n.startsWith('GIF export') && !gifOver)
  ));
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div className="modal export-modal">
        <div className="x-head">
          <h3 id="export-title">Export video</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="x-body">
          <Cover project={project} coverT={coverT} setCoverT={setCoverT} choosing={choosing} setChoosing={setChoosing} onPosterAt={onPosterAt} />
          <div className="x-form">
            <Group title="Output">
              <Row label="Name">
                <input type="text" value={state.name || ''} onChange={(e) => onRename(e.target.value)} aria-label="Output file name" />
              </Row>
              <Row label="Export to">
                <span className="x-path" title={state.target?.file || ''}>{state.target ? state.target.file : 'Not chosen yet'}</span>
                <button type="button" className="btn btn-sm" onClick={() => onPickTarget(state.name)}>Browse…</button>
              </Row>
              <Row label="Format">
                <Dropdown value={eff.format} ariaLabel="Format"
                  onChange={(v) => setFormatField({ format: v })}
                  options={[
                    { value: 'mp4', label: 'MP4' },
                    { value: 'mov', label: 'MOV' },
                    { value: 'webm', label: `WebM${state.caps && state.caps.vp9 === false ? ' (not in this build)' : ''}`, disabled: state.caps && state.caps.vp9 === false },
                    { value: 'gif', label: 'GIF' },
                  ]} />
              </Row>
              {formatNotes.map((n) => <p key={n} className="x-note">{n}</p>)}
              {gifOver && <p className="x-note error" role="alert">{gifLimitMessage(dur)}</p>}
              {(eff.format === 'mp4' || eff.format === 'mov') && captionCount > 0 && (
                <Row label="Subtitle track">
                  <Toggle checked={!!eff.subtitleTrack} aria-label="Include subtitle track"
                    onChange={(e) => setFormatField({ subtitleTrack: e.target.checked })} />
                  <span className="x-num">mov_text</span>
                </Row>
              )}
            </Group>
            {eff.format === 'gif' && (
              <Group title="GIF">
                <Row label="Size">
                  <Dropdown value={eff.gifSize} ariaLabel="GIF size" onChange={(v) => setFormatField({ gifSize: v })}
                    options={GIF_SIZES.map((s) => ({ value: s, label: `${s}p` }))} />
                </Row>
                <Row label="Frame rate">
                  <Dropdown value={eff.gifFps} ariaLabel="GIF frame rate" onChange={(v) => setFormatField({ gifFps: v })}
                    options={GIF_FPS_CHOICES.map((f) => ({ value: f, label: `${f} fps` }))} />
                </Row>
              </Group>
            )}
            {eff.format !== 'gif' && (
              <Group title="Quality">
                <Row label="Resolution">
                  <Dropdown value={eff.resCap} ariaLabel="Resolution" onChange={(v) => onResolution(v)}
                    options={[
                      { value: 0, label: `Native · ${project.width}×${project.height}` },
                      ...capsList.map((c) => ({ value: c, label: `${c}p${c >= longest ? ' (above project size)' : ''}`, disabled: c >= longest })),
                    ]} />
                </Row>
                <Row label="Quality">
                  <Dropdown value={eff.preset} ariaLabel="Quality"
                    onChange={(v) => onSettings(settingsPatch(project, { preset: v, custom }))}
                    options={EXPORT_PRESET_ORDER.map((id) => ({ value: id, label: id === 'custom' ? 'Custom' : EXPORT_PRESETS[id].name }))} />
                </Row>
                {eff.preset === 'custom' && (
                  <div className="x-custom">
                    <Row label="Mode">
                      <div className="seg-tabs x-seg" role="tablist" aria-label="Quality mode">
                        <button type="button" role="tab" aria-selected={custom.mode === 'crf'} className={custom.mode === 'crf' ? 'on' : ''} onClick={() => setCustom({ mode: 'crf' })}>CRF</button>
                        <button type="button" role="tab" aria-selected={custom.mode === 'bitrate'} className={custom.mode === 'bitrate' ? 'on' : ''} onClick={() => setCustom({ mode: 'bitrate' })}>Bitrate</button>
                      </div>
                    </Row>
                    {custom.mode === 'crf' ? (
                      <Slider label="CRF" value={custom.crf} min={0} max={51} step={1}
                        onChange={(crf) => setCustom({ crf })} />
                    ) : (
                      <Row label="Bitrate">
                        <NumBox label="" value={custom.bitrateMbps} step={0.5} min={0.5} max={100} suffix="Mbps" ariaLabel="Bitrate in megabits per second"
                          onChange={(v) => setCustom({ bitrateMbps: v })} />
                      </Row>
                    )}
                    <Row label="Codec">
                      {eff.format === 'webm' ? (
                        <span className="x-static">VP9 · libvpx-vp9</span>
                      ) : (
                        <Dropdown value={custom.codec} onChange={(v) => setCustom({ codec: v })} ariaLabel="Codec"
                          options={[
                            { value: 'h264', label: 'H.264' },
                            { value: 'h265', label: `H.265${state.caps && state.caps.libx265 === false ? ' (not in this build)' : ''}`, disabled: state.caps && state.caps.libx265 === false },
                          ]} />
                      )}
                    </Row>
                    <Row label="Frame rate">
                      <Dropdown value={custom.fps} onChange={(v) => setCustom({ fps: v })} ariaLabel="Frame rate"
                        options={FPS_CHOICES.map((f) => ({ value: f, label: f === 0 ? `Project (${project.fps} fps)` : `${f} fps` }))} />
                    </Row>
                    <Row label="Encoder">
                      <Dropdown value={custom.encoderPreset} onChange={(v) => setCustom({ encoderPreset: v })} ariaLabel="Encoder preset"
                        options={ENCODER_PRESETS.map((p) => ({ value: p, label: p }))} />
                    </Row>
                    <Row label="Audio">
                      <Dropdown value={custom.audioKbps} onChange={(v) => setCustom({ audioKbps: v })} ariaLabel="Audio bitrate"
                        options={AUDIO_RATES.map((a) => ({ value: a, label: `${a} kbps` }))} />
                    </Row>
                  </div>
                )}
                <Row label="Est. bitrate"><span className="x-static">{est.exact ? `${est.videoMbps} Mbps` : `≈ ${est.videoMbps.toFixed(1)} Mbps`}</span></Row>
              </Group>
            )}
            <button type="button" className="x-details-toggle" onClick={() => setDetails(!details)} aria-expanded={details}>
              <ChevronDown size={14} style={{ transform: details ? 'rotate(180deg)' : 'none' }} /> Export summary
            </button>
            {details && (
              <div className="export-summary">
                {summaryRows(eff, project).map(([k, v]) => (
                  <div key={k} className="export-summary-row"><span>{k}</span><b>{v}</b></div>
                ))}
                {eff.notes.map((n) => <p key={n} className="export-dialog-note">{n}</p>)}
              </div>
            )}
          </div>
        </div>
        <div className="x-foot">
          <div className="x-foot-left">
            <span className="x-foot-meta" title={est.exact ? 'Size computed from your bitrate settings.' : 'Estimated from resolution, frame rate and quality — the real size depends on the footage.'}>
              Duration {fmtDur(dur)} · Size: {est.exact ? '' : '≈ '}{fmtMB(est.mb)} MB
            </span>
            {state.queueAhead > 0 && (
              <span className="x-queue-hint">{state.queueAhead === 1 ? 'Another export is running' : `${state.queueAhead} exports are in the queue`} — this one runs when its turn comes.</span>
            )}
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={onStart} disabled={gifOver}>Export</button>
          </div>
        </div>
      </div>
    </div>
  );
}
