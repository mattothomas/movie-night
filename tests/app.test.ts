import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import type { State } from '../src/types.js';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function setup(dbPath = ':memory:') {
  const { app, db } = createApp(dbPath);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  function client() {
    let cookie = '';
    return async function request(
      path: string,
      body?: unknown,
      headers: Record<string, string> = {}
    ) {
      const response = await fetch(root + '/api' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const c = response.headers.get('set-cookie');
      if (c) cookie = c.split(';')[0];
      return { status: response.status, data: await response.json() };
    };
  }
  const a = client(),
    b = client(),
    c = client();
  await a('/auth/register', { username: 'alex', password: 'a strong password' });
  const state = (await a('/state')).data as State;
  for (const [request, username] of [
    [b, 'jamie'],
    [c, 'sam'],
  ] as const)
    await request('/auth/register', {
      username,
      password: 'a strong password',
      invite: state.group.invite,
    });
  return {
    a,
    b,
    c,
    client,
    db,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve()))
      );
      db.close();
    },
  };
}
test('unknown movies qualify; seen history is permanent and scoped to attendees', async () => {
  const f = await setup();
  try {
    let s: State = (await f.a('/state')).data;
    assert.equal(s.movies.length, 100);
    assert.ok(s.movies.every((m) => m.eligible));
    assert.equal(s.members.length, 3);
    assert.equal(s.night.attendees.length, 3);
    const id = s.movies[0].id;
    assert.equal((await f.b('/preferences', { movieId: id, reaction: 'seen_loved' })).status, 200);
    s = (await f.a('/state')).data;
    assert.equal(s.movies.find((m) => m.id === id)?.eligible, false);
    assert.equal((await f.b('/preferences', { movieId: id, reaction: 'unseen' })).status, 400);
    await f.a('/night/settings', { attendees: [s.user.id], mode: 'equal', date: s.night.date });
    s = (await f.a('/state')).data;
    assert.equal(s.movies.find((m) => m.id === id)?.eligible, true);
    assert.equal(
      (await f.b('/state')).data.movies.find((m: any) => m.id === id).reaction,
      'seen_loved'
    );
  } finally {
    await f.close();
  }
});
test('spin locks once across clients; only winner chooses; veto permanently saves seen', async () => {
  const f = await setup();
  try {
    let s: State = (await f.a('/state')).data;
    const result = await f.a('/night/spin', {});
    assert.equal(result.status, 200);
    assert.ok(s.members.some((m) => m.id === result.data.winnerId));
    assert.equal((await f.b('/night/spin', {})).status, 409);
    assert.equal(
      (
        await f.a('/night/settings', {
          attendees: [s.user.id],
          mode: 'performance',
          date: s.night.date,
        })
      ).status,
      409
    );
    const clients = [f.a, f.b, f.c];
    const states = await Promise.all(clients.map((c) => c('/state')));
    const picker = clients[states.findIndex((x) => x.data.user.id === result.data.winnerId)];
    const other = clients.find((c) => c !== picker)!;
    const movieId = s.movies[0].id;
    assert.equal((await other('/night/pick', { movieId })).status, 403);
    assert.equal((await picker('/night/pick', { movieId })).status, 200);
    assert.equal((await other('/night/veto', {})).status, 200);
    s = (await f.a('/state')).data;
    assert.equal(s.night.movie_id, null);
    assert.equal(s.movies.find((m) => m.id === movieId)?.eligible, false);
    assert.equal((await picker('/night/pick', { movieId })).status, 409);
    assert.equal((await other('/preferences', { movieId, reaction: 'unseen' })).status, 400);
  } finally {
    await f.close();
  }
});
test('finish records only attendees, ratings update taste and performance weights', async () => {
  const f = await setup();
  try {
    let s: State = (await f.a('/state')).data;
    await f.a('/night/settings', { attendees: [s.user.id], mode: 'equal', date: s.night.date });
    await f.a('/night/spin', {});
    const movieId = s.movies[0].id;
    await f.a('/night/pick', { movieId });
    assert.equal((await f.a('/night/finish', {})).status, 409);
    assert.equal((await f.a('/night/start', {})).status, 200);
    assert.equal((await f.b('/night/finish', {})).status, 403);
    const result = await f.a('/night/finish', {});
    assert.equal(result.status, 200);
    s = (await f.a('/state')).data;
    assert.equal(s.movies.find((m) => m.id === movieId)?.reaction, 'seen_okay');
    assert.equal(
      (await f.b('/state')).data.movies.find((m: any) => m.id === movieId).reaction,
      'unseen'
    );
    assert.equal((await f.b('/ratings', { nightId: result.data.nightId, score: 5 })).status, 403);
    assert.equal((await f.a('/ratings', { nightId: result.data.nightId, score: 5 })).status, 200);
    s = (await f.a('/state')).data;
    assert.equal(s.movies.find((m) => m.id === movieId)?.reaction, 'seen_loved');
    await f.a('/night/settings', {
      attendees: s.members.map((m) => m.id),
      mode: 'performance',
      date: s.night.date,
    });
    s = (await f.a('/state')).data;
    assert.ok(
      s.weights.find((w) => w.id === s.user.id)!.chance >
        s.weights.find((w) => w.id !== s.user.id)!.chance
    );
    assert.ok(Math.abs(s.weights.reduce((sum, w) => sum + w.chance, 0) - 100) < 0.0001);
    assert.equal((await f.a('/ratings', { nightId: result.data.nightId, score: 0 })).status, 400);
  } finally {
    await f.close();
  }
});
test('private groups, authentication, CSRF, and logout isolate data', async () => {
  const f = await setup();
  try {
    const outsider = f.client();
    assert.equal((await outsider('/state')).status, 401);
    assert.equal(
      (
        await outsider('/auth/register', {
          username: 'outside',
          password: 'a strong password',
          invite: 'NOPE',
        })
      ).status,
      400
    );
    await outsider('/auth/register', { username: 'outside', password: 'a strong password' });
    const out = (await outsider('/state')).data;
    const s = (await f.a('/state')).data;
    assert.notEqual(out.group.id, s.group.id);
    assert.equal(out.members.length, 1);
    assert.equal(
      (await f.a('/night/spin', {}, { Origin: 'https://untrusted.example' })).status,
      403
    );
    assert.equal(
      (await f.a('/night/settings', { attendees: [s.user.id], mode: 'equal', date: '2026-99-99' }))
        .status,
      400
    );
    assert.equal(
      (await f.a('/auth/login', { username: 'alex', password: 'incorrect' })).status,
      401
    );
    await f.a('/auth/logout', {});
    assert.equal((await f.a('/state')).status, 401);
    assert.equal(
      (await f.a('/auth/login', { username: 'alex', password: 'a strong password' })).status,
      200
    );
  } finally {
    await f.close();
  }
});
test('accounts, hashed sessions, and permanent viewing history survive a database restart', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'movie-night-'));
  const dbPath = path.join(directory, 'test.sqlite');
  const f = await setup(dbPath);
  let movieId = '';
  try {
    const s: State = (await f.a('/state')).data;
    movieId = s.movies[0].id;
    await f.a('/preferences', { movieId, reaction: 'seen_loved', queued: true });
  } finally {
    await f.close();
  }
  const restored = createApp(dbPath);
  try {
    const stored = restored.db
      .prepare('SELECT * FROM preferences WHERE movie_id=?')
      .get(movieId) as any;
    assert.equal(stored.reaction, 'seen_loved');
    assert.equal(stored.queued, 1);
    assert.equal(restored.db.prepare('SELECT COUNT(*) AS count FROM users').get()!.count, 3);
    const session = restored.db.prepare('SELECT token FROM sessions LIMIT 1').get() as any;
    assert.match(session.token, /^[a-f0-9]{64}$/);
    const user = restored.db.prepare('SELECT password FROM users LIMIT 1').get() as any;
    assert.notEqual(user.password, 'a strong password');
  } finally {
    restored.db.close();
    rmSync(directory, { recursive: true });
  }
});
test('watchlist priorities are shared, IMDb imports validate and preserve history', async () => {
  const f = await setup();
  try {
    let s: State = (await f.a('/state')).data;
    const movie = s.movies[0];
    await f.b('/preferences', { movieId: movie.id, queued: true, priority: true });
    s = (await f.a('/state')).data;
    assert.equal(s.movies[0].id, movie.id);
    assert.equal(s.movies[0].queuedBy.length, 1);
    assert.equal(s.movies[0].queued, false);
    await f.a('/preferences', { movieId: movie.id, reaction: 'seen_liked' });
    const imported = {
      id: movie.id,
      title: movie.title,
      year: movie.year,
      genres: movie.genres,
      runtime: movie.runtime,
    };
    assert.equal((await f.a('/catalog/import', { movies: [imported] })).status, 400);
    assert.equal(
      (await f.a('/catalog/import', { movies: [imported], englishOnlyConfirmed: true })).status,
      200
    );
    s = (await f.a('/state')).data;
    assert.equal(s.movies.find((m) => m.id === movie.id)?.reaction, 'seen_liked');
    assert.equal(s.movies.find((m) => m.id === movie.id)?.source, 'imdb-import');
    assert.equal(
      (
        await f.a('/catalog/import', {
          movies: [{ ...imported, id: 'bad' }],
          englishOnlyConfirmed: true,
        })
      ).status,
      400
    );
  } finally {
    await f.close();
  }
});
test('comparison feedback is stored and changes recommendation affinities', async () => {
  const f = await setup();
  try {
    const s: State = (await f.a('/state')).data;
    const sciFi = s.movies.find((m) => m.title === 'Arrival')!,
      drama = s.movies.find((m) => m.title === '12 Angry Men')!;
    const uid = s.user.id;
    const insert = f.db.prepare(
      "INSERT INTO nights(group_id,date,status,attendees,winner_id,movie_id) VALUES(?,?,'completed',?,?,?)"
    );
    const n1 = Number(
      insert.run(s.group.id, '2026-10-09', JSON.stringify([uid]), uid, drama.id).lastInsertRowid
    );
    const n2 = Number(
      insert.run(s.group.id, '2026-10-16', JSON.stringify([uid]), uid, sciFi.id).lastInsertRowid
    );
    await f.a('/ratings', { nightId: n1, score: 3 });
    await f.a('/ratings', { nightId: n2, score: 3 });
    const before = (await f.a('/state')).data.movies.find(
      (m: any) => m.title === 'Interstellar'
    ).score;
    assert.equal(
      (await f.a('/ratings', { nightId: n2, score: 3, comparisonId: n1, comparison: 'better' }))
        .status,
      200
    );
    const after = (await f.a('/state')).data;
    assert.ok(after.movies.find((m: any) => m.title === 'Interstellar').score > before);
    assert.equal(after.nights.find((n: any) => n.id === n2).ratings[0].comparison, 'better');
    assert.equal(
      (await f.a('/ratings', { nightId: n1, score: 4, comparisonId: n2, comparison: 'better' }))
        .status,
      400
    );
  } finally {
    await f.close();
  }
});
