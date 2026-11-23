import type { CSSProperties } from 'react';
import type { Pattern } from '../types';
import { Mark } from './Icons';

export function Art({
  hue,
  pattern,
  variant,
  letter,
}: {
  hue: number;
  pattern: Pattern;
  variant: 'poster' | 'hero';
  letter?: string;
}) {
  return (
    <div className={`art art-${pattern} art-${variant}`} style={{ '--h': hue } as CSSProperties} aria-hidden="true">
      <span className="art-glow" />
      <span className="art-shape" />
      {variant === 'poster' && letter ? <span className="art-letter">{letter}</span> : null}
      <Mark className="art-mark" />
    </div>
  );
}
