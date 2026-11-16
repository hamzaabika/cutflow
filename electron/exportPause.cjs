// Export pause (P1-52): SIGSTOP / SIGCONT for the live export ffmpeg children.
//
// One module, no dependencies, required by both ffmpeg.cjs (encode + audio
// export) and loudness.cjs (the normalize re-encode) — loudness.cjs must never
// require ffmpeg.cjs, so the shared state lives here instead.
//
// Semantics: setExportPaused(true) stops every live export child and any child
// spawned while the flag is set (a pause that lands between phases still
// catches the next phase's ffmpeg). setExportPaused(false) resumes them.
// The flag is cleared when the export settles (runExport / runAudioExport
// finally blocks) and by export:cancel — a new export always starts
// unpaused, and a leaked flag can never freeze a later job.
// SIGSTOP/SIGCONT only stop scheduling: file handles stay open, the encode
// resumes exactly where it stopped. The QC analysis pass is intentionally
// NOT tracked (seconds-long, no benefit from stopping it).
const liveExportProcs = new Set();
let exportPaused = false;

function signal(p, sig) {
  try {
    // NOTE: do NOT guard on p.killed — Node sets killed=true for ANY kill(),
    // including SIGSTOP, so a stopped child would never be resumed.
    if (p && p.exitCode === null) p.kill(sig);
  } catch { /* already gone */ }
}

// Register a freshly spawned export ffmpeg child: it joins the live set (out
// on close) and is stopped at once if a pause is already in effect.
function trackExportProc(p) {
  if (!p) return p;
  liveExportProcs.add(p);
  p.on('close', () => liveExportProcs.delete(p));
  if (exportPaused) signal(p, 'SIGSTOP');
  return p;
}

function setExportPaused(paused) {
  exportPaused = !!paused;
  for (const p of liveExportProcs) signal(p, exportPaused ? 'SIGSTOP' : 'SIGCONT');
  return exportPaused;
}

function clearExportPause() {
  if (!exportPaused) return;
  exportPaused = false;
  for (const p of liveExportProcs) signal(p, 'SIGCONT');
}

function isExportPaused() { return exportPaused; }
function liveExportProcCount() { return liveExportProcs.size; }

module.exports = { trackExportProc, setExportPaused, clearExportPause, isExportPaused, liveExportProcCount };
