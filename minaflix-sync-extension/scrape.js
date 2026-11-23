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

  function showTitleFrom(title) {
    const match = /^(.*?)\s*:\s*Season\b/i.exec(title);
    const name = match ? clean(match[1]) : '';
    return name && name !== title ? name : null;
  }

  function viewingItem(title, netflixId, watchedAt) {
    if (!title || !netflixId) return null;
    return { title, showTitle: showTitleFrom(title), netflixId, watchedAt: watchedAt || null };
  }

  function dateFromDescription(description) {
    if (!description) return null;
    const dateNode = description.querySelector(':scope > span');
    return dateFromText(dateNode ? dateNode.textContent : '') || null;
  }

  function collectModernViewing(doc) {
    const items = [];
    const seen = new Set();
    for (const row of doc.querySelectorAll('[data-uia="viewing-activity-page+list-item"]')) {
      const link = row.querySelector('[data-uia="viewing-activity-page+list-item+description+title-link"]')
        || row.querySelector('a[href*="/title/"], a[href*="/watch/"]');
      if (!link) continue;
      const description = row.querySelector('[data-uia="viewing-activity-page+list-item+description"]');
      const item = viewingItem(
        clean(link.textContent),
        netflixIdFromHref(link.getAttribute('href')),
        dateFromDescription(description),
      );
      if (!item) continue;
      const key = `${item.netflixId}|${item.watchedAt || ''}|${item.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
      if (items.length >= 500) break;
    }
    return items;
  }

  function collectViewing(doc) {
    if (isSignedOut(doc)) return { error: 'Sign in to Netflix in this browser, then export again.', items: [] };
    const modern = collectModernViewing(doc);
    if (modern.length > 0 || doc.querySelector('[data-uia="viewing-activity-page+container"]')) {
      return { items: modern };
    }
    const items = [];
    const seen = new Set();
    const legacyRows = doc.querySelectorAll('.retableRow, [data-list-item]');
    const anchors = legacyRows.length
      ? [...legacyRows].flatMap((row) => [...row.querySelectorAll('a[href*="/title/"], a[href*="/watch/"]')])
      : titleAnchors(doc);
    for (const anchor of anchors) {
      const netflixId = netflixIdFromHref(anchor.getAttribute('href'));
      const title = titleFromAnchor(anchor);
      const item = viewingItem(title, netflixId, dateFromScope(rowFor(anchor)));
      if (!item) continue;
      const key = `${item.netflixId}|${item.watchedAt || ''}|${item.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
      if (items.length >= 500) break;
    }
    return { items };
  }

  function hasViewingRow(doc) {
    return Boolean(doc.querySelector('[data-uia="viewing-activity-page+list-item"], .retableRow a[href*="/title/"], .retableRow a[href*="/watch/"]'));
  }

  function findShowMore(doc) {
    const exact = doc.querySelector('button[data-uia="viewing-activity-page+show-more-btn"], button[data-cl-command="ShowMoreCommand"]');
    if (exact && !exact.disabled && exact.getAttribute('aria-disabled') !== 'true' && !exact.hidden) return exact;
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

  function waitForViewingRow(doc, timeoutMs) {
    if (hasViewingRow(doc)) return Promise.resolve();
    const body = doc.body || doc.documentElement;
    if (!body || typeof MutationObserver === 'undefined') return sleep(timeoutMs);
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (!hasViewingRow(doc)) return;
        observer.disconnect();
        resolve();
      });
      observer.observe(body, { childList: true, subtree: true, characterData: true });
      setTimeout(() => {
        observer.disconnect();
        resolve();
      }, timeoutMs);
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
    if (kind !== 'myList') await waitForViewingRow(doc, settings.initialWaitMs ?? 20000);
    let latest = kind === 'myList'
      ? await waitForCount(doc, collect, -1, settings.initialWaitMs ?? 4000)
      : collect(doc);
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

  function unwrap(node) {
    if (node == null || typeof node !== 'object') return node;
    const keys = Object.keys(node);
    const onlyValue = keys.length > 0 && keys.every((key) => key === 'value' || key.startsWith('$'));
    if (onlyValue && Object.prototype.hasOwnProperty.call(node, 'value')) return unwrap(node.value);
    return node;
  }

  function asText(node) {
    const value = unwrap(node);
    if (typeof value === 'string') return clean(value);
    if (typeof value === 'number') return String(value);
    return '';
  }

  function asNumber(node) {
    const value = unwrap(node);
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function namedPeople(node) {
    const value = unwrap(node);
    if (!value || typeof value !== 'object') return [];
    const source = Array.isArray(value) ? value : value;
    const keys = Array.isArray(source) ? source.map((_, index) => String(index)) : Object.keys(source).filter((key) => /^\d+$/.test(key));
    return keys.sort((a, b) => Number(a) - Number(b)).flatMap((key) => {
      const item = unwrap(source[key]);
      const name = typeof item === 'string' ? item : asText(item?.name);
      return name ? [name] : [];
    }).slice(0, 16);
  }

  function imageUrlIn(node) {
    const found = [];
    const visit = (current) => {
      const value = unwrap(current);
      if (typeof value === 'string' && /^https?:\/\//.test(value) && /nflxso\.net|nflximg/i.test(value)) found.push(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(node);
    return found[0] || null;
  }

  function maturityText(node) {
    const value = unwrap(node);
    if (typeof value === 'string') return clean(value);
    if (!value || typeof value !== 'object') return '';
    return clean(asText(value.certificationValue) || asText(value.rating?.value) || asText(value.rating) || asText(value.value) || asText(value.certification) || asText(value.boardRating));
  }

  function metadataFromVideo(video) {
    if (!video || typeof video !== 'object') return null;
    const title = asText(video.title);
    const synopsis = asText(video.synopsis) || asText(video.summary?.synopsis);
    const yearNumber = asNumber(video.year);
    const runtimeRaw = asNumber(video.runtime);
    const runtimeMinutes = runtimeRaw == null ? null : (runtimeRaw > 300 ? Math.round(runtimeRaw / 60) : runtimeRaw);
    const seasons = asNumber(video.seasonCount);
    const summaryType = asText(video.summary?.type).toLowerCase();
    const mediaType = seasons && seasons > 0 || /show|series/.test(summaryType) ? 'tv' : (summaryType.includes('movie') || runtimeMinutes ? 'movie' : null);
    const image = imageUrlIn(video.boxarts);
    const backdrop = imageUrlIn(video.storyarts) || imageUrlIn(video.bgImages) || imageUrlIn(video.artworks);
    return {
      title,
      synopsis,
      year: yearNumber ? String(yearNumber) : '',
      maturity: maturityText(video.maturity),
      runtimeMinutes,
      seasons,
      genres: namedPeople(video.genres),
      cast: namedPeople(video.cast),
      creators: namedPeople(video.creators),
      directors: namedPeople(video.directors),
      mediaType: mediaType === 'tv' || mediaType === 'movie' ? mediaType : null,
      image,
      backdrop: backdrop && backdrop !== image ? backdrop : null,
      source: 'api',
    };
  }

  function metadataFromApiPayload(payload) {
    const videos = payload?.jsonGraph?.videos || payload?.videos || {};
    const byId = {};
    for (const [id, video] of Object.entries(videos)) {
      if (!/^\d{1,12}$/.test(id)) continue;
      const meta = metadataFromVideo(video);
      if (meta && (meta.synopsis || meta.image || meta.title || meta.cast.length)) byId[id] = meta;
    }
    return byId;
  }

  function metaContent(doc, attr, key) {
    for (const node of doc.querySelectorAll('meta')) {
      if ((node.getAttribute(attr) || '').toLowerCase() === key) return clean(node.getAttribute('content'));
    }
    return '';
  }

  function absoluteHttps(value) {
    const text = String(value || '').trim();
    if (text.startsWith('//')) return `https:${text}`;
    return /^https:\/\//.test(text) ? text : '';
  }

  function jsonLdNodes(doc) {
    const nodes = [];
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent || '');
        const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [parsed]);
        for (const node of list) if (node && typeof node === 'object') nodes.push(node);
      } catch {
        // Ignore a broken JSON-LD block and keep reading the page.
      }
    }
    return nodes;
  }

  function personNames(value) {
    const list = Array.isArray(value) ? value : (value ? [value] : []);
    return list.flatMap((item) => {
      if (typeof item === 'string') return [clean(item)];
      return asText(item?.name) ? [asText(item.name)] : [];
    }).filter(Boolean).slice(0, 16);
  }

  function isoDurationMinutes(value) {
    const match = /PT(?:(\d+)H)?(?:(\d+)M)?/i.exec(String(value || ''));
    if (!match) return null;
    const minutes = (Number(match[1] || 0) * 60) + Number(match[2] || 0);
    return minutes > 0 ? minutes : null;
  }

  function metadataFromTitleDocument(doc) {
    const ld = jsonLdNodes(doc).find((node) => /movie|tvseries|tvepisode|creativework/i.test(String(node['@type'] || ''))) || jsonLdNodes(doc)[0];
    const ogImage = absoluteHttps(metaContent(doc, 'property', 'og:image') || metaContent(doc, 'name', 'og:image') || metaContent(doc, 'name', 'twitter:image'));
    const ldImage = absoluteHttps(typeof ld?.image === 'string' ? ld.image : ld?.image?.url);
    const card = [...doc.querySelectorAll('img')].map((img) => absoluteHttps(img.getAttribute('src') || img.getAttribute('data-src'))).find((src) => /nflxso\.net|nflximg/i.test(src) && /boxart|boxshot|title-card|titlecard|poster|storyart/i.test(src));
    const image = ogImage || ldImage || card || null;
    const story = [...doc.querySelectorAll('img')].map((img) => absoluteHttps(img.getAttribute('src') || img.getAttribute('data-src'))).find((src) => /nflxso\.net|nflximg/i.test(src) && /storyart|backdrop|billboard/i.test(src));
    const typeText = String(ld?.['@type'] || metaContent(doc, 'property', 'og:type')).toLowerCase();
    const seasons = Number(ld?.numberOfSeasons);
    const year = String(ld?.datePublished || metaContent(doc, 'property', 'og:video:release_date') || '').slice(0, 4);
    const synopsis = clean(ld?.description) || metaContent(doc, 'property', 'og:description') || metaContent(doc, 'name', 'description') || clean(doc.querySelector('[data-uia*="synopsis"]')?.textContent);
    const genres = personNames(ld?.genre);
    const domGenres = [...doc.querySelectorAll('[data-uia*="genre"]')].map((node) => clean(node.textContent)).filter(Boolean);
    return {
      title: clean(ld?.name) || metaContent(doc, 'property', 'og:title'),
      synopsis,
      year: /^\d{4}$/.test(year) ? year : '',
      maturity: clean(ld?.contentRating) || clean(doc.querySelector('[data-uia*="maturity"]')?.textContent),
      runtimeMinutes: isoDurationMinutes(ld?.duration) || isoDurationMinutes(ld?.timeRequired),
      seasons: Number.isFinite(seasons) && seasons > 0 ? seasons : null,
      genres: genres.length ? genres : domGenres.slice(0, 8),
      cast: personNames(ld?.actor),
      creators: personNames(ld?.creator),
      directors: personNames(ld?.director),
      mediaType: /tv|series|episode/.test(typeText) || (Number.isFinite(seasons) && seasons > 0) ? 'tv' : (/movie/.test(typeText) ? 'movie' : null),
      image,
      backdrop: story && story !== image ? story : null,
      source: 'page',
    };
  }

  function metadataFromTitleHtml(html) {
    try {
      return metadataFromTitleDocument(new DOMParser().parseFromString(String(html || ''), 'text/html'));
    } catch {
      return null;
    }
  }

  function readMemberApi(context) {
    const parsed = typeof context === 'string' ? JSON.parse(context) : context;
    const models = parsed?.models || parsed || {};
    const defs = models.serverDefs?.data || models.serverDefs || {};
    const user = models.userInfo?.data || models.userInfo || {};
    const buildId = defs.BUILD_IDENTIFIER || defs.buildIdentifier || '';
    const apiRoot = defs.API_ROOT || defs.SHAKTI_API_ROOT || defs.apiRoot || '/api/shakti';
    const authURL = user.authURL || '';
    if (!buildId || !authURL) return null;
    return { buildId: String(buildId), apiRoot: String(apiRoot), authURL: String(authURL) };
  }

  function memberApiUrl(api) {
    const root = api.apiRoot.replace(/\/$/, '');
    const absolute = root.startsWith('http') ? root : `https://www.netflix.com${root.startsWith('/') ? '' : '/'}${root}`;
    if (/\/(shakti|memberapi)\/[^/]+$/i.test(absolute)) return `${absolute}/pathEvaluator`;
    return `${absolute}/${api.buildId}/pathEvaluator`;
  }

  function metadataPaths(ids) {
    const range = { from: 0, to: 14 };
    return ids.flatMap((id) => {
      const video = ['videos', Number(id)];
      return [
        [...video, 'title'],
        [...video, 'synopsis'],
        [...video, 'year'],
        [...video, 'runtime'],
        [...video, 'seasonCount'],
        [...video, 'maturity'],
        [...video, 'summary'],
        [...video, 'boxarts', '_342x192', 'jpg'],
        [...video, 'storyarts', '_1632x873', 'jpg'],
        [...video, 'genres', range, 'name'],
        [...video, 'cast', range, 'name'],
        [...video, 'creators', range, 'name'],
        [...video, 'directors', range, 'name'],
      ];
    });
  }

  function useful(meta) {
    return Boolean(meta && (meta.synopsis || meta.image || meta.backdrop || meta.cast?.length || meta.genres?.length || meta.year || meta.maturity || meta.seasons || meta.runtimeMinutes));
  }

  function catalogPaths(rowFrom, rowTo, itemTo) {
    const rows = { from: rowFrom, to: rowTo };
    const items = { from: 0, to: itemTo };
    return [
      ['lolomo', rows, 'displayName'],
      ['lolomo', rows, items, 'summary'],
      ['lolomo', rows, items, 'reference'],
    ];
  }

  function videoIdFromCell(cell) {
    const ref = unwrap(cell?.reference);
    if (Array.isArray(ref) && ref[0] === 'videos' && /^\d{1,12}$/.test(String(ref[1] || ''))) return String(ref[1]);
    const summary = unwrap(cell?.summary);
    const summaryId = summary && typeof summary === 'object' ? summary.id : summary;
    if (/^\d{1,12}$/.test(String(summaryId || ''))) return String(summaryId);
    return null;
  }

  function rowsFromLolomo(payload) {
    const lolomo = payload?.jsonGraph?.lolomo || payload?.lolomo;
    if (!lolomo || typeof lolomo !== 'object') return [];
    const rows = [];
    for (const index of Object.keys(lolomo).filter((key) => /^\d+$/.test(key)).sort((a, b) => Number(a) - Number(b))) {
      const row = lolomo[index];
      if (!row || typeof row !== 'object') continue;
      const name = asText(row.displayName) || asText(row.title) || `Row ${Number(index) + 1}`;
      const titles = [];
      const seen = new Set();
      for (const key of Object.keys(row).filter((item) => /^\d+$/.test(item))) {
        const id = videoIdFromCell(row[key]);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const summary = unwrap(row[key]?.summary);
        titles.push({ netflixId: id, title: summary && typeof summary === 'object' ? asText(summary.title) : '' });
      }
      if (titles.length) rows.push({ name, titles });
    }
    return rows;
  }

  function idFromCardHref(href) {
    const jbv = /[?&]jbv=(\d{1,12})(?:&|$)/.exec(String(href || ''));
    if (jbv) return jbv[1];
    return netflixIdFromHref(href);
  }

  function artworkUrl(value) {
    const src = absoluteHttps(String(value || '').trim());
    return /nflxso\.net|nflximg/i.test(src) ? src : null;
  }

  function cardImage(anchor) {
    const image = anchor.querySelector('[data-uia="card-image-focus-host"] img') || anchor.querySelector('img');
    if (!image) return null;
    const srcset = image.getAttribute('srcset') || '';
    const parts = srcset.split(',').map((part) => part.trim()).filter(Boolean);
    const twox = parts.find((part) => /\s2x$/i.test(part));
    const chosen = (twox || parts[parts.length - 1] || '').replace(/\s+\d+(?:\.\d+)?x$/i, '').trim();
    return artworkUrl(chosen) || artworkUrl(image.currentSrc) || artworkUrl(image.getAttribute('src'));
  }

  function titlesFromRoot(rootNode) {
    const titles = [];
    const seen = new Set();
    if (!rootNode) return titles;
    const cards = rootNode.querySelectorAll('a[data-uia$="-card"][href*="jbv="], a[href*="/title/"], a[href*="/watch/"], a[href*="jbv="]');
    for (const anchor of cards) {
      const netflixId = idFromCardHref(anchor.getAttribute('href'));
      const title = clean(anchor.getAttribute('aria-label')) || titleFromAnchor(anchor);
      if (!netflixId || !title || seen.has(netflixId)) continue;
      seen.add(netflixId);
      titles.push({ netflixId, title, image: cardImage(anchor) });
    }
    return titles;
  }

  function genreLinks(doc) {
    const genres = [];
    const seen = new Set();
    for (const anchor of doc.querySelectorAll('a[href^="/browse/genre/"], a[href*="/browse/genre/"]')) {
      const match = /\/browse\/genre\/(\d+)/.exec(anchor.getAttribute('href') || '');
      if (!match || seen.has(match[1])) continue;
      seen.add(match[1]);
      const label = anchor.querySelector('[data-uia="navigation-item-text"]');
      const visible = clean(label?.textContent);
      const raw = clean(anchor.textContent);
      const doubled = raw.length > 1 && raw.length % 2 === 0 && raw.slice(0, raw.length / 2) === raw.slice(raw.length / 2)
        ? raw.slice(0, raw.length / 2)
        : raw;
      const name = visible || clean(anchor.getAttribute('aria-label')) || doubled;
      if (!name) continue;
      genres.push({ id: match[1], name });
    }
    return genres;
  }

  function rowsFromBrowseDocument(doc) {
    const rows = [];
    const carousels = [...doc.querySelectorAll('[data-uia^="carousel-row-section-"]')];
    for (const carousel of carousels) {
      const headingId = carousel.getAttribute('aria-labelledby');
      const heading = (headingId && doc.getElementById(headingId)) || carousel.querySelector('h2[id$="-heading"], h2');
      const name = clean(heading?.textContent);
      const titles = titlesFromRoot(carousel);
      if (name && titles.length) rows.push({ name, titles });
    }
    if (!rows.length) {
      const headings = [...doc.querySelectorAll('h2, [data-uia*="row-title"]')];
      for (const heading of headings) {
        const name = clean(heading.textContent);
        const container = heading.closest('section, [data-list-context], .lolomoRow, [data-uia^="carousel-row-section-"]') || heading.parentElement;
        const titles = titlesFromRoot(container);
        if (name && titles.length) rows.push({ name, titles });
      }
    }
    if (!rows.length) {
      const titles = titlesFromRoot(doc.body || doc);
      if (titles.length) rows.push({ name: 'Browse', titles });
    }
    return { rows, genres: genreLinks(doc) };
  }

  function rowsFromBrowseHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    return rowsFromBrowseDocument(doc);
  }

  function parseEmbeddedJson(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    const text = String(raw).replace(/\\'/g, "'");
    try { return JSON.parse(text); } catch { /* try one more unescape */ }
    try { return JSON.parse(text.replace(/\\"/g, '"')); } catch { return null; }
  }

  function graphqlCacheFromHtml(html) {
    const source = String(html || '');
    const patterns = [
      /models\.graphql\s*=\s*JSON\.parse\('([\s\S]*?)'\)/,
      /"graphql"\s*:\s*"((?:\\.|[^"\\])*)"/,
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(source);
      if (!match) continue;
      const parsed = parseEmbeddedJson(match[1]);
      if (parsed) return parsed;
    }
    return null;
  }

  function graphqlCacheFromWindow(win) {
    const raw = win?.netflix?.reactContext?.models?.graphql || win?.netflix?.appContext?.models?.graphql;
    return parseEmbeddedJson(raw);
  }

  function videoIdsIn(value, found) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item) => videoIdsIn(item, found));
      return;
    }
    const unified = String(value.unifiedEntityId || '');
    const unifiedId = /^(?:Video|Movie|Show):(\d{1,12})$/.exec(unified);
    const direct = value.videoId || value.jbv || (unifiedId ? unifiedId[1] : null);
    if (/^\d{1,12}$/.test(String(direct || ''))) {
      found.push({ netflixId: String(direct), title: asText(value.title) || asText(value.name) });
    }
    Object.values(value).forEach((item) => videoIdsIn(item, found));
  }

  function rowsFromGraphqlCache(cache) {
    const data = cache?.data || cache;
    if (!data || typeof data !== 'object') return { rows: [], genres: [] };
    const genres = [];
    const rows = [];
    const loose = [];
    const seenGenres = new Set();
    for (const [key, value] of Object.entries(data)) {
      const genreMatch = /genreId"\s*:\s*"?(\d+)/.exec(key);
      const name = asText(value?.title) || asText(value?.name);
      if (genreMatch && !seenGenres.has(genreMatch[1])) {
        seenGenres.add(genreMatch[1]);
        genres.push({ id: genreMatch[1], name: name || `Genre ${genreMatch[1]}` });
        const titles = [];
        videoIdsIn(value, titles);
        const unique = [];
        const seen = new Set();
        for (const title of titles) {
          if (seen.has(title.netflixId) || title.netflixId === genreMatch[1]) continue;
          seen.add(title.netflixId);
          unique.push(title);
        }
        if (name && unique.length) rows.push({ name, titles: unique });
      } else {
        videoIdsIn(value, loose);
      }
    }
    if (!rows.length && loose.length) {
      const seen = new Set();
      const titles = [];
      for (const title of loose) {
        if (!title.title || seen.has(title.netflixId)) continue;
        seen.add(title.netflixId);
        titles.push(title);
      }
      if (titles.length) rows.push({ name: 'Catalog', titles });
    }
    return { rows, genres };
  }

  async function waitForArtwork(anchor) {
    const started = Date.now();
    let found = cardImage(anchor);
    while (!found && Date.now() - started < 1200) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      found = cardImage(anchor);
    }
    return found;
  }

  async function harvestVisibleCards(images) {
    const cards = document.querySelectorAll('a[data-uia$="-card"][href*="jbv="]');
    for (const anchor of cards) {
      const netflixId = idFromCardHref(anchor.getAttribute('href'));
      if (!netflixId || images.has(netflixId)) continue;
      const image = await waitForArtwork(anchor);
      if (image) images.set(netflixId, image);
    }
  }

  function applyHarvestedImages(parsed, images) {
    for (const row of parsed.rows) {
      for (const title of row.titles) {
        if (!title.image && images.has(title.netflixId)) title.image = images.get(title.netflixId);
      }
    }
    return parsed;
  }

  async function collectLiveBrowse() {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const images = new Map();
    for (let step = 0; step < 5; step += 1) {
      window.scrollBy(0, Math.max(500, window.innerHeight * 0.8));
      await pause(350);
      const buttons = [...document.querySelectorAll('[data-uia="carousel-hawkins-right-button"]')]
        .filter((button) => !button.disabled && button.getAttribute('tabindex') !== '-1');
      for (const button of buttons.slice(0, 8)) {
        button.click();
        await harvestVisibleCards(images);
        await pause(200);
      }
      await harvestVisibleCards(images);
    }
    const dom = applyHarvestedImages(rowsFromBrowseDocument(document), images);
    const cached = rowsFromGraphqlCache(graphqlCacheFromWindow(globalThis) || graphqlCacheFromHtml(document.documentElement.innerHTML));
    return {
      rows: dom.rows.length ? dom.rows : cached.rows,
      genres: dom.genres.length ? dom.genres : cached.genres,
    };
  }

  function diagnoseTitleHtml(html, finalUrl) {
    const source = String(html || '');
    const url = String(finalUrl || '');
    if (/\/login(?:\?|$)/.test(url)) return { reason: 'redirected to login', url };
    const hasOg = /property=["']og:image["']/i.test(source) || /property=["']og:description["']/i.test(source);
    const hasLd = /application\/ld\+json/i.test(source);
    const hasGraphql = /models\.graphql|genreId/.test(source);
    if (!hasOg && !hasLd && !hasGraphql) return { reason: 'SPA shell without og tags, JSON-LD, or GraphQL cache', url };
    const meta = metadataFromTitleHtml(source);
    if (!useful(meta)) return { reason: 'page parsed but had no synopsis, artwork, year, or cast', url };
    return { meta, url };
  }

  async function fetchMemberMetadata(win, ids) {
    try {
      const api = readMemberApi(win.netflix?.reactContext || win.netflix?.appContext);
      if (!api || !ids.length) return {};
      const byId = {};
      for (let start = 0; start < ids.length; start += 40) {
        const chunk = ids.slice(start, start + 40);
        try {
          const response = await fetch(memberApiUrl(api), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ paths: metadataPaths(chunk), authURL: api.authURL }),
          });
          if (response.ok) Object.assign(byId, metadataFromApiPayload(await response.json()));
        } catch {
          // This batch failed. Title pages fill the gap.
        }
        if (start + 40 < ids.length) await sleep(700);
      }
      return byId;
    } catch {
      return {};
    }
  }

  async function fetchPageMetadata(id) {
    const attempts = [
      `https://www.netflix.com/title/${id}`,
      `https://www.netflix.com/browse?jbv=${id}`,
    ];
    const failures = [];
    for (const url of attempts) {
      try {
        const response = await fetch(url, { credentials: 'same-origin' });
        const html = await response.text();
        const diagnosed = diagnoseTitleHtml(html, response.url || url);
        if (!response.ok) {
          failures.push(`${url} HTTP ${response.status}`);
          continue;
        }
        if (diagnosed.meta) return { meta: diagnosed.meta };
        failures.push(`${url} ${diagnosed.reason}`);
      } catch (error) {
        failures.push(`${url} ${error instanceof Error ? error.message : 'fetch failed'}`);
      }
    }
    return { error: failures.join('; ') || 'no title metadata' };
  }

  async function attachDetails(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const ids = [...new Set(list.map((item) => item?.netflixId).filter((id) => /^\d{1,12}$/.test(String(id || ''))))];
    const byId = {};
    const api = await fetchMemberMetadata(globalThis, ids);
    for (const [id, meta] of Object.entries(api)) if (useful(meta)) byId[id] = meta;
    for (const id of ids) {
      if (byId[id]) continue;
      const page = await fetchPageMetadata(id);
      if (useful(page?.meta)) byId[id] = page.meta;
      await sleep(450);
    }
    return list.map((item) => {
      const meta = item?.netflixId ? byId[item.netflixId] : null;
      if (!meta) return item;
      return {
        ...item,
        synopsis: meta.synopsis || null,
        year: meta.year || null,
        maturity: meta.maturity || null,
        runtimeMinutes: meta.runtimeMinutes,
        seasons: meta.seasons,
        genres: meta.genres,
        cast: meta.cast,
        creators: meta.creators,
        directors: meta.directors,
        mediaType: meta.mediaType,
        image: meta.image,
        backdrop: meta.backdrop,
        source: meta.source,
      };
    });
  }

  const DETAIL_MODAL_QUERY_ID = '76c01761-731d-48bd-8ce9-81c37e0bb3a3';
  const GRAPHQL_URL = 'https://web.prod.cloud.netflix.com/graphql';

  function videoIdOf(node) {
    if (!node || typeof node !== 'object') return '';
    const unified = /^(?:Video|Movie|Show):(\d{1,12})$/.exec(String(node.unifiedEntityId || ''));
    const direct = node.videoId ?? node.videoID ?? (unified ? unified[1] : null);
    const text = String(direct ?? '');
    return /^\d{1,12}$/.test(text) ? text : '';
  }

  function idFromCacheKey(key) {
    const plain = /^(?:Video|Movie|Show|Episode):(\d{1,12})$/.exec(String(key || ''));
    if (plain) return plain[1];
    const embedded = /videoId["']?\s*[:=]\s*["']?(\d{1,12})/.exec(String(key || ''));
    return embedded ? embedded[1] : '';
  }

  function peopleFrom(entity, keys) {
    const names = [];
    for (const key of keys) {
      const value = entity?.[key];
      const list = Array.isArray(value) ? value : (Array.isArray(value?.edges) ? value.edges.map((edge) => edge?.node || edge) : null);
      if (!list) continue;
      for (const item of list) {
        const name = clean(typeof item === 'string' ? item : (item?.name || item?.displayName || ''));
        if (name) names.push(name);
      }
    }
    return [...new Set(names)].slice(0, 16);
  }

  function genreNames(entity) {
    const tags = entity?.genreTags;
    if (Array.isArray(tags) && tags.every((tag) => typeof tag === 'string')) return tags.map((tag) => clean(tag)).filter(Boolean).slice(0, 12);
    return peopleFrom(entity, ['genreTags', 'genres']).slice(0, 12);
  }

  function yearFromEntity(entity) {
    const value = asNumber(entity.latestYear) ?? asNumber(entity.releaseYear) ?? asNumber(entity.year);
    return value && value > 1900 && value < 2100 ? String(value) : '';
  }

  function runtimeFromText(text) {
    const value = String(text || '');
    if (/season/i.test(value)) return null;
    const hours = /(\d+)\s*h(?:ours?)?(?:\s|$)/i.exec(value);
    const minutes = /(\d+)\s*m(?:in(?:utes?)?)?(?:\s|$)/i.exec(value);
    if (!hours && !minutes) return null;
    const total = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
    return total > 0 ? total : null;
  }

  function seasonsFromText(text) {
    const match = /(\d+)\s+Seasons?/i.exec(String(text || ''));
    return match ? Number(match[1]) : null;
  }

  function runtimeFromEntity(entity) {
    const seconds = asNumber(entity.runtimeSec);
    if (seconds && seconds > 60) return Math.round(seconds / 60);
    const raw = asNumber(entity.runtime);
    if (raw == null) return runtimeFromText(asText(entity.displayRuntime));
    return raw > 300 ? Math.round(raw / 60) : raw;
  }

  function seasonsFromEntity(entity) {
    const total = asNumber(entity.seasons?.totalCount) ?? asNumber(entity.seasonCount) ?? asNumber(entity.numSeasons);
    if (total && total > 0 && total < 200) return total;
    return seasonsFromText(asText(entity.numSeasonsLabel));
  }

  function maturityFromEntity(entity) {
    return maturityText(entity.contentAdvisory) || maturityText(entity.maturity) || asText(entity.certificationRating);
  }

  function artworkFrom(entity) {
    const urls = [];
    const visit = (node, key) => {
      if (!node || urls.length > 8) return;
      if (typeof node === 'string') {
        const url = artworkUrl(node);
        if (url) urls.push({ key, url });
        return;
      }
      if (typeof node === 'object') {
        if (node.url) visit(node.url, key);
        if (Array.isArray(node)) node.slice(0, 4).forEach((item) => visit(item, key));
      }
    };
    for (const key of ['storyArt', 'storyarts', 'boxArt', 'boxart', 'boxarts', 'artwork']) visit(entity[key], key);
    const backdrop = urls.find((item) => /story|backdrop/i.test(item.key) || /storyart|backdrop/i.test(item.url))?.url || null;
    const image = urls.find((item) => item.url !== backdrop)?.url || null;
    return { image, backdrop };
  }

  function metadataFromEntity(entity, source) {
    if (!entity || typeof entity !== 'object') return null;
    const art = artworkFrom(entity);
    const seasons = seasonsFromEntity(entity);
    const runtimeMinutes = runtimeFromEntity(entity);
    const typeName = String(entity.__typename || entity.type || '').toLowerCase();
    const mediaType = /show|series|season/.test(typeName) || seasons ? 'tv' : (/movie/.test(typeName) || runtimeMinutes ? 'movie' : null);
    return {
      title: asText(entity.title) || asText(entity.name),
      synopsis: asText(entity.synopsis) || asText(entity.contextualSynopsis?.text) || asText(entity.narrativeText) || asText(entity.shortSynopsis),
      year: yearFromEntity(entity),
      maturity: maturityFromEntity(entity),
      runtimeMinutes,
      seasons,
      genres: genreNames(entity),
      cast: peopleFrom(entity, ['cast', 'actors']),
      creators: peopleFrom(entity, ['creators']),
      directors: peopleFrom(entity, ['directors']),
      mediaType,
      image: art.image,
      backdrop: art.backdrop,
      source,
    };
  }

  function rememberEntity(byId, id, node, source) {
    if (!id || byId[id]) return;
    const meta = metadataFromEntity({ ...node, videoId: node.videoId || Number(id) }, source);
    if (useful(meta)) byId[id] = meta;
  }

  function detailsFromGraphqlCache(cache, ids) {
    const wanted = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
    const byId = {};
    const data = cache?.data || cache;
    if (!data || typeof data !== 'object') return byId;
    const visit = (node, depth, keyHint) => {
      if (!node || typeof node !== 'object' || depth > 5) return;
      const id = videoIdOf(node) || idFromCacheKey(keyHint);
      if (id && (!wanted || wanted.has(id))) rememberEntity(byId, id, node, 'cache');
      const entries = Array.isArray(node) ? [...node.entries()] : Object.entries(node);
      if (entries.length > 300 && depth > 0) return;
      for (const [key, value] of entries) {
        if (value && typeof value === 'object') visit(value, depth + 1, key);
      }
    };
    visit(data, 0, '');
    return byId;
  }

  function detailsFromFalcorCache(cache, ids) {
    if (!cache || typeof cache !== 'object') return {};
    const payload = cache.videos ? { videos: cache.videos } : (cache.jsonGraph?.videos ? { jsonGraph: cache.jsonGraph } : null);
    if (!payload) return {};
    const wanted = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
    const byId = {};
    for (const [id, meta] of Object.entries(metadataFromApiPayload(payload))) {
      if (wanted && !wanted.has(id)) continue;
      if (!useful(meta)) continue;
      byId[id] = { ...meta, source: 'cache' };
    }
    return byId;
  }

  function publishDetails(path, byId, error) {
    const payload = { source: 'minaflix-sync', type: 'details', path, byId, error: error || null };
    try {
      const origin = typeof location !== 'undefined' && /^https?:/.test(location.origin) ? location.origin : '*';
      window.postMessage(payload, origin);
    } catch {
      // The service worker still receives the returned value.
    }
    return payload;
  }

  function readLiveCaches(win, ids) {
    const context = win?.netflix?.reactContext || win?.netflix?.appContext || {};
    const graphql = detailsFromGraphqlCache(graphqlCacheFromWindow(win) || graphqlCacheFromHtml(win?.document?.documentElement?.innerHTML || ''), ids);
    const falcor = detailsFromFalcorCache(win?.netflix?.falcorCache || context.falcorCache || context.models?.falcorCache, ids);
    return publishDetails('cache', { ...falcor, ...graphql }, null);
  }

  function graphqlEndpoint(win) {
    try {
      const api = readMemberApi(win?.netflix?.reactContext || win?.netflix?.appContext);
      const defs = win?.netflix?.reactContext?.models?.serverDefs?.data || win?.netflix?.reactContext?.models?.serverDefs || {};
      const hinted = defs.GRAPHQL_ENDPOINT || defs.graphqlEndpoint || defs.graphqlUrl || api?.graphqlEndpoint;
      if (typeof hinted === 'string' && hinted.includes('graphql')) return hinted;
    } catch {
      // Fall through to the endpoint the signed-in web app uses.
    }
    return GRAPHQL_URL;
  }

  function discoverPersistedQuery(win, operationName) {
    const html = String(win?.document?.documentElement?.innerHTML || '');
    const pattern = new RegExp(`${operationName}[\\s\\S]{0,240}?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`, 'i');
    const match = pattern.exec(html);
    return match ? match[1] : null;
  }

  function unifiedDetailQuery(ids) {
    const fields = [
      '__typename', 'unifiedEntityId', 'videoId', 'title', 'synopsis', 'contextualSynopsis { text }',
      'latestYear', 'releaseYear', 'year', 'runtimeSec', 'displayRuntime', 'seasonCount', 'numSeasons',
      'numSeasonsLabel', 'seasons { totalCount }', 'contentAdvisory { certificationValue }',
      'genreTags { name }', 'genres { name }', 'cast { name }', 'creators { name }', 'directors { name }',
      'storyArt { url }', 'boxArt { url }',
    ].join(' ');
    return {
      query: `query MinaflixDetails($ids: [ID!]!) { unifiedEntities(unifiedEntityIds: $ids) { ${fields} } }`,
      variables: { ids: ids.map((id) => `Video:${id}`) },
    };
  }

  function rawDetailQuery(ids) {
    return unifiedDetailQuery(ids).query;
  }

  function detailModalBody(id, queryId) {
    return {
      operationName: 'DetailModal',
      variables: { videoId: Number(id), opaqueImageFormat: 'WEBP' },
      extensions: { persistedQuery: { id: queryId || DETAIL_MODAL_QUERY_ID, version: 102 } },
    };
  }

  function parseGraphqlDetails(payload) {
    const byId = {};
    const visit = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 8) return;
      const id = videoIdOf(node);
      if (id && !byId[id]) {
        const meta = metadataFromEntity(node, 'graphql');
        if (useful(meta)) byId[id] = meta;
      }
      const values = Array.isArray(node) ? node : Object.values(node);
      for (const value of values) if (value && typeof value === 'object') visit(value, depth + 1);
    };
    visit(payload?.data || null, 0);
    return byId;
  }

  function keepWanted(byId, ids) {
    const wanted = new Set(ids.map(String));
    const kept = {};
    for (const [id, meta] of Object.entries(byId || {})) if (wanted.has(id)) kept[id] = meta;
    return kept;
  }

  function graphqlFailure(payload, status) {
    const message = payload?.errors?.[0]?.message || payload?.error?.message || payload?.error || '';
    if (message) return String(message).slice(0, 240);
    if (status && status !== 200) return `HTTP ${status}`;
    return '';
  }

  async function postGraphql(endpoint, body) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        mode: 'cors',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch { json = null; }
      const parsed = json ? parseGraphqlDetails(json) : {};
      const failure = graphqlFailure(json, response.status);
      if (!response.ok || (failure && !Object.keys(parsed).length)) return { ok: false, error: failure || `HTTP ${response.status}`, json };
      return { ok: true, json };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'graphql fetch failed' };
    }
  }

  async function fetchGraphqlDetails(win, ids) {
    const list = (Array.isArray(ids) ? ids : []).map(String).filter((id) => /^\d{1,12}$/.test(id)).slice(0, 20);
    const endpoint = graphqlEndpoint(win);
    const byId = {};
    const notes = [];
    if (!list.length) return publishDetails('graphql', byId, null);
    const raw = await postGraphql(endpoint, unifiedDetailQuery(list));
    if (raw.ok) Object.assign(byId, keepWanted(parseGraphqlDetails(raw.json), list));
    else if (raw.error) notes.push(raw.error);
    const missing = list.filter((id) => !byId[id]);
    const discovered = discoverPersistedQuery(win, 'DetailModal');
    if (missing.length && !Object.keys(byId).length && discovered) {
      let failures = 0;
      for (const id of missing) {
        const posted = await postGraphql(endpoint, detailModalBody(id, discovered));
        const parsed = posted.ok ? keepWanted(parseGraphqlDetails(posted.json), [id]) : {};
        if (parsed[id]) {
          byId[id] = parsed[id];
          failures = 0;
        } else {
          failures += 1;
          notes.push(posted.error || `DetailModal had no metadata for ${id}`);
          if (failures >= 1) break;
        }
        await sleep(900);
      }
    }
    for (const meta of Object.values(byId)) meta.source = 'graphql';
    const error = Object.keys(byId).length ? null : (notes[0] || 'graphql returned no details');
    return publishDetails('graphql', byId, error);
  }

  function sectionHeading(value) {
    const text = clean(value);
    return !text || /^(episodes|more like this|trailers(?:\s*&\s*more)?|about)$/i.test(text) || /^about\s+/i.test(text);
  }

  function stripAbout(value) {
    return clean(String(value || '').replace(/^about\s+/i, ''));
  }

  function cardTitleOverDetail(cardTitle, detailTitle) {
    const card = clean(cardTitle);
    const detail = clean(detailTitle);
    if (card && !sectionHeading(card)) return card;
    if (detail && !sectionHeading(detail)) return detail;
    const candidates = [stripAbout(detail), stripAbout(card)];
    for (const stripped of candidates) {
      if (stripped && !sectionHeading(stripped) && !/^(episodes|more like this)$/i.test(stripped)) return stripped;
    }
    return card || detail || '';
  }

  function titlesEqual(left, right) {
    const norm = (value) => stripAbout(value).toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/gi, ' ').trim();
    const a = norm(left);
    const b = norm(right);
    return Boolean(a && a === b);
  }

  function directText(node) {
    return clean([...node.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join(' '));
  }

  function labelKind(text) {
    const value = clean(text).replace(/:$/, '');
    if (/^cast$/i.test(value)) return 'cast';
    if (/^genres?$/i.test(value)) return 'genres';
    if (/^creators?$/i.test(value)) return 'creators';
    if (/^directors?$/i.test(value)) return 'directors';
    if (/^this (show|movie|series|film) is$/i.test(value)) return 'moods';
    return '';
  }

  function namesFromText(text) {
    return String(text || '').split(/[,،]/).map((part) => clean(part)).filter((name) => name && name.length < 80 && !labelKind(name) && !/cast:|genres?:|creators?:|directors?:|this (?:show|movie|series|film) is/i.test(name));
  }

  function namesAfterLabel(labelNode) {
    const parent = labelNode.parentElement;
    if (!parent) return [];
    const names = [];
    let seen = false;
    for (const child of parent.childNodes) {
      const element = child.nodeType === 1 ? child : null;
      if (element === labelNode || (element && element.contains(labelNode))) {
        seen = true;
        continue;
      }
      if (!seen) continue;
      const text = clean(child.textContent);
      if (!text) continue;
      if (labelKind(text.split(':')[0])) break;
      names.push(...namesFromText(text));
    }
    return names.slice(0, 16);
  }

  function aboutLists(scope) {
    const found = { cast: [], genres: [], creators: [], directors: [], moods: [] };
    for (const node of scope.querySelectorAll('span, div, dt, p, li')) {
      const own = directText(node).replace(/:$/, '');
      const short = clean(node.textContent);
      const kind = labelKind(own) || (short.length <= 40 ? labelKind(short.replace(/:$/, '')) : '');
      if (!kind || found[kind].length) continue;
      const siblingNames = namesAfterLabel(node);
      const inline = /:\s*(.+)$/.exec(short);
      const names = siblingNames.length ? siblingNames : (inline && short.length <= 240 ? namesFromText(inline[1]) : []);
      if (names.length) found[kind] = names.slice(0, 16);
    }
    const blob = String(scope?.textContent || '').split(/(?=(?:Creators?|Cast|Genres?|Directors?|This (?:Show|Movie|Series|Film) is)\s*:)/i);
    for (const part of blob) {
      const match = /^(creators?|cast|genres?|directors?|this (?:show|movie|series|film) is)\s*:\s*([\s\S]+)$/i.exec(clean(part));
      if (!match) continue;
      const kind = labelKind(match[1]);
      if (!kind || found[kind].length) continue;
      found[kind] = namesFromText(match[2]).slice(0, 16);
    }
    return found;
  }

  function findPreviewModal(doc) {
    const nodes = [...doc.querySelectorAll('[data-uia*="previewModal"], [class*="previewModal"], [data-uia*="preview-modal"]')];
    const generic = [...doc.querySelectorAll('[data-uia*="modal"]')].find((node) => node.querySelector('[data-uia*="synopsis"], [class*="synopsis"], [class*="detailsMetadata"]'));
    return nodes.find((node) => !nodes.some((other) => other !== node && other.contains(node))) || nodes[0] || generic || null;
  }

  function logoTitle(scope) {
    if (!scope) return '';
    const logo = scope.querySelector('[class*="titleTreatment"] img, [class*="title-treatment"] img, img[class*="logo"], [data-uia*="title-treatment"] img, [data-uia*="titleTreatment"] img');
    const raw = clean(logo?.getAttribute('alt')) || clean(logo?.getAttribute('aria-label')) || clean(logo?.closest('[aria-label]')?.getAttribute('aria-label'));
    const title = stripAbout(raw);
    return title && !sectionHeading(title) ? title : '';
  }

  function artworkFromElement(element) {
    if (!element) return [];
    const className = `${element.className || ''} ${element.parentElement?.className || ''}`;
    if (/titleTreatment|title-treatment|logo/i.test(className)) return [];
    const srcset = element.getAttribute?.('srcset') || '';
    const parts = srcset.split(',').map((part) => part.trim()).filter(Boolean);
    const twox = parts.find((part) => /\s2x$/i.test(part));
    const chosen = (twox || parts[parts.length - 1] || '').replace(/\s+\d+(?:\.\d+)?x$/i, '').trim();
    const urls = [chosen, element.currentSrc, element.getAttribute?.('src')].map((value) => artworkUrl(value)).filter(Boolean);
    const style = element.getAttribute?.('style') || '';
    const background = /url\((['"]?)(https:[^)'"]+)\1\)/i.exec(style);
    if (background) {
      const url = artworkUrl(background[2]);
      if (url) urls.push(url);
    }
    return urls;
  }

  function backdropFromModal(scope) {
    const hero = scope.querySelector('[class*="player"], [class*="storyArt"], [class*="boxart"], [class*="billboard"]') || scope;
    const urls = [];
    for (const element of [hero, ...hero.querySelectorAll('img, div')]) urls.push(...artworkFromElement(element));
    return urls.find((src) => /storyart|backdrop|billboard|boxart|hero/i.test(src)) || urls[0] || null;
  }

  function modalMatches(doc, id, expectedTitle) {
    const modal = findPreviewModal(doc);
    if (!modal || !/^\d{1,12}$/.test(String(id || ''))) return false;
    const href = new RegExp(`(?:[?&]jbv=|/title/|/watch/)${id}(?:\\D|$)`);
    const viewUrl = doc.defaultView?.location?.href || '';
    if (href.test(viewUrl)) return true;
    if ([...modal.querySelectorAll('a, [href]')].some((node) => href.test(node.getAttribute('href') || ''))) return true;
    if (modal.querySelector(`[data-videoid="${id}"], [data-video-id="${id}"]`)) return true;
    const logo = logoTitle(modal);
    return Boolean(expectedTitle && logo && titlesEqual(logo, expectedTitle));
  }

  function modalSignature(doc) {
    const modal = findPreviewModal(doc);
    if (!modal) return '';
    const synopsis = clean(modal.querySelector('[data-uia*="synopsis"], [class*="synopsis"]')?.textContent);
    const logo = logoTitle(modal);
    const year = (/\b(?:19|20)\d{2}\b/.exec(clean(modal.querySelector('[class*="detailsMetadata"], [data-uia*="year"], .year')?.textContent)) || [''])[0];
    return `${logo}|${year}|${synopsis}`;
  }

  function metadataFromPreviewModal(doc) {
    const modal = findPreviewModal(doc);
    if (!modal) return null;
    const scope = modal.closest('[role="dialog"]') || modal;
    const synopsis = clean(scope.querySelector('[data-uia*="synopsis"], [class*="synopsis"]')?.textContent);
    const metaText = clean(scope.querySelector('[class*="detailsMetadata"]')?.textContent);
    const yearMatch = /\b(?:19|20)\d{2}\b/.exec(clean(scope.querySelector('[data-uia*="year"], .year')?.textContent) || metaText || '');
    const maturity = clean(scope.querySelector('[class*="maturity"], [data-uia*="maturity"]')?.textContent);
    const durationText = clean(scope.querySelector('[class*="duration"], [data-uia*="runtime"], [data-uia*="duration"]')?.textContent);
    const seasons = seasonsFromText(durationText) || seasonsFromText(metaText);
    const runtimeMinutes = runtimeFromText(durationText) || (/season/i.test(metaText) ? null : runtimeFromText(metaText));
    const about = scope.querySelector('[data-uia*="about"], [class*="about"]') || scope;
    const lists = aboutLists(about);
    const backdrop = backdropFromModal(scope);
    return {
      title: logoTitle(scope),
      synopsis,
      year: yearMatch ? yearMatch[0] : '',
      maturity,
      runtimeMinutes,
      seasons,
      genres: [...new Set([...lists.genres, ...lists.moods])].slice(0, 16),
      cast: lists.cast,
      creators: lists.creators,
      directors: lists.directors,
      mediaType: seasons ? 'tv' : (runtimeMinutes ? 'movie' : null),
      image: null,
      backdrop,
      source: 'modal',
    };
  }

  function closePreviewModal(doc) {
    const button = doc.querySelector('[data-uia*="previewModal-close"], [data-uia*="modal-close"], [class*="previewModal"] button[aria-label*="Close"]');
    if (button && typeof button.click === 'function') button.click();
  }

  function openTitleModal(id) {
    const link = document.querySelector(`a[href*="jbv=${id}"]`);
    if (link && typeof link.click === 'function') {
      link.click();
      return 'click';
    }
    try {
      history.pushState(history.state, '', `/browse?jbv=${id}`);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    } catch {
      // A later full navigation covers a router that ignores pushState.
    }
    return 'pushState';
  }

  async function revealModalAbout(doc) {
    const modal = findPreviewModal(doc);
    if (!modal) return;
    const about = modal.querySelector('[data-uia*="about"], [class*="about"]');
    if (about && typeof about.scrollIntoView === 'function') {
      try { about.scrollIntoView({ block: 'center' }); } catch { about.scrollIntoView(); }
    }
    const scrollers = [modal, ...modal.querySelectorAll('div')].filter((element) => element.scrollHeight > element.clientHeight + 40);
    for (const element of scrollers) element.scrollTop = element.scrollHeight;
    await sleep(350);
  }

  async function waitForMatchingModal(id, expectedTitle, before, timeoutMs) {
    const started = Date.now();
    const limit = timeoutMs || 8000;
    while (Date.now() - started < limit) {
      await revealModalAbout(document);
      const signature = modalSignature(document);
      const meta = metadataFromPreviewModal(document);
      const matches = modalMatches(document, id, expectedTitle);
      if (meta && useful(meta) && matches && signature && signature !== before) {
        meta.source = 'modal';
        meta.title = logoTitle(findPreviewModal(document)) || meta.title;
        return meta;
      }
      await sleep(200);
    }
    return null;
  }

  async function readLiveModal(id, expectedTitle) {
    const before = modalSignature(document);
    closePreviewModal(document);
    await sleep(300);
    const via = openTitleModal(id);
    const meta = await waitForMatchingModal(id, expectedTitle, before, 8000);
    if (!meta) return { path: 'modal', via, error: `skipped ${id}: the open modal did not match this title` };
    closePreviewModal(document);
    publishDetails('modal', { [String(id)]: meta }, null);
    return { path: 'modal', via, meta };
  }

  async function readOpenModal(id, expectedTitle) {
    const before = '';
    const meta = await waitForMatchingModal(id, expectedTitle, before, 12000);
    if (!meta) return { path: 'modal', via: 'navigation', error: `skipped ${id}: the open modal did not match this title` };
    closePreviewModal(document);
    publishDetails('modal', { [String(id)]: meta }, null);
    return { path: 'modal', via: 'navigation', meta };
  }

  root.MinaflixScrape = {
    collectMyList,
    collectViewing,
    findShowMore,
    isSignedOut,
    isActivityUrl,
    netflixIdFromHref,
    expandAndCollect,
    metadataFromApiPayload,
    metadataFromTitleHtml,
    readMemberApi,
    memberApiUrl,
    metadataPaths,
    fetchMemberMetadata,
    fetchPageMetadata,
    attachDetails,
    rowsFromLolomo,
    rowsFromBrowseHtml,
    rowsFromGraphqlCache,
    graphqlCacheFromHtml,
    catalogPaths,
    collectLiveBrowse,
    diagnoseTitleHtml,
    cardImage,
    detailsFromGraphqlCache,
    detailsFromFalcorCache,
    readLiveCaches,
    fetchGraphqlDetails,
    parseGraphqlDetails,
    rawDetailQuery,
    detailModalBody,
    metadataFromPreviewModal,
    openTitleModal,
    readLiveModal,
    readOpenModal,
    cardTitleOverDetail,
    modalMatches,
    sectionHeading,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
