import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';

export function mountWeb(app: Hono) {
  app.get('/', serveStatic({ path: './dist/index.html' }));
  app.get('/assets/*', serveStatic({ root: './dist' }));
  app.get('/favicon.svg', serveStatic({ path: './dist/favicon.svg' }));
}
