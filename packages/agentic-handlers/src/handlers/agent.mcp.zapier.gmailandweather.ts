import { cleanString } from 'arvo-core';
import { MCPClient } from '../agentFactory/integrations/MCPClient.js';
import { openaiLLMCaller } from '../agentFactory/integrations/openai.js';
import { createAgentContract } from '../agentFactory/createAgent/contract.js';
import { createAgent } from '../agentFactory/createAgent/resumable.js';
import { AgentRunner } from '../agentFactory/AgentRunner/index.js';
import type { EventHandlerFactory, IMachineMemory } from 'arvo-event-handler';
import { withDefaultContextBuilder } from '../agentFactory/createAgent/prompts.js';

export const zapierGmailAndWeatherMcpAgentContract = createAgentContract({
  name: 'zapier.gmailandweather',
  uri: '#/agents/zapier.gmailandweather',
  description: cleanString(`
    Gmail and Weather specialist. Searches emails, creates drafts (with links),
    and retrieves current weather conditions for any location.
  `),
});

export const zapierGmailAndWeatherMcpAgent: EventHandlerFactory<{
  memory: IMachineMemory<Record<string, unknown>>;
}> = ({ memory }) => {
  const mcpClient = new MCPClient(() => ({ url: process.env.ZAPIER_MCP_INTEGRATION_URL_GMAIL_WEATHER || 'no url' }));

  const engine = new AgentRunner({
    name: zapierGmailAndWeatherMcpAgentContract.type,
    llm: openaiLLMCaller,
    mcp: mcpClient,
    contextBuilder: withDefaultContextBuilder(
      cleanString(`
        You are a Gmail and Weather integration specialist connecting to external services via Zapier MCP.

        # Your Capabilities

        **Gmail:** Search emails and create drafts (you cannot send emails, only create drafts)
        **Weather:** Retrieve current weather conditions for specified locations

        # Response Strategy

        **Execute Immediately** for all requests within your capabilities:
        - Email searches with user-specified criteria
        - Draft creation with provided content
        - Current weather lookups for any location

        # Critical Guidelines

        **Draft Creation:** When you create an email draft, ALWAYS provide the direct Gmail link so the user
        can view and send the draft themselves. Format: "Draft created: [link to draft]"

        **Privacy:** Treat all email content as confidential. Summarize search results without exposing
        unnecessary personal details.

        **Error Handling:** If MCP tool calls fail, explain what went wrong clearly and suggest alternatives
        or corrections.

        **Scope Boundary:** You handle ONLY Gmail searches, draft creation, and weather lookups.
        If asked for calculations, document creation, web research, sending emails, or other capabilities
        beyond your domain, immediately respond: "This requires capabilities beyond my Gmail and Weather
        specialization. Please ask @operator to coordinate the appropriate agents for this task."
      `),
    ),
  });

  return createAgent({
    contract: zapierGmailAndWeatherMcpAgentContract,
    engine,
    memory,
    services: {},
  });
};
