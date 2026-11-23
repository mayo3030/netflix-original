export type Language = 'en' | 'ar';

export type MediaType = 'movie' | 'tv';

export type Pattern = 'arch' | 'orbit' | 'dune' | 'kiln';

export type CastMember = {
  id: number;
  name: string;
  nameAr: string;
  character: string;
  characterAr: string;
  profileUrl: string | null;
};

export type Credit = {
  label: string;
  url: string;
};

export type Title = {
  id: string;
  source: 'mock' | 'tmdb';
  mediaType: MediaType;
  title: string;
  titleAr: string;
  overview: string;
  overviewAr: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  rating: number;
  year: string;
  genreIds: number[];
  genreNames: string[];
  hue: number;
  pattern: Pattern;
  trailerKey: string | null;
  runtime: number | null;
  seasons: number | null;
  cast: CastMember[];
  detailsLoaded: boolean;
  detailsError: boolean;
  openCinema: boolean;
  credit: Credit | null;
  netflixId: string | null;
};

export type CatalogRow = {
  id: string;
  title: string;
  titleAr: string;
  titles: Title[];
};

export type View = 'home' | 'search' | 'list' | 'import';
