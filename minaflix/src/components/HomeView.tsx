import { useCatalog } from '../context/CatalogProvider';
import { useLanguage } from '../i18n/LanguageProvider';
import type { Title } from '../types';
import { Hero } from './Hero';
import { Row } from './Row';

export function HomeView({ onOpen }: { onOpen: (title: Title, options?: { trailer?: boolean }) => void }) {
  const { hero, rows, status, updating, usedFallback, fallbackReason, reload } = useCatalog();
  const { t } = useLanguage();

  if (!hero || (status === 'loading' && rows.length === 0)) {
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
      <Hero title={hero} onOpen={onOpen} />
      {rows.map((row) => (
        <Row key={row.id} row={row} onOpen={(title) => onOpen(title)} />
      ))}
    </div>
  );
}
