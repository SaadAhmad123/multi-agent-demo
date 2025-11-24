import { cleanString, createArvoOrchestratorContract } from 'arvo-core';
import z from 'zod';
import { createArvoAgent } from '../../Agent/index.js';
import { openaiLLMIntegration } from '../../Agent/integrations/openai.js';
import type { EventHandlerFactory, IMachineMemory } from 'arvo-event-handler';
import type { AgentMessage } from '../../Agent/types.js';
import { calculatorContract } from '../calculator.handler.js';
import { createAgentTool } from '../../Agent/agentTool.js';
import { MCPClient } from '../../Agent/integrations/MCPClient.js';
import { humanReviewContract } from '../../agentFactory/createAgent/index.js';

const ALIAS = 'aleej';
export const calculatorAgentContract = createArvoOrchestratorContract({
  uri: '#/demo/amas/new/agent/calculator',
  name: 'agent.calculator',
  description: 'This is a calculator agent',
  versions: {
    '1.0.0': {
      init: z.object({
        message: z.string(),
        image: z.string().optional(),
        file: z.string().optional(),
      }),
      complete: z.object({
        response: z.string(),
      }),
    },
  },
  metadata: {
    alias: ALIAS,
  },
});

export const calculatorAgent: EventHandlerFactory<{ memory: IMachineMemory<Record<string, unknown>> }> = ({ memory }) =>
  createArvoAgent({
    contracts: {
      self: calculatorAgentContract,
      services: {
        calculator: {
          contract: calculatorContract.version('1.0.0'),
        },
        humanReview: {
          contract: humanReviewContract.version('1.0.0'),
          domains: ['human.interaction'],
        },
      },
    },
    mcp: new MCPClient({
      url: 'https://mcp.docs.astro.build/mcp',
    }),
    llmResponseType: 'json',
    llm: openaiLLMIntegration(),
    maxToolInteractions: 5,
    memory,
    tools: {
      selfTalk: createAgentTool({
        name: 'tool.self.talk',
        description:
          'A tool for an AI Agent to records its own thoughts so that it can refer to them later via the conversation history',
        input: z.object({ note_to_self: z.string().describe('The string to record as a note to self') }),
        output: z.object({ recorded: z.boolean() }),
        fn: () => ({ recorded: true }),
      }),
    },
    handler: {
      '1.0.0': {
        context: async ({ input, tools }) => {
          const system = cleanString(`
            You are a calculator agent as well as a astro documentation search agent and you must calculate the expression to the best of your abilities.
            First You must read the images and files, if provided to you, and note what you have gathered from them
            by calling the tool ${tools.tools.selfTalk.name}.
            Then you must create a plan and get approval from the tool ${tools.services.humanReview.name}. You are banned from calling any tool other than ${tools.tools.selfTalk.name} before
            getting explicit approval from the tool ${tools.services.humanReview.name}
            If the user requests for information regarding astro, the use the relevant tools.
            If the user requests for a calculations, then use tool ${tools.services.calculator.name}.
            Then, you must use the tool ${tools.services.calculator.name} to perform the calculations.
          `);
          const messages: AgentMessage[] = [
            {
              role: 'user',
              content: { type: 'text', content: input.data.message },
            },
          ];
          if (input.data.image) {
            messages.push({
              role: 'user',
              content: { type: 'media', content: input.data.image, contentType: { type: 'image', format: 'base64' } },
            });
          }
          if (input.data.file) {
            messages.push({
              role: 'user',
              content: { type: 'media', content: input.data.file, contentType: { type: 'file', format: 'base64' } },
            });
          }
          return { system, messages };
        },
        output: async (param) => {
          if (param.type === 'json') {
            const { error, data } = param.outputFormat.safeParse(param.parsedContent);
            if (error) return { error };
            return { data };
          }
          return {
            data: {
              response: 'Invalid repsonse',
            },
          };
        },
      },
    },
  });
