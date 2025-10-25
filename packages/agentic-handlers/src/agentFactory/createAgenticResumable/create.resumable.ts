import type {
  AgenticStateContext,
  AgenticSystemPromptBuilderParam,
  CreateAgenticResumableParams,
} from './types/index.js';
import type { AgenticResumableContract, createAgenticResumableContract } from './create.contract.js';
import {
  compareCollectedEventCounts,
  createAgentToolDefinitions,
  prioritizeToolRequests,
  resolveServiceConfig,
} from './utils/index.js';
import { createArvoResumable, type EnqueueArvoEventActionParam, type IMachineMemory } from 'arvo-event-handler';
import { exceptionToSpan, getOtelHeaderFromSpan, type InferVersionedArvoContract } from 'arvo-core';
import {
  OpenInferenceSpanKind,
  SemanticConventions as OpenInferenceSemanticConventions,
} from '@arizeai/openinference-semantic-conventions';
import {
  initConversation,
  integrateIterationLimitWarning,
  integrateLLMResponse,
  integrateToolRequests,
  integrateToolResults,
} from './utils/conversation.js';
import { otelLLMIntegration } from './utils/otel.llm.js';
import type { AnyVersionedContract } from '../types.js';
import type { NonEmptyArray } from '../types.js';
import type { LLMIntegrationParam } from './types/llm.integration.js';
import { DEFAULT_AGENT_MAX_TOOL_INTERACTIONS } from './utils/defaults.js';

// This is needed to satisfy the Typescript compiler that it is indeed
// a ArvoOrchestratorContract under the hood.
type ResolveSelfContractType<TContract extends AgenticResumableContract> = ReturnType<
  typeof createAgenticResumableContract<
    TContract['metadata']['config']['uri'],
    TContract['metadata']['config']['name'],
    TContract['metadata']['config']['output']
  >
>;

export const createAgenticResumable = <TContract extends AgenticResumableContract>({
  contract,
  llm,
  memory,
  services,
  systemPrompt,
  maxToolInteractions,
  enableHumanInteraction,
  enableToolApproval,
  mcp,
}: CreateAgenticResumableParams<TContract>) => {
  const resolvedServices = resolveServiceConfig(
    services ?? null,
    enableToolApproval ?? null,
    enableHumanInteraction ?? null,
  );
  return createArvoResumable({
    contracts: {
      self: contract as ResolveSelfContractType<TContract>,
      services: resolvedServices.contracts,
    },
    types: {
      context: {} as AgenticStateContext,
    },
    executionunits: 0,
    memory: memory as IMachineMemory<Record<string, unknown>>,
    handler: {
      '1.0.0': async ({ span, contracts, input, context, service, collectedEvents, metadata }) => {
        span.setAttribute(OpenInferenceSemanticConventions.OPENINFERENCE_SPAN_KIND, OpenInferenceSpanKind.AGENT);
        const parentSpanConfig = {
          parentSpan: span,
          parentOtelHeaders: getOtelHeaderFromSpan(span),
        };

        const agenticToolDefinitions = await createAgentToolDefinitions(
          {
            handlerSource: contracts.self.accepts.type,
            resolvedServiceConfig: resolvedServices,
            toolUseApprovalMemory: enableToolApproval?.memory ?? null,
          },
          parentSpanConfig,
        );

        const llmIntegration = async (
          messages: AgenticSystemPromptBuilderParam['messages'],
          type: LLMIntegrationParam['type'],
          currentIteration: number,
        ) => {
          const toolApprovalConfig =
            enableToolApproval && agenticToolDefinitions.toolsToApprove.length
              ? {
                  toolNames: agenticToolDefinitions.toolsToApprove as NonEmptyArray<string>,
                  contract: resolvedServices.toolUseApprovalContract,
                }
              : null;
          const humanInteractionConfig = enableHumanInteraction
            ? {
                contract: resolvedServices.humanInteractionContract,
              }
            : null;
          const llmResult = await otelLLMIntegration(
            llm,
            {
              type,
              messages,
              toolDefinitions: agenticToolDefinitions.toolDef,
              description: contract.metadata.config.description ?? null,
              systemPrompt: systemPrompt ?? null,
              outputFormat: contract.metadata.config.outputFormat ?? null,
              alias: contract.metadata.config.alias ?? null,
              handlerSource: contracts.self.accepts.type,
              maxToolInteractions: maxToolInteractions ?? DEFAULT_AGENT_MAX_TOOL_INTERACTIONS,
              toolApproval: toolApprovalConfig,
              humanInteraction: humanInteractionConfig,
              currentToolInteractionCount: currentIteration,
            },
            parentSpanConfig,
          );

          // If there is a requirement for human interaction/review or tool approval
          // don't emit any tool calls until this is resolved
          const prioritizedContract: AnyVersionedContract[] = [];
          if (humanInteractionConfig) prioritizedContract.push(humanInteractionConfig.contract);
          if (toolApprovalConfig) prioritizedContract.push(toolApprovalConfig.contract);
          return {
            ...llmResult,
            ...prioritizeToolRequests(llmResult.toolRequests ?? [], llmResult.toolTypeCount ?? {}, prioritizedContract),
          };
        };

        let messages: LLMIntegrationParam['messages'] = [];

        if (input) {
          messages = initConversation(input.data, maxToolInteractions ?? DEFAULT_AGENT_MAX_TOOL_INTERACTIONS);
          const { toolRequests, toolTypeCount, response } = await llmIntegration(messages, 'init', 0);
          messages = integrateLLMResponse(messages, response);
          messages = integrateToolRequests(messages, response ? null : toolRequests);
          const _context: AgenticStateContext = {
            currentSubject: input.subject,
            maxToolCallIterationAllowed: maxToolInteractions ?? DEFAULT_AGENT_MAX_TOOL_INTERACTIONS,
            messages,
            toolTypeCount,
            currentToolCallIteration: response ? 0 : 1,
          };
          return {
            context: _context,
            output: response
              ? {
                  messages,
                  output: typeof response === 'string' ? { response } : response,
                }
              : undefined,
            services: response
              ? undefined
              : toolRequests?.map(
                  (item) =>
                    ({
                      id: { deduplication: 'DEVELOPER_MANAGED', value: item.id },
                      type: item.type,
                      data: {
                        ...item.data,
                        parentSubject$$: _context.currentSubject,
                      },
                      domain: resolvedServices.domains[item.type]?.length
                        ? resolvedServices.domains[item.type]
                        : undefined,
                    }) as EnqueueArvoEventActionParam<Record<string, unknown>, string>,
                ),
          };
        }

        if (!context) throw new Error('The context is not properly set. Faulty initialization');

        const expectedToolUseApprovalEventType: string | null =
          resolvedServices.toolUseApprovalContract.emitList[0]?.type ?? null;
        if (expectedToolUseApprovalEventType && service?.type === expectedToolUseApprovalEventType) {
          const evt = service as InferVersionedArvoContract<
            typeof resolvedServices.toolUseApprovalContract
          >['emits']['evt.tool.approval.success'];
          await enableToolApproval?.memory
            ?.setBatched(
              contracts.self.accepts.type,
              Object.fromEntries(evt.data.approvals.map(({ tool, value, comments }) => [tool, { value, comments }])),
              parentSpanConfig,
            )
            .catch((e) => exceptionToSpan(e as Error, span));
        }

        const haveAllEventsBeenCollected = compareCollectedEventCounts(
          context.toolTypeCount,
          Object.fromEntries(
            Object.entries(collectedEvents).map(([key, evts]) => [key, (evts as Array<unknown>).length]),
          ),
        );

        if (!haveAllEventsBeenCollected) {
          return;
        }

        messages = [...context.messages];
        messages = integrateToolResults(messages, metadata?.events?.expected ?? {}, resolvedServices.contracts);
        messages = integrateIterationLimitWarning(
          messages,
          context.currentToolCallIteration,
          context.maxToolCallIterationAllowed,
        );
        const { toolRequests, toolTypeCount, response } = await llmIntegration(
          messages,
          'init',
          context.currentToolCallIteration,
        );
        messages = integrateLLMResponse(messages, response);
        messages = integrateToolRequests(messages, response ? null : toolRequests);
        const _context: AgenticStateContext = {
          ...context,
          messages,
          toolTypeCount,
          currentToolCallIteration: context.currentToolCallIteration + (response ? 0 : 1),
        };
        return {
          context: _context,
          output: response
            ? {
                messages,
                output: typeof response === 'string' ? { response } : response,
              }
            : undefined,
          services: response
            ? undefined
            : toolRequests?.map(
                (item) =>
                  ({
                    id: { deduplication: 'DEVELOPER_MANAGED', value: item.id },
                    type: item.type,
                    data: {
                      ...item.data,
                      parentSubject$$: _context.currentSubject,
                    },
                    domain: resolvedServices.domains[item.type]?.length
                      ? resolvedServices.domains[item.type]
                      : undefined,
                  }) as EnqueueArvoEventActionParam<Record<string, unknown>, string>,
              ),
        };
      },
    },
  });
};
