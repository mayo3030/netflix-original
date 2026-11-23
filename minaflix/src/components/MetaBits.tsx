import { useLanguage } from '../i18n/LanguageProvider';
import { formatRating, runtimeLabel, seasonsLabel } from '../text';
import type { Title } from '../types';

export function MetaBits({ title }: { title: Title }) {
  const { language, t } = useLanguage();
  const parts: string[] = [];
  if (title.year) parts.push(title.year);
  if (title.rating) parts.push(formatRating(title.rating));
  if (title.mediaType === 'tv' && title.seasons) parts.push(seasonsLabel(title.seasons, language));
  else if (title.runtime) parts.push(runtimeLabel(title.runtime, language));

  return (
    <p className="hero-meta">
      {parts.map((part, index) => (
        <span className="meta-group" key={`${part}-${index}`}>
          {index > 0 ? <span className="meta-dot" aria-hidden="true">·</span> : null}
          <span className="meta-bit" dir="ltr">{part}</span>
        </span>
      ))}
      {title.rating ? <span className="visually-hidden">{t('rating')} {t('outOfTen')}</span> : null}
    </p>
  );
}
