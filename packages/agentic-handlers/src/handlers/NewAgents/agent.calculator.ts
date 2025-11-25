import { cleanString, createArvoOrchestratorContract } from 'arvo-core';
import { createArvoAgent } from '../../Agent/index.js';
import { openaiLLMIntegration } from '../../Agent/integrations/openai.js';
import type { EventHandlerFactory, IMachineMemory } from 'arvo-event-handler';
import { calculatorContract } from '../calculator.handler.js';
import { MCPClient } from '../../Agent/integrations/MCPClient.js';
import { humanReviewContract } from '../../agentFactory/createAgent/index.js';
import { AgentDefaults } from '../../Agent/AgentDefaults.js';
import z from 'zod';
import { createAgentTool } from '../../Agent/agentTool.js';
import { AgentMessage } from '../../Agent/types.js';
import { v4 } from 'uuid';

const ALIAS = 'aleej';
export const calculatorAgentContract = createArvoOrchestratorContract({
  uri: '#/demo/amas/new/agent/calculator',
  name: 'agent.calculator',
  description: 'This is a calculator agent',
  versions: {
    '1.0.0': {
      init: z.object({
        message: z.string(),
        pdfBase64: z.string().array().optional(),
        imageBase64: z.string().array().optional(),
      }),
      complete: AgentDefaults.COMPLETE_SCHEMA,
    },
  },
  metadata: {
    alias: ALIAS,
  },
});

export const calculatorAgent: EventHandlerFactory<{ memory: IMachineMemory<Record<string, unknown>> }> = ({ memory }) =>
  createArvoAgent({
    contracts: {
      // Event driven / Async function call interface of the agent
      self: calculatorAgentContract,
      // Event driven services/agents/humans in the event mesh that Agent is allowed to talk to.
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
    // Inline - Internal tools the agent can leverage
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
    // MCP tools that the agent can leverage
    mcp: new MCPClient({
      url: 'https://mcp.docs.astro.build/mcp',
    }),
    llm: openaiLLMIntegration({ model: 'gpt-4o' }),
    memory,
    
    handler: {
      '1.0.0': {
        // Dynamic context building for the agent when it is initialised.
        context: ({ input, tools }) => {
          const system = cleanString(`
            You are a calculator agent as well as a astro documentation search agent and you must calculate the expression to the best of your abilities.
            If a file is available to you then read it promptly and put all the relevant information from the file for your task in your note by calling tool ${tools.tools.selfTalk.name}.
            Putting the content of the files in tool ${tools.tools.selfTalk.name} is paramount because you can only see the file content once in your lifetime.
            For the tool ${tools.tools.selfTalk.name} you can be as verbose as you feel is necessary so that you can resolve the users request fully and confidently.
            Then, you must create a plan to resolve the request and get approval from the tool ${tools.services.humanReview.name}. You are banned from calling any tool, 
            other than ${tools.tools.selfTalk.name}, before
            getting explicit approval from the tool ${tools.services.humanReview.name}
            If the user requests for information regarding astro, the use the relevant tools.
            If the user requests for a calculations, then use tool ${tools.services.calculator.name}.
            Then, you must use the tool ${tools.services.calculator.name} to perform the calculations.

            Tip: You can call tools ${tools.tools.selfTalk.name} and ${tools.services.humanReview.name} in
            parallel if you can.
          `);

          const messages: AgentMessage[] = [
            {
              role: 'user',
              content: { type: 'text', content: input.data.message },
            },
          ];

          for (const item of input.data.pdfBase64 ?? []) {
            messages.push({
              role: 'user',
              content: {
                type: 'media',
                content: item,
                contentType: {
                  format: 'base64',
                  type: 'file',
                  filename: `${v4()}.pdf`,
                  filetype: 'pdf',
                },
              },
            });
          }

          for (const item of input.data.imageBase64 ?? []) {
            messages.push({
              role: 'user',
              content: {
                type: 'media',
                content: item,
                contentType: {
                  format: 'base64',
                  type: 'image',
                  filename: `${v4()}.png`,
                  filetype: 'png',
                },
              },
            });
          }

          return {
            messages,
            system,
          };
        },
        output: AgentDefaults.OUTPUT_BUILDER,
      },
    },
  });
