import { genreLabel } from '../genres';
import { STRINGS } from '../i18n/strings';
import { hueFromId, patternFromId } from '../text';
import type { CastMember, CatalogRow, Language, MediaType, Title } from '../types';

const API_ROOT = 'https://api.themoviedb.org/3';
const IMAGE_ROOT = 'https://image.tmdb.org/t/p';

const FEATURED_GENRES = [18, 28, 35, 16, 878, 53, 9648, 10749, 10751, 99, 14, 12];

type RawListItem = {
  id?: number;
  media_type?: string;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
  genre_ids?: number[];
  adult?: boolean;
};

type RawVideo = {
  site?: string;
  type?: string;
  key?: string;
  official?: boolean;
};

type RawDetail = RawListItem & {
  runtime?: number | null;
  number_of_seasons?: number | null;
  genres?: { id: number; name: string }[];
  credits?: {
    cast?: {
      id?: number;
      name?: string;
      character?: string;
      profile_path?: string | null;
      order?: number;
    }[];
  };
  videos?: { results?: RawVideo[] };
};

export class TmdbError extends Error {
  status: number;

  constructor(status: number) {
    super(`TMDB request failed (${status})`);
    this.name = 'TmdbError';
    this.status = status;
  }
}

export function tmdbConfigured(): boolean {
  const key = import.meta.env.VITE_TMDB_API_KEY;
  if (typeof key !== 'string') return false;
  const trimmed = key.trim();
  return trimmed.length > 0 && !/^your_/i.test(trimmed);
}

function apiKey(): string {
  return (import.meta.env.VITE_TMDB_API_KEY ?? '').trim();
}

function languageCode(language: Language): string {
  return language === 'ar' ? 'ar' : 'en-US';
}

export function imageUrl(path: string | null | undefined, size: 'w185' | 'w342' | 'w780' | 'w1280'): string | null {
  if (!path) return null;
  return `${IMAGE_ROOT}/${size}${path}`;
}

async function getJson<T>(path: string, params: Record<string, string>, signal: AbortSignal): Promise<T> {
  const url = new URL(`${API_ROOT}${path}`);
  url.searchParams.set('api_key', apiKey());
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new TmdbError(response.status);
  return response.json() as Promise<T>;
}

function mapListItem(raw: RawListItem, fallbackType: MediaType, language: Language): Title | null {
  if (raw.adult) return null;
  if (raw.media_type === 'person') return null;
  const mediaType: MediaType = raw.media_type === 'tv' || raw.media_type === 'movie' ? raw.media_type : fallbackType;
  const name = (raw.title || raw.name || '').trim();
  if (!raw.id || !name) return null;
  const overview = raw.overview?.trim() ?? '';
  const id = `tmdb-${mediaType}-${raw.id}`;
  return {
    id,
    source: 'tmdb',
    mediaType,
    title: name,
    titleAr: language === 'ar' ? name : '',
    overview,
    overviewAr: language === 'ar' ? overview : '',
    posterUrl: imageUrl(raw.poster_path, 'w342'),
    backdropUrl: imageUrl(raw.backdrop_path, 'w1280'),
    rating: Math.round((raw.vote_average ?? 0) * 10) / 10,
    year: (raw.release_date || raw.first_air_date || '').slice(0, 4),
    genreIds: raw.genre_ids ?? [],
    genreNames: [],
    hue: hueFromId(id),
    pattern: patternFromId(id),
    trailerKey: null,
    runtime: null,
    seasons: null,
    cast: [],
    detailsLoaded: false,
    detailsError: false,
    openCinema: false,
    credit: null,
  };
}

function isTitle(value: Title | null): value is Title {
  return value !== null;
}

function pickTrailer(videos: RawDetail['videos']): string | null {
  const candidates = (videos?.results ?? []).filter((video): video is RawVideo & { key: string } => {
    return video.site === 'YouTube' && typeof video.key === 'string' && video.key.length > 0 && (video.type === 'Trailer' || video.type === 'Teaser');
  });
  const score = (video: RawVideo) => (video.type === 'Trailer' ? 4 : 2) + (video.official ? 1 : 0);
  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0]?.key ?? null;
}

export async function loadTmdbHome(language: Language, signal: AbortSignal): Promise<{ hero: Title; rows: CatalogRow[] }> {
  const lang = languageCode(language);
  const [trendingResult, topResult, genreResult, ...discovered] = await Promise.allSettled([
    getJson<{ results: RawListItem[] }>('/trending/all/week', { language: lang }, signal),
    getJson<{ results: RawListItem[] }>('/movie/top_rated', { language: lang, include_adult: 'false' }, signal),
    getJson<{ genres: { id: number; name: string }[] }>('/genre/movie/list', { language: lang }, signal),
    ...FEATURED_GENRES.map((genreId) => getJson<{ results: RawListItem[] }>('/discover/movie', {
      language: lang,
      include_adult: 'false',
      sort_by: 'popularity.desc',
      with_genres: String(genreId),
    }, signal)),
  ]);

  if (!trendingResult || trendingResult.status === 'rejected') throw trendingResult?.reason ?? new TmdbError(0);
  if (!topResult || topResult.status === 'rejected') throw topResult?.reason ?? new TmdbError(0);

  const trending = listTitles(trendingResult.value.results, 'movie', language);
  const top = listTitles(topResult.value.results, 'movie', language);
  const hero = trending[0] ?? top[0];
  if (!hero) throw new TmdbError(404);

  const genreNames = new Map<number, string>();
  if (genreResult && genreResult.status === 'fulfilled') {
    for (const genre of genreResult.value.genres) genreNames.set(genre.id, genre.name);
  }

  const rows: CatalogRow[] = [
    { id: 'trending', title: STRINGS.en.trending, titleAr: STRINGS.ar.trending, titles: trending },
    { id: 'top', title: STRINGS.en.topRated, titleAr: STRINGS.ar.topRated, titles: top },
  ];

  FEATURED_GENRES.forEach((genreId, index) => {
    const result = discovered[index];
    if (!result || result.status !== 'fulfilled') return;
    const titles = listTitles(result.value.results, 'movie', language);
    if (titles.length < 4) return;
    const apiName = genreNames.get(genreId) ?? '';
    rows.push({
      id: `genre-${genreId}`,
      title: language === 'en' ? (apiName || genreLabel(genreId, 'en')) : genreLabel(genreId, 'en'),
      titleAr: language === 'ar' ? (apiName || genreLabel(genreId, 'ar')) : genreLabel(genreId, 'ar'),
      titles,
    });
  });

  return { hero, rows };
}

function listTitles(results: RawListItem[] | undefined, mediaType: MediaType, language: Language): Title[] {
  return (results ?? []).map((item) => mapListItem(item, mediaType, language)).filter(isTitle).slice(0, 20);
}

export async function searchTmdb(query: string, language: Language, signal: AbortSignal): Promise<Title[]> {
  const data = await getJson<{ results: RawListItem[] }>('/search/multi', {
    query,
    language: languageCode(language),
    include_adult: 'false',
  }, signal);
  return data.results.map((item) => mapListItem(item, 'movie', language)).filter(isTitle).slice(0, 24);
}

export async function fetchTmdbDetails(title: Title, language: Language, signal: AbortSignal): Promise<Title> {
  const match = /^tmdb-(movie|tv)-(\d+)$/.exec(title.id);
  if (!match) return { ...title, detailsLoaded: true, detailsError: true };
  const mediaType = match[1] as MediaType;
  const numericId = match[2];
  if (!numericId) return { ...title, detailsLoaded: true, detailsError: true };
  const detail = await getJson<RawDetail>(`/${mediaType}/${numericId}`, {
    language: languageCode(language),
    append_to_response: 'credits,videos',
    include_adult: 'false',
  }, signal);

  const name = (detail.title || detail.name || title.title).trim();
  const overview = detail.overview?.trim() || title.overview;
  const cast: CastMember[] = (detail.credits?.cast ?? [])
    .filter((person) => person.name && person.id)
    .slice(0, 12)
    .map((person) => {
      const personName = person.name ?? '';
      const character = person.character ?? '';
      return {
        id: person.id ?? 0,
        name: personName,
        nameAr: language === 'ar' ? personName : '',
        character,
        characterAr: language === 'ar' ? character : '',
        profileUrl: imageUrl(person.profile_path, 'w185'),
      };
    });

  return {
    ...title,
    mediaType,
    title: name,
    titleAr: language === 'ar' ? name : title.titleAr,
    overview,
    overviewAr: language === 'ar' ? overview : title.overviewAr,
    posterUrl: imageUrl(detail.poster_path, 'w342') ?? title.posterUrl,
    backdropUrl: imageUrl(detail.backdrop_path, 'w1280') ?? title.backdropUrl,
    rating: typeof detail.vote_average === 'number' ? Math.round(detail.vote_average * 10) / 10 : title.rating,
    year: (detail.release_date || detail.first_air_date || title.year).slice(0, 4),
    genreIds: detail.genres?.map((genre) => genre.id) ?? title.genreIds,
    genreNames: detail.genres?.map((genre) => genre.name).slice(0, 3) ?? [],
    trailerKey: pickTrailer(detail.videos),
    runtime: mediaType === 'movie' && detail.runtime ? detail.runtime : null,
    seasons: mediaType === 'tv' && detail.number_of_seasons ? detail.number_of_seasons : null,
    cast,
    detailsLoaded: true,
    detailsError: false,
  };
}
