// Fonts available to text clips. Bundled fonts are open-source (OFL) faces from
// @fontsource, kept as woff2 files in the runtime font store (public/fonts/ —
// see scripts/gen-font-manifest.cjs) and loaded on demand per font, never
// imported into the bundle. System fonts ship with Windows. Text is rendered
// on a canvas for both preview and export, so a font only needs to be
// loadable by the renderer — and the load gate (ensureFontLoaded) confirms
// it before any frame using it renders.
import { faceInStore, loadFace } from './fontStore.js';
// bold: weight used when the clip is bold (null = the font has a single weight).
const F = (id, name, family, group, bold = 700, regular = 400) => ({ id, name, family, group, bold, regular });

export const FONT_LIST = [
  F('montserrat', 'Montserrat', 'Montserrat', 'Popular', 900),
  // Inter Variable (imported in main.jsx): Neon Pop Duo's line 1. Regular 500
  // is the Medium the spec wants; bold 700 for the bold toggle.
  F('inter', 'Inter', 'Inter Variable', 'Popular', 700, 500),
  F('poppins', 'Poppins', 'Poppins', 'Popular', 900),
  F('anton', 'Anton', 'Anton', 'Popular', null),
  F('bebas', 'Bebas Neue', 'Bebas Neue', 'Popular', null),
  F('oswald', 'Oswald', 'Oswald', 'Popular'),
  F('arialblack', 'Arial Black', 'Arial Black', 'Popular', null),
  F('impact', 'Impact', 'Impact', 'Popular', null),
  F('roboto', 'Roboto', 'Roboto', 'Popular', 900),
  F('rubik', 'Rubik', 'Rubik', 'Popular', 900),
  F('kanit', 'Kanit', 'Kanit', 'Popular', 900),
  F('archivoblack', 'Archivo Black', 'Archivo Black', 'Popular', null),
  F('barlowcond', 'Barlow Condensed', 'Barlow Condensed', 'Popular', 800),
  F('lilita', 'Lilita One', 'Lilita One', 'Popular', null),
  F('fredoka', 'Fredoka', 'Fredoka', 'Popular'),
  F('bangers', 'Bangers', 'Bangers', 'Display', null),
  F('luckiest', 'Luckiest Guy', 'Luckiest Guy', 'Display', null),
  F('marker', 'Permanent Marker', 'Permanent Marker', 'Display', null),
  F('righteous', 'Righteous', 'Righteous', 'Display', null),
  F('pixel', 'Press Start 2P', 'Press Start 2P', 'Display', null),
  F('showcard', 'Showcard Gothic', 'Showcard Gothic', 'Display', null),
  F('cooper', 'Cooper Black', 'Cooper Black', 'Display', null),
  F('stencil', 'Stencil', 'Stencil', 'Display', null),
  F('broadway', 'Broadway', 'Broadway', 'Display', null),
  F('titan', 'Titan One', 'Titan One', 'Display', null),
  F('russo', 'Russo One', 'Russo One', 'Display', null),
  F('blackops', 'Black Ops One', 'Black Ops One', 'Display', null),
  F('bungee', 'Bungee', 'Bungee', 'Display', null),
  F('creepster', 'Creepster', 'Creepster', 'Display', null),
  F('monoton', 'Monoton', 'Monoton', 'Display', null),
  F('orbitron', 'Orbitron', 'Orbitron', 'Display', 900),
  F('audiowide', 'Audiowide', 'Audiowide', 'Display', null),
  F('chewy', 'Chewy', 'Chewy', 'Display', null),
  F('playfair', 'Playfair Display', 'Playfair Display', 'Elegant', 900),
  // Real Bold Italic (not synthesized oblique): the 700-italic face is
  // imported above and loaded in fontsReady. Neon Pop Duo's line 2.
  F('playfairbi', 'Playfair Display Bold Italic', 'Playfair Display', 'Elegant', 700, 700),
  F('georgia', 'Georgia', 'Georgia', 'Elegant'),
  F('garamond', 'Garamond', 'Garamond', 'Elegant'),
  F('times', 'Times New Roman', 'Times New Roman', 'Elegant'),
  F('cinzel', 'Cinzel', 'Cinzel', 'Elegant', 900),
  F('abril', 'Abril Fatface', 'Abril Fatface', 'Elegant', null),
  F('dmserif', 'DM Serif Display', 'DM Serif Display', 'Elegant', null),
  F('cormorant', 'Cormorant Garamond', 'Cormorant Garamond', 'Elegant'),
  F('pacifico', 'Pacifico', 'Pacifico', 'Script', null),
  F('lobster', 'Lobster', 'Lobster', 'Script', null),
  F('dancing', 'Dancing Script', 'Dancing Script', 'Script'),
  F('caveat', 'Caveat', 'Caveat', 'Script'),
  F('brush', 'Brush Script', 'Brush Script MT', 'Script', null),
  F('segoescript', 'Segoe Script', 'Segoe Script', 'Script'),
  F('inkfree', 'Ink Free', 'Ink Free', 'Script', null),
  F('greatvibes', 'Great Vibes', 'Great Vibes', 'Script', null),
  F('kaushan', 'Kaushan Script', 'Kaushan Script', 'Script', null),
  F('satisfy', 'Satisfy', 'Satisfy', 'Script', null),
  F('shadows', 'Shadows Into Light', 'Shadows Into Light', 'Script', null),
  F('sacramento', 'Sacramento', 'Sacramento', 'Script', null),
  F('yellowtail', 'Yellowtail', 'Yellowtail', 'Script', null),
  F('cairo', 'Cairo (Arabic)', 'Cairo', 'Arabic', 900),
  // Cairo Medium 500: Neon Pop Duo's Arabic line 1 (regular weight is the
  // Medium here; bold 700 for the bold toggle).
  F('cairomed', 'Cairo Medium', 'Cairo', 'Arabic', 700, 500),
  F('tajawal', 'Tajawal (Arabic)', 'Tajawal', 'Arabic', 900),
  F('lalezar', 'Lalezar (Arabic)', 'Lalezar', 'Arabic', null),
  F('amiri', 'Amiri (Arabic)', 'Amiri', 'Arabic'),
  F('rakkas', 'Rakkas (Arabic)', 'Rakkas', 'Arabic', null),
  F('majalla', 'Sakkal Majalla', 'Sakkal Majalla', 'Arabic'),
  F('tahoma', 'Tahoma', 'Tahoma', 'Arabic'),
  F('almarai', 'Almarai (Arabic)', 'Almarai', 'Arabic', 800),
  F('changa', 'Changa (Arabic)', 'Changa', 'Arabic', 800),
  F('elmessiri', 'El Messiri (Arabic)', 'El Messiri', 'Arabic'),
  F('reemkufi', 'Reem Kufi (Arabic)', 'Reem Kufi', 'Arabic'),
  F('arefruqaa', 'Aref Ruqaa (Arabic)', 'Aref Ruqaa', 'Arabic'),
  F('marhey', 'Marhey (Arabic)', 'Marhey', 'Arabic'),
  F('lemonada', 'Lemonada (Arabic)', 'Lemonada', 'Arabic'),
  F('notokufi', 'Noto Kufi (Arabic)', 'Noto Kufi Arabic', 'Arabic', 900),
  F('notonaskh', 'Noto Naskh (Arabic)', 'Noto Naskh Arabic', 'Arabic'),
  F('baloo', 'Baloo Bhaijaan (Arabic)', 'Baloo Bhaijaan 2', 'Arabic', 800),
  F('readex', 'Readex Pro (Arabic)', 'Readex Pro', 'Arabic'),
  F('arial', 'Arial', 'Arial', 'Basic'),
  F('segoe', 'Segoe UI', 'Segoe UI', 'Basic'),
  F('segoeblack', 'Segoe UI Black', 'Segoe UI Black', 'Basic', null),
  F('bahnschrift', 'Bahnschrift', 'Bahnschrift', 'Basic'),
  F('calibri', 'Calibri', 'Calibri', 'Basic'),
  F('verdana', 'Verdana', 'Verdana', 'Basic'),
  F('trebuchet', 'Trebuchet MS', 'Trebuchet MS', 'Basic'),
  F('comic', 'Comic Sans', 'Comic Sans MS', 'Basic'),
  F('consolas', 'Consolas', 'Consolas', 'Basic'),
];

const BY_ID = Object.fromEntries(FONT_LIST.map((f) => [f.id, f]));
// Ids used by older projects.
const LEGACY = { arialbd: 'arial' };

// ---- Your fonts (imported .ttf / .otf / .woff / .woff2, kept for every project) ----
// Loaded from their bytes into document.fonts; each gets its own family name so it never clashes with a
// built-in one. A project that uses a font this PC does not have falls back to Arial.
export const CUSTOM_GROUP = 'Your fonts';
let custom = [];
const listeners = new Set();
const changed = () => listeners.forEach((fn) => fn());
// Calls fn when the font list changes (a font added or removed). Returns the unsubscribe function.
export function onFontsChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
// Every font: yours first, then the built-in ones.
export const allFonts = () => [...custom, ...FONT_LIST];

const faces = {};
async function loadCustom(list) {
  const next = [];
  for (const { id, name } of list) {
    const family = `Cutflow ${id}`;
    if (!faces[id]) {
      try {
        const data = await window.api.fontData(id);
        if (!data) continue;
        const face = new FontFace(family, data);
        await face.load();
        document.fonts.add(face);
        faces[id] = face;
      } catch {
        continue; // not a font the browser can read
      }
    }
    next.push(F(id, name, family, CUSTOM_GROUP));
  }
  Object.keys(faces).filter((id) => !list.some((f) => f.id === id)).forEach((id) => {
    document.fonts.delete(faces[id]);
    delete faces[id];
  });
  custom = next;
  changed();
}

let customReady = null;
function customFonts() {
  if (!customReady) customReady = window.api?.fontsList ? window.api.fontsList().then(loadCustom).catch(() => {}) : Promise.resolve();
  return customReady;
}

// Adds font files (dropped File objects, or the file picker when none). Returns { added: [ids], skipped, error }.
export async function importFonts(files) {
  const res = await window.api.fontsImport(files || null);
  if (res.error) return res;
  await customFonts();
  await loadCustom(res.list);
  return res;
}

export async function removeFont(id) {
  const res = await window.api.fontsRemove(id);
  if (res.list) await loadCustom(res.list);
  return res;
}

export function fontById(id) {
  return BY_ID[id] || custom.find((f) => f.id === id) || BY_ID[LEGACY[id]] || BY_ID.arial;
}

// True when the font id resolves to a real face on this PC — a built-in,
// a loaded custom font, or a legacy alias. False means fontById would
// silently fall back to Arial, which is exactly what the export QC
// reports as a missing font (P1-57). A custom font whose file the browser
// could not read never lands in `custom`, so it reads as missing here.
export function fontKnown(id) {
  return !!(id && (BY_ID[id] || custom.find((f) => f.id === id) || BY_ID[LEGACY[id]]));
}

export function cssFont(fontId, sizePx, bold, italic) {
  const f = fontById(fontId);
  const weight = bold ? f.bold ?? f.regular : f.regular;
  return `${italic ? 'italic ' : ''}${weight} ${sizePx}px "${f.family}", Arial, sans-serif`;
}

// ---- Per-font on-demand loading (FB-33 / P2-28) ----
// The faces a font id needs, as (family, weight, style) triples — pure,
// so the unit test can check the gate without a DOM. Regular is always
// needed; bold adds the bold face; italic uses a real italic face when
// the store has one (Playfair Bold Italic) and otherwise falls back to
// the upright face (the browser synthesises the oblique, as before).
export function facesForFont(fontId, { bold = false, italic = false } = {}) {
  const f = fontById(fontId);
  if (!f || f.family.startsWith('Cutflow ')) return []; // custom fonts load through loadCustom
  const weights = [f.regular, bold ? f.bold : null].filter((w, i, a) => w != null && a.indexOf(w) === i);
  return weights.map((weight) => ({
    family: f.family, weight,
    style: italic && faceInStore(f.family, weight, 'italic') ? 'italic' : 'normal',
  }));
}

const inflight = new Map(); // gate key -> Promise (one load per face, ever)
// Load gate: confirms the faces a font id needs are loaded before any
// frame using them renders. A bundled face comes from the runtime store;
// a system font (or Inter, imported by main.jsx) just confirms through
// document.fonts. A custom font id first makes sure the custom list is
// loaded. Never rejects — an unloadable face resolves and the renderer
// falls back, exactly as before.
export function ensureFontLoaded(fontId, opts = {}) {
  const key = `${fontId}|${opts.bold ? 'b' : 'r'}|${opts.italic ? 'i' : 'n'}`;
  if (!inflight.has(key)) {
    inflight.set(key, (async () => {
      if (!BY_ID[fontId] && !BY_ID[LEGACY[fontId]]) await customFonts().catch(() => {});
      const faces = facesForFont(fontId, opts);
      for (const { family, weight, style } of faces) {
        await loadFace(family, weight, style);
        try { await document.fonts.load(`${style === 'italic' ? 'italic ' : ''}${weight} 32px "${family}"`, 'Aa أب'); } catch { /* fallback */ }
      }
      await document.fonts.ready;
    })());
  }
  return inflight.get(key);
}

// The gate for a whole project: every font id its text clips use, with
// the bold/italic variants the clips actually ask for. Export (and the
// preview) await this before drawing any frame, so a frame can never
// render with a font that is still loading.
export function ensureFontsForProject(project) {
  const jobs = new Map();
  for (const c of project.textClips || []) {
    if (!c.font) continue;
    const key = `${c.font}|${c.bold ? 'b' : 'r'}|${c.italic ? 'i' : 'n'}`;
    if (!jobs.has(key)) jobs.set(key, ensureFontLoaded(c.font, { bold: !!c.bold, italic: !!c.italic }));
  }
  return Promise.all([...jobs.values()]);
}

// The FontPicker's list: load the faces for the fonts it shows (both
// weights, so each name renders in its own face). Called when the picker
// opens or its filter changes — never at startup.
export function ensureFontsForList(fontIds) {
  return Promise.all((fontIds || []).map((id) => ensureFontLoaded(id, { bold: true })));
}

// Resolves once your (custom) fonts have been loaded. Bundled faces are
// NOT loaded here any more — they load on demand through
// ensureFontLoaded / ensureFontsForProject, so startup no longer waits
// on ~100 faces and fetches no woff2 it never uses. (Before FB-33 this
// loaded every bundled face; callers that need a bundled face must go
// through the gate.)
let ready = null;
export function fontsReady() {
  if (!ready) ready = customFonts().then(() => document.fonts.ready);
  return ready;
}
