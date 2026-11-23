import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { conversationSchema, todoSchema } from '../contracts.ts';
import type { Todo, TodoInput } from '../contracts.ts';

const owner = 'local';
const migrations = new URL('../../migrations/', import.meta.url);
const todoColumns = 'id, title, details, status, created_at AS createdAt';

export function openStore(path: string) {
  const db = new DatabaseSync(path, { timeout: 5000 });
  try {
    db.exec('PRAGMA journal_mode = WAL; BEGIN IMMEDIATE;');
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)');
    const applied = db.prepare('SELECT name FROM schema_migrations WHERE name = ?');
    const record = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');
    for (const name of readdirSync(migrations).sort()) {
      if (!name.endsWith('.sql') || applied.get(name)) continue;
      db.exec(readFileSync(new URL(name, migrations), 'utf8'));
      record.run(name);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.close();
    throw error;
  }

  return {
    [Symbol.dispose]: () => db.close(),
    listTodos() {
      return db.prepare(`SELECT ${todoColumns} FROM todos WHERE owner_id = ? ORDER BY created_at DESC, rowid DESC`)
        .all(owner).map((row) => todoSchema.parse(row));
    },
    createTodo(input: TodoInput): Todo {
      const todo = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
      db.prepare('INSERT INTO todos (id, owner_id, title, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(todo.id, owner, todo.title, todo.details, todo.status, todo.createdAt);
      return todo;
    },
    updateTodo(id: string, input: TodoInput) {
      const saved = db.prepare(`UPDATE todos SET title = ?, details = ?, status = ?
        WHERE owner_id = ? AND id = ? RETURNING ${todoColumns}`)
        .get(input.title, input.details, input.status, owner, id);
      return saved && todoSchema.parse(saved);
    },
    deleteTodo(id: string) {
      return db.prepare('DELETE FROM todos WHERE owner_id = ? AND id = ?').run(owner, id).changes > 0;
    },
    listConversations() {
      return db.prepare('SELECT id, updated_at AS updatedAt FROM conversations WHERE owner_id = ? ORDER BY updated_at DESC')
        .all(owner).map((row) => conversationSchema.parse(row));
    },
    hasConversation(id: string) {
      return Boolean(db.prepare('SELECT id FROM conversations WHERE owner_id = ? AND id = ?').get(owner, id));
    },
    touchConversation(id: string) {
      db.prepare(`INSERT INTO conversations (id, owner_id, updated_at) VALUES (?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET updated_at = excluded.updated_at WHERE owner_id = excluded.owner_id`)
        .run(id, owner, new Date().toISOString());
    },
    claimRequest(id: string) {
      return db.prepare('INSERT OR IGNORE INTO chat_requests (owner_id, id) VALUES (?, ?)').run(owner, id).changes > 0;
    },
  };
}

export type Store = ReturnType<typeof openStore>;
