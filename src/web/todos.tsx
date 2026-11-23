import {
  ArrowDownRight, ArrowUpRight, Check, ChevronDown, Circle, ClipboardList, ListTodo, Plus, Search, Trash2, X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { inputLimits, statusLabels, statuses, todoInput, todoSchema } from '../contracts.ts';
import type { Todo, TodoInput } from '../contracts.ts';
import { errorMessage, getJson, jsonBody, requireOk } from './api.ts';

const emptyTodo: TodoInput = { title: '', details: '', status: 'pending' };

export function TodoBoard({ todos, loading, loadError, refresh }: {
  todos: Todo[]; loading: boolean; loadError: string; refresh: () => Promise<void>;
}) {
  const [filter, setFilter] = useState<Todo['status'] | 'all'>('all');
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<Todo | 'new' | null>(null);
  const complete = todos.filter((todo) => todo.status === 'done').length;
  const matches = todos.filter((todo) => {
    const text = `${todo.title}\n${todo.details}`.toLocaleLowerCase();
    return (filter === 'all' || todo.status === filter) && text.includes(query.trim().toLocaleLowerCase());
  });

  return (
    <section className="todo-board" aria-labelledby="todos-heading">
      <header className="board-header">
        <div className="board-title"><h1 id="todos-heading">マイタスク</h1></div>
        <button className="button primary add-button" onClick={() => setEditor('new')}><Plus size={18} /> Todoを追加</button>
      </header>
      <div className="summary-grid">
        <Summary icon={<ListTodo size={17} />} label="すべて" count={todos.length} />
        <Summary icon={<ArrowUpRight size={17} />} label="進行中" count={todos.filter((todo) => todo.status === 'in_progress').length} />
        <Summary icon={<Check size={17} />} label="完了" count={complete} />
      </div>
      <div className="list-card">
        <div className="list-heading">
          <h2>Todo一覧</h2>
          <label className="search"><Search size={16} /><input type="search" aria-label="Todoを検索" placeholder="Todoを検索" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        </div>
        <div className="filters" aria-label="ステータスで絞り込む">
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>すべて</button>
          {statuses.map((status) => <button key={status} aria-pressed={filter === status} onClick={() => setFilter(status)}>{statusLabels[status]}</button>)}
        </div>
        {loadError && <p role="alert" className="list-error">{loadError} <button className="text-button" onClick={() => void refresh()}>再読み込み</button></p>}
        {loading ? <p className="loading" role="status">読み込み中…</p> : matches.length > 0 ? (
          <ul className="todo-list">
            {matches.map((todo) => (
              <li key={todo.id}>
                <button className="todo-row" onClick={() => setEditor(todo)}>
                  <span className={`todo-marker ${todo.status}`}>{todo.status === 'done' ? <Check size={14} /> : <Circle size={14} />}</span>
                  <span className="todo-row-text"><strong>{todo.title}</strong>{todo.details && <span>{todo.details}</span>}</span>
                  <span className={`status-pill ${todo.status}`}>{statusLabels[todo.status]}</span>
                  <ChevronDown className="todo-chevron" size={17} />
                </button>
              </li>
            ))}
          </ul>
        ) : !loadError && (
          <div className="todo-empty">
            <span className="empty-icon"><ClipboardList size={25} strokeWidth={1.6} /></span>
            <h3>{filter !== 'all' || query.trim() ? '一致するTodoがありません' : 'Todoはまだありません'}</h3>
            {filter === 'all' && !query.trim() && <button className="text-button" onClick={() => setEditor('new')}>最初のTodoを追加 <ArrowDownRight size={15} /></button>}
          </div>
        )}
      </div>
      {editor !== null && <TodoEditor todo={editor === 'new' ? undefined : editor} close={() => setEditor(null)} refresh={refresh} />}
    </section>
  );
}

function Summary({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  return <div className="summary"><span className="summary-icon">{icon}</span><span>{label}</span><strong>{count}</strong></div>;
}

function TodoEditor({ todo, close, refresh }: { todo?: Todo; close: () => void; refresh: () => Promise<void> }) {
  const [fields, setFields] = useState<TodoInput>(todo ?? emptyTodo);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || confirm) return;
    const input = todoInput.safeParse(fields);
    if (!input.success) {
      setError('タイトルを入力し、入力内容を確認してください。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await getJson(todo ? `/api/todos/${todo.id}` : '/api/todos', todoSchema, {
        method: todo ? 'PUT' : 'POST', ...jsonBody(input.data),
      });
      await refresh();
      close();
    } catch (error) {
      setError(errorMessage(error, 'Todoを保存できませんでした。'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!todo || busy) return;
    setBusy(true);
    setError('');
    try {
      await requireOk(await fetch(`/api/todos/${todo.id}`, { method: 'DELETE' }));
      await refresh();
      close();
    } catch (error) {
      setError(errorMessage(error, 'Todoを削除できませんでした。'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby="editor-title" className="editor" onCancel={(event) => {
      event.preventDefault();
      if (!busy) close();
    }}>
      <form onSubmit={save}>
        <header className="editor-header">
          <h2 id="editor-title">{todo ? 'Todoの詳細' : 'Todoを追加'}</h2>
          <button type="button" className="icon-button" aria-label="閉じる" disabled={busy} onClick={close}><X size={20} /></button>
        </header>
        <div className="editor-fields">
          <label>タイトル<input required maxLength={inputLimits.title} value={fields.title} onChange={(event) => setFields({ ...fields, title: event.target.value })} /></label>
          <label>詳細<textarea rows={4} maxLength={inputLimits.details} value={fields.details} onChange={(event) => setFields({ ...fields, details: event.target.value })} /></label>
          <label>ステータス<select value={fields.status} onChange={(event) => {
            const status = todoSchema.shape.status.parse(event.target.value);
            setFields({ ...fields, status });
          }}>{statuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
          {error && <p role="alert" className="error">{error}</p>}
          {confirm && <p className="delete-copy">「{todo?.title}」を削除しますか？</p>}
        </div>
        <footer className="editor-footer">
          {todo && !confirm && <button type="button" className="button danger-link" disabled={busy} onClick={() => setConfirm(true)}><Trash2 size={16} /> 削除</button>}
          <div className="editor-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={() => confirm ? setConfirm(false) : close()}>キャンセル</button>
            {confirm ? <button type="button" className="button danger" disabled={busy} onClick={() => void remove()}>削除する</button> :
              <button className="button primary" disabled={busy} type="submit">{busy ? '保存中…' : todo ? '保存' : '追加する'}</button>}
          </div>
        </footer>
      </form>
    </dialog>
  );
}
