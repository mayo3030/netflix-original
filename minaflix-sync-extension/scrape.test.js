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
      { title: 'Tears of Steel', netflixId: '70248183', watchedAt: '11/2/24' },
      { title: 'Sintel', netflixId: '80000001', watchedAt: '1/5/24' },
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

describe('activity urls', () => {
  it('accepts the current page and the old one', () => {
    const { isActivityUrl } = page('', 'https://www.netflix.com/').window.MinaflixScrape;
    expect(isActivityUrl('https://www.netflix.com/settings/viewed')).toBe(true);
    expect(isActivityUrl('https://www.netflix.com/settings/viewed/')).toBe(true);
    expect(isActivityUrl('https://www.netflix.com/viewingactivity')).toBe(true);
    expect(isActivityUrl('https://www.netflix.com/browse/my-list')).toBe(false);
  });
});
