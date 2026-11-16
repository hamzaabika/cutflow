// Interface catalogs, loaded on demand (P2-28): English ships in the main
// chunk (it is the fallback every lookup reads); French and Arabic load as
// separate chunks the first time the language is chosen, so a startup in
// English never parses them. lookup() in lang.js falls back to English for
// any key whose catalog has not landed yet, so the UI renders in English
// until the chunk arrives and then re-renders in the chosen language.
import en from './en.js';

export const CATALOGS = { en };

const loaders = {
  fr: () => import('./fr.js'),
  ar: () => import('./ar.js'),
};
const pending = {};

// Register the catalog for `lang` (no-op for English / already-loaded) and
// resolve when it is usable. A failed load resolves to English — a missing
// translation file must never break the interface.
export function ensureCatalog(lang) {
  if (lang === 'en' || CATALOGS[lang]) return Promise.resolve(CATALOGS[lang] || en);
  const load = loaders[lang];
  if (!load) return Promise.resolve(en);
  if (!pending[lang]) {
    pending[lang] = load()
      .then((m) => { CATALOGS[lang] = m.default; return m.default; })
      .catch(() => { delete pending[lang]; return en; });
  }
  return pending[lang];
}
