import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import express from 'express';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
const { app, db } = createApp(':memory:', { authMode: 'friends', catalog: { token: '' } });
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
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const state = async () => await (await context.request.get(base + '/api/state')).json();
  async function login(name: string, pin: string) {
    await page.getByRole('button', { name: `I am ${name}`, exact: true }).click();
    await page.getByLabel('Three-digit club code').fill(pin);
    await page.getByRole('button', { name: 'Let me in' }).click();
  }
  async function logout() {
    await page.getByRole('button', { name: 'Open group settings' }).click();
    await page.getByRole('button', { name: 'Switch person', exact: true }).click();
  }
  await page.goto(base);
  await login('Matthew', '650');
  await expect(page.getByRole('heading', { name: 'The admin board.' })).toBeVisible();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  let s = await state();
  const yash = s.members.find((m: any) => m.username === 'Yash');
  await page.getByLabel('Next picker', { exact: true }).selectOption(String(yash.id));
  await page.getByRole('button', { name: 'Enable next-spin lock' }).click();
  await expect(page.locator('.admin-status').first()).toContainText('ON');
  await page.locator('nav').getByRole('button', { name: 'This Friday', exact: true }).click();
  await page.getByRole('button', { name: 'Spin for tonight’s picker' }).click();
  await expect(page.getByRole('button', { name: 'Tonight’s picker is locked in' })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText('HOST-SELECTED PICKER', { exact: true })).toBeVisible();
  assert.equal((await state()).night.winner_id, yash.id);
  await page.locator('nav').getByRole('button', { name: 'Admin board', exact: true }).click();
  await page.getByRole('button', { name: 'Reset this group’s current picks' }).click();
  await expect.poll(async () => (await state()).night.winner_id).toBeNull();
  await page.getByLabel('Past night date').fill('2024-06-14');
  await page.getByLabel('Past night movie', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Matthew past rating', { exact: true }).selectOption('5');
  await page.getByRole('button', { name: 'Add past night', exact: true }).click();
  await expect
    .poll(async () => (await state()).nights.filter((n: any) => n.status === 'completed').length)
    .toBe(1);
  await page.screenshot({ path: '/tmp/movie-night-admin-mobile.png', fullPage: true });
  await logout();
  await login('Chris', '449');
  await expect(page.getByRole('dialog', { name: 'Your first 50' })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('button', { name: 'Rate our movie', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rate our movie', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'How was our Friday?' })).toBeVisible();
  await page.getByRole('button', { name: 'Rate 4 out of 5', exact: true }).click();
  await page.getByRole('button', { name: 'Save my Friday review' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Rate our movie', exact: true })).not.toBeVisible();
  await expect(
    page.locator('nav').getByRole('button', { name: 'Admin board', exact: true })
  ).not.toBeVisible();
  await logout();
  await login('Matthew', '032');
  await expect(page.locator('.sandbox-banner')).toContainText('TEST GROUP');
  await page.locator('nav').getByRole('button', { name: 'Test controls', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The test screening room.' })).toBeVisible();
  s = await state();
  assert.equal(s.nights.filter((n: any) => n.status === 'completed').length, 0);
  await page.getByLabel('Past night date').fill('2024-06-14');
  await page.getByLabel('Past night movie', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Add past night', exact: true }).click();
  await expect
    .poll(async () => (await state()).nights.filter((n: any) => n.status === 'completed').length)
    .toBe(1);
  await logout();
  await login('Matthew', '650');
  await expect(page.getByRole('heading', { name: 'The admin board.' })).toBeVisible();
  s = await state();
  const completed = s.nights.filter((n: any) => n.status === 'completed');
  assert.equal(completed.length, 1);
  assert.equal(completed[0].ratings.length, 2);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: mobile admin login, one-shot host picker, pick reset, historical entry, another attendee’s rating reminder, permissions, and isolated test-group changes.'
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
}
