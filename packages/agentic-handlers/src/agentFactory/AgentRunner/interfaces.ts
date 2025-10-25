import type { AgenticToolDefinition, OtelInfoType } from './types.js';

export interface IAgentMCPClient {
  connect: (parentSpan: OtelInfoType) => Promise<void>;

  invokeTool: (
    param: { name: string; arguments?: Record<string, unknown> | null },
    parentSpan: OtelInfoType,
  ) => Promise<string>;

  disconnect: (parentSpan: OtelInfoType) => Promise<void>;

  getToolDefinitions: (parentSpan: OtelInfoType) => Promise<AgenticToolDefinition[]>;
}

export interface IAgentToolApprovalRegister {
  setBatched(agent: string, approvals: Record<string, boolean>, parentSpan: OtelInfoType): Promise<void>;

  getBatched(
    agent: string,
    tools: string[],
    parentSpan: OtelInfoType,
  ): Promise<Record<string, { value: boolean; comment?: string }>>;
}
