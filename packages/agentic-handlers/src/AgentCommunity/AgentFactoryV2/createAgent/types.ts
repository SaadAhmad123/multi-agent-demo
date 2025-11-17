import type {
  ArvoContract,
  ArvoOrchestratorContract,
  ArvoSemanticVersion,
  InferVersionedArvoContract,
  VersionedArvoContract,
} from 'arvo-core';
import type { IMCPConnection } from '../../../agentFactory/AgentRunner/interfaces.js';
import type { AgentLLMIntegration, AgentMessage } from '../../../agentFactory/AgentRunner/types.js';
import type z from 'zod';

export type AgentContext = {
  currentSubject: string;
  messages: AgentMessage[];
  toolInteractionCount: number;
  maxToolInteractionCount: number;
  toolTypeCount: Record<string, number>;
  delegatedBy: {
    alias: string | null;
    source: string;
  } | null;
};

export type AgentToolDefinition<TOriginalName extends string = string> = {
  name: {
    original: TOriginalName;
    agentCompliant: string;
  };
  description: string;
  inputSchema: Record<string, unknown>;
  toolServerKind: 'service' | 'mcp';
  requiresApproval?: boolean;
  priority?: number;
};

export type AgentToolResponse = {
  name: AgentToolDefinition<string>['name'];
  data: Record<string, unknown>;
  toolUseId: string;
};

type ServiceContractConfig<
  T extends VersionedArvoContract<ArvoContract, ArvoSemanticVersion> = VersionedArvoContract<
    ArvoContract,
    ArvoSemanticVersion
  >,
> = {
  contract: T;
  domain?: [string, ...string[]];
  requiresApproval?: boolean;
  priority?: number;
};

type AgentContextBuilderFunction<
  TSelfContract extends VersionedArvoContract<ArvoContract, ArvoSemanticVersion>,
  TServiceContract extends Record<string, ServiceContractConfig>,
  TState extends Record<string, unknown>,
> = (
  param: {
    tools: {
      services: {
        [T in keyof TServiceContract]: AgentToolDefinition<TServiceContract[T]['contract']['accepts']['type']>;
      };
      mcp: Record<string, AgentToolDefinition>;
    };
    outputFormat: z.AnyZodObject;
    state: TState | null;
  } & (
    | {
        lifecycle: 'init';
        input: InferVersionedArvoContract<TSelfContract>['accepts']['data'];
      }
    | {
        lifecycle: 'tool_response';
        toolResponses: AgentToolResponse[];
      }
    | {
        lifecycle: 'tool_call_feedback';
        toolCallFeedback: AgentToolResponse[] | null;
      }
    | {
        lifecycle: 'output_feedback';
        outputFeedback: AgentToolResponse[] | null;
      }
  ),
) => Promise<void>;

export type CreateAgentParam<
  TSelfContract extends ArvoOrchestratorContract,
  TServiceContract extends Record<string, ServiceContractConfig>,
> = {
  contracts: {
    self: TSelfContract;
    services?: TServiceContract;
  };
  mcp?: IMCPConnection;
  llm: AgentLLMIntegration;
  context: { [Version in keyof TSelfContract['versions']]: () => Promise<void> };
};
