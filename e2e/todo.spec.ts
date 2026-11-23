import { expect, test } from '@playwright/test';
import { launchTestApp } from './test-app.ts';

test('APIキーなしでTodoを作成、編集し、再起動しても確認できる', async ({
  page,
}) => {
  await using app = await launchTestApp();
  await page.goto(app.url);
  await expect(
    page.getByText('チャットを使うには OpenAI APIキーを設定してください。'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '送信', exact: true }),
  ).toBeDisabled();

  await page.getByRole('button', { name: 'Todoを追加', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('textbox', { name: 'タイトル' })
    .fill('歯医者を予約する');
  await dialog.getByRole('textbox', { name: '詳細' }).fill('金曜日\n午後');
  await dialog.getByRole('button', { name: '追加する' }).click();
  const todo = page.getByRole('button', { name: /歯医者を予約する/ });
  await expect(todo).toContainText('未着手');

  await todo.click();
  await expect(dialog.getByRole('textbox', { name: '詳細' })).toHaveValue(
    '金曜日\n午後',
  );
  await dialog.getByLabel('ステータス').selectOption('done');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(todo).toContainText('完了');

  await app.restart();
  await page.reload();
  await page.getByRole('searchbox', { name: 'Todoを検索' }).fill('歯医者');
  await expect(todo).toContainText('完了');
  await page
    .getByRole('searchbox', { name: 'Todoを検索' })
    .fill('見つからない検索語');
  await expect(page.getByText('一致するTodoがありません')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'チャットを開く' }).click();
  await expect(
    page.getByRole('complementary', { name: 'Todoアシスタント' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'チャットを閉じる' }).click();
  await expect(
    page.getByRole('complementary', { name: 'Todoアシスタント' }),
  ).toBeHidden();
});

test('削除をキャンセルでき、確認して削除すると一覧から消える', async ({
  page,
  request,
}) => {
  await using app = await launchTestApp();
  const response = await request.post(`${app.url}/api/todos`, {
    data: { title: '削除の確認用Todo' },
  });
  expect(response.status()).toBe(201);
  await page.goto(app.url);
  const row = page.getByRole('button', { name: /削除の確認用Todo/ });
  const dialog = page.getByRole('dialog');
  await row.click();
  await dialog.getByRole('button', { name: '削除', exact: true }).click();
  await dialog.getByRole('button', { name: 'キャンセル' }).click();
  await expect(
    dialog.getByRole('button', { name: '削除', exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: '削除', exact: true }).click();
  await dialog.getByRole('button', { name: '削除する' }).click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Todoはまだありません')).toBeVisible();
});
