// P2-24 smoke test, direct-API variant: no HF network at all
// (HF_HUB_OFFLINE=1 forces cache-only), 5 s clip, single ORT thread.
// Prints the same isolation measures as test-p2e-demucs-smoke.mjs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = path.join(ROOT, '.tmp-p2e-live', 'demucs');
const PY = path.join(DIR, 'venv', 'bin', 'python');

const code = `
import os, time, numpy as np, soundfile as sf
os.environ['HF_HUB_OFFLINE'] = '1'
from demucs_onnx import separate_stem
mix = '${DIR}/mix5.wav'
# 5 s slice of the 20 s mix
x, sr = sf.read('${DIR}/mix.wav')
sf.write(mix, x[:5*sr], sr)
t0 = time.time()
out = separate_stem(mix, 'vocals', providers='cpu', precision='fp16weights')
wall = time.time() - t0
print(f'separation wall: {wall:.1f} s for a 5 s clip ({5/wall:.2f}x real-time)')
sf.write('${DIR}/out5-vocals.wav', out, sr)
def band(x, sr, lo, hi):
    X = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    f = np.fft.rfftfreq(len(x), 1 / sr)
    m = (f >= lo) & (f < hi); return float(np.sum(X[m] ** 2))
m, _ = sf.read('${DIR}/mix.wav'); m = m[:5*sr, 0]
v, _ = sf.read('${DIR}/out5-vocals.wav'); v = v[:, 0]
tv, _ = sf.read('${DIR}/vocals.wav'); tv = tv[:5*sr, 0]
print('bass 80Hz suppression %.1f dB' % (10*np.log10(band(m, sr, 60, 100)/max(band(v, sr, 60, 100), 1e-12))))
print('voice-band retention %.0f%%' % (100*band(v, sr, 300, 900)/band(tv, sr, 300, 900)))
print('DEMUCS DIRECT OK')
`;
fs.writeFileSync(path.join(DIR, 'direct.py'), code);
const r = execFileSync(PY, [path.join(DIR, 'direct.py')], {
  encoding: 'utf8', timeout: 600000, maxBuffer: 1e7,
  env: { ...process.env, HF_HUB_OFFLINE: '1', OMP_NUM_THREADS: '1', MKL_NUM_THREADS: '1' },
});
console.log(r);
