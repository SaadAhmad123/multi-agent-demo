import { MCPClient } from '../agentFactory/integrations/MCPClient.js';
import { openaiLLMCaller } from '../agentFactory/integrations/openai.js';
import { cleanString } from 'arvo-core';
import { createAgentContract } from '../agentFactory/createAgent/contract.js';
import { createAgent } from '../agentFactory/createAgent/resumable.js';
import { AgentRunner } from '../agentFactory/AgentRunner/index.js';
import type { EventHandlerFactory, IMachineMemory } from 'arvo-event-handler';
import type { NonEmptyArray } from '../agentFactory/createAgent/types.js';
import { withDefaultContextBuilder } from '../agentFactory/prompts.js';

export const astroDocsMcpAgentContract = createAgentContract({
  alias: 'emma',
  name: 'astro.docs',
  uri: '#/agents/astro.docs',
  description: cleanString(`
    An intelligent documentation assistant that provides accurate, up-to-date information
    from the official Astro documentation. This agent searches and retrieves relevant
    documentation content, code examples, configuration guidance, and best practices
    directly from the Astro knowledge base to answer questions about Astro's features,
    APIs, integrations, deployment strategies, and development workflows.
  `),
});

/**
 * Astro documentation agent that uses MCP to access official Astro docs.
 * Provides expert guidance on Astro features, APIs, and best practices.
 */
export const astroDocsMcpAgent: EventHandlerFactory<{
  memory: IMachineMemory<Record<string, unknown>>;
  humanInteractionDomain?: NonEmptyArray<string>;
}> = ({ memory, humanInteractionDomain }) => {
  const mcpClient = new MCPClient(() => ({
    url: 'https://mcp.docs.astro.build/mcp',
    restrictedTools: ['search_astro_docs'],
  }));

  const engine = new AgentRunner({
    name: astroDocsMcpAgentContract.type,
    llm: openaiLLMCaller,
    maxToolInteractions: 20,
    mcp: mcpClient,
    contextBuilder: withDefaultContextBuilder(
      cleanString(`
        You are an Astro documentation expert with direct access to the official documentation
        through the available MCP tools.
        
        # Workflow
        
        1. **Analyze** the user's question to understand what Astro documentation they need
        2. **Search** the documentation using the available MCP tools
        3. **Retrieve** relevant content, code examples, and explanations
        4. **Synthesize** a clear, comprehensive response
        5. **Refine** if initial searches are insufficient - try different queries
        
        # Guidelines
        
        - Base all responses on retrieved documentation content
        - Provide code examples when helpful
        - Structure responses with the most important information first
        - If information cannot be found after thorough searching, state this clearly rather than speculating
        - Use proper markdown formatting for code blocks and examples
        - Reference specific documentation sections when applicable
        - Always cite which documentation sections or pages your information comes from
        
        # Important Notes
        
        - MCP tools provide direct access to official Astro documentation
        - You can make multiple searches to gather comprehensive information
        - Combine information from multiple searches when needed for complete answers
        - If a search returns no results, try reformulating your query with different keywords
      `),
    ),
  });

  return createAgent({
    contract: astroDocsMcpAgentContract,
    engine,
    memory,
    humanReview: humanInteractionDomain
      ? {
          domains: humanInteractionDomain,
        }
      : undefined,
    toolApproval: humanInteractionDomain
      ? {
          domains: humanInteractionDomain,
        }
      : undefined,
  });
};
