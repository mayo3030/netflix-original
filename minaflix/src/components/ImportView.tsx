import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../i18n/LanguageProvider';
import { useMyList } from '../context/MyListProvider';
import { TMDB_LOOKUP_LIMIT, matchNetflixEntries } from '../import/match';
import { NetflixImportError, parseNetflixImport } from '../import/netflix';
import type { Title } from '../types';

const MY_LIST_FOLDER = {
  id: 'netflix-my-list',
  name: 'Netflix – My List',
  nameAr: 'نتفليكس – قائمتي',
  custom: false,
  itemIds: [] as string[],
};

const WATCHED_FOLDER = {
  id: 'netflix-watched',
  name: 'Netflix – Watched',
  nameAr: 'نتفليكس – شاهدته',
  custom: false,
  itemIds: [] as string[],
};

export function ImportView({ onDone }: { onDone: () => void }) {
  const { t, language } = useLanguage();
  const { replaceFolder } = useMyList();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function onImport() {
    if (!file) return;
    setStatus('working');
    setMessage('');
    setProgress(t('importWorking'));
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const text = await file.text();
      const lists = parseNetflixImport(text, file.name);
      const listEntries = lists.myList;
      const activityEntries = lists.viewingActivity;
      if ((listEntries?.length ?? 0) === 0 && (activityEntries?.length ?? 0) === 0) {
        setStatus('error');
        setMessage(t('importEmpty'));
        return;
      }
      const budget = { left: TMDB_LOOKUP_LIMIT };
      const total = (listEntries?.length ?? 0) + (activityEntries?.length ?? 0);
      const report = (done: number) => {
        setProgress(`${t('importProgress')} ${done}/${total}`);
      };
      const myList = listEntries
        ? await matchNetflixEntries(listEntries, 'list', language, budget, controller.signal, (done) => report(done))
        : [];
      const watched = activityEntries
        ? await matchNetflixEntries(
          activityEntries,
          'watched',
          language,
          budget,
          controller.signal,
          (done) => report((listEntries?.length ?? 0) + done),
        )
        : [];
      if (listEntries) replaceFolder(MY_LIST_FOLDER, myList.map((item) => item.title));
      if (activityEntries) replaceFolder(WATCHED_FOLDER, watched.map((item) => item.title));
      const counts = countKinds([...myList, ...watched]);
      const matched = counts.tmdb + counts.demo;
      const summary = language === 'ar'
        ? `${t('importDone')} طابق ${matched}، وبقي ${counts.name} بالاسم.`
        : `${t('importDone')} ${matched} matched, ${counts.name} kept by name.`;
      setStatus('done');
      setProgress('');
      setMessage(summary);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setStatus('error');
      setProgress('');
      setMessage(error instanceof NetflixImportError ? error.message : t('importError'));
    }
  }

  return (
    <section className="page-view import-view">
      <h1>{t('import')}</h1>
      <p className="lede">{t('importLead')}</p>
      <p>{t('importBody')}</p>
      <p className="fine-print">{t('importTos')}</p>
      <form
        className="import-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onImport();
        }}
      >
        <label htmlFor="netflix-import">{t('importChoose')}</label>
        <input
          id="netflix-import"
          type="file"
          accept=".json,.csv,application/json,text/csv"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setStatus('idle');
            setMessage('');
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={!file || status === 'working'}>
          {status === 'working' ? t('importWorking') : t('importButton')}
        </button>
      </form>
      {progress ? <p role="status">{progress}</p> : null}
      {message ? <p role={status === 'error' ? 'alert' : 'status'}>{message}</p> : null}
      {status === 'done' ? (
        <button type="button" className="btn btn-ghost" onClick={onDone}>{t('myList')}</button>
      ) : null}
    </section>
  );
}

function countKinds(items: { kind: 'tmdb' | 'demo' | 'name'; title: Title }[]): { tmdb: number; demo: number; name: number } {
  return items.reduce((counts, item) => {
    counts[item.kind] += 1;
    return counts;
  }, { tmdb: 0, demo: 0, name: 0 });
}
