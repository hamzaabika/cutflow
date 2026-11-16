// HDR export helpers (FX-06), split out of electron/ffmpeg.cjs by the A-F7
// module-size guard — the zscale conversion is pure string building, so it
// lives here and ffmpeg.cjs just requires it.
'use strict';

// FX-06 — HDR export: instead of tonemapping HDR down to BT.709 SDR, an
// export may keep BT.2020 with a PQ (HDR10) or HLG transfer, in 10-bit
// H.265. One zscale converts any source into the target space: HDR sources
// keep their values (primaries/matrix normalised), SDR sources map up
// (SDR white = 100 nits, i.e. PQ ≈ 0.51) — zscale linearises with the input
// transfer and applies the output OETF, so no separate tonemap is needed.
// The preview stays SDR (the player tonemaps); only the export file is HDR.
const HDR_TRC = { pq: 'smpte2084', hlg: 'arib-std-b67' };
// One zscale converts any source into the target HDR space: HDR sources
// keep their values (primaries/matrix normalised), SDR sources map up
// (SDR white = 100 nits, i.e. PQ ≈ 0.51) — zscale linearises with the input
// transfer and applies the output OETF, so no separate tonemap is needed.
// Untagged sources give zscale "no path between colorspaces", so the input
// is pinned to the pipeline's standard assumption (BT.709) — the same
// assumption the SDR path already makes for untagged material. Tagged
// sources convert from their own description.
const toHdr = (m, target) => {
  const pin = (m && (m.colorSpace || m.colorPrimaries || m.colorTransfer))
    ? '' : 'pin=bt709:tin=bt709:min=bt709:rin=tv:';
  return `,zscale=${pin}p=bt2020:t=${HDR_TRC[target]}:m=bt2020nc:r=tv,format=yuv420p10le`;
};

module.exports = { HDR_TRC, toHdr };
