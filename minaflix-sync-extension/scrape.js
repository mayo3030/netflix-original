(function attachMinaflixScrape(root) {
  const ACTIVITY_PATHS = ['/viewingactivity', '/settings/viewed', '/moviesyouveseen'];
  const TITLE_LINK = /\/(?:title|watch)\/(\d{1,12})(?:[/?#]|$)/;
  const MORE_TEXT = /^(show\s*more|see\s*more|load\s*more|mostrar\s*m[aá]s|afficher\s*plus|mehr\s*anzeigen|عرض\s*المزيد)$/i;
  const MORE_UIA = /show-?more|load-?more|see-?more|more-button/i;

  function clean(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/^(play|watch|resume|continue watching)\s+/i, '')
      .trim()
      .slice(0, 180);
  }

  function netflixIdFromHref(href) {
    const match = TITLE_LINK.exec(String(href || ''));
    return match ? match[1] : null;
  }

  function isActivityUrl(url) {
    try {
      const path = new URL(url).pathname.replace(/\/+$/, '').toLowerCase();
      return ACTIVITY_PATHS.some((item) => path === item || path.startsWith(`${item}/`));
    } catch {
      return false;
    }
  }

  function isSignedOut(doc) {
    const path = doc.location?.pathname || '';
    if (path.startsWith('/login')) return true;
    return Boolean(doc.querySelector('[data-uia*="login"] input[type="password"], form[action*="login"] input[type="password"]'));
  }

  function titleFromAnchor(anchor) {
    const labelled = clean(anchor.getAttribute('aria-label'));
    if (labelled) return labelled;
    const titled = clean(anchor.getAttribute('data-title') || anchor.getAttribute('data-videoname'));
    if (titled) return titled;
    const image = anchor.querySelector('img');
    const alt = image ? clean(image.getAttribute('alt') || image.getAttribute('aria-label')) : '';
    if (alt) return alt;
    return clean(anchor.textContent);
  }

  function dateFromText(text) {
    const source = String(text || '');
    const iso = source.match(/\b\d{4}-\d{2}-\d{2}\b/);
    if (iso) return iso[0];
    const slash = source.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/);
    if (slash) return slash[0];
    const month = source.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4}\b/i);
    return month ? month[0] : null;
  }

  function dateFromScope(scope) {
    if (!scope) return null;
    const time = scope.querySelector('time');
    if (time) {
      const dated = clean(time.getAttribute('datetime') || time.textContent);
      const parsed = dateFromText(dated) || dated;
      if (parsed) return parsed.slice(0, 40);
    }
    const dated = scope.querySelector('.col.date, [data-uia*="date"], [class*="date" i]');
    if (dated) {
      const parsed = dateFromText(dated.textContent) || clean(dated.textContent);
      if (parsed) return parsed.slice(0, 40);
    }
    return dateFromText(scope.textContent || '');
  }

  function titleAnchors(doc) {
    const found = new Set();
    const selectors = [
      'a[href*="/title/"]',
      'a[href*="/watch/"]',
      '[data-videoid] a[href]',
      '[data-title-id] a[href]',
      'a[data-uia*="title"]',
    ];
    for (const selector of selectors) {
      for (const node of doc.querySelectorAll(selector)) {
        if (node.tagName === 'A') found.add(node);
      }
    }
    return [...found];
  }

  function rowFor(anchor) {
    const row = anchor.closest('.retableRow, [data-list-item], [data-uia*="activity"], article, li, tr, [role="row"]');
    if (!row) return anchor.parentElement;
    const links = row.querySelectorAll('a[href*="/title/"], a[href*="/watch/"]');
    if (links.length > 3) return anchor.parentElement;
    return row;
  }

  function collectMyList(doc) {
    if (isSignedOut(doc)) return { error: 'Sign in to Netflix in this browser, then export again.', items: [] };
    const items = [];
    const seen = new Set();
    for (const anchor of titleAnchors(doc)) {
      const netflixId = netflixIdFromHref(anchor.getAttribute('href'));
      const title = titleFromAnchor(anchor);
      if (!netflixId || !title || seen.has(netflixId)) continue;
      seen.add(netflixId);
      items.push({ title, netflixId });
      if (items.length >= 400) break;
    }
    return { items };
  }

  function collectViewing(doc) {
    if (isSignedOut(doc)) return { error: 'Sign in to Netflix in this browser, then export again.', items: [] };
    const items = [];
    const seen = new Set();
    for (const anchor of titleAnchors(doc)) {
      const netflixId = netflixIdFromHref(anchor.getAttribute('href'));
      const title = titleFromAnchor(anchor);
      if (!title) continue;
      const watchedAt = dateFromScope(rowFor(anchor));
      const key = `${netflixId || title}|${watchedAt || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ title, netflixId, watchedAt });
      if (items.length >= 500) break;
    }
    if (items.length === 0) {
      for (const row of doc.querySelectorAll('.retableRow, [data-list-item], article, li, tr')) {
        const text = row.textContent || '';
        if (text.length > 300) continue;
        const watchedAt = dateFromScope(row);
        const titleLink = row.querySelector('a[href*="/title/"], a[href*="/watch/"]');
        const title = titleLink ? titleFromAnchor(titleLink) : clean(text).split(' ').slice(0, 12).join(' ');
        const netflixId = titleLink ? netflixIdFromHref(titleLink.getAttribute('href')) : null;
        if (!title || title === watchedAt) continue;
        const key = `${netflixId || title}|${watchedAt || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ title, netflixId, watchedAt });
        if (items.length >= 500) break;
      }
    }
    return { items };
  }

  function findShowMore(doc) {
    const nodes = doc.querySelectorAll('button, a, [role="button"]');
    for (const node of nodes) {
      if (node.disabled || node.getAttribute('aria-disabled') === 'true' || node.classList.contains('disabled')) continue;
      if (node.getAttribute('aria-hidden') === 'true' || node.hidden) continue;
      const uia = `${node.getAttribute('data-uia') || ''} ${node.id || ''}`;
      if (MORE_UIA.test(uia)) return node;
      const text = clean(node.innerText || node.textContent);
      if (text.length > 40) continue;
      if (MORE_TEXT.test(text)) return node;
    }
    return null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitForCount(doc, collect, previous, timeoutMs) {
    const started = collect(doc);
    if (started.error || started.items.length > previous) return Promise.resolve(started);
    const body = doc.body || doc.documentElement;
    if (!body || typeof MutationObserver === 'undefined') {
      return sleep(timeoutMs).then(() => collect(doc));
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        resolve(collect(doc));
      };
      const observer = new MutationObserver(() => {
        const next = collect(doc);
        if (next.error || next.items.length > previous) {
          if (settled) return;
          settled = true;
          observer.disconnect();
          resolve(next);
        }
      });
      observer.observe(body, { childList: true, subtree: true, characterData: true });
      setTimeout(finish, timeoutMs);
    });
  }

  async function expandAndCollect(doc, kind, options) {
    const settings = options || {};
    const collect = kind === 'myList' ? collectMyList : collectViewing;
    const maxClicks = settings.maxClicks ?? 80;
    const delayMs = settings.delayMs ?? 900;
    const settleMs = settings.settleMs ?? 2500;
    let stagnant = 0;
    let clicks = 0;
    let latest = await waitForCount(doc, collect, -1, settings.initialWaitMs ?? 8000);
    if (latest.error) return { ...latest, clicks };
    if (settings.onProgress) settings.onProgress(latest.items.length, clicks);
    while (clicks < maxClicks) {
      const button = findShowMore(doc);
      if (!button) break;
      const before = latest.items.length;
      button.click();
      clicks += 1;
      latest = await waitForCount(doc, collect, before, settleMs);
      if (latest.error) return { ...latest, clicks };
      if (delayMs) await sleep(delayMs);
      if (latest.items.length <= before) {
        stagnant += 1;
        if (stagnant >= 3) break;
      } else {
        stagnant = 0;
      }
      if (settings.onProgress) settings.onProgress(latest.items.length, clicks);
    }
    latest = collect(doc);
    return { ...latest, clicks };
  }

  root.MinaflixScrape = {
    collectMyList,
    collectViewing,
    findShowMore,
    isSignedOut,
    isActivityUrl,
    netflixIdFromHref,
    expandAndCollect,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
