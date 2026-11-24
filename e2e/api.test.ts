import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../src/server/app.ts';
import { createDeleteApprovals } from '../src/server/delete-approvals.ts';
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
        body: JSON.stringify({
          title: '歯医者を予約する',
          details: '金曜日\n午後',
        }),
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

test('チャットの削除承認は対象の版と会話に紐づき、一度だけ削除する', () => {
  using store = openStore(':memory:');
  const todo = store.createTodo({
    title: '牛乳',
    details: '駅前',
    status: 'pending',
  });
  const original = store.getTodo(todo.id);
  assert.ok(original);
  const approvals = createDeleteApprovals(store);
  const id = approvals.request('conv_owner', original);
  const first = { decision: 'approve', revision: original.revision } as const;

  assert.deepEqual(approvals.decide('conv_other', id, first), {
    state: 'expired',
  });
  assert.ok(store.getTodo(todo.id));
  store.updateTodo(todo.id, { status: 'in_progress' });
  const refreshed = approvals.decide('conv_owner', id, first);
  assert.equal(refreshed.state, 'changed');
  assert.ok('todo' in refreshed);
  assert.deepEqual(refreshed.todo, { ...todo, status: 'in_progress' });
  assert.deepEqual(approvals.decide('conv_owner', id, first), refreshed);

  const second = { decision: 'approve', revision: refreshed.revision } as const;
  assert.deepEqual(approvals.decide('conv_owner', id, second), {
    state: 'deleted',
  });
  assert.deepEqual(approvals.decide('conv_owner', id, second), {
    state: 'deleted',
  });
  assert.equal(store.getTodo(todo.id), undefined);
});
