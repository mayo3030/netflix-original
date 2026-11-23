import { useCatalog } from '../context/CatalogProvider';
import { useLanguage } from '../i18n/LanguageProvider';
import { displayText, genreChips } from '../text';
import type { Title } from '../types';
import { netflixWatchUrl } from '../import/catalog';
import { MetaBits } from './MetaBits';
import { Backdrop } from './Poster';

export function Hero({
  title,
  onOpen,
}: {
  title: Title;
  onOpen: (title: Title, options?: { trailer?: boolean }) => void;
}) {
  const { language, t } = useLanguage();
  const { source } = useCatalog();
  const name = displayText(title.title, title.titleAr, language);
  const overview = displayText(title.overview, title.overviewAr, language);
  const chips = genreChips(title, language);

  return (
    <section className="hero" aria-label={name}>
      <Backdrop title={title} />
      <div className="hero-shade" />
      <div className="hero-copy">
        <p className="kicker">
          {t('heroKicker')}
          <span aria-hidden="true"> · </span>
          {source === 'mock' ? t('demoCatalog') : t('liveData')}
        </p>
        <h1>{name}</h1>
        <MetaBits title={title} />
        {chips.length > 0 ? (
          <ul className="chips">
            {chips.map((chip) => <li key={chip}>{chip}</li>)}
          </ul>
        ) : null}
        <p className="hero-overview">{overview}</p>
        <div className="hero-actions">
          {title.netflixId ? (
            <a className="btn btn-primary" href={netflixWatchUrl(title.netflixId)} target="_blank" rel="noreferrer">{t('play')}</a>
          ) : title.trailerKey ? (
            <button type="button" className="btn btn-primary" onClick={() => onOpen(title, { trailer: true })}>
              {t('playTrailer')}
            </button>
          ) : null}
          <button type="button" className={title.netflixId || title.trailerKey ? 'btn btn-ghost' : 'btn btn-primary'} onClick={() => onOpen(title)}>
            {t('details')}
          </button>
        </div>
      </div>
    </section>
  );
}
