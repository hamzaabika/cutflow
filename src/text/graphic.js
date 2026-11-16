// Animated graphics (CC-06) — pure spec + time-driven value logic for the
// graphic text templates. DOM-free on purpose (like src/text/duo.js): the
// renderer (src/text/render.js, drawGraphicClip) draws with it and node tests
// import it directly. Nothing here reads the clock or unseeded randomness.
//
// A graphic template is a normal TEXT_TEMPLATES entry whose patch carries a
// `graphic` spec (kind + per-kind values). The clip's text stays editable:
// the number's end value and the timer's duration are parsed FROM the text,
// the ring's label IS the text, and the two-line / lower-third / label /
// callout graphics render the text itself. No bundled audio: a graphic never
// ships an SFX file — a user who wants a sound adds their own audio clip on
// the audio track (browser preview, waveform scrubbing, pitch in AudioFx).

export const GRAPHIC_KINDS = ['title', 'lowerThird', 'label', 'callout', 'number', 'ring', 'timer', 'boxpop', 'twoline'];

// Kinds whose drawn value changes on every frame of the clip: the export's
// static-frame skip must never treat them as settled (see staticFrame.js).
export const TIME_DRIVEN_KINDS = ['number', 'ring', 'timer'];

export const DEFAULT_GRAPHIC = {
  kind: 'title',
  // Minimal Title: the rule under the text.
  rule: true, ruleColor: '#ffffff',
  // Editorial Lower Third: the accent bar at the text's left edge.
  accent: '#CE0120',
  // Rounded / Outline Label: the bubble fill / frame stroke.
  shape: 'rounded', fill: '#ffffff', frame: '#ffffff',
  // Callout Arrow + Progress Ring: the arrow / the fill arc colour.
  color: '#ffd400', arrow: { dx: 0.16, dy: 0.24 },
  // Kinetic Number: count from `from` to the end value parsed from the text.
  from: 0, decimals: 0, prefix: '', suffix: '',
  // Progress Ring: the track behind the fill arc + the fill colour.
  track: 'rgba(255,255,255,0.25)',
  // Timer Countdown: seconds to count down from (the text wins when it
  // parses as a duration — "0:10" or "10" — so the duration stays editable).
  seconds: 10,
  // Text Box Pop: the box fill + corner radius (px at the template's size).
  radius: 16,
  // Two-Line Scale Reveal: line 2's size relative to line 1.
  line2Scale: 0.72,
};

// Deep-merges a partial graphic spec onto the defaults (one level for the
// arrow sub-object, like resolveDuo).
export function resolveGraphic(partial) {
  const g = { ...DEFAULT_GRAPHIC, ...(partial || {}) };
  g.arrow = { ...DEFAULT_GRAPHIC.arrow, ...((partial || {}).arrow || {}) };
  return g;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOut = (t) => 1 - (1 - t) ** 3;

// The number a Kinetic Number counts TO: the digits in the clip text
// ("1,250" -> 1250, "$99" -> 99), or the fallback when the text has none.
export function parseEndNumber(text, fallback = 100) {
  const m = String(text || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!m) return fallback;
  const v = parseFloat(m[0]);
  return Number.isFinite(v) ? v : fallback;
}

// The seconds a Timer Countdown counts down FROM: "1:30" -> 90, "10" -> 10,
// anything else -> the fallback (the spec's `seconds`).
export function parseTimerSeconds(text, fallback = 10) {
  const s = String(text || '').trim();
  const mmss = s.match(/^(\d+):([0-5]?\d)$/);
  if (mmss) return parseInt(mmss[1], 10) * 60 + parseInt(mmss[2], 10);
  const plain = s.match(/-?\d+(\.\d+)?/);
  if (plain) {
    const v = parseFloat(plain[0]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return fallback;
}

// "0:10" for 10 s, "1:05" for 65 s. Seconds round up while counting so the
// display never shows 0:00 a frame early.
export function formatTimer(seconds) {
  const total = Math.max(0, Math.ceil(seconds - 1e-9));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// "1,250" / "99.5" / "$12" — thousands separators for whole numbers, the
// requested decimals otherwise, optional prefix/suffix around it.
export function formatNumber(value, decimals = 0, prefix = '', suffix = '') {
  const d = Math.max(0, Math.min(2, Math.round(decimals || 0)));
  const body = d === 0
    ? Math.round(value).toLocaleString('en-US')
    : value.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${prefix || ''}${body}${suffix || ''}`;
}

// The counted value at clip progress p (0..1): eases out of `from` into `to`.
export function countValue(from, to, p) {
  return from + (to - from) * easeOut(clamp01(p));
}

// Fraction of the Progress Ring filled at local time lt of a duration-long clip.
export function ringFraction(lt, duration) {
  if (!(duration > 0)) return 0;
  return clamp01(lt / duration);
}

// Seconds left on the Timer Countdown at local time lt.
export function timerRemaining(seconds, lt) {
  return Math.max(0, (seconds || 0) - Math.max(0, lt));
}

// Split a two-line graphic's text: first line is line 1, the rest (joined
// with a space) is line 2. A single line means line 2 is empty.
export function splitGraphicText(text) {
  const parts = String(text || '').split('\n');
  return { line1: parts[0] || '', line2: parts.slice(1).join(' ').trim() };
}
