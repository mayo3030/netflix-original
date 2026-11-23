import { describe, expect, it } from 'vitest';
import {
  NetflixImportError,
  dedupeEntries,
  normalizeWatchedAt,
  parseCsv,
  parseMinaflixExport,
  parseNetflixImport,
  parseViewingActivityCsv,
  searchQueryFromNetflixTitle,
} from './netflix';

describe('parseCsv', () => {
  it('keeps commas that sit inside quotes', () => {
    const rows = parseCsv('Title,Date\n"One, Two",1/2/24\nPlain,3/4/24\n');
    expect(rows).toEqual([
      ['Title', 'Date'],
      ['One, Two', '1/2/24'],
      ['Plain', '3/4/24'],
    ]);
  });

  it('unescapes doubled quotes', () => {
    const rows = parseCsv('"Say ""hi""",1/1/24\n');
    expect(rows[0]?.[0]).toBe('Say "hi"');
  });
});

describe('parseViewingActivityCsv', () => {
  it('reads the simple Title,Date download', () => {
    const entries = parseViewingActivityCsv('Title,Date\nSintel,1/5/24\n');
    expect(entries).toEqual([
      { title: 'Sintel', netflixId: null, watchedAt: '2024-01-05' },
    ]);
  });

  it('reads the account download with Start Time and ignores other columns', () => {
    const csv = [
      'Profile Name,Start Time,Duration,Attributes,Title,Device Type',
      'Home,2024-11-02 19:04:00,00:12:00,,Tears of Steel,Chrome',
      'Home,2020-01-08 01:00:00,00:40:00,,"Lantern Gate: Season 1: ""Pilot""",TV',
    ].join('\n');
    const entries = parseViewingActivityCsv(csv);
    expect(entries[0]).toEqual({ title: 'Tears of Steel', netflixId: null, watchedAt: '2024-11-02' });
    expect(entries[1]?.title).toBe('Lantern Gate: Season 1: "Pilot"');
    expect(entries[1]?.watchedAt).toBe('2020-01-08');
  });

  it('rejects a file without a Title column', () => {
    expect(() => parseViewingActivityCsv('Name,Date\nSintel,1/1/24\n')).toThrow(NetflixImportError);
  });

  it('rejects an empty file', () => {
    expect(() => parseViewingActivityCsv('   ')).toThrow(NetflixImportError);
  });
});

describe('parseMinaflixExport', () => {
  it('reads my list and viewing activity', () => {
    const lists = parseMinaflixExport(JSON.stringify({
      version: 1,
      source: 'netflix-dom',
      exportedAt: '2026-11-23T00:00:00.000Z',
      myList: [{ title: 'Sintel', netflixId: '80000001' }],
      viewingActivity: [{ title: 'Tears of Steel', netflixId: '70248183', watchedAt: '2024-11-02' }],
    }));
    expect(lists.myList).toEqual([{ title: 'Sintel', netflixId: '80000001', watchedAt: null }]);
    expect(lists.viewingActivity?.[0]?.watchedAt).toBe('2024-11-02');
  });

  it('rejects a different JSON shape', () => {
    expect(() => parseMinaflixExport('{"myList":[]}')).toThrow(NetflixImportError);
    expect(() => parseMinaflixExport('{')).toThrow(NetflixImportError);
  });

  it('drops rows that have no title and ignores a non-numeric id', () => {
    const lists = parseMinaflixExport(JSON.stringify({
      version: 1,
      source: 'netflix-dom',
      myList: [{ title: '   ' }, { title: 'Named only', netflixId: 'nope' }, { watchedAt: '2024-01-01' }],
      viewingActivity: [],
    }));
    expect(lists.myList).toEqual([{ title: 'Named only', netflixId: null, watchedAt: null }]);
  });
});

describe('parseNetflixImport', () => {
  it('chooses JSON or CSV from the file name', () => {
    const json = parseNetflixImport(JSON.stringify({
      version: 1,
      source: 'netflix-dom',
      myList: [{ title: 'Sintel', netflixId: '1' }],
      viewingActivity: [],
    }), 'minaflix-netflix-export.json');
    expect(json.myList).toHaveLength(1);
    const csv = parseNetflixImport('Title,Date\nSintel,12/31/99\n', 'ViewingActivity.csv');
    expect(csv.viewingActivity?.[0]?.watchedAt).toBe('1999-12-31');
    expect(csv.myList).toBeNull();
  });
});

describe('titles and dates', () => {
  it('strips a season suffix before a catalog search', () => {
    expect(searchQueryFromNetflixTitle('Lantern Gate: Season 1: "Pilot"')).toEqual({
      query: 'Lantern Gate',
      preferTv: true,
    });
    expect(searchQueryFromNetflixTitle('Sintel').preferTv).toBe(false);
  });

  it('keeps a date label when it is not a calendar date', () => {
    expect(normalizeWatchedAt('Yesterday')).toBe('Yesterday');
    expect(normalizeWatchedAt('  ')).toBeNull();
  });

  it('dedupes by Netflix id and keeps the first row', () => {
    const unique = dedupeEntries([
      { title: 'Sintel', netflixId: '1', watchedAt: '2024-01-01' },
      { title: 'Sintel (again)', netflixId: '1', watchedAt: '2024-02-01' },
      { title: 'Other', netflixId: null, watchedAt: null },
    ]);
    expect(unique.map((item) => item.title)).toEqual(['Sintel', 'Other']);
  });
});
