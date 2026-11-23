import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageProvider';
import { displayText } from '../text';
import type { Title } from '../types';
import { Art } from './Art';

export function Poster({ title, badge }: { title: Title; badge?: string }) {
  const { language } = useLanguage();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = title.posterUrl;
  const showImage = Boolean(url) && failedUrl !== url;
  const letter = displayText(title.title, title.titleAr, language).trim().charAt(0);
  return (
    <div className="poster-frame">
      {showImage && url ? (
        <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailedUrl(url)} />
      ) : (
        <Art hue={title.hue} pattern={title.pattern} variant="poster" letter={letter} />
      )}
      {badge ? <span className="card-rating" aria-hidden="true">{badge}</span> : null}
    </div>
  );
}

export function Backdrop({ title }: { title: Title }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = title.backdropUrl;
  const showImage = Boolean(url) && failedUrl !== url;
  return (
    <div className="backdrop">
      <Art hue={title.hue} pattern={title.pattern} variant="hero" />
      {showImage && url ? (
        <img src={url} alt="" decoding="async" onError={() => setFailedUrl(url)} />
      ) : null}
    </div>
  );
}
