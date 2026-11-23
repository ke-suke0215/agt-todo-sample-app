import { Hono } from 'hono';
import { todoFields, todoInput } from '../contracts.ts';
import type { Chat } from './chat.ts';
import { chatRoutes } from './chat-routes.ts';
import { readJson } from './http.ts';
import { isLoopbackUrl } from './local.ts';
import type { Store } from './store.ts';

export function createApp(store: Store, chat?: Chat) {
  const app = new Hono();
  app.use('*', async (context, next) => {
    const origin = context.req.header('Origin');
    if (!isLoopbackUrl(context.req.url) || (origin && !isLoopbackUrl(origin))) {
      return context.json(
        { error: 'ローカルの画面から操作してください。' },
        403,
      );
    }
    await next();
  });
  app.use('/api/*', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    await next();
  });

  app.onError((_error, context) =>
    context.json({ error: '処理に失敗しました。' }, 500),
  );
  app.get('/api/todos', (context) => context.json(store.listTodos()));
  app.post('/api/todos', async (context) => {
    const input = todoInput.safeParse(await readJson(context));
    if (!input.success)
      return context.json(
        { error: 'タイトルと入力内容を確認してください。' },
        400,
      );
    return context.json(store.createTodo(input.data), 201);
  });
  app.put('/api/todos/:id', async (context) => {
    const input = todoFields.safeParse(await readJson(context));
    if (!input.success)
      return context.json(
        { error: 'タイトルと入力内容を確認してください。' },
        400,
      );
    const todo = store.updateTodo(context.req.param('id'), input.data);
    if (!todo) return context.json({ error: 'Todoが見つかりません。' }, 404);
    return context.json(todo);
  });
  app.delete('/api/todos/:id', (context) => {
    if (!store.deleteTodo(context.req.param('id'))) {
      return context.json({ error: 'Todoが見つかりません。' }, 404);
    }
    return context.body(null, 204);
  });
  app.route('/api/chat', chatRoutes(store, chat));
  return app;
}
