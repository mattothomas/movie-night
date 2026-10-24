import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { createApp } from '../server/app.js';
import express from 'express';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
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
  await context.addInitScript(() => {
    (window as any).__wheelClicks = 0;
    const original = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const oscillator = original.call(this),
        start = oscillator.start.bind(oscillator);
      oscillator.start = (when?: number) => {
        (window as any).__wheelClicks++;
        start(when);
      };
      return oscillator;
    };
  });
  const page = await context.newPage(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await expect(page.getByRole('button', { name: 'I am Chris', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'I am Chris', exact: true }).click();
  await page.getByLabel('Three-digit club code').fill('000');
  await page.getByRole('button', { name: 'Let me in' }).click();
  await expect(page.getByRole('alert')).toContainText('code');
  await page.getByLabel('Three-digit club code').fill('449');
  await page.getByRole('button', { name: 'Let me in' }).click();
  await expect(page.getByRole('dialog', { name: 'Your first 50' })).toBeVisible();
  await expect(page.getByTestId('swipe-card')).toBeVisible();
  const cdp = await context.newCDPSession(page);
  async function swipe(direction: number) {
    const box = await page.getByTestId('swipe-card').boundingBox();
    assert.ok(box);
    const x = box!.x + box!.width / 2,
      y = box!.y + box!.height / 3;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 6; i++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + direction * i * 18, y: y + 2 }],
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await swipe(-1);
  await expect(page.locator('.review-progress>span').first()).toContainText('02');
  await swipe(1);
  await expect(page.getByRole('heading', { name: 'Seen it. How was it?' })).toBeVisible();
  await page.getByRole('button', { name: 'Loved it', exact: true }).click();
  await expect(page.locator('.review-progress>span').first()).toContainText('03');
  await page.screenshot({ path: '/tmp/movie-night-swipe-mobile.png', fullPage: true });
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Your first 50' })).toBeVisible();
  await expect(page.locator('.review-progress>span').first()).toContainText('03');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.locator('nav').getByRole('button', { name: 'This Friday', exact: true }).click();
  await page.getByRole('button', { name: 'Spin for tonight’s picker' }).click();
  await expect(page.getByRole('button', { name: 'Tonight’s picker is locked in' })).toBeVisible({
    timeout: 10000,
  });
  assert.ok(
    (await page.evaluate(() => (window as any).__wheelClicks)) > 10,
    'wheel should produce repeated click sounds'
  );
  await page.screenshot({ path: '/tmp/movie-night-wheel-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Open group settings' }).click();
  await page.getByRole('button', { name: 'Switch person', exact: true }).click();
  await page.getByRole('button', { name: 'I am Matthew', exact: true }).click();
  await page.getByLabel('Three-digit club code').fill('449');
  await page.getByRole('button', { name: 'Let me in' }).click();
  await expect(page.getByRole('dialog', { name: 'Your first 50' })).toBeVisible();
  await expect(page.locator('.review-progress>span').first()).toContainText('01');
  const state = await (await context.request.get(base + '/api/state')).json();
  assert.equal(state.user.username, 'Matthew');
  assert.equal(state.onboarding.reviewed, 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: mobile profile/PIN login, real touch swipe left/right, saved 50-card progress after reload, independent profiles, wheel audio clicks, and no browser errors.'
  );
} finally {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
}
