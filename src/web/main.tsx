import { ListChecks } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { todoSchema } from '../contracts.ts';
import type { Todo } from '../contracts.ts';
import { errorMessage, getJson } from './api.ts';
import { ChatPanel } from './chat.tsx';
import { TodoBoard } from './todos.tsx';
import './styles.css';

function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++latest.current;
    try {
      const list = await getJson('/api/todos', z.array(todoSchema));
      if (request === latest.current) {
        setTodos(list);
        setLoadError('');
      }
    } catch (error) {
      if (request === latest.current) setLoadError(errorMessage(error, 'Todo一覧を読み込めませんでした。'));
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <>
      <header className="app-header"><div className="app-header-inner"><div className="brand"><span><ListChecks size={21} /></span>Todo</div></div></header>
      <main className="workspace">
        <TodoBoard todos={todos} loading={loading} loadError={loadError} refresh={refresh} />
        <ChatPanel onTodoChange={refresh} />
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
