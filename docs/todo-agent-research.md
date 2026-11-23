# チャット付き Todo のエージェント技術選定

2026年11月23日時点の調査。既存の[設計メモ](./draft.md)と[プロトタイプ](./todo-prototype.html)を前提に、近く追加する検索・内容確認・更新・削除も含めて比較した。会話本文、返答、ツールの引数・結果は外部サービスに預ける。アプリで会話IDと所有者の対応を持つ構成も候補に含める。Todoそのものの保存はアプリの機能として扱う。

## 推奨案

| 優先順位 | 構成 | 今回の用途に合う理由 | 導入時の判断材料 |
| --- | --- | --- | --- |
| 1 | **TypeScript版 OpenAI Agents SDK ＋ Conversations API** | SDKのRunnerがツール実行、結果を渡したモデルの再呼び出し、最終返答までを扱う。検索結果を受けて詳細を読む、候補を聞き返す、特定できたIDを更新するといった流れを1つのエージェントで作れる。`conversationId` を渡すと、前の会話をOpenAIから引き継げる。 | アプリ側にツール関数、表示用データの変換、履歴一覧用のID管理が必要。`newItems` から実行中のツール情報を取り出せる。 [Runnerと会話の継続](https://openai.github.io/openai-agents-js/guides/running-agents/#runner-lifecycle-and-configuration)・[SDKの結果](https://openai.github.io/openai-agents-js/guides/results/#new-items) |
| 2 | **OpenAI Responses API ＋ Conversations APIを直接使用** | `function_call` の名前・引数を受け、アプリで実行し、同じ `call_id` の `function_call_output` を返す。モデルが何を選んだか、アプリが何を返したかをAPIの単位で学ぶのに向く。既存の実行詳細にも直接対応する。 | ツール実行と再呼び出しのループ、上限、エラー時の継続をアプリで組む。履歴の保管先は案1と同じなので、Todo関数と会話IDを維持してRunnerへ移行する道がある。 [Function calling](https://developers.openai.com/api/docs/guides/function-calling)・[Conversation state](https://developers.openai.com/api/docs/guides/conversation-state) |
| 3 | **OpenAI Agents API（公開ベータ）のマネージドセッション** | OpenAIがループとセッションを管理する。ユーザーに対応する不透明なIDをセッションのメタデータに設定し、完全一致で絞り込めるため、自前の会話一覧用インデックスも省ける。保存済みの発言とツール呼び出しはセッションのitemsから取得できる。 | 関数呼び出しの要求を受け、アプリでTodoを操作して結果イベントを返す。CRUDのみなら `environment.type: "none"` が使える。メタデータによる一覧への反映には遅延し得る。保存先のリージョンは米国のみ。 [公開ベータの告知](https://developers.openai.com/api/docs/changelog?mw_entry=2026-09-10-f35b72a1a7114c5e)・[一覧API](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/methods/list)・[履歴](https://developers.openai.com/api/docs/guides/agents-api/sessions/events#fetch-items-and-turns)・[関数](https://developers.openai.com/api/docs/guides/agents-api/tools/functions)・[実行環境](https://developers.openai.com/api/docs/guides/agents-api/architecture#start-without-an-environment)・[データ管理](https://developers.openai.com/api/docs/guides/agents-api/overview) |

初版は案1を推奨する。5種類ほどのツールを1つのRunnerから使い、Todoへのアクセスは画面と共通のTypeScript関数に任せられる。ツール呼び出しプロトコルの学習を優先するなら案2、会話IDの対応表まで外部に任せることが優先なら案3を選ぶ。モデルは関数呼び出しに対応する `gpt-6-luna` を初期候補にし、日本語の依頼でツール選択・対象の特定・待ち時間を計測して決める。 [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)

## 会話保存と履歴メニュー

- **内容の保存先**。Responses APIに `conversation` を指定すると、完了したレスポンスの入力・出力が会話に追記される。`items.list` でメッセージ、`function_call`、`function_call_output` を読み、`call_id` で引数と結果を対応づければ、再読み込み後も「実行詳細」を表示できる。送信直後はSDKの `newItems` やストリーミングイベントを表示に使える。 [Responsesの会話パラメーター](https://developers.openai.com/api/reference/resources/responses/methods/create)・[会話項目一覧](https://developers.openai.com/api/reference/resources/conversations/subresources/items/methods/list)・[SDKの結果](https://openai.github.io/openai-agents-js/guides/results/#new-items)
- **会話の一覧**。Conversations APIの公開リファレンスは会話の作成・ID指定の取得・更新・削除と、各会話の項目一覧を公開している。案1・2でプロトタイプの履歴メニューを再現するなら、アプリには `ownerId`、`conversationId`、並び順に使う更新日時を置く。最初の発言を短くした会話名は、OpenAI側のメタデータに置くか、取得した発言から表示時に作る。個別取得・送信のたびにアプリが所有者を照合する。案3ではOpenAI側の所有者メタデータで一覧を絞り込み、個別操作でもサーバーが所有権を確認する。 [Conversations APIリファレンス](https://developers.openai.com/api/reference/resources/conversations/methods/create)・[Agents APIの一覧](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/methods/list)
- **保持期間**。Responsesのレスポンスオブジェクトは既定で30日保存される。Conversationsの会話と会話項目は削除まで保持され、30日の期限の対象外。レスポンスオブジェクトの `store: false` と会話項目の保持は別扱い。ConversationsはZero Data Retentionの対象外。会話の削除機能を設ける場合、会話本体の削除では項目が残るという仕様に沿って項目削除も行い、別途保存したレスポンスの扱いも決める。 [会話データの保持期間](https://developers.openai.com/api/docs/guides/conversation-state)・[データ管理](https://developers.openai.com/api/docs/guides/your-data#storage-requirements-and-retention-controls-per-endpoint)・[会話削除](https://developers.openai.com/api/reference/resources/conversations/methods/delete)・[項目削除](https://developers.openai.com/api/reference/resources/conversations/subresources/items/methods/delete)
- **アプリ側の扱い**。ブラウザーは表示中の会話をメモリーに持ち、再表示時はサーバー経由で履歴を取り直す。プロトタイプの `localStorage` に相当する本文保存や、アプリログへの本文・ツール入出力の記録は外す。SDKのトレースで入出力の複製も避けたい場合は `traceIncludeSensitiveData: false` を設定する。UIの実行詳細はこのトレースに依存せず、会話項目から再表示できる形にする。 [SDKのトレース](https://openai.github.io/openai-agents-js/guides/tracing/#sensitive-data)

## Todoツールの構成案

| ツール候補 | 動作 |
| --- | --- |
| `create_todo` | 画面と共通の作成処理を呼び、既定値を反映した保存結果を返す。 |
| `search_todos` | タイトルやステータスで絞り込み、候補のIDと識別に必要な情報を返す。 |
| `get_todo` | 指定IDの現在の内容・ステータスを取得する。「確認」はこの読み取りを基本にする。 |
| `update_todo` | 確定したIDに対して、指定された項目だけ変更する。 |
| `delete_todo` | 確定したIDを対象にする。誤削除を避ける案として、対象を画面に示し、ユーザーが確認ボタンを押した後にサーバーで削除する。 |

「牛乳のタスクを完了にして」は、`search_todos` で1件に絞れた時点で `update_todo` を呼ぶ。0件なら見つからなかったと伝え、複数ならユーザーに候補を選んでもらう。通常の聞き返しはチャットの返答として返し、次の発言を同じ会話で受ける。フォーム・一覧とチャットは同じTodoサービスを呼び、入力・操作権限・対象の存在をサーバーで検証する。書き込みは再送でも重複適用しないようにし、SDKの `maxTurns` で1回の依頼のツールループに上限を置く。 [SDKの実行ループ](https://openai.github.io/openai-agents-js/guides/running-agents/#the-agent-loop)・[関数呼び出しの引数](https://developers.openai.com/api/docs/guides/function-calling#strict-mode)

削除の確認をSDKの `needsApproval` で実装することもできる。リクエストをまたいで同じ実行を再開する場合、シリアライズした `RunState` の保管先が別途必要になる。会話を含むSDKの状態をアプリに保存しない構成では、ユーザー・対象ID・有効期限に結びついた確認をアプリの操作として扱う案が素直。 [SDKの承認と再開](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/#dealing-with-longer-approval-times)

## その他の比較候補

| 候補 | 今回の評価 |
| --- | --- |
| **OpenAI ChatKit** | 埋め込みチャットやウィジェットが優先なら検討できる。新規向けのカスタム統合ではPythonサーバーとスレッド・メッセージ用の `Store` を用意する。従来のホスト型はAgent Builderに依存し、Agent Builderは2026年11月30日終了予定。既存のTodo画面と実行詳細を活かす今回は、案1〜3の方が直接つなげやすい。 [ChatKit](https://developers.openai.com/api/docs/guides/chatkit#overview)・[カスタム統合のStore](https://developers.openai.com/api/docs/guides/custom-chatkit#4-establish-data-store-contract) |
| **Vercel AI SDK** | React等のチャットUI・ストリーミングや、モデルの切り替えを重視する場合の候補。`ToolLoopAgent` があり、OpenAIプロバイダーでは既存のConversation IDを指定できる。履歴を外部に任せる構成では、UIの再表示・履歴一覧をストレージ側のAPIにつなぐ。 [Building Agents](https://ai-sdk.dev/docs/agents/building-agents)・[OpenAIプロバイダー](https://ai-sdk.dev/providers/ai-sdk-providers/openai)・[チャット履歴の実装例](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence) |
| **Google Gemini Interactions API** | `previous_interaction_id` による継続と関数呼び出しがあり、一定期間の履歴で十分なら候補。有料枠は55日、無料枠は1日で保存期限があり、開き直すためのinteraction IDの管理が必要。Google Cloudを選ぶなら、ユーザー別の一覧取得と保存期限設定があるAgent Platform Sessionsも候補。 [Interactions API](https://aistudio.google.com/docs/interactions-overview#data-storage-retention)・[Agent Platform Sessions](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/sessions/manage-with-api) |
| **Anthropic Claude Managed Agents** | Claudeを選ぶ場合のホスト型候補。Anthropic側のセッションに履歴を削除まで保持し、イベント一覧からユーザー発言・ツール呼び出し・結果を取得できる。カスタムツールはアプリ側で実行して結果イベントを返す。公開リファレンスではベータヘッダーが必要。 [概要](https://platform.claude.com/docs/en/managed-agents/overview)・[イベント一覧](https://platform.claude.com/docs/en/api/beta/sessions/events/list)・[保持期間](https://platform.claude.com/docs/en/managed-agents/secure-deployment-monitoring) |
| **AWS Bedrock AgentCore Memory** | AWS上で保存期間やセッション分離を管理したい場合の候補。短期メモリーに会話イベントを保持でき、ユーザーに対応するactorごとのセッション一覧とイベント一覧がある。保存期間は最大365日。Memoryを単体で使う場合は、アプリでイベントの書き込みと読み出しをつなぐ。 [短期メモリー](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-types.html)・[保持設定](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-create-a-memory-store.html) |

MCPは、Todo操作を別のクライアントやエージェントにも公開するときに検討する。今回のTypeScriptサーバー内から共通処理を呼ぶ用途には、関数ツールで十分。Assistants APIは2026年8月26日に提供終了済み。 [OpenAIのMCPガイド](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)・[API変更履歴](https://developers.openai.com/api/docs/changelog)

## 実装前に試すシナリオ

1. 詳細付きで追加し、実行詳細でモデルの引数と「未着手」が補われた保存結果を比較できる。
2. 同名の候補が複数ある更新では聞き返し、ユーザーが選んだ1件だけを更新する。候補が0件なら書き込みを行わない。
3. 削除を取り消したときはTodoが残り、同じ確認を再送しても削除処理を重複適用しない。
4. ブラウザーを再読み込みしても履歴メニューから会話を開ける。過去の発言・実行詳細・聞き返しの文脈を復元でき、別ユーザーの会話は取得できない。

公式仕様に基づく比較であり、日本語の依頼での成功率や応答時間は未計測。
