// 3D LUTs (.cube files): the bundled ones and the user's own. A clip's LUT is applied by a GPU pass (gl.js
// lutPass), the same in the player and the export.
//
// grade.lut = { ref: { bundled: 'file.cube' } | { path: 'C:\\...\\look.cube' }, name, intensity (0..100) }

export const BUNDLED_LUTS = [
  { file: 'slay-01-amber.cube', name: 'Amber', cat: 'Film', credit: 'slay (CC BY 4.0)' },
  { file: 'slay-02-fade.cube', name: 'Fade', cat: 'Film', credit: 'slay (CC BY 4.0)' },
  { file: 'slay-03-neon.cube', name: 'Neon', cat: 'Creative', credit: 'slay (CC BY 4.0)' },
  { file: 'slay-04-film.cube', name: 'Film', cat: 'Film', credit: 'slay (CC BY 4.0)' },
  { file: 'slay-05-portrait.cube', name: 'Portrait', cat: 'Portrait', credit: 'slay (CC BY 4.0)' },
  // Cutflow's own LUTs (Sprint 12): closed-form transforms generated procedurally by
  // scripts/gen-bundled-luts.cjs — original to this product, no third-party data, no credit.
  { file: 'cf-01-teak.cube', name: 'Teak', cat: 'Warm' },
  { file: 'cf-02-glacier.cube', name: 'Glacier', cat: 'Cool' },
  { file: 'cf-03-rose.cube', name: 'Rosé', cat: 'Portrait' },
  { file: 'cf-04-slate.cube', name: 'Slate', cat: 'Film' },
  // 10/10 step-3 growth: 16 more closed-form originals from the same generator.
  { file: 'cf-05-ember.cube', name: 'Ember', cat: 'Warm' },
  { file: 'cf-06-lagoon.cube', name: 'Lagoon', cat: 'Cool' },
  { file: 'cf-07-velvet.cube', name: 'Velvet', cat: 'Portrait' },
  { file: 'cf-08-mono.cube', name: 'Mono', cat: 'Film' },
  { file: 'cf-09-goldenhour.cube', name: 'Golden Hour', cat: 'Warm' },
  { file: 'cf-10-forest.cube', name: 'Forest', cat: 'Travel' },
  { file: 'cf-11-candy.cube', name: 'Candy', cat: 'Creative' },
  { file: 'cf-12-denim.cube', name: 'Denim', cat: 'Cool' },
  { file: 'cf-13-noir.cube', name: 'Noir LUT', cat: 'Film' },
  { file: 'cf-14-peach.cube', name: 'Peach', cat: 'Portrait' },
  { file: 'cf-15-arctic.cube', name: 'Arctic', cat: 'Cool' },
  { file: 'cf-16-vintage70.cube', name: 'Vintage 70', cat: 'Film' },
  { file: 'cf-17-neon.cube', name: 'Neon Night', cat: 'Creative' },
  { file: 'cf-18-sepia.cube', name: 'Sepia', cat: 'Film' },
  { file: 'cf-19-meadow.cube', name: 'Meadow', cat: 'Travel' },
  { file: 'cf-20-dusk.cube', name: 'Dusk', cat: 'Creative' },
].map((l) => ({ ...l, ref: { bundled: l.file } }));
export const LUT_CREDIT_URL = 'https://www.slaycamera.com';

export const lutKey = (ref) => (ref?.bundled ? `b:${ref.bundled}` : ref?.path ? `p:${ref.path}` : '');
export const lutOn = (lut) => !!(lut && lutKey(lut.ref) && (lut.intensity ?? 100) > 0);

// .cube text -> { size, data: Uint8Array RGBA laid out as size slices of size x size (red across, green down,
// blue picks the slice) }, or throws.
export function parseCube(text) {
  let size = 0;
  let size1d = 0;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const values = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'LUT_3D_SIZE') size = Number(parts[1]);
    else if (key === 'LUT_1D_SIZE') size1d = Number(parts[1]);
    else if (key === 'DOMAIN_MIN') min = parts.slice(1, 4).map(Number);
    else if (key === 'DOMAIN_MAX') max = parts.slice(1, 4).map(Number);
    else if (/^[-+.\d]/.test(parts[0]) && parts.length >= 3) values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
  }
  // A 1D LUT is three per-channel curves: sampling them into a 17^3 grid is mathematically
  // exact for 1D input, so 1D .cube files are converted instead of rejected.
  if (!size && size1d) {
    if (!(size1d >= 2 && size1d <= 65536)) throw new Error('Not a valid 1D .cube LUT (bad LUT_1D_SIZE).');
    if (values.length < size1d * 3) throw new Error('The LUT file is incomplete.');
    const OUT = 17;
    const curve = (c, x) => {
      const f = Math.min(size1d - 1, Math.max(0, x * (size1d - 1)));
      const i = Math.floor(f);
      const j = Math.min(size1d - 1, i + 1);
      const v = values[i * 3 + c] + (values[j * 3 + c] - values[i * 3 + c]) * (f - i);
      return (v - min[c]) / ((max[c] - min[c]) || 1);
    };
    const data = new Uint8Array(OUT * OUT * OUT * 4);
    for (let b = 0; b < OUT; b++) for (let g = 0; g < OUT; g++) for (let r = 0; r < OUT; r++) {
      const d = (g * OUT * OUT + b * OUT + r) * 4;
      data[d] = Math.round(Math.min(1, Math.max(0, curve(0, r / (OUT - 1)))) * 255);
      data[d + 1] = Math.round(Math.min(1, Math.max(0, curve(1, g / (OUT - 1)))) * 255);
      data[d + 2] = Math.round(Math.min(1, Math.max(0, curve(2, b / (OUT - 1)))) * 255);
      data[d + 3] = 255;
    }
    return { size: OUT, data, from1d: true };
  }
  if (!(size >= 2 && size <= 129)) throw new Error('Not a 3D .cube LUT (no LUT_3D_SIZE).');
  if (values.length < size * size * size * 3) throw new Error('The LUT file is incomplete.');
  // .cube order: red changes fastest, then green, then blue.
  const data = new Uint8Array(size * size * size * 4);
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const s = ((b * size + g) * size + r) * 3;
        const d = (g * size * size + b * size + r) * 4; // row g, column b * size + r
        for (let c = 0; c < 3; c++) {
          const v = (values[s + c] - min[c]) / ((max[c] - min[c]) || 1);
          data[d + c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
        }
        data[d + 3] = 255;
      }
    }
  }
  return { size, data };
}

const cache = new Map(); // key -> { size, data } | Promise | { error }
const listeners = new Set();
export const onLutLoaded = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// The LUT if it is loaded (synchronous, for the draw loops), else null.
export function getLut(ref) {
  const v = cache.get(lutKey(ref));
  return v && v.data ? v : null;
}

// Loads (once) and returns the LUT, or { error }.
export function loadLut(ref) {
  const key = lutKey(ref);
  if (!key) return Promise.resolve({ error: 'No LUT' });
  const v = cache.get(key);
  if (v) return v.then ? v : Promise.resolve(v);
  const p = window.api.readLut(ref).then((res) => {
    let out;
    try {
      out = res.error ? { error: res.error } : parseCube(res.text);
    } catch (e) {
      out = { error: e.message };
    }
    cache.set(key, out);
    listeners.forEach((fn) => fn(key));
    return out;
  });
  cache.set(key, p);
  return p;
}

// Every LUT a project uses, loaded (before an export).
export function loadProjectLuts(project) {
  const clips = [...project.videoClips, ...(project.overlayClips || [])];
  const refs = [
    ...clips.filter((c) => lutOn(c.grade?.lut)).map((c) => c.grade.lut.ref),
    ...clips.filter((c) => typeof c.filter === 'string' && c.filter.startsWith('lut:')).map((c) => ({ bundled: c.filter.slice(4) })),
  ];
  return Promise.all(refs.map(loadLut));
}
