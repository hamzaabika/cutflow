// Grouped layer templates (Gap-build C, CSV §5.3 graphics rows 178/179/183/184/
// 189/190/191/192/193/197) — the grouped layer-template system the backlog
// notes as missing. A template is a GROUP of ordinary text clips that share
// one groupId: vector parts are clips with `graphic: { kind, ...params }`
// (rendered procedurally by src/text/render.js — preview and export share the
// renderer), text parts are ordinary styled text clips. Nothing new is
// invented at the project level: every part is a real clip, so it stays
// individually editable (text, font, colour, position, graphic params),
// keyframeable, undoable (one dispatch inserts the whole group), saveable and
// reopenable — group selection already expands through src/groups.js.
// No CC-06 overlap was found on the cc-* branches (cc-a/b/c empty, cc-d is
// CC-04 keyframes, cc-e is CC-08 docs), so this system is built here.
import { uid } from '../store.js';

const stroke = (width, color = '#000000') => ({ width, color });
const shadow = (color = '#000000', blur = 10, y = 4, opacity = 0.7) => ({ on: true, color, blur, x: 0, y, opacity });
const NO_SHADOW = { on: false };
const NO_BG = { on: false };
const anim = (inId, outId = 'fade', loop = 'none') => ({
  animIn: { id: inId, dur: 0.35 }, animOut: { id: outId, dur: 0.25 }, animLoop: { id: loop, speed: 1 },
});

// A part: { role, text?, patch } — patch is spread onto the clip (x/y/size/
// font/colour/graphic/anim). Parts paint bottom-to-top in array order.
export const GRAPHIC_TEMPLATES = [
  {
    id: 'split-screen-title', name: 'Split Screen Title', cat: 'Titles',
    desc: 'Two half-screen titles divided by a vertical rule.',
    duration: 4,
    parts: [
      { role: 'divider', patch: { text: '', graphic: { kind: 'panel', w: 10, h: 420, bgColor: '#ffffff', opacity: 0.9, radius: 5 }, x: 0.5, y: 0.5, size: 64, ...anim('fade') } },
      { role: 'left', text: 'SPLIT', patch: { font: 'montserrat', bold: true, size: 84, color: '#ffffff', stroke: stroke(5), shadow: shadow('#000000', 12, 3, 0.8), effect: 'none', bubble: 'none', bg: NO_BG, x: 0.26, y: 0.5, ...anim('slideRight', 'fade') } },
      { role: 'right', text: 'SCREEN', patch: { font: 'montserrat', bold: true, size: 84, color: '#ffffff', stroke: stroke(5), shadow: shadow('#000000', 12, 3, 0.8), effect: 'none', bubble: 'none', bg: NO_BG, x: 0.74, y: 0.5, ...anim('slideLeft', 'fade') } },
    ],
  },
  {
    id: 'cinematic-simple-credits', name: 'Cinematic Simple Credits', cat: 'Titles',
    desc: 'Plain centred credits rolling up over the picture.',
    duration: 8,
    parts: [
      { role: 'credits', text: 'Directed by\nHAMZA ABIKA\n\nEdited with Cutflow\n\nThank you for watching', patch: { graphic: { kind: 'credits', speed: 46 }, font: 'montserrat', bold: true, size: 44, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: NO_BG, x: 0.5, y: 0.5, ...anim('fade', 'fade') } },
    ],
  },
  {
    id: 'brand-endcard', name: 'Brand Endcard', cat: 'Titles',
    desc: 'Dark card with a logo line, a tagline and a handle.',
    duration: 4,
    parts: [
      { role: 'card', patch: { text: '', graphic: { kind: 'panel', wFrac: 0.72, hFrac: 0.52, bgColor: '#111111', opacity: 0.92, radius: 24 }, x: 0.5, y: 0.5, size: 64, ...anim('fade') } },
      { role: 'logo', text: 'CUTFLOW', patch: { font: 'montserrat', bold: true, size: 96, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: NO_BG, x: 0.5, y: 0.4, ...anim('pop', 'fade') } },
      { role: 'tagline', text: 'Made with Cutflow — free & open source', patch: { font: 'montserrat', bold: false, size: 34, color: '#cccccc', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: NO_BG, x: 0.5, y: 0.55, ...anim('fade') } },
      { role: 'handle', text: '@hamza_abika', patch: { font: 'montserrat', bold: true, size: 34, color: '#ff4fd8', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: NO_BG, x: 0.5, y: 0.68, ...anim('fade') } },
    ],
  },
  {
    id: 'stroke-draw-on', name: 'Stroke Draw On', cat: 'Motion Elements',
    desc: 'A checkmark drawn stroke by stroke over the clip.',
    duration: 2,
    parts: [
      { role: 'stroke', patch: { text: '', graphic: { kind: 'stroke-draw-on', shape: 'checkmark', color: '#4ade80', stroke: 0.12 }, x: 0.5, y: 0.5, size: 120, ...anim('fade') } },
    ],
  },
  {
    id: 'progress-ring', name: 'Progress Ring', cat: 'Motion Elements',
    desc: 'A ring that fills over the clip, with a live percentage.',
    duration: 3,
    parts: [
      { role: 'ring', patch: { text: '', graphic: { kind: 'progress-ring', color: '#4ade80', stroke: 0.16 }, x: 0.5, y: 0.5, size: 90, ...anim('pop', 'fade') } },
    ],
  },
  {
    id: 'number-counter', name: 'Number Counter', cat: 'Motion Elements',
    desc: 'Counts 0 to 1,000 across the clip.',
    duration: 3,
    parts: [
      { role: 'counter', patch: { text: '', graphic: { kind: 'number-counter', from: 0, to: 1000, commas: true, color: '#ffffff' }, font: 'montserrat', bold: true, size: 110, stroke: stroke(5), shadow: shadow('#000000', 12, 3, 0.8), x: 0.5, y: 0.5, ...anim('pop', 'fade') } },
    ],
  },
  {
    id: 'countdown-timer', name: 'Countdown Timer', cat: 'Motion Elements',
    desc: 'Counts 0:10 down to 0:00 across ten seconds.',
    duration: 10,
    parts: [
      { role: 'countdown', patch: { text: '', graphic: { kind: 'countdown-timer', seconds: 10, format: 'mmss', color: '#ffffff' }, font: 'montserrat', bold: true, size: 110, stroke: stroke(5), shadow: shadow('#000000', 12, 3, 0.8), x: 0.5, y: 0.5, ...anim('pop', 'fade') } },
    ],
  },
  {
    id: 'progress-bar', name: 'Progress Bar', cat: 'Motion Elements',
    desc: 'A bar that fills left to right with a live percentage.',
    duration: 3,
    parts: [
      { role: 'bar', patch: { text: '', graphic: { kind: 'progress-bar', color: '#4ade80', width: 0.6 }, x: 0.5, y: 0.5, size: 64, ...anim('fade') } },
    ],
  },
  {
    id: 'pointer-highlight', name: 'Pointer Highlight', cat: 'Motion Elements',
    desc: 'A pulsing ring and dot that points at the subject.',
    duration: 3,
    parts: [
      { role: 'pointer', patch: { text: '', graphic: { kind: 'pointer-highlight', color: '#ffd400' }, x: 0.5, y: 0.5, size: 70, ...anim('pop', 'fade') } },
    ],
  },
  {
    id: 'kinetic-dot-grid', name: 'Kinetic Dot Grid', cat: 'Motion Elements',
    desc: 'A grid of dots rippling in a travelling wave.',
    duration: 4,
    parts: [
      { role: 'dots', patch: { text: '', graphic: { kind: 'kinetic-dot-grid', cols: 9, rows: 5, color: '#ffffff' }, x: 0.5, y: 0.5, size: 48, ...anim('fade') } },
    ],
  },
];

export const GRAPHIC_CATEGORIES = ['All', 'Titles', 'Motion Elements'];
export const graphicTemplateById = (id) => GRAPHIC_TEMPLATES.find((t) => t.id === id) || null;

// Build the clips for one template insert: every part gets the same groupId
// and the same start/duration, so the group moves, deletes and duplicates as
// one (src/groups.js) while each part stays editable on its own.
export function graphicTemplateClips(templateId, at) {
  const tpl = graphicTemplateById(templateId);
  if (!tpl) return [];
  const groupId = uid();
  return tpl.parts.map((part) => ({
    id: uid(),
    text: part.text ?? '',
    start: Math.max(0, at || 0),
    duration: tpl.duration,
    y: 0.5,
    ...part.patch,
    groupId,
    graphicTemplate: tpl.id,
    graphicPart: part.role,
  }));
}
