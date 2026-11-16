// Timeline markers (A-F7: split out of src/store.js, which had grown past
// 2400 lines). Pure logic, no store imports — the palette + the helpers any
// panel needs. store.js re-exports these, so existing import sites keep
// working; new code should import from here directly.

// Marker colours (10/10 step 5): a small named palette — a marker's colour is
// one of these ids (amber is the historical default, so old projects render
// exactly as they always did). Colour per marker + bulk delete close the
// parity row CapCut covers with its coloured chapter/marker flags.
export const MARKER_COLORS = [
  { id: 'amber', name: 'Amber', hex: '#fbbf24' },
  { id: 'violet', name: 'Violet', hex: '#825cfb' },
  { id: 'teal', name: 'Teal', hex: '#14b8a6' },
  { id: 'coral', name: 'Coral', hex: '#f97066' },
  { id: 'sky', name: 'Sky', hex: '#38bdf8' },
  { id: 'pink', name: 'Pink', hex: '#ec4899' },
];
export const markerColorId = (id) => (MARKER_COLORS.some((c) => c.id === id) ? id : 'amber');
export const markerColorHex = (id) => MARKER_COLORS.find((c) => c.id === id)?.hex || MARKER_COLORS[0].hex;

// The marker closest to time t within `eps` seconds, or null.
export function markerNear(markers, t, eps = 0.05) {
  let best = null;
  for (const m of markers) if (Math.abs(m.time - t) <= eps && (!best || Math.abs(m.time - t) < Math.abs(best.time - t))) best = m;
  return best;
}
