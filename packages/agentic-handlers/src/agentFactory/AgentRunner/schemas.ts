import { z } from 'zod';
import type { NonEmptyArray } from '../types.js';

export const AgentToolResultMessageContentSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.string(),
});

export const AgentToolCallMessageContentSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.object({}).passthrough(), // Allows any object structure
});

export const AgentTextMessageContentSchema = z.object({
  type: z.literal('text'),
  content: z.string(),
});

export const AgentMessageContentSchema = z.discriminatedUnion('type', [
  AgentToolResultMessageContentSchema,
  AgentToolCallMessageContentSchema,
  AgentTextMessageContentSchema,
]);

export const AgentMessageRole = {
  USER: 'user',
  ASSISTANT: 'assistant',
} as const;

export const AgentMessageSchema = z.object({
  role: z.enum(
    Object.values(AgentMessageRole) as NonEmptyArray<(typeof AgentMessageRole)[keyof typeof AgentMessageRole]>,
  ),
  content: AgentMessageContentSchema.array(),
});

export const AgentToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  input_schema: z.record(z.string(), z.any()),
  requires_approval: z.boolean().optional(),
});

export const AgentRunnerLifecycle = {
  INIT: 'init',
  TOOL_RESULT: 'tool_results',
} as const;

export const AgentToolRequestSchema = z.object({
  type: z.string(),
  data: z.record(z.string(), z.any()),
  id: z.string(),
});
