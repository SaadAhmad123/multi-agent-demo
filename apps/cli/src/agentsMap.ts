import {
  calculatorAgent,
  webInfoAgent,
  findDomainMcpAgent,
  astroDocsMcpAgent,
  fetchWebMcpAgent,
  operatorAgent,
} from '@repo/agentic-handlers';
import { cleanString } from 'arvo-core';

/**
 * Maps agent identifiers to their corresponding contract configurations.
 * Each agent in the map includes a versioned contract that defines its communication interface.
 *
 * @example
 * ```typescript
 * // Access a specific agent's contract
 * const issacContract = agentMap.issac.contract;
 * ```
 */
export const agentMap = {
  operator: {
    contract: operatorAgent.contract.version('1.0.0'),
  },
  aleej: {
    contract: calculatorAgent.contract.version('1.0.0'),
  },
  tom: {
    contract: webInfoAgent.contract.version('1.0.0'),
  },
  steve: {
    contract: findDomainMcpAgent.contract.version('1.0.0'),
  },
  emma: {
    contract: astroDocsMcpAgent.contract.version('1.0.0'),
  },
  issac: {
    contract: fetchWebMcpAgent.contract.version('1.0.0'),
  },
} as const;

/**
 * Represents a parsed message containing an optional agent reference and the cleaned message text.
 */
export type ParsedMessage = {
  agent:
    | {
        [K in keyof typeof agentMap]: {
          name: K;
          data: (typeof agentMap)[K];
        };
      }[keyof typeof agentMap]
    | null;
  cleanMessage: string;
  systemPrompt: string;
};

/**
 * Parses a message to extract agent mentions using the @name pattern.
 * Removes the agent mention from the message and returns both the identified agent and cleaned text.
 *
 * @example
 * ```typescript
 * const result = parseAgentFromMessage("@aleej calculate 2 + 2");
 * // result.agent.name === "aleej"
 * // result.cleanMessage === "calculate 2 + 2"
 * ```
 */
export const parseAgentFromMessage = (message: string): ParsedMessage => {
  const agentPattern = /@(\w+)/g;
  const matches = message.match(agentPattern);

  let foundAgent: ParsedMessage['agent'] = {
    name: 'operator',
    data: agentMap['operator' as const],
  };
  let cleanMessage = message;

  if (matches) {
    const match = matches[0];
    const extractedName = match.slice(1).toLowerCase().trim();

    if (extractedName in agentMap) {
      foundAgent = {
        name: extractedName,
        data: agentMap[extractedName as keyof typeof agentMap],
      } as unknown as ParsedMessage['agent'];
    }

    cleanMessage = cleanMessage.replace(match, '');
  }

  const isOperator = foundAgent?.name === 'operator';

  return {
    agent: foundAgent,
    cleanMessage: cleanMessage.trim(),
    systemPrompt: cleanString(`
      Additional system instructions you must adhere to especially when the query is outside your domain and available tools.
      You must only entertain your domain expertise.

      <multi_agent_system_context>
        <your_role>
          You are part of a multi-agent system where you can either handle queries
          directly or delegate them to specialized agents that are available to you as tools.
        </your_role>

        <agent_delegation_policy>
          When you determine that another agent is better suited to handle the user's query:

          **Primary Action: Use Available Tools**
          Check your available tools (which can be agents as well) that match the required expertise. 
          If an appropriate agent or tool is available, invoke it directly using the tool's function call.
          The agent will be identified by its internal identifier in your tool list.

          **Fallback Action: User Referral**
          If the required agent is not available as a tool in your current context, politely inform 
          the user and suggest they direct their question to that specific agent using the 
          @agentname mention format.

          Important: Always prefer using available agent tools when possible, as this provides\
          a seamless experience without requiring the user to restate their question.
        </agent_delegation_policy>

        ${
          isOperator
            ? `<operator_communication_guidelines>
          When you are the operator agent communicating with humans about execution plans or 
          requesting information via com_human_review tool, always refer to other agents by 
          their public names with @ prefix (e.g., "@aleej will handle the calculations", 
          "I will ask @tom to retrieve web content", "consulting with @emma about Astro framework"). 
          This helps users understand which specialized agents you're coordinating and allows 
          them to directly reach those agents in future queries if needed.
        </operator_communication_guidelines>`
            : ''
        }

        <available_agents_in_system>
          The following specialized agents exist in this multi-agent system. Some or all of these may be available to you as tools:

          ${Object.entries(agentMap)
            .map(
              ([_agentName, { contract }]) =>
                `${_agentName === foundAgent?.name ? '**YOU ARE THIS AGENT** - ' : ''}Public Name: @${_agentName}\nTool/Internal Identifier: ${contract.accepts.type.replaceAll('.', '_')}\nCapabilities: ${contract.description}\n`,
            )
            .join('\n')}
        </available_agents_in_system>

        <tool_usage_instructions>
          To delegate using tools: Check your available tools and invoke the agent using its internal identifier (the tool name will match the internal identifier format shown above).
          To refer users: If the agent tool is not available to you, use the format "Please ask @agentname about this" where agentname is the public name from the list above.
          When communicating with humans: Always mention the agents, in <available_agents_in_system>, by their public names with @ prefix (e.g., @issac, @tom, @emma) to maintain clarity and enable direct user access. For these never mention internal names only the public names
          Decision process: First check if you have the agent as an available tool, then decide whether to use the tool or refer the user.
          Self-awareness: If you see "YOU ARE THIS AGENT" marked next to an agent in the list above, that agent is you. You should handle queries directed to that agent directly rather than delegating or referring elsewhere.
        </tool_usage_instructions>
      </multi_agent_system_context>
    `),
  };
};
