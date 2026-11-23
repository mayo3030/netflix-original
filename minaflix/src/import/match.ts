import { searchTmdb, tmdbConfigured } from '../api/tmdb';
import { MOCK_TITLES } from '../data/mock';
import { hueFromId, patternFromId } from '../text';
import type { Language, Title } from '../types';
import {
  dedupeEntries,
  normalizeName,
  searchQueryFromNetflixTitle,
  type NetflixEntry,
} from './netflix';

const TMDB_LOOKUP_LIMIT = 30;
const TMDB_GAP_MS = 280;

export type MatchKind = 'tmdb' | 'demo' | 'name';

export type MatchedTitle = {
  title: Title;
  kind: MatchKind;
};

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function findDemo(query: string): Title | undefined {
  const needle = normalizeName(query);
  if (!needle) return undefined;
  return MOCK_TITLES.find((title) => normalizeName(title.title) === needle || normalizeName(title.titleAr) === needle);
}

function nameCard(entry: NetflixEntry, kind: 'list' | 'watched'): Title {
  const id = entry.netflixId ? `netflix-${entry.netflixId}` : `netflix-title-${normalizeName(entry.title).replace(/ /g, '-') || 'untitled'}`;
  const watched = entry.watchedAt ? `Watched ${entry.watchedAt}. ` : '';
  const overview = kind === 'list'
    ? 'Imported from your Netflix My List. No catalog match was found, so this card keeps the exported name.'
    : `${watched}Imported from your Netflix viewing activity. No catalog match was found, so this card keeps the exported name.`;
  return {
    id,
    source: 'mock',
    mediaType: 'movie',
    title: entry.title,
    titleAr: '',
    overview,
    overviewAr: kind === 'list'
      ? 'مستورد من قائمتك على نتفليكس. لم يُعثر على تطابق، فبقيت البطاقة بالاسم المُصدَّر.'
      : `${entry.watchedAt ? `شوهد في ${entry.watchedAt}. ` : ''}مستورد من سجل المشاهدة على نتفليكس. لم يُعثر على تطابق، فبقيت البطاقة بالاسم المُصدَّر.`,
    posterUrl: null,
    backdropUrl: null,
    rating: 0,
    year: /^\d{4}/.test(entry.watchedAt ?? '') ? (entry.watchedAt ?? '').slice(0, 4) : '',
    genreIds: [],
    genreNames: [],
    hue: hueFromId(id),
    pattern: patternFromId(id),
    trailerKey: null,
    runtime: null,
    seasons: null,
    cast: [],
    detailsLoaded: true,
    detailsError: false,
    openCinema: false,
    credit: null,
    netflixId: entry.netflixId,
  };
}

async function matchOne(
  entry: NetflixEntry,
  kind: 'list' | 'watched',
  language: Language,
  budget: { left: number },
  signal: AbortSignal,
): Promise<MatchedTitle> {
  const { query, preferTv } = searchQueryFromNetflixTitle(entry.title);
  const demo = findDemo(query) ?? findDemo(entry.title);
  if (demo) return { title: { ...demo, netflixId: entry.netflixId }, kind: 'demo' };
  if (!tmdbConfigured() || budget.left <= 0) return { title: nameCard(entry, kind), kind: 'name' };

  budget.left -= 1;
  try {
    const results = await searchTmdb(query, language, signal);
    const preferred = preferTv ? results.find((title) => title.mediaType === 'tv') : results[0];
    const hit = preferred ?? results[0];
    if (!hit) return { title: nameCard(entry, kind), kind: 'name' };
    const id = entry.netflixId ? `netflix-${entry.netflixId}` : hit.id;
    return {
      title: { ...hit, id, netflixId: entry.netflixId, detailsLoaded: true },
      kind: 'tmdb',
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return { title: nameCard(entry, kind), kind: 'name' };
  }
}

export async function matchNetflixEntries(
  entries: NetflixEntry[],
  kind: 'list' | 'watched',
  language: Language,
  budget: { left: number },
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<MatchedTitle[]> {
  const unique = dedupeEntries(entries);
  const matched: MatchedTitle[] = [];
  for (let index = 0; index < unique.length; index += 1) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const entry = unique[index];
    if (!entry) continue;
    onProgress?.(index, unique.length);
    const before = budget.left;
    const result = await matchOne(entry, kind, language, budget, signal);
    matched.push(result);
    if (result.kind === 'tmdb' && budget.left < before) await delay(TMDB_GAP_MS, signal);
  }
  onProgress?.(unique.length, unique.length);
  return matched;
}

export { TMDB_LOOKUP_LIMIT };
