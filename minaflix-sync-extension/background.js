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
      const page = result?.result;
      if (page?.meta) byId[id] = page.meta;
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
    void run(port, () => active, message);
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
      if (request.op === 'caches') return api.readLiveCaches(globalThis, request.ids);
      if (request.op === 'graphql') return api.fetchGraphqlDetails(globalThis, request.ids);
      if (request.op === 'modal') return api.readLiveModal(request.id);
      if (request.op === 'modal-read') return api.readOpenModal(request.id);
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
    image: item.image || meta?.image || null,
    backdrop: meta?.backdrop || null,
    source: meta?.source || null,
  };
}

async function downloadCatalog(rows, summary, errors) {
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
      summary: summary || '',
      errors: errors || [],
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

function parseCap(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.min(5000, Math.floor(number));
}

function prepareJob(job, message) {
  job.details = job.details || {};
  job.pending = Array.isArray(job.pending) ? job.pending : [];
  job.forModal = Array.isArray(job.forModal) ? job.forModal : [];
  job.paths = {
    cache: job.paths?.cache || 0,
    api: job.paths?.api || 0,
    graphql: job.paths?.graphql || 0,
    modal: job.paths?.modal || 0,
  };
  job.errors = Array.isArray(job.errors) ? job.errors : [];
  job.detailAttempts = job.detailAttempts || 0;
  job.detailCap = parseCap(message?.detailCap);
  job.graphqlStopped = Boolean(job.graphqlStopped);
  return job;
}

function rememberDetail(job, id, meta) {
  if (!id || !meta || job.details[id]) return;
  job.details[id] = meta;
  const path = meta.source === 'api' || meta.source === 'graphql' || meta.source === 'modal' || meta.source === 'cache' ? meta.source : 'cache';
  job.paths[path] += 1;
}

function pathSummary(job) {
  const paths = job.paths || {};
  return `cache ${paths.cache || 0}, api ${paths.api || 0}, graphql ${paths.graphql || 0}, modal ${paths.modal || 0}`;
}

function takePending(job, count) {
  if (typeof job.detailCap === 'number' && job.detailAttempts >= job.detailCap) return [];
  const room = typeof job.detailCap === 'number' ? job.detailCap - job.detailAttempts : count;
  const ids = job.pending.splice(0, Math.min(count, Math.max(0, room)));
  job.detailAttempts += ids.length;
  return ids;
}

function restorePending(job, ids) {
  if (!ids.length) return;
  job.pending = [...ids, ...job.pending];
  job.detailAttempts = Math.max(0, job.detailAttempts - ids.length);
}

async function applyCachedDetails(tabId, job, send) {
  const result = await pageCall(tabId, { op: 'caches', ids: job.pending });
  const byId = result?.byId || {};
  let added = 0;
  job.pending = job.pending.filter((id) => {
    if (job.details[id]) return false;
    if (!byId[id]) return true;
    const before = job.paths.cache;
    rememberDetail(job, id, byId[id]);
    if (job.paths.cache > before) added += 1;
    return false;
  });
  if (added) send({ type: 'progress', text: `Details via cache: ${added}. ${job.pending.length} left.` });
}

async function applyApiDetails(tabId, job, send) {
  if (!job.pending.length) return;
  const ids = job.pending.slice(0, 40);
  let found = {};
  try {
    found = await pageCall(tabId, { op: 'details', ids }) || {};
  } catch (error) {
    job.errors.push({ section: 'details', path: 'api', message: error instanceof Error ? error.message : 'member API request failed' });
    send({ type: 'progress', text: 'Member API request failed. Trying the live GraphQL client.' });
    return;
  }
  let added = 0;
  job.pending = job.pending.filter((id) => {
    if (!found[id]) return true;
    const before = job.paths.api;
    rememberDetail(job, id, found[id]);
    if (job.paths.api > before) added += 1;
    return false;
  });
  send({ type: 'progress', text: added ? `Details via member API: ${added}.` : 'Member API had no title details.' });
}

async function applyGraphqlDetails(tabId, job, send, isActive) {
  if (job.graphqlStopped) return;
  while (isActive() && job.pending.length) {
    const ids = takePending(job, 20);
    if (!ids.length) return;
    send({ type: 'progress', text: `GraphQL details for ${ids.length} titles…` });
    let result = null;
    try {
      result = await pageCall(tabId, { op: 'graphql', ids });
    } catch (error) {
      result = { byId: {}, error: error instanceof Error ? error.message : 'graphql request failed' };
    }
    const byId = result?.byId || {};
    const missed = [];
    for (const id of ids) {
      if (byId[id]) rememberDetail(job, id, byId[id]);
      else missed.push(id);
    }
    if (!Object.keys(byId).length) {
      restorePending(job, missed);
      job.graphqlStopped = true;
      const message = result?.error || 'graphql returned no details';
      job.errors.push({ section: 'details', path: 'graphql', message });
      send({ type: 'progress', text: `GraphQL failed: ${message} Opening the live detail modal instead.` });
      return;
    }
    job.forModal.push(...missed);
    send({ type: 'progress', text: `Details via graphql: ${job.paths.graphql}. ${job.pending.length + job.forModal.length} left.` });
    await writeCatalogJob(job);
    if (job.pending.length) await sleep(1000);
  }
}

async function readModalDetail(tabId, id) {
  let result = null;
  try {
    result = await pageCall(tabId, { op: 'modal', id });
  } catch (error) {
    result = { error: error instanceof Error ? error.message : 'modal reader failed' };
  }
  if (result?.meta) return result;
  try {
    await chrome.tabs.update(tabId, { url: `https://www.netflix.com/browse?jbv=${id}`, active: true });
    await navigate(tabId, (url) => String(url).includes(`jbv=${id}`) || String(url).includes('/browse'));
    await sleep(800);
    const opened = await pageCall(tabId, { op: 'modal-read', id });
    return opened?.meta ? opened : { error: opened?.error || result?.error || 'preview modal was not readable after navigation' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'modal navigation failed' };
  }
}

async function applyModalDetails(tabId, job, send, isActive) {
  let streak = 0;
  while (isActive()) {
    const fromGraphqlMiss = job.forModal.length > 0;
    if (!fromGraphqlMiss && typeof job.detailCap === 'number' && job.detailAttempts >= job.detailCap) {
      if (job.pending.length) send({ type: 'progress', text: `Detail limit ${job.detailCap} reached. Remaining titles keep their card images.` });
      job.pending = [];
      break;
    }
    const list = fromGraphqlMiss ? job.forModal : job.pending;
    if (!list.length) break;
    const id = list.shift();
    if (!fromGraphqlMiss) job.detailAttempts += 1;
    send({ type: 'progress', text: `Modal for ${id}. ${pathSummary(job)}. ${list.length} left.` });
    const result = await readModalDetail(tabId, id);
    if (result?.meta) {
      rememberDetail(job, id, result.meta);
      streak = 0;
      send({ type: 'progress', text: `Details via modal (${result.via || 'live'}): ${result.meta.title || id}.` });
    } else {
      streak += 1;
      const message = result?.error || 'preview modal had no details';
      job.errors.push({ section: 'details', id, path: 'modal', message });
      send({ type: 'progress', text: `Modal ${id}: ${message}` });
      if (streak >= 2 && !job.paths.modal) {
        const stop = 'Stopped modal lookups after 2 titles opened no details. Card images stay in the export.';
        job.errors.push({ section: 'details', path: 'modal', message: stop });
        send({ type: 'progress', text: stop });
        job.pending = [];
        job.forModal = [];
        break;
      }
    }
    await writeCatalogJob(job);
    if (job.pending.length || job.forModal.length) await sleep(1500);
  }
}

async function syncCatalog(port, isActive, message) {
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
      job = prepareJob({ rows, details: {}, pending }, message);
      await writeCatalogJob(job);
    } else {
      job = prepareJob(job, message);
      send({ type: 'progress', text: `Resuming catalog sync. ${job.pending.length + job.forModal.length} titles left.` });
    }
    if (isActive()) {
      try {
        await applyCachedDetails(opened.tabId, job, send);
      } catch (error) {
        job.errors.push({ section: 'details', path: 'cache', message: error instanceof Error ? error.message : 'cache read failed' });
      }
      if (job.detailCap !== 0) {
        await applyApiDetails(opened.tabId, job, send);
        if (isActive()) await applyGraphqlDetails(opened.tabId, job, send, isActive);
        if (isActive()) await applyModalDetails(opened.tabId, job, send, isActive);
      } else {
        send({ type: 'progress', text: 'Detail limit 0. Saving card images without more lookups.' });
      }
      await writeCatalogJob(job);
    }
    if (!isActive()) {
      send({ type: 'progress', text: 'Paused. Open the extension again to resume.' });
      return;
    }
    const rows = job.rows.map((row) => ({
      name: row.name,
      titles: row.titles.map((item) => catalogTitle(item, job.details[item.netflixId])),
    })).filter((row) => row.titles.length);
    const count = rows.reduce((sum, row) => sum + row.titles.length, 0);
    const images = rows.reduce((sum, row) => sum + row.titles.filter((item) => item.image).length, 0);
    const detailed = Object.keys(job.details).length;
    const failure = detailed === 0 ? (job.errors || []).find((item) => item.message) : null;
    const summary = `Exported ${count} catalog titles in ${rows.length} rows. Images ${images}. Details ${detailed} (${pathSummary(job)}).${failure ? ` ${failure.message}` : ''}`;
    send({ type: 'summary', text: summary });
    await sleep(400);
    const parts = await downloadCatalog(rows, summary, job.errors || []);
    await chrome.storage.local.remove(CATALOG_JOB);
    send({ type: 'done', text: summary });
  } catch (error) {
    send({ type: 'error', text: error instanceof Error ? error.message : 'Catalog sync failed. Open the extension again to resume.' });
  }
}
