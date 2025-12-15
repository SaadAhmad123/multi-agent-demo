import { createArvoOrchestratorContract } from 'arvo-core';
import type { EventHandlerFactory, IMachineMemory } from 'arvo-event-handler';
import {
  AgentDefaults,
  createAgentTool,
  createArvoAgent,
  OpenAI,
  openaiLLMIntegration,
} from '@arvo-tools/agentic';
import z from 'zod';
import { cleanString } from 'arvo-core';
import { MCPClient } from '@arvo-tools/agentic';
import type {
  AgentStreamListener,
  IPermissionManager,
} from '@arvo-tools/agentic';

const currentDateTool = createAgentTool({
  name: 'current_date_tool',
  description: 'Provided the curret data and time as an ISO string',
  input: z.object({}),
  output: z.object({
    response: z.string(),
  }),
  fn: () => ({
    response: new Date().toISOString(),
  }),
});

export const simpleAgentContract = createArvoOrchestratorContract({
  uri: '#/org/amas/agent/simple',
  name: 'agent.simple',
  description:
    'This is simple AI agent which can tell you about the current time accurately and has access to Astro documentation',
  versions: {
    '1.0.0': {
      init: AgentDefaults.INIT_SCHEMA,
      complete: AgentDefaults.COMPLETE_SCHEMA,
    },
  },
});

export const simpleAgent: EventHandlerFactory<
  {
    memory: IMachineMemory<Record<string, unknown>>;
    permissionManager?: IPermissionManager;
    onStream?: AgentStreamListener;
  }
> = ({ memory, permissionManager, onStream }) =>
  createArvoAgent({
    contracts: {
      self: simpleAgentContract,
      services: {},
    },
    tools: {
      currentDateTool,
    },
    memory,
    mcp: new MCPClient(() => ({
      url: 'https://mcp.docs.astro.build/mcp',
      requestInit: {
        headers: {},
      },
    })),
    maxToolInteractions: 10,
    onStream,
    llm: openaiLLMIntegration(
      new OpenAI.OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') }),
    ),
    permissionManager,
    handler: {
      '1.0.0': {
        // The tools object here provide the safe mechanism to
        // access the service name as well. Just like other tool.
        explicityPermissionRequired: (tools) => [
          tools.mcp.search_astro_docs.name,
        ],
        context: AgentDefaults.CONTEXT_BUILDER(({ tools }) =>
          cleanString(`
            You are a helpful agent. For queries about the current date, 
            use ${tools.tools.currentDateTool.name}.
            For information about Astro, use ${tools.mcp.search_astro_docs.name}.
          `)
        ),
        output: AgentDefaults.OUTPUT_BUILDER,
      },
    },
  });
