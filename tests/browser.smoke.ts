import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { createApp } from '../server/app.js';
import express from 'express';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';

const { app, db } = createApp(':memory:', { authMode: 'accounts', catalog: { token: '' } });
app.use(express.static(path.resolve('dist')));
app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROMIUM_PATH ||
    (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox'],
});
const errors: string[] = [];
try {
  const contexts = await Promise.all(
    [0, 1, 2].map(() => browser.newContext({ viewport: { width: 1440, height: 1050 } }))
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  for (const page of pages) page.on('pageerror', (e) => errors.push(e.message));
  const page = pages[0];
  await page.goto(base);
  await page.getByLabel('Username', { exact: true }).fill('casey');
  await page.getByLabel('Password', { exact: true }).fill('my good movie password');
  await page.getByLabel('Club name').fill('The Test Friday Club');
  await page.getByRole('button', { name: 'Let’s make it a movie night' }).click();
  await expect(page.getByRole('heading', { name: 'Friday looks good on you.' })).toBeVisible();
  let s = await (await contexts[0].request.get(base + '/api/state')).json();
  for (const [i, username] of ['jules', 'riley'].entries()) {
    const r = await contexts[i + 1].request.post(base + '/api/auth/register', {
      data: { username, password: 'my good movie password', invite: s.group.invite },
    });
    expect(r.status()).toBe(201);
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Friday looks good on you.' })).toBeVisible();
  await page.getByRole('button', { name: 'Build my movie memory' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Seen it', exact: true }).click();
  await page.getByRole('button', { name: 'Loved it', exact: true }).click();
  await expect(page.locator('.review-progress>span').first()).toContainText('02');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  s = await (await contexts[0].request.get(base + '/api/state')).json();
  assert.equal(
    s.movies.find((m: any) => m.title === 'The Shawshank Redemption').reaction,
    'seen_loved'
  );
  await page.locator('nav').getByRole('button', { name: 'Approved list' }).click();
  await page.getByRole('textbox', { name: 'Search movies' }).fill('Arrival');
  await page.getByRole('button', { name: 'Add Arrival to watchlist', exact: true }).click();
  await page.locator('nav').getByRole('button', { name: 'Our watchlists' }).click();
  await expect(page.locator('.queue-info>button', { hasText: 'Arrival' })).toBeVisible();
  await page.getByRole('button', { name: 'Move to top', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Top of my queue', exact: true })).toBeVisible();
  await page.locator('nav').getByRole('button', { name: 'This Friday' }).click();
  await page.getByRole('button', { name: 'Spin for tonight’s picker' }).click();
  await expect(page.getByRole('button', { name: 'Tonight’s picker is locked in' })).toBeVisible({
    timeout: 10000,
  });
  s = await (await contexts[0].request.get(base + '/api/state')).json();
  const ids = await Promise.all(
    contexts.map(async (c) => (await (await c.request.get(base + '/api/state')).json()).user.id)
  );
  const winnerIndex = ids.indexOf(s.night.winner_id);
  const picker = pages[winnerIndex];
  if (winnerIndex !== 0) {
    await picker.goto(base);
    await expect(picker.getByRole('heading', { name: 'Friday looks good on you.' })).toBeVisible();
  }
  async function choose(title: string) {
    await picker.locator('nav').getByRole('button', { name: 'Approved list' }).click();
    await picker.getByRole('textbox', { name: 'Search movies' }).fill(title);
    await picker.locator('.movie-title').filter({ hasText: title }).click();
    await picker.getByRole('button', { name: 'This is my Friday pick' }).click();
    await expect(picker.getByRole('dialog')).not.toBeVisible();
    await picker.locator('nav').getByRole('button', { name: 'This Friday' }).click();
  }
  await choose('Arrival');
  await picker.getByRole('button', { name: 'Wait, I’ve seen this', exact: true }).click();
  await expect(picker.getByRole('button', { name: 'We’re pressing play' })).not.toBeVisible();
  s = await (await contexts[winnerIndex].request.get(base + '/api/state')).json();
  assert.equal(s.movies.find((m: any) => m.title === 'Arrival').reaction, 'seen_okay');
  await choose('Knives Out');
  await picker.getByRole('button', { name: 'We’re pressing play' }).click();
  await picker.getByRole('button', { name: 'We finished. Let’s rate it.' }).click();
  await expect(picker.getByRole('heading', { name: 'How was our Friday?' })).toBeVisible();
  await picker.getByRole('button', { name: 'Rate 4 out of 5', exact: true }).click();
  await picker.getByRole('button', { name: 'Save my Friday review' }).click();
  await expect(picker.getByRole('dialog')).not.toBeVisible();
  await picker.locator('nav').getByRole('button', { name: 'Past Fridays' }).click();
  await expect(picker.getByRole('heading', { name: 'Knives Out', exact: true })).toBeVisible();
  await expect(picker.locator('.night-average')).toContainText('4.0');
  for (const context of contexts) {
    const data = await (await context.request.get(base + '/api/state')).json();
    assert.ok(data.movies.find((m: any) => m.title === 'Knives Out').reaction.startsWith('seen'));
  }
  await picker.setViewportSize({ width: 390, height: 844 });
  await expect(picker.getByRole('button', { name: 'Open group settings' })).toBeVisible();
  await picker.getByRole('button', { name: 'Open group settings' }).click();
  await expect(picker.getByRole('dialog')).toBeVisible();
  await picker.getByRole('button', { name: 'Close dialog' }).click();
  assert.equal(
    await picker.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false
  );
  await picker.screenshot({ path: '/tmp/movie-night-history-mobile.png', fullPage: true });
  await picker.getByRole('button', { name: 'Open group settings' }).click();
  await picker.getByRole('button', { name: 'Sign out' }).click();
  await picker.getByRole('button', { name: 'Sign in', exact: true }).click();
  await picker
    .getByLabel('Username', { exact: true })
    .fill(['casey', 'jules', 'riley'][winnerIndex]);
  await picker.getByLabel('Password', { exact: true }).fill('my good movie password');
  await picker.getByRole('button', { name: 'Back to the clubhouse' }).click();
  await expect(picker.getByRole('heading', { name: 'Friday looks good on you.' })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: real signup + invite join, movie memory, watchlist priority, locked spin, picker selection, veto, playback, shared seen history, rating, mobile settings, logout/login. No browser errors.'
  );
} finally {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
}
