import { useState } from 'react';
import { useCatalog } from '../context/CatalogProvider';
import { useLanguage } from '../i18n/LanguageProvider';
import { catalogRows, clearStoredCatalog, loadStoredCatalog } from '../import/catalog';
import type { CatalogRow, Title } from '../types';
import { Hero } from './Hero';
import { Row } from './Row';

export function HomeView({ onOpen }: { onOpen: (title: Title, options?: { trailer?: boolean }) => void }) {
  const { hero, rows, status, updating, usedFallback, fallbackReason, reload } = useCatalog();
  const { t } = useLanguage();
  const [imported, setImported] = useState<CatalogRow[] | null>(() => {
    const stored = loadStoredCatalog();
    return stored ? catalogRows(stored).rows : null;
  });
  const [importedHero, setImportedHero] = useState<Title | null>(() => {
    const stored = loadStoredCatalog();
    return stored ? catalogRows(stored).hero : null;
  });
  const shownHero = importedHero ?? hero;
  const shownRows = imported ?? rows;

  if (!shownHero || (!imported && status === 'loading' && shownRows.length === 0)) {
    return (
      <div className="home" aria-busy="true">
        <div className="hero hero-skeleton" />
        <div className="skeleton-row" />
        <p className="visually-hidden">{t('loading')}</p>
      </div>
    );
  }

  return (
    <div className="home" aria-busy={updating}>
      {usedFallback ? (
        <div className="banner" role="status">
          <p>{fallbackReason === 'unauthorized' ? t('fallbackRejected') : t('fallbackUnavailable')}</p>
          <button type="button" className="btn btn-ghost" onClick={reload}>{t('reload')}</button>
        </div>
      ) : null}
      {updating ? <p className="updating">{t('updating')}</p> : null}
      {imported ? (
        <div className="banner" role="status">
          <p>{t('yourCatalog')}</p>
          <button type="button" className="btn btn-ghost" onClick={() => { clearStoredCatalog(); setImported(null); setImportedHero(null); }}>{t('clearCatalog')}</button>
        </div>
      ) : null}
      <Hero title={shownHero} onOpen={onOpen} />
      {shownRows.map((row) => (
        <Row key={row.id} row={row} onOpen={(title) => onOpen(title)} />
      ))}
    </div>
  );
}
