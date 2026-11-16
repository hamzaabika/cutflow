// P2-24 smoke test: synthetic mix with KNOWN stems, separated by
// demucs-onnx (vocals specialist, CPU). Measures isolation, not vibes:
//   - bass suppression: 80 Hz energy in the vocals output vs in the mix
//   - drums suppression: click-transient energy in the vocals output
//   - vocals retention: 300-900 Hz band energy vs the true vocals stem
// Run:  node scripts/test-p2e-demucs-smoke.mjs   (uses the venv + CLI
// under .tmp-p2e-live/demucs; downloads the ~316 MB vocals model once)
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = path.join(ROOT, '.tmp-p2e-live', 'demucs');
const PY = path.join(DIR, 'venv', 'bin', 'python');
const CLI = path.join(DIR, 'venv', 'bin', 'demucs-onnx');
const SR = 44100;

fs.writeFileSync(path.join(DIR, 'synth.py'), `
import numpy as np, soundfile as sf
sr = ${SR}; dur = 20.0; t = np.arange(int(sr * dur)) / sr
# vocals: vibrato sine sweep 300 -> 900 Hz + 2nd harmonic (tonal, voice-like)
f0 = 300 + 600 * (t / dur)
phase = 2 * np.pi * np.cumsum(f0 + 8 * np.sin(2 * np.pi * 5 * t)) / sr
voc = 0.5 * np.sin(phase) + 0.25 * np.sin(2 * phase)
voc *= 0.7 + 0.3 * np.sin(2 * np.pi * 2.2 * t)  # slow amplitude sway
# bass: steady 80 Hz sine
bass = 0.5 * np.sin(2 * np.pi * 80 * t)
# drums: noise-burst clicks every 0.5 s, 40 ms decay
rng = np.random.default_rng(7)
dr = np.zeros_like(t)
for k in range(int(dur * 2)):
    s = int(k * 0.5 * sr); n = int(0.04 * sr)
    dr[s:s+n] = rng.standard_normal(n) * np.exp(-np.arange(n) / (n / 4))
mix = voc + bass + dr
mix /= np.max(np.abs(mix)) * 1.05
for name, x in [('vocals', voc), ('bass', bass), ('drums', dr), ('mix', mix)]:
    sf.write('${DIR}/' + name + '.wav', np.stack([x, x], axis=1), sr)
print('synth ok')
`);

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
};

try { execFileSync(PY, ['-c', 'import soundfile'], { stdio: 'ignore' }); }
catch { run(path.join(DIR, 'venv', 'bin', 'pip'), ['install', '-q', '--disable-pip-version-check', 'soundfile']); }
console.log(run(PY, [path.join(DIR, 'synth.py')]).trim());

const t0 = Date.now();
const out = run(CLI, ['separate', '--stem', 'vocals', '--small', '--providers', 'cpu', path.join(DIR, 'mix.wav'), path.join(DIR, 'out')], { timeout: 1800000, env: { ...process.env, OMP_NUM_THREADS: '2', MKL_NUM_THREADS: '2' } });
console.log(out.trim().split('\n').slice(-3).join('\n'));
const wall = (Date.now() - t0) / 1000;
console.log(`separation wall: ${wall.toFixed(1)} s for a 20 s mix (${(20 / wall).toFixed(2)}x real-time)`);

const meas = run(PY, ['-c', `
import numpy as np, soundfile as sf
def load(p):
    x, sr = sf.read(p); return x[:, 0], sr
def band(x, sr, lo, hi):
    X = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    f = np.fft.rfftfreq(len(x), 1 / sr)
    m = (f >= lo) & (f < hi); return float(np.sum(X[m] ** 2))
mix, sr = load('${DIR}/mix.wav')
voc, _ = load('${DIR}/out/vocals.wav')
true_voc, _ = load('${DIR}/vocals.wav')
print('bass 80Hz  mix %.3g  out %.3g  suppression %.1f dB' % (band(mix, sr, 60, 100), band(voc, sr, 60, 100), 10*np.log10(band(mix, sr, 60, 100)/max(band(voc, sr, 60, 100), 1e-12))))
print('voice band  mix %.3g  out %.3g  true %.3g  retention %.0f%%' % (band(mix, sr, 300, 900), band(voc, sr, 300, 900), band(true_voc, sr, 300, 900), 100*band(voc, sr, 300, 900)/band(true_voc, sr, 300, 900)))
# drums: RMS in 30 ms windows right after each click vs between clicks
def click_rms(x):
    on, off = [], []
    for k in range(40):
        s = int(k * 0.5 * sr)
        on.append(np.sqrt(np.mean(x[s:s+int(0.03*sr)]**2)))
        off.append(np.sqrt(np.mean(x[s+int(0.25*sr):s+int(0.28*sr)]**2)))
    return np.mean(on), np.mean(off)
mo, mf = click_rms(mix); vo, vf = click_rms(voc)
print('click RMS mix %.4f -> out %.4f (%.1f dB suppression); floor mix %.4f out %.4f' % (mo, vo, 20*np.log10(mo/max(vo,1e-9)), mf, vf))
`]);
console.log(meas.trim());
console.log('DEMUCS SMOKE OK');
