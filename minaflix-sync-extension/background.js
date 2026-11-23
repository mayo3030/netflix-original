const MY_LIST_URL = 'https://www.netflix.com/browse/my-list';
const ACTIVITY_URL = 'https://www.netflix.com/viewingactivity';
const RENDER_DELAY_MS = 1200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function navigate(tabId, url) {
  await chrome.tabs.update(tabId, { url, active: true });
  const started = Date.now();
  while (Date.now() - started < 25000) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete' && typeof tab.url === 'string' && tab.url.startsWith(url)) return;
    await sleep(300);
  }
  throw new Error('Netflix took too long to load.');
}

async function netflixTab() {
  const tabs = await chrome.tabs.query({ url: ['https://www.netflix.com/*', 'https://netflix.com/*'] });
  const current = tabs.find((tab) => typeof tab.id === 'number');
  if (current && typeof current.id === 'number') return current.id;
  const created = await chrome.tabs.create({ url: MY_LIST_URL, active: true });
  if (typeof created.id !== 'number') throw new Error('Could not open Netflix.');
  return created.id;
}

async function scrapeMyListPage() {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const idFrom = (href) => {
    const match = /\/(?:title|watch)\/(\d{1,12})/.exec(href || '');
    return match ? match[1] : null;
  };
  const clean = (value) => (value || '').replace(/\s+/g, ' ').replace(/^(play|watch|resume)\s+/i, '').trim().slice(0, 180);
  const nameOf = (anchor) => {
    const label = clean(anchor.getAttribute('aria-label'));
    if (label) return label;
    const image = anchor.querySelector('img');
    const alt = image ? clean(image.getAttribute('alt')) : '';
    if (alt) return alt;
    return clean(anchor.textContent);
  };
  if (location.pathname.startsWith('/login') || document.querySelector('input[type="password"]')) {
    return { error: 'Sign in to Netflix in this browser, then export again.' };
  }
  let previous = -1;
  for (let step = 0; step < 8; step += 1) {
    const count = document.querySelectorAll('a[href*="/title/"], a[href*="/watch/"]').length;
    if (count > 0 && count === previous) break;
    previous = count;
    window.scrollTo(0, document.body.scrollHeight);
    await pause(800);
  }
  const items = [];
  const seen = new Set();
  for (const anchor of document.querySelectorAll('a[href*="/title/"], a[href*="/watch/"]')) {
    const netflixId = idFrom(anchor.getAttribute('href'));
    const title = nameOf(anchor);
    if (!netflixId || !title || seen.has(netflixId)) continue;
    seen.add(netflixId);
    items.push({ title, netflixId });
    if (items.length >= 400) break;
  }
  return { items };
}

async function scrapeViewingPage() {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const moreLabel = /^(show more|see more|load more|mostrar más|afficher plus|mehr anzeigen|عرض المزيد)$/i;
  const idFrom = (href) => {
    const match = /\/(?:title|watch)\/(\d{1,12})/.exec(href || '');
    return match ? match[1] : null;
  };
  const clean = (value) => (value || '').replace(/\s+/g, ' ').replace(/^(play|watch|resume)\s+/i, '').trim().slice(0, 180);
  const nameOf = (anchor) => {
    const label = clean(anchor.getAttribute('aria-label'));
    if (label) return label;
    const image = anchor.querySelector('img');
    const alt = image ? clean(image.getAttribute('alt')) : '';
    if (alt) return alt;
    return clean(anchor.textContent);
  };
  const dateIn = (text) => {
    const iso = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
    if (iso) return iso[0];
    const slash = text.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/);
    if (slash) return slash[0];
    const month = text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4}\b/i);
    return month ? month[0] : null;
  };
  if (location.pathname.startsWith('/login') || document.querySelector('input[type="password"]')) {
    return { error: 'Sign in to Netflix in this browser, then export again.' };
  }
  let stagnant = 0;
  for (let step = 0; step < 15; step += 1) {
    const before = document.querySelectorAll('a[href*="/title/"], a[href*="/watch/"]').length;
    const button = [...document.querySelectorAll('button')].find((candidate) => moreLabel.test((candidate.textContent || '').trim()));
    if (!button) break;
    button.scrollIntoView({ block: 'center' });
    button.click();
    await pause(1100);
    const after = document.querySelectorAll('a[href*="/title/"], a[href*="/watch/"]').length;
    if (after <= before) {
      stagnant += 1;
      if (stagnant >= 2) break;
    } else {
      stagnant = 0;
    }
  }
  const items = [];
  const seen = new Set();
  for (const anchor of document.querySelectorAll('a[href*="/title/"], a[href*="/watch/"]')) {
    const netflixId = idFrom(anchor.getAttribute('href'));
    const title = nameOf(anchor);
    if (!title) continue;
    const row = anchor.closest('li, tr, .retableRow');
    const scope = row && row.querySelectorAll('a[href*="/title/"], a[href*="/watch/"]').length <= 3
      ? row
      : anchor.parentElement;
    const watchedAt = scope ? dateIn(scope.textContent || '') : null;
    const key = `${netflixId || title}|${watchedAt || items.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ title, netflixId, watchedAt });
    if (items.length >= 500) break;
  }
  if (items.length === 0) {
    for (const row of document.querySelectorAll('li, tr, .retableRow')) {
      const text = row.innerText || '';
      if (text.length > 300) continue;
      const watchedAt = dateIn(text);
      const title = text.split('\n').map((line) => clean(line)).find((line) => line && line !== watchedAt);
      if (!title || !watchedAt) continue;
      const key = `${title}|${watchedAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ title, netflixId: null, watchedAt });
      if (items.length >= 500) break;
    }
  }
  return { items };
}

async function runInPage(tabId, func) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func });
  return result?.result;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'minaflix-export') return;
  let active = true;
  port.onDisconnect.addListener(() => {
    active = false;
  });
  port.onMessage.addListener((message) => {
    if (message?.type === 'start') void exportAccount(port, () => active);
  });
});

async function exportAccount(port, isActive) {
  const send = (payload) => {
    if (isActive()) port.postMessage(payload);
  };
  try {
    send({ type: 'progress', text: 'Opening your My List…' });
    const tabId = await netflixTab();
    await navigate(tabId, MY_LIST_URL);
    await sleep(RENDER_DELAY_MS);
    if (!isActive()) return;
    send({ type: 'progress', text: 'Reading My List…' });
    const listResult = await runInPage(tabId, scrapeMyListPage);
    if (listResult?.error) {
      send({ type: 'error', text: listResult.error });
      return;
    }
    if (!isActive()) return;
    send({ type: 'progress', text: 'Opening viewing activity…' });
    await navigate(tabId, ACTIVITY_URL);
    await sleep(RENDER_DELAY_MS);
    if (!isActive()) return;
    send({ type: 'progress', text: 'Reading viewing activity…' });
    const activityResult = await runInPage(tabId, scrapeViewingPage);
    if (activityResult?.error) {
      send({ type: 'error', text: activityResult.error });
      return;
    }
    const payload = {
      version: 1,
      source: 'netflix-dom',
      exportedAt: new Date().toISOString(),
      myList: listResult?.items ?? [],
      viewingActivity: activityResult?.items ?? [],
    };
    await chrome.downloads.download({
      url: `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(payload, null, 2))}`,
      filename: 'minaflix-netflix-export.json',
      saveAs: true,
      conflictAction: 'uniquify',
    });
    send({
      type: 'done',
      text: `Saved ${payload.myList.length} My List titles and ${payload.viewingActivity.length} viewing rows.`,
    });
  } catch (error) {
    send({ type: 'error', text: error instanceof Error ? error.message : 'Export failed.' });
  }
}
