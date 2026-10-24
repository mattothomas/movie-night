// Transparent content + neighbor + collaborative feedback model. No claim of a trained LLM.
export type TasteMovie = {
  id: string;
  title: string;
  year: number;
  genres: string[];
  runtime: number;
  tmdbId?: number;
  keywords?: string[];
  directors?: string[];
  cast?: string[];
  neighbors?: number[];
  quality?: number;
  votes?: number;
};
export type Preference = {
  user_id: number;
  movie_id: string;
  reaction: string;
  queued: number;
  priority: number;
  reviewed: number;
};
export type Comparison = {
  user_id: number;
  comparison: string;
  movie_id: string;
  previous_movie_id: string;
};
const values: Record<string, number> = {
  seen_loved: 1,
  seen_liked: 0.6,
  seen_okay: 0,
  seen_bad: -1,
};
function overlap(a: string[] = [], b: string[] = []) {
  if (!a.length || !b.length) return 0;
  const shared = a.filter((x) => b.includes(x)).length;
  return shared / Math.sqrt(a.length * b.length);
}
export function similarity(a: TasteMovie, b: TasteMovie) {
  const normalizeGenres = (genres: string[]) =>
    genres.map((g) => (g === 'Sci-Fi' ? 'Science Fiction' : g));
  const genre = overlap(normalizeGenres(a.genres), normalizeGenres(b.genres)),
    keyword = overlap(a.keywords, b.keywords),
    director = overlap(a.directors, b.directors),
    cast = overlap(a.cast, b.cast);
  const neighbor = !!(
    (b.tmdbId && a.neighbors?.includes(b.tmdbId)) ||
    (a.tmdbId && b.neighbors?.includes(a.tmdbId))
  );
  return Math.min(
    1,
    genre * 0.25 + keyword * 0.4 + director * 0.15 + cast * 0.05 + Number(neighbor) * 0.55
  );
}
export function rankMovies<T extends TasteMovie>(
  movies: T[],
  prefs: Preference[],
  members: number[],
  comparisons: Comparison[] = []
) {
  const byId = new Map(movies.map((m) => [m.id, m]));
  return movies
    .map((movie) => {
      const predictions = members.map((userId) => {
        const history = prefs.filter((p) => p.user_id === userId && p.reaction.startsWith('seen'));
        let sum = 0,
          confidence = 0;
        for (const p of history) {
          const seed = byId.get(p.movie_id);
          if (!seed || seed.id === movie.id) continue;
          const sim = similarity(seed, movie);
          const reaction = values[p.reaction] ?? 0;
          sum += sim * reaction;
          confidence += sim * Math.abs(reaction);
        }
        for (const c of comparisons.filter(
          (c) => c.user_id === userId && c.comparison !== 'same'
        )) {
          const a = byId.get(c.movie_id),
            b = byId.get(c.previous_movie_id);
          if (a && b)
            sum +=
              (c.comparison === 'better' ? 1 : -1) *
              0.3 *
              (similarity(movie, a) - similarity(movie, b));
        }
        const own = prefs.find((p) => p.user_id === userId && p.movie_id === movie.id);
        // Shrink sparse histories toward neutral rather than manufacturing certainty.
        return {
          userId,
          affinity: sum / (1 + confidence),
          confidence: Math.min(1, confidence / 4),
          queueBoost: own?.queued ? (own.priority ? 0.18 : 0.08) : 0,
        };
      });
      const affinities = predictions.map((p) => p.affinity + p.queueBoost);
      const mean = affinities.reduce((a, b) => a + b, 0) / Math.max(1, affinities.length);
      const minimum = affinities.length ? Math.min(...affinities) : 0;
      // Bayesian popularity prior is used internally; never expose provider scores in the UI.
      const votes = movie.votes ?? 0;
      const quality = ((movie.quality ?? 7) * votes + 6.8 * 400) / (votes + 400);
      const score = 0.6 * mean + 0.4 * minimum + (quality - 6.8) * 0.055;
      return { ...movie, score, predictions };
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
export function diverseDeck<T extends TasteMovie & { score: number }>(
  candidates: T[],
  count: number
) {
  const pool = [...candidates],
    selected: T[] = [];
  while (pool.length && selected.length < count) {
    let best = 0,
      bestValue = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const redundancy = selected.length
        ? Math.max(...selected.map((s) => similarity(s, pool[i])))
        : 0;
      // Every fifth card deliberately explores another taste cluster, still from the eligible quality pool.
      const value = pool[i].score - redundancy * (selected.length % 5 === 4 ? 0.65 : 0.16);
      if (value > bestValue) {
        bestValue = value;
        best = i;
      }
    }
    selected.push(pool.splice(best, 1)[0]);
  }
  return selected;
}
