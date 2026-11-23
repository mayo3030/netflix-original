import { useState, type FormEvent } from 'react';
import { useLanguage } from '../i18n/LanguageProvider';

export function FolderForm({ id, onCreate }: { id: string; onCreate: (name: string) => void }) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draft.trim();
    if (!name) {
      setError(true);
      return;
    }
    onCreate(name);
    setDraft('');
    setError(false);
  }

  return (
    <form className="folder-form" onSubmit={submit}>
      <label htmlFor={id}>{t('newFolder')}</label>
      <div className="folder-form-row">
        <input
          id={id}
          value={draft}
          maxLength={40}
          placeholder={t('folderPlaceholder')}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(false);
          }}
        />
        <button type="submit" className="btn btn-primary">{t('create')}</button>
      </div>
      {error ? <p className="form-error" role="alert">{t('folderNameRequired')}</p> : null}
    </form>
  );
}
