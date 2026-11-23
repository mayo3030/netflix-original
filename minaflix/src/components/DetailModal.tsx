import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useCatalog } from '../context/CatalogProvider';
import { useMyList } from '../context/MyListProvider';
import { useLanguage } from '../i18n/LanguageProvider';
import { isAbort } from '../lib/abort';
import { folderName } from '../storage/myList';
import { netflixWatchUrl } from '../import/catalog';
import { netflixTitleUrl } from '../import/netflix';
import { displayText, genreChips, initials } from '../text';
import type { Title } from '../types';
import { FolderForm } from './FolderForm';
import { CloseIcon } from './Icons';
import { MetaBits } from './MetaBits';
import { Backdrop } from './Poster';

export function DetailModal({
  title,
  startTrailer,
  onClose,
}: {
  title: Title;
  startTrailer: boolean;
  onClose: () => void;
}) {
  const { language, t } = useLanguage();
  const { loadDetails } = useCatalog();
  const { folders, foldersFor, setInFolder, createFolder, isSaved } = useMyList();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState<Title | null>(null);
  const [playing, setPlaying] = useState(startTrailer);
  const shown = full && full.id === title.id ? full : title;
  const name = displayText(shown.title, shown.titleAr, language);
  const overview = displayText(shown.overview, shown.overviewAr, language);
  const chips = genreChips(shown, language);
  const selected = foldersFor(shown.id);
  const pending = !shown.detailsLoaded && !shown.detailsError;

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    loadDetails(title, controller.signal)
      .then((next) => {
        if (alive) setFull(next);
      })
      .catch((error: unknown) => {
        if (!alive || isAbort(error)) return;
        setFull({ ...title, detailsLoaded: true, detailsError: true });
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [title, loadDetails]);

  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    const dialog: HTMLDivElement = root;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.querySelector<HTMLElement>('.modal-close')?.focus();

    function focusable() {
      return [...dialog.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, iframe')].filter((element) => !element.hasAttribute('disabled'));
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-root">
      <button type="button" className="modal-backdrop" aria-label={t('close')} tabIndex={-1} onClick={onClose} />
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        ref={dialogRef}
      >
        <div className="modal-top">
          <button type="button" className="modal-close icon-btn" onClick={onClose} aria-label={t('closeDetails')}>
            <CloseIcon />
          </button>
        </div>
        <div className="modal-hero">
          <Backdrop title={shown} />
          <div className="modal-hero-copy">
            <p className="kicker">{shown.mediaType === 'tv' ? (language === 'ar' ? 'مسلسل' : 'Series') : (language === 'ar' ? 'فيلم' : 'Film')}</p>
            <h2 id="detail-title">{name}</h2>
            <MetaBits title={shown} />
            {chips.length > 0 ? (
              <ul className="chips">
                {chips.map((chip) => <li key={chip}>{chip}</li>)}
              </ul>
            ) : null}
            {shown.netflixId ? (
              <div className="hero-actions">
                <a className="btn btn-primary" href={netflixWatchUrl(shown.netflixId)} target="_blank" rel="noreferrer">{t('play')}</a>
                <a className="btn btn-ghost" href={netflixTitleUrl(shown.netflixId)} target="_blank" rel="noreferrer">{t('openOnNetflix')}</a>
              </div>
            ) : null}
          </div>
        </div>
        <div className="modal-body modal-grid">
          <div className="modal-copy">
          <section aria-labelledby="detail-overview">
            <h3 id="detail-overview">{t('overview')}</h3>
            <p>{overview || t('noOverview')}</p>
          </section>

          <section className="save-block" aria-labelledby="detail-save">
            <div className="section-head">
              <h3 id="detail-save">{t('saveIn')}</h3>
              <p className="fine-print">{isSaved(shown.id) ? t('inMyList') : t('notSaved')}</p>
            </div>
            <div className="folder-checks">
              {folders.map((folder) => (
                <label key={folder.id} className="folder-check">
                  <input
                    type="checkbox"
                    checked={selected.includes(folder.id)}
                    onChange={(event) => setInFolder(shown, folder.id, event.target.checked)}
                  />
                  <span>{folderName(folder, language)}</span>
                </label>
              ))}
            </div>
            <FolderForm
              id="modal-new-folder"
              onCreate={(folderNameValue) => {
                const id = createFolder(folderNameValue);
                if (id) setInFolder(shown, id, true);
              }}
            />
          </section>

          <section aria-labelledby="detail-cast">
            <h3 id="detail-cast">{t('cast')}</h3>
            {pending ? <p>{t('loadingDetails')}</p> : null}
            {shown.detailsError ? <p role="alert">{t('detailsError')}</p> : null}
            {!pending && !shown.detailsError && shown.cast.length === 0 ? <p>{t('noCast')}</p> : null}
            {shown.cast.length > 0 ? (
              <ul className="cast-row">
                {shown.cast.map((member) => {
                  const person = displayText(member.name, member.nameAr, language);
                  const role = displayText(member.character, member.characterAr, language);
                  return (
                    <li key={member.id} className="cast-card">
                      {member.profileUrl ? (
                        <img src={member.profileUrl} alt="" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="avatar" style={{ '--h': (member.id * 47) % 360 } as CSSProperties}>{initials(person)}</span>
                      )}
                      <span className="cast-name">{person}</span>
                      {role ? <span className="cast-role">{role}</span> : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
          {shown.creators?.length ? (
            <section aria-labelledby="detail-creators">
              <h3 id="detail-creators">{t('creators')}</h3>
              <p>{shown.creators.join(', ')}</p>
            </section>
          ) : null}
          {shown.directors?.length ? (
            <section aria-labelledby="detail-directors">
              <h3 id="detail-directors">{t('directors')}</h3>
              <p>{shown.directors.join(', ')}</p>
            </section>
          ) : null}
          </div>

          <section id="modal-trailer" aria-labelledby="detail-trailer">
            <h3 id="detail-trailer">{t('trailer')}</h3>
            {pending ? <p>{t('loadingDetails')}</p> : null}
            {!pending && shown.trailerKey && playing ? (
              <div className="trailer-frame">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${shown.trailerKey}?rel=0&autoplay=1`}
                  title={`${t('trailer')}: ${name}`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            ) : null}
            {!pending && shown.trailerKey && !playing ? (
              <button type="button" className="trailer-poster" onClick={() => setPlaying(true)}>
                <img src={`https://i.ytimg.com/vi/${shown.trailerKey}/hqdefault.jpg`} alt="" />
                <span className="play-badge">{t('playTrailer')}</span>
              </button>
            ) : null}
            {!pending && !shown.trailerKey ? <div className="trailer-empty"><p>{t('noTrailer')}</p></div> : null}
            {shown.trailerKey ? (
              <p className="fine-print">
                {t('trailerNote')}{' '}
                <a href={`https://www.youtube.com/watch?v=${shown.trailerKey}`} target="_blank" rel="noreferrer">{t('watchOnYouTube')}</a>
              </p>
            ) : null}
            {shown.openCinema && shown.credit ? (
              <p className="fine-print">
                {t('ccChip')}
                {' · '}
                <a href={shown.credit.url} target="_blank" rel="noreferrer">{t('projectPage')}</a>
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
