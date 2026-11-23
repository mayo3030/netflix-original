import { useLanguage } from '../i18n/LanguageProvider';
import type { View } from '../types';
import { HomeIcon, ImportIcon, ListIcon, SearchIcon } from './Icons';
import { Logo } from './Logo';

export function Header({
  view,
  solid,
  onNavigate,
}: {
  view: View;
  solid: boolean;
  onNavigate: (view: View) => void;
}) {
  const { language, setLanguage, t } = useLanguage();
  const items: { id: View; label: string; icon: typeof HomeIcon }[] = [
    { id: 'home', label: t('home'), icon: HomeIcon },
    { id: 'search', label: t('search'), icon: SearchIcon },
    { id: 'list', label: t('myList'), icon: ListIcon },
    { id: 'import', label: t('import'), icon: ImportIcon },
  ];

  return (
    <header className={solid ? 'header is-solid' : 'header'}>
      <div className="header-bar">
        <button type="button" className="logo-btn" onClick={() => onNavigate('home')}>
          <Logo />
        </button>
        <nav className="primary-nav" aria-label={t('navLabel')}>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className="nav-btn"
                aria-current={view === item.id ? 'page' : undefined}
                onClick={() => onNavigate(item.id)}
              >
                <Icon />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="lang" role="group" aria-label={t('language')}>
          <button type="button" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
          <button type="button" aria-pressed={language === 'ar'} onClick={() => setLanguage('ar')}>ع</button>
        </div>
      </div>
    </header>
  );
}
