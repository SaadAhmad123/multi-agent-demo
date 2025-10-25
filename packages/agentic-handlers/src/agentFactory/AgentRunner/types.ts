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

export type AgenticToolResultMessageContent = z.infer<typeof AgentToolResultMessageContentSchema>;
export type AgenticToolCallMessageContent = z.infer<typeof AgentToolCallMessageContentSchema>;
export type AgenticTextMessageContent = z.infer<typeof AgentTextMessageContentSchema>;
export type AgenticMessageContent = z.infer<typeof AgentMessageContentSchema>;
export type AgentMessageRoleType = (typeof AgentMessageRole)[keyof typeof AgentMessageRole];
export type AgentMessage = z.infer<typeof AgentMessageSchema>;
export type AgenticToolDefinition = z.infer<typeof AgentToolDefinitionSchema>;
export type AgentRunnerLifecycleType = (typeof AgentRunnerLifecycle)[keyof typeof AgentRunnerLifecycle];
export type AgentToolRequest = z.infer<typeof AgentToolRequestSchema>;

export type OtelInfoType = {
  span: Span;
  headers: OpenTelemetryHeaders;
};

export type AgentRunnerExecuteParam = {
  lifecycle: AgentRunnerLifecycleType;
  messages: AgentMessage[];
  externalTools: AgenticToolDefinition[];
};

export type AgentRunnerExecuteContext = {
  toolInteraction: {
    current: number;
    max: number;
  };
  agentIdentity: {
    alias: string | null;
    source: string;
    description: string;
    delegatedBy: {
      alias: string | null;
      source: string;
    } | null;
  };
  outputFormat: z.AnyZodObject | null;
};

export type AgentRunnerExecuteOutput = {
  messages: AgentMessage[];
} & (
  | {
      response: string;
      toolRequests: null;
    }
  | {
      response: null;
      toolRequests: AgentToolRequest[];
    }
);
