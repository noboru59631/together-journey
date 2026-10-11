"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { localeStorageKey, resolveInitialLocale, translate, type Locale, type TranslationKey } from "../lib/i18n";

type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey | string, values?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);
const localeChangeEvent = "together:locale-change";

function localeSnapshot(): Locale {
  return typeof window === "undefined" ? "en" : resolveInitialLocale(localStorage.getItem(localeStorageKey), navigator.language);
}

function subscribeLocale(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(localeChangeEvent, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(localeChangeEvent, listener);
  };
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore<Locale>(subscribeLocale, localeSnapshot, (): Locale => "en");

  const setLocale = useCallback((next: Locale) => {
    localStorage.setItem(localeStorageKey, next);
    document.documentElement.lang = next;
    window.dispatchEvent(new Event(localeChangeEvent));
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LanguageContextValue>(() => ({
    locale,
    setLocale,
    t: (key, values) => translate(locale, key, values),
  }), [locale, setLocale]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used within LanguageProvider");
  return value;
}

export function LanguageToggle() {
  const { locale, setLocale, t } = useLanguage();
  return <div className="language-toggle" role="group" aria-label={t("language.selector")}>
    <button type="button" aria-label={t("language.english")} aria-pressed={locale === "en"} onClick={() => setLocale("en")}>EN</button>
    <span aria-hidden="true">/</span>
    <button type="button" aria-label={t("language.japanese")} aria-pressed={locale === "ja"} onClick={() => setLocale("ja")}>日本語</button>
  </div>;
}
