import {
  Agent, OpenAIProvider, Runner, setSensitiveDataLoggingEnabled, setTracingDisabled, tool,
} from '@openai/agents';
import type OpenAI from 'openai';
import type { ResponseStreamEvent } from 'openai/resources/responses/responses';
import { z } from 'zod';
import { todoFields, todoInput, toolResultSchema } from '../contracts.ts';
import type { ChatEvent, ChatInput, ChatItem, ToolResult } from '../contracts.ts';
import type { Store } from './store.ts';

const jsonSchema = z.json();

function parseJson(text: string): z.infer<typeof jsonSchema> {
  try {
    const parsed = jsonSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : text;
  } catch {
    return text;
  }
}

function readToolResult(output: unknown): ToolResult {
  const result = toolResultSchema.safeParse(typeof output === 'string' ? parseJson(output) : output);
  return result.success ? result.data : { ok: false, message: 'Todoを追加できませんでした。' };
}

export function createChat(store: Store, client: OpenAI) {
  setSensitiveDataLoggingEnabled(false);
  setTracingDisabled(true);
  const runner = new Runner({
    modelProvider: new OpenAIProvider({ openAIClient: client }),
    tracingDisabled: true,
    traceIncludeSensitiveData: false,
  });

  const createTodo = tool({
    name: 'create_todo',
    description: '明確なタイトルがあるTodoを1件保存する。',
    parameters: z.object({
      title: z.string(),
      details: z.string().nullable(),
      status: todoFields.shape.status.nullable(),
    }),
    execute: (args): ToolResult => {
      const input = todoInput.safeParse({
        title: args.title, details: args.details ?? undefined, status: args.status ?? undefined,
      });
      if (!input.success) return { ok: false, message: 'Todoの入力値が無効です。' };
      try {
        return { ok: true, todo: store.createTodo(input.data) };
      } catch {
        return { ok: false, message: 'Todoを保存できませんでした。' };
      }
    },
  });

  return {
    async createConversation(signal: AbortSignal) {
      const { id } = await client.conversations.create({}, { signal });
      return id;
    },
    async history(id: string): Promise<ChatItem[]> {
      const items: ChatItem[] = [];
      const tools = new Map<string, Extract<ChatItem, { kind: 'tool' }>>();
      for await (const item of client.conversations.items.list(id, { order: 'asc', limit: 100 })) {
        if (item.type === 'message' && (item.role === 'user' || item.role === 'assistant')) {
          const text = item.content.flatMap((part) => {
            if (part.type === 'input_text' || part.type === 'output_text') return [part.text];
            if (part.type === 'refusal') return [part.refusal];
            return [];
          }).join('\n');
          if (text) items.push({ kind: item.role, id: item.id, text });
        } else if (item.type === 'function_call') {
          const entry = { kind: 'tool', id: item.call_id, name: item.name, args: parseJson(item.arguments) } as const;
          tools.set(entry.id, entry);
          items.push(entry);
        } else if (item.type === 'function_call_output' && item.call_id) {
          const toolItem = tools.get(item.call_id);
          if (toolItem) toolItem.result = readToolResult(item.output);
        } else if (item.type === 'reasoning') {
          const text = item.summary.map((part) => part.text).join('\n');
          if (text) items.push({ kind: 'reasoning', id: item.id, text });
        }
      }
      return items;
    },
    async *run(input: ChatInput, conversationId: string, signal: AbortSignal): AsyncGenerator<ChatEvent> {
      const agent = new Agent({
        name: 'Todoアシスタント',
        model: 'gpt-6-luna',
        instructions: `日本語で簡潔に答える。ユーザーがTodoの作成を依頼し、具体的なタイトルを特定できた時に
create_todo を呼ぶ。不明な場合は先に質問する。詳細やステータスの指定がなければ null を渡す。
検索・更新・削除の依頼は現在のチャットではできないと伝える。
ツールが成功した内容だけを保存済みとして伝える。複数の明確な作成依頼には1件ずつ対応する。`,
        tools: [createTodo],
        modelSettings: {
          parallelToolCalls: false,
          reasoning: { effort: input.effort, ...(input.effort === 'none' ? {} : { summary: 'auto' }) },
        },
      });

      const run = await runner.run(agent, input.text, { conversationId, stream: true, signal });
      for await (const event of run) {
        if (event.type === 'raw_model_stream_event' && event.data.type === 'model') {
          const raw = event.data.event as ResponseStreamEvent;
          if (raw.type === 'response.output_text.delta' || raw.type === 'response.refusal.delta') {
            yield { type: 'text', id: raw.item_id, delta: raw.delta };
          } else if (raw.type === 'response.reasoning_summary_text.delta') {
            yield { type: 'reasoning', id: raw.item_id, delta: raw.delta };
          }
        } else if (event.type === 'run_item_stream_event') {
          const item = event.item;
          if (item.type === 'tool_call_item' && item.rawItem.type === 'function_call') {
            const call = item.rawItem;
            yield { type: 'tool_start', id: call.callId, name: call.name, args: parseJson(call.arguments) };
          } else if (item.type === 'tool_call_output_item' && item.rawItem.type === 'function_call_result') {
            yield { type: 'tool_result', id: item.rawItem.callId, result: readToolResult(item.output) };
          }
        }
      }
      await run.completed;
    },
  };
}

export type Chat = ReturnType<typeof createChat>;
