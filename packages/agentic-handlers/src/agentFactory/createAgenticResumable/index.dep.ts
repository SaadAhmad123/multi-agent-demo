import { exceptionToSpan, type InferVersionedArvoContract } from 'arvo-core';
import {
  createArvoResumable,
  type EnqueueArvoEventActionParam,
  type EventHandlerFactory,
  type IMachineMemory,
} from 'arvo-event-handler';
import { getOtelHeaderFromSpan } from 'arvo-core';
import type { z } from 'zod';
import type { CreateAgenticResumableParams, LLMIntegrationParam, IToolUseApprovalMemory } from '../types.js';
import {} from '../helpers.otel.js';
import {
  SemanticConventions as OpenInferenceSemanticConventions,
  OpenInferenceSpanKind,
} from '@arizeai/openinference-semantic-conventions';
import { toolInteractionLimitPrompt } from '../helpers.prompt.js';
import {
  compareCollectedEventCounts,
  createAgentToolDefinitions,
  handlerConfigResolver,
  validateServiceContract,
} from './utils/index.js';
import { type DEFAULT_AGENT_OUTPUT_FORMAT, otelAgenticLLMCaller } from '../agent.utils.js';
import { createAgenticResumableContract } from './contract.js';

/**
 * Creates an agentic resumable orchestrator that integrates LLM capabilities with Arvo's event-driven architecture.
 *
 * This factory function creates a resumable orchestrator specifically designed for AI agent workflows.
 * The resulting agent can engage in multi-turn conversations, intelligently select and execute tools
 * based on context, and maintain conversation state across tool executions.
 */
export const createAgenticResumableD = <
  TName extends string,
  TOutput extends z.AnyZodObject = typeof DEFAULT_AGENT_OUTPUT_FORMAT,
>(
  config: CreateAgenticResumableParams<TName, TOutput>,
) => {
  validateServiceContract(config.services ?? {}, 'BUILD');

  /**
   * Auto-generated orchestrator contract for the agentic resumable.
   *
   * Defines the interface for starting conversations (init) and completing them (complete).
   * The init event accepts a message string, and completion returns the full conversation
   * history (optionally) along with the final response.
   */
  const contract = createAgenticResumableContract({
    ...config,
    uri: `#/amas/resumable/agent/${config.name.replaceAll('.', '/')}`,
  });
  // const contract = createArvoOrchestratorContract({
  //   uri: `#/amas/resumable/agent/${config.name.replaceAll('.', '/')}`,
  //   name: `agent.${config.name}` as `agent.${TName}`,
  //   description: buildAgentContractDescription({
  //     alias: config.alias,
  //     description: config.description,
  //     contractName: `arvo.orc.agent.${config.name}`,
  //   }),
  //   versions: {
  //     '1.0.0': {
  //       init: z.object({
  //         message: z.string(),
  //         additionalSystemPrompt: z.string().optional(),
  //       }),
  //       complete: z.object({
  //         ...(config.enableMessageHistoryInResponse
  //           ? {
  //               messages: z
  //                 .object({
  //                   role: z.enum(['user', 'assistant']),
  //                   content: AgenticMessageContentSchema.array(),
  //                 })
  //                 .array(),
  //             }
  //           : {}),
  //         output: (config.outputFormat ?? DEFAULT_AGENT_OUTPUT_FORMAT) as TOutput,
  //       }),
  //     },
  //   },
  //   metadata: {
  //     contractSpecificType: 'AgenticResumable',
  //   },
  // });

  /**
   * Internal context type for managing conversation state across resumptions.
   *
   * Tracks the conversation history, tool execution counts, and coordination
   * identifiers needed for proper agent operation in the Arvo ecosystem.
   */
  type Context = {
    currentSubject: string;
    messages: LLMIntegrationParam['messages'];
    toolTypeCount: Record<string, number>;
    currentToolCallIteration: number;
    maxToolCallIterationAllowed: number;
  };

  /**
   * Event handler factory that creates the agentic resumable instance.
   *
   * ## Conversation Flow Management
   * 1. **Initialization Phase**: Process initial user message and determine response strategy
   * 2. **Tool Execution Phase**: Execute requested tools as Arvo service events
   * 3. **Result Processing Phase**: Collect tool responses and feed back to LLM
   * 4. **Response Generation**: Generate final response or continue tool execution cycle
   *
   * ## State Management
   * - Maintains conversation context across resumptions using the provided memory system
   * - Tracks tool execution counts to ensure all parallel operations complete
   * - Preserves tool correlation IDs for proper request/response mapping
   *
   * ## Error Handling
   * - Service errors are propagated as system errors to maintain conversation integrity
   * - LLM errors are traced and reported through OpenTelemetry spans
   * - ViolationErrors result in immediate failure with descriptive messages
   *
   * @param dependencies - Required dependencies including memory provider for state persistence
   * @returns Configured ArvoResumable instance ready for deployment in the event system
   */
  const handlerFactory: EventHandlerFactory<{
    memory: IMachineMemory<Record<string, unknown>>;
    toolUseApprovalMemory?: IToolUseApprovalMemory;
    // These are dynamic parameters which can extend the agent functionality at registration time beyond what is configured at build time
    extentions?: {
      systemPrompt?: string;
      services?: CreateAgenticResumableParams<TName, TOutput>['services'];
      serviceDomains?: CreateAgenticResumableParams<TName, TOutput>['serviceDomains'];
      servicesRequireApproval?: string[];
    };
  }> = (handlerParam) => {
    const resolvedHandlerConfig = handlerConfigResolver(handlerParam.extentions ?? {}, config);
    validateServiceContract(resolvedHandlerConfig.services, 'REGISTRATION');
    return createArvoResumable({
      contracts: {
        self: contract,
        services: resolvedHandlerConfig.services,
      },
      types: {
        context: {} as Context,
      },
      executionunits: 0,
      memory: handlerParam.memory,
      handler: {
        '1.0.0': async ({ contracts, service, input, context, collectedEvents, metadata, span }) => {
          const parentSpanOtelHeaders = getOtelHeaderFromSpan(span);
          span.setAttribute(OpenInferenceSemanticConventions.OPENINFERENCE_SPAN_KIND, OpenInferenceSpanKind.AGENT);

          // Handle service errors by throwing error (which will result in the system error event)
          // if (
          //   service?.type &&
          //   Object.values(contracts.services).some((item) => item.systemError.type === service.type)
          // ) {
          //   throw new Error(
          //     // biome-ignore lint/suspicious/noExplicitAny: This any is needed here
          //     `${(service.data as any)?.errorMessage}\n[Error event emitted by ${service.source} and recieved by ${contracts.self.accepts.type})`,
          //   );
          // }

          /**
           * Converts Arvo service contracts to LLM-compatible tool definitions.
           */
          const { toolDef, toolsWhichRequireApproval } = await createAgentToolDefinitions(
            {
              handlerSource: contracts.self.accepts.type,
              services: contracts.services,
              toolUseApproval: resolvedHandlerConfig.toolUseApproval,
              toolUseApprovalMemory: handlerParam.toolUseApprovalMemory,
            },
            {
              parentSpan: span,
              parentOtelHeaders: parentSpanOtelHeaders,
            },
          );

          // Handle conversation initialization with the user's initial message
          if (input) {
            const messages: LLMIntegrationParam['messages'] = [];

            if (input.data.additionalSystemPrompt?.trim()) {
              messages.push({
                role: 'user',
                content: [
                  {
                    type: 'text',
                    content: input.data.additionalSystemPrompt,
                  },
                ],
              });
            }

            messages.push({
              role: 'user',
              content: [{ type: 'text', content: input.data.message }],
            });

            const agenticSystemPrompt = [
              ...(config.systemPrompt
                ? [
                    config.systemPrompt({
                      messages,
                      toolDefinitions: toolDef,
                      type: 'init',
                    }),
                  ]
                : []),
              ...(handlerParam.extentions?.systemPrompt ? [handlerParam.extentions.systemPrompt] : []),
            ].join('\n\n');

            const { toolRequests, toolTypeCount, response } = await otelAgenticLLMCaller(
              config.agenticLLMCaller,
              {
                type: 'init',
                messages,
                toolDefinitions: toolDef,
                description: config.description ?? null,
                systemPrompt: agenticSystemPrompt,
                outputFormat: config.outputFormat ?? null,
                alias: config.alias,
                handlerSource: contracts.self.accepts.type,
                toolsWhichRequireApproval,
                toolApprovalContract: resolvedHandlerConfig.toolUseApprovalContract,
                humanInteractionContract: resolvedHandlerConfig.humanInteractionContract,
                humanInteraction: config.humanInteraction,
              },
              {
                parentSpan: span,
                parentOtelHeaders: parentSpanOtelHeaders,
              },
            );

            // LLM provided direct response without needing tools - complete immediately
            if (response) {
              messages.push({
                role: 'assistant',
                content: [
                  { type: 'text', content: typeof response === 'string' ? response : JSON.stringify(response) },
                ],
              });

              return {
                context: {
                  messages,
                  toolTypeCount: {},
                  currentSubject: input.subject,
                  currentToolCallIteration: 1,
                  maxToolCallIterationAllowed: config.maxToolInteractions ?? 5,
                },
                output: {
                  messages,
                  output: typeof response === 'string' ? { response } : response,
                },
              };
            }

            // LLM requested tools - prepare tool calls and update conversation
            if (toolRequests) {
              for (let i = 0; i < toolRequests.length; i++) {
                if (!toolRequests[i]) continue;
                // biome-ignore lint/style/noNonNullAssertion: Typescript compiler is being silly here. Not understanding that this can never be undefined
                if (toolRequests[i]!.data && typeof toolRequests[i]!.data === 'object') {
                  // biome-ignore lint/style/noNonNullAssertion: Typescript compiler is being silly here. Not understanding that this can never be undefined
                  // biome-ignore lint/suspicious/noExplicitAny: Cannot be helped Typescript cannot resolve this unfortunately
                  (toolRequests[i]!.data as any).parentSubject$$ = input.subject; // To coordination nested orchestration/agentic invocations
                }
                // biome-ignore lint/style/noNonNullAssertion: Typescript compiler is being silly here. Not understanding that this can never be undefined
                const { type, id, data } = toolRequests[i]!;
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
              }

              return {
                context: {
                  messages,
                  toolTypeCount,
                  currentSubject: input.subject,
                  currentToolCallIteration: 1,
                  maxToolCallIterationAllowed: config.maxToolInteractions ?? 5,
                },
                services: toolRequests.map(
                  (item) =>
                    ({
                      id: { deduplication: 'DEVELOPER_MANAGED', value: item.id },
                      type: item.type,
                      data: item.data,
                      domain: resolvedHandlerConfig.serviceDomains[item.type]?.length
                        ? resolvedHandlerConfig.serviceDomains[item.type]
                        : undefined,
                    }) as EnqueueArvoEventActionParam<Record<string, unknown>, string>,
                ),
              };
            }
          }

          if (!context) throw new Error('The context is not properly set. Faulty initialization');

          // Set approved tools for approval caching
          if (
            resolvedHandlerConfig.toolUseApprovalContract.emitList[0]?.type &&
            service?.type === resolvedHandlerConfig.toolUseApprovalContract.emitList[0].type
          ) {
            const serviceEvent = service as InferVersionedArvoContract<
              typeof resolvedHandlerConfig.toolUseApprovalContract
            >['emits']['evt.tool.approval.success'];

            const toolApprovalMap: Parameters<IToolUseApprovalMemory['setBatched']>[1] = {};

            for (const item of serviceEvent.data.approvals) {
              toolApprovalMap[item.tool] = { value: item.value, comments: item.comments };
            }

            await handlerParam.toolUseApprovalMemory
              ?.setBatched(contracts.self.accepts.type, toolApprovalMap, {
                parentSpan: span,
                parentOtelHeaders: parentSpanOtelHeaders,
              })
              .catch((e) => exceptionToSpan(e as Error, span));
          }

          // Check if all expected tool responses have been collected before proceeding [Arvo Best Practice]
          const haveAllEventsBeenCollected = compareCollectedEventCounts(
            context.toolTypeCount,
            Object.fromEntries(
              Object.entries(collectedEvents).map(([key, evts]) => [key, (evts as Array<unknown>).length]),
            ),
          );

          // Wait for more tool responses if not all have arrived
          // Event collection is done automatically by the ArvoResumable
          if (!haveAllEventsBeenCollected) {
            return;
          }

          // All tool responses received - integrate them into conversation and call LLM
          const messages = [...context.messages];

          for (const eventList of Object.values(metadata?.events?.expected ?? {})) {
            for (const event of eventList) {
              let errorString = '';
              if (Object.values(contracts.services).some((item) => item.systemError.type === event.type)) {
                errorString = `
                  // You must not call this tool again as it has failed. Just respond
                  // to the user's request as much as you can and tell the user where
                  // you failed and why.
                `;
              }

              messages.push({
                role: 'user' as const,
                content: [
                  {
                    type: 'tool_result',
                    tool_use_id: event.parentid ?? '',
                    content: JSON.stringify({
                      ...event.data,
                      comment: errorString,
                    }),
                  },
                ],
              });
            }
          }

          if (context.currentToolCallIteration >= context.maxToolCallIterationAllowed - 1) {
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

          const agenticSystemPrompt = [
            ...(config.systemPrompt
              ? [
                  config.systemPrompt({
                    messages,
                    toolDefinitions: toolDef,
                    type: 'tool_results',
                  }),
                ]
              : []),
            ...(handlerParam.extentions?.systemPrompt ? [handlerParam.extentions.systemPrompt] : []),
          ].join('\n\n');

          const { response, toolRequests, toolTypeCount } = await otelAgenticLLMCaller(
            config.agenticLLMCaller,
            {
              type: 'tool_results',
              messages,
              toolDefinitions: toolDef,
              description: config.description ?? null,
              systemPrompt: agenticSystemPrompt,
              outputFormat: config.outputFormat ?? null,
              alias: config.alias,
              handlerSource: contracts.self.accepts.type,
              toolsWhichRequireApproval,
              toolApprovalContract: resolvedHandlerConfig.toolUseApprovalContract,
              humanInteractionContract: resolvedHandlerConfig.humanInteractionContract,
              humanInteraction: config.humanInteraction,
            },
            {
              parentSpan: span,
              parentOtelHeaders: parentSpanOtelHeaders,
            },
          );

          // LLM provided final response - complete the conversation
          if (response) {
            messages.push({
              role: 'assistant',
              content: [{ type: 'text', content: typeof response === 'string' ? response : JSON.stringify(response) }],
            });

            return {
              context: {
                ...context,
                messages,
                toolTypeCount: {},
                currentToolCallIteration: context.currentToolCallIteration + 1,
              },
              output: {
                messages,
                output: typeof response === 'string' ? { response } : response,
              },
            };
          }

          // LLM requested more tools - continue the processing cycle additional tool execution
          if (toolRequests) {
            for (let i = 0; i < toolRequests.length; i++) {
              if (!toolRequests[i]) continue;
              // biome-ignore lint/style/noNonNullAssertion: Typescript compiler is being silly here. Not understanding that this can never be undefined
              if (toolRequests[i]!.data && typeof toolRequests[i]!.data === 'object') {
                // biome-ignore lint/style/noNonNullAssertion: Typescript compiler is being silly here. Not understanding that this can never be undefined
                // biome-ignore lint/suspicious/noExplicitAny: Cannot be helped Typescript cannot resolve this unfortunately
                (toolRequests[i]!.data as any).parentSubject$$ = context.currentSubject;
              }
              // biome-ignore lint/style/noNonNullAssertion: Typescript compiler is being silly here. Not understanding that this can never be undefined
              const { type, id, data } = toolRequests[i]!;
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
            }
            return {
              context: {
                ...context,
                messages,
                toolTypeCount,
                currentToolCallIteration: context.currentToolCallIteration + 1,
              },
              services: toolRequests.map(
                (item) =>
                  ({
                    id: { deduplication: 'DEVELOPER_MANAGED', value: item.id },
                    type: item.type,
                    data: item.data,
                    domain: resolvedHandlerConfig.serviceDomains[item.type]?.length
                      ? resolvedHandlerConfig.serviceDomains[item.type]
                      : undefined,
                  }) as EnqueueArvoEventActionParam<Record<string, unknown>, string>,
              ),
            };
          }
        },
      },
    });
  };

  return {
    contract,
    handlerFactory,
    alias: config.alias,
  };
};
