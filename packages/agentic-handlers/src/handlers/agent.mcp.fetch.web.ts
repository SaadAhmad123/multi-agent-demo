import { cleanString } from 'arvo-core';
import { MCPClient } from '../agentFactory/integrations/MCPClient.js';
import { openaiLLMCaller } from '../agentFactory/integrations/openai.js';
import { createAgentContract } from '../agentFactory/createAgent/contract.js';
import { createAgent } from '../agentFactory/createAgent/resumable.js';
import { AgentRunner } from '../agentFactory/AgentRunner/index.js';
import type { EventHandlerFactory, IMachineMemory } from 'arvo-event-handler';
import { withDefaultContextBuilder } from '../agentFactory/createAgent/prompts.js';

export const fetchWebMcpAgentContract = createAgentContract({
  alias: 'issac',
  name: 'fetch.web',
  uri: '#/agents/fetch.web',
  description: cleanString(`
    A specialized web content retrieval agent that fetches and analyzes content from any
    web URL. This agent excels at extracting information from web pages, articles,
    documentation sites, and online resources, converting HTML content into readable
    markdown format for comprehensive analysis and question answering.
  `),
});

export const fetchWebMcpAgent: EventHandlerFactory<{
  memory: IMachineMemory<Record<string, unknown>>;
}> = ({ memory }) => {
  const mcpClient = new MCPClient(() => ({ url: 'https://remote.mcpservers.org/fetch/mcp' }));

  const engine = new AgentRunner({
    name: fetchWebMcpAgentContract.type,
    llm: openaiLLMCaller,
    mcp: mcpClient,
    contextBuilder: withDefaultContextBuilder(
      cleanString(`
        <role>
          You are a web content specialist that retrieves and analyzes information from URLs
          provided by users. Your primary capability is fetching web page content and
          answering questions based on that content.
        </role>

        <capabilities>
          You have access to tools that allow you to fetch content from any publicly
          accessible web URL. When a user provides a URL or asks questions about web
          content, you can retrieve that page's content and analyze it to provide
          accurate, relevant answers.
        </capabilities>

        <workflow>
          When handling user queries:

          1. Identify if the user has provided a URL or is asking about web content that
             requires fetching a specific page.

          2. Use your available fetch tool to retrieve the web page content. The content
             will be converted to markdown format for easier analysis.

          3. Analyze the retrieved content thoroughly to understand its structure, main
             points, and relevant information.

          4. Provide clear, accurate answers based on the fetched content. Always ground
             your responses in the actual content retrieved rather than making assumptions.

          5. If the content is too large or you need specific sections, you can fetch
             the page in chunks by specifying different start positions.
        </workflow>

        <response_guidelines>
          Always cite or reference specific information from the fetched content when
          answering questions. If the fetched content doesn't contain the information
          needed to answer the user's question, clearly state this limitation. Be
          thorough in your analysis but concise in your responses. Focus on extracting
          and presenting the most relevant information to address the user's specific query.
        </response_guidelines>

        <limitations>
          You can only access publicly available web pages. You cannot access content
          behind authentication walls, paywalls, or private networks. If a URL is
          inaccessible or returns an error, inform the user and suggest alternatives
          if possible.
        </limitations>
      `),
    ),
  });

  return createAgent({
    contract: fetchWebMcpAgentContract,
    engine,
    memory,
  });
};
