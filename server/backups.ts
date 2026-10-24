import { backup, type DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
export async function backupDatabase(db: DatabaseSync, dbPath: string) {
  if (dbPath === ':memory:') return null;
  const directory = process.env.BACKUP_DIR || join(dirname(dbPath), 'backups');
  mkdirSync(directory, { recursive: true });
  const filename = join(
    directory,
    `movie-night-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`
  );
  await backup(db, filename);
  return filename;
}
export function resetPendingPicks(db: DatabaseSync, groupId: number) {
  db.exec('BEGIN');
  try {
    db.prepare(
      "DELETE FROM night_selection WHERE night_id IN (SELECT id FROM nights WHERE group_id=? AND status!='completed')"
    ).run(groupId);
    const result = db
      .prepare(
        "UPDATE nights SET winner_id=NULL,movie_id=NULL,draw=NULL,status='planning' WHERE group_id=? AND status!='completed'"
      )
      .run(groupId);
    db.prepare('DELETE FROM wheel_overrides WHERE group_id=?').run(groupId);
    db.exec('COMMIT');
    return Number(result.changes);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
