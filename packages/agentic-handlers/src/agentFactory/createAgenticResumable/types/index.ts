import type { Span } from '@opentelemetry/api';
import type { IMachineMemory } from 'arvo-event-handler';
import type { AgenticResumableContract } from '../create.contract.js';
import type {} from 'arvo-core';
import type { IMCPClient } from './mcp.interface.js';
import type { LLMIntegrationParam, LLMIntergration } from './llm.integration.js';
import type { AnyVersionedContract, NonEmptyArray } from '../../types.js';
import type { IToolUseApprovalMemory } from './tool.approval.mem.js';

/**
 * Runtime state maintained throughout an agent's execution lifecycle.
 * Tracks conversation flow, tool usage patterns, and iteration limits.
 */
export type AgenticStateContext = {
  /** Current event subject being processed */
  currentSubject: string;
  /** Complete conversation history including system, user, and assistant messages */
  messages: LLMIntegrationParam['messages'];
  /** Counter tracking how many times each tool type has been invoked */
  toolTypeCount: Record<string, number>;
  /** Current iteration number in the tool calling loop */
  currentToolCallIteration: number;
  /** Maximum iterations allowed before forcing termination */
  maxToolCallIterationAllowed: number;
};

/**
 * Parameters passed to system prompt builders for generating contextual instructions.
 */
export type AgenticSystemPromptBuilderParam = Pick<
  LLMIntegrationParam,
  'messages' | 'toolDefinitions' | 'type' | 'outputFormat'
> & {
  /** [Optional] Structured output format constraint */
  outputFormat: NonNullable<LLMIntegrationParam['outputFormat']> | null;
  /** Indicates the conversation phase and expected LLM behavior. */
  type: LLMIntegrationParam['type'];
  /** The tool definitions for the LLM */
  toolDefinitions: LLMIntegrationParam['toolDefinitions'];
  /** The messages being sent to the LLM */
  messages: LLMIntegrationParam['messages'];
  /** Human-readable name for the agent, used in user-facing interactions */
  alias: string | null;
  /** Unique system identifier for this handler */
  handlerSource: string;
  /** Brief explanation of the agent's capabilities and purpose */
  description: string | null;
  /** The current LLM-tool interaction cycle count */
  currentToolInteractionCount: number;
  /** Maximum number of tool call iterations allowed, null for unlimited */
  maxToolInteractions: number | null;
  /** Configuration for tools requiring explicit approval before execution */
  toolApproval: {
    /** Names of tools that need approval (in their original format, not agent-formatted) */
    toolNames: NonEmptyArray<string>;
    /** Contract defining the approval request/response structure */
    contract: AnyVersionedContract;
  } | null;
  /** Configuration for requesting human input during execution */
  humanInteraction: {
    /** Contract defining the human interaction request/response structure */
    contract: AnyVersionedContract;
  } | null;
  /** Optional OpenTelemetry span for distributed tracing */
  span?: Span;
};

/** Function signature for building dynamic system prompts based on agent context. */
export type AgenticSystemPromptBuilderType = (param: AgenticSystemPromptBuilderParam) => string;

/** Configuration parameters for creating an agentic resumable orchestrator. */
export type CreateAgenticResumableParams<TContract extends AgenticResumableContract = AgenticResumableContract> = {
  /** The Resumable Contract that is bound to the resumable handler */
  contract: TContract;
  /** * LLM service integration function. */
  llm: LLMIntergration;
  /** The memory for the resumable to cache its state */
  memory: IMachineMemory<Record<string, unknown>>;
  /** Available Arvo service contracts for tool execution. */
  services?: Record<
    string,
    | AnyVersionedContract
    | {
        contract: AnyVersionedContract;
        domains?: NonEmptyArray<string>;
        approval?:
          | boolean
          | {
              cache: boolean;
            };
      }
  >;
  /** Dynamic system prompt generation function. */
  systemPrompt?: AgenticSystemPromptBuilderType;
  /**
   * Maximum number of times the LLM is allowed to perform tool calls.
   * Default is 5 times
   */
  maxToolInteractions?: number;
  /** Configuration for requiring DIRECT human user approval before the agent can use specific tools. */
  enableToolApproval?: {
    /** A memory cache to store the approvals */
    memory?: IToolUseApprovalMemory;
    /**
     * Target domain(s) where approval request events should be routed.
     * Cannot be the default domain as approval requires human review flow.
     */
    domains: NonEmptyArray<string>;
  };
  /**
   * Configuration for interacting DIRECTLY with human user for reviews and clarification when the agent
   * needs guidance or clarification.
   */
  enableHumanInteraction?: {
    /**
     * Target domain(s) where review request events should be routed.
     * Cannot be the default domain as reviews require human interaction.
     */
    domains: NonEmptyArray<string>;
  };
  /** The MCP Client integration config */
  mcp?: {
    /** The MCP Client to connect to the server */
    client: IMCPClient;
    /** The list of tool names of the MCP server which need approval */
    approval?: NonEmptyArray<string>;
  };
};
