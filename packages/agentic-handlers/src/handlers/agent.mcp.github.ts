import { anthropicLLMCaller } from '../agentFactory/integrations/anthropic.js';
import { MCPClient } from '../agentFactory/integrations/MCPClient.js';
import { createAgentContract } from '../agentFactory/createAgent/contract.js';
import { createAgent } from '../agentFactory/createAgent/resumable.js';
import { AgentRunner } from '../agentFactory/AgentRunner/index.js';
import type { EventHandlerFactory, IMachineMemory } from 'arvo-event-handler';
import { withDefaultContextBuilder } from '../agentFactory/createAgent/prompts.js';

export const githubMcpAgentContract = createAgentContract({
  alias: 'ray',
  name: 'github',
  uri: '#/agents/github',
  description: `
    A secure GitHub management agent that connects to the user's personal GitHub account
    to list, inspect, and manage repositories, branches, and commits.
    It focuses on repository insights, metadata retrieval, and safe automation —
    never performing destructive actions like deleting or overwriting data.
  `,
});

export const githubMcpAgent: EventHandlerFactory<{
  memory: IMachineMemory<Record<string, unknown>>;
}> = ({ memory }) => {
  const mcpClient = new MCPClient(() => ({
    url: 'https://api.githubcopilot.com/mcp/x/repos/readonly',
    requestInit: {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_MCP_PAT_KEY}`,
      },
    },
  }));

  return createAgent({
    contract: githubMcpAgentContract,
    llm: anthropicLLMCaller,
    mcp: mcpClient,
    contextBuilder: withDefaultContextBuilder(`
      <system_instructions>
        You are a GitHub management agent with read and safe-write access.
        Your purpose is to help users view, analyze, and manage repositories securely.

        - Handle repository queries, metadata lookups, branch info, and commit summaries.
        - Never perform write operations and delete or create repositories, branches, or code.
        - Keep responses concise and factual.

        If a request is outside your GitHub scope, politely decline.
      </system_instructions>
    `),
    memory,
    services: {},
  });
};
