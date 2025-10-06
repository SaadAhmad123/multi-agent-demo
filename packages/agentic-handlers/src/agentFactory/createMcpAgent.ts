// This code is designed to be copy and pasted into you code
import { z } from 'zod';
import type { AgenticToolDefinition, CreateAgenticResumableParams } from './types.js';
import { ArvoOpenTelemetry, createSimpleArvoContract, exceptionToSpan, type OpenTelemetryHeaders } from 'arvo-core';
import { AgenticMessageContentSchema } from './schemas.js';
import { createArvoEventHandler, type EventHandlerFactory } from 'arvo-event-handler';
import type { LLMIntergration, LLMIntegrationParam, LLMIntegrationOutput } from './integrations/types.js';
import { jsonUsageIntentPrompt, toolInteractionLimitPrompt } from './helpers.prompt.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { openInferenceSpanInitAttributesSetter, openInferenceSpanOutputAttributesSetter } from './helpers.otel.js';
import { SpanStatusCode } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';

/**
 * Default output format for agents that don't specify a custom output schema.
 * Provides a simple string response format for basic conversational agents.
 */
const DEFAULT_AGENT_OUTPUT_FORMAT = z.object({ response: z.string() });

/**
 * Interface for Model Context Protocol (MCP) client implementations.
 * Provides methods for managing MCP server connections and invoking tools.
 */
export interface IAgenticMCPClient {
  /**
   * Establishes a connection to the MCP server.
   * Must be called before any tool invocations.
   * @returns Promise that resolves when connection is established
   * @throws {Error} If connection to MCP server fails and you want to emit a system error event
   * @throws {ViolationError} If connection to MCP server fails and you want to throw an error you want to customer handle
   */
  connect: (parentOtelSpan: Span) => Promise<void>;

  /**
   * Invokes a specific tool through the MCP protocol.
   *
   * @param param - Tool invocation parameters
   * @param parentOtelSpan - OpenTelemetry span for tracing the tool invocation
   * @returns Promise resolving to the tool's response as a string
   */
  invokeTool: (
    param: { toolName: string; toolArguments?: Record<string, unknown> | null },
    parentOtelSpan: Span,
  ) => Promise<string>;

  /**
   * Gracefully disconnects from the MCP server.
   * Should be called before agent shutsdown.
   *
   * @param parentOtelSpan - OpenTelemetry span for tracing the disconnection operation
   * @returns Promise that resolves when disconnection is complete
   */
  disconnect: (parentOtelSpan: Span) => Promise<void>;

  /**
   * Retrieves all available tool definitions from the MCP server.
   * Used to discover what tools are available for the agent to use.
   *
   * @param parentOtelSpan - OpenTelemetry span for tracing the discovery operation
   */
  getToolDefinitions: (parentOtelSpan: Span) => Promise<AgenticToolDefinition[]>;
}

/**
 * Creates an MCP-enabled agent that can interact with tools via the Model Context Protocol.
 *
 * This factory function creates an Arvo event handler that integrates an LLM with MCP tools,
 * allowing the agent to perform actions and retrieve information through a standardized protocol.
 * The agent maintains conversation context, handles tool invocations, and returns structured responses.
 *
 * @returns Object containing the generated Arvo contract and handler factory
 *
 * @example
 * ```typescript
 * // Create a weather assistant with MCP tools
 * const weatherAgent = createMcpAgent({
 *   name: 'weather.assistant',
 *   description: 'An intelligent weather assistant with access to weather data tools',
 *   mcpClient: new WeatherMCPClient(),
 *   agenticLLMCaller: async (params) => {
 *     // Integrate with OpenAI, Anthropic, etc.
 *     const response = await llm.complete(params);
 *     return response;
 *   },
 *   systemPrompt: ({ messages, toolDefinitions }) => {
 *     return `You are a helpful weather assistant. Available tools: ${toolDefinitions.map(t => t.name).join(', ')}`;
 *   },
 *   enableMessageHistoryInResponse: true
 * });
 * ```
 *
 * The generated handler on Error:
 * - Throws [ViolationError] If MCP client connection fails and the MCP Client emits a ViolationError
 * - Return System Error Event If MCP client connection fails and the MCP client emit a normal Error (not a ViolationError)
 * - Return System Error Evetn If maximum tool invocation cycles (maxToolInteractions or 5) is exceeded
 */
export const createMcpAgent = <TName extends string, TOutput extends z.AnyZodObject>({
  name,
  outputFormat,
  enableMessageHistoryInResponse,
  mcpClient,
  agenticLLMCaller,
  systemPrompt,
  description,
  maxToolInteractions,
}: Omit<CreateAgenticResumableParams<TName, never, TOutput>, 'services' | 'agenticLLMCaller' | 'serviceDomains'> & {
  mcpClient: IAgenticMCPClient;
  agenticLLMCaller: LLMIntergration;
}) => {
  /**
   * Creates the Arvo contract that defines the agent's interface.
   * The contract specifies accepted input types and expected output formats.
   */
  const contract = createSimpleArvoContract({
    uri: `#/amas/handler/agent/mcp/${name.replaceAll('.', '/')}`,
    description: description,
    type: `agent.mcp.${name}` as `agent.mcp.${TName}`,
    versions: {
      '1.0.0': {
        accepts: z.object({
          message: z.string(),
          additionalSystemPrompt: z.string().optional(),
          toolUseId$$: z.string().optional(),
        }),
        emits: z.object({
          ...(enableMessageHistoryInResponse
            ? {
                messages: z
                  .object({
                    role: z.enum(['user', 'assistant']),
                    content: AgenticMessageContentSchema.array(),
                  })
                  .array(),
              }
            : {}),
          output: (outputFormat ?? DEFAULT_AGENT_OUTPUT_FORMAT) as TOutput,
          toolUseId$$: z.string().optional(),
        }),
      },
    },
    metadata: {
      contractSpecificType: 'MCPAgent',
    },
  });

  /**
   * Factory function that creates the event handler for processing agent requests.
   * This handler manages the conversation flow, tool invocations, and response generation.
   *
   * @returns Configured Arvo event handler instance
   */
  const handlerFactory: EventHandlerFactory = () =>
    createArvoEventHandler({
      contract: contract,
      executionunits: 0,
      handler: {
        '1.0.0': async ({ event, span }) => {
          /**
           * Manually crafted parent OpenTelemetry headers to ensure proper span linkage
           * and prevent potential span corruption in distributed tracing.
           */
          const parentSpanOtelHeaders: OpenTelemetryHeaders = {
            traceparent: `00-${span.spanContext().traceId}-${span.spanContext().spanId}-01`,
            tracestate: null,
          };

          /**
           * Wraps the LLM caller with comprehensive OpenTelemetry observability.
           *
           * This wrapper:
           * - Creates dedicated spans for each LLM invocation
           * - Combines system prompts with structured output instructions
           * - Captures request/response attributes for debugging
           * - Ensures proper error tracking and span status codes
           */
          const otelAgenticLLMCaller = async (
            params: Omit<LLMIntegrationParam, 'span' | 'systemPrompt'> & {
              systemPrompt: string | null;
              description: string | null;
            },
          ): Promise<LLMIntegrationOutput> => {
            // This function automatically inherits from the parent span
            return await ArvoOpenTelemetry.getInstance().startActiveSpan({
              name: 'Agentic LLM Call',
              disableSpanManagement: true,
              context: {
                inheritFrom: 'TRACE_HEADERS',
                traceHeaders: parentSpanOtelHeaders,
              },
              fn: async (_span) => {
                try {
                  const finalSystemPrompt =
                    [
                      ...(params.description ? [`# Your Agentic Description\n${params.description}`] : []),
                      ...(params.systemPrompt ? [`# Instructions:\n${params.systemPrompt}`] : []),
                      ...(params.outputFormat
                        ? [
                            `# JSON Response Requirements:\n${jsonUsageIntentPrompt(zodToJsonSchema(params.outputFormat))}`,
                          ]
                        : []),
                    ]
                      .join('\n\n')
                      .trim() || null; // This is not null-coelese because I want it to become undefined on empty string

                  openInferenceSpanInitAttributesSetter({
                    messages: params.messages,
                    systemPrompt: finalSystemPrompt,
                    tools: params.toolDefinitions,
                    span: _span,
                  });
                  const result = await agenticLLMCaller({
                    ...params,
                    systemPrompt: finalSystemPrompt ?? null,
                    span: _span,
                  });
                  openInferenceSpanOutputAttributesSetter({
                    ...result,
                    span: _span,
                  });
                  return result;
                } catch (e) {
                  exceptionToSpan(e as Error, _span);
                  _span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: (e as Error)?.message ?? 'Something went wrong',
                  });
                  throw e;
                } finally {
                  _span.end();
                }
              },
            });
          };

          // Establish MCP connection before processing
          await mcpClient.connect(span);

          // Retrieve available tool definitions from the MCP server
          const mcpClientToolDefinitions = await mcpClient.getToolDefinitions(span);

          try {
            /**
             * Initialize the conversation with the user's message.
             * Messages array maintains the full conversation context.
             */
            const messages: LLMIntegrationParam['messages'] = [];

            if (event.data.additionalSystemPrompt?.trim()) {
              messages.push({
                role: 'user',
                content: [
                  {
                    type: 'text',
                    content: event.data.additionalSystemPrompt,
                  },
                ],
              });
            }

            messages.push({
              role: 'user',
              content: [{ type: 'text', content: event.data.message }],
            });

            /**
             * Maximum number of tool invocation cycles to prevent infinite loops.
             * Each cycle represents one round of LLM reasoning and tool execution.
             *
             * Zero also defaults to 5
             */
            const MAX_CYCLE_COUNT = maxToolInteractions || 5;

            /**
             * Main conversation loop that alternates between:
             * 1. LLM reasoning (determining next action)
             * 2. Tool execution (if tools are requested)
             * 3. Result processing (feeding tool results back to LLM)
             *
             * Loop continues until LLM provides a final response or max cycles reached.
             */
            for (let i = 0; i < MAX_CYCLE_COUNT; i++) {
              if (i >= MAX_CYCLE_COUNT - 1) {
                messages.push({
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      content: toolInteractionLimitPrompt(),
                    },
                  ],
                });
              }

              const { response, toolRequests } = await otelAgenticLLMCaller({
                type: i === 0 ? 'init' : 'tool_results',
                messages,
                toolDefinitions: mcpClientToolDefinitions,
                description: description ?? null,
                systemPrompt:
                  systemPrompt?.({
                    messages,
                    services: {} as never,
                    toolDefinitions: mcpClientToolDefinitions,
                    type: i === 0 ? 'init' : 'tool_results',
                  }) ?? null,
                outputFormat: outputFormat ?? null,
              });

              /**
               * LLM provided direct response without needing tools.
               * This indicates the conversation is complete.
               */
              if (response) {
                messages.push({
                  role: 'assistant',
                  content: [
                    { type: 'text', content: typeof response === 'string' ? response : JSON.stringify(response) },
                  ],
                });

                const output = {
                  // biome-ignore lint/style/noNonNullAssertion: Typescript compiler is being silly here. This can not be undefined
                  type: contract.version('1.0.0').emitList[0]!.type as `evt.agent.mcp.${TName}.success`,
                  data: {
                    messages,
                    output: typeof response === 'string' ? { response } : response,
                    toolUseId$$: event.data.toolUseId$$,
                    // biome-ignore lint/suspicious/noExplicitAny: Need to by-pass typescript compiler as it is having a hard time evaluating the types
                  } as any,
                };
                return output;
              }

              // Throw error if LLM violates the tool use limit - Circuit breaker pattern
              if (i >= MAX_CYCLE_COUNT - 1) break;

              /**
               * LLM requested tool invocations.
               * Execute all requested tools in parallel and collect results.
               */
              if (toolRequests) {
                const toolCalls: Array<Promise<{ id: string; data: string }>> = [];
                for (const { type, id, data } of toolRequests) {
                  messages.push({
                    role: 'assistant',
                    content: [
                      {
                        type: 'tool_use',
                        id: id,
                        name: type,
                        input: data as Record<string, unknown>,
                      },
                    ],
                  });
                  toolCalls.push(
                    (async () => {
                      return {
                        id: id,
                        data: await mcpClient.invokeTool(
                          {
                            toolName: type,
                            toolArguments: data as Record<string, unknown>,
                          },
                          span,
                        ),
                      };
                    })(),
                  );
                }
                const results = await Promise.all(toolCalls);
                for (const item of results) {
                  messages.push({
                    role: 'user',
                    content: [
                      {
                        type: 'tool_result',
                        tool_use_id: item.id,
                        content: item.data,
                      },
                    ],
                  });
                }
              }
            }
            throw new Error(
              `The agentic interaction cycle count reached limit of ${MAX_CYCLE_COUNT} without any resolution.`,
            );
          } catch (e) {
            throw e as Error;
          } finally {
            // Always disconnect from MCP server, even if an error occurred
            await mcpClient.disconnect(span);
          }
        },
      },
    });

  return { contract, handlerFactory };
};
