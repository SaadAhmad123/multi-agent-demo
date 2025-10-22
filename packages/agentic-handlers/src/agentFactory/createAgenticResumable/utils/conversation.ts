import type { LLMIntegrationParam } from '../../types.js';
import type { AgenticStateContext } from '../types.js';
import type { ArvoEvent, InferArvoEvent } from 'arvo-core';
import type { CreateAgenticResumableParams } from '../../types.js';
import type z from 'zod';
import { toolInteractionLimitPrompt } from '../../helpers.prompt.js';

export const initializeConversation = (
  input: { data: { message: string; additionalSystemPrompt?: string } },
  currentSubject: string,
  maxToolCallIterationAllowed: number,
): AgenticStateContext => {
  const messages: LLMIntegrationParam['messages'] = [];

  if (input.data.additionalSystemPrompt?.trim()) {
    messages.push({
      role: 'user',
      content: [
        {
          type: 'text',
          content: input.data.additionalSystemPrompt,
        },
      ],
    });
  }

  messages.push({
    role: 'user',
    content: [{ type: 'text', content: input.data.message }],
  });

  return {
    currentSubject,
    messages,
    toolTypeCount: {},
    currentToolCallIteration: 0,
    maxToolCallIterationAllowed,
  };
};

export const integrateToolResults = (
  context: AgenticStateContext,
  eventMap: Record<string, InferArvoEvent<ArvoEvent>[]> | null,
  services: NonNullable<CreateAgenticResumableParams<string, z.AnyZodObject>['services']> | null,
): LLMIntegrationParam['messages'] => {
  const errorEventType = new Set<string>(Object.values(services ?? {}).map((item) => item.systemError.type));
  const messages = [...context.messages];

  for (const eventList of Object.values(eventMap ?? {})) {
    for (const event of eventList as InferArvoEvent<ArvoEvent>[]) {
      const errorString = errorEventType.has(event.type)
        ? `
          // You must not call this tool again as it has failed. Just respond
          // to the user's request as much as you can and tell the user where
          // you failed and why.
        `
        : '';

      messages.push({
        role: 'user' as const,
        content: [
          {
            type: 'tool_result',
            tool_use_id: event.parentid ?? '',
            content: JSON.stringify({
              ...event.data,
              comment: errorString,
            }),
          },
        ],
      });
    }
  }

  return messages;
};

export const inegrateIterationLimitWarning = (
  messages: LLMIntegrationParam['messages'],
  context: AgenticStateContext,
): LLMIntegrationParam['messages'] => {
  if (context.currentToolCallIteration >= context.maxToolCallIterationAllowed - 1) {
    return [
      ...messages,
      {
        role: 'user',
        content: [
          {
            type: 'text',
            content: toolInteractionLimitPrompt(),
          },
        ],
      },
    ];
  }
  return messages;
};
