import express, { type Request, type Response, type NextFunction } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomInt, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { starterMovies, type Movie } from './catalog.js';
import { TmdbCatalog, CatalogError } from './tmdb.js';
import { CatalogService } from './catalog-service.js';
import { rankMovies, diverseDeck } from './recommender.js';

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
export function createApp(
  dbPath = process.env.DB_PATH || 'data/movie-night.sqlite',
  options: {
    authMode?: 'friends' | 'accounts';
    catalog?: { token?: string; request?: typeof fetch };
    imageRequest?: typeof fetch;
  } = {}
) {
  const authMode =
    options.authMode || (process.env.AUTH_MODE === 'accounts' ? 'accounts' : 'friends');
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
  db.exec(`CREATE TABLE IF NOT EXISTS friend_profiles(name TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),group_id INTEGER REFERENCES groups(id));
CREATE TABLE IF NOT EXISTS review_batches(id INTEGER PRIMARY KEY,user_id INTEGER,kind TEXT,movie_ids TEXT,created_at INTEGER,completed INTEGER DEFAULT 0);`);
  db.exec(
    'CREATE TABLE IF NOT EXISTS review_answers(batch_id INTEGER,movie_id TEXT,PRIMARY KEY(batch_id,movie_id))'
  );
  const catalog = new CatalogService(
    db,
    new TmdbCatalog(db, options.catalog?.token, options.catalog?.request)
  );
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
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://image.tmdb.org; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
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
    const u = get(
      'SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?',
      createHash('sha256').update(token).digest('hex'),
      Date.now()
    );
    if (u) {
      const friend = !!get('SELECT name FROM friend_profiles WHERE user_id=?', u.id);
      if ((authMode === 'friends') !== friend) return;
    }
    return u;
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
  function groupMovies(groupId: number): (Movie & import('./recommender.js').TasteMovie)[] {
    return all(
      'SELECT m.*,d.details FROM movies m LEFT JOIN movie_metadata d ON d.group_id=m.group_id AND d.movie_id=m.id WHERE m.group_id=? ORDER BY m.rowid',
      groupId
    ).map((m) => ({
      ...m,
      ...(m.details ? JSON.parse(m.details) : {}),
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
    if (authMode === 'friends' && ['/register', '/login', '/demo'].includes(req.path))
      return res
        .status(404)
        .json({ error: 'Account sign-in is disabled. Choose your name instead.' });
    next();
  });
  app.get('/api/auth', (req, res) => {
    const user = session(req);
    res.json({
      mode: authMode,
      profiles: authMode === 'friends' ? ['Chris', 'Matthew', 'Yash'] : [],
      user: user
        ? {
            id: user.id,
            username:
              get('SELECT name FROM friend_profiles WHERE user_id=?', user.id)?.name ||
              user.username,
          }
        : null,
    });
  });
  app.post('/api/auth/friend', (req, res) => {
    if (authMode !== 'friends')
      return res.status(404).json({ error: 'Friend profiles are disabled.' });
    const name = ['Chris', 'Matthew', 'Yash'].find((n) => n === req.body.name);
    const pin = typeof req.body.pin === 'string' ? req.body.pin : '';
    const expected = process.env.FRIEND_GROUP_PIN || '449';
    if (
      !name ||
      !timingSafeEqual(
        createHash('sha256').update(pin).digest(),
        createHash('sha256').update(expected).digest()
      )
    )
      return res.status(401).json({ error: 'That code isn’t correct. Try again.' });
    let profile = get('SELECT * FROM friend_profiles WHERE name=?', name);
    if (!profile) {
      db.exec('BEGIN');
      try {
        let group = get('SELECT group_id FROM friend_profiles LIMIT 1');
        if (!group) {
          const created = run(
            'INSERT INTO groups(name,invite) VALUES(?,?)',
            'The Friday Club',
            randomBytes(5).toString('hex').toUpperCase()
          );
          group = { group_id: Number(created.lastInsertRowid) };
          seed(group.group_id);
        }
        for (const member of ['Chris', 'Matthew', 'Yash']) {
          if (get('SELECT name FROM friend_profiles WHERE name=?', member)) continue;
          const username = get('SELECT id FROM users WHERE username=?', member)
            ? `${member}_${randomBytes(4).toString('hex')}`
            : member;
          const result = run(
            'INSERT INTO users(username,password,group_id) VALUES(?,?,?)',
            username,
            passwordHash(randomBytes(32).toString('hex')),
            group.group_id
          );
          run(
            'INSERT INTO friend_profiles VALUES(?,?,?)',
            member,
            result.lastInsertRowid,
            group.group_id
          );
        }
        db.exec('COMMIT');
        profile = get('SELECT * FROM friend_profiles WHERE name=?', name);
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    }
    setSession(res, profile.user_id);
    res.json({ ok: true });
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
  app.post('/api/catalog/refresh', async (req, res) => {
    try {
      res.json(await catalog.refresh(res.locals.user.group_id, !!req.body.force));
    } catch (e) {
      res.status(e instanceof CatalogError ? e.status : 503).json({ error: (e as Error).message });
    }
  });
  app.post('/api/catalog/search', async (req, res) => {
    const query = typeof req.body.query === 'string' ? req.body.query.trim() : '';
    const page = req.body.page ?? 1;
    if (query.length < 2 || query.length > 100 || !Number.isInteger(page) || page < 1 || page > 500)
      return res.status(400).json({ error: 'Enter a movie title and a valid page.' });
    try {
      res.json(await catalog.search(res.locals.user.group_id, query, page));
    } catch (e) {
      res.status(503).json({ error: (e as Error).message });
    }
  });
  app.get('/api/catalog/poster/:id', async (req, res) => {
    const u: User = res.locals.user;
    const id = String(req.params.id);
    if (!get('SELECT id FROM movies WHERE group_id=? AND id=?', u.group_id, id))
      return res.status(404).json({ error: 'Movie not found.' });
    const cached = get(
      'SELECT details FROM movie_metadata WHERE group_id=? AND movie_id=?',
      u.group_id,
      id
    );
    if (cached) return res.json({ posterPath: JSON.parse(cached.details).posterPath });
    try {
      const movie = /^tt\d+$/.test(id)
        ? await catalog.provider.resolve(id)
        : /^tmdb:\d+$/.test(id)
          ? await catalog.provider.details(Number(id.slice(5)))
          : null;
      if (movie) catalog.store(u.group_id, { ...movie, id });
      res.json({ posterPath: movie?.posterPath || null });
    } catch (e) {
      res.status(503).json({ error: (e as Error).message });
    }
  });
  const posterImages = new Map<string, { bytes: Buffer; type: string; expires: number }>();
  const pendingImages = new Map<
    string,
    Promise<{ bytes: Buffer; type: string; expires: number }>
  >();
  app.get('/api/catalog/image/:id', async (req, res) => {
    const row = get(
      'SELECT d.details FROM movie_metadata d JOIN movies m ON m.group_id=d.group_id AND m.id=d.movie_id WHERE d.group_id=? AND d.movie_id=?',
      res.locals.user.group_id,
      String(req.params.id)
    );
    const path = row ? JSON.parse(row.details).posterPath : null;
    if (typeof path !== 'string' || !/^\/[a-zA-Z0-9_.-]+$/.test(path))
      return res.status(404).json({ error: 'Poster not available.' });
    try {
      let image = posterImages.get(path);
      if (!image || image.expires < Date.now()) {
        let pending = pendingImages.get(path);
        if (!pending) {
          pending = (async () => {
            // Fixed official host; no caller-supplied URLs or credentials are forwarded.
            const response = await (options.imageRequest || fetch)(
              `https://image.tmdb.org/t/p/w500${path}`,
              { signal: AbortSignal.timeout(15000), redirect: 'error' }
            );
            const type = response.headers.get('content-type')?.split(';')[0] || '';
            if (
              !response.ok ||
              !['image/jpeg', 'image/png', 'image/webp'].includes(type) ||
              Number(response.headers.get('content-length') || 0) > 5_000_000
            )
              throw new Error('Poster download failed.');
            const bytes = Buffer.from(await response.arrayBuffer());
            if (bytes.length > 5_000_000) throw new Error('Poster exceeds size limit.');
            const value = { bytes, type, expires: Date.now() + 86400000 };
            posterImages.set(path, value);
            while (
              posterImages.size > 100 ||
              [...posterImages.values()].reduce((n, m) => n + m.bytes.length, 0) > 20_000_000
            )
              posterImages.delete(posterImages.keys().next().value!);
            return value;
          })().finally(() => pendingImages.delete(path));
          pendingImages.set(path, pending);
        }
        image = await pending;
      }
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.type(image.type).send(image.bytes);
    } catch {
      res.status(502).json({ error: 'Poster could not be loaded. Try again shortly.' });
    }
  });
  app.post('/api/review/start', async (req, res) => {
    const u: User = res.locals.user;
    const kind = req.body.kind;
    if (!['starter', 'weekly'].includes(kind))
      return res.status(400).json({ error: 'Choose a starter or Friday review.' });
    let batch = get(
      'SELECT * FROM review_batches WHERE user_id=? AND kind=? AND completed=0 ORDER BY id DESC LIMIT 1',
      u.id,
      kind
    );
    let warning: string | null = null;
    if (!batch) {
      if (catalog.provider.configured)
        try {
          await catalog.refresh(u.group_id);
        } catch (e) {
          warning = (e as Error).message;
        }
      const movies = groupMovies(u.group_id),
        preferences = prefs(u.group_id),
        n = currentNight(u.group_id),
        attendees = JSON.parse(n.attendees);
      const mine = preferences.filter((p) => p.user_id === u.id);
      const reviewed = new Set(mine.filter((p) => p.reviewed).map((p) => p.movie_id));
      const pool = movies.filter(
        (m) => !reviewed.has(m.id) && (kind === 'starter' || eligible(u.group_id, n, m.id))
      );
      const comparisons = all(
        'SELECT r.user_id,r.comparison,n.movie_id,p.movie_id AS previous_movie_id FROM ratings r JOIN nights n ON n.id=r.night_id JOIN nights p ON p.id=r.comparison_id WHERE n.group_id=?',
        u.group_id
      );
      const chosen =
        kind === 'starter'
          ? pool
              .sort(
                (a, b) =>
                  Number(b.source === 'tmdb') - Number(a.source === 'tmdb') ||
                  ((b as any).quality || 0) - ((a as any).quality || 0)
              )
              .slice(0, Math.max(0, 50 - reviewed.size))
          : diverseDeck(
              rankMovies(movies, preferences, attendees, comparisons).filter((m) =>
                pool.some((p) => p.id === m.id)
              ),
              20
            );
      const movieIds = chosen.map((m) => m.id);
      if (!movieIds.length)
        return res.json({ batch: { id: null, kind, movieIds: [], answered: [] }, warning });
      const result = run(
        'INSERT INTO review_batches(user_id,kind,movie_ids,created_at) VALUES(?,?,?,?)',
        u.id,
        kind,
        JSON.stringify(movieIds),
        Date.now()
      );
      batch = get('SELECT * FROM review_batches WHERE id=?', result.lastInsertRowid);
    }
    res.json({
      batch: {
        id: batch.id,
        kind: batch.kind,
        movieIds: JSON.parse(batch.movie_ids),
        answered: all('SELECT movie_id FROM review_answers WHERE batch_id=?', batch.id).map(
          (x) => x.movie_id
        ),
      },
      warning,
    });
  });
  app.get('/api/state', (_req, res) => {
    const u: User = res.locals.user;
    const group = get('SELECT * FROM groups WHERE id=?', u.group_id);
    const members = all(
      'SELECT u.id,COALESCE(f.name,u.username) AS username FROM users u LEFT JOIN friend_profiles f ON f.user_id=u.id WHERE u.group_id=? ORDER BY u.id',
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
    const ranked = rankMovies(movies, preferences, attendees, comparisons);
    const scored = ranked.map((m) => {
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
      const eligible = !seenBy.some((id) => attendees.includes(id));
      return {
        ...m,
        predictions: undefined,
        details: undefined,
        keywords: undefined,
        directors: undefined,
        cast: undefined,
        neighbors: undefined,
        quality: undefined,
        votes: undefined,
        posterPath: (m as any).posterPath || null,
        catalogIndex: movies.findIndex((x) => x.id === m.id),
        reaction: personal?.reaction ?? 'unseen',
        reviewed: !!personal?.reviewed,
        queued: !!personal?.queued,
        priority: !!personal?.priority,
        seenBy,
        queuedBy,
        eligible,
        approved: eligible,
        confirmedUnseen:
          eligible &&
          attendees.every((id) =>
            preferences.some(
              (p) =>
                p.user_id === id && p.movie_id === m.id && p.reviewed && p.reaction === 'unseen'
            )
          ),
      };
    });
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
      authMode,
      catalog: catalog.status(u.group_id),
      onboarding: {
        target: 50,
        reviewed: Math.min(50, preferences.filter((p) => p.user_id === u.id && p.reviewed).length),
        members: members.map((m) => ({
          id: m.id,
          reviewed: Math.min(
            50,
            preferences.filter((p) => p.user_id === m.id && p.reviewed).length
          ),
        })),
      },
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
    const { movieId, reaction, queued, priority, batchId } = req.body;
    const batch = batchId
      ? get('SELECT * FROM review_batches WHERE id=? AND user_id=?', batchId, u.id)
      : null;
    if (batchId && (!batch || !JSON.parse(batch.movie_ids).includes(movieId)))
      return res.status(400).json({ error: 'That movie is not in your review batch.' });
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
    if (reaction?.startsWith('seen'))
      run('INSERT OR IGNORE INTO catalog_dirty VALUES(?)', u.group_id);
    if (batch && reaction !== undefined) {
      run('INSERT OR IGNORE INTO review_answers VALUES(?,?)', batch.id, movieId);
      const answered = get(
        'SELECT COUNT(*) AS count FROM review_answers WHERE batch_id=?',
        batch.id
      ).count;
      if (answered >= JSON.parse(batch.movie_ids).length)
        run('UPDATE review_batches SET completed=1 WHERE id=?', batch.id);
    }
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
    run('INSERT OR IGNORE INTO catalog_dirty VALUES(?)', u.group_id);
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
