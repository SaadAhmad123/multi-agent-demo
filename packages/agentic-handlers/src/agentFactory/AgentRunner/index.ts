import {
  SemanticConventions as OpenInferenceSemanticConventions,
  OpenInferenceSpanKind,
} from '@arizeai/openinference-semantic-conventions';
import type { Span } from '@opentelemetry/api';
import { ArvoOpenTelemetry, getOtelHeaderFromSpan } from 'arvo-core';
import {
  openInferenceSpanInitAttributesSetter,
  openInferenceSpanOutputAttributesSetter,
} from './otel.openinference.js';
import { streamEmitter } from './stream.js';
import type {
  AgentConfiguredToolDefinition,
  AgentLLMIntegrationOutput,
  AgentLLMIntegrationParam,
  AgentMessage,
  AgentRunnerExecuteOutput,
  AgentRunnerExecuteParam,
  AgentRunnerParam,
  AgentToolDefinition,
  AgentToolRequest,
  AgenticToolResultMessageContent,
  OtelInfoType,
} from './types.js';

const TOOL_SERVER_PREFIXES = {
  external: 'ext_',
  mcp: 'mcp_',
} as const;

type ToolServer = keyof typeof TOOL_SERVER_PREFIXES;

type RegisteredTool = AgentConfiguredToolDefinition & {
  tool_server: ToolServer;
};

/**
 * Orchestrates agent execution including LLM calls, tool management, and MCP integration.
 * Handles tool prioritization, approval caching, and iterative execution loops.
 */
export class AgentRunner {
  readonly name: AgentRunnerParam['name'];
  readonly llm: NonNullable<AgentRunnerParam['llm']>;
  readonly contextBuilder: NonNullable<AgentRunnerParam['contextBuilder']>;
  readonly mcp: NonNullable<AgentRunnerParam['mcp']> | null;
  readonly approvalCache: NonNullable<AgentRunnerParam['approvalCache']> | null;
  readonly maxToolInteractions: number;

  private toolRegistry: Record<string, RegisteredTool> = {};

  constructor(param: AgentRunnerParam) {
    this.name = param.name;
    this.llm = param.llm;
    this.contextBuilder = param.contextBuilder;
    this.mcp = param.mcp ?? null;
    this.approvalCache = param.approvalCache ?? null;
    this.maxToolInteractions =
      param.maxToolInteractions !== null && param.maxToolInteractions !== undefined
        ? Math.max(param.maxToolInteractions, 1)
        : 5;
  }

  /**
   * Initializes a new agent conversation with a user message.
   * Convenience method that wraps execute() with a single text message.
   */
  async init(
    param: Omit<AgentRunnerExecuteParam, 'messages' | 'lifecycle' | 'toolInteractions'> & { message: string },
    parentSpan: OtelInfoType,
  ) {
    return await this.execute(
      {
        ...param,
        lifecycle: 'init',
        toolInteractions: { current: 0 },
        messages: [{ role: 'user', content: [{ type: 'text', content: param.message }] }],
      },
      parentSpan,
      'AgentRunner.init',
    );
  }

  /**
   * Resumes agent execution after external tool results are provided.
   * Integrates tool results as user messages and continues the execution loop.
   */
  async resume(
    param: Omit<AgentRunnerExecuteParam, 'lifecycle'> & { toolResults: Array<{ id: string; data: string }> },
    parentSpan: OtelInfoType,
  ) {
    let _messages = [...param.messages];
    _messages = this.addToolResults(
      _messages,
      param.toolResults.map((item) => ({
        type: 'tool_result',
        tool_use_id: item.id,
        content: item.data,
      })),
    );
    return this.execute(
      {
        ...param,
        lifecycle: 'tool_results',
        messages: _messages,
      },
      parentSpan,
      'AgentRunner.resume',
    );
  }

  /**
   * Main execution method that runs the agent loop until completion or max iterations.
   * Returns either a final response or external tool requests requiring user action.
   */
  async execute(
    param: AgentRunnerExecuteParam,
    parentSpan: OtelInfoType,
    spanName?: string,
  ): Promise<AgentRunnerExecuteOutput> {
    return await ArvoOpenTelemetry.getInstance().startActiveSpan({
      name: spanName || `AgentRunner<${this.name}>.execute`,
      disableSpanManagement: true,
      context: {
        inheritFrom: 'TRACE_HEADERS',
        traceHeaders: parentSpan.headers,
      },
      fn: async (span) => {
        span.setAttribute(OpenInferenceSemanticConventions.OPENINFERENCE_SPAN_KIND, OpenInferenceSpanKind.AGENT);
        const otelInfo = this.createOtelInfo(span);

        streamEmitter(
          {
            type: 'execution.started',
            data: {
              lifecycle: param.lifecycle,
              messageCount: param.messages.length,
              toolCount: param.tools.length,
              selfInformation: param.selfInformation,
              delegatedBy: param.delegatedBy,
            },
          },
          param.stream,
        );

        try {
          await this.initializeExecution(param, otelInfo);
          const result = await this.runExecutionLoop(param, otelInfo);

          streamEmitter(
            {
              type: 'execution.completed',
              data: {
                response: result.response?.toString() || null,
                hasPendingTools: result.toolRequests !== null,
                toolInteractionCount: result.toolInteractions.current,
                selfInformation: param.selfInformation,
                delegatedBy: param.delegatedBy,
              },
            },
            param.stream,
          );

          return result;
        } catch (error) {
          streamEmitter(
            {
              type: 'execution.failed',
              data: {
                error: (error as Error).message,
                iteration: param.toolInteractions.current,
                toolInteractionCount: param.toolInteractions.current,
                selfInformation: param.selfInformation,
                delegatedBy: param.delegatedBy,
              },
            },
            param.stream,
          );
          throw error;
        } finally {
          await this.cleanup(otelInfo, span);
        }
      },
    });
  }

  private async initializeExecution(param: AgentRunnerExecuteParam, otelInfo: OtelInfoType): Promise<void> {
    this.toolRegistry = {};
    await this.mcp?.connect(otelInfo);

    const mcpTools = (await this.mcp?.getTools(otelInfo)) ?? [];
    const externalTools = [...param.tools];
    if (param.toolApproval) {
      externalTools.push(param.toolApproval);
    }
    if (param.humanReview) {
      externalTools.push(param.humanReview);
    }
    this.registerTools(externalTools, 'external');
    this.registerTools(mcpTools, 'mcp');
  }

  private async runExecutionLoop(
    param: AgentRunnerExecuteParam,
    otelInfo: OtelInfoType,
  ): Promise<AgentRunnerExecuteOutput> {
    const agentTools = await this.resolveToolApprovals(Boolean(param.toolApproval), otelInfo);
    let messages = param.messages;
    let toolInteractionCount = param.toolInteractions.current;
    const maxIterations = this.maxToolInteractions + 2;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (toolInteractionCount >= this.maxToolInteractions) {
        streamEmitter(
          {
            type: 'tool.budget.exhausted',
            data: {
              toolInteractionCount,
              maxToolInteractions: this.maxToolInteractions,
              selfInformation: param.selfInformation,
              delegatedBy: param.delegatedBy,
            },
          },
          param.stream,
        );
      }

      const context = await this.buildContext(param, messages, agentTools, toolInteractionCount, otelInfo);
      const llmResponse = await this.callLLM(context, param, agentTools, otelInfo);

      if (llmResponse.response !== null) {
        messages = this.integrateLLMResponse(messages, llmResponse.response);
        return this.createSuccessResponse(messages, llmResponse.response, toolInteractionCount);
      }

      toolInteractionCount++;
      const processedResponse = await this.processToolRequests(
        messages,
        // Only consider the highest prioritized tool calls
        // The idea is that there are a very few high priority
        // tool calls which need to be addressed before making any
        // other tool call
        this.prioritizeToolRequests(llmResponse.toolRequests),
        param,
        otelInfo,
      );
      messages = processedResponse.messages;

      if (processedResponse.externalToolRequests.length > 0) {
        return this.createToolRequestResponse(messages, processedResponse.externalToolRequests, toolInteractionCount);
      }
    }

    throw new Error(`Reached maximum tool call hard limit of ${maxIterations}`);
  }

  private prioritizeToolRequests(toolRequests: AgentToolRequest[]): AgentToolRequest[] {
    const unprioritized: AgentToolRequest[] = [];
    const prioritized: Record<string, AgentToolRequest[]> = {};
    for (const item of toolRequests) {
      const priority = this.toolRegistry[item.type]?.priority ?? 0;
      if (priority > 0) {
        const strPriority = priority.toString();
        prioritized[strPriority] = [...(prioritized[strPriority] ?? []), item];
      } else {
        unprioritized.push(item);
      }
    }
    const highestPriority =
      Object.keys(prioritized)
        .map(Number.parseInt)
        .sort((a, b) => b - a)[0] ?? 0;
    if (highestPriority > 0) {
      // biome-ignore lint/style/noNonNullAssertion: This is not null
      return prioritized[highestPriority.toString()]!;
    }
    return unprioritized;
  }

  private async buildContext(
    param: AgentRunnerExecuteParam,
    messages: AgentMessage[],
    tools: RegisteredTool[],
    toolInteractionCount: number,
    otelInfo: OtelInfoType,
  ) {
    streamEmitter(
      {
        type: 'context.build.started',
        data: {
          selfInformation: param.selfInformation,
          delegatedBy: param.delegatedBy,
        },
      },
      param.stream,
    );
    const result = await this.contextBuilder(
      {
        ...param,
        messages,
        tools: tools,
        toolInteractions: {
          current: toolInteractionCount,
          max: this.maxToolInteractions,
        },
        humanReview: param.humanReview
          ? {
              ...param.humanReview,
              agentic_name: this.createToolAgenticName(param.humanReview, 'external'),
            }
          : null,
        toolApproval: param.toolApproval
          ? { ...param.toolApproval, agentic_name: this.createToolAgenticName(param.toolApproval, 'external') }
          : null,
      },
      otelInfo,
    );
    streamEmitter(
      {
        type: 'context.build.success',
        data: {
          selfInformation: param.selfInformation,
          delegatedBy: param.delegatedBy,
        },
      },
      param.stream,
    );
    return result;
  }

  private async callLLM(
    context: { messages: AgentMessage[]; systemPrompt: string | null },
    param: AgentRunnerExecuteParam,
    agentTools: RegisteredTool[], // Add this parameter
    otelInfo: OtelInfoType,
  ): Promise<AgentLLMIntegrationOutput> {
    return await ArvoOpenTelemetry.getInstance().startActiveSpan({
      name: 'Agentic LLM Call',
      disableSpanManagement: true,
      context: {
        inheritFrom: 'TRACE_HEADERS',
        traceHeaders: otelInfo.headers,
      },
      fn: async (span) => {
        try {
          streamEmitter(
            {
              type: 'llm.call.started',
              data: {
                messageCount: context.messages.length,
                toolCount: agentTools.length,
                systemPromptLength: context.systemPrompt?.length ?? 0,
                selfInformation: param.selfInformation,
                delegatedBy: param.delegatedBy,
              },
            },
            param.stream,
          );

          const llmParam: AgentLLMIntegrationParam = {
            messages: context.messages,
            systemPrompt: context.systemPrompt,
            tools: agentTools,
            lifecycle: param.lifecycle,
            outputFormat: param.outputFormat,
            stream: param.stream,
            selfInformation: param.selfInformation,
            delegatedBy: param.delegatedBy,
          };

          openInferenceSpanInitAttributesSetter({ ...llmParam, span });
          const result = await this.llm(llmParam, {
            span,
            headers: getOtelHeaderFromSpan(span),
          }).catch((e) => {
            console.error(e);
            throw e;
          });
          openInferenceSpanOutputAttributesSetter({ ...result, span });

          streamEmitter(
            {
              type: 'llm.call.completed',
              data: {
                response: result.response?.toString() ?? null,
                toolRequestCount: result.toolRequests?.length ?? 0,
                selfInformation: param.selfInformation,
                delegatedBy: param.delegatedBy,
                usage: result.usage
                  ? {
                      promptTokens: result.usage.tokens.prompt,
                      completionTokens: result.usage.tokens.completion,
                    }
                  : null,
              },
            },
            param.stream,
          );

          return result;
        } finally {
          span.end();
        }
      },
    });
  }

  private createToolAgenticName(tool: AgentToolDefinition, toolServer: ToolServer) {
    return `${TOOL_SERVER_PREFIXES[toolServer]}${tool.name}`;
  }

  private registerTools(tools: AgentToolDefinition[], toolServer: ToolServer): void {
    for (const tool of tools) {
      const agenticName = this.createToolAgenticName(tool, toolServer);
      this.toolRegistry[agenticName] = {
        ...tool,
        agentic_name: agenticName,
        tool_server: toolServer,
      };
    }
  }

  private async resolveToolApprovals(
    isApprovalToolProvided: boolean,
    parentSpan: OtelInfoType,
  ): Promise<RegisteredTool[]> {
    if (!isApprovalToolProvided) {
      return this.formatToolsForLLM(
        Object.values(this.toolRegistry).map((item) => ({ ...item, requires_approval: false })),
      );
    }

    const resolvedTools: Record<string, RegisteredTool> = {};
    const toolsRequiringApproval: string[] = [];
    for (const [name, tool] of Object.entries(this.toolRegistry)) {
      resolvedTools[name] = tool;
      if (tool.requires_approval && this.approvalCache) {
        toolsRequiringApproval.push(name);
      }
    }
    if (toolsRequiringApproval.length > 0) {
      await this.applyCachedApprovals(resolvedTools, toolsRequiringApproval, parentSpan);
    }
    return this.formatToolsForLLM(Object.values(resolvedTools));
  }

  private async applyCachedApprovals(
    resolvedTools: Record<string, RegisteredTool>,
    toolNames: string[],
    parentSpan: OtelInfoType,
  ): Promise<void> {
    const approvals = (await this.approvalCache?.getBatched(this.name, toolNames, parentSpan)) ?? {};

    for (const [name, approval] of Object.entries(approvals)) {
      if (resolvedTools[name]) {
        resolvedTools[name].requires_approval = !approval.value;
      }
    }
  }

  private formatToolsForLLM(tools: RegisteredTool[]): RegisteredTool[] {
    return tools.map((tool) => ({
      ...tool,
      name: tool.agentic_name,
      description: tool.requires_approval ? `[[REQUIRES APPROVAL]]\n${tool.description}` : tool.description,
      input_schema: tool.input_schema,
    }));
  }

  private integrateLLMResponse(messages: AgentMessage[], response: string | object): AgentMessage[] {
    return [
      ...messages,
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            content: typeof response === 'string' ? response : JSON.stringify(response),
          },
        ],
      },
    ] as AgentMessage[];
  }

  private async processToolRequests(
    messages: AgentMessage[],
    toolRequests: AgentToolRequest[],
    param: AgentRunnerExecuteParam,
    parentSpan: OtelInfoType,
  ) {
    let updatedMessages = [...messages];
    const externalToolRequests: AgentToolRequest[] = [];
    const mcpInvocations: Promise<AgenticToolResultMessageContent>[] = [];

    for (const request of toolRequests) {
      const tool = this.toolRegistry[request.type];
      updatedMessages = this.addToolUseMessage(updatedMessages, request);
      if (!tool) {
        updatedMessages = this.addToolErrorMessage(updatedMessages, request.id);
        continue;
      }
      if (tool.tool_server === 'mcp') {
        streamEmitter(
          {
            type: 'tool.mcp.executing',
            data: {
              type: tool.name,
              selfInformation: param.selfInformation,
              delegatedBy: param.delegatedBy,
            },
          },
          param.stream,
        );
        mcpInvocations.push(this.invokeMCPTool(request, tool.name, parentSpan));
      } else if (tool.tool_server === 'external') {
        externalToolRequests.push({
          ...request,
          type: tool.name,
        });
      }
    }

    const mcpResults = await Promise.all(mcpInvocations);
    updatedMessages = this.addToolResults(updatedMessages, mcpResults);

    return {
      messages: updatedMessages,
      externalToolRequests,
    };
  }

  private async invokeMCPTool(
    request: AgentToolRequest,
    toolName: string,
    parentSpan: OtelInfoType,
  ): Promise<AgenticToolResultMessageContent> {
    const response =
      (await this.mcp?.invokeTool({ name: toolName, arguments: request.data }, parentSpan)) ?? 'No response available';
    return {
      type: 'tool_result',
      tool_use_id: request.id,
      content: response,
    };
  }

  private addToolUseMessage(messages: AgentMessage[], request: AgentToolRequest): AgentMessage[] {
    return [
      ...messages,
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: request.id,
            input: request.data,
            name: request.type,
          },
        ],
      },
    ];
  }

  private addToolErrorMessage(messages: AgentMessage[], toolUseId: string): AgentMessage[] {
    return [
      ...messages,
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: "The tool cannot be executed, please don't use it again.",
          },
        ],
      },
    ];
  }

  private addToolResults(messages: AgentMessage[], results: AgenticToolResultMessageContent[]): AgentMessage[] {
    const _messages = [...messages];
    for (const result of results) {
      _messages.push({
        role: 'user',
        content: [result],
      });
    }
    return _messages;
  }

  private createSuccessResponse(
    messages: AgentMessage[],
    response: string | object,
    toolInteractionCount: number,
  ): AgentRunnerExecuteOutput {
    return {
      messages,
      response: response || '<empty>',
      toolRequests: null,
      toolInteractions: {
        current: toolInteractionCount,
        max: this.maxToolInteractions,
      },
    };
  }

  private createToolRequestResponse(
    messages: AgentMessage[],
    toolRequests: AgentToolRequest[],
    toolInteractionCount: number,
  ): AgentRunnerExecuteOutput {
    return {
      messages,
      response: null,
      toolRequests,
      toolInteractions: {
        current: toolInteractionCount,
        max: this.maxToolInteractions,
      },
    };
  }

  private createOtelInfo(span: Span): OtelInfoType {
    return {
      span,
      headers: getOtelHeaderFromSpan(span),
    };
  }

  private async cleanup(otelInfo: OtelInfoType, span: Span): Promise<void> {
    await this.mcp?.disconnect(otelInfo);
    span.end();
  }
}
