// FB-18 (P1-24) — export-error classification, pinned without Electron.
// Every ffmpeg failure signature maps to a stable code; the failing clip is
// identified from the log's file name; the raw log is always kept.
// Usage: node scripts/test-export-errors.cjs
const { humanizeExportError, attachExportError } = require('../electron/exportErrors.cjs');

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

const project = {
  media: [
    { id: 'm1', path: '/home/hamza/videos/beach trip.mp4', name: 'beach trip.mp4' },
    { id: 'm2', path: '/home/hamza/videos/intro.mp4', name: 'intro.mp4' },
  ],
  videoClips: [
    { id: 'c1', mediaId: 'm1', in: 0, out: 4 },
    { id: 'c2', mediaId: 'm2', in: 0, out: 8 },
  ],
  audioClips: [],
};

let h = humanizeExportError({ message: 'FFmpeg failed (code 1):\n', log: 'av_interleaved_write_frame(): No space left on device\nError writing trailer' });
ok(h.code === 'diskFull', `disk full classified (got ${h.code})`);

h = humanizeExportError({ log: "open '/home/hamza/videos/beach trip.mp4': Permission denied" });
ok(h.code === 'permission', `permission classified (got ${h.code})`);

h = humanizeExportError({ log: "/home/hamza/videos/beach trip.mp4: No such file or directory", project });
ok(h.code === 'missingInput' && h.clipName === 'beach trip.mp4' && h.clipId === 'c1', `missing input names the clip (code=${h.code} clip=${h.clipName} id=${h.clipId})`);

h = humanizeExportError({ log: '[libx264] width not divisible by 2 (1919x1080)', project });
ok(h.code === 'badDimensions', `odd dimensions classified (got ${h.code})`);

h = humanizeExportError({ log: 'Unknown encoder \'libx265\'' });
ok(h.code === 'encoderMissing', `unknown encoder classified (got ${h.code})`);

h = humanizeExportError({ log: 'Hardware device setup failed for decoder: Cannot allocate memory' });
ok(h.code === 'outOfMemory', `OOM classified (got ${h.code})`);

h = humanizeExportError({ log: 'Could not find tag for codec none in stream #0:1' });
ok(h.code === 'unsupportedCodec', `unsupported codec classified (got ${h.code})`);

h = humanizeExportError({ log: 'av_interleaved_write_frame(): Broken pipe' });
ok(h.code === 'interrupted', `broken pipe classified (got ${h.code})`);

h = humanizeExportError({ log: 'something nobody has ever seen before', project });
ok(h.code === 'unknown' && h.clipName === null, `unmatched log is unknown with no guessed clip (got ${h.code})`);
ok(h.raw.includes('something nobody'), 'raw log is kept verbatim');

// identifyClip never guesses: a log naming no project file yields null.
h = humanizeExportError({ log: '/tmp/other-file.mp4: No such file or directory', project });
ok(h.code === 'missingInput' && h.clipName === null, 'unmatched file -> missingInput, clip null (not guessed)');

// attachExportError annotates the Error in place and keeps its message.
const err = new Error('FFmpeg failed (code 1):\nNo space left on device');
attachExportError(err, { log: 'No space left on device', project });
ok(err.exportCode === 'diskFull' && err.exportRaw.includes('No space left'), 'attach annotates code + raw');
ok(err.message.startsWith('FFmpeg failed'), 'attach keeps the original message');

console.log(failures ? `EXPORT-ERRORS FAIL (${failures})` : 'EXPORT-ERRORS OK');
process.exit(failures ? 1 : 0);
