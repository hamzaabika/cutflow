// P2-25 Brand Caption Packs: four professional creator subtitle templates —
// Arabic, Darija, bilingual (Duo two-line) and English — all word-by-word,
// all with bundled-font fallbacks, all placed inside the 9:16 safe zone.
// Usage: node scripts/test-p2b-captions.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TEXT_TEMPLATES, TEMPLATE_CATEGORIES,
} from '../src/text/catalog.js';
import { SAFE_ZONES, aspectPositionOf, responsiveTitle } from '../src/text/responsive.js';
import { resolveDuo, DEFAULT_DUO } from '../src/text/duo.js';

const brand = TEXT_TEMPLATES.filter((t) => t.id.startsWith('cap-brand-'));
assert.deepEqual(brand.map((t) => t.id).sort(),
  ['cap-brand-ar', 'cap-brand-bilingual', 'cap-brand-darija', 'cap-brand-en'],
  'the four Brand Caption Packs exist');
assert.ok(TEMPLATE_CATEGORIES.includes('Brand'), 'Brand is a browse category');
for (const t of brand) {
  assert.equal(t.caption, true, `${t.id} is a caption template`);
  assert.equal(t.cat, 'Brand', `${t.id} lives in the Brand pack`);
}

// ---- 1) Word-by-word ----------------------------------------------------------
// wordPop / wordRise / wordSpin are the renderer's per-word unit kinds
// (src/text/render.js animState maps them to { kind: 'wordpop' | 'wordrise' |
// 'wordspin', reveal: p }, played one word at a time by the paint loop).
const WORD_ANIMS = new Set(['wordPop', 'wordRise', 'wordSpin']);
for (const t of brand.filter((x) => x.id !== 'cap-brand-bilingual')) {
  assert.ok(WORD_ANIMS.has(t.patch.animIn.id), `${t.id} enters word by word (${t.patch.animIn.id})`);
  assert.ok(['color', 'box'].includes(t.patch.highlight.mode), `${t.id} highlights per word (${t.patch.highlight.mode})`);
}
// The bilingual one is the Duo two-line model: line 1 pops word by word with
// a neon blur-in, line 2 types in — and Arabic animates per word on both
// lines, never per letter (duo.js: Arabic lines use the rtl tokens).
{
  const t = brand.find((x) => x.id === 'cap-brand-bilingual');
  const d = resolveDuo(t.patch.duo);
  assert.equal(d.line2.font, 'montserrat', 'bilingual line 2 is Montserrat');
  assert.equal(d.line2.color, '#FFD400', 'bilingual line 2 is gold');
  assert.equal(d.rtl.font1, 'cairomed', 'bilingual Arabic line 1 is Cairo Medium');
  assert.equal(d.rtl.font2, DEFAULT_DUO.rtl.font2, 'rtl line-2 token untouched');
  assert.ok(t.patch.text.includes('\n'), 'bilingual template carries two lines');
  assert.ok(/[\u0600-\u06FF]/.test(t.patch.text.split('\n')[0]), 'line 1 is Arabic');
  assert.ok(!/[\u0600-\u06FF]/.test(t.patch.text.split('\n')[1]), 'line 2 is Latin');
}

// ---- 2) Font fallback ---------------------------------------------------------
// fonts.js cannot load in node (it imports @fontsource CSS), so the check
// reads its font registry: every brand font id must resolve to a real bundled
// family (never the silent Arial fallback), and cssFont must still append
// ", Arial, sans-serif" for a PC that lacks the face.
{
  const src = fs.readFileSync(new URL('../src/fonts.js', import.meta.url), 'utf-8');
  const families = {};
  for (const m of src.matchAll(/F\('([^']+)',\s*'[^']*',\s*'([^']+)'/g)) families[m[1]] = m[2];
  assert.deepEqual(
    { cairo: families.cairo, tajawal: families.tajawal, montserrat: families.montserrat, inter: families.inter },
    { cairo: 'Cairo', tajawal: 'Tajawal', montserrat: 'Montserrat', inter: 'Inter Variable' },
    'brand fonts are bundled faces',
  );
  for (const id of ['cairo', 'cairomed', 'tajawal', 'almarai', 'notokufi', 'montserrat', 'inter', 'poppins']) {
    assert.ok(families[id], `fallback face ${id} is bundled`);
  }
  assert.ok(src.includes('", Arial, sans-serif'), 'cssFont falls back to Arial, sans-serif');
  for (const t of brand) assert.ok(families[t.patch.font], `${t.id} font ${t.patch.font} is bundled`);
}

// ---- 3) 9:16 safe zones --------------------------------------------------------
const zone916 = SAFE_ZONES['9:16'];
assert.deepEqual(zone916, { l: 0.06, r: 0.06, t: 0.10, b: 0.14 });
for (const t of brand.filter((x) => x.id !== 'cap-brand-bilingual')) {
  // The explicit responsive override pins the 9:16 position.
  const pos = aspectPositionOf({ x: 0.5, y: t.patch.y }, t.patch.responsive, 1080, 1920);
  assert.equal(pos.y, 0.78, `${t.id} sits at y 0.78 on 9:16`);
  // A full-width size-64 caption box at that position needs no clamp: the
  // template is designed for the safe zone, not rescued by it.
  const box = { w: 900, h: 110 };
  const r = responsiveTitle(pos.x, pos.y, 1080, 1920, box);
  assert.equal(r.scale, 1, `${t.id} needs no shrink on 9:16`);
  assert.ok(r.cy - box.h / 2 >= zone916.t * 1920, `${t.id} top clears the notch (${(r.cy - box.h / 2).toFixed(0)} >= ${(zone916.t * 1920).toFixed(0)})`);
  assert.ok(r.cy + box.h / 2 <= (1 - zone916.b) * 1920, `${t.id} bottom clears the UI (${(r.cy + box.h / 2).toFixed(0)} <= ${((1 - zone916.b) * 1920).toFixed(0)})`);
  assert.ok(r.cx - box.w / 2 >= zone916.l * 1080 && r.cx + box.w / 2 <= (1 - zone916.r) * 1080, `${t.id} sides stay in the zone`);
  // The same position is safe on 16:9 too.
  const r169 = responsiveTitle(0.5, t.patch.y, 1920, 1080, box);
  assert.equal(r169.scale, 1, `${t.id} needs no shrink on 16:9`);
  assert.ok(r169.cy + box.h / 2 <= 0.92 * 1080, `${t.id} bottom stays in the 16:9 zone`);
}
{
  // Bilingual: two lines around the duo anchor (y 0.6) — well inside.
  const t = brand.find((x) => x.id === 'cap-brand-bilingual');
  const r = responsiveTitle(0.5, t.patch.y, 1080, 1920, { w: 900, h: 220 });
  assert.equal(r.scale, 1, 'bilingual needs no shrink on 9:16');
  assert.ok(r.cy - 110 >= zone916.t * 1920 && r.cy + 110 <= (1 - zone916.b) * 1920, 'bilingual duo box stays in the 9:16 zone');
}
console.log('P2-25 Brand Caption Packs OK');
