import { createApp } from '../server/app.js';
import { backupDatabase, resetPendingPicks } from '../server/backups.js';
const dbPath = process.env.DB_PATH || 'data/movie-night.sqlite';
const { db } = createApp(dbPath);
try {
  const groups = db
    .prepare(
      'SELECT DISTINCT group_id FROM friend_profiles UNION SELECT DISTINCT group_id FROM test_profiles'
    )
    .all() as { group_id: number }[];
  if (!groups.length)
    console.log('No real or test group exists in this database yet. No picks changed.');
  else {
    const filename = await backupDatabase(db, dbPath);
    let count = 0;
    for (const row of groups) count += resetPendingPicks(db, row.group_id);
    console.log('Unfinished nights reset:', count, 'Backup:', filename);
    console.log('Completed nights, seen history, reactions, and watchlists retained.');
  }
} finally {
  db.close();
}
