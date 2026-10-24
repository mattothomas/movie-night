import express from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { CatalogService } from './catalog-service.js';
import { backupDatabase, resetPendingPicks } from './backups.js';
export function mountAdmin(
  app: express.Express,
  db: DatabaseSync,
  dbPath: string,
  catalog: CatalogService,
  setSession: (res: express.Response, id: number, role?: string) => void
) {
  const router = express.Router();
  router.use((_req, res, next) => {
    if (!['admin', 'tester'].includes(res.locals.user.role))
      return res.status(403).json({ error: 'Matthew’s admin code is required.' });
    next();
  });
  router.get('/', (_req, res) => {
    const groupId = res.locals.user.group_id;
    res.json({
      override: db
        .prepare('SELECT enabled,winner_id FROM wheel_overrides WHERE group_id=?')
        .get(groupId) || { enabled: 0, winner_id: null },
      catalog: catalog.status(groupId),
      cachedMovies: db
        .prepare('SELECT COUNT(*) AS count FROM movies WHERE group_id=?')
        .get(groupId)!.count,
    });
  });
  router.post('/wheel', (req, res) => {
    const groupId = res.locals.user.group_id;
    const { enabled, winnerId } = req.body;
    if (
      typeof enabled !== 'boolean' ||
      (enabled &&
        !db.prepare('SELECT id FROM users WHERE id=? AND group_id=?').get(winnerId, groupId))
    )
      return res.status(400).json({ error: 'Choose a member of this group.' });
    db.prepare(
      'INSERT INTO wheel_overrides VALUES(?,?,?) ON CONFLICT(group_id) DO UPDATE SET enabled=excluded.enabled,winner_id=excluded.winner_id'
    ).run(groupId, Number(enabled), enabled ? winnerId : null);
    res.json({ ok: true });
  });
  router.post('/reset-picks', async (_req, res) => {
    const backupPath = await backupDatabase(db, dbPath);
    const count = resetPendingPicks(db, res.locals.user.group_id);
    res.json({ ok: true, count, backupCreated: !!backupPath });
  });
  router.post('/test/switch', (req, res) => {
    if (res.locals.user.role !== 'tester')
      return res.status(403).json({ error: 'Use the test-group login first.' });
    const profile = db
      .prepare('SELECT user_id FROM test_profiles WHERE user_id=? AND group_id=?')
      .get(req.body.userId, res.locals.user.group_id) as any;
    if (!profile) return res.status(403).json({ error: 'Choose a profile in the test group.' });
    setSession(res, profile.user_id, 'tester');
    res.json({ ok: true });
  });
  router.post('/nights/save', (req, res) => {
    const groupId = res.locals.user.group_id;
    const { nightId, date, movieId, pickerId, attendees, scores = [] } = req.body;
    const validDate =
      typeof date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number.isFinite(Date.parse(date + 'T12:00:00Z')) &&
      new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) === date;
    const members = (db.prepare('SELECT id FROM users WHERE group_id=?').all(groupId) as any[]).map(
      (m) => m.id
    );
    if (
      !validDate ||
      !Array.isArray(attendees) ||
      !attendees.length ||
      new Set(attendees).size !== attendees.length ||
      attendees.some((id) => !members.includes(id)) ||
      !attendees.includes(pickerId) ||
      !db.prepare('SELECT id FROM movies WHERE group_id=? AND id=?').get(groupId, movieId) ||
      !Array.isArray(scores) ||
      new Set(scores.map((r: any) => r.userId)).size !== scores.length ||
      scores.some(
        (r: any) =>
          !attendees.includes(r.userId) || !Number.isInteger(r.score) || r.score < 1 || r.score > 5
      )
    )
      return res
        .status(400)
        .json({ error: 'Choose a valid date, movie, attending picker, and ratings from 1 to 5.' });
    if (
      nightId &&
      !db
        .prepare("SELECT id FROM nights WHERE id=? AND group_id=? AND status='completed'")
        .get(nightId, groupId)
    )
      return res.status(404).json({ error: 'Past movie night not found in this group.' });
    db.exec('BEGIN');
    try {
      let id = nightId;
      if (id) {
        db.prepare(
          'UPDATE nights SET date=?,movie_id=?,winner_id=?,attendees=? WHERE id=? AND group_id=?'
        ).run(date, movieId, pickerId, JSON.stringify(attendees), id, groupId);
        db.prepare('DELETE FROM ratings WHERE night_id=?').run(id);
      } else
        id = Number(
          db
            .prepare(
              "INSERT INTO nights(group_id,date,status,attendees,winner_id,movie_id) VALUES(?,?,'completed',?,?,?)"
            )
            .run(groupId, date, JSON.stringify(attendees), pickerId, movieId).lastInsertRowid
        );
      for (const userId of attendees) {
        const score = scores.find((r: any) => r.userId === userId)?.score;
        const reaction =
          score === 5
            ? 'seen_loved'
            : score === 4
              ? 'seen_liked'
              : score === 3 || !score
                ? 'seen_okay'
                : 'seen_bad';
        db.prepare(
          "INSERT INTO preferences(user_id,movie_id,reaction,reviewed) VALUES(?,?,?,1) ON CONFLICT(user_id,movie_id) DO UPDATE SET reaction=CASE WHEN ? IS NULL AND preferences.reaction LIKE 'seen%' THEN preferences.reaction ELSE excluded.reaction END,reviewed=1"
        ).run(userId, movieId, reaction, score ?? null);
        if (score)
          db.prepare('INSERT INTO ratings(night_id,user_id,score) VALUES(?,?,?)').run(
            id,
            userId,
            score
          );
      }
      db.prepare('INSERT OR IGNORE INTO catalog_dirty VALUES(?)').run(groupId);
      db.exec('COMMIT');
      res.json({ ok: true, nightId: id });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  });
  app.use('/api/admin', router);
}
