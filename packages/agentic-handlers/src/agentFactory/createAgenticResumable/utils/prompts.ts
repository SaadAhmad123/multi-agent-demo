import type z from 'zod';
import type { AgenticToolDefinition, CreateAgenticResumableParams, LLMIntegrationParam } from '../../types.js';

export const buildSystemPrompt = (
  config: CreateAgenticResumableParams<string, z.AnyZodObject>,
  messages: LLMIntegrationParam['messages'],
  toolDef: AgenticToolDefinition[],
  type: LLMIntegrationParam['type'],
  extensionSystemPrompt?: string,
): string => {
  const systemPrompts: string[] = [];

  if (config.systemPrompt) {
    systemPrompts.push(
      config.systemPrompt({
        messages,
        toolDefinitions: toolDef,
        type,
      }),
    );
  }

  if (extensionSystemPrompt) {
    systemPrompts.push(extensionSystemPrompt);
  }

  return systemPrompts.join('\n\n');
};
