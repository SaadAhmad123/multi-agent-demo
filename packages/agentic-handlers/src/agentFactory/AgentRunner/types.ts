import type { z } from 'zod';
import type {
  AgentToolResultMessageContentSchema,
  AgentToolCallMessageContentSchema,
  AgentTextMessageContentSchema,
  AgentMessageContentSchema,
  AgentMessageRole,
  AgentMessageSchema,
  AgentToolDefinitionSchema,
  AgentRunnerLifecycle,
  AgentToolRequestSchema,
} from './schemas.js';
import type { Span } from '@opentelemetry/api';
import type { OpenTelemetryHeaders } from 'arvo-core';
import type { IMCPConnection, IToolApprovalCache } from './interfaces.js';

export type AgenticToolResultMessageContent = z.infer<typeof AgentToolResultMessageContentSchema>;
export type AgenticToolCallMessageContent = z.infer<typeof AgentToolCallMessageContentSchema>;
export type AgenticTextMessageContent = z.infer<typeof AgentTextMessageContentSchema>;
export type AgenticMessageContent = z.infer<typeof AgentMessageContentSchema>;
export type AgentMessageRoleType = (typeof AgentMessageRole)[keyof typeof AgentMessageRole];
export type AgentMessage = z.infer<typeof AgentMessageSchema>;
export type AgentToolDefinition = z.infer<typeof AgentToolDefinitionSchema>;
export type AgentRunnerLifecycleType = (typeof AgentRunnerLifecycle)[keyof typeof AgentRunnerLifecycle];
export type AgentToolRequest = z.infer<typeof AgentToolRequestSchema>;

export type OtelInfoType = {
  span: Span;
  headers: OpenTelemetryHeaders;
};

export type AgentRunnerExecuteParam = {
  lifecycle: AgentRunnerLifecycleType;
  messages: AgentMessage[];
  tools: AgentToolDefinition[];
  toolInteractions: {
    current: number;
  };
  selfInformation: {
    alias: string | null;
    source: string;
    description: string;
    agnetic_source: string;
  };
  delegatedBy: {
    alias: string | null;
    source: string;
  } | null;
  outputFormat: z.AnyZodObject | null;
  toolApproval: AgentToolDefinition | null;
  humanReview: AgentToolDefinition | null;
};

export type AgentRunnerExecuteOutput = {
  messages: AgentMessage[];
  toolInteractions: {
    current: number;
    max: number;
  };
} & (
  | {
      response: string | object;
      toolRequests: null;
    }
  | {
      response: null;
      toolRequests: AgentToolRequest[];
    }
);

export type AgentContextBuilderOutput = {
  systemPrompt: string | null;
  messages: AgentMessage[];
};

export type AgentConfiguredToolDefinition = AgentToolDefinition & {
  agentic_name: string;
};

export type AgentContextBuilderParam = Omit<
  AgentRunnerExecuteParam,
  'tools' | 'toolInteractions' | 'toolApproval' | 'humanReview' | 'selfInformation'
> & {
  tools: Array<AgentConfiguredToolDefinition>;
  toolInteractions: {
    current: number;
    max: number;
  };
  toolApproval: AgentConfiguredToolDefinition | null;
  humanReview: AgentConfiguredToolDefinition | null;
};

export type AgentContextBuilder = (
  param: AgentContextBuilderParam,
  parentSpan: OtelInfoType,
) => Promise<AgentContextBuilderOutput>;

export type AgentLLMIntegrationParam = {
  lifecycle: AgentRunnerExecuteParam['lifecycle'];
  systemPrompt: string | null;
  messages: AgentRunnerExecuteParam['messages'];
  tools: Omit<AgentToolDefinition, 'requires_approval'>[];
  outputFormat: NonNullable<AgentRunnerExecuteParam['outputFormat']> | null;
};

export type AgentLLMIntegrationOutput = {
  usage: {
    tokens: {
      prompt: number;
      completion: number;
    };
  } | null;
} & (
  | {
      response: string | object;
      toolRequests: null;
    }
  | {
      response: null;
      toolRequests: AgentToolRequest[];
    }
);

export type AgentLLMIntegration = (
  param: AgentLLMIntegrationParam,
  parentSpan: OtelInfoType,
) => Promise<AgentLLMIntegrationOutput>;

export type AgentRunnerParam = {
  name: string;
  llm: AgentLLMIntegration;
  maxToolInteractions?: number;
  contextBuilder: AgentContextBuilder;
  mcp?: IMCPConnection;
  approvalCache?: IToolApprovalCache;
};
