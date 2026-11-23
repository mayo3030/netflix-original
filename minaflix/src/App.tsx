import { useCallback, useEffect, useState } from 'react';
import { DetailModal } from './components/DetailModal';
import { ImportView } from './components/ImportView';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { HomeView } from './components/HomeView';
import { MyListView } from './components/MyListView';
import { SearchView } from './components/SearchView';
import { useLanguage } from './i18n/LanguageProvider';
import type { Title, View } from './types';

function readView(): View {
  const raw = window.location.hash.replace(/^#\/?/, '');
  if (raw === 'search' || raw === 'list' || raw === 'import') return raw;
  return 'home';
}

export function App() {
  const { t } = useLanguage();
  const [view, setView] = useState<View>(readView);
  const [scrolled, setScrolled] = useState(false);
  const [modal, setModal] = useState<{ title: Title; trailer: boolean } | null>(null);

  useEffect(() => {
    const sync = () => setView(readView());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const navigate = useCallback((next: View) => {
    const nextHash = next === 'home' ? '#/' : `#${next}`;
    if (window.location.hash !== nextHash) window.location.hash = nextHash;
    else setView(next);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const closeModal = useCallback(() => setModal(null), []);

  useEffect(() => {
    if (modal) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== '/') return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      event.preventDefault();
      navigate('search');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, navigate]);

  return (
    <>
      <a className="skip" href="#content">{t('skip')}</a>
      <Header view={view} solid={scrolled || view !== 'home'} onNavigate={navigate} />
      <main id="content" tabIndex={-1}>
        {view === 'home' ? <HomeView onOpen={(title, options) => setModal({ title, trailer: Boolean(options?.trailer) })} /> : null}
        {view === 'search' ? <SearchView onOpen={(title) => setModal({ title, trailer: false })} /> : null}
        {view === 'list' ? <MyListView onOpen={(title) => setModal({ title, trailer: false })} onBrowse={navigate} /> : null}
        {view === 'import' ? <ImportView onDone={() => navigate('list')} /> : null}
      </main>
      {view === 'home' ? <Footer /> : null}
      {modal ? (
        <DetailModal key={modal.title.id} title={modal.title} startTrailer={modal.trailer} onClose={closeModal} />
      ) : null}
    </>
  );
}
