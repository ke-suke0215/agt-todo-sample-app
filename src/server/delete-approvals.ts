import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { DeleteApproval, deleteDecisionSchema } from '../contracts.ts';
import { todoSchema } from '../contracts.ts';
import type { Store } from './store.ts';

const lifetime = 30 * 60 * 1000;
type ApprovalRecord = {
  conversationId: string;
  todoId: string;
  originalRevision: number;
  shownRevision: number;
  expiresAt: number;
  finished?: 'deleted' | 'cancelled' | 'missing';
};

export function createDeleteApprovals(store: Store) {
  // Keep only approval metadata in memory. The transcript belongs to OpenAI.
  const records = new Map<string, ApprovalRecord>();

  function getRecord(conversationId: string, id: string) {
    const record = records.get(id);
    if (!record || record.conversationId !== conversationId) return;
    if (record.expiresAt > Date.now()) return record;
    records.delete(id);
  }

  function preview(id: string, record: ApprovalRecord): DeleteApproval {
    if (record.finished) return { state: record.finished };
    const todo = store.getTodo(record.todoId);
    if (!todo) {
      record.finished = 'missing';
      return { state: 'missing' };
    }
    record.shownRevision = todo.revision;
    return {
      state: todo.revision === record.originalRevision ? 'pending' : 'changed',
      id,
      revision: todo.revision,
      todo: todoSchema.parse(todo),
    };
  }

  return {
    request(
      conversationId: string,
      todo: NonNullable<ReturnType<Store['getTodo']>>,
    ) {
      const now = Date.now();
      for (const [id, record] of records) {
        if (record.expiresAt <= now) records.delete(id);
      }
      const id = randomUUID();
      records.set(id, {
        conversationId,
        todoId: todo.id,
        originalRevision: todo.revision,
        shownRevision: todo.revision,
        expiresAt: now + lifetime,
      });
      return id;
    },
    inspect(conversationId: string, id: string): DeleteApproval {
      const record = getRecord(conversationId, id);
      return record ? preview(id, record) : { state: 'expired' };
    },
    decide(
      conversationId: string,
      id: string,
      input: z.infer<typeof deleteDecisionSchema>,
    ): DeleteApproval {
      const record = getRecord(conversationId, id);
      if (!record) return { state: 'expired' };
      if (record.finished) return { state: record.finished };
      if (input.decision === 'cancel') {
        record.finished = 'cancelled';
        return { state: 'cancelled' };
      }
      if (
        input.revision === record.shownRevision &&
        store.deleteTodoAtRevision(record.todoId, input.revision)
      ) {
        record.finished = 'deleted';
        return { state: 'deleted' };
      }
      return preview(id, record);
    },
  };
}
