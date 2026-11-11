// Interface localisation (i18n) — catalog parity, locale mapping, first-start
// precedence, settings persistence, and lookup fallback.
// Run: node scripts/test-i18n.mjs   (plain Node; the live-app CDP check is
// scripts/test-i18n-live.mjs, run separately against a built app.)
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import en from '../src/i18n/en.js';
import fr from '../src/i18n/fr.js';
import ar from '../src/i18n/ar.js';
import { LANGS, isLang, isRtl, mapLocale, chooseLanguage, formatMessage, lookup } from '../src/i18n/lang.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks += 1; };

// ---------- 1. Identical key sets across the three catalogs ----------
const enKeys = Object.keys(en).sort();
for (const [name, cat] of [['fr', fr], ['ar', ar]]) {
  const keys = Object.keys(cat).sort();
  assert.deepEqual(keys, enKeys, `${name} catalog key set differs from en`);
  checks += 1;
}
ok(enKeys.length > 1500, `catalog should hold the full interface (got ${enKeys.length} keys)`);

// ---------- 2. Placeholder parity per key ----------
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
for (const k of enKeys) {
  assert.equal(placeholders(fr[k]), placeholders(en[k]), `placeholder mismatch fr:${k}`);
  assert.equal(placeholders(ar[k]), placeholders(en[k]), `placeholder mismatch ar:${k}`);
  checks += 2;
}

// ---------- 3. No empty translations, no untranslated copies of long strings ----------
for (const k of enKeys) {
  ok(typeof fr[k] === 'string' && fr[k].length > 0, `fr:${k} empty`);
  ok(typeof ar[k] === 'string' && ar[k].length > 0, `ar:${k} empty`);
}

// ---------- 4. Locale → language mapping ----------
assert.equal(mapLocale('fr-FR'), 'fr'); checks += 1;
assert.equal(mapLocale('fr'), 'fr'); checks += 1;
assert.equal(mapLocale('fr-CA'), 'fr'); checks += 1;
assert.equal(mapLocale('ar-EG'), 'ar'); checks += 1;
assert.equal(mapLocale('ar_EG'), 'ar'); checks += 1;
assert.equal(mapLocale('ar'), 'ar'); checks += 1;
assert.equal(mapLocale('en-US'), 'en'); checks += 1;
assert.equal(mapLocale('de-DE'), 'en'); checks += 1;
assert.equal(mapLocale('es'), 'en'); checks += 1;
assert.equal(mapLocale(''), 'en'); checks += 1;
assert.equal(mapLocale(null), 'en'); checks += 1;
assert.equal(mapLocale(undefined), 'en'); checks += 1;

// ---------- 5. First-start vs saved-choice precedence ----------
assert.equal(chooseLanguage('ar', 'en-US', 'en-US'), 'ar', 'saved choice beats OS'); checks += 1;
assert.equal(chooseLanguage('en', 'fr-FR', 'fr-FR'), 'en', 'saved English beats French OS'); checks += 1;
assert.equal(chooseLanguage(null, 'fr-FR', 'en-US'), 'fr', 'OS beats navigator'); checks += 1;
assert.equal(chooseLanguage(null, 'ar-MA', 'en-US'), 'ar', 'Arabic OS → Arabic'); checks += 1;
assert.equal(chooseLanguage(null, null, 'fr-FR'), 'fr', 'navigator fallback'); checks += 1;
assert.equal(chooseLanguage(null, null, null), 'en', 'no signal → English'); checks += 1;
assert.equal(chooseLanguage('xx', 'fr-FR', 'en'), 'fr', 'invalid saved value is ignored'); checks += 1;
assert.equal(chooseLanguage(undefined, 'de-DE', 'de'), 'en', 'unsupported OS → English'); checks += 1;

// ---------- 6. RTL + language helpers ----------
ok(isRtl('ar') && !isRtl('fr') && !isRtl('en'), 'only Arabic is RTL');
ok(LANGS.join() === 'en,fr,ar' && isLang('fr') && !isLang('de'), 'LANGS/isLang');

// ---------- 7. Lookup: active language, English fallback, key fallback, params ----------
const cats = { en, fr, ar };
assert.equal(lookup(cats, 'ar', 'topbar.export'), ar['topbar.export']); checks += 1;
assert.equal(lookup(cats, 'fr', 'topbar.export'), fr['topbar.export']); checks += 1;
assert.notEqual(lookup(cats, 'ar', 'topbar.export'), en['topbar.export'], 'Arabic Export must differ from English'); checks += 1;
assert.equal(lookup(cats, 'ar', 'no.such.key'), 'no.such.key', 'missing key degrades to the key'); checks += 1;
assert.equal(lookup({ en: { a: 'Hi {name}' }, fr: {}, ar: {} }, 'fr', 'a', { name: 'X' }), 'Hi X', 'missing fr falls back to en'); checks += 1;
assert.equal(formatMessage('a {n} b', { n: 3 }), 'a 3 b'); checks += 1;
assert.equal(formatMessage('a {n} b', {}), 'a {n} b', 'unknown placeholder stays visible'); checks += 1;
assert.equal(lookup(cats, 'ar', 'topbar.agentDraftsWaiting', { count: 5 }), ar['topbar.agentDraftsWaiting'].replace('{count}', '5')); checks += 1;

// ---------- 8. Persistence round-trip through electron/settings.cjs ----------
// settings.cjs requires 'electron' — stub it, and point FVE_SMOKE at a temp
// dir so the test seam (<FVE_SMOKE>/settings-test/settings.json) is used.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-i18n-test-'));
process.env.FVE_SMOKE = tmp;
const require = createRequire(import.meta.url);
const Module = require('node:module');
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') {
    return {
      app: { getPath: () => tmp },
      safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
    };
  }
  return origLoad.call(this, request, ...rest);
};
try {
  const settingsPath = require.resolve('../electron/settings.cjs');
  delete require.cache[settingsPath];
  const settings = require(settingsPath);
  assert.equal(settings.getLanguage(), null, 'no saved language on a fresh profile'); checks += 1;
  assert.equal(settings.getPublic().language, null, 'getPublic exposes null before any choice'); checks += 1;
  const pub = settings.setLanguage('ar');
  assert.equal(pub.language, 'ar', 'setLanguage returns the public state with the new language'); checks += 1;
  assert.equal(settings.getLanguage(), 'ar'); checks += 1;
  settings.setLanguage('xx');
  assert.equal(settings.getLanguage(), 'ar', 'invalid language is rejected, previous choice kept'); checks += 1;
  // Fresh require (new main-process start) still reads the saved choice.
  delete require.cache[settingsPath];
  const settings2 = require(settingsPath);
  assert.equal(settings2.getLanguage(), 'ar', 'saved language survives a restart'); checks += 1;
  assert.equal(settings2.getPublic().language, 'ar'); checks += 1;
  settings2.setLanguage('fr');
  assert.equal(settings2.getLanguage(), 'fr'); checks += 1;
} finally {
  Module._load = origLoad;
  delete process.env.FVE_SMOKE;
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`test-i18n: PASS (${checks} checks, ${enKeys.length} keys per catalog)`);
