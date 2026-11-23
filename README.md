# チャット付きTodo

画面からTodoを管理し、チャットからTodoを追加できるローカルアプリです。

## 起動

Node.js 26 と npm を使います。

```sh
npm ci
npm run dev
```

ブラウザーで [http://127.0.0.1:5173](http://127.0.0.1:5173) を開きます。Todoは `data/todo.sqlite` に保存されます。初回起動時にSQLマイグレーションを適用します。

チャットを使うには `.env.example` を `.env` にコピーし、`OPENAI_API_KEY` を設定してサーバーを再起動します。キーが空欄でも、Todoの追加・編集・検索・削除は使えます。チャット本文・返答・ツールの引数や結果の履歴はOpenAIのConversations APIから取得します。アプリは履歴一覧用のIDと更新日時などのメタデータだけを保存します。

## 確認

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
```

Playwrightではブラウザーから実際のSQLiteとHonoを使います。チャットのテストはOpenAI APIを代替するローカルサーバーへ接続するので、APIキーは不要です。

[設計メモ](docs/draft.md)
