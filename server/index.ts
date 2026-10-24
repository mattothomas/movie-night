import { createApp } from './app.js';
import path from 'node:path';
import express from 'express';
const { app, refreshCatalogs } = createApp();
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => console.log(`Movie Night listening on port ${port}`));
const refreshHours = Number(process.env.AUTO_CATALOG_REFRESH_HOURS ?? 24);
if (Number.isFinite(refreshHours) && refreshHours > 0) {
  setTimeout(() => void refreshCatalogs(), 1000).unref();
  setInterval(() => void refreshCatalogs(), Math.max(1, refreshHours) * 3600000).unref();
}
