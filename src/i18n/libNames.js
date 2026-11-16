// Display names for the built-in content libraries (effects, transitions,
// filters, LUTs, text templates, stickers, audio presets, animations…).
//
// Library items carry stable English ids + English data names — those are
// what saved projects store, so they never change. What the user SEES is
// resolved here at render time from the interface catalogs under
// `lib.<namespace>.<id>`, falling back to the English data name when a
// translation is missing. Pure JS (no React) so data modules like
// src/fx/filters.js can use it too; the active language is mirrored from
// the React layer (index.jsx applyDocumentLang → setLibLang).
import en from './en.js';
import fr from './fr.js';
import ar from './ar.js';
import { lookup } from './lang.js';

const CATALOGS = { en, fr, ar };
let lang = 'en';

export function setLibLang(l) { if (CATALOGS[l]) lang = l; }
export function getLibLang() { return lang; }

// Translated display name for one library item. `fallback` is the item's
// English data name, shown when the active catalog has no entry.
export function libName(ns, id, fallback) {
  if (id == null || id === '') return fallback ?? '';
  const key = `lib.${ns}.${id}`;
  const v = lookup(CATALOGS, lang, key);
  return v === key ? (fallback ?? String(id)) : v;
}

// Catalog lookup for pure modules that cannot use tr() from index.jsx.
export function libTr(key, params) { return lookup(CATALOGS, lang, key, params); }

// "Best for" phrases in the transition catalog are keyed by a slug of the
// English phrase (the data itself is a free-text phrase, not an id).
export function slugifyPhrase(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export function bestForName(phrase) {
  return libName('bestfor', slugifyPhrase(phrase), phrase);
}
