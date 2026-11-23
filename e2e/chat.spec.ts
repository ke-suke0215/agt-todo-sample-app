import { expect, test } from '@playwright/test';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { launchTestApp, listen } from './test-app.ts';

test('チャットのツール実行でTodoが先に保存され、返答と履歴を表示できる', async ({ page, request }) => {
  const upstream = new Hono();
  const allowTool = Promise.withResolvers<void>();
  const allowReply = Promise.withResolvers<void>();
  const conversation = 'conv_example';
  const args = { title: 'パンを買う', details: null, status: null };
  const call = {
    type: 'function_call', id: 'fc_example', call_id: 'call_example', name: 'create_todo',
    arguments: JSON.stringify(args), status: 'completed',
  };
  const reply = {
    type: 'message', id: 'msg_reply', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: 'Todoに追加しました。', annotations: [] }],
  };
  const firstInput = 'パンを買う、を追加';
  let result = '';
  let receivedEffort = '';
  upstream.post('/v1/conversations', (context) => context.json({
    id: conversation, object: 'conversation', created_at: 1, metadata: {},
  }));
  upstream.get('/v1/conversations/:id/items', (context) => context.json({
    object: 'list', has_more: false,
    data: [
      { type: 'message', id: 'msg_user', role: 'user', status: 'completed', content: [{ type: 'input_text', text: firstInput }] },
      call, { type: 'function_call_output', id: 'fc_result', call_id: call.call_id, output: result, status: 'completed' }, reply,
    ],
    first_id: 'msg_user', last_id: 'msg_reply',
  }));
  upstream.post('/v1/responses', async (context) => {
    const input = await context.req.json<{
      conversation: string;
      reasoning: { effort: string };
      input: { type?: string; output?: string }[];
    }>();
    if (input.conversation !== conversation) return context.json({ error: 'Expected the same conversation' }, 400);
    receivedEffort = input.reasoning.effort;
    const output = input.input.find((item) => item.type === 'function_call_output');
    if (output) result = output.output ?? '';

    return streamSSE(context, async (stream) => {
      const item = output ? reply : call;
      const response = {
        id: output ? 'resp_reply' : 'resp_tool',
        model: 'gpt-6-luna', object: 'response', created_at: 1, output: [item],
        status: 'completed', usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
      };
      let index = 0;
      const send = (type: string, values: object) => stream.writeSSE({
        event: type, data: JSON.stringify({ type, sequence_number: index++, ...values }),
      });
      await send('response.created', { response: { ...response, output: [], status: 'in_progress' } });
      await (output ? allowReply.promise : allowTool.promise);
      await send('response.output_item.added', { item, output_index: 0 });
      if (output) {
        await send('response.output_text.delta', { item_id: reply.id, delta: reply.content[0].text, output_index: 0, content_index: 0 });
      }
      await send('response.output_item.done', { item, output_index: 0 });
      await send('response.completed', { response });
    });
  });

  await using mock = await listen(upstream);
  await using app = await launchTestApp(`${mock.url}/v1`);
  try {
    await page.goto(app.url);
    await page.getByLabel('推論レベル').selectOption('high');
    await page.getByRole('textbox', { name: 'メッセージ' }).fill(firstInput);
    const sent = page.waitForRequest((entry) => entry.method() === 'POST' && entry.url().endsWith('/api/chat'));
    await page.getByRole('button', { name: '送信', exact: true }).click();
    const original = await sent;
    await expect(page.getByRole('status')).toContainText('モデルの応答を待っています');
    allowTool.resolve();

    const todo = page.getByRole('button', { name: /パンを買う/ });
    await expect(todo).toContainText('未着手');
    await expect(page.getByText('成功', { exact: true })).toBeVisible();
    await expect(page.getByText('Todoに追加しました。', { exact: true })).toHaveCount(0);
    expect(receivedEffort).toBe('high');
    const retry = await request.post(`${app.url}/api/chat`, { data: original.postDataJSON() });
    expect(retry.status()).toBe(409);
    await expect(todo).toHaveCount(1);

    allowReply.resolve();
    await expect(page.getByText('Todoに追加しました。', { exact: true })).toBeVisible();
    await page.locator('summary').filter({ hasText: 'Todoを追加' }).click();
    await expect(page.getByText('引数', { exact: true })).toBeVisible();
    await expect(page.getByText('実行結果', { exact: true })).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: '会話履歴', exact: true }).click();
    await page.getByRole('region', { name: '会話一覧' }).getByRole('button').click();
    await expect(page.getByText(firstInput, { exact: true })).toBeVisible();
    await expect(page.getByText('成功', { exact: true })).toBeVisible();
    await expect(page.getByText('Todoに追加しました。', { exact: true })).toBeVisible();
  } finally {
    allowTool.resolve();
    allowReply.resolve();
  }
});
