// Helper for scripts/test-export-crash-recovery.cjs: runs one export in a
// child process the parent SIGKILLs mid-flight. Usage:
//   node scripts/helpers/export-crash-child.cjs <projectJson> <outFile>
// Prints READY once the export has started, then exits 0 when it finishes
// (the parent kills it first — that is the point).
const fs = require('fs');
const { runExport } = require('../../electron/ffmpeg.cjs');

(async () => {
  const [projectFile, outFile] = process.argv.slice(2);
  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
  console.log('READY');
  const job = runExport(project, outFile, null);
  await job.promise;
  console.log('EXPORTED');
  process.exit(0);
})().catch((e) => { console.error('CHILD FAIL', e.message); process.exit(1); });
