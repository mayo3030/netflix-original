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

describe('activity urls', () => {
  it('accepts the current page and the old one', () => {
    const { isActivityUrl } = page('', 'https://www.netflix.com/').window.MinaflixScrape;
    expect(isActivityUrl('https://www.netflix.com/settings/viewed')).toBe(true);
    expect(isActivityUrl('https://www.netflix.com/settings/viewed/')).toBe(true);
    expect(isActivityUrl('https://www.netflix.com/viewingactivity')).toBe(true);
    expect(isActivityUrl('https://www.netflix.com/browse/my-list')).toBe(false);
  });
});
