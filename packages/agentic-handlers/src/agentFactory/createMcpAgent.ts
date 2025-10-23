// // This code is designed to be copy and pasted into you code
// import { z } from 'zod';
// import { createSimpleArvoContract, type OpenTelemetryHeaders } from 'arvo-core';
// import { AgenticMessageContentSchema } from './schemas.js';
// import { createArvoEventHandler, type EventHandlerFactory } from 'arvo-event-handler';
// import { toolInteractionLimitPrompt } from './helpers.prompt.js';
// import {} from './helpers.otel.js';
// import type { CreateAgenticResumableParams, IAgenticMCPClient, LLMIntergration, LLMIntegrationParam } from './types.js';
// import { buildAgentContractDescription, DEFAULT_AGENT_OUTPUT_FORMAT, otelAgenticLLMCaller } from './agent.utils.js';

// /**
//  * Creates an MCP-enabled agent that can interact with tools via the Model Context Protocol.
//  *
//  * This factory function creates an Arvo event handler that integrates an LLM with MCP tools,
//  * allowing the agent to perform actions and retrieve information through a standardized protocol.
//  * The agent maintains conversation context, handles tool invocations, and returns structured responses.
//  *
//  * @returns Object containing the generated Arvo contract and handler factory
//  *
//  * @example
//  * ```typescript
//  * // Create a weather assistant with MCP tools
//  * const weatherAgent = createMcpAgent({
//  *   name: 'weather.assistant',
//  *   description: 'An intelligent weather assistant with access to weather data tools',
//  *   mcpClient: new WeatherMCPClient(),
//  *   agenticLLMCaller: async (params) => {
//  *     // Integrate with OpenAI, Anthropic, etc.
//  *     const response = await llm.complete(params);
//  *     return response;
//  *   },
//  *   systemPrompt: ({ messages, toolDefinitions }) => {
//  *     return `You are a helpful weather assistant. Available tools: ${toolDefinitions.map(t => t.name).join(', ')}`;
//  *   },
//  *   enableMessageHistoryInResponse: true
//  * });
//  * ```
//  *
//  * The generated handler on Error:
//  * - Throws [ViolationError] If MCP client connection fails and the MCP Client emits a ViolationError
//  * - Return System Error Event If MCP client connection fails and the MCP client emit a normal Error (not a ViolationError)
//  * - Return System Error Evetn If maximum tool invocation cycles (maxToolInteractions or 5) is exceeded
//  */
// export const createMcpAgent = <
//   TName extends string,
//   TOutput extends z.AnyZodObject = typeof DEFAULT_AGENT_OUTPUT_FORMAT,
// >({
//   alias,
//   name,
//   outputFormat,
//   enableMessageHistoryInResponse,
//   mcpClient,
//   agenticLLMCaller,
//   systemPrompt,
//   description,
//   maxToolInteractions,
// }: Omit<CreateAgenticResumableParams<TName, TOutput>, 'services' | 'agenticLLMCaller' | 'serviceDomains'> & {
//   mcpClient?: IAgenticMCPClient;
//   agenticLLMCaller: LLMIntergration;
// }) => {
//   /**
//    * Creates the Arvo contract that defines the agent's interface.
//    * The contract specifies accepted input types and expected output formats.
//    */
//   const handlerContract = createSimpleArvoContract({
//     uri: `#/amas/handler/agent/mcp/${name.replaceAll('.', '/')}`,
//     type: `agent.mcp.${name}` as `agent.mcp.${TName}`,
//     description: buildAgentContractDescription({
//       alias: alias,
//       description: description,
//       contractName: `com.agent.mcp.${name}`,
//     }),
//     versions: {
//       '1.0.0': {
//         accepts: z.object({
//           message: z.string(),
//           additionalSystemPrompt: z.string().optional(),
//           toolUseId$$: z.string().optional(),
//         }),
//         emits: z.object({
//           ...(enableMessageHistoryInResponse
//             ? {
//                 messages: z
//                   .object({
//                     role: z.enum(['user', 'assistant']),
//                     content: AgenticMessageContentSchema.array(),
//                   })
//                   .array(),
//               }
//             : {}),
//           output: (outputFormat ?? DEFAULT_AGENT_OUTPUT_FORMAT) as TOutput,
//           toolUseId$$: z.string().optional(),
//         }),
//       },
//     },
//     metadata: {
//       contractSpecificType: 'MCPAgent',
//     },
//   });

//   /**
//    * Factory function that creates the event handler for processing agent requests.
//    * This handler manages the conversation flow, tool invocations, and response generation.
//    *
//    * @returns Configured Arvo event handler instance
//    */
//   const handlerFactory: EventHandlerFactory<{
//     extentions?: {
//       systemPrompt?: string;
//     };
//   }> = (handlerParam) =>
//     createArvoEventHandler({
//       contract: handlerContract,
//       executionunits: 0,
//       handler: {
//         '1.0.0': async ({ event, span, contract }) => {
//           /**
//            * Manually crafted parent OpenTelemetry headers to ensure proper span linkage
//            * and prevent potential span corruption in distributed tracing.
//            */
//           const parentSpanOtelHeaders: OpenTelemetryHeaders = {
//             traceparent: `00-${span.spanContext().traceId}-${span.spanContext().spanId}-01`,
//             tracestate: null,
//           };

//           // Establish MCP connection before processing
//           await mcpClient?.connect(span, parentSpanOtelHeaders);

//           // Retrieve available tool definitions from the MCP server
//           const mcpClientToolDefinitions = (await mcpClient?.getToolDefinitions(span, parentSpanOtelHeaders)) ?? [];

//           try {
//             /**
//              * Initialize the conversation with the user's message.
//              * Messages array maintains the full conversation context.
//              */
//             const messages: LLMIntegrationParam['messages'] = [];

//             if (event.data.additionalSystemPrompt?.trim()) {
//               messages.push({
//                 role: 'user',
//                 content: [
//                   {
//                     type: 'text',
//                     content: event.data.additionalSystemPrompt,
//                   },
//                 ],
//               });
//             }

//             messages.push({
//               role: 'user',
//               content: [{ type: 'text', content: event.data.message }],
//             });

//             /**
//              * Maximum number of tool invocation cycles to prevent infinite loops.
//              * Each cycle represents one round of LLM reasoning and tool execution.
//              *
//              * Zero also defaults to 5
//              */
//             const MAX_CYCLE_COUNT = maxToolInteractions || 5;

//             /**
//              * Main conversation loop that alternates between:
//              * 1. LLM reasoning (determining next action)
//              * 2. Tool execution (if tools are requested)
//              * 3. Result processing (feeding tool results back to LLM)
//              *
//              * Loop continues until LLM provides a final response or max cycles reached.
//              */
//             for (let i = 0; i < MAX_CYCLE_COUNT; i++) {
//               if (i >= MAX_CYCLE_COUNT - 1) {
//                 messages.push({
//                   role: 'user',
//                   content: [
//                     {
//                       type: 'text',
//                       content: toolInteractionLimitPrompt(),
//                     },
//                   ],
//                 });
//               }

//               const agenticSystemPrompt = [
//                 ...(systemPrompt
//                   ? [
//                       systemPrompt({
//                         messages,
//                         toolDefinitions: mcpClientToolDefinitions,
//                         type: i === 0 ? 'init' : 'tool_results',
//                       }),
//                     ]
//                   : []),
//                 ...(handlerParam.extentions?.systemPrompt ? [handlerParam.extentions.systemPrompt] : []),
//               ].join('\n\n');

//               const { response, toolRequests } = await otelAgenticLLMCaller(
//                 agenticLLMCaller,
//                 {
//                   type: i === 0 ? 'init' : 'tool_results',
//                   messages,
//                   toolDefinitions: mcpClientToolDefinitions,
//                   description: description ?? null,
//                   systemPrompt: agenticSystemPrompt,
//                   outputFormat: outputFormat ?? null,
//                   alias: alias,
//                   handlerSource: contract.accepts.type,
//                   toolsWhichRequireApproval: [],
//                 },
//                 {
//                   parentSpan: span,
//                   parentOtelHeaders: parentSpanOtelHeaders,
//                 },
//               );

//               /**
//                * LLM provided direct response without needing tools.
//                * This indicates the conversation is complete.
//                */
//               if (response) {
//                 messages.push({
//                   role: 'assistant',
//                   content: [
//                     { type: 'text', content: typeof response === 'string' ? response : JSON.stringify(response) },
//                   ],
//                 });

//                 const output = {
//                   // biome-ignore lint/style/noNonNullAssertion: Typescript compiler is being silly here. This can not be undefined
//                   type: contract.emitList[0]!.type as `evt.agent.mcp.${TName}.success`,
//                   data: {
//                     messages,
//                     output: typeof response === 'string' ? { response } : response,
//                     toolUseId$$: event.data.toolUseId$$,
//                     // biome-ignore lint/suspicious/noExplicitAny: Need to by-pass typescript compiler as it is having a hard time evaluating the types
//                   } as any,
//                 };
//                 return output;
//               }

//               // Throw error if LLM violates the tool use limit - Circuit breaker pattern
//               if (i >= MAX_CYCLE_COUNT - 1) break;

//               /**
//                * LLM requested tool invocations.
//                * Execute all requested tools in parallel and collect results.
//                */
//               if (toolRequests && mcpClient) {
//                 const toolCalls: Array<Promise<{ id: string; data: string }>> = [];
//                 for (const { type, id, data } of toolRequests) {
//                   messages.push({
//                     role: 'assistant',
//                     content: [
//                       {
//                         type: 'tool_use',
//                         id: id,
//                         name: type,
//                         input: data as Record<string, unknown>,
//                       },
//                     ],
//                   });
//                   toolCalls.push(
//                     (async () => {
//                       return {
//                         id: id,
//                         data: await mcpClient.invokeTool(
//                           {
//                             toolName: type,
//                             toolArguments: data as Record<string, unknown>,
//                           },
//                           span,
//                           parentSpanOtelHeaders,
//                         ),
//                       };
//                     })(),
//                   );
//                 }
//                 const results = await Promise.all(toolCalls);
//                 for (const item of results) {
//                   messages.push({
//                     role: 'user',
//                     content: [
//                       {
//                         type: 'tool_result',
//                         tool_use_id: item.id,
//                         content: item.data,
//                       },
//                     ],
//                   });
//                 }
//               }
//             }
//             throw new Error(
//               `The agentic interaction cycle count reached limit of ${MAX_CYCLE_COUNT} without any resolution.`,
//             );
//           } catch (e) {
//             throw e as Error;
//           } finally {
//             // Always disconnect from MCP server, even if an error occurred
//             await mcpClient?.disconnect(span, parentSpanOtelHeaders);
//           }
//         },
//       },
//     });

//   return { contract: handlerContract, handlerFactory, alias };
// };
