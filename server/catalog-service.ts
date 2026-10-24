import type { DatabaseSync } from 'node:sqlite';
import { TmdbCatalog, type CatalogMovie } from './tmdb.js';
export class CatalogService {
  private pending = new Map<number, Promise<{ added: number }>>();
  constructor(
    private db: DatabaseSync,
    readonly provider: TmdbCatalog
  ) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS movie_metadata(group_id INTEGER,movie_id TEXT,tmdb_id INTEGER,details TEXT,PRIMARY KEY(group_id,movie_id));CREATE TABLE IF NOT EXISTS catalog_dirty(group_id INTEGER PRIMARY KEY);CREATE TABLE IF NOT EXISTS catalog_state(group_id INTEGER PRIMARY KEY,page INTEGER DEFAULT 0,updated_at INTEGER DEFAULT 0,last_error TEXT);`
    );
  }
  status(groupId: number) {
    const s = this.db.prepare('SELECT * FROM catalog_state WHERE group_id=?').get(groupId) as any;
    return {
      configured: this.provider.configured,
      provider: 'TMDB',
      lastSync: s?.updated_at || null,
      error: s?.last_error || null,
    };
  }
  store(groupId: number, m: CatalogMovie) {
    const existing = this.db
      .prepare('SELECT movie_id FROM movie_metadata WHERE group_id=? AND tmdb_id=?')
      .get(groupId, m.tmdbId!) as any;
    const id = existing?.movie_id || m.id;
    this.db
      .prepare(
        'INSERT INTO movies VALUES(?,?,?,?,?,?,?) ON CONFLICT(group_id,id) DO UPDATE SET title=excluded.title,year=excluded.year,genres=excluded.genres,runtime=excluded.runtime,source=excluded.source'
      )
      .run(groupId, id, m.title, m.year, JSON.stringify(m.genres), m.runtime, m.source);
    this.db
      .prepare(
        'INSERT INTO movie_metadata VALUES(?,?,?,?) ON CONFLICT(group_id,movie_id) DO UPDATE SET tmdb_id=excluded.tmdb_id,details=excluded.details'
      )
      .run(groupId, id, m.tmdbId!, JSON.stringify({ ...m, id }));
    return id;
  }
  async search(groupId: number, query: string, page: number) {
    const list = await this.provider.search(query, page);
    const movies = await this.provider.expand(
      (list.results || [])
        .filter((m: any) => m.original_language === 'en' && !m.adult)
        .map((m: any) => m.id)
    );
    return {
      ids: movies.map((m) => this.store(groupId, m)),
      page,
      totalPages: Math.min(500, list.total_pages || 1),
    };
  }
  refresh(groupId: number, force = false) {
    const existing = this.pending.get(groupId);
    if (existing) return existing;
    const state = this.db
      .prepare('SELECT * FROM catalog_state WHERE group_id=?')
      .get(groupId) as any;
    if (
      !this.db.prepare('SELECT group_id FROM catalog_dirty WHERE group_id=?').get(groupId) &&
      state?.updated_at > Date.now() - (force ? 60000 : 600000)
    )
      return Promise.resolve({ added: 0 });
    const operation = this.perform(groupId, state)
      .catch((e) => {
        this.db
          .prepare(
            'INSERT INTO catalog_state(group_id,last_error) VALUES(?,?) ON CONFLICT(group_id) DO UPDATE SET last_error=excluded.last_error'
          )
          .run(groupId, e.message);
        throw e;
      })
      .finally(() => this.pending.delete(groupId));
    this.pending.set(groupId, operation);
    return operation;
  }
  private async perform(groupId: number, state: any) {
    let added = 0,
      page = state?.page || 0;
    // Each member contributes seeds, so the most prolific rater cannot own discovery.
    const users = this.db.prepare('SELECT id FROM users WHERE group_id=?').all(groupId) as any[];
    const neighborIds: number[] = [];
    for (const user of users) {
      const favorites = this.db
        .prepare(
          "SELECT p.movie_id FROM preferences p JOIN users u ON u.id=p.user_id WHERE u.group_id=? AND p.user_id=? AND p.reaction IN ('seen_loved','seen_liked') ORDER BY CASE p.reaction WHEN 'seen_loved' THEN 0 ELSE 1 END, p.rowid DESC LIMIT 2"
        )
        .all(groupId, user.id) as any[];
      for (const favorite of favorites) {
        let row = this.db
          .prepare('SELECT details FROM movie_metadata WHERE group_id=? AND movie_id=?')
          .get(groupId, favorite.movie_id) as any;
        if (!row && /^tt\d+$/.test(favorite.movie_id)) {
          const m = await this.provider.resolve(favorite.movie_id);
          if (m) {
            this.store(groupId, { ...m, id: favorite.movie_id });
            row = { details: JSON.stringify(m) };
          }
        }
        if (row) {
          const m = JSON.parse(row.details);
          neighborIds.push(...(m.neighbors || []));
        }
      }
    }
    const known = new Set(
      (
        this.db.prepare('SELECT tmdb_id FROM movie_metadata WHERE group_id=?').all(groupId) as any[]
      ).map((x) => x.tmdb_id)
    );
    const neighbors = await this.provider.expand(
      [...new Set(neighborIds)].filter((id) => !known.has(id)),
      18
    );
    for (const m of neighbors) {
      this.store(groupId, m);
      added++;
    }
    // Paginated catalog discovery continues beyond the initial library on every refresh.
    for (let i = 0; i < (state?.updated_at ? 1 : 3); i++) {
      page = page >= 500 ? 1 : page + 1;
      const result = await this.provider.discover(page);
      const ids = (result.results || [])
        .filter((m: any) => m.original_language === 'en' && !m.adult)
        .map((m: any) => m.id);
      for (const m of await this.provider.expand(ids)) {
        this.store(groupId, m);
        added++;
      }
    }
    // Enrich unhydrated starter/history titles, including dislikes, for richer negative feedback.
    const hydrate = this.db
      .prepare(
        "SELECT m.id FROM movies m LEFT JOIN movie_metadata d ON d.group_id=m.group_id AND d.movie_id=m.id LEFT JOIN preferences p ON p.movie_id=m.id AND p.user_id IN (SELECT id FROM users WHERE group_id=?) WHERE m.group_id=? AND d.movie_id IS NULL GROUP BY m.id ORDER BY MAX(CASE WHEN p.reaction='seen_bad' THEN 2 WHEN p.reviewed=1 THEN 1 ELSE 0 END) DESC,m.rowid LIMIT 4"
      )
      .all(groupId, groupId) as any[];
    for (const row of hydrate) {
      if (!/^tt\d+$/.test(row.id)) continue;
      const m = await this.provider.resolve(row.id);
      if (m) this.store(groupId, { ...m, id: row.id });
    }
    this.db
      .prepare(
        'INSERT INTO catalog_state(group_id,page,updated_at,last_error) VALUES(?,?,?,NULL) ON CONFLICT(group_id) DO UPDATE SET page=excluded.page,updated_at=excluded.updated_at,last_error=NULL'
      )
      .run(groupId, page, Date.now());
    this.db.prepare('DELETE FROM catalog_dirty WHERE group_id=?').run(groupId);
    return { added };
  }
}
