import type { VersionedArvoContract } from 'arvo-core';
import type { IMachineMemory } from 'arvo-event-handler';
import type { IMCPConnection, IToolApprovalCache } from '../AgentRunner/interfaces.js';
import type { AgentRunnerEvent } from '../AgentRunner/stream.js';
import type { AgentContextBuilder, AgentLLMIntegration } from '../AgentRunner/types.js';
import type { AnyAgentContract } from './contract.js';

export type NonEmptyArray<T> = [T, ...T[]];

/**
 * Generic type alias for any versioned Arvo contract.
 * Used as a constraint for service contract type parameters.
 */
// biome-ignore lint/suspicious/noExplicitAny: Needs to be general
export type AnyVersionedContract = VersionedArvoContract<any, any>;

export type CreateAgentParam<TContract extends AnyAgentContract> = {
  contract: TContract;
  llm: AgentLLMIntegration;
  maxToolInteractions?: number;
  contextBuilder?: AgentContextBuilder;
  memory: IMachineMemory<Record<string, unknown>>;
  mcp?: IMCPConnection;
  approvalCache?: IToolApprovalCache;
  streamListener?: (param: AgentRunnerEvent & { subject: string }) => Promise<void>;
  services?: Record<
    string,
    | AnyVersionedContract
    | {
        contract: AnyVersionedContract;
        domains?: NonEmptyArray<string>;
        approval?: boolean;
      }
  >;
  toolApproval?: {
    domains: NonEmptyArray<string>;
  };
  humanReview?: {
    domains: NonEmptyArray<string>;
  };
};
