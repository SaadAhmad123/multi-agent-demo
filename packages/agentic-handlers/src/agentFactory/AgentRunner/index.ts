import type { IAgentMCPClient, IAgentToolApprovalRegister } from './interfaces.js';
import type {
  AgentRunnerExecuteContext,
  AgentRunnerExecuteOutput,
  AgentRunnerExecuteParam,
  OtelInfoType,
} from './types.js';

type AgentRunnerParam = {
  llm: () => void;
  mcp?: IAgentMCPClient;
  approvalRegister?: IAgentToolApprovalRegister;
  contextBuilder?: (param: AgentRunnerExecuteParam, context: AgentRunnerExecuteContext) => Promise<string>;
};

export class AgentRunner {
  get llm() {
    return this.param.llm;
  }

  get mcp() {
    return this.param.mcp ?? null;
  }

  get approvalRegister() {
    return this.param.approvalRegister ?? null;
  }

  constructor(private readonly param: AgentRunnerParam) {}

  async execute(
    param: AgentRunnerExecuteParam,
    context: AgentRunnerExecuteContext,
    parentSpan: OtelInfoType,
  ): Promise<AgentRunnerExecuteOutput> {}
}
