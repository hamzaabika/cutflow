import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import en from './en.js';
import fr from './fr.js';
import ar from './ar.js';
import { LANGS, isLang, isRtl, chooseLanguage, lookup } from './lang.js';
import { setLibLang } from './libNames.js';

// Interface localisation: English / French / Arabic (Modern Standard),
// chosen in Settings › Language and persisted in the app settings. First
// start follows the OS language. Arabic renders the whole interface
// right-to-left — except the timeline and the player, whose roots carry
// dir="ltr" so time always runs left-to-right (see Timeline.jsx/Preview.jsx).
//
// Components read strings with useT() (re-renders on a language switch);
// module-level code (menus built at event time, toasts, agent tools) uses
// the plain tr() below, which reads the same live language.

export const CATALOGS = { en, fr, ar };
export { LANGS };

const state = { lang: 'en' };

export function getLanguage() { return state.lang; }
export function tr(key, params) { return lookup(CATALOGS, state.lang, key, params); }

function applyDocumentLang(lang) {
  state.lang = lang;
  setLibLang(lang);
  const el = document.documentElement;
  el.lang = lang;
  el.dir = isRtl(lang) ? 'rtl' : 'ltr';
  el.classList.toggle('lang-ar', lang === 'ar');
}

const LangContext = createContext({ lang: 'en', setLang: () => {}, t: tr });

export function LangProvider({ children }) {
  // First paint uses the renderer's own locale; the effect below resolves
  // the saved choice + OS locale (main process) and corrects it once.
  const [lang, setLangState] = useState(() => chooseLanguage(null, null, typeof navigator !== 'undefined' ? navigator.language : 'en'));
  const booted = useRef(false);

  useEffect(() => { applyDocumentLang(lang); }, [lang]);

  useEffect(() => {
    let dead = false;
    (async () => {
      let saved = null;
      let os = null;
      try { saved = (await window.api?.settingsGet?.())?.language ?? null; } catch { /* defaults below */ }
      try { os = await window.api?.appLocale?.(); } catch { /* navigator fallback */ }
      if (dead) return;
      booted.current = true;
      setLangState(chooseLanguage(saved, os, typeof navigator !== 'undefined' ? navigator.language : 'en'));
    })();
    return () => { dead = true; };
  }, []);

  const setLang = useCallback((next) => {
    if (!isLang(next)) return;
    applyDocumentLang(next);
    setLangState(next);
    // Persist through the normal settings channel; the returned public
    // settings are not needed here (the dialog keeps its own copy).
    try { window.api?.settingsSetLanguage?.(next); } catch { /* in-memory choice still applies */ }
  }, []);

  // Keep the module-level tr() mirror in sync DURING render: tr() is read by
  // helpers that run inside other components' renders (e.g. HomeScreen's
  // greeting), and an effect-only sync would leave them one render behind
  // the hook-based strings after every switch.
  if (state.lang !== lang) state.lang = lang;

  const t = useCallback((key, params) => lookup(CATALOGS, lang, key, params), [lang]);
  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export function useLang() { return useContext(LangContext); }
export function useT() { return useContext(LangContext).t; }
