import { z } from 'zod';
import type { AgentRunnerExecuteParam } from './types.js';

const SelfInformationSchema = z.object({
  alias: z.string().nullable(),
  source: z.string(),
  agentic_source: z.string(),
});

const DelegatedBySchema = z
  .object({
    alias: z.string().nullable(),
    source: z.string(),
  })
  .nullable();

export const AgentRunnerEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('execution.started'),
    data: z.object({
      lifecycle: z.enum(['init', 'tool_results']),
      messageCount: z.number(),
      toolCount: z.number(),
      selfInformation: SelfInformationSchema,
      delegatedBy: DelegatedBySchema,
    }),
  }),

  z.object({
    type: z.literal('execution.completed'),
    data: z.object({
      response: z.string().nullable(),
      hasPendingTools: z.boolean(),
      toolInteractionCount: z.number(),
      selfInformation: SelfInformationSchema,
      delegatedBy: DelegatedBySchema,
    }),
  }),

  z.object({
    type: z.literal('llm.call.started'),
    data: z.object({
      messageCount: z.number(),
      toolCount: z.number(),
      systemPromptLength: z.number(),
      selfInformation: SelfInformationSchema,
      delegatedBy: DelegatedBySchema,
    }),
  }),

  z.object({
    type: z.literal('llm.call.completed'),
    data: z.object({
      response: z.string().nullable(),
      toolRequestCount: z.number(),
      usage: z
        .object({
          promptTokens: z.number(),
          completionTokens: z.number(),
        })
        .nullable(),
      selfInformation: SelfInformationSchema,
      delegatedBy: DelegatedBySchema,
    }),
  }),

  z.object({
    type: z.literal('llm.stream'),
    data: z.object({
      response: z.string(),
      delta: z.string().nullable(),
      selfInformation: SelfInformationSchema,
      delegatedBy: DelegatedBySchema,
    }),
  }),

  z.object({
    type: z.literal('tool.mcp.executing'),
    data: z.object({
      type: z.string(),
      selfInformation: SelfInformationSchema,
      delegatedBy: DelegatedBySchema,
    }),
  }),

  z.object({
    type: z.literal('tool.budget.exhausted'),
    data: z.object({
      toolInteractionCount: z.number(),
      maxToolInteractions: z.number(),
      selfInformation: SelfInformationSchema,
      delegatedBy: DelegatedBySchema,
    }),
  }),

  z.object({
    type: z.literal('execution.failed'),
    data: z.object({
      error: z.string(),
      iteration: z.number(),
      toolInteractionCount: z.number(),
      selfInformation: SelfInformationSchema,
      delegatedBy: DelegatedBySchema,
    }),
  }),

  z.object({
    type: z.literal('context.build.started'),
    data: z.object({
      message: z.string().default('Collecting data to build context').optional(),
      selfInformation: SelfInformationSchema,
      delegatedBy: DelegatedBySchema,
    }),
  }),

  z.object({
    type: z.literal('context.build.success'),
    data: z.object({
      message: z.string().default('Successfully engineered the context to use').optional(),
      selfInformation: SelfInformationSchema,
      delegatedBy: DelegatedBySchema,
    }),
  }),
]);

export type AgentRunnerEvent = z.infer<typeof AgentRunnerEventSchema>;

export const streamEmitter = (event: AgentRunnerEvent, stream: AgentRunnerExecuteParam['stream']) => {
  if (!stream) return;
  const { success, data } = AgentRunnerEventSchema.safeParse(event);
  if (!success) return;
  stream(data).catch(() => {});
};
