import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ChatEvent, Conversation } from '../contracts.ts';
import {
  chatInput,
  deleteDecisionSchema,
  todoToolNameSchema,
} from '../contracts.ts';
import type { Chat } from './chat.ts';
import { readJson } from './http.ts';
import type { Store } from './store.ts';

export function chatRoutes(store: Store, chat?: Chat) {
  const app = new Hono();
  const activeConversations = new Set<string>();

  app.get('/status', (context) => context.json({ enabled: Boolean(chat) }));
  app.get('/conversations', async (context) => {
    const references = store.listConversations();
    const conversations: Conversation[] = [];
    const batchSize = 6;
    const signal = AbortSignal.any([
      context.req.raw.signal,
      AbortSignal.timeout(5000),
    ]);
    for (let offset = 0; offset < references.length; offset += batchSize) {
      const batch = await Promise.all(
        references.slice(offset, offset + batchSize).map(async (reference) => ({
          ...reference,
          title:
            chat && !signal.aborted
              ? await chat.title(reference.id, signal).catch(() => null)
              : null,
        })),
      );
      conversations.push(...batch);
    }
    return context.json(conversations);
  });
  app.get('/conversations/:id', async (context) => {
    if (!chat)
      return context.json({ error: 'OpenAI APIキーを設定してください。' }, 503);
    const id = context.req.param('id');
    if (!store.hasConversation(id))
      return context.json({ error: '会話が見つかりません。' }, 404);
    return context.json(await chat.history(id));
  });
  app.post(
    '/conversations/:id/delete-approvals/:approvalId',
    async (context) => {
      if (!chat)
        return context.json(
          { error: 'OpenAI APIキーを設定してください。' },
          503,
        );
      const { id, approvalId } = context.req.param();
      if (!store.hasConversation(id))
        return context.json({ error: '会話が見つかりません。' }, 404);
      const input = deleteDecisionSchema.safeParse(await readJson(context));
      if (!input.success)
        return context.json(
          { error: '削除の確認内容を確認してください。' },
          400,
        );
      return context.json(chat.decideDeletion(id, approvalId, input.data));
    },
  );

  app.post('/', async (context) => {
    if (!chat)
      return context.json({ error: 'OpenAI APIキーを設定してください。' }, 503);
    const parsed = chatInput.safeParse(await readJson(context));
    if (!parsed.success)
      return context.json(
        { error: 'メッセージと推論レベルを確認してください。' },
        400,
      );
    const input = parsed.data;
    const existingId = input.conversationId;
    if (existingId && !store.hasConversation(existingId)) {
      return context.json({ error: '会話が見つかりません。' }, 404);
    }
    if (existingId && activeConversations.has(existingId)) {
      return context.json({ error: 'この会話で実行中の応答があります。' }, 409);
    }
    if (!store.claimRequest(input.requestId)) {
      return context.json(
        {
          error:
            'この送信は受付済みです。会話履歴とTodo一覧を確認してください。',
        },
        409,
      );
    }
    if (existingId) activeConversations.add(existingId);

    const response = streamSSE(context, async (stream) => {
      const signal = AbortSignal.timeout(180_000);
      async function write(event: ChatEvent) {
        if (!stream.aborted && !stream.closed)
          await stream.writeSSE({ data: JSON.stringify(event) });
      }
      const names = new Map<string, string>();
      const started = performance.now();
      let id = existingId;
      let ok = false;
      try {
        await write({ type: 'waiting' });
        if (stream.aborted) return;
        id ??= await chat.createConversation(signal);
        activeConversations.add(id);
        store.touchConversation(id);
        await write({ type: 'conversation', id });

        // A disconnected browser can reload the conversation after OpenAI records the result.
        for await (const event of chat.run(input, id, signal)) {
          if (event.type === 'tool_start') names.set(event.id, event.name);
          if (event.type === 'tool_result') {
            const parsed = todoToolNameSchema.safeParse(names.get(event.id));
            console.info(
              JSON.stringify({
                requestId: input.requestId,
                tool: parsed.success ? parsed.data : 'unknown',
                ok: event.result.ok,
              }),
            );
          }
          await write(event);
        }
        ok = true;
        await write({ type: 'done' });
      } catch {
        if (!stream.aborted)
          await write({
            type: 'error',
            message: 'チャットの応答を完了できませんでした。',
          });
      } finally {
        if (id) activeConversations.delete(id);
        console.info(
          JSON.stringify({
            requestId: input.requestId,
            durationMs: Math.round(performance.now() - started),
            ok,
          }),
        );
      }
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  });

  return app;
}
