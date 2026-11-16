// FX-03 — real-footage effect thumbnails: the grab-time rule and the
// wiring that runs effect tiles on the user's own clip frame.
// Usage: node scripts/test-fx-live-thumbs.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { thumbTimeFor } from '../src/fx/frameGrab.js';

const clip = { in: 2, out: 10, duration: 12 }; // 8 s local span, starts at 2 s in the source

// Playhead inside the clip → the local time under the playhead.
assert.equal(thumbTimeFor(clip, 5, 100), 4, 'playhead before the clip falls back to the midpoint');
assert.equal(thumbTimeFor(clip, 103, 100), 3, 'playhead inside the clip grabs its local time');
assert.equal(thumbTimeFor(clip, 108, 100), 8, 'playhead at the clip end grabs the last frame');
assert.equal(thumbTimeFor(clip, 200, 100), 4, 'playhead past the clip falls back to the midpoint');
assert.equal(thumbTimeFor({ in: 0, out: 0 }, 0, 0), 0, 'a zero-span clip grabs time 0');

// Wiring: the tile path carries the user's frame through, and the panel
// offers the toggle only when a usable clip is selected.
const previews = fs.readFileSync(new URL('../src/fx/previews.jsx', import.meta.url), 'utf8');
assert.ok(/drawPreview\(ctx, kind, id, u, pair = 0, source = null\)/.test(previews), 'drawPreview takes an optional user-frame source');
assert.ok(/source && kind === 'effect' \? \[source, source\] : photoPair\(pair\)/.test(previews), 'effects run on the user frame; transitions keep the sample pair');
assert.ok(/function useLiveThumbFrame\(target, media, time\)/.test(previews), 'the grab hook exists');
assert.ok(/grabFrame\(\{ url: toFileUrl\(m\.path\), at, isImage: m\.type === 'image' \}\)/.test(previews), 'the hook grabs at clip.in + the local grab time');
assert.ok(/m\.type !== 'audio'/.test(previews), 'audio clips never offer a frame');
const left = fs.readFileSync(new URL('../src/components/LeftPanel.jsx', import.meta.url), 'utf8');
assert.ok(/useLiveThumbFrame\(target, media, time\)/.test(left), 'the Effects tab grabs the selected clip’s frame');
assert.ok(/<FxThumb kind="effect" id=\{e\.id\} source=\{thumbSource\} \/>/.test(left), 'effect tiles receive the user frame');
assert.ok(/panel\.effects\.thumbMine/.test(left), 'the toggle is labelled');
for (const lang of ['en', 'fr', 'ar']) {
  const dict = fs.readFileSync(new URL(`../src/i18n/${lang}.js`, import.meta.url), 'utf8');
  assert.ok(dict.includes('"panel.effects.thumbMine"'), `${lang}: thumbMine key`);
  assert.ok(dict.includes('"panel.effects.thumbMineHint"'), `${lang}: thumbMineHint key`);
}

console.log('fx-live-thumbs: all checks passed');
