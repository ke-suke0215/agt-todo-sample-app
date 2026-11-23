import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import OpenAI from 'openai';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/app.ts';
import { createChat } from '../src/server/chat.ts';
import { openStore } from '../src/server/store.ts';
import { mountWeb } from '../src/server/web.ts';

export async function listen(app: Hono, port = 0) {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (address) => resolve(address.port));
  server.once('error', reject);
  const assigned = await promise;
  return {
    port: assigned,
    url: `http://127.0.0.1:${assigned}`,
    async [Symbol.asyncDispose]() {
      if ('closeAllConnections' in server) server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

export async function launchTestApp(upstream?: string) {
  const directory = mkdtempSync(join(tmpdir(), 'todo-e2e-'));
  const start = async (port?: number) => {
    const store = openStore(join(directory, 'app.sqlite'));
    const chat = upstream ? createChat(store, new OpenAI({
      baseURL: upstream, apiKey: 'test-only', maxRetries: 0, logLevel: 'off',
    })) : undefined;
    const app = createApp(store, chat);
    mountWeb(app);
    const server = await listen(app, port);
    return { store, server };
  };
  let { store, server } = await start();
  return {
    url: server.url,
    async restart() {
      await server[Symbol.asyncDispose]();
      store[Symbol.dispose]();
      ({ store, server } = await start(server.port));
    },
    async [Symbol.asyncDispose]() {
      await server[Symbol.asyncDispose]();
      store[Symbol.dispose]();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
