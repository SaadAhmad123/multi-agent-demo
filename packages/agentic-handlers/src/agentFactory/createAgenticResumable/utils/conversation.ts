import { cleanString, type ArvoEvent, type InferArvoEvent } from 'arvo-core';
import { toolInteractionLimitPrompt } from '../../helpers.prompt.js';
import type { AnyVersionedContract, LLMIntegrationOutput, LLMIntegrationParam } from '../../types.js';

export const initConversation = (
  input: { message: string; additionalSystemPrompt?: string; delagationSource?: { alias?: string; id: string } },
  maxToolCallIterationAllowed: number,
): LLMIntegrationParam['messages'] => {
  if (!input.message.trim()) {
    throw new Error('[Error] A non-empty input message is required to invoke the Agent');
  }
  let messages: LLMIntegrationParam['messages'] = [];
  if (input.additionalSystemPrompt?.trim()) {
    messages = [
      ...messages,
      {
        role: 'user',
        content: [
          {
            type: 'text',
            content: input.additionalSystemPrompt.trim(),
          },
        ],
      },
    ];
  }
  if (input.delagationSource) {
    messages = [
      ...messages,
      {
        role: 'user',
        content: [
          {
            type: 'text',
            content: cleanString(`
              You are being delegated by an agent named "${input.delagationSource.alias || input.delagationSource.id}".
            `),
          },
        ],
      },
    ];
  }
  messages = [
    ...messages,
    {
      role: 'user',
      content: [{ type: 'text', content: input.message.trim() }],
    },
  ];
  return integrateIterationLimitWarning(messages, 0, maxToolCallIterationAllowed);
};

export const integrateToolRequests = (
  messages: NonNullable<LLMIntegrationParam['messages']>,
  requests: NonNullable<LLMIntegrationOutput['toolRequests']> | null,
): LLMIntegrationParam['messages'] => {
  if (!requests) return messages;
  const toolMessages: LLMIntegrationParam['messages'] = [];
  for (const item of requests) {
    toolMessages.push({
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: item.id,
          name: item.type,
          input: item.data as Record<string, unknown>,
        },
      ],
    });
  }
  return [...messages, ...toolMessages];
};

export const integrateToolResults = (
  messages: LLMIntegrationParam['messages'],
  eventMap: Record<string, InferArvoEvent<ArvoEvent>[]>,
  services: Record<string, AnyVersionedContract>,
): LLMIntegrationParam['messages'] => {
  const errorEventType = new Set<string>(Object.values(services ?? {}).map((item) => item.systemError.type));
  for (const eventList of Object.values(eventMap ?? {})) {
    for (const event of eventList as InferArvoEvent<ArvoEvent>[]) {
      const errorComment = errorEventType.has(event.type)
        ? {
            __comment: `
              You must not call this tool again as it has failed. Just respond
              to the user's request as much as you can and tell the user where 
              and which tool failed and why.
            `,
          }
        : {};
      messages.push({
        role: 'user' as const,
        content: [
          {
            type: 'tool_result',
            tool_use_id: event.parentid ?? '',
            content: JSON.stringify({
              ...event.data,
              ...errorComment,
            }),
          },
        ],
      });
    }
  }
  return messages;
};

export const integrateIterationLimitWarning = (
  messages: LLMIntegrationParam['messages'],
  currentToolCallIteration: number,
  maxToolCallIterationAllowed: number,
): LLMIntegrationParam['messages'] => {
  if (currentToolCallIteration >= maxToolCallIterationAllowed - 1) {
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

export const integrateLLMResponse = (
  messages: LLMIntegrationParam['messages'],
  response: string | object | null,
): LLMIntegrationParam['messages'] => {
  if (!response) return messages;
  return [
    ...messages,
    {
      role: 'assistant',
      content: [{ type: 'text', content: typeof response === 'string' ? response : JSON.stringify(response) }],
    },
  ];
};
