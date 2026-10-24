import express, { type Request, type Response, type NextFunction } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomInt, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { starterMovies, type Movie } from './catalog.js';

type User = { id: number; username: string; group_id: number; password: string };
type Night = {
  id: number;
  group_id: number;
  date: string;
  status: string;
  attendees: string;
  winner_id: number | null;
  movie_id: string | null;
  mode: string;
  draw: string | null;
};
const reactions = ['unseen', 'seen_loved', 'seen_liked', 'seen_okay', 'seen_bad'];
export function createApp(dbPath = process.env.DB_PATH || 'data/movie-night.sqlite') {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS groups(id INTEGER PRIMARY KEY, name TEXT NOT NULL, invite TEXT UNIQUE NOT NULL, demo INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE NOT NULL, password TEXT NOT NULL, group_id INTEGER REFERENCES groups(id));
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS movies(group_id INTEGER REFERENCES groups(id), id TEXT, title TEXT, year INTEGER, genres TEXT, runtime INTEGER, source TEXT, PRIMARY KEY(group_id,id));
    CREATE TABLE IF NOT EXISTS preferences(user_id INTEGER REFERENCES users(id), movie_id TEXT, reaction TEXT DEFAULT 'unseen', queued INTEGER DEFAULT 0, priority INTEGER DEFAULT 0, reviewed INTEGER DEFAULT 0, PRIMARY KEY(user_id,movie_id));
    CREATE TABLE IF NOT EXISTS nights(id INTEGER PRIMARY KEY, group_id INTEGER REFERENCES groups(id), date TEXT, status TEXT DEFAULT 'planning', attendees TEXT, winner_id INTEGER REFERENCES users(id), movie_id TEXT, mode TEXT DEFAULT 'equal', draw TEXT);
    CREATE TABLE IF NOT EXISTS ratings(night_id INTEGER REFERENCES nights(id), user_id INTEGER REFERENCES users(id), score INTEGER, comparison_id INTEGER REFERENCES nights(id), comparison TEXT, PRIMARY KEY(night_id,user_id));
  `);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (process.env.NODE_ENV === 'production')
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
      );
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin) {
      try {
        if (new URL(origin).host !== req.get('host'))
          return res.status(403).json({ error: 'Please use this app’s own page.' });
      } catch {
        return res.status(403).json({ error: 'Invalid origin.' });
      }
    }
    next();
  });
  const get = (sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any;
  const all = (sql: string, ...args: any[]) => db.prepare(sql).all(...args) as any[];
  const run = (sql: string, ...args: any[]) => db.prepare(sql).run(...args);
  function passwordHash(password: string) {
    const salt = randomBytes(16).toString('hex');
    return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  }
  function checkPassword(password: string, stored: string) {
    const [salt, hash] = stored.split(':');
    return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 64));
  }
  function session(req: Request): User | undefined {
    const token = req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('mn_session='))
      ?.slice(11);
    if (!token) return;
    return get(
      'SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?',
      createHash('sha256').update(token).digest('hex'),
      Date.now()
    );
  }
  function setSession(res: Response, userId: number) {
    const token = randomBytes(32).toString('hex');
    run('DELETE FROM sessions WHERE expires < ?', Date.now());
    run(
      'INSERT INTO sessions VALUES(?,?,?)',
      createHash('sha256').update(token).digest('hex'),
      userId,
      Date.now() + 1000 * 60 * 60 * 24 * 14
    );
    res.cookie('mn_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure:
        process.env.COOKIE_SECURE === 'true' ||
        (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false'),
      maxAge: 1000 * 60 * 60 * 24 * 14,
      path: '/',
    });
  }
  function requireUser(req: Request, res: Response, next: NextFunction) {
    const user = session(req);
    if (!user) return res.status(401).json({ error: 'Please sign in.' });
    res.locals.user = user;
    next();
  }
  function groupMovies(groupId: number): Movie[] {
    return all('SELECT * FROM movies WHERE group_id=? ORDER BY rowid', groupId).map((m) => ({
      ...m,
      genres: JSON.parse(m.genres),
    }));
  }
  function seed(groupId: number) {
    for (const m of starterMovies)
      run(
        'INSERT OR IGNORE INTO movies VALUES(?,?,?,?,?,?,?)',
        groupId,
        m.id,
        m.title,
        m.year,
        JSON.stringify(m.genres),
        m.runtime,
        m.source
      );
  }
  function friday() {
    const d = new Date();
    const delta = (5 - d.getUTCDay() + 7) % 7;
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  }
  function currentNight(groupId: number) {
    let n = get(
      "SELECT * FROM nights WHERE group_id=? AND status!='completed' ORDER BY id DESC LIMIT 1",
      groupId
    );
    if (!n) {
      const ids = all('SELECT id FROM users WHERE group_id=?', groupId).map((x) => x.id);
      const result = run(
        'INSERT INTO nights(group_id,date,attendees) VALUES(?,?,?)',
        groupId,
        friday(),
        JSON.stringify(ids)
      );
      n = get('SELECT * FROM nights WHERE id=?', result.lastInsertRowid);
    }
    return n as Night;
  }
  function prefs(groupId: number) {
    return all(
      'SELECT p.* FROM preferences p JOIN users u ON u.id=p.user_id WHERE u.group_id=?',
      groupId
    );
  }
  function eligible(groupId: number, n: Night, movieId: string) {
    const ids = JSON.parse(n.attendees) as number[];
    return !prefs(groupId).some(
      (p) => p.movie_id === movieId && ids.includes(p.user_id) && p.reaction.startsWith('seen')
    );
  }
  function weights(groupId: number, n: Night, mode: string) {
    const ids = JSON.parse(n.attendees) as number[];
    const members = all('SELECT id,username FROM users WHERE group_id=?', groupId).filter((u) =>
      ids.includes(u.id)
    );
    const weighted = members.map((u) => {
      const rating = get(
        "SELECT AVG(r.score) AS average FROM ratings r JOIN nights n ON n.id=r.night_id WHERE n.group_id=? AND n.winner_id=? AND n.status='completed'",
        groupId,
        u.id
      );
      return {
        ...u,
        weight:
          mode === 'equal' ? 100 : Math.max(30, Math.round(100 + ((rating.average ?? 3) - 3) * 25)),
      };
    });
    const total = weighted.reduce((s, u) => s + u.weight, 0);
    return weighted.map((u) => ({ ...u, chance: total ? (u.weight / total) * 100 : 0 }));
  }
  const authAttempts = new Map<string, { count: number; until: number }>();
  app.use('/api/auth', (req, res, next) => {
    if (req.method === 'GET') return next();
    const key = req.socket.remoteAddress || 'local';
    const now = Date.now();
    const attempt = authAttempts.get(key);
    if (attempt && attempt.until > now && attempt.count >= 30)
      return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    if (!attempt || attempt.until < now) authAttempts.set(key, { count: 1, until: now + 900000 });
    else attempt.count++;
    next();
  });
  app.get('/api/auth', (req, res) => {
    const user = session(req);
    res.json({ user: user ? { id: user.id, username: user.username } : null });
  });
  app.post('/api/auth/register', (req, res) => {
    const { username, password, invite, groupName } = req.body;
    if (
      typeof username !== 'string' ||
      !/^[a-zA-Z0-9_]{2,24}$/.test(username) ||
      typeof password !== 'string' ||
      password.length < 10 ||
      password.length > 128
    )
      return res.status(400).json({
        error:
          'Use a 2–24 character username (letters, numbers, underscores) and a password of 10–128 characters.',
      });
    if (get('SELECT id FROM users WHERE username=?', username))
      return res.status(409).json({ error: 'That username is taken.' });
    let group = invite
      ? get('SELECT * FROM groups WHERE invite=? AND demo=0', String(invite).trim().toUpperCase())
      : null;
    if (invite && !group) return res.status(400).json({ error: 'That invite code was not found.' });
    if (!group) {
      const result = run(
        'INSERT INTO groups(name,invite) VALUES(?,?)',
        typeof groupName === 'string'
          ? groupName.trim().slice(0, 60) || 'The Friday Club'
          : 'The Friday Club',
        randomBytes(5).toString('hex').toUpperCase()
      );
      group = get('SELECT * FROM groups WHERE id=?', result.lastInsertRowid);
      seed(group.id);
    }
    const result = run(
      'INSERT INTO users(username,password,group_id) VALUES(?,?,?)',
      username,
      passwordHash(password),
      group.id
    );
    const n = get(
      "SELECT * FROM nights WHERE group_id=? AND status='planning' AND winner_id IS NULL ORDER BY id DESC LIMIT 1",
      group.id
    );
    if (n)
      run(
        'UPDATE nights SET attendees=? WHERE id=?',
        JSON.stringify([...JSON.parse(n.attendees), Number(result.lastInsertRowid)]),
        n.id
      );
    setSession(res, Number(result.lastInsertRowid));
    res.status(201).json({ ok: true });
  });
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const u =
      typeof username === 'string' ? get('SELECT * FROM users WHERE username=?', username) : null;
    if (
      typeof password !== 'string' ||
      password.length > 128 ||
      !u ||
      !checkPassword(password, u.password)
    )
      return res.status(401).json({ error: 'Username or password is incorrect.' });
    setSession(res, u.id);
    res.json({ ok: true });
  });
  app.post('/api/auth/logout', (req, res) => {
    const token = req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('mn_session='))
      ?.slice(11);
    if (token)
      run('DELETE FROM sessions WHERE token=?', createHash('sha256').update(token).digest('hex'));
    res.clearCookie('mn_session', { path: '/' });
    res.json({ ok: true });
  });
  app.post('/api/auth/demo', (_req, res) => {
    const suffix = randomBytes(4).toString('hex');
    const g = Number(
      run('INSERT INTO groups(name,invite,demo) VALUES(?,?,1)', 'The Friday Club', `DEMO${suffix}`)
        .lastInsertRowid
    );
    seed(g);
    const ids = ['Alex', 'Jamie', 'Sam'].map((name) =>
      Number(
        run(
          'INSERT INTO users(username,password,group_id) VALUES(?,?,?)',
          `${name}_${suffix}`,
          passwordHash(randomBytes(32).toString('hex')),
          g
        ).lastInsertRowid
      )
    );
    for (let i = 0; i < 18; i++)
      run(
        'INSERT INTO preferences(user_id,movie_id,reaction,reviewed) VALUES(?,?,?,1)',
        ids[i % 3],
        starterMovies[i].id,
        ['seen_loved', 'seen_liked', 'seen_okay'][i % 3]
      );
    for (const [index, id] of [29, 30, 92, 94, 98, 99].entries())
      run(
        'INSERT INTO preferences(user_id,movie_id,queued,priority) VALUES(?,?,1,?)',
        ids[index % 3],
        starterMovies[id].id,
        index < 2 ? 1 : 0
      );
    for (const [index, movieIndex] of [17, 32, 45].entries()) {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - 7 * (3 - index));
      const night = Number(
        run(
          "INSERT INTO nights(group_id,date,status,attendees,winner_id,movie_id) VALUES(?,?,'completed',?,?,?)",
          g,
          date.toISOString().slice(0, 10),
          JSON.stringify(ids),
          ids[index],
          starterMovies[movieIndex].id
        ).lastInsertRowid
      );
      for (const [j, id] of ids.entries()) {
        run(
          'INSERT INTO ratings(night_id,user_id,score) VALUES(?,?,?)',
          night,
          id,
          [5, 4, 4][(j + index) % 3]
        );
        run(
          "INSERT OR IGNORE INTO preferences(user_id,movie_id,reaction,reviewed) VALUES(?,?,'seen_liked',1)",
          id,
          starterMovies[movieIndex].id
        );
      }
    }
    setSession(res, ids[0]);
    res.json({ ok: true });
  });
  app.use('/api', requireUser);
  app.get('/api/state', (_req, res) => {
    const u: User = res.locals.user;
    const group = get('SELECT * FROM groups WHERE id=?', u.group_id);
    const members = all(
      'SELECT id,username FROM users WHERE group_id=? ORDER BY id',
      u.group_id
    ).map((m) => ({ ...m, username: group.demo ? m.username.split('_')[0] : m.username }));
    const n = currentNight(u.group_id);
    const preferences = prefs(u.group_id);
    const movies = groupMovies(u.group_id);
    const attendees = JSON.parse(n.attendees) as number[];
    const comparisons = all(
      'SELECT r.user_id,r.comparison,n.movie_id,previous.movie_id AS previous_movie_id FROM ratings r JOIN nights n ON n.id=r.night_id JOIN nights previous ON previous.id=r.comparison_id WHERE n.group_id=?',
      u.group_id
    );
    const scored = movies
      .map((m, catalogIndex) => {
        const personal = preferences.find((p) => p.user_id === u.id && p.movie_id === m.id);
        const seenBy = members
          .filter((member) =>
            preferences.some(
              (p) => p.user_id === member.id && p.movie_id === m.id && p.reaction.startsWith('seen')
            )
          )
          .map((x) => x.id);
        const queuedBy = preferences
          .filter((p) => p.movie_id === m.id && p.queued)
          .map((p) => ({ id: p.user_id, priority: !!p.priority }));
        const affinities = attendees.map((id) => {
          const rated = preferences.filter(
            (p) => p.user_id === id && p.reaction.startsWith('seen')
          );
          let score = 0;
          for (const p of rated) {
            const watched = movies.find((x) => x.id === p.movie_id);
            if (!watched) continue;
            const overlap = m.genres.filter((g) => watched.genres.includes(g)).length;
            score +=
              overlap *
              ({ seen_loved: 2, seen_liked: 1, seen_okay: 0, seen_bad: -2 }[
                p.reaction as 'seen_loved'
              ] ?? 0);
          }
          for (const c of comparisons.filter((c) => c.user_id === id && c.comparison !== 'same')) {
            const current = movies.find((x) => x.id === c.movie_id),
              previous = movies.find((x) => x.id === c.previous_movie_id);
            const direction = c.comparison === 'better' ? 1 : -1;
            score +=
              direction *
              0.5 *
              (m.genres.filter((g) => current?.genres.includes(g)).length -
                m.genres.filter((g) => previous?.genres.includes(g)).length);
          }
          return score / Math.max(1, rated.length);
        });
        const score =
          (affinities.length
            ? Math.min(...affinities) + affinities.reduce((a, b) => a + b, 0) / affinities.length
            : 0) +
          queuedBy.length * 0.8 +
          queuedBy.filter((p) => p.priority).length * 1.5;
        return {
          ...m,
          catalogIndex,
          reaction: personal?.reaction ?? 'unseen',
          reviewed: !!personal?.reviewed,
          queued: !!personal?.queued,
          priority: !!personal?.priority,
          seenBy,
          queuedBy,
          eligible: !seenBy.some((id) => attendees.includes(id)),
          score,
        };
      })
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    const nights = all(
      'SELECT * FROM nights WHERE group_id=? ORDER BY date DESC,id DESC',
      u.group_id
    ).map((night) => ({
      ...night,
      attendees: JSON.parse(night.attendees),
      draw: night.draw ? JSON.parse(night.draw) : null,
      ratings: all('SELECT * FROM ratings WHERE night_id=?', night.id),
    }));
    res.json({
      user: { id: u.id, username: members.find((m) => m.id === u.id)?.username },
      group,
      members,
      movies: scored,
      night: nights.find((x) => x.id === n.id),
      nights,
      weights: n.draw ? JSON.parse(n.draw) : weights(u.group_id, n, n.mode),
    });
  });
  app.post('/api/preferences', (req, res) => {
    const u: User = res.locals.user;
    const { movieId, reaction, queued, priority } = req.body;
    if (!get('SELECT id FROM movies WHERE group_id=? AND id=?', u.group_id, movieId))
      return res.status(404).json({ error: 'Movie not found.' });
    if (reaction !== undefined && !reactions.includes(reaction))
      return res.status(400).json({ error: 'Invalid reaction.' });
    const old = get('SELECT * FROM preferences WHERE user_id=? AND movie_id=?', u.id, movieId);
    if (old?.reaction.startsWith('seen') && reaction === 'unseen')
      return res.status(400).json({
        error:
          'Seen history is permanent. You can change your reaction, but cannot mark it unseen.',
      });
    run(
      'INSERT INTO preferences(user_id,movie_id,reaction,queued,priority,reviewed) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,movie_id) DO UPDATE SET reaction=excluded.reaction,queued=excluded.queued,priority=excluded.priority,reviewed=excluded.reviewed',
      u.id,
      movieId,
      reaction ?? old?.reaction ?? 'unseen',
      queued === undefined ? (old?.queued ?? 0) : Number(!!queued),
      priority === undefined ? (old?.priority ?? 0) : Number(!!priority),
      reaction !== undefined ? 1 : (old?.reviewed ?? 0)
    );
    res.json({ ok: true });
  });
  app.post('/api/night/settings', (req, res) => {
    const u: User = res.locals.user,
      n = currentNight(u.group_id);
    if (n.winner_id || n.status !== 'planning')
      return res
        .status(409)
        .json({ error: 'Attendance and wheel mode are locked after the spin.' });
    const { attendees, mode, date } = req.body;
    const ids = all('SELECT id FROM users WHERE group_id=?', u.group_id).map((x) => x.id);
    if (
      !Array.isArray(attendees) ||
      !attendees.length ||
      new Set(attendees).size !== attendees.length ||
      attendees.some((id) => !ids.includes(id)) ||
      !['equal', 'performance'].includes(mode) ||
      typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) ||
      new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date
    )
      return res
        .status(400)
        .json({ error: 'Choose a valid date, wheel mode, and at least one group member.' });
    run(
      'UPDATE nights SET attendees=?,mode=?,date=? WHERE id=?',
      JSON.stringify(attendees),
      mode,
      date,
      n.id
    );
    res.json({ ok: true });
  });
  app.post('/api/night/spin', (_req, res) => {
    const u: User = res.locals.user,
      n = currentNight(u.group_id);
    if (n.winner_id) return res.status(409).json({ error: 'This night already has a picker.' });
    const entries = weights(u.group_id, n, n.mode);
    const total = entries.reduce((s, e) => s + e.weight, 0);
    if (!total) return res.status(400).json({ error: 'Add an attendee first.' });
    let ticket = randomInt(total);
    let winner = entries[entries.length - 1];
    for (const entry of entries) {
      if (ticket < entry.weight) {
        winner = entry;
        break;
      }
      ticket -= entry.weight;
    }
    run(
      'UPDATE nights SET winner_id=?,draw=? WHERE id=? AND winner_id IS NULL',
      winner.id,
      JSON.stringify(entries),
      n.id
    );
    res.json({ winnerId: winner.id });
  });
  app.post('/api/night/pick', (req, res) => {
    const u: User = res.locals.user,
      n = currentNight(u.group_id);
    if (n.winner_id !== u.id)
      return res.status(403).json({ error: 'Tonight’s picker gets the final choice.' });
    if (n.status !== 'planning')
      return res.status(409).json({ error: 'This movie night has already started.' });
    const id = req.body.movieId;
    if (!get('SELECT id FROM movies WHERE group_id=? AND id=?', u.group_id, id))
      return res.status(404).json({ error: 'Movie not found.' });
    if (!eligible(u.group_id, n, id))
      return res
        .status(409)
        .json({ error: 'Someone attending has seen this. Pick another movie.' });
    run('UPDATE nights SET movie_id=? WHERE id=?', id, n.id);
    res.json({ ok: true });
  });
  app.post('/api/night/veto', (_req, res) => {
    const u: User = res.locals.user,
      n = currentNight(u.group_id);
    if (n.status !== 'planning' || !n.movie_id)
      return res.status(409).json({ error: 'There is no planned movie to veto.' });
    if (!JSON.parse(n.attendees).includes(u.id))
      return res.status(403).json({ error: 'Only attendees can veto.' });
    run(
      "INSERT INTO preferences(user_id,movie_id,reaction,reviewed) VALUES(?,?,'seen_okay',1) ON CONFLICT(user_id,movie_id) DO UPDATE SET reaction=CASE WHEN preferences.reaction LIKE 'seen%' THEN preferences.reaction ELSE 'seen_okay' END,reviewed=1",
      u.id,
      n.movie_id
    );
    run('UPDATE nights SET movie_id=NULL WHERE id=?', n.id);
    res.json({ ok: true });
  });
  app.post('/api/night/start', (_req, res) => {
    const u: User = res.locals.user,
      n = currentNight(u.group_id);
    if (n.status !== 'planning' || !n.movie_id)
      return res.status(409).json({ error: 'Choose a movie first.' });
    if (!JSON.parse(n.attendees).includes(u.id))
      return res.status(403).json({ error: 'Only attendees can start the night.' });
    if (!eligible(u.group_id, n, n.movie_id))
      return res
        .status(409)
        .json({ error: 'Someone has seen the selected movie. The picker needs to choose again.' });
    run("UPDATE nights SET status='watching' WHERE id=?", n.id);
    res.json({ ok: true });
  });
  app.post('/api/night/finish', (_req, res) => {
    const u: User = res.locals.user,
      n = currentNight(u.group_id);
    if (n.status !== 'watching' || !n.movie_id)
      return res.status(409).json({ error: 'Start the movie first.' });
    if (!JSON.parse(n.attendees).includes(u.id))
      return res.status(403).json({ error: 'Only attendees can finish the night.' });
    db.exec('BEGIN');
    try {
      for (const id of JSON.parse(n.attendees))
        run(
          "INSERT INTO preferences(user_id,movie_id,reaction,reviewed) VALUES(?,?,'seen_okay',1) ON CONFLICT(user_id,movie_id) DO UPDATE SET reaction=CASE WHEN preferences.reaction LIKE 'seen%' THEN preferences.reaction ELSE 'seen_okay' END,reviewed=1",
          id,
          n.movie_id
        );
      run("UPDATE nights SET status='completed' WHERE id=?", n.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.json({ ok: true, nightId: n.id });
  });
  app.post('/api/ratings', (req, res) => {
    const u: User = res.locals.user;
    const { nightId, score, comparisonId, comparison } = req.body;
    const n = get(
      "SELECT * FROM nights WHERE id=? AND group_id=? AND status='completed'",
      nightId,
      u.group_id
    );
    if (!n || !JSON.parse(n.attendees).includes(u.id))
      return res.status(403).json({ error: 'You can rate only movie nights you attended.' });
    if (!Number.isInteger(score) || score < 1 || score > 5)
      return res.status(400).json({ error: 'Choose a rating from 1 to 5.' });
    if (comparisonId) {
      const previous = get(
        "SELECT id FROM nights WHERE id=? AND group_id=? AND status='completed' AND id<?",
        comparisonId,
        u.group_id,
        n.id
      );
      if (!previous || !['better', 'same', 'worse'].includes(comparison))
        return res.status(400).json({ error: 'Choose an earlier movie night to compare.' });
    }
    run(
      'INSERT INTO ratings VALUES(?,?,?,?,?) ON CONFLICT(night_id,user_id) DO UPDATE SET score=excluded.score,comparison_id=excluded.comparison_id,comparison=excluded.comparison',
      n.id,
      u.id,
      score,
      comparisonId || null,
      comparisonId ? comparison : null
    );
    run(
      'UPDATE preferences SET reaction=? WHERE user_id=? AND movie_id=?',
      score === 5
        ? 'seen_loved'
        : score === 4
          ? 'seen_liked'
          : score === 3
            ? 'seen_okay'
            : 'seen_bad',
      u.id,
      n.movie_id
    );
    res.json({ ok: true });
  });
  app.post('/api/catalog/import', (req, res) => {
    const u: User = res.locals.user;
    const { movies, englishOnlyConfirmed } = req.body;
    if (!englishOnlyConfirmed || !Array.isArray(movies) || movies.length < 1 || movies.length > 100)
      return res
        .status(400)
        .json({ error: 'Import 1–100 English-language movies and confirm the language filter.' });
    for (const m of movies)
      if (
        !/^tt\d{7,10}$/.test(m.id) ||
        typeof m.title !== 'string' ||
        !m.title.trim() ||
        m.title.length > 200 ||
        !Number.isInteger(m.year) ||
        m.year < 1880 ||
        m.year > 2100 ||
        !Array.isArray(m.genres) ||
        m.genres.length > 10 ||
        m.genres.some((g: any) => typeof g !== 'string' || g.length > 40) ||
        !Number.isInteger(m.runtime) ||
        m.runtime < 0 ||
        m.runtime > 1000
      )
        return res.status(400).json({
          error: 'Invalid movie data. Use an IMDb CSV export with title IDs, titles, and years.',
        });
    db.exec('BEGIN');
    try {
      for (const m of movies)
        run(
          'INSERT INTO movies VALUES(?,?,?,?,?,?,?) ON CONFLICT(group_id,id) DO UPDATE SET title=excluded.title,year=excluded.year,genres=excluded.genres,runtime=excluded.runtime,source=excluded.source',
          u.group_id,
          m.id,
          m.title.trim(),
          m.year,
          JSON.stringify(m.genres),
          m.runtime,
          'imdb-import'
        );
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.json({ ok: true, count: movies.length });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err.message);
    res.status(err.type === 'entity.parse.failed' ? 400 : 500).json({
      error:
        err.type === 'entity.parse.failed'
          ? 'Invalid JSON.'
          : 'Something went wrong. Please try again.',
    });
  });
  return { app, db };
}
