// Gap-build Stream E — PF-03 timeline virtualization window math.
// Run: node scripts/test-timeline-view.mjs
import assert from 'node:assert/strict';
import { visibleWindow, clipInWindow, timesInWindow, countVisible } from '../src/timelineView.js';

let w = visibleWindow({ scrollLeft: 0, clientWidth: 1200, pps: 60 });
assert.equal(w.start, 0, 'window starts at 0 at scroll 0');
assert.equal(w.end, 30, '1200 px at 60 px/s is 20 s + 10 s overscan');

w = visibleWindow({ scrollLeft: 6000, clientWidth: 1200, pps: 60 });
assert.equal(w.start, 90, 'scrolled window starts at scrollLeft/pps minus overscan');
assert.equal(w.end, 130, 'scrolled window ends at right edge plus overscan');

assert.equal(clipInWindow(0, 5, w), false, 'a clip far left of the window is out');
assert.equal(clipInWindow(95, 10, w), true, 'a clip overlapping the window is in');
assert.equal(clipInWindow(129, 5, w), true, 'a clip straddling the right edge is in');
assert.equal(clipInWindow(131, 5, w), false, 'a clip past the window is out');
assert.equal(clipInWindow(50, 0, w), true, 'no window yet (first paint) renders everything');
assert.equal(clipInWindow(50, 5, null), true, 'null window renders everything');
assert.deepEqual(timesInWindow([0, 50, 95, 120, 129, 200], w), [95, 120, 129], 'ticks filter to the window');
assert.equal(
  countVisible([{ start: 0, len: 5 }, { start: 95, len: 5 }, { start: 200, len: 5 }], w), 1,
  'countVisible counts only in-window clips',
);

console.log('test-timeline-view: PASS');
