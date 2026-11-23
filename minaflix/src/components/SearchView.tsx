import { useEffect, useState } from 'react';
import { useCatalog } from '../context/CatalogProvider';
import { useLanguage } from '../i18n/LanguageProvider';
import { useDebounced } from '../hooks/useDebounced';
import { isAbort } from '../lib/abort';
import { countLabel } from '../text';
import type { Title } from '../types';
import { TitleCard } from './TitleCard';

const RECENT_KEY = 'minaflix.recent.v1';

function readRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function SearchView({ onOpen }: { onOpen: (title: Title) => void }) {
  const { t, language } = useLanguage();
  const { rows, search } = useCatalog();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Title[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const debounced = useDebounced(query, 280);
  const suggestions = rows.find((row) => row.id === 'trending')?.titles.slice(0, 12) ?? [];

  useEffect(() => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch {
      // Ignore private-mode storage failures.
    }
  }, [recent]);

  useEffect(() => {
    const trimmed = debounced.trim();
    if (trimmed.length < 2) return;
    setRecent((current) => [trimmed, ...current.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())].slice(0, 6));
  }, [debounced]);

  useEffect(() => {
    const trimmed = debounced.trim();
    if (!trimmed) {
      setResults([]);
      setFailed(false);
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    let alive = true;
    setBusy(true);
    search(trimmed, controller.signal)
      .then((items) => {
        if (!alive) return;
        setResults(items);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (!alive || isAbort(error)) return;
        setFailed(true);
        setResults([]);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [debounced, search]);

  const showingSuggestions = query.trim().length === 0;

  return (
    <section className="page-view">
      <h1>{t('search')}</h1>
      <form className="search-form" role="search" onSubmit={(event) => event.preventDefault()}>
        <label className="visually-hidden" htmlFor="catalog-search">{t('search')}</label>
        <input
          id="catalog-search"
          type="search"
          enterKeyHint="search"
          autoFocus
          autoComplete="off"
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </form>
      {recent.length > 0 && showingSuggestions ? (
        <div className="recent">
          <div className="section-head">
            <h2>{t('recentSearches')}</h2>
            <button type="button" className="text-btn" onClick={() => setRecent([])}>{t('clearRecent')}</button>
          </div>
          <div className="chips">
            {recent.map((item) => (
              <button key={item} type="button" className="chip-btn" onClick={() => setQuery(item)}>{item}</button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="section-head">
        <h2>{showingSuggestions ? t('suggestions') : t('results')}</h2>
        <p className="fine-print" aria-live="polite">
          {showingSuggestions ? t('searchPrompt') : busy ? t('loading') : failed ? t('searchFailed') : countLabel(results.length, language)}
        </p>
      </div>
      {!showingSuggestions && !busy && !failed && results.length === 0 ? <p>{t('noResults')}</p> : null}
      <div className="card-grid">
        {(showingSuggestions ? suggestions : results).map((title) => (
          <TitleCard key={title.id} title={title} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}
