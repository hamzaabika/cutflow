// FB-20 (P1-35) — the CI failure-report script + the two workflows, pinned.
//   1. scripts/ci-report-failure.sh groups by job + fingerprint, dedups
//      against open `ci-failure` issues, and creates at most one issue per
//      distinct failure. Exercised here with stubbed inputs (CI_JOBS_JSON /
//      CI_OPEN_ISSUES / CI_DRY_RUN) — no network, no `gh`.
//   2. .github/workflows/release.yml: no per-job `gh issue create` outside
//      the report job; a preflight job gates the matrix (fail early);
//      build logs are always archived; a single report job (if: failure())
//      calls the script.
//   3. .github/workflows/pr-ci.yml exists, runs on pull_request, builds +
//      runs the pure-node suites, and never packages, releases, or files
//      issues.
// Usage: node scripts/test-release-ci.cjs
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const YAML = require('js-yaml');

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const ROOT = path.resolve(__dirname, '..');
const runSh = (env, cwd) => execFileSync('bash', [path.join(ROOT, 'scripts', 'ci-report-failure.sh')], { encoding: 'utf8', env: { ...process.env, ...env }, cwd: cwd || ROOT });

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(require('os').tmpdir()), 'fve-cirep-'));
const logs = path.join(tmp, 'ci-logs');
fs.mkdirSync(logs, { recursive: true });
const winLog = path.join(logs, 'build-windows-latest.log');
const linLog = path.join(logs, 'build-ubuntu-latest.log');
fs.writeFileSync(winLog, ['npm ci', 'electron-builder --win nsis', 'Error: certificate expired', 'error: exit code 1'].join('\n') + '\n');
fs.writeFileSync(linLog, ['npm ci', 'electron-builder --linux deb', 'Error: dpkg: dependency problems', 'error: exit code 1'].join('\n') + '\n');
const jobsFile = path.join(tmp, 'jobs.json');
fs.writeFileSync(jobsFile, JSON.stringify({ jobs: [
  { name: 'Build (windows-latest)', conclusion: 'failure' },
  { name: 'Build (ubuntu-latest)', conclusion: 'failure' },
  { name: 'Publish GitHub Release', conclusion: 'success' },
] }));

// 1. Two distinct failures -> two CREATEs, with different fingerprints.
let out = runSh({ CI_JOBS_JSON: jobsFile, CI_OPEN_ISSUES: path.join(tmp, 'none.txt'), CI_DRY_RUN: '1', LOG_DIR: logs, GITHUB_REPOSITORY: 'hamzaabika/cutflow', GITHUB_RUN_ID: '123', GITHUB_REF_NAME: 'release/v2.1.0' });
fs.writeFileSync(path.join(tmp, 'none.txt'), '');
out = runSh({ CI_JOBS_JSON: jobsFile, CI_OPEN_ISSUES: path.join(tmp, 'none.txt'), CI_DRY_RUN: '1', LOG_DIR: logs, GITHUB_REPOSITORY: 'hamzaabika/cutflow', GITHUB_RUN_ID: '123', GITHUB_REF_NAME: 'release/v2.1.0' });
const creates = [...out.matchAll(/^CREATE Release CI failure: (.+?) \[(.+?)\] \((.+?)\)$/gm)];
ok(creates.length === 2, `two distinct failures create two issues (got ${creates.length})`);
ok(creates[0][2] !== creates[1][2], `fingerprints differ per platform (${creates[0][2]} vs ${creates[1][2]})`);
ok(creates.every((c) => c[3] === 'release/v2.1.0'), 'issue title carries the ref');
ok(/Complete logs: the run's build-log artifacts/.test(out), 'issue body points at the archived logs, not a tail dump');
ok(/report done: 2 created, 0 skipped/.test(out), 'summary counts 2 created');

// 2. Same failure again with the fingerprint already open -> SKIP, no CREATE.
const openFile = path.join(tmp, 'open.txt');
fs.writeFileSync(openFile, `Release CI failure: Build (windows-latest) [${creates[0][2]}] (release/v2.1.0)\n`);
out = runSh({ CI_JOBS_JSON: jobsFile, CI_OPEN_ISSUES: openFile, CI_DRY_RUN: '1', LOG_DIR: logs, GITHUB_REPOSITORY: 'hamzaabika/cutflow', GITHUB_RUN_ID: '124', GITHUB_REF_NAME: 'release/v2.1.0' });
ok((out.match(/^CREATE /gm) || []).length === 1, 'already-open fingerprint is skipped, the other still creates');
ok(/SKIP Build \(windows-latest\) fingerprint/.test(out), 'skip is logged with the fingerprint');
ok(/report done: 1 created, 1 skipped/.test(out), 'summary counts 1 created, 1 skipped');

// 3. Determinism: the same job + same log twice -> the same fingerprint.
const fpOf = (logFile) => {
  const tail = fs.readFileSync(logFile, 'utf8').trim().split('\n').slice(-30).filter(Boolean).join('\n');
  return crypto.createHash('sha256').update(`Build (windows-latest)\n${tail}`).digest('hex').slice(0, 12);
};
ok(fpOf(winLog) === creates[0][2], 'fingerprint is sha256(job + last-30-log-lines)[:12]');

// 4. No failures -> nothing created.
fs.writeFileSync(jobsFile, JSON.stringify({ jobs: [{ name: 'Build (ubuntu-latest)', conclusion: 'success' }] }));
out = runSh({ CI_JOBS_JSON: jobsFile, CI_OPEN_ISSUES: openFile, CI_DRY_RUN: '1', LOG_DIR: logs });
ok(!/^CREATE /m.test(out) && /report done: 0 created, 0 skipped/.test(out), 'green run creates nothing');

// ---- Workflow files ----
const rel = YAML.load(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8'));
const relText = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
ok(rel.jobs.preflight !== undefined, 'release.yml has a preflight job');
ok((rel.jobs.build.needs || []).includes('preflight') || rel.jobs.build.needs === 'preflight', 'build needs preflight (fail early)');
const buildSteps = JSON.stringify(rel.jobs.build.steps);
ok(!/gh issue create/.test(buildSteps), 'build job no longer creates issues');
ok(/upload-artifact/.test(buildSteps) && /always\(\)/.test(buildSteps), 'build job always archives its log');
ok(rel.jobs.report !== undefined && /failure\(\)/.test(String(rel.jobs.report.if)), 'report job runs once, on failure');
ok(/ci-report-failure\.sh/.test(JSON.stringify(rel.jobs.report.steps)), 'report job calls the dedup script');
ok(!/gh issue create/.test(JSON.stringify(rel.jobs.release.steps)), 'release job no longer creates issues');
ok(rel.jobs.release.needs.includes('build'), 'release still needs build');

const pr = YAML.load(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pr-ci.yml'), 'utf8'));
const prText = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pr-ci.yml'), 'utf8');
ok(pr.on.pull_request !== undefined, 'pr-ci.yml runs on pull_request');
ok(/npm run build/.test(prText) && /test-i18n\.mjs/.test(prText), 'PR CI builds and runs the pure-node suites');
ok(!/electron-builder/.test(prText) && !/gh-release/.test(prText) && !/gh issue create/.test(prText), 'PR CI never packages, releases, or files issues');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `RELEASE-CI FAIL (${failures})` : 'RELEASE-CI OK');
process.exit(failures ? 1 : 0);
