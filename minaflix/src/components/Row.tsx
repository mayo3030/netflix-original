import { useRef } from 'react';
import { useLanguage } from '../i18n/LanguageProvider';
import { displayText } from '../text';
import type { CatalogRow, Title } from '../types';
import { ChevronIcon } from './Icons';
import { TitleCard } from './TitleCard';

export function Row({ row, onOpen }: { row: CatalogRow; onOpen: (title: Title) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { language, t } = useLanguage();
  const label = displayText(row.title, row.titleAr, language);

  function scroll(direction: -1 | 1) {
    const element = scroller.current;
    if (!element) return;
    const rtl = getComputedStyle(element).direction === 'rtl';
    const amount = Math.round(element.clientWidth * 0.82) * direction * (rtl ? -1 : 1);
    element.scrollBy({ left: amount, behavior: 'smooth' });
  }

  return (
    <section className="row" aria-labelledby={`row-${row.id}`}>
      <div className="row-head">
        <h2 id={`row-${row.id}`}>{label}</h2>
        <div className="row-controls">
          <button type="button" className="icon-btn" aria-label={t('scrollBack')} onClick={() => scroll(-1)}>
            <ChevronIcon direction="back" />
          </button>
          <button type="button" className="icon-btn" aria-label={t('scrollForward')} onClick={() => scroll(1)}>
            <ChevronIcon direction="forward" />
          </button>
        </div>
      </div>
      <div className="row-track" ref={scroller} tabIndex={0}>
        {row.titles.map((title) => (
          <TitleCard key={title.id} title={title} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}
