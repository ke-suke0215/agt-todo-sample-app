import type { Context } from 'hono';

export async function readJson(context: Context): Promise<unknown> {
  if (
    context.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  ) {
    return undefined;
  }
  return context.req.json().catch(() => undefined);
}
