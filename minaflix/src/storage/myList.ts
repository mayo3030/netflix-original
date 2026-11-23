import type { Language, MediaType, Pattern, Title } from '../types';

const STORAGE_KEY = 'minaflix.mylist.v1';
const PATTERNS: Pattern[] = ['arch', 'orbit', 'dune', 'kiln'];

export type SavedItem = {
  id: string;
  mediaType: MediaType;
  title: string;
  titleAr: string;
  overview: string;
  overviewAr: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  rating: number;
  year: string;
  genreIds: number[];
  hue: number;
  pattern: Pattern;
  trailerKey: string | null;
};

export type Folder = {
  id: string;
  name: string;
  nameAr: string;
  custom: boolean;
  itemIds: string[];
};

export type ListStore = {
  version: 1;
  folders: Folder[];
  items: Record<string, SavedItem>;
};

function defaultFolders(): Folder[] {
  return [
    { id: 'watch-later', name: 'Watch later', nameAr: 'للمشاهدة لاحقاً', custom: false, itemIds: [] },
    { id: 'favorites', name: 'Favorites', nameAr: 'المفضلة', custom: false, itemIds: [] },
  ];
}

export function defaultStore(): ListStore {
  return { version: 1, folders: defaultFolders(), items: {} };
}

export function folderName(folder: Folder, language: Language): string {
  if (folder.custom || language === 'en') return folder.name;
  return folder.nameAr || folder.name;
}

export function toSaved(title: Title): SavedItem {
  return {
    id: title.id,
    mediaType: title.mediaType,
    title: title.title,
    titleAr: title.titleAr,
    overview: title.overview,
    overviewAr: title.overviewAr,
    posterUrl: title.posterUrl,
    backdropUrl: title.backdropUrl,
    rating: title.rating,
    year: title.year,
    genreIds: title.genreIds,
    hue: title.hue,
    pattern: title.pattern,
    trailerKey: title.trailerKey,
  };
}

function isPattern(value: unknown): value is Pattern {
  return typeof value === 'string' && PATTERNS.includes(value as Pattern);
}

function isSavedItem(value: unknown): value is SavedItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SavedItem>;
  return typeof item.id === 'string'
    && (item.mediaType === 'movie' || item.mediaType === 'tv')
    && typeof item.title === 'string'
    && typeof item.titleAr === 'string'
    && typeof item.overview === 'string'
    && typeof item.overviewAr === 'string'
    && (item.posterUrl === null || typeof item.posterUrl === 'string')
    && (item.backdropUrl === null || typeof item.backdropUrl === 'string')
    && typeof item.rating === 'number'
    && typeof item.year === 'string'
    && Array.isArray(item.genreIds)
    && typeof item.hue === 'number'
    && isPattern(item.pattern)
    && (item.trailerKey === null || typeof item.trailerKey === 'string');
}

export function pruneStore(store: ListStore): ListStore {
  const used = new Set(store.folders.flatMap((folder) => folder.itemIds));
  const items: Record<string, SavedItem> = {};
  for (const id of used) {
    const item = store.items[id];
    if (item) items[id] = item;
  }
  const folders = store.folders.map((folder) => ({
    ...folder,
    itemIds: folder.itemIds.filter((id) => items[id]),
  }));
  return { version: 1, folders, items };
}

export function loadStore(): ListStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultStore();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaultStore();
    const candidate = parsed as Partial<ListStore>;
    if (candidate.version !== 1 || !Array.isArray(candidate.folders)) return defaultStore();

    const folders: Folder[] = [];
    for (const entry of candidate.folders) {
      if (!entry || typeof entry !== 'object') continue;
      const folder = entry as Partial<Folder>;
      if (typeof folder.id !== 'string' || typeof folder.name !== 'string') continue;
      const name = folder.name.trim().slice(0, 40);
      if (!name) continue;
      folders.push({
        id: folder.id,
        name,
        nameAr: typeof folder.nameAr === 'string' && folder.nameAr.trim() ? folder.nameAr.trim().slice(0, 40) : name,
        custom: Boolean(folder.custom),
        itemIds: Array.isArray(folder.itemIds) ? folder.itemIds.filter((id): id is string => typeof id === 'string') : [],
      });
    }

    const items: Record<string, SavedItem> = {};
    if (candidate.items && typeof candidate.items === 'object') {
      for (const [id, item] of Object.entries(candidate.items)) {
        if (isSavedItem(item) && item.id === id) items[id] = item;
      }
    }

    return pruneStore({
      version: 1,
      folders: folders.length > 0 ? folders : defaultFolders(),
      items,
    });
  } catch {
    return defaultStore();
  }
}

export function saveStore(store: ListStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore quota and private-mode failures.
  }
}

export function newFolderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `folder-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
