// Generates Cutflow's bundled sound effects (shared/sfx/*.mp3) and the renderer
// registry (src/sfx.js) from synthesis recipes — 10/10 step 3.
//
// Every sound is 100% original: synthesized procedurally with the app's own FFmpeg
// from oscillators and filtered noise (chirps, decaying partials, band-swept noise
// segments). No samples, no downloads, no third-party audio. Re-running this script
// reproduces the same files and registry (durations are probed from the output).
//
// Usage: node scripts/gen-bundled-sfx.cjs
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ff = require('../electron/ffmpeg.cjs');

const FFMPEG = ff.ffmpegPath;
const OUT = path.join(__dirname, '..', 'shared', 'sfx');
const REGISTRY = path.join(__dirname, '..', 'src', 'sfx.js');
const SR = 44100;

// ---- Recipe helpers -------------------------------------------------------
// A linear chirp f0 -> f1 over the whole clip: phase = f0*t + (f1-f0)*t^2/(2*dur).
const chirpPhase = (f0, f1, dur) => `(${f0}*t + ${(f1 - f0) / (2 * dur)}*t*t)`;
const tone = (expr, dur) => `aevalsrc='${expr}':s=${SR}:d=${dur}`; // quoted: commas in exprs are option separators otherwise
const sine = (f) => `sin(2*PI*${f}*t)`;
const noise = (dur, color = 'white') => `anoisesrc=d=${dur}:c=${color}:s=${SR}`;
// A whoosh: the same noise cut into segments, each band-passed at a rising (or
// falling) centre, concatenated and enveloped — a filter sweep with no per-frame
// expression support required from the FFmpeg build.
function whooshGraph(centers, segDur) {
  const n = centers.length;
  const split = `[0:a]asplit=${n}${centers.map((_, i) => `[s${i}]`).join('')}`;
  const parts = centers.map((f, i) => `[s${i}]atrim=${(i * segDur).toFixed(3)}:${((i + 1) * segDur).toFixed(3)},bandpass=f=${f}:w=1.1,volume=1.6[a${i}]`);
  const total = (n * segDur).toFixed(2);
  return `${split};${parts.join(';')};${centers.map((_, i) => `[a${i}]`).join('')}concat=n=${n}:v=0:a=1,afade=t=in:st=0:d=${(segDur * 0.9).toFixed(2)},afade=t=out:st=${(n * segDur - segDur * 1.4).toFixed(2)}:d=${(segDur * 1.4).toFixed(2)}[out]`;
  // total is implicit in the segments; kept for readability of the recipe table.
}
// Concatenate tone segments end to end (melodies, two-tone signals).
function seqGraph(n) {
  return `${Array.from({ length: n }, (_, i) => `[${i}:a]`).join('')}concat=n=${n}:v=0:a=1[out]`;
}
// ---- The library ----------------------------------------------------------
const DEFS = [
  // Whooshes — band-swept noise.
  { id: 'whoosh-air', name: 'Air Whoosh', cat: 'Whoosh', inputs: [noise(0.9)], graph: () => whooshGraph([300, 600, 1100, 1900, 2800, 3800], 0.15) },
  { id: 'whoosh-fast', name: 'Fast Whoosh', cat: 'Whoosh', inputs: [noise(0.48)], graph: () => whooshGraph([500, 1300, 2600, 4200], 0.12) },
  { id: 'whoosh-deep', name: 'Deep Whoosh', cat: 'Whoosh', inputs: [noise(1.1)], graph: () => whooshGraph([150, 260, 430, 650, 900], 0.22) },
  { id: 'whoosh-back', name: 'Reverse Whoosh', cat: 'Whoosh', inputs: [noise(0.9)], graph: () => whooshGraph([3800, 2800, 1900, 1100, 600, 300], 0.15) },
  // Risers — chirps that climb.
  { id: 'riser-synth', name: 'Synth Riser', cat: 'Riser', inputs: [tone(`0.5*sin(2*PI*${chirpPhase(180, 1080, 1.4)})*min(1, t*3)`, 1.4)], af: 'afade=t=out:st=1.2:d=0.2' },
  { id: 'riser-bright', name: 'Bright Riser', cat: 'Riser', inputs: [tone(`0.34*sin(2*PI*${chirpPhase(220, 1620, 1.2)}) + 0.2*sin(2*PI*2*${chirpPhase(220, 1620, 1.2)})`, 1.2)], af: 'afade=t=in:st=0:d=0.1,afade=t=out:st=1.0:d=0.2' },
  { id: 'riser-tension', name: 'Tension Riser', cat: 'Riser', inputs: [tone(`0.55*sin(2*PI*${chirpPhase(90, 210, 2.0)})*(0.75 + 0.25*sin(2*PI*9*t))`, 2.0)], af: 'afade=t=in:st=0:d=0.4,afade=t=out:st=1.8:d=0.2' },
  { id: 'riser-chime', name: 'Chime Riser', cat: 'Riser', inputs: [tone('0.4*sin(2*PI*660*t)*exp(-9*t)', 0.3), tone('0.4*sin(2*PI*880*t)*exp(-9*t)', 0.3), tone('0.42*sin(2*PI*1320*t)*exp(-5*t)', 0.5)], graph: () => seqGraph(3) },
  // Sweeps.
  { id: 'sweep-down', name: 'Sweep Down', cat: 'Sweep', inputs: [tone(`0.5*sin(2*PI*${chirpPhase(1800, 300, 0.9)})`, 0.9)], af: 'afade=t=in:st=0:d=0.05,afade=t=out:st=0.7:d=0.2' },
  { id: 'sweep-up-soft', name: 'Soft Sweep Up', cat: 'Sweep', inputs: [tone(`0.45*sin(2*PI*${chirpPhase(300, 900, 1.0)})*(0.8 + 0.2*sin(2*PI*6*t))`, 1.0)], af: 'afade=t=in:st=0:d=0.15,afade=t=out:st=0.8:d=0.2' },
  { id: 'siren', name: 'Siren', cat: 'Sweep', inputs: [tone('0.4*sin(2*PI*(700*t - 59.7*cos(2*PI*0.8*t)))', 1.6)], af: 'afade=t=in:st=0:d=0.1,afade=t=out:st=1.4:d=0.2' },
  { id: 'gliss-harp', name: 'Harp Gliss', cat: 'Sweep', inputs: [tone(`0.45*sin(2*PI*${chirpPhase(800, 2400, 0.5)})*exp(-1.2*t)`, 0.5)], af: 'afade=t=out:st=0.35:d=0.15' },
  // Impacts — pitch-dropping sines and shaped noise.
  { id: 'impact-deep', name: 'Deep Impact', cat: 'Impact', inputs: [tone(`0.9*sin(2*PI*${chirpPhase(120, 50, 0.8)})*exp(-6*t)`, 0.8)] },
  { id: 'impact-punch', name: 'Punch Impact', cat: 'Impact', inputs: [tone(`0.7*sin(2*PI*${chirpPhase(160, 60, 0.5)})*exp(-10*t)`, 0.5), noise(0.5)], graph: () => '[0:a][1:a]amix=inputs=2:normalize=0,lowpass=f=900,volume=1.1[out]' },
  { id: 'boom-sub', name: 'Sub Boom', cat: 'Impact', inputs: [tone(`0.95*sin(2*PI*${chirpPhase(58, 30, 1.2)})*exp(-3.2*t)`, 1.2)] },
  { id: 'thud', name: 'Soft Thud', cat: 'Impact', inputs: [noise(0.28)], af: 'lowpass=f=180,afade=t=out:st=0.02:d=0.24,volume=1.4' },
  { id: 'kick-hit', name: 'Kick Hit', cat: 'Impact', inputs: [tone(`0.85*sin(2*PI*${chirpPhase(150, 48, 0.4)})*exp(-11*t)`, 0.4), noise(0.4)], graph: () => '[1:a]highpass=f=4000,volume=0.5,atrim=0:0.05[n];[0:a][n]amix=inputs=2:normalize=0,volume=1.05,atrim=0:0.4[out]' },
  // Clicks & mechanicals.
  { id: 'click-ui', name: 'UI Click', cat: 'Click', inputs: [tone(`0.7*${sine(1800)}*exp(-90*t)`, 0.08)] },
  { id: 'click-wood', name: 'Wood Click', cat: 'Click', inputs: [noise(0.07)], af: 'bandpass=f=900:w=2,afade=t=out:st=0.01:d=0.05,volume=1.3' },
  { id: 'pop', name: 'Pop', cat: 'Click', inputs: [tone(`0.8*sin(2*PI*${chirpPhase(480, 140, 0.09)})*exp(-16*t)`, 0.12)] },
  { id: 'snap', name: 'Snap', cat: 'Click', inputs: [noise(0.05)], af: 'highpass=f=3000,afade=t=out:st=0.005:d=0.04,volume=1.2' },
  { id: 'tick-tock', name: 'Tick Tock', cat: 'Click', inputs: [noise(0.45), noise(0.1), noise(0.1)], graph: () => '[0:a]volume=0[sil];[1:a]bandpass=f=1200:w=2,volume=1.2,atrim=0:0.45[b0];[2:a]bandpass=f=900:w=2,volume=1.1,atrim=0:0.45,adelay=220:all=1[b1];[sil][b0][b1]amix=inputs=3:normalize=0,atrim=0:0.45[out]' },
  { id: 'shutter', name: 'Camera Shutter', cat: 'Click', inputs: [noise(0.08), noise(0.14)], graph: () => '[0:a]highpass=f=2500,volume=1.1,atrim=0:0.3[b0];[1:a]highpass=f=1800,volume=0.9,atrim=0:0.3,adelay=70:all=1[b1];[b0][b1]amix=inputs=2:normalize=0,atrim=0:0.3[out]' },
  { id: 'keys', name: 'Keyboard Taps', cat: 'Click', inputs: [noise(0.06), noise(0.06), noise(0.06)], graph: () => '[0:a]bandpass=f=1500:w=2,volume=1.1,atrim=0:0.5[b0];[1:a]bandpass=f=1200:w=2,volume=1,atrim=0:0.5,adelay=130:all=1[b1];[2:a]bandpass=f=1700:w=2,volume=1.1,atrim=0:0.5,adelay=260:all=1[b2];[b0][b1][b2]amix=inputs=3:normalize=0,atrim=0:0.5[out]' },
  // Chimes & signals — decaying partial stacks and tone sequences.
  { id: 'chime-bright', name: 'Bright Chime', cat: 'Chime', inputs: [tone('0.5*sin(2*PI*1318*t)*exp(-6*t) + 0.3*sin(2*PI*1975*t)*exp(-8*t) + 0.18*sin(2*PI*2637*t)*exp(-10*t)', 1.2)] },
  { id: 'chime-soft', name: 'Soft Chime', cat: 'Chime', inputs: [tone('0.45*sin(2*PI*880*t)*exp(-4*t) + 0.25*sin(2*PI*1318*t)*exp(-5.5*t)', 1.6)] },
  { id: 'bell-deep', name: 'Deep Bell', cat: 'Chime', inputs: [tone('0.5*sin(2*PI*392*t)*exp(-2.2*t) + 0.3*sin(2*PI*587*t)*exp(-3*t) + 0.18*sin(2*PI*880*t)*exp(-4*t) + 0.1*sin(2*PI*1174*t)*exp(-5*t)', 2.4)] },
  { id: 'notify', name: 'Notification', cat: 'Chime', inputs: [tone('0.5*sin(2*PI*1046*t)*exp(-7*t)', 0.22), tone('0.5*sin(2*PI*784*t)*exp(-4.5*t)', 0.45)], graph: () => seqGraph(2) },
  { id: 'success', name: 'Success Arp', cat: 'Chime', inputs: [tone('0.45*sin(2*PI*523*t)*exp(-10*t)', 0.14), tone('0.45*sin(2*PI*659*t)*exp(-10*t)', 0.14), tone('0.5*sin(2*PI*784*t)*exp(-5*t)', 0.5)], graph: () => seqGraph(3) },
  { id: 'coin', name: 'Coin', cat: 'Chime', inputs: [tone('0.42*sin(2*PI*988*t)', 0.07), tone('0.42*sin(2*PI*1319*t)*exp(-4*t)', 0.4)], graph: () => seqGraph(2) },
  // Misc.
  { id: 'bubble', name: 'Bubble', cat: 'Misc', inputs: [tone(`0.6*sin(2*PI*${chirpPhase(300, 760, 0.16)})*exp(-7*t)`, 0.2)] },
  { id: 'error-buzz', name: 'Error Buzz', cat: 'Misc', inputs: [tone(`(0.5*${sine(165)} + 0.2*sin(2*PI*495*t))*(0.7 + 0.3*sin(2*PI*30*t))`, 0.35)], af: 'afade=t=in:st=0:d=0.01,afade=t=out:st=0.28:d=0.07' },
  { id: 'heartbeat', name: 'Heartbeat', cat: 'Misc', inputs: [tone(`0.9*${sine(52)}*(exp(-20*t) + if(gt(t, 0.3), exp(-20*(t - 0.3)), 0))`, 0.95)] },
  { id: 'wind-bed', name: 'Wind Bed', cat: 'Misc', inputs: [noise(2.2, 'pink')], af: 'lowpass=f=420,tremolo=f=0.15:d=0.7,afade=t=in:st=0:d=0.4,afade=t=out:st=1.8:d=0.4,volume=0.8' },
];

function build(def) {
  const file = path.join(OUT, `${def.id}.mp3`);
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const inp of def.inputs) args.push('-f', 'lavfi', '-i', inp);
  if (def.graph) args.push('-filter_complex', def.graph(), '-map', '[out]');
  else if (def.af) args.push('-af', def.af);
  args.push('-c:a', 'libmp3lame', '-b:a', '96k', '-ar', String(SR), '-ac', '1', file);
  execFileSync(FFMPEG, args, { stdio: 'pipe' });
  return file;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const items = [];
  let totalBytes = 0;
  for (const def of DEFS) {
    const file = build(def);
    const meta = await ff.probe(file);
    const bytes = fs.statSync(file).size;
    totalBytes += bytes;
    items.push({ id: def.id, name: def.name, cat: def.cat, file: `${def.id}.mp3`, dur: Math.round(meta.duration * 100) / 100, bytes });
    console.log(`${def.id}  ${meta.duration.toFixed(2)}s  ${bytes} B`);
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ generator: 'scripts/gen-bundled-sfx.cjs', items }, null, 2) + '\n');
  const reg = `// Bundled sound effects — GENERATED by scripts/gen-bundled-sfx.cjs; do not hand-edit.
// Every entry is an original sound synthesized procedurally with FFmpeg (chirps,
// decaying partials, band-swept noise) and shipped in shared/sfx/. Durations are
// probed from the generated files, so this registry cannot drift from the audio.
export const SFX_CATS = ${JSON.stringify([...new Set(DEFS.map((d) => d.cat))])};
export const SFX_ITEMS = ${JSON.stringify(items.map(({ bytes, ...rest }) => rest), null, 2)};
`;
  fs.writeFileSync(REGISTRY, reg);
  console.log(`sfx OK: ${items.length} sounds, ${totalBytes} bytes total, registry written`);
})().catch((e) => { console.error(e); process.exit(1); });
