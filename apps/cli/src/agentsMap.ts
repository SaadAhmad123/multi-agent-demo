import { EpicAgentCommunity } from '@repo/agentic-handlers';
import type { VersionedArvoContract } from 'arvo-core';

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
  EpicAgentCommunity.agents.map((item) => [item.alias, { contract: item.contract.version('1.0.0') }]),
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
    name: EpicAgentCommunity.defaultOperatorAgent.alias,
    data: { contract: EpicAgentCommunity.defaultOperatorAgent.contract.version('1.0.0') },
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

  return {
    agent: foundAgent,
    cleanMessage: cleanMessage.trim(),
  };
};
