import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.js';
import { rankMovies, diverseDeck, type TasteMovie } from '../server/recommender.js';

async function fixture(request?: typeof fetch, imageRequest?: typeof fetch) {
  const { app, db } = createApp(':memory:', {
    authMode: 'friends',
    imageRequest,
    catalog: { token: request ? 'test-token' : '', request },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  function client() {
    let cookie = '';
    return async (path: string, body?: unknown) => {
      const r = await fetch(base + '/api' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const c = r.headers.get('set-cookie');
      if (c) cookie = c.split(';')[0];
      return {
        status: r.status,
        data: r.headers.get('content-type')?.startsWith('image/')
          ? { bytes: (await r.arrayBuffer()).byteLength, type: r.headers.get('content-type') }
          : await r.json(),
      };
    };
  }
  const chris = client(),
    matthew = client(),
    yash = client();
  return {
    chris,
    matthew,
    yash,
    db,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      db.close();
    },
  };
}
test('friends share one persistent club with independent profiles; account routes are disabled', async () => {
  const f = await fixture();
  try {
    const auth = (await f.chris('/auth')).data;
    assert.equal(auth.mode, 'friends');
    assert.deepEqual(auth.profiles, ['Chris', 'Matthew', 'Yash']);
    assert.ok(!JSON.stringify(auth).includes('449'));
    assert.equal((await f.chris('/auth/friend', { name: 'Chris', pin: '000' })).status, 401);
    assert.equal((await f.chris('/auth/friend', { name: 'Someone', pin: '449' })).status, 401);
    for (const [client, name] of [
      [f.chris, 'Chris'],
      [f.matthew, 'Matthew'],
      [f.yash, 'Yash'],
    ] as const)
      assert.equal((await client('/auth/friend', { name, pin: '449' })).status, 200);
    const c = (await f.chris('/state')).data,
      m = (await f.matthew('/state')).data;
    assert.equal(c.group.id, m.group.id);
    assert.deepEqual(
      c.members.map((m: any) => m.username),
      ['Chris', 'Matthew', 'Yash']
    );
    assert.notEqual(c.user.id, m.user.id);
    await f.chris('/preferences', { movieId: c.movies[0].id, reaction: 'seen_loved' });
    assert.equal(
      (await f.matthew('/state')).data.movies.find((x: any) => x.id === c.movies[0].id).reaction,
      'unseen'
    );
    assert.equal(
      (await f.chris('/auth/register', { username: 'new', password: 'password12345' })).status,
      404
    );
    assert.equal((await f.chris('/auth/login', {})).status, 404);
    assert.equal((await f.chris('/auth/demo', {})).status, 404);
  } finally {
    await f.close();
  }
});
test('first 50 and Friday 20 resume across sessions and do not recycle reviewed cards', async () => {
  const f = await fixture();
  try {
    await f.chris('/auth/friend', { name: 'Chris', pin: '449' });
    let result = await f.chris('/review/start', { kind: 'starter' });
    const batch = result.data.batch;
    assert.equal(batch.movieIds.length, 50);
    for (const movieId of batch.movieIds.slice(0, 3))
      await f.chris('/preferences', { movieId, reaction: 'unseen', batchId: batch.id });
    await f.chris('/auth/logout', {});
    await f.chris('/auth/friend', { name: 'Chris', pin: '449' });
    result = await f.chris('/review/start', { kind: 'starter' });
    assert.equal(result.data.batch.id, batch.id);
    assert.equal(result.data.batch.answered.length, 3);
    assert.equal((await f.chris('/state')).data.onboarding.reviewed, 3);
    for (const movieId of batch.movieIds.slice(3))
      assert.equal(
        (await f.chris('/preferences', { movieId, reaction: 'unseen', batchId: batch.id })).status,
        200
      );
    assert.equal((await f.chris('/state')).data.onboarding.reviewed, 50);
    assert.equal(
      (await f.chris('/review/start', { kind: 'starter' })).data.batch.movieIds.length,
      0
    );
    const weekly = (await f.chris('/review/start', { kind: 'weekly' })).data.batch;
    assert.equal(weekly.movieIds.length, 20);
    assert.ok(weekly.movieIds.every((id: string) => !batch.movieIds.includes(id)));
    for (const movieId of weekly.movieIds)
      await f.chris('/preferences', { movieId, reaction: 'unseen', batchId: weekly.id });
    const next = (await f.chris('/review/start', { kind: 'weekly' })).data.batch;
    assert.equal(next.movieIds.length, 20);
    assert.ok(next.movieIds.every((id: string) => !weekly.movieIds.includes(id)));
    assert.equal(
      (
        await f.chris('/preferences', {
          movieId: batch.movieIds[0],
          reaction: 'unseen',
          batchId: next.id,
        })
      ).status,
      400
    );
  } finally {
    await f.close();
  }
});
test('approved list distinguishes explicit consensus; seen feedback removes a movie immediately', async () => {
  const f = await fixture();
  try {
    for (const [client, name] of [
      [f.chris, 'Chris'],
      [f.matthew, 'Matthew'],
      [f.yash, 'Yash'],
    ] as const)
      await client('/auth/friend', { name, pin: '449' });
    const initial = (await f.chris('/state')).data;
    const id = initial.movies[0].id;
    assert.equal(initial.movies[0].approved, true);
    assert.equal(initial.movies[0].confirmedUnseen, false);
    for (const client of [f.chris, f.matthew, f.yash])
      await client('/preferences', { movieId: id, reaction: 'unseen' });
    assert.equal(
      (await f.chris('/state')).data.movies.find((m: any) => m.id === id).confirmedUnseen,
      true
    );
    await f.matthew('/preferences', { movieId: id, reaction: 'seen_liked' });
    assert.equal(
      (await f.chris('/state')).data.movies.find((m: any) => m.id === id).approved,
      false
    );
    const missing = await f.chris('/catalog/refresh', {});
    assert.equal(missing.status, 503);
    assert.match(missing.data.error, /Connect TMDB/);
  } finally {
    await f.close();
  }
});

const loved: TasteMovie = {
  id: 'get-out',
  tmdbId: 1,
  title: 'Get Out',
  year: 2017,
  genres: ['Horror', 'Thriller'],
  runtime: 104,
  keywords: ['social thriller', 'racism'],
  directors: ['Jordan Peele'],
  neighbors: [2],
  quality: 7.8,
  votes: 10000,
};
const related: TasteMovie = {
  id: 'us',
  tmdbId: 2,
  title: 'Us',
  year: 2019,
  genres: ['Horror', 'Thriller'],
  runtime: 116,
  keywords: ['social thriller', 'doppelganger'],
  directors: ['Jordan Peele'],
  quality: 7.2,
  votes: 6000,
};
const generic: TasteMovie = {
  id: 'slasher',
  tmdbId: 3,
  title: 'Generic slasher',
  year: 2015,
  genres: ['Horror', 'Thriller'],
  runtime: 100,
  keywords: ['slasher'],
  quality: 7.2,
  votes: 6000,
};
test('shared love for Get Out lifts nuanced related movies above genre-only matches; dislikes and dissent matter', () => {
  const movies = [loved, related, generic];
  const baseline = rankMovies(movies, [], [1, 2, 3]);
  const positive = [1, 2, 3].map((user_id) => ({
    user_id,
    movie_id: loved.id,
    reaction: 'seen_loved',
    queued: 0,
    priority: 0,
    reviewed: 1,
  }));
  const learned = rankMovies(movies, positive, [1, 2, 3]);
  assert.ok(
    learned.find((m) => m.id === 'us')!.score > learned.find((m) => m.id === 'slasher')!.score
  );
  assert.ok(learned.find((m) => m.id === 'us')!.score > baseline.find((m) => m.id === 'us')!.score);
  const dissent = rankMovies(
    movies,
    positive.map((p) => (p.user_id === 3 ? { ...p, reaction: 'seen_bad' } : p)),
    [1, 2, 3]
  );
  assert.ok(dissent.find((m) => m.id === 'us')!.score < learned.find((m) => m.id === 'us')!.score);
  const diverse = diverseDeck(learned, 2);
  assert.equal(new Set(diverse.map((m) => m.id)).size, 2);
});
test('TMDB catalog supplies official posters, filters non-English titles, and persists canonical IDs', async () => {
  let requests = 0;
  const request = (async (input: URL | RequestInfo, init?: RequestInit) => {
    requests++;
    assert.equal((init?.headers as any).Authorization, 'Bearer test-token');
    const url = new URL(String(input));
    let data: any;
    if (url.pathname.endsWith('/search/movie'))
      data = {
        results: [
          { id: 1, original_language: 'en' },
          { id: 99, original_language: 'fr' },
        ],
        total_pages: 2,
      };
    else if (url.pathname.endsWith('/find/tt0111161')) data = { movie_results: [] };
    else if (url.pathname.includes('/find/')) data = { movie_results: [] };
    else if (url.pathname.endsWith('/discover/movie'))
      data = { results: [{ id: 1, original_language: 'en' }], total_pages: 20 };
    else if (url.pathname.endsWith('/movie/1'))
      data = {
        id: 1,
        imdb_id: 'tt5052448',
        title: 'Get Out',
        release_date: '2017-02-24',
        original_language: 'en',
        poster_path: '/official-get-out.jpg',
        genres: [{ name: 'Horror' }, { name: 'Thriller' }],
        runtime: 104,
        keywords: { keywords: [{ name: 'social thriller' }] },
        credits: { crew: [{ job: 'Director', id: 1 }], cast: [] },
        recommendations: { results: [{ id: 2, original_language: 'en' }] },
        vote_average: 7.8,
        vote_count: 10000,
      };
    else if (url.pathname.endsWith('/movie/2'))
      data = {
        id: 2,
        imdb_id: 'tt6857112',
        title: 'Us',
        release_date: '2019-03-22',
        original_language: 'en',
        poster_path: '/official-us.jpg',
        genres: [{ name: 'Horror' }, { name: 'Thriller' }],
        runtime: 116,
        keywords: { keywords: [{ name: 'social thriller' }] },
        credits: { crew: [{ job: 'Director', id: 1 }], cast: [] },
        recommendations: { results: [] },
        vote_average: 7.2,
        vote_count: 6000,
      };
    else throw new Error('Unexpected provider request ' + url.pathname);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  const f = await fixture(request);
  try {
    await f.chris('/auth/friend', { name: 'Chris', pin: '449' });
    const result = await f.chris('/catalog/search', { query: 'Get Out', page: 1 });
    assert.equal(result.status, 200);
    assert.equal(result.data.ids.length, 1);
    assert.equal(result.data.totalPages, 2);
    let s = (await f.chris('/state')).data;
    const getOut = s.movies.find((m: any) => m.id === 'tt5052448');
    assert.equal(getOut.posterPath, '/official-get-out.jpg');
    assert.equal(getOut.source, 'tmdb');
    const before = requests;
    assert.equal(
      (await f.chris('/catalog/poster/tt5052448')).data.posterPath,
      '/official-get-out.jpg'
    );
    assert.equal(requests, before);
    await f.chris('/preferences', { movieId: getOut.id, reaction: 'seen_loved' });
    assert.equal((await f.chris('/catalog/refresh', {})).status, 200);
    s = (await f.chris('/state')).data;
    assert.ok(s.movies.some((m: any) => m.id === 'tt6857112'));
    assert.equal(s.movies.filter((m: any) => m.id === 'tt5052448').length, 1);
    assert.equal(s.movies.find((m: any) => m.id === 'tt5052448').reaction, 'seen_loved');
    assert.equal(s.catalog.error, null);
  } finally {
    await f.close();
  }
});

test('poster delivery uses a fixed TMDB host, requires a session, caches bytes, and never forwards the token', async () => {
  let calls = 0;
  const imageRequest = (async (input: URL | RequestInfo, init?: RequestInit) => {
    calls++;
    assert.equal(new URL(String(input)).host, 'image.tmdb.org');
    assert.equal(init?.headers, undefined);
    return new Response(new Uint8Array([255, 216, 255, 217]), {
      headers: { 'Content-Type': 'image/jpeg' },
    });
  }) as typeof fetch;
  const f = await fixture(undefined, imageRequest);
  try {
    assert.equal((await f.chris('/catalog/image/tt0111161')).status, 401);
    await f.chris('/auth/friend', { name: 'Chris', pin: '449' });
    const state = (await f.chris('/state')).data;
    f.db
      .prepare('INSERT INTO movie_metadata VALUES(?,?,?,?)')
      .run(state.group.id, 'tt0111161', 278, JSON.stringify({ posterPath: '/shawshank.jpg' }));
    const result = await f.chris('/catalog/image/tt0111161');
    assert.equal(result.status, 200);
    assert.equal(result.data.type, 'image/jpeg');
    assert.equal(result.data.bytes, 4);
    assert.equal((await f.chris('/catalog/image/tt0111161')).status, 200);
    assert.equal(calls, 1);
    assert.equal((await f.chris('/catalog/image/not-in-the-group')).status, 404);
  } finally {
    await f.close();
  }
});
