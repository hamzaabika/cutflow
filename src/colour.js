// Input colour-space labels (P1-53, Professional Color Management): probe
// captures the source's colour description (colorSpace / colorPrimaries /
// colorTransfer / hdr — electron/ffmpeg.cjs probe); this module turns it
// into the words the UI shows, and states what the pipeline does with it.
// The pipeline itself is SDR-only: HDR is tonemapped (toSdr) and non-709
// SDR is converted (colorFix) at the clip's input chain, so the BT.709 tag
// the export writes is true. This module only NAMES the input — it never
// changes the conversion.
const SPACE_LABEL = {
  bt709: 'BT.709', bt2020nc: 'BT.2020', bt2020c: 'BT.2020',
  smpte170m: 'BT.601', bt470bg: 'BT.601', bt470: 'BT.601', smpte240m: 'BT.601',
};
const TRANSFER_LABEL = { 'arib-std-b67': 'HLG', smpte2084: 'PQ' };

// Human label for a media item's source colour, or null when there is
// nothing worth naming: plain BT.709 (the pipeline's native space) and
// untagged files (decoders assume 601/709 by resolution, as always).
// Examples: 'BT.2020 · HLG', 'BT.2020 · PQ', 'BT.601'.
export function colourSpaceLabel(m) {
  if (!m || m.type === 'audio') return null;
  const space = SPACE_LABEL[m.colorSpace] || '';
  const tr = TRANSFER_LABEL[m.colorTransfer] || '';
  if (m.hdr) return [space || 'HDR', tr].filter(Boolean).join(' · ') || 'HDR';
  if (!space && !tr) return null;
  if (space === 'BT.709' && !tr) return null;
  return [space || 'BT.709', tr].filter(Boolean).join(' · ');
}

// What the export pipeline does with this source: 'tonemap' for HDR
// (toSdr), 'convert' for non-709 SDR (colorFix), null for plain BT.709
// or untagged (nothing to do).
export function colourAction(m) {
  if (!m || m.type === 'audio') return null;
  if (m.hdr) return 'tonemap';
  return colourSpaceLabel(m) ? 'convert' : null;
}

export function isNon709(m) {
  return !!colourSpaceLabel(m);
}
