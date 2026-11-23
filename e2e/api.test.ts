import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../src/server/app.ts';
import { openStore } from '../src/server/store.ts';

test('Todo作成後、データベースを開き直しても一覧に残る', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'todo-test-'));
  const path = join(directory, 'app.sqlite');
  try {
    let saved: unknown;
    {
      using first = openStore(path);
      const response = await createApp(first).request('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '歯医者を予約する', details: '金曜日\n午後' }),
      });
      assert.equal(response.status, 201);
      saved = await response.json();
    }

    using second = openStore(path);
    const list = await createApp(second).request('/api/todos');
    assert.deepEqual(await list.json(), [saved]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('APIキーなしでもTodoを使え、チャットは設定が必要と案内する', async () => {
  using store = openStore(':memory:');
  const app = createApp(store);
  const status = await app.request('/api/chat/status');
  assert.deepEqual(await status.json(), { enabled: false });
  assert.equal((await app.request('/api/todos')).status, 200);
});
