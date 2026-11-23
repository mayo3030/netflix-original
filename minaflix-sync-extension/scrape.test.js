import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./scrape.js', import.meta.url), 'utf8');

function page(html, url) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url, runScripts: 'outside-only' });
  vm.runInContext(source, dom.getInternalVMContext());
  return dom;
}

const legacyHistory = `
  <div class="retableRow">
    <div class="col date">11/2/24</div>
    <div class="col title"><a href="/title/70248183">Tears of Steel</a></div>
  </div>
  <div class="retableRow">
    <div class="col date">1/5/24</div>
    <div class="col title"><a href="https://www.netflix.com/watch/80000001?trackId=9">Sintel</a></div>
  </div>
`;

const settingsViewed = `
  <h1>Watch History and Ratings, For MINA</h1>
  <ul data-uia="viewing-history">
    <li data-list-item>
      <a href="/watch/81234567">Lantern Gate</a>
      <span class="date">11/20/26</span>
      <button type="button" aria-label="Remove from viewing history">×</button>
    </li>
    <li data-list-item>
      <a href="/title/80119234"><img alt="Saffron Letters"></a>
      <time datetime="2026-11-18">November 18, 2026</time>
    </li>
    <li data-list-item>
      <a href="/watch/70000003" data-uia="title-link"><span>The Night Souk</span></a>
      <span data-uia="activity-date">11/2/26</span>
    </li>
  </ul>
  <button type="button" data-uia="show-more"><span>Show More</span></button>
`;

describe('viewing history fixtures', () => {
  it('reads the old viewing-activity rows', () => {
    const dom = page(legacyHistory, 'https://www.netflix.com/viewingactivity');
    const { items } = dom.window.MinaflixScrape.collectViewing(dom.window.document);
    expect(items).toEqual([
      { title: 'Tears of Steel', showTitle: null, netflixId: '70248183', watchedAt: '11/2/24' },
      { title: 'Sintel', showTitle: null, netflixId: '80000001', watchedAt: '1/5/24' },
    ]);
  });

  it('reads /settings/viewed, including /watch and /title links', () => {
    const dom = page(settingsViewed, 'https://www.netflix.com/settings/viewed');
    const { items } = dom.window.MinaflixScrape.collectViewing(dom.window.document);
    const byId = Object.fromEntries(items.map((item) => [item.netflixId, item]));
    expect(byId['81234567']).toMatchObject({ title: 'Lantern Gate', watchedAt: '11/20/26' });
    expect(byId['80119234']).toMatchObject({ title: 'Saffron Letters', watchedAt: '2026-11-18' });
    expect(byId['70000003']).toMatchObject({ title: 'The Night Souk', watchedAt: '11/2/26' });
  });

  it('clicks Show More until the button is exhausted', async () => {
    const dom = page(settingsViewed, 'https://www.netflix.com/settings/viewed');
    const button = dom.window.document.querySelector('[data-uia="show-more"]');
    let added = false;
    button.addEventListener('click', () => {
      if (added) return;
      added = true;
      const list = dom.window.document.querySelector('ul');
      list.insertAdjacentHTML('beforeend', `
        <li data-list-item>
          <a href="/title/80999999">Moon Bakery</a>
          <span class="date">10/1/26</span>
        </li>
      `);
      button.disabled = true;
    });
    const result = await dom.window.MinaflixScrape.expandAndCollect(dom.window.document, 'viewing', {
      delayMs: 0,
      settleMs: 50,
      initialWaitMs: 20,
      maxClicks: 5,
    });
    expect(result.clicks).toBe(1);
    expect(result.items.map((item) => item.title)).toContain('Moon Bakery');
    expect(result.items).toHaveLength(4);
  });
});

describe('my list fixtures', () => {
  it('reads title and watch links from gallery markup', () => {
    const dom = page(`
      <div class="row">
        <a href="/title/80119234" aria-label="Play Saffron Letters"><img alt="ignored"></a>
        <a href="https://www.netflix.com/watch/70248183"><span>Tears of Steel</span></a>
      </div>
    `, 'https://www.netflix.com/browse/my-list');
    const { items } = dom.window.MinaflixScrape.collectMyList(dom.window.document);
    expect(items).toEqual([
      { title: 'Saffron Letters', netflixId: '80119234' },
      { title: 'Tears of Steel', netflixId: '70248183' },
    ]);
  });

  it('does not treat a login form as a list', () => {
    const dom = page('<form data-uia="login-form"><input type="password"></form>', 'https://www.netflix.com/login');
    expect(dom.window.MinaflixScrape.collectMyList(dom.window.document).error).toMatch(/Sign in/);
  });
});

const liveViewed = `
  <nav><ul><li>Audio and Subtitles</li></ul></nav>
  <div data-uia="viewing-activity-page+right-col">
    <section data-uia="viewing-activity-page+container">
      <div data-uia="viewing-activity-page+tabbed-layout+tabs">Watched Rated</div>
      <div data-uia="viewing-activity-page+list-item">
        <div data-uia="viewing-activity-page+list-item+action-list">
          <p><span data-uia="viewing-activity-page+list-item+description"><span class="e8zmz550">11/22/26</span><a data-uia="viewing-activity-page+list-item+description+title-link" href="https://www.netflix.com/title/81989718">The Body: "Slutty God"</a></span></p>
          <div role="group">
            <button data-uia="viewing-activity-page+list-item+report-problem-btn" aria-label="Report Problem"></button>
            <button data-uia="viewing-activity-page+list-item+hide-series-btn" aria-label="Hide Series"></button>
          </div>
        </div>
      </div>
      <div data-uia="viewing-activity-page+list-item">
        <span data-uia="viewing-activity-page+list-item+description"><span>11/21/26</span><a data-uia="viewing-activity-page+list-item+description+title-link" href="https://www.netflix.com/title/81749470">Guarding Stars</a></span>
      </div>
      <div data-uia="viewing-activity-page+list-item">
        <span data-uia="viewing-activity-page+list-item+description"><span>11/20/26</span><a data-uia="viewing-activity-page+list-item+description+title-link" href="https://www.netflix.com/title/81692417">Nobody Wants This: Season 1: "Pilot"</a></span>
      </div>
      <div data-uia="viewing-activity-page+list-item">
        <div data-uia="viewing-activity-page+list-item+action-list"><div><div><div data-uia="viewing-activity-page+list-item+action-list+label"></div><p><span data-uia="viewing-activity-page+list-item+description"><span class="e8zmz550">11/19/26</span><a data-uia="viewing-activity-page+list-item+description+title-link" href="https://www.netflix.com/title/81486332">Heartland</a></span></p></div></div></div>
      </div>
      <div data-uia="viewing-activity-page+show-more">
        <button type="button" data-uia="viewing-activity-page+show-more-btn" data-cl-command="ShowMoreCommand">Show More</button>
      </div>
    </section>
  </div>
`;

describe('live settings/viewed markup', () => {
  it('reads data-uia rows and ignores settings labels', () => {
    const dom = page(liveViewed, 'https://www.netflix.com/settings/viewed');
    const { items } = dom.window.MinaflixScrape.collectViewing(dom.window.document);
    expect(items.map((item) => item.title)).not.toContain('Audio and Subtitles');
    expect(items.map((item) => item.netflixId)).toEqual(['81989718', '81749470', '81692417', '81486332']);
    expect(items[0]).toMatchObject({ title: 'The Body: "Slutty God"', showTitle: null, watchedAt: '11/22/26' });
    expect(items[2]).toMatchObject({ title: 'Nobody Wants This: Season 1: "Pilot"', showTitle: 'Nobody Wants This' });
    expect(items[3]).toMatchObject({ title: 'Heartland', watchedAt: '11/19/26' });
  });

  it('waits for the first list item instead of exporting the settings label', async () => {
    const dom = page('<ul><li>Audio and Subtitles</li></ul>', 'https://www.netflix.com/settings/viewed');
    setTimeout(() => {
      dom.window.document.body.insertAdjacentHTML('beforeend', liveViewed);
    }, 30);
    const result = await dom.window.MinaflixScrape.expandAndCollect(dom.window.document, 'viewing', {
      delayMs: 0,
      settleMs: 40,
      initialWaitMs: 300,
      maxClicks: 1,
    });
    expect(result.items.some((item) => item.title === 'Audio and Subtitles')).toBe(false);
    expect(result.items.some((item) => item.netflixId === '81486332')).toBe(true);
  });

  it('clicks the live Show More button until it is gone', async () => {
    const dom = page(liveViewed, 'https://www.netflix.com/settings/viewed');
    const button = dom.window.document.querySelector('[data-uia="viewing-activity-page+show-more-btn"]');
    button.addEventListener('click', () => {
      const section = dom.window.document.querySelector('[data-uia="viewing-activity-page+container"]');
      section.insertAdjacentHTML('beforeend', `
        <div data-uia="viewing-activity-page+list-item">
          <span data-uia="viewing-activity-page+list-item+description"><span>11/1/26</span><a data-uia="viewing-activity-page+list-item+description+title-link" href="https://www.netflix.com/title/80000001">The Walking Dead: Season 1: "Days Gone Bye"</a></span>
        </div>
      `);
      button.remove();
    });
    const result = await dom.window.MinaflixScrape.expandAndCollect(dom.window.document, 'viewing', {
      delayMs: 0,
      settleMs: 40,
      initialWaitMs: 20,
      maxClicks: 5,
    });
    expect(result.clicks).toBe(1);
    expect(result.items.find((item) => item.netflixId === '80000001')).toMatchObject({ showTitle: 'The Walking Dead' });
  });

  it('treats an empty My List page as a successful empty export', () => {
    const dom = page('<h1>My List</h1><p>Your list is empty.</p>', 'https://www.netflix.com/browse/my-list');
    const result = dom.window.MinaflixScrape.collectMyList(dom.window.document);
    expect(result.error).toBeUndefined();
    expect(result.items).toEqual([]);
  });
});

const apiPayload = {
  jsonGraph: {
    videos: {
      81486332: {
        title: { $type: 'atom', value: 'Heartland' },
        synopsis: { value: 'Amy heals horses and the people around them.' },
        year: { value: 2007 },
        runtime: { value: 2700 },
        seasonCount: { value: 17 },
        maturity: { rating: { value: 'TV-14' } },
        boxarts: { _342x192: { jpg: { url: { value: 'https://occ-0-1.nflxso.net/boxart.jpg' } } } },
        storyarts: { _1632x873: { jpg: { url: { value: 'https://occ-0-1.nflxso.net/story.jpg' } } } },
        genres: { 0: { name: 'Drama' }, 1: { name: 'Family' } },
        cast: { 0: { name: 'Amber Marshall' } },
        creators: { 0: { name: 'Heather Conkie' } },
        directors: { 0: { name: 'Dean Bennett' } },
      },
    },
  },
};

const titlePage = `
  <html><head>
    <meta property="og:title" content="Heartland" />
    <meta property="og:description" content="A short social description." />
    <meta property="og:image" content="https://occ-0-1.nflxso.net/og-story.jpg" />
    <meta property="og:type" content="video.tv_show" />
    <script type="application/ld+json">
      {
        "@type": "TVSeries",
        "name": "Heartland",
        "description": "Amy heals horses and the people around them.",
        "datePublished": "2007-10-14",
        "contentRating": "TV-14",
        "numberOfSeasons": 17,
        "duration": "PT45M",
        "genre": ["Drama", "Family"],
        "actor": [{ "@type": "Person", "name": "Amber Marshall" }],
        "creator": [{ "@type": "Person", "name": "Heather Conkie" }],
        "director": [{ "@type": "Person", "name": "Dean Bennett" }],
        "image": "https://dnm.nflximg.net/api/v6/boxart/heartland.jpg"
      }
    </script>
  </head>
  <body>
    <img class="title-card boxart" src="https://dnm.nflximg.net/api/v6/boxart/fallback.jpg" alt="Heartland" />
  </body></html>
`;

describe('title metadata parsers', () => {
  it('reads a batched pathEvaluator payload', () => {
    const dom = page('', 'https://www.netflix.com/settings/viewed');
    const byId = dom.window.MinaflixScrape.metadataFromApiPayload(apiPayload);
    expect(byId['81486332']).toMatchObject({
      title: 'Heartland',
      synopsis: 'Amy heals horses and the people around them.',
      year: '2007',
      maturity: 'TV-14',
      runtimeMinutes: 45,
      seasons: 17,
      genres: ['Drama', 'Family'],
      cast: ['Amber Marshall'],
      creators: ['Heather Conkie'],
      directors: ['Dean Bennett'],
      mediaType: 'tv',
      image: 'https://occ-0-1.nflxso.net/boxart.jpg',
      backdrop: 'https://occ-0-1.nflxso.net/story.jpg',
      source: 'api',
    });
    expect(JSON.stringify(byId)).not.toContain('authURL');
  });

  it('prefers JSON-LD and og:image on a title page', () => {
    const dom = page('', 'https://www.netflix.com/title/81486332');
    const meta = dom.window.MinaflixScrape.metadataFromTitleHtml(titlePage);
    expect(meta).toMatchObject({
      title: 'Heartland',
      synopsis: 'Amy heals horses and the people around them.',
      year: '2007',
      maturity: 'TV-14',
      seasons: 17,
      runtimeMinutes: 45,
      genres: ['Drama', 'Family'],
      cast: ['Amber Marshall'],
      creators: ['Heather Conkie'],
      directors: ['Dean Bennett'],
      mediaType: 'tv',
      image: 'https://occ-0-1.nflxso.net/og-story.jpg',
      source: 'page',
    });
  });

  it('reads the member API locator without treating the auth token as title data', () => {
    const dom = page('', 'https://www.netflix.com/browse');
    const api = dom.window.MinaflixScrape.readMemberApi({
      models: {
        serverDefs: { data: { BUILD_IDENTIFIER: 'build42', API_ROOT: '/api/shakti' } },
        userInfo: { data: { authURL: 'secret-token' } },
      },
    });
    expect(api.buildId).toBe('build42');
    expect(dom.window.MinaflixScrape.memberApiUrl(api)).toBe('https://www.netflix.com/api/shakti/build42/pathEvaluator');
    const paths = JSON.stringify(dom.window.MinaflixScrape.metadataPaths(['81486332']));
    expect(paths).not.toMatch(/license|manifest|playback|drm/i);
  });
});

const liveBrowse = `
  <a data-uia="nav-series" href="/browse/genre/83"><span><span>
    <span data-uia="navigation-item-text">Shows</span><span aria-hidden="true">Shows</span>
  </span></span></a>
  <a data-uia="nav-movies" href="/browse/genre/34399"><span><span>
    <span data-uia="navigation-item-text">Movies</span><span aria-hidden="true">Movies</span>
  </span></span></a>
  <div class="carousel-row" aria-labelledby="row-heading" data-uia="carousel-row-section-2">
    <h2 id="row-heading">Put the Kids to Bed &amp; Binge</h2>
    <div data-uia="carousel-scroller">
      <button type="button" aria-label="See previous titles" tabindex="-1" data-uia="carousel-hawkins-left-button"></button>
      <div data-virtual-slot="0"></div>
      <div data-virtual-slot="8">
        <a href="/browse?jbv=80996601" aria-label="Love Is Blind" data-uia="standard-card">
          <div data-uia="card-image-focus-host">
            <img alt="" srcset="https://occ-0-2430-2433.1.nflxso.net/dnm/api/v6/example/love-2x.webp 2x" src="https://occ-0-2430-2433.1.nflxso.net/dnm/api/v6/example/love.webp">
          </div>
        </a>
      </div>
      <a href="/browse?jbv=81983578" aria-label="The Body" data-uia="progress-card">
        <img alt="" src="https://occ-0-2430-2433.1.nflxso.net/dnm/api/v6/example/body.webp">
      </a>
    </div>
  </div>
`;

describe('live browse carousel', () => {
  it('reads jbv cards, artwork, and a single genre label', () => {
    const dom = page('', 'https://www.netflix.com/browse');
    const parsed = dom.window.MinaflixScrape.rowsFromBrowseHtml(liveBrowse);
    expect(parsed.genres).toEqual([{ id: '83', name: 'Shows' }, { id: '34399', name: 'Movies' }]);
    expect(parsed.rows[0].name).toBe('Put the Kids to Bed & Binge');
    expect(parsed.rows[0].titles.map((item) => item.netflixId)).toEqual(['80996601', '81983578']);
    expect(parsed.rows[0].titles[0]).toMatchObject({
      title: 'Love Is Blind',
      image: 'https://occ-0-2430-2433.1.nflxso.net/dnm/api/v6/example/love-2x.webp',
    });
  });

  it('reads genre entities from the inline GraphQL cache', () => {
    const dom = page('', 'https://www.netflix.com/browse');
    const parsed = dom.window.MinaflixScrape.rowsFromGraphqlCache({
      data: {
        'Genre:{"genreId":83}': { unifiedEntityId: 'Collection:83', title: 'Shows', videoId: 80996601, name: 'Love Is Blind' },
        'Genre:{"genreId":34399}': { unifiedEntityId: 'Collection:34399', title: 'Movies' },
      },
    });
    expect(parsed.genres.map((genre) => genre.id)).toEqual(['83', '34399']);
    expect(parsed.genres[0].name).toBe('Shows');
    expect(parsed.rows[0].titles[0].netflixId).toBe('80996601');
  });
});

const previewModal = `
  <div class="previewModal" data-uia="previewModal--container" role="dialog">
    <h2>Heartland</h2>
    <div class="previewModal--detailsMetadata">
      <div class="previewModal--detailsMetadata-left">
        <span class="year">2007</span>
        <span class="maturity-rating">TV-14</span>
        <span class="duration">17 Seasons</span>
      </div>
    </div>
    <p class="preview-modal-synopsis" data-uia="preview-modal-synopsis">Amy heals horses and the people around them.</p>
    <section data-uia="previewModal--details-about">
      <div>Cast: Amber Marshall, Graham Wardle</div>
      <div>Genres: Drama, Family</div>
    </section>
    <img alt="" src="https://occ-0-1.nflxso.net/storyart/heartland.webp">
    <a href="/browse?jbv=81486332">Heartland</a>
  </div>
`;

describe('live title details', () => {
  it('reads synopsis and artwork from the GraphQL cache and falcor cache', () => {
    const dom = page('', 'https://www.netflix.com/browse');
    const api = dom.window.MinaflixScrape;
    const graphql = api.detailsFromGraphqlCache({
      data: {
        'Show:81486332': {
          __typename: 'Show',
          videoId: 81486332,
          title: 'Heartland',
          contextualSynopsis: { text: 'Amy heals horses and the people around them.' },
          latestYear: 2007,
          contentAdvisory: { certificationValue: 'TV-14' },
          seasons: { totalCount: 17 },
          genreTags: [{ name: 'Drama' }, { name: 'Family' }],
          cast: [{ name: 'Amber Marshall' }],
          creators: [{ name: 'Heather Conkie' }],
          storyArt: { url: 'https://occ-0-1.nflxso.net/storyart/heartland.webp' },
        },
      },
    }, ['81486332']);
    expect(graphql['81486332']).toMatchObject({
      title: 'Heartland',
      synopsis: 'Amy heals horses and the people around them.',
      year: '2007',
      maturity: 'TV-14',
      seasons: 17,
      genres: ['Drama', 'Family'],
      cast: ['Amber Marshall'],
      creators: ['Heather Conkie'],
      backdrop: 'https://occ-0-1.nflxso.net/storyart/heartland.webp',
      source: 'cache',
    });
    const falcor = api.detailsFromFalcorCache({
      videos: {
        81989718: {
          title: { value: 'The Body' },
          synopsis: { value: 'A body is found on the ice.' },
          year: { value: 2018 },
        },
      },
    }, ['81989718']);
    expect(falcor['81989718']).toMatchObject({ title: 'The Body', synopsis: 'A body is found on the ice.', year: '2018', source: 'cache' });
  });

  it('posts GraphQL detail results and ignores playback fields', async () => {
    const dom = page('DetailModal 76c01761-731d-48bd-8ce9-81c37e0bb3a3', 'https://www.netflix.com/browse');
    const api = dom.window.MinaflixScrape;
    const query = api.rawDetailQuery(['81486332']);
    expect(query).toContain('synopsis');
    expect(query).not.toMatch(/license|manifest|playback|drm|promoVideo/i);
    expect(JSON.stringify(api.detailModalBody('81486332', null))).not.toMatch(/authURL|license|manifest|playback|drm/i);
    const messages = [];
    dom.window.addEventListener('message', (event) => messages.push(event.data));
    dom.window.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.query) {
        return { ok: false, status: 400, text: async () => JSON.stringify({ errors: [{ message: 'PersistedQueryNotFound' }] }) };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            video: {
              __typename: 'Show',
              videoId: 81486332,
              title: 'Heartland',
              synopsis: 'Amy heals horses and the people around them.',
              latestYear: 2007,
              contentAdvisory: { certificationValue: 'TV-14' },
              seasons: { totalCount: 17 },
              genreTags: ['Drama', 'Family'],
              cast: [{ name: 'Amber Marshall' }],
              storyArt: { url: 'https://occ-0-1.nflxso.net/storyart/heartland.webp' },
            },
          },
        }),
      };
    };
    const result = await api.fetchGraphqlDetails(dom.window, ['81486332']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.path).toBe('graphql');
    expect(result.byId['81486332']).toMatchObject({
      synopsis: 'Amy heals horses and the people around them.',
      year: '2007',
      maturity: 'TV-14',
      seasons: 17,
      genres: ['Drama', 'Family'],
      source: 'graphql',
    });
    expect(messages.at(-1)).toMatchObject({ source: 'minaflix-sync', type: 'details', path: 'graphql' });
  });

  it('reads the open preview modal', () => {
    const dom = page(previewModal, 'https://www.netflix.com/browse?jbv=81486332');
    const api = dom.window.MinaflixScrape;
    const meta = api.metadataFromPreviewModal(dom.window.document);
    expect(meta).toMatchObject({
      title: 'Heartland',
      synopsis: 'Amy heals horses and the people around them.',
      year: '2007',
      maturity: 'TV-14',
      seasons: 17,
      cast: ['Amber Marshall', 'Graham Wardle'],
      genres: ['Drama', 'Family'],
      backdrop: 'https://occ-0-1.nflxso.net/storyart/heartland.webp',
      mediaType: 'tv',
      source: 'modal',
    });
    expect(api.openTitleModal('81486332')).toBe('click');
  });
});

describe('title page diagnosis', () => {
  it('explains a browse shell that has no metadata', () => {
    const dom = page('', 'https://www.netflix.com/browse');
    const result = dom.window.MinaflixScrape.diagnoseTitleHtml(
      '<html><body><div id="app"></div></body></html>',
      'https://www.netflix.com/browse?jbv=80996601',
    );
    expect(result.reason).toMatch(/SPA shell/);
    expect(result.meta).toBeUndefined();
  });
});

describe('catalog rows', () => {
  it('reads lolomo rows and video references', () => {
    const dom = page('', 'https://www.netflix.com/browse');
    const rows = dom.window.MinaflixScrape.rowsFromLolomo({
      jsonGraph: {
        lolomo: {
          0: {
            displayName: { value: 'Trending Now' },
            0: { reference: { value: ['videos', 81486332] }, summary: { value: { id: 81486332, title: 'Heartland' } } },
            1: { reference: { value: ['videos', 81749470] } },
          },
          1: {
            displayName: { value: 'Action' },
            0: { summary: { value: { id: 81989718, title: 'The Body' } } },
          },
        },
      },
    });
    expect(rows.map((row) => row.name)).toEqual(['Trending Now', 'Action']);
    expect(rows[0].titles.map((item) => item.netflixId)).toEqual(['81486332', '81749470']);
    expect(rows[0].titles[0].title).toBe('Heartland');
  });

  it('reads browse page rows and genre links without taking video', () => {
    const dom = page('', 'https://www.netflix.com/browse');
    const parsed = dom.window.MinaflixScrape.rowsFromBrowseHtml(`
      <section class="lolomoRow">
        <h2>Drama</h2>
        <a href="/title/81486332">Heartland</a>
        <a href="/watch/81749470">Guarding Stars</a>
      </section>
      <a href="/browse/genre/34399">Action</a>
    `);
    expect(parsed.rows[0].name).toBe('Drama');
    expect(parsed.rows[0].titles.map((item) => item.netflixId)).toEqual(['81486332', '81749470']);
    expect(parsed.genres).toEqual([{ id: '34399', name: 'Action' }]);
  });

  it('asks only for row names and title references', () => {
    const dom = page('', 'https://www.netflix.com/browse');
    const paths = JSON.stringify(dom.window.MinaflixScrape.catalogPaths(0, 5, 10));
    expect(paths).toContain('lolomo');
    expect(paths).not.toMatch(/license|manifest|playback|drm|video_tracks/i);
  });
});

describe('activity urls', () => {
  it('accepts the current page and the old one', () => {
    const { isActivityUrl } = page('', 'https://www.netflix.com/').window.MinaflixScrape;
    expect(isActivityUrl('https://www.netflix.com/settings/viewed')).toBe(true);
    expect(isActivityUrl('https://www.netflix.com/settings/viewed/')).toBe(true);
    expect(isActivityUrl('https://www.netflix.com/viewingactivity')).toBe(true);
    expect(isActivityUrl('https://www.netflix.com/browse/my-list')).toBe(false);
  });
});
