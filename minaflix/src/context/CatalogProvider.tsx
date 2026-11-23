import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchTmdbDetails, loadTmdbHome, searchTmdb, TmdbError, tmdbConfigured } from '../api/tmdb';
import { createMockCatalog, getMockTitle, searchMock } from '../data/mock';
import { useLanguage } from '../i18n/LanguageProvider';
import { isAbort } from '../lib/abort';
import type { CatalogRow, Title } from '../types';

type FallbackReason = 'unauthorized' | 'unavailable' | null;

type CatalogState = {
  status: 'loading' | 'ready';
  source: 'mock' | 'tmdb';
  usedFallback: boolean;
  fallbackReason: FallbackReason;
  updating: boolean;
  hero: Title | null;
  rows: CatalogRow[];
};

type CatalogValue = CatalogState & {
  reload: () => void;
  search: (query: string, signal: AbortSignal) => Promise<Title[]>;
  loadDetails: (title: Title, signal: AbortSignal) => Promise<Title>;
};

const CatalogContext = createContext<CatalogValue | null>(null);

function mockSnapshot() {
  const catalog = createMockCatalog();
  return {
    status: 'ready' as const,
    source: 'mock' as const,
    usedFallback: false,
    fallbackReason: null,
    updating: false,
    hero: catalog.hero,
    rows: catalog.rows,
  };
}

export function CatalogProvider({ children }: { children: ReactNode }) {
  const { language } = useLanguage();
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<CatalogState>(mockSnapshot);
  const cache = useRef(new Map<string, Title>());

  useEffect(() => {
    cache.current.clear();
  }, [language]);

  useEffect(() => {
    if (!tmdbConfigured()) {
      setState(mockSnapshot());
      return;
    }
    const controller = new AbortController();
    setState((current) => ({
      ...current,
      status: current.hero ? 'ready' : 'loading',
      updating: true,
    }));
    loadTmdbHome(language, controller.signal)
      .then((catalog) => {
        setState({
          status: 'ready',
          source: 'tmdb',
          usedFallback: false,
          fallbackReason: null,
          updating: false,
          hero: catalog.hero,
          rows: catalog.rows,
        });
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return;
        const reason: FallbackReason = error instanceof TmdbError && (error.status === 401 || error.status === 403)
          ? 'unauthorized'
          : 'unavailable';
        const catalog = createMockCatalog();
        setState({
          status: 'ready',
          source: 'mock',
          usedFallback: true,
          fallbackReason: reason,
          updating: false,
          hero: catalog.hero,
          rows: catalog.rows,
        });
      });
    return () => controller.abort();
  }, [language, reloadToken]);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  const search = useCallback(async (query: string, signal: AbortSignal) => {
    const trimmed = query.trim();
    if (!trimmed) return [];
    if (!tmdbConfigured() || state.source === 'mock') return searchMock(trimmed);
    return searchTmdb(trimmed, language, signal);
  }, [language, state.source]);

  const loadDetails = useCallback(async (title: Title, signal: AbortSignal) => {
    const key = `${language}:${title.id}`;
    const cached = cache.current.get(key);
    if (cached) return cached;
    const mock = getMockTitle(title.id);
    const full = mock ?? await fetchTmdbDetails(title, language, signal);
    cache.current.set(key, full);
    return full;
  }, [language]);

  const value = useMemo<CatalogValue>(() => ({
    ...state,
    reload,
    search,
    loadDetails,
  }), [state, reload, search, loadDetails]);

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogValue {
  const value = useContext(CatalogContext);
  if (!value) throw new Error('useCatalog must be used within CatalogProvider');
  return value;
}
