// Gap-build C — run-10 export frame analysis (raw RGB, no PNG dep):
// (1) near-white pixel counts in the two text bands prove maskedLineReveal +
// lightSweepReveal paint in the EXPORT; (2) green-arc pixel counts in the
// ring annulus prove the progress ring keeps advancing past t=2.5s (the
// static-frame freeze point) after the staticFrame.js fix.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT = '/home/hatch/workspace/.tmp-gap-c-live/out/ui-export.mp4';
const DIR = '/home/hatch/workspace/.tmp-gap-c-live/frames10';
fs.mkdirSync(DIR, { recursive: true });
const ffmpeg = '/usr/bin/ffmpeg';
const times = [0.8, 1.2, 1.5, 2.2, 2.5, 2.8, 3.2];
const W = 640, H = 360;
const frames = {};
for (const t of times) {
  const p = path.join(DIR, `f${t}.rgb`);
  execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', OUT, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', p]);
  frames[t] = fs.readFileSync(p);
}
function bandWhite(d, y0, y1) {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) n++;
  }
  return n;
}
function ringArc(d) {
  let n = 0;
  for (let y = 65; y < 295; y++) for (let x = 205; x < 435; x++) {
    const r = Math.hypot(x - 320, y - 180);
    if (r < 85 || r > 115) continue;
    const i = (y * W + x) * 3;
    const [R, G, B] = [d[i], d[i + 1], d[i + 2]];
    if (Math.abs(R - 74) < 45 && Math.abs(G - 222) < 45 && Math.abs(B - 128) < 45) n++;
  }
  return n;
}
console.log('t     bandA(MASKED y28-42%)  bandB(SWEEP y58-72%)  ringArcPx');
for (const t of times) {
  const d = frames[t];
  console.log(`${t.toFixed(1)}   ${String(bandWhite(d, 100, 152)).padStart(6)}              ${String(bandWhite(d, 208, 260)).padStart(6)}              ${ringArc(d)}`);
}
