import { tool } from '@openai/agents';
import type OpenAI from 'openai';
import { z } from 'zod';
import type { ToolResult } from '../contracts.ts';
import {
  inputLimits,
  todoFields,
  todoInput,
  todoPatch,
  todoSchema,
  todoSummarySchema,
} from '../contracts.ts';
import { searchByMeaning } from './meaning-search.ts';
import type { Store } from './store.ts';

const status = todoFields.shape.status;
const missing: ToolResult = { ok: false, message: 'Todoが見つかりません。' };

export function todoTools(
  store: Store,
  client: OpenAI,
  signal: AbortSignal,
  requestDelete: (todo: NonNullable<ReturnType<Store['getTodo']>>) => string,
) {
  return [
    tool({
      name: 'create_todo',
      description: '明確なタイトルがあるTodoを1件保存する。',
      parameters: z.object({
        title: z.string(),
        details: z.string().nullable(),
        status: status.nullable(),
      }),
      execute: (args): ToolResult => {
        const input = todoInput.safeParse({
          title: args.title,
          details: args.details ?? undefined,
          status: args.status ?? undefined,
        });
        return input.success
          ? { ok: true, todo: store.createTodo(input.data) }
          : { ok: false, message: 'Todoの入力値が無効です。' };
      },
    }),
    tool({
      name: 'search_todos',
      description:
        'タイトルと詳細をキーワードで部分一致検索し、ステータスで絞る。カテゴリ検索では言い換えの配列を渡し、どれかに一致するTodoを返す。候補のID・タイトル・ステータスを最大20件と、全一致件数を返す。絞り込み不要の引数はnull。',
      parameters: z.object({
        keyword: z.union([z.string(), z.array(z.string())]).nullable(),
        statuses: z.array(status).nullable(),
      }),
      execute: (args): ToolResult => {
        const terms = Array.isArray(args.keyword)
          ? args.keyword
          : [args.keyword ?? ''];
        const keywords = terms
          .map((term) => term.trim().toLowerCase())
          .filter(Boolean);
        if (keywords.some((keyword) => keyword.length > inputLimits.details))
          return { ok: false, message: '検索キーワードが長すぎます。' };
        const statuses = args.statuses;
        const matches = store.listTodos().filter((todo) => {
          if (statuses?.length && !statuses.includes(todo.status)) return false;
          if (!keywords.length) return true;
          const title = todo.title.toLowerCase();
          const details = todo.details.toLowerCase();
          return keywords.some(
            (keyword) => title.includes(keyword) || details.includes(keyword),
          );
        });
        return {
          ok: true,
          matches: matches
            .slice(0, 20)
            .map((todo) => todoSummarySchema.parse(todo)),
          total: matches.length,
        };
      },
    }),
    tool({
      name: 'search_todos_by_meaning',
      description:
        'テーマや活動を表す検索条件で、Todoのタイトルと詳細の冒頭を意味で判定する。関連度順で最大20件と全一致件数を返す。ステータスの指定がなければnull。読み取り専用のカテゴリ検索に使う。',
      parameters: z.object({
        query: z.string(),
        statuses: z.array(status).nullable(),
      }),
      execute: async ({ query, statuses }): Promise<ToolResult> => {
        const topic = query.trim();
        if (!topic || topic.length > inputLimits.message)
          return { ok: false, message: '意味で探す条件を確認してください。' };
        const candidates = store
          .listTodos()
          .filter(
            (todo) => !statuses?.length || statuses.includes(todo.status),
          );
        return searchByMeaning(client, topic, candidates, signal);
      },
    }),
    tool({
      name: 'get_todo',
      description: 'IDが分かっているTodoを1件取得し、現在の詳細を返す。',
      parameters: z.object({ id: z.string() }),
      execute: ({ id }): ToolResult => {
        const todo = store.getTodo(id);
        return todo ? { ok: true, todo: todoSchema.parse(todo) } : missing;
      },
    }),
    tool({
      name: 'update_todo',
      description:
        'IDでTodoを1件更新する。変更しない項目にはnullを渡す。詳細を空にする場合は空文字列を渡す。',
      parameters: z.object({
        id: z.string(),
        title: z.string().nullable(),
        details: z.string().nullable(),
        status: status.nullable(),
      }),
      execute: (args): ToolResult => {
        const input = todoPatch.safeParse({
          title: args.title ?? undefined,
          details: args.details ?? undefined,
          status: args.status ?? undefined,
        });
        if (!input.success)
          return { ok: false, message: '変更内容を確認してください。' };
        const todo = store.updateTodo(args.id, input.data);
        return todo ? { ok: true, todo } : missing;
      },
    }),
    tool({
      name: 'delete_todo',
      description:
        'IDでTodoを1件指定し、画面に削除確認を出す。ユーザーが画面で承認するまでTodoは削除されない。',
      parameters: z.object({ id: z.string() }),
      execute: ({ id }): ToolResult => {
        const todo = store.getTodo(id);
        return todo
          ? {
              ok: true,
              approvalId: requestDelete(todo),
              todo: todoSchema.parse(todo),
            }
          : missing;
      },
    }),
  ];
}
