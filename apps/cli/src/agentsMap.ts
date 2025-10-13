import {
  calculatorAgent,
  webInfoAgent,
  findDomainMcpAgent,
  astroDocsMcpAgent,
  fetchWebMcpAgent,
  operatorAgent,
  githubMcpAgent,
  zapierMcpAgent,
} from '@repo/agentic-handlers';
import { cleanString, type VersionedArvoContract } from 'arvo-core';

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
export const agentMap = Object.fromEntries(
  [
    calculatorAgent,
    webInfoAgent,
    findDomainMcpAgent,
    astroDocsMcpAgent,
    fetchWebMcpAgent,
    operatorAgent,
    githubMcpAgent,
    zapierMcpAgent,
  ].map((item) => [item.alias, { contract: item.contract.version('1.0.0') }]),
  // biome-ignore lint/suspicious/noExplicitAny: Needs to general
) as Record<string, { contract: VersionedArvoContract<any, any> }>;

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
    data: agentMap.operator ?? { contract: operatorAgent.contract.version('1.0.0') },
  };
  const cleanMessage = message;

  if (matches) {
    const match = matches[0];
    const extractedName = match.slice(1).toLowerCase().trim();

    if (extractedName in agentMap) {
      foundAgent = {
        name: extractedName,
        data: agentMap[extractedName as keyof typeof agentMap],
      } as unknown as ParsedMessage['agent'];
    }
  }

  const isOperator = foundAgent?.name === 'operator';

  // Build agent roster dynamically
  const agentRoster = Object.entries(agentMap)
    .filter(([name]) => name !== foundAgent?.name)
    .map(([name, { contract }]) => `@${name} (${contract.accepts.type.replaceAll('.', '_')}): ${contract.description}`)
    .join('\n');

  return {
    agent: foundAgent,
    cleanMessage: cleanMessage.trim(),
    systemPrompt: cleanString(`
      # Multi-Agent System Context
      
      You are part of a multi-agent system. When queries are outside your expertise, 
      delegate to specialized agents available as tools or direct users to mention them.
      
      ## Delegation Strategy
      
      1. **Check your tools first** - If you have an agent tool matching the need, call it directly
      2. **Refer if unavailable** - If not in your tools, tell the user: "Please ask @agentname about this"
      ${isOperator ? '3. **Use public names** - Always refer to agents by their @name when communicating with humans' : ''}
      
      ## Available Agents
      
      ${agentRoster}
      
      ${
        isOperator
          ? 'As @operator, mention agents by their public @names when explaining your coordination (e.g., "@aleej will calculate this", "consulting @emma").'
          : 'Check if these agents are in your available tools. Use the tool identifier (in parentheses) to call them, or refer users to the @name if unavailable.'
      }
    `),
  };
};
