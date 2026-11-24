import { expect, test } from '@playwright/test';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { launchTestApp, listen } from './test-app.ts';

for (const scenario of ['success', 'failure', 'disconnect'] as const) {
  const names = {
    success: 'ツールが先にTodoを保存し、チャットの返答と履歴が表示される',
    failure:
      'ツール成功後にモデルが失敗しても、保存したTodoと確認済みの結果が残る',
    disconnect:
      'ツール成功後にブラウザーを再読み込みしても、会話が完了し履歴を開ける',
  };
  test(names[scenario], async ({ page, request }) => {
    const upstream = new Hono();
    const replyIsRecorded = Promise.withResolvers<boolean>();
    let completedReply = false;
    const allowTool = Promise.withResolvers<void>();
    const allowReply = Promise.withResolvers<void>();
    const conversation = 'conv_example';
    const args = { title: 'パンを買う', details: null, status: null };
    const call = {
      type: 'function_call',
      id: 'fc_example',
      call_id: 'call_example',
      name: 'create_todo',
      arguments: JSON.stringify(args),
      status: 'completed',
    };
    const reply = {
      type: 'message',
      id: 'msg_reply',
      role: 'assistant',
      status: 'completed',
      content: [
        { type: 'output_text', text: 'Todoに追加しました。', annotations: [] },
      ],
    };
    const titlePrefix = `パンを買う、を追加${'🍞'.repeat(31)}`;
    const firstInput = `${titlePrefix}、それと牛乳も\n詳しい内容はここに書く`;
    const historyTitle = `${titlePrefix}…`;
    let result = '';
    let receivedEffort = '';
    upstream.post('/v1/conversations', (context) =>
      context.json({
        id: conversation,
        object: 'conversation',
        created_at: 1,
        metadata: {},
      }),
    );
    upstream.get('/v1/conversations/:id/items', (context) => {
      const user = {
        type: 'message',
        id: 'msg_user',
        role: 'user',
        status: 'completed',
        content: [{ type: 'input_text', text: firstInput }],
      };
      if (context.req.query('limit') === '1') {
        expect(context.req.query('order')).toBe('asc');
        return context.json({
          object: 'list',
          has_more: true,
          data: [user],
          first_id: user.id,
          last_id: user.id,
        });
      }
      return context.json({
        object: 'list',
        has_more: false,
        data: [
          user,
          call,
          ...(completedReply
            ? [
                {
                  type: 'function_call_output',
                  id: 'fc_result',
                  call_id: call.call_id,
                  output: result,
                  status: 'completed',
                },
                reply,
              ]
            : []),
        ],
        first_id: 'msg_user',
        last_id: completedReply ? reply.id : call.id,
      });
    });
    upstream.post('/v1/responses', async (context) => {
      const input = await context.req.json<{
        conversation: string;
        reasoning: { effort: string };
        input: { type?: string; output?: string }[];
      }>();
      if (input.conversation !== conversation)
        return context.json({ error: 'Expected the same conversation' }, 400);
      receivedEffort = input.reasoning.effort;
      const output = input.input.find(
        (item) => item.type === 'function_call_output',
      );
      if (output) result = output.output ?? '';

      return streamSSE(context, async (stream) => {
        if (output) stream.onAbort(() => replyIsRecorded.resolve(false));
        const item = output ? reply : call;
        const response = {
          id: output ? 'resp_reply' : 'resp_tool',
          model: 'gpt-6-luna',
          object: 'response',
          created_at: 1,
          output: [item],
          status: 'completed',
          usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
        };
        let index = 0;
        const send = (type: string, values: object) =>
          stream.writeSSE({
            event: type,
            data: JSON.stringify({ type, sequence_number: index++, ...values }),
          });
        await send('response.created', {
          response: { ...response, output: [], status: 'in_progress' },
        });
        await (output ? allowReply.promise : allowTool.promise);
        if (output && scenario === 'failure') {
          await send('response.failed', {
            response: {
              ...response,
              output: [],
              status: 'failed',
              error: { code: 'server_error', message: 'fixture failure' },
            },
          });
          return;
        }
        await send('response.output_item.added', { item, output_index: 0 });
        if (output) {
          await send('response.output_text.delta', {
            item_id: reply.id,
            delta: reply.content[0].text,
            output_index: 0,
            content_index: 0,
          });
        }
        await send('response.output_item.done', { item, output_index: 0 });
        await send('response.completed', { response });
        if (output && !stream.aborted) {
          completedReply = true;
          replyIsRecorded.resolve(true);
        }
      });
    });

    await using mock = await listen(upstream);
    await using app = await launchTestApp(`${mock.url}/v1`);
    try {
      await page.goto(app.url);
      await page.getByLabel('推論レベル').selectOption('high');
      await page.getByRole('textbox', { name: 'メッセージ' }).fill(firstInput);
      const sent = page.waitForRequest(
        (entry) =>
          entry.method() === 'POST' && entry.url().endsWith('/api/chat'),
      );
      await page.getByRole('button', { name: '送信', exact: true }).click();
      const original = await sent;
      expect((await original.response())?.headers()['cache-control']).toBe(
        'no-store',
      );
      await expect(page.getByRole('status')).toContainText(
        'モデルの応答を待っています',
      );
      allowTool.resolve();

      const todo = page.getByRole('button', { name: /パンを買う/ });
      await expect(todo).toContainText('未着手');
      await expect(page.getByText('成功', { exact: true })).toBeVisible();
      await expect(
        page.getByText('Todoに追加しました。', { exact: true }),
      ).toHaveCount(0);
      expect(receivedEffort).toBe('high');
      const retry = await request.post(`${app.url}/api/chat`, {
        data: original.postDataJSON(),
      });
      expect(retry.status()).toBe(409);
      await expect(todo).toHaveCount(1);

      if (scenario === 'disconnect') {
        await page.reload();
        allowReply.resolve();
        expect(await replyIsRecorded.promise).toBe(true);
      } else {
        allowReply.resolve();
      }

      if (scenario === 'failure') {
        await expect(page.getByRole('alert')).toContainText(
          'チャットの応答を完了できませんでした。',
        );
        await page
          .getByRole('button', { name: '一覧と履歴を再読み込み' })
          .click();
        await expect(todo).toHaveCount(1);
        await expect(page.getByText('成功', { exact: true })).toBeVisible();
      } else if (scenario === 'success') {
        await expect(
          page.getByText('Todoに追加しました。', { exact: true }),
        ).toBeVisible();
        await page.reload();
      }

      if (scenario !== 'failure') {
        await page
          .getByRole('button', { name: '会話履歴', exact: true })
          .click();
        const historyEntry = page
          .getByRole('region', { name: '会話一覧' })
          .getByRole('button', { name: new RegExp(historyTitle) });
        await expect(historyEntry.locator('time')).toHaveAttribute(
          'datetime',
          /^\d{4}-\d{2}-\d{2}T/,
        );
        await historyEntry.click();
        await expect(page.getByText(firstInput, { exact: true })).toBeVisible();
        await expect(page.getByText('成功', { exact: true })).toBeVisible();
        await expect(
          page.getByText('Todoに追加しました。', { exact: true }),
        ).toBeVisible();
      }
      await page.locator('summary').filter({ hasText: 'Todoを追加' }).click();
      await expect(page.getByText('引数', { exact: true })).toBeVisible();
      await expect(page.getByText('実行結果', { exact: true })).toBeVisible();
    } finally {
      allowTool.resolve();
      allowReply.resolve();
    }
  });
}
