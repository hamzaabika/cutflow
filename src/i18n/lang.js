// Pure language helpers for the interface localisation (no React, no DOM) —
// kept separate so scripts/test-i18n.mjs can exercise them in plain Node.
//
// The interface ships in three languages: English (source), French and
// Arabic (Modern Standard). The user picks one in Settings › Language; the
// choice persists in the app settings (electron/settings.cjs `language`).
// On first start — no saved choice — the OS language decides: the main
// process exposes it via the app:locale channel (Electron app.getLocale()),
// and the renderer falls back to navigator.language when that is missing.

export const LANGS = ['en', 'fr', 'ar'];
export const RTL_LANGS = ['ar'];

export const isLang = (l) => LANGS.includes(l);
export const isRtl = (l) => RTL_LANGS.includes(l);

// 'fr-FR' / 'ar_EG' / 'en-US' → 'fr' / 'ar' / 'en'. Anything that is not
// French or Arabic resolves to English, the source language.
export function mapLocale(locale) {
  const base = String(locale || '').trim().toLowerCase().split(/[-_]/)[0];
  if (base === 'fr') return 'fr';
  if (base === 'ar') return 'ar';
  return 'en';
}

// Which language the interface starts in. A saved choice always wins; then
// the OS locale (from the main process); then the renderer's own locale.
export function chooseLanguage(saved, osLocale, navLocale) {
  if (isLang(saved)) return saved;
  if (osLocale) return mapLocale(osLocale);
  return mapLocale(navLocale);
}

// {name} placeholders, filled from params. Unknown placeholders stay as-is
// so a missing param is visible in the UI instead of crashing the render.
export function formatMessage(template, params) {
  if (!params) return String(template);
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
}

// Look a key up in a catalog set { en, fr, ar }: active language first, then
// English (the source), then the key itself — a missing translation degrades
// to readable English, never to a blank or a crash.
export function lookup(catalogs, lang, key, params) {
  const active = catalogs[lang] || {};
  const raw = active[key] != null ? active[key] : (catalogs.en ? catalogs.en[key] : undefined);
  return formatMessage(raw != null ? raw : key, params);
}
