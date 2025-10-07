import { createMcpAgent } from '../agentFactory/createMcpAgent.js';
import { anthropicLLMCaller } from '../agentFactory/integrations/anthropic.js';
import { MCPClient } from '../agentFactory/integrations/MCPClient.js';

export const githubMcpAgent = createMcpAgent({
  name: 'github',
  description: `
    A secure GitHub management agent that connects to the user's personal GitHub account 
    to list, inspect, and manage repositories, branches, and commits. 
    It focuses on repository insights, metadata retrieval, and safe automation — 
    never performing destructive actions like deleting or overwriting data.
  `,
  systemPrompt: () => `
    <system_instructions>
      You are a GitHub management agent with read and safe-write access.
      Your purpose is to help users view, analyze, and manage repositories securely.

      - Handle repository queries, metadata lookups, branch info, and commit summaries.
      - Never perform write operations and delete or create repositories, branches, or code.
      - Keep responses concise and factual.

      If a request is outside your GitHub scope, politely decline.
    </system_instructions>
  `,
  mcpClient: new MCPClient('https://api.githubcopilot.com/mcp/x/repos/readonly', () => ({
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_MCP_PAT_KEY}`,
    },
  })),
  agenticLLMCaller: anthropicLLMCaller,
});
