export type NetflixEntry = {
  title: string;
  showTitle: string | null;
  netflixId: string | null;
  watchedAt: string | null;
};

export type NetflixLists = {
  myList: NetflixEntry[] | null;
  viewingActivity: NetflixEntry[] | null;
};

export class NetflixImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetflixImportError';
  }
}

const MAX_ROWS = 500;

export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchQueryFromNetflixTitle(title: string): { query: string; preferTv: boolean } {
  const preferTv = /:\s*(season|series|part|volume|chapter|episode|limited series|book)\b/i.test(title);
  const query = title
    .replace(/\s+/g, ' ')
    .replace(/:\s*(season|series|part|volume|chapter|episode|limited series|book)\b[\s\S]*$/i, '')
    .replace(/:\s*"[^"]*"\s*$/, '')
    .trim();
  return { query: query || title.trim(), preferTv };
}

export function normalizeWatchedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) {
    const year = iso[1];
    const month = iso[2];
    const day = iso[3];
    if (year && month && day) return `${year}-${month}-${day}`;
  }
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(trimmed);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    let year = Number(us[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return trimmed.slice(0, 40);
}

export function netflixTitleUrl(netflixId: string): string {
  return `https://www.netflix.com/title/${netflixId}`;
}

export function showTitleFrom(title: string): string | null {
  const match = /^(.*?)\s*:\s*Season\b/i.exec(title);
  const name = match?.[1]?.trim() ?? '';
  return name && name !== title ? name : null;
}

function entry(title: string, netflixId: string | null, watchedAt: string | null, showTitle?: string | null): NetflixEntry | null {
  const name = title.replace(/\s+/g, ' ').trim();
  if (!name) return null;
  const id = netflixId && /^\d{1,12}$/.test(netflixId) ? netflixId : null;
  const cleaned = typeof showTitle === 'string' && showTitle.trim() ? showTitle.trim() : showTitleFrom(name);
  return { title: name.slice(0, 180), showTitle: cleaned, netflixId: id, watchedAt: normalizeWatchedAt(watchedAt) };
}

function take(entries: NetflixEntry[]): NetflixEntry[] {
  return entries.slice(0, MAX_ROWS);
}

export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char ?? '';
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char ?? '';
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((columns) => columns.some((column) => column.trim().length > 0));
}

function headerIndex(headers: string[], names: string[]): number {
  const normalized = headers.map((header) => header.trim().toLowerCase());
  return normalized.findIndex((header) => names.includes(header));
}

export function parseViewingActivityCsv(text: string): NetflixEntry[] {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) throw new NetflixImportError('The CSV file is empty.');
  const titleIndex = headerIndex(header, ['title']);
  if (titleIndex < 0) throw new NetflixImportError('The CSV needs a Title column.');
  const dateIndex = headerIndex(header, ['date', 'start time', 'watched', 'datetime']);
  const entries: NetflixEntry[] = [];
  for (const columns of rows.slice(1)) {
    const title = columns[titleIndex] ?? '';
    const watched = dateIndex >= 0 ? columns[dateIndex] ?? null : null;
    const next = entry(title, null, watched);
    if (next) entries.push(next);
  }
  return take(entries);
}

function readJsonEntries(value: unknown, requireId: boolean): NetflixEntry[] {
  if (!Array.isArray(value)) throw new NetflixImportError('The export lists are not arrays.');
  const entries: NetflixEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { title?: unknown; showTitle?: unknown; netflixId?: unknown; watchedAt?: unknown };
    if (typeof record.title !== 'string') continue;
    const id = typeof record.netflixId === 'string' ? record.netflixId : null;
    if (requireId && !id) continue;
    const watched = typeof record.watchedAt === 'string' ? record.watchedAt : null;
    const showTitle = typeof record.showTitle === 'string' ? record.showTitle : null;
    const next = entry(record.title, id, watched, showTitle);
    if (next) entries.push(next);
  }
  return take(entries);
}

export function parseMinaflixExport(text: string): NetflixLists {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new NetflixImportError('That JSON file could not be parsed.');
  }
  if (!parsed || typeof parsed !== 'object') throw new NetflixImportError('That JSON file is not an export.');
  const record = parsed as { version?: unknown; source?: unknown; myList?: unknown; viewingActivity?: unknown };
  if (record.version !== 1 || record.source !== 'netflix-dom') {
    throw new NetflixImportError('That JSON file is not a MinaFlix Netflix export.');
  }
  return {
    myList: readJsonEntries(record.myList, false),
    viewingActivity: readJsonEntries(record.viewingActivity, false),
  };
}

export function parseNetflixImport(text: string, filename: string): NetflixLists {
  const trimmed = text.trim();
  if (!trimmed) throw new NetflixImportError('That file is empty.');
  const lower = filename.toLowerCase();
  if (lower.endsWith('.json') || trimmed.startsWith('{')) return parseMinaflixExport(trimmed);
  if (lower.endsWith('.csv') || trimmed.includes(',')) {
    return { myList: null, viewingActivity: parseViewingActivityCsv(trimmed) };
  }
  throw new NetflixImportError('Choose a MinaFlix JSON export or a ViewingActivity CSV.');
}

export function dedupeEntries(entries: NetflixEntry[]): NetflixEntry[] {
  const seen = new Set<string>();
  const unique: NetflixEntry[] = [];
  for (const item of entries) {
    const key = item.netflixId ? `id:${item.netflixId}` : `name:${normalizeName(item.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}
