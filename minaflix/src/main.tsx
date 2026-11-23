import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CatalogProvider } from './context/CatalogProvider';
import { MyListProvider } from './context/MyListProvider';
import { LanguageProvider } from './i18n/LanguageProvider';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
        <CatalogProvider>
          <MyListProvider>
            <App />
          </MyListProvider>
        </CatalogProvider>
      </LanguageProvider>
    </ErrorBoundary>
  </StrictMode>,
);
