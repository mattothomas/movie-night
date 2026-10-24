import type { DatabaseSync } from 'node:sqlite';
import type { TasteMovie } from './recommender.js';
const HOST = 'https://api.themoviedb.org/3';
export type CatalogMovie = TasteMovie & {
  source: string;
  posterPath: string | null;
  language: string;
};
export class CatalogError extends Error {
  constructor(
    message: string,
    public status = 503
  ) {
    super(message);
  }
}
export class TmdbCatalog {
  constructor(
    private db: DatabaseSync,
    private token = process.env.TMDB_API_READ_TOKEN || '',
    private request: typeof fetch = fetch
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS provider_cache(id INTEGER PRIMARY KEY,data TEXT NOT NULL,fetched_at INTEGER NOT NULL)'
    );
  }
  get configured() {
    return !!this.token;
  }
  async json(path: string, params: Record<string, string> = {}) {
    if (!this.token)
      throw new CatalogError(
        'Connect TMDB in environment settings to load official posters and more movies.'
      );
    const url = new URL(HOST + path);
    for (const [k, v] of Object.entries({ ...params, language: 'en-US' }))
      url.searchParams.set(k, v);
    let response: Response;
    try {
      response = await this.request(url, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new CatalogError(
        'The movie catalog could not be reached. Your saved movies and ratings are safe.'
      );
    }
    if (!response.ok)
      throw new CatalogError(
        response.status === 401
          ? 'TMDB rejected the configured token. Check its value in environment settings.'
          : response.status === 429
            ? 'The movie catalog is busy. Try again in a moment.'
            : `The movie catalog returned HTTP ${response.status}.`
      );
    return response.json();
  }
  async details(id: number): Promise<CatalogMovie | null> {
    const cached = this.db
      .prepare('SELECT data,fetched_at FROM provider_cache WHERE id=?')
      .get(id) as any;
    if (cached && cached.fetched_at > Date.now() - 7 * 86400000) return JSON.parse(cached.data);
    const m = await this.json(`/movie/${id}`, {
      append_to_response: 'credits,keywords,recommendations',
    });
    if (m.original_language !== 'en' || m.adult) return null;
    const movie: CatalogMovie = {
      id: /^tt\d+$/.test(m.imdb_id || '') ? m.imdb_id : `tmdb:${m.id}`,
      tmdbId: m.id,
      title: m.title,
      year: Number(m.release_date?.slice(0, 4)) || 0,
      genres: (m.genres || []).map((g: any) => g.name),
      runtime: m.runtime || 0,
      source: 'tmdb',
      posterPath: /^\/[a-zA-Z0-9_.-]+$/.test(m.poster_path || '') ? m.poster_path : null,
      language: 'en',
      keywords: (m.keywords?.keywords || []).map((k: any) => String(k.name).toLowerCase()),
      directors: (m.credits?.crew || [])
        .filter((c: any) => c.job === 'Director')
        .map((c: any) => String(c.id)),
      cast: (m.credits?.cast || []).slice(0, 6).map((c: any) => String(c.id)),
      neighbors: (m.recommendations?.results || [])
        .filter((r: any) => r.original_language === 'en' && !r.adult)
        .map((r: any) => r.id),
      quality: m.vote_average || 0,
      votes: m.vote_count || 0,
    };
    this.db
      .prepare(
        'INSERT INTO provider_cache VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at'
      )
      .run(id, JSON.stringify(movie), Date.now());
    return movie;
  }
  async resolve(imdbId: string) {
    const result = await this.json(`/find/${imdbId}`, { external_source: 'imdb_id' });
    const match = result.movie_results?.find((m: any) => m.original_language === 'en' && !m.adult);
    return match ? this.details(match.id) : null;
  }
  async discover(page = 1, genre?: string) {
    return this.json('/discover/movie', {
      with_original_language: 'en',
      include_adult: 'false',
      sort_by: genre ? 'popularity.desc' : 'vote_average.desc',
      'vote_count.gte': genre ? '150' : '1000',
      page: String(page),
      ...(genre ? { with_genres: genre } : {}),
    });
  }
  async search(query: string, page = 1) {
    return this.json('/search/movie', { query, page: String(page), include_adult: 'false' });
  }
  async recentReleases(page = 1) {
    const today = new Date(),
      start = new Date(today);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    return this.json('/discover/movie', {
      with_original_language: 'en',
      include_adult: 'false',
      sort_by: 'primary_release_date.desc',
      'primary_release_date.gte': start.toISOString().slice(0, 10),
      'primary_release_date.lte': today.toISOString().slice(0, 10),
      'vote_count.gte': '25',
      page: String(page),
    });
  }
  async expand(ids: number[], limit = 20) {
    const unique = [...new Set(ids)].slice(0, limit);
    const movies: CatalogMovie[] = [];
    for (let i = 0; i < unique.length; i += 4) {
      const results = await Promise.all(unique.slice(i, i + 4).map((id) => this.details(id)));
      movies.push(...results.filter((m): m is CatalogMovie => !!m));
    }
    return movies;
  }
}
