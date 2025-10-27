import type { AgentToolDefinition, OtelInfoType } from './types.js';

export interface IMCPConnection {
  connect: (parentSpan: OtelInfoType) => Promise<void>;

  // The tool names which require approval
  // This should be calculated from the constructor
  restrictedTools: string[];

  invokeTool: (
    param: { name: string; arguments?: Record<string, unknown> | null },
    parentSpan: OtelInfoType,
  ) => Promise<string>;

  disconnect: (parentSpan: OtelInfoType) => Promise<void>;

  getTools: (parentSpan: OtelInfoType) => Promise<AgentToolDefinition[]>;
}

export interface IToolApprovalCache {
  setBatched(source: string, approvals: Record<string, boolean>, parentSpan: OtelInfoType): Promise<void>;
  getBatched(
    source: string,
    tools: string[],
    parentSpan: OtelInfoType,
  ): Promise<Record<string, { value: boolean; comment?: string }>>;
}
