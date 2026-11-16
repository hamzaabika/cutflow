// Built-in resource monitor (P2-36): live CPU / RAM / GPU numbers for the
// Resources dialog, plus the peak-RSS sampler the export jobs use for their
// per-job cost. Numbers only — nothing is written, sent or stored.
//
// Honest limits, stated in the UI too:
//   - GPU utilisation and VRAM are NOT exposed by Electron, so they are not
//     shown as numbers: the dialog shows the GPU device + feature status and
//     says VRAM is not reported on this system. No number is invented.
//   - System CPU is the 1-minute load average (os.loadavg), not a percentage
//     sampled per core; the app's own CPU % comes from app.getAppMetrics().
// The collector takes its sources as arguments so the same code runs in plain
// Node tests with fakes (Electron's app object does not exist there).
//
// workingSetSize is in KILOBYTES (Electron docs); getSystemMemoryInfo too.
const KB = 1024;

function collectMetrics({ app, process: proc, os, gpuName = '' }) {
  const list = (app.getAppMetrics?.() || []).map((m) => {
    const cpu = Math.round((m.cpu?.percentCPUUsage || 0) * 10) / 10;
    const rssMB = Math.round(((m.memory?.workingSetSize || 0) / KB) * 10) / 10;
    return { type: m.type, pid: m.pid, cpu, rssMB };
  }).sort((a, b) => b.rssMB - a.rssMB);
  const mem = proc.getSystemMemoryInfo();
  const features = app.getGPUFeatureStatus?.() || {};
  return {
    ts: Date.now(),
    app: {
      cpuPercent: Math.round(list.reduce((s, p) => s + p.cpu, 0) * 10) / 10,
      rssMB: Math.round(list.reduce((s, p) => s + p.rssMB, 0) * 10) / 10,
      processes: list,
    },
    system: {
      cores: os.cpus().length,
      load1: Math.round((os.loadavg?.()[0] || 0) * 100) / 100,
      totalMB: Math.round(mem.total / 1024),
      freeMB: Math.round(mem.free / 1024),
    },
    gpu: {
      name: gpuName || 'Unknown',
      raster: features.gpu_rasterization || features['2d_canvas'] || 'unknown',
      videoDecode: features.video_decode || 'unknown',
      vramMB: null, // Electron does not expose VRAM; the UI says so.
    },
  };
}

// Peak app RSS while a job runs: sample every 500 ms; stop() returns the peak
// in MB. A 500 ms timer is far below frame cost (the export itself is the
// work; the sampler is one getAppMetrics call twice a second).
function startPeakSampler(app) {
  let peak = 0;
  const id = setInterval(() => {
    try {
      const total = (app.getAppMetrics?.() || []).reduce((s, m) => s + (m.memory?.workingSetSize || 0), 0);
      if (total > peak) peak = total;
    } catch { /* a gone process must not break the export */ }
  }, 500);
  return { stop: () => { clearInterval(id); return Math.round((peak / KB) * 10) / 10; } };
}

module.exports = { collectMetrics, startPeakSampler };
