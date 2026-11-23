(function attachMinaflixYoutube(root) {
  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function youtubeSearchUrl(title, year) {
    const query = [clean(title), clean(year), 'official trailer Netflix'].filter(Boolean).join(' ');
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  }

  function runsText(node) {
    if (!node) return '';
    if (typeof node === 'string') return clean(node);
    if (typeof node.simpleText === 'string') return clean(node.simpleText);
    if (Array.isArray(node.runs)) return clean(node.runs.map((run) => run?.text || '').join(''));
    return '';
  }

  function extractYtInitialData(html) {
    const source = String(html || '');
    const marker = source.indexOf('ytInitialData');
    if (marker < 0) return null;
    const brace = source.indexOf('{', marker);
    if (brace < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = brace; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(source.slice(brace, index + 1)); } catch { return null; }
        }
      }
    }
    return null;
  }

  function videoFromRenderer(renderer) {
    const trailerYoutubeId = clean(renderer?.videoId);
    if (!/^[A-Za-z0-9_-]{11}$/.test(trailerYoutubeId)) return null;
    return {
      trailerYoutubeId,
      trailerTitle: runsText(renderer.title),
      trailerChannel: runsText(renderer.ownerText) || runsText(renderer.longBylineText) || runsText(renderer.shortBylineText),
    };
  }

  function videoRenderers(node, found, depth) {
    if (!node || typeof node !== 'object' || depth > 14 || found.length >= 12) return;
    if (node.videoRenderer) {
      const video = videoFromRenderer(node.videoRenderer);
      if (video) found.push(video);
      return;
    }
    const values = Array.isArray(node) ? node : Object.values(node);
    for (const value of values) {
      if (value && typeof value === 'object') videoRenderers(value, found, depth + 1);
    }
  }

  function normalizeTitle(value) {
    return clean(value).toLowerCase().normalize('NFKC').replace(/&/g, ' and ').replace(/[^a-z0-9\u0600-\u06ff]+/gi, ' ').trim();
  }

  function isOfficialChannel(channel) {
    const name = clean(channel).toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
    if (name === 'still watching netflix') return true;
    return name === 'netflix' || name.startsWith('netflix ');
  }

  function scoreTrailer(video, title) {
    const show = normalizeTitle(title);
    const label = normalizeTitle(video.trailerTitle);
    const hasName = Boolean(show && label.includes(show));
    const hasTrailer = /\btrailer\b|\bteaser\b|إعلان/.test(label);
    const official = isOfficialChannel(video.trailerChannel);
    if (official && hasName && hasTrailer) return 100;
    if (official && hasName) return 80;
    if (hasName && hasTrailer) return 60;
    if (hasName) return 20;
    return 0;
  }

  function pickTrailer(html, title) {
    const data = typeof html === 'object' && html ? html : extractYtInitialData(html);
    const videos = [];
    videoRenderers(data, videos, 0);
    let best = null;
    let bestScore = 0;
    for (const video of videos) {
      const score = scoreTrailer(video, title);
      if (score > bestScore) {
        best = video;
        bestScore = score;
      }
    }
    if (best) return best;
    const firstNamed = videos.find((video) => scoreTrailer(video, title) > 0);
    return firstNamed || null;
  }

  root.MinaflixYoutube = {
    youtubeSearchUrl,
    extractYtInitialData,
    pickTrailer,
    isOfficialChannel,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
