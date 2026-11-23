import { genreLabel } from './genres';
import type { Language, Title } from './types';

export function displayText(primary: string, alternate: string, language: Language): string {
  if (language === 'ar') return alternate || primary;
  return primary || alternate;
}

export function formatRating(value: number): string {
  if (!value) return '–';
  return value.toFixed(1);
}

export function runtimeLabel(minutes: number, language: Language): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (language === 'ar') {
    if (hours > 0 && mins > 0) return `${hours} س ${mins} د`;
    if (hours > 0) return `${hours} س`;
    return `${mins} د`;
  }
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

export function seasonsLabel(count: number, language: Language): string {
  if (language === 'en') return count === 1 ? '1 season' : `${count} seasons`;
  if (count === 1) return 'موسم واحد';
  if (count === 2) return 'موسمان';
  if (count >= 3 && count <= 10) return `${count} مواسم`;
  return `${count} موسماً`;
}

export function countLabel(count: number, language: Language): string {
  if (language === 'en') return count === 1 ? '1 title' : `${count} titles`;
  if (count === 0) return 'لا عناوين';
  if (count === 1) return 'عنوان واحد';
  if (count === 2) return 'عنوانان';
  if (count >= 3 && count <= 10) return `${count} عناوين`;
  return `${count} عنواناً`;
}

export function genreChips(title: Title, language: Language): string[] {
  if (title.genreNames.length > 0) return title.genreNames.slice(0, 3);
  return title.genreIds
    .map((id) => genreLabel(id, language))
    .filter((name) => name.length > 0)
    .slice(0, 3);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return '•';
  return parts.map((part) => part.charAt(0).toLocaleUpperCase()).join('');
}

export function hueFromId(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 33 + id.charCodeAt(index)) % 360;
  }
  return hash;
}

const PATTERNS = ['arch', 'orbit', 'dune', 'kiln'] as const;

export function patternFromId(id: string): (typeof PATTERNS)[number] {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash + id.charCodeAt(index)) % PATTERNS.length;
  }
  return PATTERNS[hash] ?? 'arch';
}

