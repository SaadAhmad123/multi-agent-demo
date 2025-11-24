import z from 'zod';
import type {
  AgentContextBuilder,
  AgentInternalTool,
  AgentOutputBuilder,
  AgentServiceContract,
  AnyArvoOrchestratorContract,
  PromiseLike,
} from './types.js';
import type { ArvoSemanticVersion } from 'arvo-core';

export const AgentDefaults = {
  INIT_SCHEMA: z.object({
    message: z.string().describe('The input message to the agent'),
  }),
  COMPLETE_SCHEMA: z.object({
    response: z.string().describe('The output response of the agent'),
  }),
  CONTEXT_BUILDER:
    <
      T extends AnyArvoOrchestratorContract,
      V extends ArvoSemanticVersion,
      TServiceContract extends Record<string, AgentServiceContract>,
      TTools extends Record<string, AgentInternalTool>,
    >(
      systemPromptBuilder?: (
        param: Parameters<AgentContextBuilder<T, V, TServiceContract, TTools>>[0],
      ) => PromiseLike<string>,
    ): AgentContextBuilder<T, V, TServiceContract, TTools> =>
    async (param) => {
      return {
        system: (await systemPromptBuilder?.(param)) ?? null,
        messages: [{ role: 'user', content: { type: 'text', content: param.input.data.message } }],
      };
    },
  OUTPUT_BUILDER: ((param) => {
    return {
      data: {
        response: param.content,
      },
    };
  }) as AgentOutputBuilder,
} as const;
