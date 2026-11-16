// FCPXML export (spec matrix — Final Cut Pro XML, fcpxml 1.9).
// Pure builder: project document -> FCPXML string. Only the timeline
// structure is exported (clips, timing, speed, audio roles, caption titles);
// effects/grades are NOT represented — FCP has no equivalent for Cutflow's
// shader effects, and silently dropping them would be a lie, so the result
// carries an <note> naming what was left out. No media is copied: asset
// elements reference the original file paths.
import { clipLen, videoLayout } from './store.js';
import { freeLen } from './store.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rat = (seconds, fps) => {
  const num = Math.max(0, Math.round(seconds * fps));
  return `${num}/${fps}s`;
};
const fpsRat = (fps) => {
  // 29.97 -> 30000/1001s, everything else -> N/1s.
  if (Math.abs(fps - 29.97) < 0.01) return '30000/1001s';
  return `${Math.round(fps)}/1s`;
};

export function projectToFcpxml(p) {
  const fps = Number(p.fps) || 30;
  const W = p.width || 1280;
  const H = p.height || 720;
  const media = p.media || [];
  const mediaById = Object.fromEntries(media.map((m) => [m.id, m]));
  const assets = [];
  const used = new Map(); // mediaId -> asset id
  const assetId = (m) => {
    if (!used.has(m.id)) used.set(m.id, `r${used.size + 2}`);
    return used.get(m.id);
  };
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<fcpxml version="1.9">');
  lines.push('  <resources>');
  lines.push(`    <format id="r1" name="FFVideoFormat${W}x${H}p${fps}" frameDuration="${fpsRat(fps)}" width="${W}" height="${H}"/>`);
  for (const m of media) {
    const dur = m.duration ? rat(m.duration, fps) : '0s';
    const audio = m.hasAudio ? ` hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"` : '';
    lines.push(`    <asset id="${assetId(m)}" name="${esc(m.name || m.id)}" src="${esc(m.path || '')}" start="0s" duration="${dur}"${audio}>`);
    lines.push(`      <media-rep kind="original-media" src="${esc(m.path || '')}"/>`);
    lines.push('    </asset>');
  }
  lines.push('  </resources>');
  lines.push('  <library>');
  lines.push(`    <event name="${esc(p.name || 'Untitled')}">`);
  lines.push(`      <project name="${esc(p.name || 'Untitled')}">`);
  lines.push(`        <sequence format="r1" duration="${rat(videoLayout(p.videoClips).reduce((n, l) => Math.max(n, l.end), 0), fps)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48000">`);
  lines.push('          <spine>');
  const layout = videoLayout(p.videoClips);
  for (const l of layout) {
    const c = l.clip;
    if (c.gap) {
      lines.push(`            <gap name="Gap" offset="${rat(l.start, fps)}" duration="${rat(l.end - l.start, fps)}"/>`);
      continue;
    }
    const m = mediaById[c.mediaId];
    if (!m) continue;
    const speed = c.speed && c.speed !== 1 ? ` speed="${c.speed}"` : '';
    lines.push(`            <asset-clip ref="${assetId(m)}" name="${esc(m.name || c.id)}" offset="${rat(l.start, fps)}" start="${rat(c.in || 0, fps)}" duration="${rat(clipLen(c), fps)}"${speed}>`);
    if (c.muted) lines.push('              <audio role="dialogue" muted="1"/>');
    else if (c.volume != null && c.volume !== 1) lines.push(`              <audio role="dialogue" volume="${c.volume}"/>`);
    lines.push('            </asset-clip>');
  }
  lines.push('          </spine>');
  // Free tracks: audio clips as connected audio, text/captions as titles.
  for (const a of p.audioClips || []) {
    const m = mediaById[a.mediaId];
    if (!m) continue;
    lines.push(`          <audio ref="${assetId(m)}" name="${esc(m.name || a.id)}" offset="${rat(a.start || 0, fps)}" start="${rat(a.in || 0, fps)}" duration="${rat(freeLen('audio', a), fps)}" lane="1"/>`);
  }
  for (const tc of p.textClips || []) {
    lines.push(`          <title name="${esc(tc.text || '')}" offset="${rat(tc.start || 0, fps)}" duration="${rat(tc.duration || 0, fps)}" lane="2">`);
    lines.push(`            <text>${esc(tc.text || '')}</text>`);
    if (tc.speaker) lines.push(`            <note>Speaker: ${esc(tc.speaker)}</note>`);
    lines.push('          </title>');
  }
  lines.push('        </sequence>');
  lines.push('        <note>Exported from Cutflow. Effects, grades, LUTs, transitions and speed curves are not represented in FCPXML and were left out — re-apply them in Final Cut Pro.</note>');
  lines.push('      </project>');
  lines.push('    </event>');
  lines.push('  </library>');
  lines.push('</fcpxml>');
  void assets;
  return lines.join('\n') + '\n';
}
