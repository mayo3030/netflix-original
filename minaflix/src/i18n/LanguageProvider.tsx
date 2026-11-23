import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { STRINGS, type StringKey } from './strings';
import type { Language } from '../types';

const STORAGE_KEY = 'minaflix.lang';

type LanguageValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: StringKey) => string;
};

const LanguageContext = createContext<LanguageValue | null>(null);

function readLanguage(): Language {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readLanguage);

  useEffect(() => {
    document.documentElement.lang = language === 'ar' ? 'ar' : 'en';
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.title = language === 'ar' ? 'مينافليكس' : 'MinaFlix';
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Ignore private-mode storage failures.
    }
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
  }, []);

  const t = useCallback((key: StringKey) => STRINGS[language][key], [language]);

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useLanguage must be used within LanguageProvider');
  return value;
}
