import { setupAgentCommunity } from './AgentCommunity/index.js';
import { anthropicLLMCaller } from './agentFactory/integrations/anthropic.js';
import { MCPClient } from './agentFactory/integrations/MCPClient.js';
import { openaiLLMCaller } from './agentFactory/integrations/openai.js';
import { calculatorContract } from './handlers/calculator.handler.js';

const community = setupAgentCommunity({
  name: 'epic',
  llmIntegrations: {
    openai: openaiLLMCaller,
    anthropic: anthropicLLMCaller,
  },
  services: {
    calculator: calculatorContract.version('1.0.0'),
  },
  mcpClients: {
    github: new MCPClient('https://api.githubcopilot.com/mcp/x/repos/readonly', () => ({
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_MCP_PAT_KEY}`,
      },
    })),
    astroDocs: new MCPClient('https://mcp.docs.astro.build/mcp'),
  },
}).createCommunity([
  {
    name: 'saad',
    llm: 'openai',
    peers: ['FULLY_SOCIAL'],
    allowHumanInteraction: true,
    restrictedTools: ['calculator'],
    restrictedPeers: ['saad'],
  },
  {
    name: 'ali',
    llm: 'anthropic',
  },
]);
