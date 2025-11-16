import { MCPClient } from '../agentFactory/integrations/MCPClient.js';
import { cleanString } from 'arvo-core';
import { openaiLLMCaller } from '../agentFactory/integrations/openai.js';
import { createAgentContract } from '../agentFactory/createAgent/contract.js';
import { createAgent } from '../agentFactory/createAgent/resumable.js';
import { AgentRunner } from '../agentFactory/AgentRunner/index.js';
import type { EventHandlerFactory, IMachineMemory } from 'arvo-event-handler';
import { withDefaultContextBuilder } from '../agentFactory/createAgent/prompts.js';
import type { NonEmptyArray } from '../agentFactory/createAgent/types.js';

export const zapierGoogleDocsMcpAgentContract = createAgentContract({
  alias: 'troy',
  name: 'zapier.googledocs',
  uri: '#/agents/zapier.googledocs',
  description: cleanString(`
    Google Docs specialist. Creates, reads, updates, and searches documents in Google Drive.
  `),
});

export const zapierGoogleDocsMcpAgent: EventHandlerFactory<{
  memory: IMachineMemory<Record<string, unknown>>;
  humanInteractionDomain: NonEmptyArray<string>;
}> = ({ memory, humanInteractionDomain }) => {
  const mcpClient = new MCPClient(() => ({ url: process.env.ZAPIER_MCP_INTEGRATION_URL_GOOGLE_DOCS || 'no url' }));

  return createAgent({
    contract: zapierGoogleDocsMcpAgentContract,
    llm: openaiLLMCaller,
    mcp: mcpClient,
    contextBuilder: withDefaultContextBuilder(
      cleanString(`
        You are a Google Docs integration specialist via Zapier MCP.

        # Your Capabilities

        **Google Docs:** Create, read, update, search, and manage documents in Google Drive

        # Response Strategy

        **Execute Immediately** for straightforward requests within your capabilities.
        For multi-step document operations, execute sequentially and confirm each step.

        # Critical Guidelines

        **Document Operations:** Use specific search terms. Ensure proper formatting for
        created/updated content. Provide document links when available.

        **Error Handling:** If operations fail, explain clearly and suggest alternatives.

        **Scope Boundary:** You handle ONLY Google Docs operations.
        For calculations, email, weather, web research, or other capabilities, respond:
        "This requires capabilities beyond my specialization. Please ask @operator to
        coordinate the appropriate agents for this task."
      `),
    ),
    memory,
    services: {},
    humanReview: humanInteractionDomain
      ? {
          domains: humanInteractionDomain,
        }
      : undefined,
  });
};
