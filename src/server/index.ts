import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import OpenAI from 'openai';
import { createApp } from './app.ts';
import { createChat } from './chat.ts';
import { apiPort } from './local.ts';
import { openStore } from './store.ts';
import { mountWeb } from './web.ts';

const databasePath = resolve(process.env.TODO_DB_PATH ?? 'data/todo.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });
const store = openStore(databasePath);
const key = process.env.OPENAI_API_KEY?.trim();
const app = createApp(
  store,
  key
    ? createChat(store, new OpenAI({ apiKey: key, logLevel: 'off' }))
    : undefined,
);
if (existsSync('dist/index.html')) mountWeb(app);

serve(
  { fetch: app.fetch, port: apiPort, hostname: '127.0.0.1' },
  ({ port: listenPort }) => {
    console.info(`Todo server: http://127.0.0.1:${listenPort}`);
  },
);
