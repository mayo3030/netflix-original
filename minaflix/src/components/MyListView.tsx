import { useState } from 'react';
import { useMyList } from '../context/MyListProvider';
import { useLanguage } from '../i18n/LanguageProvider';
import { titleFromSaved } from '../data/mock';
import { folderName } from '../storage/myList';
import { countLabel } from '../text';
import type { Title, View } from '../types';
import { FolderForm } from './FolderForm';
import { TitleCard } from './TitleCard';

export function MyListView({
  onOpen,
  onBrowse,
}: {
  onOpen: (title: Title) => void;
  onBrowse: (view: View) => void;
}) {
  const { language, t } = useLanguage();
  const { folders, items, createFolder, renameFolder, deleteFolder } = useMyList();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState(false);
  const selected = folders.find((folder) => folder.id === folderId) ?? folders[0] ?? null;
  const titles = selected
    ? selected.itemIds.flatMap((id) => {
      const saved = items[id];
      return saved ? [titleFromSaved(saved)] : [];
    })
    : [];

  return (
    <section className="page-view">
      <div className="page-intro">
        <h1>{t('myList')}</h1>
        <p className="fine-print">{t('listLocal')}</p>
        <button type="button" className="text-btn" onClick={() => onBrowse('import')}>{t('import')}</button>
      </div>
      <div className="list-layout">
        <aside className="folder-column">
          <h2>{t('folders')}</h2>
          <FolderForm id="page-new-folder" onCreate={(name) => {
            const id = createFolder(name);
            if (id) setFolderId(id);
          }} />
          {folders.length === 0 ? <p>{t('emptyFolders')}</p> : null}
          <div className="folder-list" role="list">
            {folders.map((folder) => {
              const active = selected?.id === folder.id;
              return (
                <button
                  key={folder.id}
                  type="button"
                  role="listitem"
                  className={active ? 'folder-pill is-on' : 'folder-pill'}
                  aria-pressed={active}
                  onClick={() => {
                    setFolderId(folder.id);
                    setEditing(false);
                    setConfirming(false);
                  }}
                >
                  <span>{folderName(folder, language)}</span>
                  <span className="count">{folder.itemIds.length}</span>
                </button>
              );
            })}
          </div>
        </aside>
        <div className="folder-panel">
          {selected ? (
            <>
              <div className="section-head">
                {editing ? (
                  <form
                    className="rename-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      renameFolder(selected.id, draft);
                      setEditing(false);
                    }}
                  >
                    <label className="visually-hidden" htmlFor="rename-folder">{t('rename')}</label>
                    <input id="rename-folder" value={draft} maxLength={40} onChange={(event) => setDraft(event.target.value)} />
                    <button type="submit" className="btn btn-primary">{t('rename')}</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>{t('cancel')}</button>
                  </form>
                ) : (
                  <>
                    <h2>{folderName(selected, language)}</h2>
                    <p className="fine-print">{countLabel(titles.length, language)}</p>
                  </>
                )}
              </div>
              {!editing ? (
                <div className="folder-actions">
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => {
                      setDraft(folderName(selected, language));
                      setEditing(true);
                      setConfirming(false);
                    }}
                  >
                    {t('rename')}
                  </button>
                  {confirming ? (
                    <>
                      <span className="fine-print">{t('deleteFolderNote')}</span>
                      <button type="button" className="text-btn danger" onClick={() => { deleteFolder(selected.id); setConfirming(false); }}>{t('confirm')}</button>
                      <button type="button" className="text-btn" onClick={() => setConfirming(false)}>{t('cancel')}</button>
                    </>
                  ) : (
                    <button type="button" className="text-btn danger" onClick={() => setConfirming(true)}>{t('delete')}</button>
                  )}
                </div>
              ) : null}
              {titles.length === 0 ? (
                <div className="empty-state">
                  <p>{t('emptyFolder')}</p>
                  <button type="button" className="btn btn-primary" onClick={() => onBrowse('home')}>{t('browseHome')}</button>
                </div>
              ) : (
                <div className="card-grid">
                  {titles.map((title) => (
                    <TitleCard key={title.id} title={title} folderId={selected.id} onOpen={onOpen} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <p>{t('emptyFolders')}</p>
              <button type="button" className="btn btn-primary" onClick={() => onBrowse('home')}>{t('browseHome')}</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
