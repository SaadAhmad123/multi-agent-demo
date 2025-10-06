import { createMcpAgent } from '../agentFactory/createMcpAgent.js';
import { MCPClient } from '../agentFactory/integrations/MCPClient.js';
import { openaiLLMCaller } from '../agentFactory/integrations/openai.js';
import { cleanString } from 'arvo-core';

export const astroDocsMcpAgent = createMcpAgent({
  name: 'astro.docs',
  description: cleanString(`
    An intelligent documentation assistant that provides accurate, up-to-date information 
    from the official Astro documentation. This agent searches and retrieves relevant 
    documentation content, code examples, configuration guidance, and best practices 
    directly from the Astro knowledge base to answer questions about Astro's features, 
    APIs, integrations, deployment strategies, and development workflows.
  `),
  mcpClient: new MCPClient('https://mcp.docs.astro.build/mcp'),
  agenticLLMCaller: openaiLLMCaller,
  systemPrompt: () =>
    cleanString(`
    <system_instructions>
      <role>
        You are an Astro documentation expert with direct access to the official documentation
        through the available tools.
      </role>

      <workflow>
        Analyze the user's question, search the documentation using available tools, and synthesize 
        a clear response with relevant examples and explanations. If initial searches are insufficient
        , refine your queries and search again.
      </workflow>

      <guidelines>
        Base all responses on retrieved documentation content. Provide code examples when helpful. 
        If information cannot be found, state this clearly rather than speculating. Structure 
        responses with the most important information first.
      </guidelines>
    </system_instructions>
  `),
});
