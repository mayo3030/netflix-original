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

## Project layout

```
minaflix/
  index.html
  src/
    api/tmdb.ts          TMDB client
    data/mock.ts         offline catalog
    components/          home, rows, sheet, search, My List
    i18n/                English and Arabic strings
    storage/myList.ts    local folder store
```

## Phone check

On a narrow, tall viewport the header keeps the wordmark and language toggle, and Home / Search / My List sit in a bottom bar with room for the system gesture area. The title sheet becomes a full-screen page. Rows scroll sideways by touch.
