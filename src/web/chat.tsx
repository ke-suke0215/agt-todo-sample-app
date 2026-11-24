import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleAlert,
  History,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  Plus,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type {
  ChatEvent,
  ChatInput,
  ChatItem,
  Conversation,
  DeleteApproval,
} from '../contracts.ts';
import {
  chatItemSchema,
  conversationSchema,
  deleteApprovalSchema,
  type deleteDecisionSchema,
  efforts,
  inputLimits,
  statusLabels,
  todoToolLabels,
  todoToolNameSchema,
} from '../contracts.ts';
import { errorMessage, getJson, jsonBody, streamChat } from './api.ts';

const suggestion = '「週末の買い物」をTodoに追加して';
const date = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'short',
  timeStyle: 'short',
});
const effortSchema = z.enum(efforts);
const chatStatusSchema = z.object({ enabled: z.boolean() });

function applyEvent(items: ChatItem[], event: ChatEvent): ChatItem[] {
  if (event.type === 'text' || event.type === 'reasoning') {
    if (items.some((item) => item.id === event.id)) {
      return items.map((item) =>
        item.id === event.id && item.kind !== 'tool'
          ? { ...item, text: item.text + event.delta }
          : item,
      );
    }
    return [
      ...items,
      {
        kind: event.type === 'text' ? 'assistant' : 'reasoning',
        id: event.id,
        text: event.delta,
      },
    ];
  }
  if (event.type === 'tool_start') {
    return [
      ...items,
      { kind: 'tool', id: event.id, name: event.name, args: event.args },
    ];
  }
  if (event.type === 'tool_result') {
    return items.map((item) =>
      item.kind === 'tool' && item.id === event.id
        ? { ...item, result: event.result, approval: event.approval }
        : item,
    );
  }
  return items;
}

function mergeHistory(remote: ChatItem[], live: ChatItem[]): ChatItem[] {
  const withResult = live.filter((item) => item.kind === 'tool' && item.result);
  const historyIds = new Set(remote.map((item) => item.id));
  return [
    ...remote.map((item) =>
      item.kind === 'tool' && !item.result
        ? (withResult.find((tool) => tool.id === item.id) ?? item)
        : item,
    ),
    ...withResult.filter((item) => !historyIds.has(item.id)),
  ];
}

export function ChatPanel({
  onTodoChange,
  open,
}: {
  onTodoChange: () => Promise<void>;
  open: boolean;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [conversationId, setConversationId] = useState<string>();
  const [effort, setEffort] = useState<ChatInput['effort']>('medium');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState('');
  const [error, setError] = useState('');
  const [canRecover, setCanRecover] = useState(false);
  const transcript = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);

  useEffect(() => {
    const controller = new AbortController();
    void getJson('/api/chat/status', chatStatusSchema, {
      signal: controller.signal,
    })
      .then(({ enabled }) => setEnabled(enabled))
      .catch(() => {
        if (!controller.signal.aborted)
          setError('チャットの利用状況を確認できませんでした。');
      });
    return () => controller.abort();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Content and activity changes affect the scroll geometry.
  useEffect(() => {
    const node = transcript.current;
    if (node && follow.current) node.scrollTop = node.scrollHeight;
  }, [items, activity]);

  async function listHistory() {
    setHistory(
      await getJson('/api/chat/conversations', z.array(conversationSchema)),
    );
  }

  async function toggleHistory() {
    setShowHistory(!showHistory);
    if (showHistory) return;
    setError('');
    try {
      await listHistory();
    } catch (error) {
      setError(errorMessage(error, '会話一覧を取得できませんでした。'));
    }
  }

  async function getHistory(id: string) {
    return getJson(
      `/api/chat/conversations/${encodeURIComponent(id)}`,
      z.array(chatItemSchema),
    );
  }

  async function openHistory(id: string) {
    setBusy(true);
    setError('');
    setShowHistory(false);
    setActivity('会話を読み込んでいます…');
    try {
      const restored = await getHistory(id);
      follow.current = true;
      setConversationId(id);
      setCanRecover(false);
      setItems(restored);
      setText('');
    } catch (error) {
      setError(errorMessage(error, '会話を読み込めませんでした。'));
    } finally {
      setBusy(false);
      setActivity('');
    }
  }

  function newChat() {
    setConversationId(undefined);
    setCanRecover(false);
    setItems([]);
    setText('');
    setError('');
    setShowHistory(false);
    composer.current?.focus();
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = text.trim();
    if (busy || !enabled || !message) return;
    const requestId = crypto.randomUUID();
    const names = new Map<string, string>();
    let currentId = conversationId;
    follow.current = true;
    setBusy(true);
    setShowHistory(false);
    setError('');
    setCanRecover(false);
    setActivity('モデルの応答を待っています…');
    setItems((previous) => [
      ...previous,
      { kind: 'user', id: requestId, text: message },
    ]);
    setText('');

    try {
      await streamChat(
        { conversationId, text: message, effort, requestId },
        (event) => {
          if (event.type === 'conversation') {
            currentId = event.id;
            setConversationId(event.id);
          } else if (event.type === 'tool_start') {
            names.set(event.id, event.name);
            setActivity(`${toolLabel(event.name)}しています…`);
          } else if (event.type === 'tool_result') {
            setActivity('モデルの応答を待っています…');
            if (event.result.ok && 'todo' in event.result && !event.approval) {
              const tool = names.get(event.id);
              if (tool === 'create_todo' || tool === 'update_todo')
                void onTodoChange();
            }
          } else if (event.type === 'text') {
            setActivity('返答を受信しています…');
          }
          setItems((previous) => applyEvent(previous, event));
        },
      );
    } catch (error) {
      setError(errorMessage(error, 'チャットの応答を完了できませんでした。'));
      setCanRecover(true);
      await recover(currentId);
    } finally {
      setActivity('');
      setBusy(false);
    }
  }

  async function decideDeletion(
    itemId: string,
    approvalId: string,
    decision: z.infer<typeof deleteDecisionSchema>,
  ) {
    const approval = await getJson(
      `/api/chat/conversations/${encodeURIComponent(conversationId ?? '')}/delete-approvals/${approvalId}`,
      deleteApprovalSchema,
      { method: 'POST', ...jsonBody(decision) },
    );
    setItems((previous) =>
      previous.map((item) =>
        item.kind === 'tool' && item.id === itemId
          ? { ...item, approval }
          : item,
      ),
    );
    if (approval.state === 'deleted' || approval.state === 'missing')
      void onTodoChange();
  }

  async function recover(id: string | undefined) {
    await Promise.allSettled([
      onTodoChange(),
      listHistory(),
      id
        ? getHistory(id).then((restored) => {
            if (restored.length)
              setItems((live) => mergeHistory(restored, live));
          })
        : undefined,
    ]);
  }

  function keyboardSend(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === 'Enter' &&
      (event.metaKey || event.ctrlKey) &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <aside
      id="chat-panel"
      className={open ? 'chat-panel mobile-open' : 'chat-panel'}
      aria-labelledby="chat-heading"
    >
      <header className="chat-header">
        <span className="chat-icon">
          <Sparkles size={19} />
        </span>
        <div>
          <h2 id="chat-heading">Todoアシスタント</h2>
          <span className="model-name">GPT-6 Luna</span>
        </div>
        <div className="chat-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="会話履歴"
            title="会話履歴"
            aria-expanded={showHistory}
            disabled={busy || !enabled}
            onClick={() => void toggleHistory()}
          >
            <History size={19} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="新しい会話"
            title="新しい会話"
            disabled={busy || !enabled}
            onClick={newChat}
          >
            <Plus size={20} />
          </button>
        </div>
      </header>
      {showHistory && (
        <section className="history" aria-label="会話一覧">
          <h3>会話履歴</h3>
          {history.length ? (
            history.map((conversation) => (
              <button
                type="button"
                key={conversation.id}
                aria-current={conversation.id === conversationId}
                onClick={() => void openHistory(conversation.id)}
              >
                <MessageSquare size={15} />
                {date.format(new Date(conversation.updatedAt))}
                {conversation.id === conversationId && <Check size={15} />}
              </button>
            ))
          ) : (
            <p>会話履歴はまだありません。</p>
          )}
        </section>
      )}
      <div
        className="chat-scroll"
        ref={transcript}
        onScroll={(event) => {
          const node = event.currentTarget;
          follow.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 64;
        }}
      >
        {items.length ? (
          <ol aria-label="会話" className="messages">
            {items.map((item) => (
              <Message
                key={item.id}
                item={item}
                busy={busy}
                onDelete={decideDeletion}
              />
            ))}
          </ol>
        ) : (
          <div className="chat-empty">
            <span className="empty-sparkle">
              <Sparkles size={27} strokeWidth={1.6} />
            </span>
            <h3>チャットでTodoを管理</h3>
            <button
              type="button"
              className="suggestion"
              disabled={!enabled || busy}
              onClick={() => {
                setText(suggestion);
                composer.current?.focus();
              }}
            >
              <MessageSquare size={15} /> {suggestion}
            </button>
          </div>
        )}
      </div>
      {activity && (
        <p className="activity" role="status">
          <LoaderCircle size={15} />
          {activity}
        </p>
      )}
      {error && (
        <div className="chat-error">
          <p role="alert">
            <CircleAlert size={16} /> {error}
          </p>
          {canRecover && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await recover(conversationId);
                  if (!conversationId) setShowHistory(true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              一覧と履歴を再読み込み
            </button>
          )}
        </div>
      )}
      <form className="composer" onSubmit={send}>
        {enabled === false && (
          <p className="key-notice">
            <KeyRound size={15} />
            チャットを使うには OpenAI APIキーを設定してください。
          </p>
        )}
        <div className="composer-box">
          <textarea
            ref={composer}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={inputLimits.message}
            rows={2}
            disabled={!enabled || busy}
            onKeyDown={keyboardSend}
            aria-label="メッセージ"
            placeholder="Todoの検索や変更を頼む…"
          />
          <div className="composer-actions">
            <label className="effort">
              推論レベル
              <select
                value={effort}
                disabled={!enabled || busy}
                onChange={(event) =>
                  setEffort(effortSchema.parse(event.target.value))
                }
              >
                {efforts.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="send-button"
              aria-label="送信"
              type="submit"
              disabled={!enabled || !text.trim() || busy}
            >
              <ArrowUp size={20} />
            </button>
          </div>
        </div>
      </form>
    </aside>
  );
}

function toolLabel(name: string) {
  const parsed = todoToolNameSchema.safeParse(name);
  return parsed.success ? todoToolLabels[parsed.data] : 'ツールを実行';
}

type DecideDeletion = (
  itemId: string,
  approvalId: string,
  decision: z.infer<typeof deleteDecisionSchema>,
) => Promise<void>;

function Message({
  item,
  busy,
  onDelete,
}: {
  item: ChatItem;
  busy: boolean;
  onDelete: DecideDeletion;
}) {
  if (item.kind === 'tool') {
    const label = toolLabel(item.name);
    const result = item.result
      ? item.result.ok
        ? item.approval
          ? '確認を表示'
          : '成功'
        : '失敗'
      : busy
        ? '実行中'
        : '結果を取得できませんでした';
    return (
      <li>
        <details className="tool-details">
          <summary>
            <Wrench size={15} />
            {label}
            <span className={item.result?.ok ? 'tool-success' : ''}>
              {result}
            </span>
            <ChevronDown size={15} />
          </summary>
          <div>
            <strong>引数</strong>
            <pre>{JSON.stringify(item.args, null, 2)}</pre>
            {item.result && (
              <>
                <strong>実行結果</strong>
                <pre>
                  {JSON.stringify(
                    item.result.ok && 'todo' in item.result
                      ? item.result.todo
                      : item.result,
                    null,
                    2,
                  )}
                </pre>
              </>
            )}
          </div>
        </details>
        {item.approval && (
          <DeleteConfirmation
            approval={item.approval}
            busy={busy}
            onDecide={(approvalId, decision) =>
              onDelete(item.id, approvalId, decision)
            }
          />
        )}
      </li>
    );
  }
  if (item.kind === 'reasoning') {
    return (
      <li>
        <details className="tool-details">
          <summary>
            <Sparkles size={15} />
            推論の要約
            <ChevronDown size={15} />
          </summary>
          <p>{item.text}</p>
        </details>
      </li>
    );
  }
  return (
    <li
      className={`message ${item.kind}`}
      aria-label={item.kind === 'user' ? 'あなた' : 'アシスタント'}
    >
      {item.text}
    </li>
  );
}

const approvalMessages = {
  deleted: 'Todoを削除しました。',
  cancelled: '削除を取り消しました。',
  missing: '対象のTodoが見つかりません。',
  expired:
    'この削除確認は終了しました。必要なら一覧を確認し、もう一度依頼してください。',
} as const;

function DeleteConfirmation({
  approval,
  busy,
  onDecide,
}: {
  approval: DeleteApproval;
  busy: boolean;
  onDecide: (
    id: string,
    decision: z.infer<typeof deleteDecisionSchema>,
  ) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  async function decide(
    id: string,
    decision: z.infer<typeof deleteDecisionSchema>,
  ) {
    setSubmitting(true);
    setError('');
    try {
      await onDecide(id, decision);
    } catch (error) {
      setError(errorMessage(error, '削除確認を処理できませんでした。'));
    } finally {
      setSubmitting(false);
    }
  }
  if (!('todo' in approval))
    return (
      <p className="delete-confirmation" role="status">
        {approvalMessages[approval.state]}
      </p>
    );
  return (
    <section className="delete-confirmation" aria-label="Todoの削除確認">
      <p role="status">
        {approval.state === 'changed'
          ? 'Todoが変更されました。最新の内容を確認してください。'
          : 'このTodoを削除しますか？'}
      </p>
      <strong>{approval.todo.title}</strong>
      <p>{statusLabels[approval.todo.status]}</p>
      {approval.todo.details && <p>{approval.todo.details}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="delete-confirmation-actions">
        <button
          type="button"
          className="button secondary"
          disabled={busy || submitting}
          onClick={() => void decide(approval.id, { decision: 'cancel' })}
        >
          キャンセル
        </button>
        <button
          type="button"
          className="button danger"
          disabled={busy || submitting}
          onClick={() =>
            void decide(approval.id, {
              decision: 'approve',
              revision: approval.revision,
            })
          }
        >
          削除する
        </button>
      </div>
    </section>
  );
}
