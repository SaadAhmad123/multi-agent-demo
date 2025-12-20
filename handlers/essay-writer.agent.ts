import { createArvoOrchestratorContract } from 'arvo-core';
import type { EventHandlerFactory } from 'arvo-event-handler';
import {
  AgentDefaults,
  AgentStreamListener,
  createArvoAgent,
  OpenAI,
  openaiLLMIntegration,
} from '@arvo-tools/agentic';
import { cleanString } from 'arvo-core';

export const essayWriterAgentContract = createArvoOrchestratorContract({
  uri: '#/org/amas/agent/essay-writer',
  name: 'agent.essay.writer',
  description:
    'Writes a complete essay with one paragraph per heading from the given outline',
  versions: {
    '1.0.0': {
      init: AgentDefaults.INIT_SCHEMA,
      complete: AgentDefaults.COMPLETE_SCHEMA,
    },
  },
});

export const essayWriterAgent: EventHandlerFactory<
  { onStream?: AgentStreamListener }
> = ({ onStream }) =>
  createArvoAgent({
    contracts: {
      self: essayWriterAgentContract,
      services: {},
    },
    onStream,
    llm: openaiLLMIntegration(
      new OpenAI.OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') }),
    ),
    handler: {
      '1.0.0': {
        context: AgentDefaults.CONTEXT_BUILDER(() =>
          cleanString(`
          Write a complete essay on the given topic. 
          Follow exaclty the provided outline and write exactly one paragraph 
          under each heading. Each paragraph should be 4-6 sentences. 
          Format with headings in bold.
        `)
        ),
        output: AgentDefaults.OUTPUT_BUILDER,
      },
    },
  });
