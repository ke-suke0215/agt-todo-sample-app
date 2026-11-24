# チャット付きTodo

画面とチャットからTodoを追加・検索・確認・更新・削除できるローカルアプリです。

## 起動

Node.js 26 と npm を使います。

```sh
npm ci
npm run dev
```

ブラウザーで [http://127.0.0.1:5173](http://127.0.0.1:5173) を開きます。Todoは `data/todo.sqlite` に保存されます。初回起動時にSQLマイグレーションを適用します。

チャットを使うには `.env.example` を `.env` にコピーし、`OPENAI_API_KEY` を設定してサーバーを再起動します。キーが空欄でも、Todoの追加・編集・検索・削除は使えます。チャット本文・返答・ツールの引数や結果の履歴はOpenAIのConversations APIから取得します。アプリは履歴一覧用のIDと更新日時などのメタデータだけを保存します。

チャットから削除を依頼すると、対象のタイトルと詳細を表示します。「削除する」を押すと削除されます。確認中にTodoが更新された場合は最新の内容が表示され、もう一度確認できます。削除確認は30分またはサーバーを再起動するまで有効です。

## 確認

```sh
npm run check
npm test
npx playwright install chromium
npm run test:e2e
```

Biomeは `npm run lint` でリンティング、`npm run format` で整形、`npm run format:check` で整形の確認ができます。`npm run check` はリンティング・整形・import順・TypeScriptの型をまとめて確認します。GitHub Actionsは `main` へのプルリクエストとpushで、上記のチェックとテストを実行します。

Playwrightではブラウザーから実際のSQLiteとHonoを使います。チャットのテストはOpenAI APIを代替するローカルサーバーへ接続するので、APIキーは不要です。

[設計メモ](docs/draft.md)
