import { useLanguage } from '../i18n/LanguageProvider';

export function Footer() {
  const { t } = useLanguage();
  return (
    <footer className="site-footer">
      <p>{t('footerBlurb')}</p>
      <p>
        <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">TMDB</a>
        {' · '}
        {t('tmdbAttribution')}
      </p>
      <p>
        <a href="https://www.blender.org/" target="_blank" rel="noreferrer">Blender Foundation</a>
        {' · '}
        {t('ccAttribution')}
      </p>
    </footer>
  );
}
