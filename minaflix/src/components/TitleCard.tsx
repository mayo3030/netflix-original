import { formatRating, displayText } from '../text';
import type { Title } from '../types';
import { useLanguage } from '../i18n/LanguageProvider';
import { useMyList } from '../context/MyListProvider';
import { BookmarkIcon } from './Icons';
import { Poster } from './Poster';

export function TitleCard({
  title,
  onOpen,
  folderId,
}: {
  title: Title;
  onOpen: (title: Title) => void;
  folderId?: string;
}) {
  const { language, t } = useLanguage();
  const { isSaved, toggleSaved, setInFolder } = useMyList();
  const name = displayText(title.title, title.titleAr, language);
  const saved = isSaved(title.id);
  const removing = Boolean(folderId);

  return (
    <article className="card">
      <button type="button" className="card-open" onClick={() => onOpen(title)}>
        <Poster title={title} badge={formatRating(title.rating)} />
        <span className="card-title">{name}</span>
      </button>
      <button
        type="button"
        className={saved ? 'card-save is-on' : 'card-save'}
        aria-pressed={saved}
        aria-label={`${removing ? t('remove') : saved ? t('unsaveTitle') : t('saveTitle')}: ${name}`}
        onClick={() => {
          if (folderId) setInFolder(title, folderId, false);
          else toggleSaved(title);
        }}
      >
        <BookmarkIcon filled={saved || removing} />
      </button>
    </article>
  );
}
