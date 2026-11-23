import { z } from 'zod';

export const statuses = ['pending', 'in_progress', 'done'] as const;
export const statusLabels = {
  pending: '未着手',
  in_progress: '進行中',
  done: '完了',
} as const;

export const inputLimits = {
  title: 200,
  details: 5000,
  message: 10000,
} as const;

const title = z
  .string()
  .trim()
  .min(1)
  .max(inputLimits.title)
  .regex(/^[^\r\n]+$/);
const details = z.string().max(inputLimits.details);
export const todoInput = z.object({
  title,
  details: details.default(''),
  status: z.enum(statuses).default('pending'),
});
export const todoFields = z.object({
  title,
  details,
  status: z.enum(statuses),
});
export type TodoInput = z.output<typeof todoInput>;
export const todoSchema = todoFields.extend({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type Todo = z.infer<typeof todoSchema>;

export const efforts = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export const chatInput = z.object({
  text: z.string().trim().min(1).max(inputLimits.message),
  effort: z.enum(efforts),
  requestId: z.uuid(),
  conversationId: z.string().max(150).optional(),
});
export type ChatInput = z.output<typeof chatInput>;
export const conversationSchema = z.object({
  id: z.string(),
  updatedAt: z.iso.datetime(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const toolResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), todo: todoSchema }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);
export type ToolResult = z.infer<typeof toolResultSchema>;

export const chatItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['user', 'assistant', 'reasoning']),
    id: z.string(),
    text: z.string(),
  }),
  z.object({
    kind: z.literal('tool'),
    id: z.string(),
    name: z.string(),
    args: z.json(),
    result: toolResultSchema.optional(),
  }),
]);
export type ChatItem = z.infer<typeof chatItemSchema>;

export const chatEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('conversation'), id: z.string() }),
  z.object({ type: z.enum(['waiting', 'done']) }),
  z.object({
    type: z.enum(['text', 'reasoning']),
    id: z.string(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal('tool_start'),
    id: z.string(),
    name: z.string(),
    args: z.json(),
  }),
  z.object({
    type: z.literal('tool_result'),
    id: z.string(),
    result: toolResultSchema,
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type ChatEvent = z.infer<typeof chatEventSchema>;
