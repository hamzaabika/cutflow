// FX-06 — HDR export: a project with an HDR (BT.2020 PQ) source and an SDR
// source exports as real 10-bit BT.2020 H.265 when HDR is on (PQ or HLG),
// and exactly as before (BT.709 SDR, tonemapped) when it is off.
// Pins: effectiveExport coercion (HDR only MP4/MOV, forces H.265),
// buildExportArgs graph (zscale to BT.2020, no tonemap, 10-bit pix_fmt and
// BT.2020 tags, libx265), resolveExport coercion, and a LIVE encode probed
// with ffprobe plus a pixel check against the HDR source.
// Honest scope: the preview stays SDR, and clips through the layered path
// (transform/mask/chroma/blend) pass the 8-bit RGBA stage — the file is
// still valid HDR, just with 8-bit precision on those clips.
// Usage: TMPDIR=<disk dir> node scripts/test-hdr-export.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolveExport, settingsPatch, storedExportSettings } from '../src/exportQuality.js';

const require = createRequire(import.meta.url);
const { ffmpegPath, ffprobePath, probe, runExport, buildExportArgs, effectiveExport } = require('../electron/ffmpeg.cjs');

const W = 320;
const H = 180;
const FPS = 30;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-hdr-'));
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
const probeStream = async (file) => {
  const info = await probe(file);
  return info;
};
const flatArgs = (built) => built.args.join(' ');

// ---- Fixtures: a genuine HDR source (a tagged BT.709 file upconverted to
// BT.2020 PQ, 10-bit H.265 — the same shape a real HDR phone clip has) and a
// plain SDR source. ----
const srcSdr = path.join(dir, 'src-sdr.mp4');
gen(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest',
  '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'aac', srcSdr]);
const srcHdr = path.join(dir, 'src-hdr.mp4');
gen(['-i', srcSdr, '-vf', 'zscale=p=bt2020:t=smpte2084:m=bt2020nc:r=tv,format=yuv420p10le', '-c:v', 'libx265', '-preset', 'veryfast', '-crf', '20',
  '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', '-color_range', 'tv', '-c:a', 'aac', srcHdr]);

const mHdr = { id: 'mHdr', path: srcHdr, name: 'src-hdr.mp4', ...(await probeStream(srcHdr)) };
const mSdr = { id: 'mSdr', path: srcSdr, name: 'src-sdr.mp4', ...(await probeStream(srcSdr)) };
assert.equal(mHdr.hdr, true, `the HDR fixture probes as HDR (transfer ${mHdr.colorTransfer})`);
assert.equal(mHdr.colorPrimaries, 'bt2020', 'the HDR fixture is BT.2020');
assert.notEqual(mSdr.hdr, true, 'the SDR fixture does not probe as HDR');

// ---- 1) effectiveExport coercion ----
assert.deepEqual(
  [effectiveExport({ export: { hdr: 'pq', format: 'mp4', codecFamily: 'h264' } }).hdr, effectiveExport({ export: { hdr: 'pq', format: 'mp4', codecFamily: 'h264' } }).codecFamily],
  ['pq', 'h265'], 'HDR PQ in MP4 keeps pq and forces H.265');
assert.equal(effectiveExport({ export: { hdr: 'hlg', format: 'mov' } }).hdr, 'hlg', 'HDR HLG in MOV keeps hlg');
assert.equal(effectiveExport({ export: { hdr: 'pq', format: 'webm' } }).hdr, 'off', 'HDR is forced off for WebM');
assert.equal(effectiveExport({ export: { hdr: 'pq', format: 'gif' } }).hdr, 'off', 'HDR is forced off for GIF');
assert.equal(effectiveExport({ export: {} }).hdr, 'off', 'HDR defaults off');
assert.equal(effectiveExport({}).hdr, 'off', 'HDR defaults off with no export block');

// ---- 2) resolveExport coercion (renderer mirror) ----
const hdrProject = { width: W, height: H, fps: FPS, exportSettings: { preset: 'custom', custom: { codec: 'h264' }, format: 'mp4', hdr: 'pq' } };
const effHdr = resolveExport(hdrProject, { libx265: true });
assert.equal(effHdr.hdr, 'pq', 'resolveExport keeps HDR PQ for MP4');
assert.equal(effHdr.codecFamily, 'h265', 'resolveExport forces H.265 for HDR');
assert.equal(resolveExport({ ...hdrProject, exportSettings: { ...hdrProject.exportSettings, format: 'webm' } }, { libx265: true }).hdr, 'off', 'resolveExport forces HDR off for WebM');
assert.equal(resolveExport(hdrProject, { libx265: false }).hdr, 'off', 'resolveExport forces HDR off without libx265');
assert.equal(storedExportSettings(hdrProject).hdr, 'pq', 'the HDR choice is stored');
assert.equal(settingsPatch(hdrProject, { hdr: 'hlg' }).exportSettings.hdr, 'hlg', 'the HDR choice patches through settingsPatch');

// ---- 3) buildExportArgs graph (no encode) ----
const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
const mkProject = (exp, clips) => ({
  name: 'hdr', ratio: '16:9', width: W, height: H, fps: FPS, background: '#000000', export: exp,
  media: [mHdr, mSdr],
  videoClips: clips, overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
});
const clips = [
  { ...base, id: 'c1', mediaId: 'mHdr', in: 0, out: 2 },
  { ...base, id: 'c2', mediaId: 'mSdr', in: 0, out: 2 },
  { ...base, id: 'c3', mediaId: 'mHdr', in: 0, out: 2, opacity: 0.8 }, // layered path (opacity < 1)
];
const hdrArgs = flatArgs(buildExportArgs(mkProject({ hdr: 'pq', format: 'mp4' }, clips), path.join(dir, 'x.mp4')));
assert.ok(hdrArgs.includes('zscale=p=bt2020:t=smpte2084'), 'HDR graph converts to BT.2020 PQ');
assert.ok(!hdrArgs.includes('tonemap=hable'), 'HDR graph never tonemaps to SDR');
assert.ok(hdrArgs.includes('yuv420p10le'), 'HDR graph runs in 10-bit');
assert.ok(!hdrArgs.includes('-pix_fmt yuv420p '), 'HDR graph does not end in 8-bit');
assert.ok(hdrArgs.includes('-pix_fmt yuv420p10le'), 'HDR encode requests yuv420p10le');
assert.ok(hdrArgs.includes('-color_primaries bt2020') && hdrArgs.includes('-color_trc smpte2084') && hdrArgs.includes('-colorspace bt2020nc'), 'HDR export is tagged BT.2020/PQ');
assert.ok(hdrArgs.includes('-c:v libx265'), 'HDR export encodes libx265');
assert.ok(hdrArgs.includes('out_color_matrix=bt2020'), 'the layered composite re-encodes with the BT.2020 matrix in HDR mode');
// An untagged source in an HDR export: zscale gets the input pinned to the
// pipeline's BT.709 assumption instead of failing with "no path".
const untagged = { id: 'mUntagged', path: srcSdr, name: 'src-sdr.mp4', type: 'video', hasAudio: false };
const untaggedArgs = flatArgs(buildExportArgs({
  ...mkProject({ hdr: 'pq', format: 'mp4' }, clips), media: [untagged],
  videoClips: [{ ...base, id: 'c1', mediaId: 'mUntagged', in: 0, out: 2 }],
}, path.join(dir, 'x.mp4')));
assert.ok(untaggedArgs.includes('zscale=pin=bt709:tin=bt709:min=bt709:rin=tv:p=bt2020'), 'untagged sources get a pinned BT.709 input in HDR mode');
const hlgArgs = flatArgs(buildExportArgs(mkProject({ hdr: 'hlg', format: 'mp4' }, clips), path.join(dir, 'x.mp4')));
assert.ok(hlgArgs.includes('zscale=p=bt2020:t=arib-std-b67') && hlgArgs.includes('-color_trc arib-std-b67'), 'HLG mode uses the HLG transfer');
const sdrArgs = flatArgs(buildExportArgs(mkProject({}, clips), path.join(dir, 'x.mp4')));
assert.ok(sdrArgs.includes('tonemap=hable'), 'SDR export still tonemaps the HDR source');
assert.ok(sdrArgs.includes('-color_primaries bt709') && sdrArgs.includes('-pix_fmt yuv420p'), 'SDR export is unchanged (BT.709, 8-bit)');
assert.ok(!sdrArgs.includes('bt2020'), 'SDR export mentions no BT.2020');

// ---- 4) Live exports, probed ----
const exportOne = async (exp, tag, clipList = clips.slice(0, 2)) => {
  const project = mkProject(exp, clipList);
  const out = path.join(dir, `out-${tag}.mp4`);
  await runExport(project, out, null).promise;
  assert.ok(fs.existsSync(out) && fs.statSync(out).size > 1000, `${tag}: export file exists (${out})`);
  return { out, info: await probeStream(out) };
};
const pq = await exportOne({ hdr: 'pq', format: 'mp4' }, 'pq');
assert.equal(pq.info.colorPrimaries, 'bt2020', `PQ export is tagged BT.2020 (got ${pq.info.colorPrimaries})`);
assert.equal(pq.info.colorTransfer, 'smpte2084', `PQ export is tagged PQ (got ${pq.info.colorTransfer})`);
assert.equal(pq.info.colorSpace, 'bt2020nc', `PQ export is tagged bt2020nc (got ${pq.info.colorSpace})`);
assert.equal(pq.info.pixFmt, 'yuv420p10le', `PQ export is 10-bit (got ${pq.info.pixFmt})`);
const hlg = await exportOne({ hdr: 'hlg', format: 'mp4' }, 'hlg');
assert.equal(hlg.info.colorTransfer, 'arib-std-b67', `HLG export is tagged HLG (got ${hlg.info.colorTransfer})`);
assert.equal(hlg.info.pixFmt, 'yuv420p10le', 'HLG export is 10-bit');
const sdr = await exportOne({}, 'sdr');
assert.equal(sdr.info.colorPrimaries, 'bt709', `SDR export stays BT.709 (got ${sdr.info.colorPrimaries})`);
assert.equal(sdr.info.pixFmt, 'yuv420p', 'SDR export stays 8-bit');
const layered = await exportOne({ hdr: 'pq', format: 'mp4' }, 'pq-layered', clips);
assert.equal(layered.info.colorTransfer, 'smpte2084', 'the layered-path HDR export still tags PQ');
assert.equal(layered.info.pixFmt, 'yuv420p10le', 'the layered-path HDR export is still 10-bit');

// Pixel check: the PQ export's frame against the HDR source's frame, both
// decoded as 10-bit BT.2020 PQ — the conversion must preserve values, not
// just tags (x265 CRF re-encode, so a small tolerance).
const frameYuv10 = (file, t) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file,
  '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'yuv420p10le', 'pipe:1'], { maxBuffer: 1 << 26 });
const meanDiff = (a, b) => {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s / n;
};
const dPq = meanDiff(frameYuv10(pq.out, 0.7), frameYuv10(srcHdr, 0.7));
console.log(`PQ export vs HDR source (10-bit YUV): mean abs diff ${dPq.toFixed(2)}`);
assert.ok(dPq <= 12, 'PQ export pixels match the HDR source within 12 (10-bit units)');

// ---- 5) UI wiring (source checks) ----
const dlg = fs.readFileSync(new URL('../src/components/ExportDialog.jsx', import.meta.url), 'utf8');
assert.ok(dlg.includes("t('exp.hdr')") && dlg.includes("setFormatField({ hdr: v })"), 'the export dialog offers the HDR picker');
for (const lang of ['en', 'fr', 'ar']) {
  const dict = fs.readFileSync(new URL(`../src/i18n/${lang}.js`, import.meta.url), 'utf8');
  for (const k of ['"exp.hdr"', '"exp.hdrOff"', '"exp.hdrNote"', '"exp.note.hdrFormat"', '"exp.note.hdrH265"', '"exp.note.hdrOn"']) {
    assert.ok(dict.includes(k), `${lang}: ${k}`);
  }
}

console.log('hdr-export: all checks passed');
