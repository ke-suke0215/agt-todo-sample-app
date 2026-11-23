import { EventSourceParserStream } from 'eventsource-parser/stream';
import { z } from 'zod';
import { chatEventSchema } from '../contracts.ts';
import type { ChatEvent, ChatInput } from '../contracts.ts';

const errorSchema = z.object({ error: z.string() });

export function jsonBody(body: unknown) {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export async function requireOk(response: Response) {
  if (response.ok) return response;
  const error = errorSchema.safeParse(await response.json().catch(() => null));
  throw new Error(error.success ? error.data.error : 'サーバーに接続できませんでした。');
}

export async function getJson<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await requireOk(await fetch(path, init));
  const result = schema.safeParse(await response.json());
  if (!result.success) throw new Error('サーバーから予期しないデータが返りました。');
  return result.data;
}

export async function streamChat(input: ChatInput, receive: (event: ChatEvent) => void) {
  const response = await requireOk(await fetch('/api/chat', { method: 'POST', ...jsonBody(input) }));
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error('チャットの応答を受信できませんでした。');
  }
  const events = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream());
  for await (const event of events) {
    const data = chatEventSchema.parse(JSON.parse(event.data));
    receive(data);
    if (data.type === 'done') return;
    if (data.type === 'error') throw new Error(data.message);
  }
  throw new Error('チャットの接続が切れました。');
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof z.ZodError || !(error instanceof Error) || error instanceof TypeError
    ? fallback
    : error.message;
}
