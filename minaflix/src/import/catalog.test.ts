import { describe, expect, it } from 'vitest';
import { catalogRows, heroKickerKey, parseCatalogFile, titleFromCatalog } from './catalog';

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
});
