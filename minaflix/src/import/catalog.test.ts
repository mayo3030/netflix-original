import { describe, expect, it } from 'vitest';
import { parseCatalogFile, titleFromCatalog } from './catalog';

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
});
