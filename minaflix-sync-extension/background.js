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

async function loadTitleDetails(tabId, ids, send, isActive) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['scrape.js'], world: 'MAIN' });
  const byId = {};
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [ids],
      func: (wanted) => globalThis.MinaflixScrape.fetchMemberMetadata(globalThis, wanted),
    });
    Object.assign(byId, result?.result || {});
  } catch {
    // The member API shape changes. Title pages cover whatever this call missed.
  }
  const missing = ids.filter((id) => !byId[id]);
  for (let index = 0; index < missing.length; index += 1) {
    if (!isActive()) return byId;
    const id = missing[index];
    send({ type: 'progress', text: `Title page ${index + 1} of ${missing.length}…` });
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        args: [id],
        func: (titleId) => globalThis.MinaflixScrape.fetchPageMetadata(titleId),
      });
      if (result?.result) byId[id] = result.result;
    } catch {
      // One title page can fail without dropping the rest of the export.
    }
    await sleep(450);
  }
  return byId;
}

function applyTitleDetails(items, byId) {
  return items.map((item) => {
    const meta = item.netflixId ? byId[item.netflixId] : null;
    if (!meta) return item;
    return {
      ...item,
      synopsis: meta.synopsis || null,
      year: meta.year || null,
      maturity: meta.maturity || null,
      runtimeMinutes: meta.runtimeMinutes ?? null,
      seasons: meta.seasons ?? null,
      genres: meta.genres || [],
      cast: meta.cast || [],
      creators: meta.creators || [],
      directors: meta.directors || [],
      mediaType: meta.mediaType || null,
      image: meta.image || null,
      backdrop: meta.backdrop || null,
      source: meta.source,
    };
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'minaflix-export') return;
  activePort = port;
  let active = true;
  port.onDisconnect.addListener(() => {
    active = false;
    if (activePort === port) activePort = null;
  });
  port.onMessage.addListener((message) => {
    if (message?.type !== 'start') return;
    const run = message.mode === 'catalog' ? syncCatalog : exportAccount;
    void run(port, () => active);
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
  let tabId = null;

  try {
    send({ type: 'progress', text: 'Opening your My List…' });
    const opened = await openAndGo(MY_LIST_URL, isMyListUrl);
    tabId = opened.tabId;
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
    tabId = opened.tabId;
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

  const detailTab = typeof tabId === 'number' ? tabId : null;
  const detailIds = [...new Set([...myList, ...viewingActivity].map((item) => item.netflixId).filter((id) => /^\d{1,12}$/.test(String(id || ''))))];
  if (detailTab && detailIds.length > 0) {
    try {
      send({ type: 'progress', text: `Fetching details for ${detailIds.length} titles…` });
      const byId = await loadTitleDetails(detailTab, detailIds, send, isActive);
      myList = applyTitleDetails(myList, byId);
      viewingActivity = applyTitleDetails(viewingActivity, byId);
      const fromApi = Object.values(byId).filter((item) => item?.source === 'api').length;
      const fromPage = Object.values(byId).filter((item) => item?.source === 'page').length;
      send({ type: 'progress', text: `Details: ${fromApi} from Netflix, ${fromPage} from title pages.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Title details were skipped.';
      errors.push({ section: 'details', message });
      send({ type: 'progress', text: `Title details skipped: ${message}` });
    }
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

const CATALOG_JOB = 'minaflix.catalog.job.v1';

async function readCatalogJob() {
  const stored = await chrome.storage.local.get(CATALOG_JOB);
  return stored[CATALOG_JOB] || null;
}

async function writeCatalogJob(job) {
  await chrome.storage.local.set({ [CATALOG_JOB]: { ...job, updatedAt: new Date().toISOString() } });
}

async function pageCall(tabId, payload) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['scrape.js'], world: 'MAIN' });
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [payload],
    func: async (request) => {
      const api = globalThis.MinaflixScrape;
      if (!api) return null;
      if (request.op === 'live') return api.collectLiveBrowse();
      if (request.op === 'lolomo') {
        const ctx = api.readMemberApi(globalThis.netflix?.reactContext || globalThis.netflix?.appContext);
        if (!ctx) return { rows: [] };
        const response = await fetch(api.memberApiUrl(ctx), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ paths: api.catalogPaths(request.from, request.to, 30), authURL: ctx.authURL }),
        });
        if (!response.ok) return { rows: [] };
        return { rows: api.rowsFromLolomo(await response.json()) };
      }
      if (request.op === 'html') {
        const response = await fetch(request.url, { credentials: 'same-origin' });
        if (!response.ok) return { rows: [], genres: [] };
        return api.rowsFromBrowseHtml(await response.text());
      }
      if (request.op === 'details') return api.fetchMemberMetadata(globalThis, request.ids);
      return null;
    },
  });
  return result?.result;
}

function catalogTitle(item, meta) {
  return {
    title: meta?.title || item.title || `Title ${item.netflixId}`,
    showTitle: null,
    netflixId: item.netflixId,
    watchedAt: null,
    synopsis: meta?.synopsis || null,
    year: meta?.year || null,
    maturity: meta?.maturity || null,
    runtimeMinutes: meta?.runtimeMinutes ?? null,
    seasons: meta?.seasons ?? null,
    genres: meta?.genres || [],
    cast: meta?.cast || [],
    creators: meta?.creators || [],
    directors: meta?.directors || [],
    mediaType: meta?.mediaType || null,
    image: meta?.image || null,
    backdrop: meta?.backdrop || null,
    source: meta?.source || null,
  };
}

async function downloadCatalog(rows) {
  const files = [];
  let current = [];
  let size = 0;
  for (const row of rows) {
    const encoded = JSON.stringify(row);
    if (current.length && size + encoded.length > 1200000) {
      files.push(current);
      current = [];
      size = 0;
    }
    current.push(row);
    size += encoded.length;
  }
  if (current.length) files.push(current);
  for (let index = 0; index < files.length; index += 1) {
    const payload = {
      version: 1,
      kind: 'catalog',
      source: 'netflix-dom',
      part: index + 1,
      parts: files.length,
      exportedAt: new Date().toISOString(),
      rows: files[index],
    };
    const filename = files.length === 1
      ? 'minaflix-netflix-catalog.json'
      : `minaflix-netflix-catalog-${index + 1}.json`;
    await chrome.downloads.download({
      url: `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(payload))}`,
      filename,
      saveAs: index === 0,
      conflictAction: 'uniquify',
    });
  }
  return files.length;
}

async function syncCatalog(port, isActive) {
  const send = (payload) => {
    if (isActive()) port.postMessage(payload);
  };
  try {
    send({ type: 'progress', text: 'Opening Netflix browse…' });
    const opened = await openAndGo('https://www.netflix.com/browse', (url) => {
      try { return new URL(url).pathname.startsWith('/browse'); } catch { return false; }
    });
    if (!isActive()) return;
    let job = await readCatalogJob();
    if (!job?.rows?.length) {
      send({ type: 'progress', text: 'Reading home rows…' });
      let rows = [];
      let genres = [];
      try {
        const live = await pageCall(opened.tabId, { op: 'live' });
        rows = live?.rows || [];
        genres = live?.genres || [];
      } catch {
        rows = [];
      }
      if (!rows.length) {
        try {
          const lolomo = await pageCall(opened.tabId, { op: 'lolomo', from: 0, to: 25 });
          rows = lolomo?.rows || [];
        } catch {
          rows = [];
        }
      }
      if (!rows.length) {
        send({ type: 'progress', text: 'Reading genre pages…' });
        for (const genre of genres.slice(0, 12)) {
          if (!isActive()) return;
          await sleep(1000);
          send({ type: 'progress', text: `Reading genre ${genre.name}…` });
          const page = await pageCall(opened.tabId, { op: 'html', url: `https://www.netflix.com/browse/genre/${genre.id}` });
          const titles = page?.rows?.flatMap((row) => row.titles) || [];
          if (titles.length) rows.push({ name: genre.name, titles });
        }
      }
      const pending = [...new Set(rows.flatMap((row) => row.titles.map((item) => item.netflixId)))];
      job = { rows, details: {}, pending };
      await writeCatalogJob(job);
    } else {
      send({ type: 'progress', text: `Resuming catalog sync. ${job.pending.length} titles left.` });
    }
    while (job.pending.length && isActive()) {
      const batch = job.pending.slice(0, 30);
      send({ type: 'progress', text: `Details ${Object.keys(job.details).length} done, ${job.pending.length} left…` });
      let found = {};
      try {
        found = await pageCall(opened.tabId, { op: 'details', ids: batch }) || {};
      } catch {
        found = {};
      }
      const still = [];
      for (const id of batch) {
        if (found[id]) job.details[id] = found[id];
        else still.push(id);
      }
      for (const id of still) {
        if (!isActive()) return;
        await sleep(1000);
        try {
          const [result] = await chrome.scripting.executeScript({
            target: { tabId: opened.tabId },
            world: 'MAIN',
            args: [id],
            func: (titleId) => globalThis.MinaflixScrape.fetchPageMetadata(titleId),
          });
          if (result?.result) job.details[id] = result.result;
        } catch {
          // Leave this title as a name-only card.
        }
      }
      job.pending = job.pending.slice(batch.length);
      await writeCatalogJob(job);
      if (job.pending.length) await sleep(1000);
    }
    if (!isActive()) {
      send({ type: 'progress', text: 'Paused. Open the extension again to resume.' });
      return;
    }
    const rows = job.rows.map((row) => ({
      name: row.name,
      titles: row.titles.map((item) => catalogTitle(item, job.details[item.netflixId])),
    })).filter((row) => row.titles.length);
    const parts = await downloadCatalog(rows);
    await chrome.storage.local.remove(CATALOG_JOB);
    const count = rows.reduce((sum, row) => sum + row.titles.length, 0);
    send({ type: 'done', text: `Exported ${count} catalog titles in ${rows.length} rows${parts > 1 ? ` (${parts} files)` : ''}.` });
  } catch (error) {
    send({ type: 'error', text: error instanceof Error ? error.message : 'Catalog sync failed. Open the extension again to resume.' });
  }
}
