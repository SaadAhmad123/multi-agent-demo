import type { IMachineMemory } from 'arvo-event-handler';
import type {
  AnyVersionedContract,
  IToolUseApprovalMemory,
  LLMIntegrationParam,
  LLMIntergration,
  NonEmptyArray,
} from '../types.js';
import type { AgenticResumableContract } from './contract.js';
import type {} from 'arvo-core';

export type AgenticStateContext = {
  currentSubject: string;
  messages: LLMIntegrationParam['messages'];
  toolTypeCount: Record<string, number>;
  currentToolCallIteration: number;
  maxToolCallIterationAllowed: number;
};

export type HandlerFactoryDependencies = {
  memory: IMachineMemory<Record<string, unknown>>;
  toolUseApprovalMemory?: IToolUseApprovalMemory;
  extentions?: {
    systemPrompt?: string;
    services?: CreateAgenticResumableParams['services'];
    serviceDomains?: string[];
    servicesRequireApproval?: string[];
  };
};

export type AgenticSystemPromptBuilderParam = Pick<LLMIntegrationParam, 'messages' | 'toolDefinitions' | 'type'> & {
  maxToolInteractions: number | null;
  toolApproval: {
    // The names of the tools which require approval. These names are not agent compliant.
    toolNames: NonEmptyArray<string>;
    contract: AnyVersionedContract;
  } | null;
  humanInteraction: {
    contract: AnyVersionedContract;
  } | null;
};

export type AgenticSystemPromptBuilderType = (param: AgenticSystemPromptBuilderParam) => string;

/**
 * Configuration parameters for creating an agentic resumable orchestrator.
 *
 * Defines all components needed to create an AI agent that can maintain
 * conversations, make intelligent tool decisions, and execute complex workflows
 * through Arvo's event-driven architecture. Supports both simple chat and
 * structured data extraction scenarios.
 */
export type CreateAgenticResumableParams<TContract extends AgenticResumableContract = AgenticResumableContract> = {
  /**
   *  The Resumable Contract that is bound to the resumable handler
   */
  contract: TContract;

  /**
   * LLM service integration function.
   *
   * Handles the actual communication with the LLM provider (OpenAI, Anthropic, etc.)
   * and implements the conversation and tool request logic.
   */
  llm: LLMIntergration;

  /**
   * The memory for the resumable to cache its state
   */
  memory: IMachineMemory<Record<string, unknown>>;

  /**
   * Available Arvo service contracts for tool execution.
   *
   * Each contract defines a service the LLM can invoke, providing full
   * type safety and automatic schema validation for tool parameters and responses.
   */
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

  /**
   * Dynamic system prompt generation function.
   *
   * Receives conversation context and available tools to generate contextually
   * appropriate system prompts for different conversation phases (init vs tool_results).
   */
  systemPrompt?: AgenticSystemPromptBuilderType;

  /**
   * Maximum number of times the LLM is allowed to perform tool calls.
   * Default is 5 times
   */
  maxToolInteractions?: number;

  /**
   * Configuration for requiring DIRECT human user approval before the agent can use specific tools.
   * Tools marked with [[REQUIRE APPROVAL]] in their description will trigger an approval
   * request before execution.
   */
  enableToolApproval?: {
    /**
     * A memory cache to store
     */
    memory?: IToolUseApprovalMemory;
    /**
     * Target domain(s) where approval request events should be routed.
     * Cannot be the default domain as approval requires human review flow.
     */
    domains: NonEmptyArray<string>;
  };

  /**
   * Configuration for interacting DIRECTLY with human user for reviews and clarification when the agent needs guidance or clarification.
   */
  enableHumanInteraction?: {
    /**
     * Target domain(s) where review request events should be routed.
     * Cannot be the default domain as reviews require human interaction.
     */
    domains: NonEmptyArray<string>;
  };
};
