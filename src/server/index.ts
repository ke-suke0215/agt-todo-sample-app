import { serve } from '@hono/node-server';
import { existsSync, mkdirSync } from 'node:fs';
import OpenAI from 'openai';
import { dirname, resolve } from 'node:path';
import { createApp } from './app.ts';
import { createChat } from './chat.ts';
import { mountWeb } from './web.ts';
import { openStore } from './store.ts';

const databasePath = resolve(process.env.TODO_DB_PATH ?? 'data/todo.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });
const store = openStore(databasePath);
const key = process.env.OPENAI_API_KEY?.trim();
const app = createApp(store, key ? createChat(store, new OpenAI({ apiKey: key, logLevel: 'off' })) : undefined);
if (existsSync('dist/index.html')) mountWeb(app);

const port = Number(process.env.TODO_PORT ?? 3001);
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, ({ port: listenPort }) => {
  console.info(`Todo server: http://127.0.0.1:${listenPort}`);
});
