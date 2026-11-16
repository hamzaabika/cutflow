// Batch export variants (P2-26): one batch, one quality preset, every aspect the
// creator ships — horizontal 16:9, vertical 9:16, square 1:1 — each with correct
// framing and a safe-area check. The video framing reuses the reframe engine
// (src/reframe.js): a narrower frame gets the cover scale so the picture fills it
// (centred, or face-tracked when a reframe analysis was run); the export engine's
// own fit (scale-down + pad) only ever kicks in when the source is narrower than
// the frame. The quality preset is shared: every variant resolves through the
// same resolveExport() as a single export, so the batch never diverges from what
// the dialog promises for one file.
import { sizeFor } from './effects.js';
import { buildReframedCopy } from './reframe.js';

export const EXPORT_VARIANTS = [
  { id: 'horizontal', label: 'Horizontal 16:9', ratio: '16:9', suffix: '16x9' },
  { id: 'vertical', label: 'Vertical 9:16', ratio: '9:16', suffix: '9x16' },
  { id: 'square', label: 'Square 1:1', ratio: '1:1', suffix: '1x1' },
];

export const variantById = (id) => EXPORT_VARIANTS.find((v) => v.id === id) || null;
// The variant that matches the project's own ratio (the plain single export).
export const variantForProject = (project) => EXPORT_VARIANTS.find((v) => v.ratio === project.ratio)
  || (project.width >= project.height ? EXPORT_VARIANTS[0] : EXPORT_VARIANTS[1]);

// Target geometry of a variant at the project's resolution (short side).
export function variantSize(project, variant) {
  return sizeFor(variant.ratio, project.resolution || 720);
}

// The project copy a variant exports: same timeline, new geometry, video clips
// reframed to cover the frame. paths (optional) is the reframe face analysis
// { [clipId]: points } — without it every clip is centred, which is still a
// correct fill, just not subject-tracked. The original project is never touched.
export function buildVariantProject(project, variant, paths = {}) {
  const size = variantSize(project, variant);
  if (project.ratio === variant.ratio && project.width === size.width && project.height === size.height) {
    return JSON.parse(JSON.stringify(project));
  }
  return buildReframedCopy(project, variant.ratio, paths, () => `${project.id || 'p'}-${variant.suffix}`);
}

export const variantFileName = (baseName, variant, ext) =>
  `${String(baseName || 'export').replace(/[\\/:*?"<>|]+/g, '_')}_${variant.suffix}.${ext}`;

// ---- Safe-area check ----
// Platform UI (captions bar, like/comment rail, profile row) eats the edges of a
// vertical frame, so the safe margins are roomier there than on horizontal/square.
// A clip is checked by its anchor point: text clips sit at (x, y) fractions
// (defaults 0.5, 0.85 — the caption line), stickers at their transform centre
// (0.5 + x, 0.5 + y) with a half-extent of ~scale/2. Returns violations:
// [{ clipId, kind: 'text'|'sticker', edge: 'top'|'bottom'|'left'|'right', at }].
export const SAFE_MARGINS = {
  horizontal: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 },
  vertical: { top: 0.14, bottom: 0.20, left: 0.08, right: 0.08 },
  square: { top: 0.05, bottom: 0.08, left: 0.05, right: 0.05 },
};

export function checkSafeArea(project, variant) {
  const m = SAFE_MARGINS[variant.id] || SAFE_MARGINS.horizontal;
  const out = [];
  const EPS = 1e-9; // a clip sitting exactly on the margin line is inside, not outside
  const check = (clipId, kind, cx, cy, hx, hy) => {
    if (cy - hy < m.top - EPS) out.push({ clipId, kind, edge: 'top', at: cy });
    if (cy + hy > 1 - m.bottom + EPS) out.push({ clipId, kind, edge: 'bottom', at: cy });
    if (cx - hx < m.left - EPS) out.push({ clipId, kind, edge: 'left', at: cx });
    if (cx + hx > 1 - m.right + EPS) out.push({ clipId, kind, edge: 'right', at: cx });
  };
  for (const c of project.textClips || []) {
    // A caption line is ~6% of the frame tall; its anchor is its centre.
    check(c.id, 'text', Number.isFinite(c.x) ? c.x : 0.5, Number.isFinite(c.y) ? c.y : 0.85, 0.1, 0.03);
  }
  for (const c of project.stickerClips || []) {
    const t = c.transform || {};
    const s = Number.isFinite(t.scale) ? t.scale : 0.3;
    check(c.id, 'sticker', 0.5 + (t.x || 0), 0.5 + (t.y || 0), s / 2, s / 2);
  }
  return out;
}

// Safe-area report for a whole batch: { [variantId]: violations[] }.
export function checkBatchSafeArea(project, variants) {
  const out = {};
  for (const v of variants) out[v.id] = checkSafeArea(project, v);
  return out;
}
