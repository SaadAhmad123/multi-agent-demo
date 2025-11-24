import { cleanString, createArvoOrchestratorContract } from 'arvo-core';
import { createArvoAgent } from '../../Agent/index.js';
import { openaiLLMIntegration } from '../../Agent/integrations/openai.js';
import type { EventHandlerFactory, IMachineMemory } from 'arvo-event-handler';
import { calculatorContract } from '../calculator.handler.js';
import { MCPClient } from '../../Agent/integrations/MCPClient.js';
import { humanReviewContract } from '../../agentFactory/createAgent/index.js';
import { AgentDefaults } from '../../Agent/AgentDefaults.js';

const ALIAS = 'aleej';
export const calculatorAgentContract = createArvoOrchestratorContract({
  uri: '#/demo/amas/new/agent/calculator',
  name: 'agent.calculator',
  description: 'This is a calculator agent',
  versions: {
    '1.0.0': {
      init: AgentDefaults.INIT_SCHEMA,
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
    llm: openaiLLMIntegration(),
    memory,
    // tools: {
    //   selfTalk: createAgentTool({
    //     name: 'tool.self.talk',
    //     description:
    //       'A tool for an AI Agent to records its own thoughts so that it can refer to them later via the conversation history',
    //     input: z.object({ note_to_self: z.string().describe('The string to record as a note to self') }),
    //     output: z.object({ recorded: z.boolean() }),
    //     fn: () => ({ recorded: true }),
    //   }),
    // },
    handler: {
      '1.0.0': {
        context: AgentDefaults.CONTEXT_BUILDER(({ tools }) =>
          cleanString(`
            You are a calculator agent as well as a astro documentation search agent and you must calculate the expression to the best of your abilities.
            You must create a plan and get approval from the tool ${tools.services.humanReview.name}. You are banned from calling any tool before
            getting explicit approval from the tool ${tools.services.humanReview.name}
            If the user requests for information regarding astro, the use the relevant tools.
            If the user requests for a calculations, then use tool ${tools.services.calculator.name}.
            Then, you must use the tool ${tools.services.calculator.name} to perform the calculations.
          `),
        ),
        output: AgentDefaults.OUTPUT_BUILDER,
      },
    },
  });
