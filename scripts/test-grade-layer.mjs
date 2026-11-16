// Global Adjustment Layers (P2-16): the grade-layer engine pieces.
//   - gradeLayerHasContent / gradeLayerPasses (src/fx/apply.js): a layer's
//     grade/filter/adjust build the same passes a clip's look does, in the
//     same order, wrapped with the layer's region and strength; a LUT pass
//     takes strength as K and cannot be region-wrapped.
//   - clipHasPixelFx: a grade layer with content pulls its clips into the
//     export fx pass (and only then — empty, disabled, strength-0 or
//     non-overlapping layers do not).
//   - pixelPasses: layer passes append AFTER the free pixel effects, in
//     effectClips order (they grade the effected picture, pre-composite).
//   - normalizeProject: effectClips are sanitized (grade payload kept and
//     clamped, old shape gains kind 'fx', malformed entries dropped).
//   - loadProjectLuts: layer LUT refs (grade slot and filter slot) load.
//   - FxJobs.segmentKeyFor: the transition segment key carries effectClips,
//     so editing a grade layer invalidates cached transition segments.
// The UI (Effects panel button, inspector grade branch, Timeline label) and
// the preview-vs-export parity are verified live; see verify-grade-layer.mjs.
// Usage: node scripts/test-grade-layer.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeLayerHasContent, gradeLayerPasses, pixelPasses, clipHasPixelFx } from '../src/fx/apply.js';
import { gradeExpr } from '../src/fx/grade.js';
import { normalizeProject } from '../src/store.js';
import { loadLut, loadProjectLuts, getLut } from '../src/fx/lut.js';
import { FxJobs } from '../electron/fxjobs.cjs';

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok' : '  FAIL'}  ${msg}`); if (!ok) failures++; };

// loadLut reads through window.api.readLut in the renderer; in node the
// stub reads the bundled .cube files straight off disk.
const cubeDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'shared', 'luts');
globalThis.window = { api: { readLut: async (ref) => ({ text: fs.readFileSync(path.join(cubeDir, ref.bundled), 'utf8') }) } };

// ---- gradeLayerHasContent --------------------------------------------------
check(!gradeLayerHasContent({}), 'empty layer has no content');
check(!gradeLayerHasContent({ filter: 'none' }), 'filter none has no content');
check(gradeLayerHasContent({ grade: { exposure: 1 } }), 'grade exposure has content');
check(gradeLayerHasContent({ filter: 'tealorange' }), 'named filter has content');
check(gradeLayerHasContent({ adjust: { brightness: 0.2 } }), 'adjust brightness has content');
check(gradeLayerHasContent({ grade: { lut: { ref: { bundled: 'slay-01-amber.cube' }, intensity: 100 } } }), 'grade LUT has content');

// ---- gradeLayerPasses ------------------------------------------------------
const layer = { id: 'g1', kind: 'grade', start: 0, duration: 4, grade: { exposure: 1 } };
const passes = gradeLayerPasses(layer, 1);
check(passes.length === 1 && typeof passes[0].expr === 'string', 'exposure layer builds one expression pass');
check(passes[0].expr === gradeExpr({ exposure: 1 }), 'strength-1, region-free layer pass is the bare grade expression');
check(passes[0].T === 1, 'layer pass T is layer-local time');
check(gradeLayerPasses({ ...layer, strength: 0.5 }, 1)[0].expr.includes('0.5'), 'strength 0.5 mixes the grade at half (fxWrap)');
check(gradeLayerPasses({ ...layer, region: { x: 0.3, y: 0.3, w: 0.4, h: 0.4, feather: 0.05, shape: 'rect', invert: false } }, 1)[0].expr.includes('st(9'), 'regioned layer pass carries the region mask');
check(gradeLayerPasses({ ...layer, grade: {}, filter: 'tealorange' }, 1).length === 1, 'named filter layer builds one expression pass');
check(gradeLayerPasses({ ...layer, grade: {}, filter: 'none' }, 1).length === 0, 'empty layer builds no passes');

// LUT passes (load the two bundled files first).
await loadLut({ bundled: 'slay-01-amber.cube' });
await loadLut({ bundled: 'slay-02-fade.cube' });
check(!!getLut({ bundled: 'slay-01-amber.cube' }), 'bundled LUT loads in node via the readLut stub');
const lutLayer = { ...layer, grade: {}, filter: 'lut:slay-01-amber.cube', filterIntensity: 100 };
const lutPasses = gradeLayerPasses(lutLayer, 1);
check(lutPasses.length === 1 && lutPasses[0].lut && lutPasses[0].K === 1, 'filter-LUT layer builds one LUT pass at K=1');
check(gradeLayerPasses({ ...lutLayer, strength: 0.5 }, 1)[0].K === 0.5, 'layer strength scales the LUT K');
const bothSame = gradeLayerPasses({ ...lutLayer, grade: { lut: { ref: { bundled: 'slay-01-amber.cube' }, intensity: 100 } } }, 1);
check(bothSame.filter((p) => p.lut).length === 1, 'same LUT in filter and grade slots runs once (P1-53 dedupe)');
const bothDiff = gradeLayerPasses({ ...lutLayer, grade: { lut: { ref: { bundled: 'slay-02-fade.cube' }, intensity: 100 } } }, 1);
check(bothDiff.filter((p) => p.lut).length === 2, 'different LUTs in filter and grade slots both apply');

// ---- clipHasPixelFx (the export fx-pass gate) ------------------------------
const clip = { id: 'v1', in: 0, out: 4, speed: 1 };
const base = { videoClips: [clip], overlayClips: [], effectClips: [] };
check(!clipHasPixelFx(base, clip, 0, 4), 'no layer: clip needs no fx pass');
check(clipHasPixelFx({ ...base, effectClips: [layer] }, clip, 0, 4), 'overlapping grade layer pulls the clip into the fx pass');
check(!clipHasPixelFx({ ...base, effectClips: [{ ...layer, start: 5 }] }, clip, 0, 4), 'non-overlapping layer does not pull the clip in');
check(!clipHasPixelFx({ ...base, effectClips: [{ ...layer, grade: {} }] }, clip, 0, 4), 'empty layer does not pull the clip in');
check(!clipHasPixelFx({ ...base, effectClips: [{ ...layer, disabled: true }] }, clip, 0, 4), 'disabled layer does not pull the clip in');
check(!clipHasPixelFx({ ...base, effectClips: [{ ...layer, strength: 0 }] }, clip, 0, 4), 'strength-0 layer does not pull the clip in');

// ---- pixelPasses ordering --------------------------------------------------
const ordered = {
  videoClips: [{ ...clip, grade: { exposure: 0.5 } }], overlayClips: [],
  effectClips: [
    { id: 'f1', kind: 'fx', fx: 'fx_vhs', start: 0, duration: 4 },
    { ...layer, grade: { exposure: 1 } },
  ],
};
const all = pixelPasses(ordered, ordered.videoClips[0], 0, 1);
check(all.length === 3, `clip grade + free fx + layer grade = 3 passes (got ${all.length})`);
check(all[0].expr === gradeExpr({ exposure: 0.5 }), 'clip own grade comes first');
check(all[2].expr === gradeExpr({ exposure: 1 }), 'layer grade comes last, after the free pixel effect');
check(all[2].T === 1, 'layer pass T is layer-local');

// ---- normalizeProject sanitization -----------------------------------------
const norm = normalizeProject({
  effectClips: [
    { id: 'g1', kind: 'grade', start: 0, duration: 3, grade: { exposure: 1 }, filter: 'tealorange', filterIntensity: 150, adjust: { brightness: 0.2 }, strength: 2 },
    { id: 'f1', fx: 'fx_vhs', start: 1, duration: 2 },
    { start: 0, duration: 1 },
    { id: 'bad', kind: 'fx', start: 0, duration: 1 },
  ],
});
check(norm.effectClips.length === 2, 'malformed entries are dropped, valid ones kept');
const g = norm.effectClips.find((e) => e.id === 'g1');
check(g && g.kind === 'grade' && g.filterIntensity === 100 && g.strength === 1, 'grade payload kept, intensity and strength clamped');
const f = norm.effectClips.find((e) => e.id === 'f1');
check(f && f.kind === 'fx' && f.fx === 'fx_vhs', 'old-shape free effect gains kind fx');

// ---- loadProjectLuts covers layer LUTs --------------------------------------
await loadProjectLuts({ videoClips: [], overlayClips: [], effectClips: [{ ...lutLayer, grade: { lut: { ref: { bundled: 'slay-02-fade.cube' }, intensity: 100 } } }] });
check(!!getLut({ bundled: 'slay-02-fade.cube' }), 'loadProjectLuts loads a grade-layer LUT');

// ---- transition segment key -------------------------------------------------
const jobs = new FxJobs();
const a = { id: 'v1', in: 0, out: 4, speed: 1 };
const b = { id: 'v2', in: 0, out: 4, speed: 1 };
const proj = { width: 1920, height: 1080, fps: 30, effectClips: [] };
const keyOf = (p) => jobs.segmentKeyFor(p, { kind: 'transition' }, { a, b, mediaA: null, mediaB: null });
const k1 = keyOf(proj);
check(k1 === keyOf(proj), 'same project gives the same transition key');
check(keyOf({ ...proj, effectClips: [layer] }) !== k1, 'adding a grade layer changes the transition key');
check(keyOf({ ...proj, effectClips: [{ ...layer, grade: { exposure: 2 } }] }) !== keyOf({ ...proj, effectClips: [layer] }), 'editing the layer grade changes the transition key');

console.log(failures ? `\n${failures} FAILURES` : '\nAll grade-layer checks passed.');
process.exit(failures ? 1 : 0);
