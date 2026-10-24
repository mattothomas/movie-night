import { createApp } from '../server/app.js';
import { backupDatabase } from '../server/backups.js';
const dbPath = process.env.DB_PATH || 'data/movie-night.sqlite';
const { db } = createApp(dbPath);
try {
  console.log('Backup created:', await backupDatabase(db, dbPath));
} finally {
  db.close();
}
