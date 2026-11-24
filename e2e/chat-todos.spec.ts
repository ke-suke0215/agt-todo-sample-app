import { expect, test } from '@playwright/test';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { todoSchema, toolResultSchema } from '../src/contracts.ts';
import { launchTestApp, listen } from './test-app.ts';

test('候補が0件・複数・1件の場合にチャットから検索・更新・削除できる', async ({
  page,
  request,
}) => {
  const upstream = new Hono();
  const conversation = 'conv_todos';
  let step = 0;
  upstream.post('/v1/conversations', (context) =>
    context.json({
      id: conversation,
      object: 'conversation',
      created_at: 1,
      metadata: {},
    }),
  );

  let rejectDecision = false;
  upstream.post('/v1/decisions', async (context) => {
    const { model, input, questions } = await context.req.json<{
      model: string;
      input: {
        content: {
          data: {
            query: string;
            candidates: { key: string; title: string; details: string }[];
          };
        }[];
      }[];
      questions: { type: string; name: string }[];
    }>();
    expect(model).toBe('gpt-6-luna');
    const { query, candidates } = input[1].content[0].data;
    expect(query).toBe('本を読む活動');
    expect(candidates.map(({ title }) => title)).toEqual([
      '本棚を片付ける',
      '読書',
      '技術書読む',
      '牛乳を買う',
    ]);
    expect(questions).toMatchObject(
      candidates.map(({ key }) => ({ type: 'predicate', name: key })),
    );
    if (rejectDecision) return context.json({ error: 'unavailable' }, 503);
    return context.json({
      answers: candidates.toReversed().map(({ key, title }) => ({
        type: 'predicate',
        name: key,
        probability:
          title === '読書' ? 0.99 : title === '技術書読む' ? 0.9 : 0.2,
      })),
    });
  });

  let targetId = '';
  upstream.post('/v1/responses', async (context) => {
    const input = await context.req.json<{
      conversation: string;
      input: { type?: string; output?: string }[];
      tools: { name: string }[];
    }>();
    expect(input.conversation).toBe(conversation);
    expect(input.tools.map(({ name }) => name)).toEqual([
      'create_todo',
      'search_todos',
      'search_todos_by_meaning',
      'get_todo',
      'update_todo',
      'delete_todo',
    ]);
    const output = input.input.find(
      (entry) => entry.type === 'function_call_output',
    );
    const result =
      output && toolResultSchema.parse(JSON.parse(output.output ?? 'null'));
    const sequence = step++;
    const call = (name: string, args: object) => ({
      type: 'function_call',
      id: `fc_${sequence}`,
      call_id: `call_${sequence}`,
      name,
      arguments: JSON.stringify(args),
      status: 'completed',
    });
    const reply = (text: string) => ({
      type: 'message',
      id: `msg_${sequence}`,
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }],
    });
    const search = (keyword: string) =>
      call('search_todos', { keyword, statuses: ['pending', 'in_progress'] });
    const deleteCall = () => call('delete_todo', { id: targetId });

    let item: ReturnType<typeof call> | ReturnType<typeof reply>;
    switch (sequence) {
      case 0:
        item = search('レモン');
        break;
      case 1:
        expect(result).toEqual({ ok: true, total: 0, matches: [] });
        item = reply('対象が見つかりません。');
        break;
      case 2:
        item = search('牛乳');
        break;
      case 3:
        expect(result).toMatchObject({
          ok: true,
          total: 2,
          matches: [
            { title: '牛乳を買う', status: 'in_progress' },
            { id: targetId, title: '牛乳を買う', status: 'pending' },
          ],
        });
        item = reply('候補が2件あります。どちらを更新しますか？');
        break;
      case 4:
        item = search('駅前');
        break;
      case 5:
        expect(result).toEqual({
          ok: true,
          total: 1,
          matches: [{ id: targetId, title: '牛乳を買う', status: 'pending' }],
        });
        item = call('get_todo', { id: targetId });
        break;
      case 6:
        expect(result).toMatchObject({
          ok: true,
          todo: { details: '駅前で1本' },
        });
        item = call('update_todo', {
          id: targetId,
          status: 'done',
          title: null,
          details: null,
        });
        break;
      case 7:
        expect(result).toMatchObject({
          ok: true,
          todo: {
            id: targetId,
            title: '牛乳を買う',
            details: '駅前で1本',
            status: 'done',
          },
        });
        item = reply('詳細は「駅前で1本」です。完了にしました。');
        break;
      case 8:
      case 10:
        item = deleteCall();
        break;
      case 12:
      case 14:
        item = call('search_todos_by_meaning', {
          query: '本を読む活動',
          statuses: ['pending', 'done'],
        });
        break;
      case 13:
        expect(result).toMatchObject({
          ok: true,
          total: 2,
          matches: [
            { title: '読書', status: 'done' },
            { title: '技術書読む', status: 'pending' },
          ],
        });
        item = reply('「読書」と「技術書読む」があります。');
        break;
      case 15:
        expect(result).toEqual({
          ok: false,
          message: '意味での検索を完了できませんでした。',
        });
        item = call('search_todos', {
          keyword: ['読む', '読書', '読了', '技術書'],
          statuses: null,
        });
        break;
      case 16:
        expect(result).toMatchObject({
          ok: true,
          total: 2,
          matches: [
            { title: '読書', status: 'done' },
            { title: '技術書読む', status: 'pending' },
          ],
        });
        item = reply('キーワード検索では「読書」と「技術書読む」があります。');
        break;
      default:
        expect(result).toMatchObject({
          ok: true,
          approvalId: expect.any(String),
          todo: { id: targetId },
        });
        item = reply('画面のボタンで削除を確認してください。');
    }

    return streamSSE(context, async (stream) => {
      const response = {
        id: `resp_${sequence}`,
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
      await send('response.output_item.added', { item, output_index: 0 });
      if ('content' in item) {
        await send('response.output_text.delta', {
          item_id: item.id,
          delta: item.content[0].text,
          output_index: 0,
          content_index: 0,
        });
      }
      await send('response.output_item.done', { item, output_index: 0 });
      await send('response.completed', { response });
    });
  });

  await using mock = await listen(upstream);
  await using app = await launchTestApp(`${mock.url}/v1`);
  const base = `${app.url}/api/todos`;
  async function seed(details: string, status: string, title = '牛乳を買う') {
    const response = await request.post(base, {
      data: { title, details, status },
    });
    expect(response.ok()).toBe(true);
    return todoSchema.parse(await response.json());
  }
  const target = await seed('駅前で1本', 'pending');
  targetId = target.id;
  const other = await seed('宅配で2本', 'in_progress');
  await seed('お店で牛乳1本', 'done');

  await page.goto(app.url);
  const textbox = page.getByRole('textbox', { name: 'メッセージ' });
  async function send(text: string, response: string) {
    await textbox.fill(text);
    await page.getByRole('button', { name: '送信', exact: true }).click();
    await expect(
      page.getByText(response, { exact: true }).last(),
    ).toBeVisible();
    await expect(textbox).toBeEnabled();
  }
  const row = page.getByRole('button', { name: /駅前で1本/ });
  const otherRow = page.getByRole('button', { name: /宅配で2本/ });

  await send('レモンのタスクを完了にして', '対象が見つかりません。');
  await send(
    '牛乳の未完了タスクを完了にして',
    '候補が2件あります。どちらを更新しますか？',
  );
  await expect(row).toContainText('未着手');
  await expect(otherRow).toContainText('進行中');

  await send(
    '駅前の牛乳の詳細を確認して完了にして',
    '詳細は「駅前で1本」です。完了にしました。',
  );
  await expect(row).toContainText('完了');
  await expect(otherRow).toContainText('進行中');

  const confirmation = page.getByRole('region', { name: 'Todoの削除確認' });
  const requestDeletion = () =>
    send('駅前の牛乳を削除して', '画面のボタンで削除を確認してください。');
  await requestDeletion();
  await expect(confirmation).toContainText('牛乳を買う');
  await expect(row).toBeVisible();
  await confirmation.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.getByText('削除を取り消しました。')).toBeVisible();
  await expect(row).toBeVisible();

  await requestDeletion();
  const edit = await request.put(`${base}/${target.id}`, {
    data: {
      title: '牛乳を買う（変更後）',
      details: '駅前で3本',
      status: 'pending',
    },
  });
  expect(edit.ok()).toBe(true);
  const approve = confirmation.getByRole('button', { name: '削除する' });
  await approve.click();
  await expect(confirmation).toContainText('最新の内容を確認してください。');
  await expect(confirmation).toContainText('牛乳を買う（変更後）');
  await expect(confirmation).toContainText('駅前で3本');
  const saved = todoSchema
    .array()
    .parse(await (await request.get(base)).json());
  expect(saved.find(({ id }) => id === target.id)?.details).toBe('駅前で3本');

  await approve.click();
  await expect(page.getByText('Todoを削除しました。')).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(otherRow).toContainText('進行中');
  const remaining = todoSchema
    .array()
    .parse(await (await request.get(base)).json());
  expect(remaining.find(({ id }) => id === target.id)).toBeUndefined();
  expect(remaining.find(({ id }) => id === other.id)).toEqual(other);

  await seed('', 'pending', '技術書読む');
  await seed('', 'done', '読書');
  await seed('', 'pending', '本棚を片付ける');
  await send(
    '本を読む系のタスクなにがある？',
    '「読書」と「技術書読む」があります。',
  );
  await expect(
    page.locator('summary').filter({ hasText: '意味でTodoを検索' }),
  ).toContainText('成功');
  rejectDecision = true;
  await send(
    'もう一度、本を読む系のタスクを探して',
    'キーワード検索では「読書」と「技術書読む」があります。',
  );
});
