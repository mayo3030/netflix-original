# MinaFlix

MinaFlix is an independent film and series catalog. It borrows the familiar shape of a streaming home screen — a hero, horizontal rows, a title sheet, search, and a personal list — and uses an original name, mark, and type.

It does not play or download movies. Posters and metadata come from [TMDB](https://www.themoviedb.org/) when you add an API key. Without a key, the app uses a built-in demo catalog. Trailers, when a title has one, are official YouTube embeds. Nothing is saved to disk.

MinaFlix is not affiliated with Netflix or any studio. With a key, it uses the TMDB API but is not endorsed or certified by TMDB.

## What happened to the Python experiment

This repository used to contain a Python experiment for capturing Netflix playback (session cookies, screen recording, and DRM decryption). That code was removed. It does not belong in a metadata catalog, and MinaFlix does not use any of it. MinaFlix does not log in to Netflix, record a screen, or download video.

## Features

- Home page with a hero and horizontal rows: Trending, Top rated, genres, and an Open cinema row in the demo catalog
- Title sheet with overview, rating, cast, and an official YouTube trailer when one exists
- Search across the active catalog
- My List folders stored in `localStorage` in this browser
- Dark theme
- English and Arabic, with `dir="rtl"` for Arabic
- Layout for desktop and for a tall phone (around 384–430px wide, including a Samsung Galaxy S25 Ultra browser viewport)

## Run it

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Vite prints a local URL, usually `http://127.0.0.1:5173`.

```bash
npm run build
npm run preview
```

The preview server uses port `4173`.

The app lives in `minaflix/`. Root `npm` scripts forward to that package.

## TMDB key

The demo catalog is enough to click through every screen. A free TMDB key replaces it with live movies and series.

1. Create an account at [themoviedb.org/signup](https://www.themoviedb.org/signup).
2. Open [API settings](https://www.themoviedb.org/settings/api) and request a Developer API key.
3. Copy the v3 API key.
4. In `minaflix/`, copy the example env file and paste the key:

```bash
cp minaflix/.env.example minaflix/.env
```

```
VITE_TMDB_API_KEY=paste_the_v3_key_here
```

5. Restart `npm run dev`.

Do not commit `minaflix/.env`. The key is a `VITE_` variable, so a production build includes it in the browser bundle. TMDB allows that for the v3 key, but keep the file out of git. For a public deployment, put the key behind your own server and proxy `https://api.themoviedb.org/3` instead of shipping the key.

If the key is missing, rejected, or the network fails, MinaFlix falls back to the demo catalog and says so on screen.

## Demo catalog

Fictional titles are original to this project. The Open cinema row is a set of Creative Commons shorts from the Blender Foundation:

- [Sintel](https://durian.blender.org/) — official trailer only
- [Tears of Steel](https://mango.blender.org/) — official teaser only
- [Big Buck Bunny](https://peach.blender.org/)
- [Elephants Dream](https://orange.blender.org/)

## My List

Folders start as “Watch later” and “Favorites” (للمشاهدة لاحقاً and المفضلة in Arabic). You can create, rename, and delete folders. Membership is saved under `minaflix.mylist.v1` in `localStorage`. The language choice is `minaflix.lang`.

The bookmark on a card toggles Watch later. The title sheet has a checkbox for every folder.

## Import your own Netflix titles

MinaFlix can show the titles on your own Netflix My List and viewing activity. The extension reads those pages in your browser and downloads a JSON file. MinaFlix then imports that file, or Netflix’s own `ViewingActivity.csv` from **Download all**. Nothing is uploaded to a MinaFlix server. Title names are sent to TMDB only when you have set an API key, and only so a poster can be matched. Unmatched titles stay as name cards.

Netflix can change its page markup, so the export may come back empty or partial after a site update. Reading pages this way may also violate Netflix’s terms of service. That risk is yours. The extension does not ask for your password, does not read or store cookies, and does not request video, manifests, or DRM. Catalog details come from the signed-in page: its in-memory cache, the same metadata GraphQL call the site makes, or the preview modal already on screen.

### Load the extension

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose **Load unpacked** and select the `minaflix-sync-extension/` folder.
4. In that same browser, sign in at [netflix.com](https://www.netflix.com/).
5. Click the extension icon, then **Export to MinaFlix**. Keep the popup open.
6. The extension opens your My List, then viewing activity. Netflix currently redirects `/viewingactivity` to `/settings/viewed`; both addresses are accepted. It waits until a watched-title row is actually on the page, then presses **Show More** until that button is gone. An empty My List is a successful export.
7. The popup ends with `Exported N watched, M My List` and downloads `minaflix-netflix-export.json`. If one page fails, the other page is still saved.

Reload the extension after this update so Chrome is running version 1.9.0. **Sync full catalog** reads title details from the inline GraphQL cache, including referenced cast, genre, and synopsis objects. It then asks `unifiedEntities` for `Show` and `Movie` fragments (title, synopsis, contextualSynopsis, cast, creators, directors, genreTags, release year, maturity). `videoId` is not selected on the union, because that field is rejected there. If the server names another undefined field, that field is dropped and the query is retried. A persisted detail operation is replayed only when the signed-in page itself exposes its id. Requests stay at two at a time. The member metadata call reads `jawSummary` and `itemSummary` only. The preview modal is used for whatever is still missing: its About section is opened (never Play), and Cast, Genres, Director, Creators, This show is, maturity, and the synopsis are read only when the modal’s video id matches the card. The card aria-label stays the title. A year-only cache hit does not skip the richer sources. Closing the popup does not stop the sync. The summary counts cache, api, graphql, and modal hits, and a GraphQL failure includes the error body. Play still opens `https://www.netflix.com/watch/<id>` in a new tab. It does not fetch a video stream.

For My List and history, each exported title first asks Netflix’s own member API (the same metadata call the site makes while you are signed in) for box art, synopsis, year, maturity rating, runtime or season count, genres, cast, and creators. That is one batched request, or a few batches if the list is long. If that call fails or a title is missing, it reads that title’s own page instead, using JSON-LD and the page’s social metadata. Each entry records `source` as `api` or `page`. The session token used for the request is not written into the file. MinaFlix shows this metadata on the title sheet even when no TMDB key is set. Images are loaded with `referrerPolicy="no-referrer"`, and a letter placeholder remains if an image fails.

Reload the unpacked extension after an update (`chrome://extensions` → reload). A long watch history can take a few minutes because Show More is clicked slowly.

### Import

1. Run MinaFlix and open **Import**.
2. Choose the JSON file, or a `ViewingActivity.csv` from Netflix’s Download all button.
3. Import. Titles land in the folders **Netflix – My List** and **Netflix – Watched**.
4. Open a title and use **Open on Netflix** to go to `https://www.netflix.com/title/<id>`.

Re-importing replaces those two folders with the new file.

## Project layout

```
minaflix/                         catalog app
minaflix-sync-extension/          read-only Chrome extension
minaflix/src/import/              JSON and CSV parsers
```

## Phone check

On a narrow, tall viewport the header keeps the wordmark and language toggle, and Home / Search / My List sit in a bottom bar with room for the system gesture area. The title sheet becomes a full-screen page. Rows scroll sideways by touch.
