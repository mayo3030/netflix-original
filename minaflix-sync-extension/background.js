const MY_LIST_URL = 'https://www.netflix.com/browse/my-list';
const ACTIVITY_URL = 'https://www.netflix.com/viewingactivity';
const ACTIVITY_PATHS = ['/viewingactivity', '/settings/viewed', '/moviesyouveseen'];
const NAV_TIMEOUT_MS = 45000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pathOf(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, '').toLowerCase();
  } catch {
    return '';
  }
}

function isActivityUrl(url) {
  const path = pathOf(url);
  return ACTIVITY_PATHS.some((item) => path === item || path.startsWith(`${item}/`));
}

function isMyListUrl(url) {
  const path = pathOf(url);
  return path === '/browse/my-list' || path.startsWith('/browse/my-list/');
}

async function navigate(tabId, accept) {
  const started = Date.now();
  let lastUrl = '';
  while (Date.now() - started < NAV_TIMEOUT_MS) {
    const tab = await chrome.tabs.get(tabId);
    lastUrl = typeof tab.url === 'string' ? tab.url : lastUrl;
    const path = pathOf(lastUrl);
    if (tab.status === 'complete' && path.startsWith('/login')) {
      throw new Error('Sign in to Netflix in this browser, then export again.');
    }
    if (tab.status === 'complete' && accept(lastUrl)) return lastUrl;
    await sleep(400);
  }
  throw new Error(`Netflix took too long to load. Last page: ${lastUrl || 'unknown'}`);
}

async function openAndGo(url, accept) {
  const tabs = await chrome.tabs.query({ url: ['https://www.netflix.com/*', 'https://netflix.com/*'] });
  const current = tabs.find((tab) => typeof tab.id === 'number');
  const tabId = current && typeof current.id === 'number'
    ? current.id
    : (await chrome.tabs.create({ url, active: true })).id;
  if (typeof tabId !== 'number') throw new Error('Could not open Netflix.');
  await chrome.tabs.update(tabId, { url, active: true });
  const finalUrl = await navigate(tabId, accept);
  return { tabId, finalUrl };
}

async function callPage(tabId, kind) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['scrape.js'] });
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [kind],
    func: (section) => {
      const api = globalThis.MinaflixScrape;
      if (!api) return Promise.resolve({ error: 'The page reader did not load.', items: [] });
      const report = (count, clicks) => {
        const label = section === 'myList' ? 'My List' : 'Watched';
        const text = clicks > 0
          ? `${label}: ${count} titles so far, after ${clicks} Show More clicks.`
          : `${label}: waiting for titles… ${count} found so far.`;
        try {
          chrome.runtime.sendMessage({ type: 'minaflix-progress', text });
        } catch {
          // The popup may have closed.
        }
      };
      return api.expandAndCollect(document, section, {
        delayMs: 900,
        settleMs: 2500,
        initialWaitMs: section === 'myList' ? 4000 : 20000,
        maxClicks: section === 'myList' ? 20 : 80,
        onProgress: report,
      });
    },
  });
  return result?.result || { error: 'Netflix returned no result.', items: [] };
}

let activePort = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'minaflix-progress' && typeof message.text === 'string' && activePort) {
    activePort.postMessage({ type: 'progress', text: message.text });
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'minaflix-export') return;
  activePort = port;
  let active = true;
  port.onDisconnect.addListener(() => {
    active = false;
    if (activePort === port) activePort = null;
  });
  port.onMessage.addListener((message) => {
    if (message?.type === 'start') void exportAccount(port, () => active);
  });
});

async function exportAccount(port, isActive) {
  const send = (payload) => {
    if (isActive()) port.postMessage(payload);
  };
  const errors = [];
  let myList = [];
  let viewingActivity = [];
  let myListOk = false;
  let watchedOk = false;

  try {
    send({ type: 'progress', text: 'Opening your My List…' });
    const opened = await openAndGo(MY_LIST_URL, isMyListUrl);
    if (!isActive()) return;
    send({ type: 'progress', text: `My List page loaded (${opened.finalUrl}). Reading titles…` });
    const listResult = await callPage(opened.tabId, 'myList');
    if (listResult?.error) throw new Error(listResult.error);
    myList = listResult?.items ?? [];
    myListOk = true;
    send({ type: 'progress', text: `My List: ${myList.length} titles.` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'My List export failed.';
    errors.push({ section: 'myList', message });
    send({ type: 'progress', text: `My List failed: ${message} Continuing with watched titles.` });
  }

  if (!isActive()) return;

  try {
    send({ type: 'progress', text: 'Opening viewing activity…' });
    const opened = await openAndGo(ACTIVITY_URL, isActivityUrl);
    if (!isActive()) return;
    send({ type: 'progress', text: `Watched page loaded (${opened.finalUrl}). Reading titles…` });
    const activityResult = await callPage(opened.tabId, 'viewing');
    if (activityResult?.error) throw new Error(activityResult.error);
    viewingActivity = activityResult?.items ?? [];
    watchedOk = true;
    send({ type: 'progress', text: `Watched: ${viewingActivity.length} titles.` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Viewing activity export failed.';
    errors.push({ section: 'viewingActivity', message });
    send({ type: 'progress', text: `Watched failed: ${message}` });
  }

  if (!isActive()) return;

  if (!myListOk && !watchedOk) {
    send({ type: 'error', text: errors.map((item) => item.message).join(' ') });
    return;
  }

  const payload = {
    version: 1,
    source: 'netflix-dom',
    exportedAt: new Date().toISOString(),
    myList,
    viewingActivity,
    errors,
  };
  try {
    await chrome.downloads.download({
      url: `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(payload, null, 2))}`,
      filename: 'minaflix-netflix-export.json',
      saveAs: true,
      conflictAction: 'uniquify',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The download was cancelled.';
    send({ type: 'error', text: `Collected ${myList.length} My List and ${viewingActivity.length} watched titles, but the file was not saved. ${message}` });
    return;
  }

  const summary = `Exported ${viewingActivity.length} watched, ${myList.length} My List`;
  const problem = errors.length ? `\n${errors.map((item) => item.message).join(' ')}` : '';
  send({ type: 'done', text: `${summary}${problem}` });
}
