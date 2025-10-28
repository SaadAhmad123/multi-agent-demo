import { MCPClient } from '../agentFactory/integrations/MCPClient.js';
import { cleanString } from 'arvo-core';
import { openaiLLMCaller } from '../agentFactory/integrations/openai.js';
import { createAgentContract } from '../agentFactory/createAgent/contract.js';
import { createAgent } from '../agentFactory/createAgent/resumable.js';
import { AgentRunner } from '../agentFactory/AgentRunner/index.js';
import type { EventHandlerFactory, IMachineMemory } from 'arvo-event-handler';
import { withDefaultContextBuilder } from '../agentFactory/prompts.js';

export const findDomainMcpAgentContract = createAgentContract({
  alias: 'steve',
  name: 'findadomain',
  uri: '#/agents/findadomain',
  description: cleanString(`
    A domain discovery and analysis agent that helps find available domain names,
    check domain availability, retrieve domain registration information, and analyze
    domain characteristics. This agent can search for domains based on keywords,
    verify registration status, provide pricing information, and suggest alternative
    domain options when preferred choices are unavailable.
  `),
});

/**
 * Domain information agent that interfaces with the Find A Domain
 * remote MCP server to retrieve domain-related data.
 *
 * This implementation demonstrates the agent's capability to return
 * responses in any structured format specified in its configuration,
 * providing flexibility in output schema definition.
 */
export const findDomainMcpAgent: EventHandlerFactory<{
  memory: IMachineMemory<Record<string, unknown>>;
}> = ({ memory }) => {
  const mcpClient = new MCPClient(() => ({ url: 'https://api.findadomain.dev/mcp' }));

  const engine = new AgentRunner({
    name: findDomainMcpAgentContract.type,
    llm: openaiLLMCaller,
    maxToolInteractions: 2,
    mcp: mcpClient,
    contextBuilder: withDefaultContextBuilder(
      cleanString(`
        <system_instructions>
          <role>
            You are a domain discovery specialist with access to domain registration and availability
            data through available tools.
          </role>

          <workflow>
            Understand the user's domain requirements, use available tools to search for available
            domains or retrieve domain information, and present results with relevant details
            such as availability status, pricing, and alternatives when applicable.
          </workflow>

          <guidelines>
            Provide clear domain availability information based on tool results. Suggest creative
            alternatives when requested domains are unavailable. Include relevant details
            like pricing and registration information when available. Help users make informed
            decisions by explaining domain characteristics and trade-offs.
          </guidelines>
        </system_instructions>
      `),
    ),
  });

  return createAgent({
    contract: findDomainMcpAgentContract,
    engine,
    memory,
    services: {},
  });
};
