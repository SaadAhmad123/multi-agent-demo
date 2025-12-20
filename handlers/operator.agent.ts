import { createArvoOrchestratorContract } from 'arvo-core';
import type { EventHandlerFactory, IMachineMemory } from 'arvo-event-handler';
import {
  AgentDefaults,
  Anthropic,
  anthropicLLMIntegration,
  createArvoAgent,
} from '@arvo-tools/agentic';
import { cleanString } from 'arvo-core';
import type { AgentStreamListener } from '@arvo-tools/agentic';
import { simpleAgentContract } from './simple.agent.ts';
import { calculatorAgentContract } from './calculator.agent.ts';
import { essayBuilderWorkflowContract } from './essay.builder.workflow/contract.ts';

export const operatorAgentContract = createArvoOrchestratorContract({
  uri: '#/org/amas/agent/operator',
  name: 'agent.operator',
  description:
    'An agent which is aware of all the other agents and entities in the system can route the user request to the most suitable agent',
  versions: {
    '1.0.0': {
      init: AgentDefaults.INIT_SCHEMA,
      complete: AgentDefaults.COMPLETE_SCHEMA,
    },
  },
});

export const operatorAgent: EventHandlerFactory<
  {
    memory: IMachineMemory<Record<string, unknown>>;
    onStream?: AgentStreamListener;
  }
> = ({ memory, onStream }) =>
  createArvoAgent({
    contracts: {
      self: operatorAgentContract,
      // Other agents are treated at event handler services
      // very low integration barrier
      services: {
        simpleAgent: {
          contract: simpleAgentContract.version('1.0.0'),
        },
        calculatorAgent: {
          contract: calculatorAgentContract.version('1.0.0'),
        },
        essayBuilder: {
          contract: essayBuilderWorkflowContract.version('1.0.0')
        }
      },
    },
    onStream,
    memory,
    // It needs to interact with many different entities in the system. This might need many tool interactions
    maxToolInteractions: 100,
    llm: anthropicLLMIntegration(
      new Anthropic.Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') }),
    ),
    handler: {
      '1.0.0': {
        context: AgentDefaults.CONTEXT_BUILDER(() =>
          cleanString(`
            You a a helpful agent whose job is to respond to the user's
            request as accurately as possible. You must use the available tools
            and agent to you, when it makes sense, to get the most accurate answer.

            **Critical tool/agent use direction:** If you determine that a request needs 
            multiple tool/agent calls and they can be made in parallel then always do parallel 
            tool calls. You are banned from performing sequential tool calls when they can 
            be parallelized
          `)
        ),
        output: AgentDefaults.OUTPUT_BUILDER,
      },
    },
  });
