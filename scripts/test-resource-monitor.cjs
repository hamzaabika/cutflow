// P2-36 unit test: the resource monitor's collector + peak sampler, with fake
// Electron app / process / os sources (Electron does not exist in plain Node).
// Usage: node scripts/test-resource-monitor.cjs
const assert = require('assert');
const { collectMetrics, startPeakSampler } = require('../electron/resourceMonitor.cjs');

const fakeApp = {
  getAppMetrics: () => [
    { type: 'Browser', pid: 1, cpu: { percentCPUUsage: 12.34 }, memory: { workingSetSize: 400 * 1024 } },
    { type: 'Renderer', pid: 2, cpu: { percentCPUUsage: 5.5 }, memory: { workingSetSize: 150 * 1024 } },
    { type: 'GPU', pid: 3, cpu: { percentCPUUsage: 0 }, memory: { workingSetSize: 50 * 1024 } },
  ],
  getGPUFeatureStatus: () => ({ gpu_rasterization: 'enabled', video_decode: 'hardware' }),
};
const fakeProc = { getSystemMemoryInfo: () => ({ total: 8 * 1024 * 1024, free: 3 * 1024 * 1024 }) };
const fakeOs = { cpus: () => new Array(4), loadavg: () => [1.25, 1.1, 0.9] };

const m = collectMetrics({ app: fakeApp, process: fakeProc, os: fakeOs, gpuName: 'llvmpipe' });
assert.equal(m.app.cpuPercent, 17.8, 'app CPU is the sum of its processes');
assert.equal(m.app.rssMB, 600, 'app RSS is the sum of its processes');
assert.equal(m.app.processes[0].type, 'Browser', 'processes sorted by RSS desc');
assert.equal(m.system.cores, 4);
assert.equal(m.system.load1, 1.25);
assert.equal(m.system.totalMB, 8192);
assert.equal(m.system.freeMB, 3072);
assert.equal(m.gpu.name, 'llvmpipe');
assert.equal(m.gpu.raster, 'enabled');
assert.equal(m.gpu.videoDecode, 'hardware');
assert.equal(m.gpu.vramMB, null, 'VRAM is never invented');

(async () => {
  let rss = 100 * 1024;
  const samplerApp = { getAppMetrics: () => [{ type: 'Browser', memory: { workingSetSize: rss } }] };
  const s = startPeakSampler(samplerApp);
  await new Promise((r) => setTimeout(r, 600));
  rss = 250 * 1024; // peak mid-run
  await new Promise((r) => setTimeout(r, 600));
  rss = 120 * 1024; // drops again before the end
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(s.stop(), 250, 'peak is the highest sample, not the last');
  console.log('RESOURCE MONITOR OK');
})();
