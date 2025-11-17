import {
  SemanticConventions as OpenInferenceSemanticConventions,
  OpenInferenceSpanKind,
} from '@arizeai/openinference-semantic-conventions';
import { type InferVersionedArvoContract, cleanString, exceptionToSpan, getOtelHeaderFromSpan } from 'arvo-core';
import { createArvoResumable } from 'arvo-event-handler';
import { AgentRunner } from '../AgentRunner/index.js';
import type {
  AgentMessage,
  AgentRunnerExecuteParam,
  AgentToolDefinition,
  AgentToolRequest,
} from '../AgentRunner/types.js';
import type { AnyAgentContract, createAgentContract } from './contract.js';
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
import type z from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// a ArvoOrchestratorContract under the hood.
type ResolveSelfContractType<TContract extends AnyAgentContract> = ReturnType<
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

export const createAgent = <TContract extends AnyAgentContract>({
  contract,
  services,
  toolApproval,
  humanReview,
  llm,
  maxToolInteractions,
  contextBuilder,
  mcp,
  approvalCache,
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

        const engine = new AgentRunner({
          name: contracts.self.accepts.type,
          llm: llm,
          maxToolInteractions: maxToolInteractions,
          contextBuilder:
            contextBuilder ??
            (async (param) => ({
              messages: param.messages,
              systemPrompt: null,
            })),
          mcp: mcp,
          approvalCache: approvalCache,
        });

        const toolFormatter = createAgentToolNameStringFormatter();
        const formatToolDefinition = (tool: AgentToolDefinition) => ({
          ...tool,
          name: toolFormatter.format(tool.name),
        });
        const formatToolRequest = (req: AgentToolRequest) => ({
          ...req,
          type: toolFormatter.reverse(req.type) ?? req.type,
        });

        const serviceAcceptTypeToSchemaMap: Record<string, z.AnyZodObject> = Object.fromEntries(
          Object.values(contracts.services).map((item) => [item.accepts.type, item.accepts.schema]),
        );
        const agentExternalToolCallValidator: NonNullable<AgentRunnerExecuteParam['externalToolValidator']> = (
          toolType,
          data,
          { exhausted },
        ) => {
          if (exhausted) return null;
          const error =
            serviceAcceptTypeToSchemaMap[toolFormatter.reverse(toolType) ?? '']?.safeParse?.({
              ...data,
              parentSubject$$: 'placeholder_subject_for_validation',
            })?.error ?? null;
          if (!error) return null;
          return new Error(
            cleanString(`
              Tool call validation failed. The provided arguments do not match the required schema.
              
              Error: ${error.message}
              
              Required schema: ${
                // biome-ignore lint/style/noNonNullAssertion: This cannot be null
                JSON.stringify(zodToJsonSchema(serviceAcceptTypeToSchemaMap[toolFormatter.reverse(toolType)!]!))
              }
              
              Ensure all arguments data structure strictly conform to the schema specification above.
            `),
          );
        };

        const agentOutputValidator: NonNullable<AgentRunnerExecuteParam['outputValidator']> = (data, { exhausted }) => {
          if (exhausted) return null;
          const error = contracts.self.metadata.config.outputFormat?.safeParse(data).error ?? null;
          if (!error) return null;
          return new Error(
            cleanString(`
              Output data validation failed. The provided data structure do not match the required schema.
              Error: ${error.message}
              Required schema: ${
                // biome-ignore lint/style/noNonNullAssertion: This cannot be null
                JSON.stringify(zodToJsonSchema(contracts.self.metadata.config.outputFormat!))
              }
              Ensure output data structure strictly conform to the schema specification above.
            `),
          );
        };

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
                outputFormat: contracts.self.metadata.config.outputFormat ?? null,
                externalTools: toolDefinitions.services,
                selfInformation: {
                  alias: contracts.self.metadata.config.alias ?? null,
                  source: contracts.self.accepts.type,
                  description: contracts.self.description ?? '',
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
                outputValidator: agentOutputValidator,
                externalToolValidator: agentExternalToolCallValidator,
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
                  contracts.self.metadata.config.enableMessageHistoryInResponse ?? false,
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
              externalTools: toolDefinitions.services,
              toolInteractions: {
                current: context.toolInteractionCount,
              },
              selfInformation: {
                alias: contracts.self.metadata.config.alias ?? null,
                source: contracts.self.accepts.type,
                description: contracts.self.description ?? '',
                agentic_source: toolFormatter.format(contracts.self.accepts.type),
              },
              delegatedBy: context.delegatedBy,
              outputFormat: contracts.self.metadata.config.outputFormat ?? null,
              toolApproval: toolDefinitions.toolApproval,
              humanReview: toolDefinitions.humanReview,
              outputValidator: agentOutputValidator,
              externalToolValidator: agentExternalToolCallValidator,
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
                contracts.self.metadata.config.enableMessageHistoryInResponse ?? false,
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
