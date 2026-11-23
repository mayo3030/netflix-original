import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./youtube.js', import.meta.url), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const api = sandbox.MinaflixYoutube;

function page(videos) {
  const data = {
    contents: {
      sectionListRenderer: {
        contents: [{
          itemSectionRenderer: {
            contents: videos.map((video) => ({
              videoRenderer: {
                videoId: video.id,
                title: { runs: [{ text: video.title }] },
                ownerText: { runs: [{ text: video.channel }] },
              },
            })),
          },
        }],
      },
    },
  };
  return `<script>var ytInitialData = ${JSON.stringify(data)};</script>`;
}

describe('youtube trailers', () => {
  it('builds a read-only official-trailer search', () => {
    const url = api.youtubeSearchUrl('Heartland', '2007');
    expect(url.startsWith('https://www.youtube.com/results?search_query=')).toBe(true);
    expect(decodeURIComponent(url)).toContain('Heartland 2007 official trailer Netflix');
    expect(url).not.toMatch(/manifest|license|netflix\.com\/watch/i);
  });

  it('prefers an official Netflix channel trailer over an earlier fan upload', () => {
    const picked = api.pickTrailer(page([
      { id: 'eeeeeeeeeee', title: 'Heartland Trailer', channel: 'Random Clips' },
      { id: 'fffffffffff', title: 'Heartland | Official Trailer', channel: 'Still Watching Netflix' },
    ]), 'Heartland');
    expect(picked).toEqual({
      trailerYoutubeId: 'fffffffffff',
      trailerTitle: 'Heartland | Official Trailer',
      trailerChannel: 'Still Watching Netflix',
    });
    expect(api.isOfficialChannel('Netflix Jr.')).toBe(true);
    expect(api.isOfficialChannel('Netflix Family')).toBe(true);
    expect(api.isOfficialChannel('Random Clips')).toBe(false);
  });

  it('keeps the first title-and-trailer result when the official channel names a different video', () => {
    const picked = api.pickTrailer(page([
      { id: 'ddddddddddd', title: 'Heartland Trailer', channel: 'Clips' },
      { id: 'eeeeeeeeeee', title: 'Official Trailer', channel: 'Netflix' },
    ]), 'Heartland');
    expect(picked.trailerYoutubeId).toBe('ddddddddddd');
  });

  it('uses a title that names the show and Trailer when no official channel is present', () => {
    const picked = api.pickTrailer(page([
      { id: 'ccccccccccc', title: 'Morning cooking', channel: 'Food' },
      { id: 'ddddddddddd', title: 'Heartland Trailer', channel: 'Clips' },
    ]), 'Heartland');
    expect(picked.trailerYoutubeId).toBe('ddddddddddd');
  });

  it('returns nothing when the results are unrelated', () => {
    expect(api.pickTrailer(page([
      { id: 'aaaaaaaaaaa', title: 'Morning cooking', channel: 'Food' },
    ]), 'Heartland')).toBeNull();
    expect(api.pickTrailer('<html>consent</html>', 'Heartland')).toBeNull();
  });
});
