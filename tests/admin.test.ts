import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { TmdbCatalog } from '../server/tmdb.js';
async function fixture(dbPath = ':memory:') {
  const { app, db } = createApp(dbPath, { authMode: 'friends', catalog: { token: '' } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  function client() {
    let cookie = '';
    return async (endpoint: string, body?: unknown) => {
      const r = await fetch(base + '/api' + endpoint, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const c = r.headers.get('set-cookie');
      if (c) cookie = c.split(';')[0];
      return { status: r.status, data: await r.json() };
    };
  }
  const admin = client(),
    member = client(),
    tester = client();
  await admin('/auth/friend', { name: 'Matthew', pin: '650' });
  await member('/auth/friend', { name: 'Chris', pin: '449' });
  await tester('/auth/friend', { name: 'Matthew', pin: '032' });
  return {
    admin,
    member,
    tester,
    db,
    client,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      db.close();
    },
  };
}
test('admin/test codes grant server-checked roles and the test group is isolated', async () => {
  const f = await fixture();
  try {
    const a = (await f.admin('/state')).data,
      m = (await f.member('/state')).data,
      t = (await f.tester('/state')).data;
    assert.equal(a.user.role, 'admin');
    assert.equal(m.user.role, 'member');
    assert.equal(t.user.role, 'tester');
    assert.equal(a.group.id, m.group.id);
    assert.notEqual(a.group.id, t.group.id);
    assert.equal(t.members.length, 3);
    assert.equal((await f.member('/admin')).status, 403);
    assert.equal((await f.client()('/auth/friend', { name: 'Chris', pin: '650' })).status, 401);
    await f.tester('/preferences', { movieId: t.movies[0].id, reaction: 'seen_loved' });
    assert.equal(
      (await f.admin('/state')).data.movies.find((x: any) => x.id === t.movies[0].id).reaction,
      'unseen'
    );
    assert.equal((await f.tester('/admin/test/switch', { userId: a.user.id })).status, 403);
    assert.equal((await f.tester('/admin/test/switch', { userId: t.members[0].id })).status, 200);
    await f.admin('/auth/logout', {});
    assert.equal((await f.admin('/admin')).status, 401);
  } finally {
    await f.close();
  }
});
test('host selection is one-shot, group-scoped, recorded, and cannot reroll a locked night', async () => {
  const f = await fixture();
  try {
    const s = (await f.admin('/state')).data,
      target = s.members.find((m: any) => m.username === 'Yash').id;
    assert.equal((await f.member('/admin/wheel', { enabled: true, winnerId: target })).status, 403);
    assert.equal((await f.admin('/admin/wheel', { enabled: true, winnerId: target })).status, 200);
    assert.equal((await f.member('/night/spin', {})).data.winnerId, target);
    assert.equal((await f.admin('/admin')).data.override.enabled, 0);
    assert.equal((await f.admin('/state')).data.night.selectionMethod, 'host');
    assert.equal((await f.member('/night/spin', {})).status, 409);
    const t = (await f.tester('/state')).data;
    assert.equal(
      (await f.admin('/admin/wheel', { enabled: true, winnerId: t.user.id })).status,
      400
    );
    await f.admin('/admin/reset-picks', {});
    await f.admin('/night/settings', { attendees: [s.user.id], mode: 'equal', date: s.night.date });
    await f.admin('/admin/wheel', { enabled: true, winnerId: target });
    assert.equal((await f.admin('/night/spin', {})).status, 409);
    assert.equal((await f.admin('/admin')).data.override.enabled, 1);
    await f.admin('/admin/wheel', { enabled: false });
    assert.equal((await f.admin('/night/spin', {})).data.winnerId, s.user.id);
    assert.equal((await f.admin('/state')).data.night.selectionMethod, 'random');
  } finally {
    await f.close();
  }
});
test('past-night editing backfills ratings and seen history while comparisons use dates instead of insertion IDs', async () => {
  const f = await fixture();
  try {
    const s = (await f.admin('/state')).data;
    const base = { attendees: s.members.map((m: any) => m.id), pickerId: s.user.id };
    const first = await f.admin('/admin/nights/save', {
      ...base,
      date: '2024-06-14',
      movieId: s.movies[0].id,
      scores: [{ userId: s.user.id, score: 5 }],
    });
    assert.equal(first.status, 200);
    const older = await f.admin('/admin/nights/save', {
      ...base,
      date: '2024-06-07',
      movieId: s.movies[1].id,
      scores: [],
    });
    assert.equal(older.status, 200);
    assert.ok(older.data.nightId > first.data.nightId);
    assert.equal(
      (
        await f.admin('/ratings', {
          nightId: first.data.nightId,
          score: 4,
          comparisonId: older.data.nightId,
          comparison: 'better',
        })
      ).status,
      200
    );
    assert.equal(
      (
        await f.admin('/ratings', {
          nightId: older.data.nightId,
          score: 4,
          comparisonId: first.data.nightId,
          comparison: 'better',
        })
      ).status,
      400
    );
    let state = (await f.admin('/state')).data;
    assert.equal(state.movies.find((m: any) => m.id === s.movies[0].id).reaction, 'seen_liked');
    assert.equal(state.nights.find((n: any) => n.id === first.data.nightId).ratings.length, 1);
    const edit = await f.admin('/admin/nights/save', {
      ...base,
      nightId: first.data.nightId,
      date: '2024-06-14',
      movieId: s.movies[2].id,
      scores: [{ userId: s.user.id, score: 3 }],
    });
    assert.equal(edit.status, 200);
    state = (await f.admin('/state')).data;
    assert.equal(state.movies.find((m: any) => m.id === s.movies[0].id).reaction, 'seen_liked');
    assert.equal(state.movies.find((m: any) => m.id === s.movies[2].id).reaction, 'seen_okay');
    assert.equal(
      (
        await f.tester('/admin/nights/save', {
          ...base,
          nightId: first.data.nightId,
          date: '2024-06-14',
          movieId: s.movies[2].id,
          scores: [],
        })
      ).status,
      400
    );
    assert.equal(
      (
        await f.admin('/admin/nights/save', {
          ...base,
          nightId: s.night.id,
          date: '2024-06-14',
          movieId: s.movies[2].id,
          scores: [],
        })
      ).status,
      404
    );
  } finally {
    await f.close();
  }
});
test('reset backs up the actual SQLite database and preserves completed nights, reactions, and watchlists', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'movie-night-reset-'));
  const f = await fixture(path.join(directory, 'movie.sqlite'));
  try {
    const s = (await f.admin('/state')).data;
    await f.admin('/preferences', {
      movieId: s.movies[0].id,
      reaction: 'seen_loved',
      queued: true,
    });
    await f.admin('/admin/nights/save', {
      date: '2024-06-14',
      movieId: s.movies[1].id,
      pickerId: s.user.id,
      attendees: [s.user.id],
      scores: [{ userId: s.user.id, score: 5 }],
    });
    await f.admin('/admin/wheel', { enabled: true, winnerId: s.user.id });
    await f.admin('/night/spin', {});
    const result = await f.admin('/admin/reset-picks', {});
    assert.equal(result.status, 200);
    assert.equal(result.data.backupCreated, true);
    const after = (await f.admin('/state')).data;
    assert.equal(after.night.winner_id, null);
    assert.equal(after.night.movie_id, null);
    assert.equal(after.nights.filter((n: any) => n.status === 'completed').length, 1);
    const movie = after.movies.find((m: any) => m.id === s.movies[0].id);
    assert.equal(movie.reaction, 'seen_loved');
    assert.equal(movie.queued, true);
    const files = readdirSync(path.join(directory, 'backups'));
    assert.equal(files.length, 1);
    const copy = new DatabaseSync(path.join(directory, 'backups', files[0]), { readOnly: true });
    assert.ok(
      copy.prepare("SELECT winner_id FROM nights WHERE status='planning'").get()!.winner_id
    );
    copy.close();
  } finally {
    await f.close();
    rmSync(directory, { recursive: true });
  }
});
test('new-release requests include a bounded release window and a lower vote floor than classic discovery', async () => {
  const db = new DatabaseSync(':memory:');
  let requested: URL | undefined;
  const provider = new TmdbCatalog(db, 'test-token', (async (input: URL | RequestInfo) => {
    requested = new URL(String(input));
    return new Response(JSON.stringify({ results: [] }));
  }) as typeof fetch);
  try {
    await provider.recentReleases();
    assert.equal(requested!.searchParams.get('with_original_language'), 'en');
    assert.equal(requested!.searchParams.get('vote_count.gte'), '25');
    assert.equal(requested!.searchParams.get('sort_by'), 'primary_release_date.desc');
    assert.ok(requested!.searchParams.has('primary_release_date.lte'));
    assert.ok(requested!.searchParams.has('primary_release_date.gte'));
  } finally {
    db.close();
  }
});
