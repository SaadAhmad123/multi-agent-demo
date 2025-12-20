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

export const essayOutlineAgentContract = createArvoOrchestratorContract({
  uri: '#/org/amas/agent/essay-outline',
  name: 'agent.essay.outline',
  description: 'Generates 5 main essay headings for any given topic',
  versions: {
    '1.0.0': {
      init: AgentDefaults.INIT_SCHEMA,
      complete: AgentDefaults.COMPLETE_SCHEMA,
    },
  },
});

export const essayOutlineAgent: EventHandlerFactory<
  { onStream?: AgentStreamListener }
> = ({ onStream }) =>
  createArvoAgent({
    contracts: {
      self: essayOutlineAgentContract,
      services: {},
    },
    onStream,
    llm: openaiLLMIntegration(
      new OpenAI.OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') }),
      {
        invocationParam: {
          model: 'gpt-4o-mini',
          temperature: 1,
          max_completion_tokens: 1024,
        },
      },
    ),
    handler: {
      '1.0.0': {
        context: AgentDefaults.CONTEXT_BUILDER(() =>
          cleanString(`
          Generate exactly 5 essay headings for the given topic. First heading 
          is Introduction. Last heading is Conclusion. Middle 3 headings are main 
          topics. Use Roman numerals (I-V). No subsections. Just 5 headings only.  
        `)
        ),
        output: AgentDefaults.OUTPUT_BUILDER,
      },
    },
  });
