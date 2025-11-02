import {
  SemanticConventions as OpenInferenceSemanticConventions,
  OpenInferenceSpanKind,
} from '@arizeai/openinference-semantic-conventions';
import { type InferVersionedArvoContract, exceptionToSpan, getOtelHeaderFromSpan } from 'arvo-core';
import { createArvoResumable } from 'arvo-event-handler';
import type { AgentMessage, AgentToolDefinition, AgentToolRequest } from '../AgentRunner/types.js';
import type { AgentContract, createAgentContract } from './contract.js';
import { humanReviewContract } from './contracts/humanReview.js';
import { toolApprovalContract } from './contracts/toolApproval.js';
import { createAgentToolNameStringFormatter } from './formatter.js';
import type { CreateAgentParam } from './types.js';
import {
  calculateToolTypeCounts,
  compareCollectedEventCounts,
  createOutput,
  extractToolResults,
  resolveServiceToolDefinition,
  toolRequestsToServices,
} from './utils.js';

// a ArvoOrchestratorContract under the hood.
type ResolveSelfContractType<TContract extends AgentContract> = ReturnType<
  typeof createAgentContract<
    TContract['metadata']['config']['uri'],
    TContract['metadata']['config']['name'],
    TContract['metadata']['config']['output']
  >
>;

type AgentContext = {
  currentSubject: string;
  messages: AgentMessage[];
  toolInteractionCount: number;
  maxToolInteractionCount: number;
  toolTypeCount: Record<string, number>;
  delegatedBy: {
    alias: string | null;
    source: string;
  } | null;
};

export const createAgent = <TContract extends AgentContract>({
  contract,
  services,
  toolApproval,
  humanReview,
  engine,
  memory,
  streamListener,
}: CreateAgentParam<TContract>) => {
  const toolApprovalVersionedContract = toolApprovalContract.version('1.0.0');
  const humanReviewVersionedContract = humanReviewContract.version('1.0.0');
  const resolvedParams = resolveServiceToolDefinition(
    {
      services,
      toolApproval,
      humanReview,
    },
    { humanReviewContract: humanReviewVersionedContract, toolApprovalContract: toolApprovalVersionedContract },
  );
  return createArvoResumable({
    contracts: {
      self: contract as ResolveSelfContractType<TContract>,
      services: resolvedParams.resolvedServices,
    },
    memory,
    executionunits: 0,
    types: {
      context: {} as AgentContext,
    },
    handler: {
      '1.0.0': async ({ span, contracts, input, context, service, collectedEvents, metadata }) => {
        span.setAttribute(OpenInferenceSemanticConventions.OPENINFERENCE_SPAN_KIND, OpenInferenceSpanKind.AGENT);

        const toolFormatter = createAgentToolNameStringFormatter();
        const formatToolDefinition = (tool: AgentToolDefinition) => ({
          ...tool,
          name: toolFormatter.format(tool.name),
        });
        const formatToolRequest = (req: AgentToolRequest) => ({
          ...req,
          type: toolFormatter.reverse(req.type) ?? req.type,
        });

        const toolDefinitions = {
          services: resolvedParams.toolDefinitions.services.map(formatToolDefinition),
          toolApproval: resolvedParams.toolDefinitions.toolApproval
            ? formatToolDefinition(resolvedParams.toolDefinitions.toolApproval)
            : null,
          humanReview: resolvedParams.toolDefinitions.humanReview
            ? formatToolDefinition(resolvedParams.toolDefinitions.humanReview)
            : null,
        };

        const parentSpanConfig = {
          span,
          headers: getOtelHeaderFromSpan(span),
        };

        if (input) {
          const result = await engine
            .init(
              {
                stream: streamListener
                  ? async (event) => {
                      // biome-ignore lint/style/noNonNullAssertion: Pretty sure that this will not be null
                      await streamListener!({
                        ...event,
                        subject: input.subject,
                      });
                    }
                  : null,
                message: input.data.message,
                outputFormat: contract.metadata.config.outputFormat ?? null,
                tools: toolDefinitions.services,
                selfInformation: {
                  alias: contract.metadata.config.alias ?? null,
                  source: contracts.self.accepts.type,
                  description: contract.description ?? '',
                  agentic_source: toolFormatter.format(contracts.self.accepts.type),
                },
                delegatedBy: input.data.delagationSource
                  ? {
                      alias: input.data.delagationSource.alias ?? null,
                      source: input.data.delagationSource.id,
                    }
                  : null,
                toolApproval: toolDefinitions.toolApproval,
                humanReview: toolDefinitions.humanReview,
              },
              parentSpanConfig,
            )
            .then((data) => ({
              ...data,
              toolRequests: data.toolRequests?.map(formatToolRequest) ?? null,
            }));

          const agentContext: AgentContext = {
            currentSubject: input.subject,
            messages: result.messages,
            toolInteractionCount: result.toolInteractions.current,
            toolTypeCount: calculateToolTypeCounts(result.toolRequests),
            maxToolInteractionCount: result.toolInteractions.max,
            delegatedBy: input.data.delagationSource
              ? {
                  alias: input.data.delagationSource.alias ?? null,
                  source: input.data.delagationSource.id,
                }
              : null,
          };

          return {
            context: agentContext,
            output: result.response
              ? createOutput(
                  result.response,
                  result.messages,
                  contract.metadata.config.enableMessageHistoryInResponse ?? false,
                )
              : undefined,
            services: result.toolRequests
              ? toolRequestsToServices(
                  result.toolRequests,
                  agentContext.currentSubject,
                  resolvedParams.serviceDomainMap,
                )
              : undefined,
          };
        }

        if (!context) {
          throw new Error('Context is not properly set. Faulty initialization');
        }

        const expectedToolUseApprovalEventType: string | null = toolApprovalVersionedContract.emitList[0]?.type ?? null;
        if (expectedToolUseApprovalEventType && service?.type === expectedToolUseApprovalEventType) {
          const evt = service as InferVersionedArvoContract<
            typeof toolApprovalVersionedContract
          >['emits']['evt.tool.approval.success'];
          await engine.approvalCache
            ?.setBatched(
              contracts.self.accepts.type,
              Object.fromEntries(evt.data.approvals.map(({ tool, value }) => [tool, value])),
              parentSpanConfig,
            )
            .catch((e) => exceptionToSpan(e as Error, span));
        }

        const currentEventCounts = Object.fromEntries(
          Object.entries(collectedEvents).map(([key, evts]) => [key, (evts as Array<unknown>).length]),
        );

        if (!compareCollectedEventCounts(context.toolTypeCount, currentEventCounts)) {
          return;
        }

        const toolResults = extractToolResults(metadata?.events?.expected ?? {});
        const result = await engine
          .resume(
            {
              stream: streamListener
                ? async (event) => {
                    // biome-ignore lint/style/noNonNullAssertion: Pretty sure that this will not be null
                    await streamListener!({
                      ...event,
                      subject: context.currentSubject,
                    });
                  }
                : null,
              messages: context.messages,
              toolResults,
              tools: toolDefinitions.services,
              toolInteractions: {
                current: context.toolInteractionCount,
              },
              selfInformation: {
                alias: contract.metadata.config.alias ?? null,
                source: contracts.self.accepts.type,
                description: contract.description ?? '',
                agentic_source: toolFormatter.format(contracts.self.accepts.type),
              },
              delegatedBy: context.delegatedBy,
              outputFormat: contract.metadata.config.outputFormat ?? null,
              toolApproval: toolDefinitions.toolApproval,
              humanReview: toolDefinitions.humanReview,
            },
            parentSpanConfig,
          )
          .then((data) => ({
            ...data,
            toolRequests: data.toolRequests?.map(formatToolRequest) ?? null,
          }));

        const agentContext: AgentContext = {
          ...context,
          messages: result.messages,
          toolInteractionCount: result.toolInteractions.current,
          toolTypeCount: calculateToolTypeCounts(result.toolRequests),
        };

        return {
          context: agentContext,
          output: result.response
            ? createOutput(
                result.response,
                result.messages,
                contract.metadata.config.enableMessageHistoryInResponse ?? false,
              )
            : undefined,
          services: result.toolRequests
            ? toolRequestsToServices(result.toolRequests, agentContext.currentSubject, resolvedParams.serviceDomainMap)
            : undefined,
        };
      },
    },
  });
};
