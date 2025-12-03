import { createArvoOrchestratorContract } from 'arvo-core';
import type { EventHandlerFactory, IMachineMemory } from 'arvo-event-handler';
import { AgentDefaults, createArvoAgent, OpenAI, openaiLLMIntegration } from '@arvo-tools/agentic';

export const simpleAgentContract = createArvoOrchestratorContract({
  uri: '#/deno/amas/agent/simple',
  name: 'agent.simple',
  description: 'A simple AI agent which answers qu1estions',
  versions: {
    '1.0.0': {
      init: AgentDefaults.INIT_SCHEMA,
      complete: AgentDefaults.COMPLETE_SCHEMA,
    },
  },
});

export const simpleAgent: EventHandlerFactory<{ memory: IMachineMemory<Record<string, unknown>> }> = ({ memory }) =>
  createArvoAgent({
    contracts: {
      self: simpleAgentContract,
      services: {},
    },
    memory,
    onStream: ({type, data}) => {console.log(JSON.stringify({type, data}, null, 2))},
    llm: openaiLLMIntegration(
      new OpenAI.OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') }),
      {
        invocationParam: {
          stream: true,
        },
      },
    ),
    handler: {
      '1.0.0': {
        context: AgentDefaults.CONTEXT_BUILDER(() => 'You are a helpful agent'),
        output: AgentDefaults.OUTPUT_BUILDER,
      },
    },
  });
