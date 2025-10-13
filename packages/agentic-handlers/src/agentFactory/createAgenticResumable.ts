import {
  type VersionedArvoContract,
  type ArvoOrchestratorContract,
  createArvoOrchestratorContract,
  type ArvoSemanticVersion,
  ArvoOpenTelemetry,
  exceptionToSpan,
  type OpenTelemetryHeaders,
  cleanString,
  type InferVersionedArvoContract,
  logToSpan,
} from 'arvo-core';
import {
  ConfigViolation,
  createArvoResumable,
  type EventHandlerFactory,
  type IMachineMemory,
} from 'arvo-event-handler';
import { z } from 'zod';
import type {
  CreateAgenticResumableParams,
  AnyVersionedContract,
  AgenticToolDefinition,
  LLMIntegrationParam,
  LLMIntegrationOutput,
  IToolUseApprovalMemory,
} from './types.js';
import { openInferenceSpanInitAttributesSetter, openInferenceSpanOutputAttributesSetter } from './helpers.otel.js';
import {
  SemanticConventions as OpenInferenceSemanticConventions,
  OpenInferenceSpanKind,
} from '@arizeai/openinference-semantic-conventions';
import { SpanStatusCode } from '@opentelemetry/api';
import { AgenticMessageContentSchema } from './schemas.js';
import { jsonUsageIntentPrompt, toolInteractionLimitPrompt } from './helpers.prompt.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { humanReviewContract } from './humanReview.contract.js';
import { toolUseApprovalContract } from './toolUseApproval.contract.js';

/**
 * [Utility] Validates that service contracts for agentic resumables meet required structure.
 *
 * Ensures that:
 * - All orchestrator contracts include the required `parentSubject$$` field
 * - All service contracts include `toolUseId$$` in both accepts and emits schemas. This
 * is because all LLMs require tool call coorelation id and these ids need to be propagated.
 *
 * @param contracts - Record of service contracts to validate
 * @throws {ConfigViolation} When contracts don't meet agentic resumable requirements
 */
const validateServiceContract = (contracts: Record<string, AnyVersionedContract>) => {
  for (const [contractKey, contract] of Object.entries(contracts)) {
    if (
      (contract as VersionedArvoContract<ArvoOrchestratorContract, ArvoSemanticVersion>)?.metadata?.contractType ===
        'ArvoOrchestratorContract' &&
      !('parentSubject$$' in (contract.accepts.schema as z.AnyZodObject).shape)
    ) {
      throw new ConfigViolation(
        `The orchestrator contract '${contract.uri}' keyed as '${contractKey}' must have field 'parentSubject$$'`,
      );
    }
    const zodObjects: z.AnyZodObject[] = [contract.accepts.schema, ...Object.values(contract.emits)];
    for (const item of zodObjects) {
      if (!('toolUseId$$' in (item as z.AnyZodObject).shape)) {
        throw new ConfigViolation(
          `All the service contract of an agentic resumable must have toolUseId$$. The service contract '${contract.uri}' keyed at '${contractKey}' must have 'toolUseId$$' in accept and emit events`,
        );
      }
    }
  }
};

/**
 * [Utility] Compares expected event counts with actual collected event counts.
 *
 * Used to determine if all expected service responses have been received
 * before proceeding with the next step in the agentic workflow.
 */
const compareCollectedEventCounts = (target: Record<string, number>, current: Record<string, number>) => {
  const sumTarget = Object.values(target).reduce((acc, cur) => acc + cur, 0);
  const sumCurrent = Object.values(current).reduce((acc, cur) => acc + cur, 0);
  return sumCurrent === sumTarget;
};

/**
 * Default output format for agents that don't specify a custom output schema.
 * Provides a simple string response format for basic conversational agents.
 */
const DEFAULT_AGENT_OUTPUT_FORMAT = z.object({ response: z.string() });

/**
 * Creates an agentic resumable orchestrator that integrates LLM capabilities with Arvo's event-driven architecture.
 *
 * This factory function creates a resumable orchestrator specifically designed for AI agent workflows.
 * The resulting agent can engage in multi-turn conversations, intelligently select and execute tools
 * based on context, and maintain conversation state across tool executions.
 */
export const createAgenticResumable = <
  TName extends string,
  TOutput extends z.AnyZodObject = typeof DEFAULT_AGENT_OUTPUT_FORMAT,
>({
  alias,
  name,
  services,
  agenticLLMCaller,
  serviceDomains,
  systemPrompt,
  outputFormat,
  enableMessageHistoryInResponse,
  description,
  maxToolInteractions,
  toolUseApproval,
  humanReview,
}: CreateAgenticResumableParams<TName, TOutput>) => {
  validateServiceContract(services ?? {});

  /**
   * Auto-generated orchestrator contract for the agentic resumable.
   *
   * Defines the interface for starting conversations (init) and completing them (complete).
   * The init event accepts a message string, and completion returns the full conversation
   * history (optionally) along with the final response.
   */
  const contract = createArvoOrchestratorContract({
    uri: `#/amas/resumable/agent/${name.replaceAll('.', '/')}`,
    name: `agent.${name}` as `agent.${TName}`,
    description: alias
      ? cleanString(`
      # My Introduction:
      I am a human user facing agent, known to humans as "@${alias}"
      meaning I can be called by the human user directly when they mention
      @${alias} in the message
      # My description:
      ${description}
    `)
      : description,
    versions: {
      '1.0.0': {
        init: z.object({
          message: z.string(),
          additionalSystemPrompt: z.string().optional(),
          toolUseId$$: z.string().optional(),
        }),
        complete: z.object({
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
      contractSpecificType: 'AgenticResumable',
    },
  });

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
    toolUseId$$: string | null;
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
    extend?: {
      systemPrompt?: string;
      services?: NonNullable<CreateAgenticResumableParams<TName, TOutput>>['services'];
      // Define the domains of the additional services
      serviceDomains?: NonNullable<CreateAgenticResumableParams<TName, TOutput>>['serviceDomains'];
      // Define which additional services need approval
      servicesRequireApproval?: string[];
    };
  }> = (handlerParam) => {
    const hrContract = humanReviewContract.version('1.0.0');
    const tuaContract = toolUseApprovalContract.version('1.0.0');
    const handlerServices: Record<string, AnyVersionedContract> = {};

    for (const serviceContract of [
      ...Object.values(services ?? {}),
      ...Object.values(handlerParam.extend?.services ?? {}),
    ]) {
      if (!handlerServices[serviceContract.dataschema]) {
        handlerServices[serviceContract.dataschema] = serviceContract;
      }
    }

    const handlerHumanReview = humanReview ?? null;
    const handlerToolUseApproval = !toolUseApproval
      ? null
      : {
          ...toolUseApproval,
          tools: [...toolUseApproval.tools, ...(handlerParam.extend?.servicesRequireApproval ?? [])].filter(
            (item) => !([hrContract.accepts.type, tuaContract.accepts.type] as string[]).includes(item),
          ),
        };
    const handlerAlias = alias ?? null;
    const handlerServiceDomains: Record<string, string[]> = serviceDomains ?? {};

    for (const [key, value] of Object.entries(handlerParam.extend?.serviceDomains ?? {})) {
      if (handlerServiceDomains[key]) {
        handlerServiceDomains[key] = Array.from(new Set([...handlerServiceDomains[key], ...value]));
      } else {
        handlerServiceDomains[key] = value;
      }
    }

    // For human and tool use events, the domains defined by the repective configurations are prioratised
    if (handlerHumanReview) {
      handlerServices[hrContract.dataschema] = hrContract;
      handlerServiceDomains[humanReviewContract.type] = handlerHumanReview.domain;
    }
    if (handlerToolUseApproval) {
      handlerServices[tuaContract.dataschema] = tuaContract;
      handlerServiceDomains[toolUseApprovalContract.type] = handlerToolUseApproval.domain;
    }

    return createArvoResumable({
      contracts: {
        self: contract,
        services: handlerServices,
      },
      types: {
        context: {} as Context,
      },
      executionunits: 0,
      memory: handlerParam.memory,
      handler: {
        '1.0.0': async ({ contracts, service, input, context, collectedEvents, metadata, span }) => {
          // Manually crafting parent otel header to prevent potential span corruption
          const parentSpanOtelHeaders: OpenTelemetryHeaders = {
            traceparent: `00-${span.spanContext().traceId}-${span.spanContext().spanId}-01`,
            tracestate: null,
          };

          span.setAttribute(OpenInferenceSemanticConventions.OPENINFERENCE_SPAN_KIND, OpenInferenceSpanKind.AGENT);
          // Handle service errors by throwing error (which will result in the system error event)
          if (
            service?.type &&
            Object.values(contracts.services).some((item) => item.systemError.type === service.type)
          ) {
            throw new Error(
              // biome-ignore lint/suspicious/noExplicitAny: This any is needed here
              `Something went wrong in an invoked service. Error -> ${(service.data as any)?.errorMessage}`,
            );
          }

          /**
           * Converts Arvo service contracts to LLM-compatible tool definitions.
           *
           * Transforms contract schemas by:
           * - Extracting JSON schema representations from Arvo contracts
           * - Removing Arvo-specific coordination fields (toolUseId$$, parentSubject$$)
           * - Preserving contract descriptions and input validation schemas
           */
          const toolDef: AgenticToolDefinition[] = [];
          const toolsWhichRequireApproval: string[] = [];
          for (const item of Object.values(contracts.services)) {
            const inputSchema = item.toJsonSchema().accepts.schema;
            // @ts-ignore - The 'properties' field exists in there but is not pick up by typescript compiler
            const { toolUseId$$, parentSubject$$, ...cleanedProperties } = inputSchema?.properties ?? {};
            // @ts-ignore - The 'required' field exists in there but is not pick up by typescript compiler
            const cleanedRequired = (inputSchema?.required ?? []).filter(
              (item: string) => item !== 'toolUseId$$' && item !== 'parentSubject$$',
            );
            // Cleaning the description so that approval requirement is set explicitly by the configuration
            const cleanedDescription = item.description.replaceAll('[[REQUIRE APPROVAL]]', '');
            toolDef.push({
              name: item.accepts.type,
              description: await (async () => {
                if (
                  handlerToolUseApproval?.tools.includes(item.accepts.type) &&
                  !(
                    await handlerParam.toolUseApprovalMemory?.get(
                      contracts.self.accepts.type,
                      item.accepts.type.replaceAll('.', '_'),
                      span,
                    )
                  )?.value
                ) {
                  logToSpan({ level: 'INFO', message: `Agentic tool '${item.accepts.type}' requires approval` }, span);
                  toolsWhichRequireApproval.push(item.accepts.type.replaceAll('.', '_'));
                  return `[[REQUIRE APPROVAL]]. ${cleanedDescription}`;
                }
                logToSpan(
                  { level: 'INFO', message: `Agentic tool '${item.accepts.type}' does not require approval` },
                  span,
                );
                return cleanedDescription;
              })(),

              input_schema: {
                ...inputSchema,
                properties: cleanedProperties,
                required: cleanedRequired,
              },
            });
          }

          /**
           * Wraps the LLM caller with OpenTelemetry observability and system prompt generation.
           *
           * Creates a new OTEL span for each LLM call, handles prompt composition,
           * and ensures proper error tracking. The wrapper combines user-provided
           * system prompts with structured output instructions when applicable.
           */
          const otelAgenticLLMCaller: (
            param: Omit<LLMIntegrationParam, 'span' | 'systemPrompt'> & {
              systemPrompt: string | null;
              description: string | null;
              introduction: {
                alias: string | null;
                handlerSource: string;
                agentName: string;
              };
            },
          ) => Promise<LLMIntegrationOutput> = async (params) => {
            // This function automatically inherits from the parent span
            return await ArvoOpenTelemetry.getInstance().startActiveSpan({
              name: 'Agentic LLM Call',
              disableSpanManagement: true,
              context: {
                inheritFrom: 'TRACE_HEADERS',
                traceHeaders: parentSpanOtelHeaders,
              },
              fn: async (span) => {
                try {
                  const finalSystemPrompt =
                    [
                      cleanString(`
                        # Your Identity
                        You are an AI agent with the following identities:
                        ${params.introduction.alias ? `- When interacting with humans, you are known as "@${params.introduction.alias}"` : ''} 
                        - Your system identifier is "${params.introduction.handlerSource}"
                        - Other AI agents know you as "${params.introduction.agentName}"
                      `),
                      ...(params.description ? [`# Your Purpose and Capabilities\n${params.description}`] : []),
                      ...(handlerHumanReview
                        ? [
                            cleanString(`
                              # CRITICAL: Human Interaction Required
                              The ${hrContract.accepts.type.replaceAll('.', '_')} tool is your DIRECT communication channel with the user. Use it to talk TO them.
                              ## Purpose 1: Requesting Clarification
                              When the user's request is unclear, ambiguous, or missing critical information, ask them directly.
                              **Call ${hrContract.accepts.type.replaceAll('.', '_')} with your questions to the user.** Do NOT ask whether you should ask questions. Just ask the questions.
                              Address them naturally: "Could you clarify...", "I need to know...", "Which would you prefer...", "Do you want me to..."
                              Explain what's unclear: what information is missing or ambiguous, why you need it to proceed correctly, what different approaches are possible depending on their answer.
                              **Important:** When asking for clarification, do NOT propose an execution plan. Just ask your clarifying questions and the user will respond through this same tool.
                              ## Purpose 2: Requesting Execution Approval
                              When the request is clear and you have all necessary information, present your execution plan for approval.
                              **Call ${hrContract.accepts.type.replaceAll('.', '_')} with your plan addressed to the user.**
                              Address them directly: "My execution plan is...", "Could you approve this approach...", "May I proceed with..."
                              Include in your plan: what you will do to fulfill their request, which tools/agents you'll use and in what order, why you need each tool/agent, what the expected outcome will be.
                              **Important:** Only present an execution plan when you have sufficient information. If anything is unclear, use Purpose 1 first.
                              ## Response Handling
                              The user responds through the same ${hrContract.accepts.type.replaceAll('.', '_')} tool. When they respond:
                              - **If they clarified information:** Determine if you now have enough to create an execution plan (Purpose 2) or need more clarification (Purpose 1)
                              - **If they approved your plan:** Execute immediately by calling the tools/agents in your approved plan
                              - **If they requested plan changes:** Revise your plan and resubmit for approval (Purpose 2)
                              - **If they rejected your plan:** Propose alternatives directly to them (Purpose 2)
                              - **If changes aren't feasible:** Explain constraints and propose viable alternatives (Purpose 2)
                              Continue using ${hrContract.accepts.type.replaceAll('.', '_')} until you have both clarity AND explicit execution approval.
                              ## Execution
                              Only execute (call tools/agents) after receiving explicit approval. Never bypass this step.
                              **Critical:** The ${hrContract.accepts.type.replaceAll('.', '_')} tool sends messages DIRECTLY to the user. Don't ask meta-questions about whether you should communicate. Just communicate.
                            `),
                          ]
                        : []),
                      ...(toolsWhichRequireApproval.length
                        ? [
                            cleanString(`
                              # CRITICAL: Restricted Tool Approval Required
                              The following tools require explicit approval before use:
                              ${toolsWhichRequireApproval.map((tool) => `- ${tool}`).join('\n')}
                              
                              Before using any restricted tool:
                              1. Call ${tuaContract.accepts.type.replaceAll('.', '_')} to request approval directly from the user
                              2. Explain clearly why you need to use each restricted tool and what you'll do with it
                              3. If denied, inform the user and propose alternative approaches
                              
                              **Important:** ${tuaContract.accepts.type.replaceAll('.', '_')} sends your approval request DIRECTLY to the user. Don't ask whether you should request approval - just request it.
                              
                              Tools NOT listed above can be used freely without approval.
                            `),
                          ]
                        : []),
                      ...(params.systemPrompt ? [`# Your Instructions\n${params.systemPrompt}`] : []),
                      ...(params.outputFormat
                        ? [
                            `# Required Response Format\nYou must respond in the following JSON format:\n${jsonUsageIntentPrompt(zodToJsonSchema(params.outputFormat))}`,
                          ]
                        : []),
                    ]
                      .join('\n\n')
                      .trim() || null; // This is not null-coelese because I want it to become undefined on empty string

                  openInferenceSpanInitAttributesSetter({
                    messages: params.messages,
                    systemPrompt: finalSystemPrompt,
                    tools: toolDef,
                    span,
                  });
                  const result = await agenticLLMCaller({
                    ...params,
                    systemPrompt: finalSystemPrompt ?? null,
                    span,
                  });
                  openInferenceSpanOutputAttributesSetter({
                    ...result,
                    span,
                  });
                  return result;
                } catch (e) {
                  exceptionToSpan(e as Error, span);
                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: (e as Error)?.message ?? 'Something went wrong',
                  });
                  throw e;
                } finally {
                  span.end();
                }
              },
            });
          };

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

            const { toolRequests, toolTypeCount, response } = await otelAgenticLLMCaller({
              type: 'init',
              messages,
              toolDefinitions: toolDef,
              description: description ?? null,
              systemPrompt: [
                ...(systemPrompt
                  ? [
                      systemPrompt({
                        messages,
                        toolDefinitions: toolDef,
                        type: 'init',
                      }),
                    ]
                  : []),
                ...(handlerParam.extend?.systemPrompt ? [handlerParam.extend.systemPrompt] : []),
              ].join('\n\n'),
              outputFormat: outputFormat ?? null,
              introduction: {
                alias: handlerAlias,
                handlerSource: contracts.self.accepts.type,
                agentName: contracts.self.accepts.type.replaceAll('.', '_'),
              },
            });

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
                  toolUseId$$: input.data.toolUseId$$ ?? null,
                  currentToolCallIteration: 1,
                  maxToolCallIterationAllowed: maxToolInteractions ?? 5,
                },
                output: {
                  messages,
                  output: typeof response === 'string' ? { response } : response,
                  toolUseId$$: input.data.toolUseId$$,
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
                  (toolRequests[i]!.data as any).toolUseId$$ = toolRequests[i]!.id; // To coordination tool calls for the LLM
                  // biome-ignore lint/style/noNonNullAssertion: Typescript compiler is being silly here. Not understanding that this can never be undefined
                  // biome-ignore lint/suspicious/noExplicitAny: Cannot be helped Typescript cannot resolve this unfortunately
                  (toolRequests[i]!.data as any).parentSubject$$ = input.subject; // To coordination nested orchestration/agentic invocations
                }
                // biome-ignore lint/style/noNonNullAssertion: Typescript compiler is being silly here. Not understanding that this can never be undefined
                const { type, id, data } = toolRequests[i]!;
                const { toolUseId$$, ...toolInputData } = data as Record<string, unknown>;
                messages.push({
                  role: 'assistant',
                  content: [
                    {
                      type: 'tool_use',
                      id: id,
                      name: type,
                      input: toolInputData,
                    },
                  ],
                });
              }

              return {
                context: {
                  messages,
                  toolTypeCount,
                  currentSubject: input.subject,
                  toolUseId$$: input.data.toolUseId$$ ?? null,
                  currentToolCallIteration: 1,
                  maxToolCallIterationAllowed: maxToolInteractions ?? 5,
                },
                services: toolRequests.map((item) =>
                  item.type in handlerServiceDomains ? { ...item, domain: handlerServiceDomains[item.type] } : item,
                ),
              };
            }
          }

          if (!context) throw new Error('The context is not properly set. Faulty initialization');

          if (
            handlerParam.toolUseApprovalMemory &&
            tuaContract.emitList[0]?.type &&
            service?.type === tuaContract.emitList[0].type
          ) {
            const serviceEvent = service as InferVersionedArvoContract<
              typeof tuaContract
            >['emits']['evt.tool.approval.success'];
            await Promise.all(
              serviceEvent.data.approvals.map(async (item) => {
                return await handlerParam.toolUseApprovalMemory?.set(
                  contracts.self.accepts.type,
                  item.tool,
                  {
                    value: item.value,
                    comments: item.comments,
                  },
                  span,
                );
              }),
            ).catch((e) => exceptionToSpan(e as Error, span));
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
              messages.push({
                role: 'user' as const,
                content: [
                  {
                    type: 'tool_result',
                    tool_use_id: event.data?.toolUseId$$ ?? '',
                    content: JSON.stringify(event.data),
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

          const { response, toolRequests, toolTypeCount } = await otelAgenticLLMCaller({
            type: 'tool_results',
            messages,
            toolDefinitions: toolDef,
            description: description ?? null,
            systemPrompt: [
              ...(systemPrompt
                ? [
                    systemPrompt({
                      messages,
                      toolDefinitions: toolDef,
                      type: 'init',
                    }),
                  ]
                : []),
              ...(handlerParam.extend?.systemPrompt ? [handlerParam.extend.systemPrompt] : []),
            ].join('\n\n'),
            outputFormat: outputFormat ?? null,
            introduction: {
              alias: handlerAlias,
              handlerSource: contracts.self.accepts.type,
              agentName: contracts.self.accepts.type.replaceAll('.', '_'),
            },
          });

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
                toolUseId$$: context.toolUseId$$ ?? undefined,
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
                (toolRequests[i]!.data as any).toolUseId$$ = toolRequests[i]!.id;
                // biome-ignore lint/style/noNonNullAssertion: Typescript compiler is being silly here. Not understanding that this can never be undefined
                // biome-ignore lint/suspicious/noExplicitAny: Cannot be helped Typescript cannot resolve this unfortunately
                (toolRequests[i]!.data as any).parentSubject$$ = context.currentSubject;
              }
              // biome-ignore lint/style/noNonNullAssertion: Typescript compiler is being silly here. Not understanding that this can never be undefined
              const { type, id, data } = toolRequests[i]!;
              const { toolUseId$$, ...toolInputData } = data as Record<string, unknown>;
              messages.push({
                role: 'assistant',
                content: [
                  {
                    type: 'tool_use',
                    id: id,
                    name: type,
                    input: toolInputData,
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
              services: toolRequests.map((item) =>
                item.type in handlerServiceDomains ? { ...item, domain: handlerServiceDomains[item.type] } : item,
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
    alias,
  };
};
