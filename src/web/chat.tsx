import {
  ArrowUp, Check, ChevronDown, CircleAlert, History, KeyRound, LoaderCircle, MessageSquare, Plus, Sparkles, Wrench,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { z } from 'zod';
import { chatItemSchema, conversationSchema, efforts } from '../contracts.ts';
import type { ChatEvent, ChatInput, ChatItem, Conversation } from '../contracts.ts';
import { errorMessage, getJson, streamChat } from './api.ts';

const suggestion = '「週末の買い物」をTodoに追加して';
const date = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short' });
const effortSchema = z.enum(efforts);
const chatStatusSchema = z.object({ enabled: z.boolean() });

function applyEvent(items: ChatItem[], event: ChatEvent): ChatItem[] {
  if (event.type === 'text' || event.type === 'reasoning') {
    if (items.some((item) => item.id === event.id)) {
      return items.map((item) => item.id === event.id && item.kind !== 'tool'
        ? { ...item, text: item.text + event.delta } : item);
    }
    return [...items, { kind: event.type === 'text' ? 'assistant' : 'reasoning', id: event.id, text: event.delta }];
  }
  if (event.type === 'tool_start') {
    return [...items, { kind: 'tool', id: event.id, name: event.name, args: event.args }];
  }
  if (event.type === 'tool_result') {
    return items.map((item) => item.kind === 'tool' && item.id === event.id
      ? { ...item, result: event.result } : item);
  }
  return items;
}

export function ChatPanel({ onTodoChange }: { onTodoChange: () => Promise<void> }) {
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
  const transcript = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);

  useEffect(() => {
    const controller = new AbortController();
    void getJson('/api/chat/status', chatStatusSchema, { signal: controller.signal })
      .then(({ enabled }) => setEnabled(enabled))
      .catch(() => {
        if (!controller.signal.aborted) setError('チャットの利用状況を確認できませんでした。');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const node = transcript.current;
    if (node && follow.current) node.scrollTop = node.scrollHeight;
  }, [items, activity]);

  async function listHistory() {
    setHistory(await getJson('/api/chat/conversations', z.array(conversationSchema)));
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
    return getJson(`/api/chat/conversations/${encodeURIComponent(id)}`, z.array(chatItemSchema));
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
    let currentId = conversationId;
    follow.current = true;
    setBusy(true);
    setShowHistory(false);
    setError('');
    setActivity('モデルの応答を待っています…');
    setItems((previous) => [...previous, { kind: 'user', id: requestId, text: message }]);
    setText('');

    try {
      await streamChat({ conversationId, text: message, effort, requestId }, (event) => {
        if (event.type === 'conversation') {
          currentId = event.id;
          setConversationId(event.id);
        } else if (event.type === 'tool_start') {
          setActivity(event.name === 'create_todo' ? 'Todoを追加しています…' : 'ツールを実行しています…');
        } else if (event.type === 'tool_result') {
          setActivity('モデルの応答を待っています…');
          if (event.result.ok) void onTodoChange();
        } else if (event.type === 'text') {
          setActivity('返答を受信しています…');
        }
        setItems((previous) => applyEvent(previous, event));
      });
    } catch (error) {
      setError(errorMessage(error, 'チャットの応答を完了できませんでした。'));
      await Promise.allSettled([
        onTodoChange(),
        listHistory(),
        currentId ? getHistory(currentId).then((restored) => {
          if (restored.length) setItems(restored);
        }) : undefined,
      ]);
    } finally {
      setActivity('');
      setBusy(false);
    }
  }

  function keyboardSend(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <aside className="chat-panel" aria-labelledby="chat-heading">
      <header className="chat-header">
        <span className="chat-icon"><Sparkles size={19} /></span>
        <div><h2 id="chat-heading">Todoアシスタント</h2><span className="model-name">GPT-6 Luna</span></div>
        <div className="chat-actions">
          <button className="icon-button" aria-label="会話履歴" title="会話履歴" aria-expanded={showHistory}
            disabled={busy || !enabled} onClick={() => void toggleHistory()}><History size={19} /></button>
          <button className="icon-button" aria-label="新しい会話" title="新しい会話"
            disabled={busy || !enabled} onClick={newChat}><Plus size={20} /></button>
        </div>
      </header>
      {showHistory && (
        <section className="history" aria-label="会話一覧">
          <h3>会話履歴</h3>
          {history.length ? history.map((conversation) => (
            <button key={conversation.id} aria-current={conversation.id === conversationId}
              onClick={() => void openHistory(conversation.id)}>
              <MessageSquare size={15} />{date.format(new Date(conversation.updatedAt))}
              {conversation.id === conversationId && <Check size={15} />}
            </button>
          )) : <p>会話履歴はまだありません。</p>}
        </section>
      )}
      <div className="chat-scroll" ref={transcript} onScroll={(event) => {
        const node = event.currentTarget;
        follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64;
      }}>
        {items.length ? <ol aria-label="会話" className="messages">
          {items.map((item) => <Message key={item.id} item={item} busy={busy} />)}
        </ol> : (
          <div className="chat-empty">
            <span className="empty-sparkle"><Sparkles size={27} strokeWidth={1.6} /></span>
            <h3>チャットでTodoを追加</h3>
            <p>やることを、普段の言葉で伝えてください。</p>
            <button className="suggestion" disabled={!enabled || busy} onClick={() => {
              setText(suggestion);
              composer.current?.focus();
            }}><MessageSquare size={15} /> {suggestion}</button>
          </div>
        )}
      </div>
      {activity && <p className="activity" role="status"><LoaderCircle size={15} />{activity}</p>}
      {error && <p className="chat-error" role="alert"><CircleAlert size={16} />{error}</p>}
      <form className="composer" onSubmit={send}>
        {enabled === false && <p className="key-notice"><KeyRound size={15} />チャットを使うには OpenAI APIキーを設定してください。</p>}
        <div className="composer-box">
          <textarea ref={composer} value={text} onChange={(event) => setText(event.target.value)}
            maxLength={10000} rows={2} disabled={!enabled || busy} onKeyDown={keyboardSend}
            aria-label="メッセージ" placeholder="Todoの追加を頼む…" />
          <div className="composer-actions">
            <label className="effort">推論レベル<select value={effort} disabled={!enabled || busy}
              onChange={(event) => setEffort(effortSchema.parse(event.target.value))}>
              {efforts.map((value) => <option key={value} value={value}>{value}</option>)}
            </select></label>
            <button className="send-button" aria-label="送信" type="submit" disabled={!enabled || !text.trim() || busy}>
              <ArrowUp size={20} />
            </button>
          </div>
        </div>
      </form>
    </aside>
  );
}

function Message({ item, busy }: { item: ChatItem; busy: boolean }) {
  if (item.kind === 'tool') {
    const label = item.name === 'create_todo' ? 'Todoを追加' : item.name;
    const result = item.result ? item.result.ok ? '成功' : '失敗' : busy ? '実行中' : '結果を取得できませんでした';
    return <li><details className="tool-details">
      <summary><Wrench size={15} />{label}<span className={item.result?.ok ? 'tool-success' : ''}>{result}</span><ChevronDown size={15} /></summary>
      <div><strong>引数</strong><pre>{JSON.stringify(item.args, null, 2)}</pre>
        {item.result && <><strong>実行結果</strong><pre>{JSON.stringify(item.result.ok ? item.result.todo : item.result, null, 2)}</pre></>}
      </div>
    </details></li>;
  }
  if (item.kind === 'reasoning') {
    return <li><details className="tool-details"><summary><Sparkles size={15} />推論の要約<ChevronDown size={15} /></summary>
      <p>{item.text}</p>
    </details></li>;
  }
  return <li className={`message ${item.kind}`} aria-label={item.kind === 'user' ? 'あなた' : 'アシスタント'}>{item.text}</li>;
}
