// Export quality: presets, Custom settings, and the ONE resolver that turns the stored settings
// (project.exportSettings) into the EFFECTIVE configuration the export pipeline consumes.
// Project Settings, the Export dialog summary and electron/ffmpeg.cjs all read this same resolved
// object (the renderer stamps it onto the project as project.export before exportRun), so what the
// summary shows is exactly what the encoder gets — never display-only text.
//
// Rules (stated, not hidden):
// - Resolution caps apply to the LONGEST side and only ever downscale — nothing is ever upscaled.
// - H.265 always encodes in software (libx265) in this build; if the bundled FFmpeg lacked libx265,
//   the export falls back to H.264 and the summary says so (caps.libx265 comes from the main process).
// - Choosing an fps above the timeline's duplicates frames (the fps filter resamples) — noted.
// - project.crf stays in sync for back-compat: picking a preset (or a Custom CRF) writes its CRF.
// - Format is a stored setting like any other: MP4/MOV take the H.264/H.265 settings, WebM
//   takes the same quality intent through VP9 + Opus (MP4 fallback if the build lacked VP9),
//   GIF takes only its size + frame-rate settings. The audio-only export honours audioKbps
//   from this same resolved object (electron/ffmpeg.cjs: effectiveExport re-clamps it).

export const EXPORT_PRESETS = {
  low: { name: 'Low', mode: 'crf', crf: 28, bitrateMbps: 0, encoderPreset: 'fast', audioKbps: 96, resCap: 720, fps: 0, codec: 'h264', blurb: 'Smallest file' },
  medium: { name: 'Medium', mode: 'crf', crf: 23, bitrateMbps: 0, encoderPreset: 'medium', audioKbps: 128, resCap: 1080, fps: 0, codec: 'h264', blurb: 'Balanced' },
  high: { name: 'High', mode: 'crf', crf: 18, bitrateMbps: 0, encoderPreset: 'slow', audioKbps: 192, resCap: 0, fps: 0, codec: 'h264', blurb: 'Full quality' },
  ultra: { name: 'Ultra', mode: 'crf', crf: 14, bitrateMbps: 0, encoderPreset: 'veryslow', audioKbps: 320, resCap: 0, fps: 0, codec: 'h264', blurb: 'Near-lossless' },
};
export const EXPORT_PRESET_ORDER = ['low', 'medium', 'high', 'ultra', 'custom'];
export const CUSTOM_DEFAULTS = { mode: 'crf', crf: 20, bitrateMbps: 12, resCap: 0, fps: 0, codec: 'h264', encoderPreset: 'veryfast', audioKbps: 192 };
export const ENCODER_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];
export const RES_CAPS = [0, 2160, 1440, 1080, 720, 480]; // 0 = Original (project size)
export const FPS_CHOICES = [0, 24, 25, 30, 50, 60]; // 0 = project fps
export const AUDIO_RATES = [96, 128, 192, 256, 320];
// Output formats (Sprint 3): MP4 and MOV carry the H.264/H.265 settings below; WebM is
// VP9 + Opus through the same quality settings; GIF is a silent palette export with its
// own size / frame-rate choices and ignores the codec settings entirely.
export const EXPORT_FORMATS = ['mp4', 'mov', 'webm', 'gif'];
export const FORMAT_LABELS = { mp4: 'MP4', mov: 'MOV', webm: 'WebM', gif: 'GIF' };
export const GIF_SIZES = [640, 320]; // longest-side caps, like RES_CAPS (never upscale)
export const GIF_FPS_CHOICES = [10, 12, 15, 20, 25, 30];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const snap = (v, list) => list.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), list[0]);

// The format-side stored fields (everything that is not preset/Custom quality): the output
// format, the mov_text subtitle-track toggle, and the GIF size / frame rate. Read tolerantly
// from any era of the stored object — absent fields take the historical defaults (MP4, no
// subtitle track, 640p GIF at 15 fps).
function storedFormatFields(s) {
  return {
    format: s && EXPORT_FORMATS.includes(s.format) ? s.format : 'mp4',
    subtitleTrack: !!(s && s.subtitleTrack),
    gifSize: s && GIF_SIZES.includes(s.gifSize) ? s.gifSize : 640,
    gifFps: s && GIF_FPS_CHOICES.includes(s.gifFps) ? s.gifFps : 15,
  };
}

// The stored settings for a project, migrating the pre-preset era (a bare project.crf) to the
// closest preset by CRF: 28 Light → Low, 23 Standard → Medium, 20 High → High, 16 Very high → Ultra.
export function storedExportSettings(project) {
  const s = project && project.exportSettings;
  if (s && EXPORT_PRESET_ORDER.includes(s.preset)) {
    return { preset: s.preset, custom: { ...CUSTOM_DEFAULTS, ...(s.custom || {}) }, ...storedFormatFields(s) };
  }
  const crf = (project && project.crf) || 20;
  const preset = crf >= 26 ? 'low' : crf >= 21 ? 'medium' : crf >= 17 ? 'high' : 'ultra';
  return { preset, custom: { ...CUSTOM_DEFAULTS, crf }, ...storedFormatFields(s) };
}

// Stored-settings patch for picking a preset / editing Custom, keeping project.crf in sync.
// Format-side fields carry over from the current stored settings unless the patch names them,
// so a quality-only change never resets the chosen format (and vice versa).
export function settingsPatch(project, next) {
  const prev = storedFormatFields(project && project.exportSettings);
  const stored = {
    preset: next.preset,
    custom: { ...CUSTOM_DEFAULTS, ...(next.custom || {}) },
    format: EXPORT_FORMATS.includes(next.format) ? next.format : prev.format,
    subtitleTrack: next.subtitleTrack != null ? !!next.subtitleTrack : prev.subtitleTrack,
    gifSize: GIF_SIZES.includes(next.gifSize) ? next.gifSize : prev.gifSize,
    gifFps: GIF_FPS_CHOICES.includes(next.gifFps) ? next.gifFps : prev.gifFps,
  };
  const patch = { exportSettings: stored };
  const eff = stored.preset === 'custom' ? stored.custom : EXPORT_PRESETS[stored.preset];
  if (eff && eff.mode === 'crf') patch.crf = eff.crf;
  return patch;
}

// Resolve stored settings + project geometry + build capabilities into the effective export config.
// caps: { libx265, vp9 } — whether the bundled FFmpeg has libx265 / libvpx-vp9 (from the main
// process; both default to available).
export function resolveExport(project, caps = {}) {
  const libx265 = caps.libx265 !== false;
  const stored = storedExportSettings(project);
  const raw = stored.preset === 'custom' ? stored.custom : EXPORT_PRESETS[stored.preset];
  const mode = raw.mode === 'bitrate' ? 'bitrate' : 'crf';
  const crf = clamp(Math.round(raw.crf ?? 20), 0, 51);
  const bitrateMbps = clamp(Number(raw.bitrateMbps) || 12, 0.5, 100);
  const encoderPreset = ENCODER_PRESETS.includes(raw.encoderPreset) ? raw.encoderPreset : 'veryfast';
  const audioKbps = AUDIO_RATES.includes(raw.audioKbps) ? raw.audioKbps : snap(raw.audioKbps || 192, AUDIO_RATES);
  const resCap = RES_CAPS.includes(raw.resCap) ? raw.resCap : 0;
  const fpsChoice = FPS_CHOICES.includes(raw.fps) ? raw.fps : 0;
  let codecFamily = raw.codec === 'h265' ? 'h265' : 'h264';

  const W = project.width || 1280;
  const H = project.height || 720;
  const longest = Math.max(W, H);
  let outW = W;
  let outH = H;
  if (resCap && longest > resCap) {
    const k = resCap / longest;
    outW = Math.max(2, Math.round((W * k) / 2) * 2);
    outH = Math.max(2, Math.round((H * k) / 2) * 2);
  }
  const outFps = fpsChoice || project.fps || 30;

  // Format resolution (Sprint 3): WebM falls back to MP4 when the bundled FFmpeg lacks
  // libvpx-vp9 — the same stated-fallback rule as H.265/libx265 above. GIF geometry comes
  // from the post-cap output size, scaled so the longest side fits the GIF size preset.
  let format = stored.format;
  const vp9 = caps.vp9 !== false;
  const gifK = Math.min(1, stored.gifSize / Math.max(outW, outH));
  const gifW = Math.max(2, Math.round(outW * gifK));
  const gifH = Math.max(2, Math.round(outH * gifK));

  const notes = [];
  if (codecFamily === 'h265' && !libx265) {
    codecFamily = 'h264';
    notes.push('H.265 (libx265) is not available in this build — exporting H.264 instead.');
  } else if (codecFamily === 'h265') {
    notes.push('H.265 encodes in software (libx265) in this build.');
  }
  if (resCap && longest <= resCap) notes.push(`Project is ${W}×${H} — under the ${resCap} cap, so it exports at project size (never upscaled).`);
  if (!resCap && stored.preset === 'ultra') notes.push(`Exports at the project's full ${W}×${H} — Ultra never upscales.`);
  if (fpsChoice && fpsChoice > (project.fps || 30)) notes.push(`Timeline is ${project.fps} fps — frames are duplicated to reach ${fpsChoice} fps (no new motion).`);
  if (format === 'webm' && !vp9) {
    format = 'mp4';
    notes.push('WebM (VP9) is not available in this build — exporting MP4 instead.');
  } else if (format === 'webm') {
    notes.push('WebM encodes with VP9 + Opus — smaller on the web, slower than H.264 on the CPU.');
  }
  if (format === 'gif') notes.push('GIF export covers up to 30 s of timeline and has no sound; size and frame rate use the GIF settings.');
  if (stored.subtitleTrack && format !== 'mp4' && format !== 'mov') notes.push('The subtitle track is only embedded in MP4 and MOV exports.');
  if (stored.subtitleTrack && (format === 'mp4' || format === 'mov')) notes.push('Captions are embedded as a switchable mov_text track as well as burned in — the track carries plain text and timings, not the caption styling.');

  return {
    preset: stored.preset,
    presetName: stored.preset === 'custom' ? 'Custom' : EXPORT_PRESETS[stored.preset].name,
    codecFamily,
    codecLabel: format === 'webm' ? 'VP9 · libvpx-vp9' : format === 'gif' ? 'GIF' : codecFamily === 'h265' ? 'H.265 · libx265' : 'H.264',
    mode,
    crf: mode === 'crf' ? crf : null,
    bitrateMbps: mode === 'bitrate' ? bitrateMbps : null,
    encoderPreset,
    audioKbps,
    resCap,
    fpsChoice,
    outW,
    outH,
    outFps,
    format,
    formatLabel: FORMAT_LABELS[format],
    ext: format,
    subtitleTrack: stored.subtitleTrack,
    gifSize: stored.gifSize,
    gifFps: stored.gifFps,
    gifW,
    gifH,
    encoder: format === 'webm' ? 'libvpx-vp9 · CPU (software)' : format === 'gif' ? null : encoderSummary(codecFamily, caps),
    notes,
  };
}

// Estimated output size for the resolved configuration. Bitrate mode is exact arithmetic from the
// settings (video bitrate + audio bitrate over the duration). CRF mode is a heuristic: libx264's
// output is modelled at bits-per-pixel bpp(crf) = 0.22 · 2^(−(crf−18)/5.5), calibrated so a 1080p30
// High (CRF 18) project estimates ≈ 13.7 Mbps — mid-range for typical footage. Real CRF output is
// content-dependent, so the UI always labels CRF-mode numbers as estimates.
export function estimateExport(eff, durationSec) {
  const dur = Math.max(0, Number(durationSec) || 0);
  if (eff.format === 'gif') {
    // GIF has no inter-frame compression to speak of: a flat ~0.7 bits per pixel per frame
    // after palette optimisation is the honest order of magnitude. Always an estimate.
    const videoMbps = (eff.gifW * eff.gifH * eff.gifFps * 0.7) / 1e6;
    return { mb: (videoMbps * 1e6 * dur) / 8 / 1e6, videoMbps, exact: false };
  }
  const audioMB = (eff.audioKbps * 1000 * dur) / 8 / 1e6;
  if (eff.mode === 'bitrate') {
    return { mb: (eff.bitrateMbps * 1e6 * dur) / 8 / 1e6 + audioMB, videoMbps: eff.bitrateMbps, exact: true };
  }
  const bpp = 0.22 * Math.pow(2, -(eff.crf - 18) / 5.5) * (eff.format === 'webm' ? 0.7 : 1); // VP9 buys roughly 30% at the same quality
  const videoMbps = (eff.outW * eff.outH * eff.outFps * bpp) / 1e6;
  return { mb: (videoMbps * 1e6 * dur) / 8 / 1e6 + audioMB, videoMbps, exact: false };
}

// Which encoder will actually run (v1.1.12): the main process probes the
// machine once (a real test encode per candidate) and reports the pick in
// caps.encoder — a GPU encoder when one works, libx264 otherwise. H.265 is
// software-only in this build, whatever the probe found.
export function encoderSummary(codecFamily, caps = {}) {
  if (codecFamily === 'h265') return 'libx265 · CPU (software)';
  switch (caps.encoder) {
    case 'h264_nvenc': return 'h264_nvenc · GPU (NVIDIA)';
    case 'h264_qsv': return 'h264_qsv · GPU (Intel Quick Sync)';
    case 'h264_vaapi': return 'h264_vaapi · GPU (VAAPI)';
    case 'h264_amf': return 'h264_amf · GPU (AMD)';
    case 'libx264': return 'libx264 · CPU (software)';
    default: return null;
  }
}

// The pre-export summary rows, rendered by the Export dialog from the resolved object.
export function summaryRows(eff, project) {
  if (eff.format === 'gif') {
    // The codec settings do not apply to a GIF; the summary says what actually happens.
    return [
      ['Format', 'GIF'],
      ['Size', `${eff.gifW}×${eff.gifH}`],
      ['Frame rate', `${eff.gifFps} fps`],
      ['Audio', 'None — GIF has no sound'],
    ];
  }
  const rows = [
    ['Preset', eff.presetName],
    ['Format', eff.formatLabel || 'MP4'],
    ['Codec', eff.codecLabel],
    ['Resolution', eff.outW === project.width && eff.outH === project.height
      ? `${eff.outW}×${eff.outH} (project size)`
      : `${eff.outW}×${eff.outH} (scaled from ${project.width}×${project.height})`],
    ['Frame rate', eff.fpsChoice ? `${eff.outFps} fps (from ${project.fps})` : `${eff.outFps} fps (project)`],
    ['Quality', eff.mode === 'crf' ? `CRF ${eff.crf}` : `Target bitrate ${eff.bitrateMbps} Mbps`],
    ['Encoder preset', eff.encoderPreset],
    ['Audio', eff.format === 'webm' ? `Opus ${eff.audioKbps} kbps` : `AAC ${eff.audioKbps} kbps`],
  ];
  if (eff.encoder) rows.splice(rows.findIndex(([k]) => k === 'Audio'), 0, ['Encoder', eff.encoder]);
  if (eff.subtitleTrack && (eff.format === 'mp4' || eff.format === 'mov')) rows.push(['Subtitle track', 'Embedded (mov_text)']);
  return rows;
}
