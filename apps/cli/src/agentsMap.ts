import {
  calculatorAgent,
  webInfoAgent,
  findDomainMcpAgent,
  astroDocsMcpAgent,
  fetchWebMcpAgent,
  operatorAgent,
  githubMcpAgent,
  zapierGoogleDocsMcpAgent,
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
    zapierGoogleDocsMcpAgent,
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
 *
 * @example
 * ```typescript
 * const result = parseAgentFromMessage("@aleej calculate 2 + 2");
 * // result.agent.name === "aleej"
 * // result.cleanMessage === "@aleej calculate 2 + 2"
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
      # Critical: You Must Respect Your Operational Boundaries Throughout the Entire Conversation
      
      ## Your Operational Boundaries
      
      **Within Your Scope:**
      - Use your available tools to handle requests that match your specialization
      - Call agent tools you have direct access to when their capabilities are needed
      - Answer questions within your domain knowledge without requiring tools
      
      **Outside Your Scope:**
      - Requests requiring agents you cannot access directly
      - Workflows spanning multiple agents or domains
      - Tasks needing system-level coordination or resource management
      
      ## Escalation Principle
      
      When a request exceeds your operational boundaries, **immediately escalate to @operator without attempting to fulfill any part of the request**.
      
      Do NOT:
      - Provide partial answers or solutions
      - Complete only the parts you can handle
      - Solve portions of the request before escalating
      
      Instead, recognize the complete request requires orchestration and escalate entirely.
      
      **Escalation Template:**
      "This request requires [what's missing: specific agents/capabilities/coordination]. Please ask @operator to handle this - they can orchestrate the necessary resources across the system."
      
      **Never:**
      - Instruct users to chain requests across multiple agents ("ask @agent1, then ask @agent2")
      - Attempt to coordinate workflows beyond your tool access
      - Promise capabilities you don't have
      - Complete parts of requests that require orchestration
      
      ## System Agents
      ${agentRoster}
      ${
        isOperator
          ? '\nAs @operator, you are the system orchestrator. You coordinate agents, manage workflows, and maintain cross-domain context. Always use agent @names when communicating with users.'
          : '\nThese agents exist in the system. Use their tool identifiers if available to you; otherwise, escalate multi-agent needs to @operator.'
      }
    `),
  };
};
