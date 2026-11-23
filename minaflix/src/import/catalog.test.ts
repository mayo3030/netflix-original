import { describe, expect, it, vi } from 'vitest';
import { catalogRows, heroKickerKey, mergeStoredCatalog, parseCatalogFile, titleFromCatalog } from './catalog';

describe('parseCatalogFile', () => {
  it('reads a catalog export into renderable titles', () => {
    const catalog = parseCatalogFile(JSON.stringify({
      version: 1,
      kind: 'catalog',
      source: 'netflix-dom',
      rows: [{
        name: 'Drama',
        titles: [{
          title: 'Heartland',
          netflixId: '81486332',
          synopsis: 'Amy heals horses and the people around them.',
          image: 'https://occ-0-1.nflxso.net/boxart.jpg',
          backdrop: 'https://occ-0-1.nflxso.net/story.jpg',
          year: '2007',
          maturity: 'TV-14',
          seasons: 17,
          genres: ['Drama'],
          cast: ['Amber Marshall'],
          mediaType: 'tv',
          source: 'api',
        }],
      }],
    }));
    expect(catalog.rows[0]?.name).toBe('Drama');
    const title = titleFromCatalog(catalog.rows[0]!.titles[0]!);
    expect(title.posterUrl).toBe('https://occ-0-1.nflxso.net/boxart.jpg');
    expect(title.backdropUrl).toBe('https://occ-0-1.nflxso.net/story.jpg');
    expect(title.overview).toContain('Amy heals horses');
    expect(title.seasons).toBe(17);
    expect(title.cast[0]?.name).toBe('Amber Marshall');
    expect(title.netflixId).toBe('81486332');
    expect(title.trailerKey).toBeNull();
  });

  it('uses an official YouTube trailer id from the catalog export', () => {
    const catalog = parseCatalogFile(JSON.stringify({
      kind: 'catalog',
      rows: [{
        name: 'Drama',
        titles: [{
          title: 'Episodes',
          netflixId: '81486332',
        }, {
          title: 'Heartland',
          netflixId: '81486332',
          year: '2007',
          trailerYoutubeId: 'abcdefghijk',
          trailerTitle: 'Heartland | Official Trailer',
          trailerChannel: 'Netflix',
        }],
      }],
    }));
    const titles = catalog.rows[0]?.titles ?? [];
    expect(titles.every((title) => title.title === 'Heartland')).toBe(true);
    expect(titles.every((title) => title.trailerYoutubeId === 'abcdefghijk')).toBe(true);
    expect(titleFromCatalog(titles[0]!).trailerKey).toBe('abcdefghijk');
  });

  it('features an imported Netflix title on the hero', () => {
    const catalog = parseCatalogFile(JSON.stringify({
      kind: 'catalog',
      rows: [
        { name: 'Continue Watching', titles: [{ title: 'Untitled card', netflixId: '100', image: 'https://occ-0-1.nflxso.net/card.webp' }] },
        {
          name: 'Drama',
          titles: [{
            title: 'Heartland',
            netflixId: '81486332',
            synopsis: 'Amy heals horses and the people around them.',
            image: 'https://occ-0-1.nflxso.net/boxart.jpg',
            backdrop: 'https://occ-0-1.nflxso.net/story.jpg',
            source: 'graphql',
          }],
        },
      ],
    }));
    const { hero, rows } = catalogRows(catalog);
    expect(hero.title).toBe('Heartland');
    expect(hero.netflixId).toBe('81486332');
    expect(hero.overview).toContain('Amy heals horses');
    expect(rows[0]?.titles[0]?.title).toBe('Untitled card');
    expect(heroKickerKey(hero, 'mock')).toBe('yourCatalog');
    expect(heroKickerKey({ netflixId: null }, 'mock')).toBe('demoCatalog');
  });

  it('prefers a card title over modal headings for the same Netflix id', () => {
    const catalog = parseCatalogFile(JSON.stringify({
      kind: 'catalog',
      rows: [
        { name: 'Drama', titles: [{ title: 'Episodes', netflixId: '70281312', synopsis: 'A fugitive helps the FBI.' }] },
        { name: 'Top Picks', titles: [{ title: 'The Blacklist', netflixId: '70281312', synopsis: 'A fugitive helps the FBI.' }] },
        { name: 'Kids', titles: [{ title: 'About Animals', netflixId: '81757047', synopsis: 'A nature series.' }] },
        { name: 'More', titles: [{ title: 'More Like This', netflixId: '80000001' }] },
      ],
    }));
    const blacklist = catalog.rows.flatMap((row) => row.titles).filter((title) => title.netflixId === '70281312');
    expect(blacklist.every((title) => title.title === 'The Blacklist')).toBe(true);
    expect(catalog.rows[2]?.titles[0]?.title).toBe('Animals');
    expect(catalog.rows[3]?.titles[0]?.title).toBe('More Like This');
  });

  it('keeps stored details when a later catalog import leaves them empty', () => {
    const memory = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
      removeItem: (key: string) => { memory.delete(key); },
    });
    mergeStoredCatalog(parseCatalogFile(JSON.stringify({
      kind: 'catalog',
      rows: [{
        name: 'Drama',
        titles: [{
          title: 'Heartland',
          netflixId: '81486332',
          synopsis: 'Amy heals horses and the people around them.',
          image: 'https://occ-0-1.nflxso.net/boxart.jpg',
          backdrop: 'https://occ-0-1.nflxso.net/story.jpg',
          year: '2007',
          maturity: 'TV-14',
          genres: ['Drama'],
          cast: ['Amber Marshall'],
          trailerYoutubeId: 'abcdefghijk',
        }],
      }],
    })));
    const merged = mergeStoredCatalog(parseCatalogFile(JSON.stringify({
      kind: 'catalog',
      rows: [{
        name: 'Drama',
        titles: [{
          title: 'Heartland',
          netflixId: '81486332',
          synopsis: '',
          year: '',
          maturity: '',
          genres: [],
          cast: [],
          trailerYoutubeId: '',
        }],
      }],
    })));
    const title = merged.rows[0]?.titles[0];
    expect(title?.synopsis).toContain('Amy heals horses');
    expect(title?.cast).toEqual(['Amber Marshall']);
    expect(title?.genres).toEqual(['Drama']);
    expect(title?.backdrop).toBe('https://occ-0-1.nflxso.net/story.jpg');
    expect(title?.year).toBe('2007');
    expect(title?.maturity).toBe('TV-14');
    expect(title?.trailerYoutubeId).toBe('abcdefghijk');
    vi.unstubAllGlobals();
  });
});
