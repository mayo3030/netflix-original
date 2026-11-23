import { hueFromId, patternFromId } from '../text';
import type { CatalogRow, Title } from '../types';
import { NetflixImportError, type NetflixEntry } from './netflix';

const CATALOG_KEY = 'minaflix.catalog.v1';

export type CatalogTitle = NetflixEntry;

export type StoredCatalog = {
  rows: { name: string; titles: CatalogTitle[] }[];
};

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()).slice(0, 20);
}

function entryFrom(value: unknown): CatalogTitle | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as CatalogTitle & { source?: unknown };
  if (typeof record.title !== 'string' || !record.title.trim()) return null;
  const netflixId = typeof record.netflixId === 'string' && /^\d{1,12}$/.test(record.netflixId) ? record.netflixId : null;
  return {
    title: record.title.trim(),
    showTitle: typeof record.showTitle === 'string' ? record.showTitle : null,
    netflixId,
    watchedAt: null,
    synopsis: typeof record.synopsis === 'string' ? record.synopsis : null,
    image: typeof record.image === 'string' && record.image.startsWith('https://') ? record.image : null,
    backdrop: typeof record.backdrop === 'string' && record.backdrop.startsWith('https://') ? record.backdrop : null,
    year: typeof record.year === 'string' ? record.year : null,
    maturity: typeof record.maturity === 'string' ? record.maturity : null,
    genres: stringList(record.genres),
    cast: stringList(record.cast),
    creators: stringList(record.creators),
    directors: stringList(record.directors),
    runtimeMinutes: typeof record.runtimeMinutes === 'number' ? record.runtimeMinutes : null,
    seasons: typeof record.seasons === 'number' ? record.seasons : null,
    mediaType: record.mediaType === 'tv' || record.mediaType === 'movie' ? record.mediaType : null,
    detailSource: record.source === 'api' || record.source === 'page' ? record.source : record.detailSource ?? null,
  };
}

export function parseCatalogFile(text: string): StoredCatalog {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new NetflixImportError('That JSON file could not be parsed.');
  }
  const record = parsed as { kind?: unknown; rows?: unknown };
  if (record.kind !== 'catalog' || !Array.isArray(record.rows)) {
    throw new NetflixImportError('That file is not a MinaFlix catalog export.');
  }
  const rows = record.rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const named = row as { name?: unknown; titles?: unknown };
    const name = typeof named.name === 'string' ? named.name.trim() : '';
    const titles = Array.isArray(named.titles) ? named.titles.flatMap((item) => {
      const entry = entryFrom(item);
      return entry ? [entry] : [];
    }) : [];
    return name && titles.length ? [{ name, titles }] : [];
  });
  if (!rows.length) throw new NetflixImportError('That catalog file has no titles.');
  return { rows };
}

export function titleFromCatalog(entry: CatalogTitle): Title {
  const id = entry.netflixId ? `netflix-${entry.netflixId}` : `netflix-title-${entry.title}`;
  return {
    id,
    source: 'mock',
    mediaType: entry.mediaType === 'tv' ? 'tv' : 'movie',
    title: entry.title,
    titleAr: '',
    overview: entry.synopsis || '',
    overviewAr: '',
    posterUrl: entry.image ?? null,
    backdropUrl: entry.backdrop ?? entry.image ?? null,
    rating: 0,
    year: entry.year || '',
    genreIds: [],
    genreNames: entry.genres ?? [],
    hue: hueFromId(id),
    pattern: patternFromId(id),
    trailerKey: null,
    runtime: entry.runtimeMinutes ?? null,
    seasons: entry.seasons ?? null,
    cast: (entry.cast ?? []).map((name, index) => ({
      id: index + 1,
      name,
      nameAr: '',
      character: '',
      characterAr: '',
      profileUrl: null,
    })),
    detailsLoaded: true,
    detailsError: false,
    openCinema: false,
    credit: null,
    netflixId: entry.netflixId,
    maturity: entry.maturity ?? null,
    creators: entry.creators ?? [],
    directors: entry.directors ?? [],
  };
}

export function loadStoredCatalog(): StoredCatalog | null {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCatalog;
    return parsed?.rows?.length ? parsed : null;
  } catch {
    return null;
  }
}

export function mergeStoredCatalog(next: StoredCatalog): StoredCatalog {
  const current = loadStoredCatalog();
  const rows = [...(current?.rows ?? [])];
  for (const row of next.rows) {
    const existing = rows.find((item) => item.name === row.name);
    if (!existing) {
      rows.push(row);
      continue;
    }
    const seen = new Set(existing.titles.map((item) => item.netflixId || item.title));
    for (const title of row.titles) {
      const key = title.netflixId || title.title;
      if (seen.has(key)) continue;
      seen.add(key);
      existing.titles.push(title);
    }
  }
  const stored = { rows };
  localStorage.setItem(CATALOG_KEY, JSON.stringify(stored));
  return stored;
}

export function clearStoredCatalog(): void {
  localStorage.removeItem(CATALOG_KEY);
}

export function catalogRows(stored: StoredCatalog): { hero: Title; rows: CatalogRow[] } {
  const rows = stored.rows.map((row, index) => ({
    id: `netflix-row-${index}`,
    title: row.name,
    titleAr: row.name,
    titles: row.titles.map(titleFromCatalog),
  }));
  const hero = rows[0]?.titles[0];
  if (!hero) throw new NetflixImportError('That catalog file has no titles.');
  return { hero, rows };
}

export function netflixWatchUrl(netflixId: string): string {
  return `https://www.netflix.com/watch/${netflixId}`;
}
