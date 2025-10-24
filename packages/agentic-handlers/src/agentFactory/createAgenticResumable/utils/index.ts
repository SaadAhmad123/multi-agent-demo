import { type OpenTelemetryHeaders, VersionedArvoContract } from 'arvo-core';
import type {
  AgenticToolDefinition,
  AnyVersionedContract,
  IToolUseApprovalMemory,
  LLMIntegrationOutput,
  NonEmptyArray,
} from '../types.js';
import type { CreateAgenticResumableParams } from '../types.js';
import type z from 'zod';
import type { Span } from '@opentelemetry/api';
import { toolUseApprovalContract } from '../contracts/toolUseApproval.js';
import { humanInteractionContract } from '../contracts/humanInteraction.js';
import { v4 as uuid4 } from 'uuid';
import { StringFormatter } from './StringFormatter.js';

/**
 * Create a string formatter which can convert tool names to an agent compliant format
 */
export const createAgentToolNameStringFormatter = () => new StringFormatter((str) => str.replaceAll('.', '_'));

export const resolveServiceConfig = (
  _services: NonNullable<CreateAgenticResumableParams['services']> | null,
  enableToolApproval: NonNullable<CreateAgenticResumableParams['enableToolApproval']> | null,
  enableHumanInteraction: NonNullable<CreateAgenticResumableParams['enableHumanInteraction']> | null,
) => {
  const tuac = toolUseApprovalContract.version('1.0.0');
  const hic = humanInteractionContract.version('1.0.0');
  const services = _services ?? {};
  if (enableToolApproval) {
    services[uuid4()] = {
      contract: tuac,
      domains: enableToolApproval.domains,
    };
  }
  if (enableHumanInteraction) {
    services[uuid4()] = {
      contract: hic,
      domains: enableHumanInteraction.domains,
    };
  }
  const resolvedServiceContracts: Record<string, AnyVersionedContract> = {};
  const resolvedServiceDomains: Record<string, NonEmptyArray<string>> = {};
  const resolvedServiceRequiringApproval: Record<string, { cache: boolean }> = {};
  for (const value of Object.values(services)) {
    if (value instanceof VersionedArvoContract) {
      resolvedServiceContracts[value.accepts.type] = value;
    } else {
      const key = value.contract.accepts.type;
      resolvedServiceContracts[key] = value.contract;
      if (value.domains?.length) {
        resolvedServiceDomains[key] = value.domains;
      }
      if (value.approval) {
        resolvedServiceRequiringApproval[key] = {
          cache: typeof value.approval === 'boolean' ? false : value.approval.cache,
        };
      }
    }
  }

  if (!Object.keys(resolvedServiceRequiringApproval).length && resolvedServiceContracts[tuac.accepts.type]) {
    delete resolvedServiceContracts[tuac.accepts.type];
  }

  return {
    contracts: resolvedServiceContracts,
    domains: resolvedServiceDomains,
    approval: resolvedServiceRequiringApproval,
    toolUseApprovalContract: tuac,
    humanInteractionContract: hic,
  };
};

/**
 * Compares expected event counts with actual collected event counts.
 *
 * Used to determine if all expected service responses have been received
 * before proceeding with the next step in the agentic workflow.
 */
export const compareCollectedEventCounts = (target: Record<string, number>, current: Record<string, number>) => {
  const sumTarget = Object.values(target).reduce((acc, cur) => acc + cur, 0);
  const sumCurrent = Object.values(current).reduce((acc, cur) => acc + cur, 0);
  return sumCurrent === sumTarget;
};

/**
 * Converts Arvo service contracts to LLM-compatible tool definitions.
 */
/**
 * Converts Arvo service contracts to LLM-compatible tool definitions.
 */
export const createAgentToolDefinitions = async <TName extends string, TOutput extends z.AnyZodObject = z.AnyZodObject>(
  param: {
    handlerSource: string;
    resolvedServiceConfig: ReturnType<typeof resolveServiceConfig>;
    toolUseApprovalMemory: NonNullable<
      NonNullable<CreateAgenticResumableParams['enableToolApproval']>['memory']
    > | null;
  },
  otel: {
    parentSpan: Span;
    parentOtelHeaders: OpenTelemetryHeaders;
  },
) => {
  const toolWithCacheApprovals = new Set<string>();
  const toolWhichRequireApprovals = new Set<string>();

  // Use the approval configuration from resolvedServiceConfig
  for (const [contractType, approvalConfig] of Object.entries(param.resolvedServiceConfig.approval)) {
    toolWhichRequireApprovals.add(contractType);
    if (approvalConfig.cache) {
      toolWithCacheApprovals.add(contractType);
    }
  }

  let toolApprovalMap: Awaited<ReturnType<IToolUseApprovalMemory['getBatched']>> = {};

  if (toolWithCacheApprovals.size && param.toolUseApprovalMemory) {
    toolApprovalMap =
      (await param.toolUseApprovalMemory.getBatched(param.handlerSource, Array.from(toolWithCacheApprovals), otel)) ??
      {};
  }

  for (const item of toolWhichRequireApprovals.values()) {
    if (toolApprovalMap[item]) continue;
    toolApprovalMap[item] = { value: true };
  }

  const toolsWithPendingApproval: string[] = [];
  const toolDef: AgenticToolDefinition[] = [];

  // Iterate through the resolved contracts
  for (const contract of Object.values(param.resolvedServiceConfig.contracts)) {
    const inputSchema = contract.toJsonSchema().accepts.schema;
    // @ts-ignore - The 'properties' field exists in there but is not pick up by typescript compiler
    const { parentSubject$$, ...cleanedProperties } = inputSchema?.properties ?? {};
    // @ts-ignore - The 'required' field exists in there but is not pick up by typescript compiler
    const cleanedRequired = (inputSchema?.required ?? []).filter((item: string) => item !== 'parentSubject$$');

    // Cleaning the description so that approval requirement is set explicitly by the configuration
    let finalDescription = contract.description.replaceAll('[[REQUIRE APPROVAL]]', '');
    if (toolApprovalMap[contract.accepts.type]?.value) {
      finalDescription = `[[REQUIRE APPROVAL]]. ${finalDescription}`;
      toolsWithPendingApproval.push(contract.accepts.type);
    }

    toolDef.push({
      name: contract.accepts.type,
      description: finalDescription,
      input_schema: {
        ...inputSchema,
        properties: cleanedProperties,
        required: cleanedRequired,
      },
    });
  }

  return { toolDef, toolsToApprove: toolsWithPendingApproval };
};

/**
 * Prioritizes tool requests from a list of tool requests and recalculates their type counts.
 *
 * This function filters tool requests to prioritize contracts based on their order
 * in the provided array. When a matching contract is found, it returns only those filtered requests
 * along with a recalculated count of tool types. The prioritization is sensitive to the sequence of
 * contracts - the first matching contract type found will determine which tool requests are returned.
 */
export const prioritizeToolRequests = (
  toolRequests: NonNullable<LLMIntegrationOutput['toolRequests']>,
  toolTypeCount: NonNullable<LLMIntegrationOutput['toolTypeCount']>,
  prioritizedContracts: AnyVersionedContract[],
) => {
  if (toolRequests.length) {
    for (const contract of prioritizedContracts) {
      const filteredToolRequests = toolRequests.filter((toolRequest) => toolRequest.type === contract.accepts.type);
      if (filteredToolRequests.length) {
        const newToolTypeCount: LLMIntegrationOutput['toolTypeCount'] = {};
        for (const item of filteredToolRequests) {
          newToolTypeCount[item.type] = 1 + (newToolTypeCount[item.type] ?? 0);
        }
        return {
          toolRequests: filteredToolRequests,
          toolTypeCount: newToolTypeCount,
        };
      }
    }
  }
  return {
    toolRequests,
    toolTypeCount,
  };
};
