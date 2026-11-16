// Media-cache bounds (P1-26): LRU eviction + clear, mirroring the fx-segment
// cache policy. Usage: node scripts/test-media-cache.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MEDIA_CACHE_CAP_DEFAULT_MB, capBytes, mediaCacheStats, evictMediaCache, clearMediaCache } = require('../electron/mediacache.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutflow-mediacache-'));
try {
  const MB = 1024 * 1024;
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 h ago: evictable
  const write = (name, size, mtime) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, Buffer.alloc(size));
    if (mtime) fs.utimesSync(f, mtime, mtime);
    return f;
  };
  const a = write('aaa-old-proxy.mp4', MB, old);
  const b = write('bbb-old-thumb.jpg', MB, old);
  const c = write('ccc-old-wave.png', MB, old);
  const fresh = write('ddd-fresh-frame.jpg', MB); // written now: never evicted
  const stalePart = write('eee-stale-proxy.part.mp4', MB, old);
  write('fff-fresh-proxy.part.mp4', MB); // fresh .part: a write in flight, kept
  fs.mkdirSync(path.join(dir, 'fx-segments'));
  fs.writeFileSync(path.join(dir, 'fx-segments', 'big.mkv'), Buffer.alloc(10 * MB));

  // Stats count finished files only: no .part files, no fx-segments subdir.
  let st = mediaCacheStats(dir);
  assert.equal(st.files, 4, `stats files ${st.files}`);
  assert.equal(st.bytes, 4 * MB, `stats bytes ${st.bytes}`);

  // Cap 2 MB with 4 MB of old entries: oldest two go, the protected one
  // (b, even though old) and the fresh one stay; the stale .part goes too.
  const deleted = evictMediaCache(dir, 2, [b]);
  assert.deepEqual(deleted.sort(), [a, c, stalePart].sort(), `deleted ${deleted}`);
  assert.ok(!fs.existsSync(a) && !fs.existsSync(c) && !fs.existsSync(stalePart), 'evicted files gone');
  assert.ok(fs.existsSync(b) && fs.existsSync(fresh), 'protected + fresh kept');
  assert.ok(fs.existsSync(path.join(dir, 'fff-fresh-proxy.part.mp4')), 'fresh .part kept');
  assert.ok(fs.existsSync(path.join(dir, 'fx-segments', 'big.mkv')), 'fx-segments untouched');
  st = mediaCacheStats(dir);
  assert.equal(st.bytes, 2 * MB, `after eviction ${st.bytes}`);

  // Under the cap: nothing is evicted.
  assert.deepEqual(evictMediaCache(dir, 4096, []), [], 'under cap evicts nothing');

  // Clear drops everything unprotected (fresh .part kept, protected kept).
  const cleared = clearMediaCache(dir, [b]);
  assert.ok(cleared.includes(fresh), 'clear drops the fresh file');
  assert.ok(!cleared.includes(b), 'clear keeps the protected file');
  assert.ok(fs.existsSync(b), 'protected survives clear');
  assert.ok(fs.existsSync(path.join(dir, 'fff-fresh-proxy.part.mp4')), 'fresh .part survives clear');

  // Cap conversion: settings MB -> bytes; garbage -> default.
  assert.equal(capBytes(4096), 4096 * MB);
  assert.equal(capBytes('nope'), MEDIA_CACHE_CAP_DEFAULT_MB * MB);

  console.log('MEDIA CACHE OK');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
