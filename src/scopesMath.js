// Scope mathematics (Sprint 11, parity-matrix §9 row "Scopes correctness").
// Pure functions over an RGBA pixel buffer ({ data } ImageData shape), so
// the panel's drawing and the test suite compute from exactly the same
// numbers. The panel samples a small 96x54 copy of the frame; these
// functions are size-agnostic.
//
// The drawing in Scopes.jsx consumes these results directly:
//   histogram -> histogramBins, wave -> waveformLuma, parade ->
//   channelPlanes, vectorscope -> vectorPoints.

// Rec.601 luma, the weights the panel has always used.
export const lumaOf = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

// YUV (BT.601) chroma of one 0..255 pixel — the vectorscope coordinates.
export const vectorUV = (r, g, b) => {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  return [
    -0.14713 * rn - 0.28886 * gn + 0.436 * bn,
    0.615 * rn - 0.51499 * gn - 0.10001 * bn,
  ];
};

// Per-channel 256-bin counts + the largest bin (the draw's scale).
export function histogramBins(data) {
  const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const n = Math.floor(data.length / 4);
  for (let i = 0; i < n; i++) {
    bins[0][data[i * 4]]++;
    bins[1][data[i * 4 + 1]]++;
    bins[2][data[i * 4 + 2]]++;
  }
  let max = 1;
  for (const b of bins) for (let i = 0; i < 256; i++) if (b[i] > max) max = b[i];
  return { bins, max };
}

// Luma of every pixel, raster order, 0..1 (the waveform trace).
export function waveformLuma(data) {
  const n = Math.floor(data.length / 4);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = lumaOf(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  return out;
}

// The three channel planes, raster order, 0..1 (the RGB parade traces).
export function channelPlanes(data) {
  const n = Math.floor(data.length / 4);
  const out = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    out[0][i] = data[i * 4] / 255;
    out[1][i] = data[i * 4 + 1] / 255;
    out[2][i] = data[i * 4 + 2] / 255;
  }
  return out;
}

// Vectorscope points [u0, v0, u1, v1, ...] for every SECOND pixel — the
// stride the panel draws with (a full-density plot is an unreadable blob
// at panel size, and the omitted pixels are statistical duplicates).
export function vectorPoints(data) {
  const n = Math.floor(data.length / 4);
  const out = new Float32Array(Math.ceil(n / 2) * 2);
  let o = 0;
  for (let i = 0; i < n; i += 2) {
    const [u, v] = vectorUV(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    out[o++] = u; out[o++] = v;
  }
  return out;
}

// The winning slot of the two-slot main-picture stack: the visible one
// with the highest z (the incoming clip during a transition); ties go to
// the later slot, matching paint order. Returns its index or -1.
export function pickSlotIndex(slots) {
  let best = -1;
  (slots || []).forEach((s, i) => {
    if (!s || !s.visible) return;
    if (best < 0 || (s.z || 0) >= (slots[best].z || 0)) best = i;
  });
  return best;
}

// Which stage element the scopes sample. The preview's main picture is a
// two-slot stack; what the user judges is the DISPLAYED frame of the top
// slot — its keyed canvas when the clip is processed (that canvas is the
// frame AFTER crop/key/matte and the shared pixel passes, i.e. after
// filters and grading), or the raw media element when it is not. During a
// shader transition the transition canvas is the displayed full frame.
// desc: { transition: boolean, slots: [{ visible, z, processed }] }
// Returns 'transition' | 'keyed' | 'source' | null (nothing on screen).
export function pickScopeSource(desc) {
  if (!desc) return null;
  if (desc.transition) return 'transition';
  const i = pickSlotIndex(desc.slots);
  if (i < 0) return null;
  return desc.slots[i].processed ? 'keyed' : 'source';
}
