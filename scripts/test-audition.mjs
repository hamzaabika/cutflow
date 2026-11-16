// MisterHorse P2-4 — sound-browser pitch/reverse audition: the pure helpers
// (rates, reverse window/item) plus a static check that AudioLibrary wires
// them into the shared preview player. Live playback is verified in the dev
// app (see the gap-build report).
import { readFileSync } from 'node:fs';
import { AUDITION_RATES, REVERSE_AUDITION_SECONDS, reverseAuditionWindow, reverseAuditionItem } from '../src/audition.js';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

// Rates: 1x is the neutral default, the set spans half to double speed.
ok(AUDITION_RATES.includes(1), 'rates include 1x');
ok(AUDITION_RATES[0] === 0.5 && AUDITION_RATES[AUDITION_RATES.length - 1] === 2, `rates span 0.5x-2x (${AUDITION_RATES.join(', ')})`);
ok(new Set(AUDITION_RATES).size === AUDITION_RATES.length, 'rates are unique');

// Reverse window: at most the first 20 seconds; unknown durations get 20s.
ok(REVERSE_AUDITION_SECONDS === 20, 'reverse cap is 20s');
{
  const w = reverseAuditionWindow(5);
  ok(w.from === 0 && w.to === 5, 'short sound reverses in full (0-5s)');
  const w2 = reverseAuditionWindow(60);
  ok(w2.from === 0 && w2.to === 20, 'long sound reverses only the first 20s');
  const w3 = reverseAuditionWindow(undefined);
  ok(w3.from === 0 && w3.to === 20, 'unknown duration reverses the first 20s');
  const w4 = reverseAuditionWindow(0);
  ok(w4.to === 20, 'zero duration reverses the first 20s');
}

// Reverse item: pure-audio shape for the existing reverseRun IPC.
{
  const item = reverseAuditionItem('/x/y.mp3', 12);
  ok(item.path === '/x/y.mp3' && item.duration === 12 && item.type === 'audio', 'reverse item shape');
  ok(reverseAuditionItem('/x/y.mp3', undefined).duration === 20, 'reverse item falls back to 20s duration');
}

// Static wiring: the library's shared preview player applies the pitch to
// the Audio element, renders the reversed derivative when the mode is on,
// and shows the audition bar.
{
  const src = readFileSync(new URL('../src/components/AudioLibrary.jsx', import.meta.url), 'utf8');
  ok(src.includes('a.playbackRate = rate'), 'preview applies playbackRate on play');
  ok(src.includes('a.preservesPitch = false'), 'preview turns preservesPitch off (pitch follows rate)');
  ok(src.includes('window.api.reverseRun(reverseAuditionItem'), 'preview reverses through the existing reverseRun IPC');
  ok(src.includes('revCache'), 'reversed derivatives are cached per item');
  ok(src.includes('data-testid="audition-bar"'), 'audition bar is rendered');
  ok(src.includes('AUDITION_RATES.map'), 'rate buttons render from AUDITION_RATES');
  ok(src.includes('preview.setReversed'), 'reverse toggle is wired');
  ok(!src.includes('preservesPitch = true'), 'no pitch-preserving playback in the audition path');
}

if (fails.length) { console.log(`\ntest-audition: FAIL (${fails.length})`); process.exit(1); }
console.log('\ntest-audition: PASS');
