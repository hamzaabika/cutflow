// CSV §6.3 classifier: match every CutFlow_Creative_Preset_Backlog.csv row
// against the code registries by normalized name (the CSV slugs are not
// code ids). Output: MATCH / MISSING per row, grouped by category.
// Usage: node scripts/classify-csv.mjs [--json]
import { readFileSync } from 'node:fs';
import { TEXT_ANIMS_IN, TEXT_ANIMS_OUT } from '../src/fx/textAnim.js';
import { FX_TRANSITIONS, PIXEL_EFFECTS, OVERLAY_EFFECTS } from '../src/fx/catalog.js';
import { TRANSITIONS } from '../src/effects.js';
import { STICKERS } from '../src/stickers.js';
import { CLASSIC_IDS } from '../src/fx/params.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const csvText = readFileSync('/home/hatch/workspace/user/files/CutFlow_Creative_Preset_Backlog.csv', 'utf8');
const lines = csvText.split('\n').filter(Boolean);
// minimal CSV parse: the file's fields contain quoted commas; use a small parser
function parseCsv(text) {
  const rows = [];
  let cur = []; let field = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { cur.push(field); field = ''; }
    else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
    else field += c;
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}
const parsed = parseCsv(csvText);
const header = parsed[0].map((h) => h.replace(/^\uFEFF/, ''));
const rows = parsed.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] || ''])));

const textNames = new Set([...TEXT_ANIMS_IN, ...TEXT_ANIMS_OUT].map((a) => norm(a.name)));
const textAnims = new Set([...TEXT_ANIMS_IN, ...TEXT_ANIMS_OUT].map((a) => norm(a.anim)));
const trNames = new Set([...FX_TRANSITIONS.map((t) => t.name), ...TRANSITIONS.map((t) => t.name)].map(norm));
const trIds = new Set([...FX_TRANSITIONS.map((t) => t.id), ...TRANSITIONS.map((t) => t.id)].map(norm));
const fxNames = new Set([...PIXEL_EFFECTS.map((e) => e.name), ...OVERLAY_EFFECTS.map((e) => e.name)].map(norm));
const fxIds = new Set([...PIXEL_EFFECTS.map((e) => e.id), ...OVERLAY_EFFECTS.map((e) => e.id), ...CLASSIC_IDS].map(norm));
const stickerNames = new Set(STICKERS.map((s) => norm(s.name)));

const results = [];
for (const r of rows) {
  const slug = r.id.replace(/^cutflow\./, '');
  const slugNorm = norm(slug);
  const nameNorm = norm(r.recipe);
  let status = 'MISSING'; let via = '';
  if (r.category === 'Text Animation') {
    if (textNames.has(nameNorm) || textAnims.has(slugNorm)) { status = 'MATCH'; via = 'text anim name'; }
  } else if (r.category === 'Transition') {
    if (trNames.has(nameNorm) || trIds.has(slugNorm) || trNames.has(slugNorm)) { status = 'MATCH'; via = 'transition name/id'; }
  } else if (r.category === 'Effect') {
    if (fxNames.has(nameNorm) || fxIds.has(slugNorm) || fxNames.has(slugNorm)) { status = 'MATCH'; via = 'effect name/id'; }
  } else if (r.category === 'Graphics') {
    if (stickerNames.has(nameNorm) || stickerNames.has(slugNorm)) { status = 'MATCH'; via = 'sticker name'; }
  }
  results.push({ ...r, status, via });
}

const cats = ['Text Animation', 'Transition', 'Effect', 'Graphics', 'Captions', 'Library & UX', 'Audio'];
for (const cat of cats) {
  const rs = results.filter((r) => r.category === cat);
  const matched = rs.filter((r) => r.status === 'MATCH');
  console.log(`\n== ${cat}: ${matched.length}/${rs.length} matched ==`);
  for (const r of rs.filter((x) => x.status === 'MISSING')) console.log(`  MISSING  ${r.id} | ${r.recipe} | ${r.subfamily}`);
}
console.log(`\nTOTAL matched: ${results.filter((r) => r.status === 'MATCH').length}/${results.length}`);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 1));
}
