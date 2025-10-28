import { type ArvoEvent, type InferArvoEvent, VersionedArvoContract } from 'arvo-core';
import type { AgentContract } from './contract.js';
import type { CreateAgentParam, AnyVersionedContract } from './types.js';
import type { AgentMessage, AgentToolDefinition, AgentToolRequest } from '../AgentRunner/types.js';
import { v4 as uuid4 } from 'uuid';
import type { EnqueueArvoEventActionParam } from 'arvo-event-handler';

export const createToolDefinition = (
  contract: NonNullable<CreateAgentParam<AgentContract>['services']>[string],
  priority?: number,
): AgentToolDefinition & { domains?: string[] } => {
  const resolvedContract =
    contract instanceof VersionedArvoContract
      ? {
          contract,
          domains: undefined,
          approval: undefined,
        }
      : contract;

  const inputSchema = resolvedContract.contract.toJsonSchema().accepts.schema;
  // @ts-ignore - The 'properties' field exists in there but is not pick up by typescript compiler
  const { parentSubject$$, ...cleanedProperties } = inputSchema?.properties ?? {};
  // @ts-ignore - The 'required' field exists in there but is not pick up by typescript compiler
  const cleanedRequired = (inputSchema?.required ?? []).filter((item: string) => item !== 'parentSubject$$');

  return {
    name: resolvedContract.contract.accepts.type,
    description: resolvedContract.contract.description ?? 'No description available',
    input_schema: {
      ...inputSchema,
      properties: cleanedProperties,
      required: cleanedRequired,
    },
    requires_approval: resolvedContract.approval,
    priority,
    domains: resolvedContract.domains,
  };
};

export const resolveServiceToolDefinition = (
  {
    services,
    toolApproval,
    humanReview,
  }: Pick<CreateAgentParam<AgentContract>, 'services' | 'toolApproval' | 'humanReview'>,
  config: {
    toolApprovalContract: AnyVersionedContract;
    humanReviewContract: AnyVersionedContract;
  },
) => {
  const resolvedServices: Record<string, AnyVersionedContract> = {};
  const serviceDomainMap: Record<string, string[]> = {};
  const toolDefinitions = {
    services: [] as AgentToolDefinition[],
    toolApproval: null as AgentToolDefinition | null,
    humanReview: null as AgentToolDefinition | null,
  };
  const toolApprovalKey = uuid4();
  const humanReviewKey = uuid4();
  const servicePriority = {
    [humanReviewKey]: 2,
    [toolApprovalKey]: 1,
  };
  for (const [key, service] of Object.entries({
    ...(services ?? {}),
    ...(toolApproval ? { [toolApprovalKey]: { ...toolApproval, contract: config.toolApprovalContract } } : {}),
    ...(humanReview ? { [humanReviewKey]: { ...humanReview, contract: config.humanReviewContract } } : {}),
  })) {
    resolvedServices[key] = service instanceof VersionedArvoContract ? service : service.contract;
    const { domains, ...toolDef } = createToolDefinition(service, servicePriority[key]);
    toolDefinitions.services.push(toolDef);
    if (key === toolApprovalKey) {
      toolDefinitions.toolApproval = toolDef;
    }
    if (key === humanReviewKey) {
      toolDefinitions.humanReview = toolDef;
    }
    serviceDomainMap[toolDef.name] = [...(serviceDomainMap[toolDef.name] ?? []), ...(domains ?? [])];
  }

  return {
    serviceDomainMap,
    toolDefinitions,
    resolvedServices,
  };
};

/** Calculates tool type counts from tool requests. */
export const calculateToolTypeCounts = (toolRequests: AgentToolRequest[] | null): Record<string, number> => {
  if (!toolRequests) return {};

  return toolRequests.reduce(
    (acc, req) => {
      acc[req.type] = (acc[req.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
};

/** Converts tool requests to service enqueue parameters. */
export const toolRequestsToServices = (
  toolRequests: AgentToolRequest[],
  currentSubject: string,
  domainMap: Record<string, string[]>,
): EnqueueArvoEventActionParam<Record<string, unknown>, string>[] => {
  return toolRequests.map((req) => ({
    id: { deduplication: 'DEVELOPER_MANAGED', value: req.id },
    type: req.type,
    data: {
      ...req.data,
      parentSubject$$: currentSubject,
    },
    domain: domainMap[req.type]?.length ? domainMap[req.type] : undefined,
  }));
};

/** Creates the output response format. */
export const createOutput = (response: string | object, messages: AgentMessage[], enableMessageHistory: boolean) => {
  return {
    ...(enableMessageHistory ? { messages } : {}),
    output: typeof response === 'string' ? { response } : response,
  };
};

/** Extracts tool results from collected event metadata. */
export const extractToolResults = (
  eventMap: Record<string, InferArvoEvent<ArvoEvent>[]>,
): Array<{ id: string; data: string }> => {
  return Object.entries(eventMap).flatMap(([_, eventList]) => {
    return eventList.map((evt) => ({
      id: evt.parentid ?? evt.id,
      data: JSON.stringify(evt.data),
    }));
  });
};

/** Compares expected event counts with actual collected event counts. */
export const compareCollectedEventCounts = (
  target: Record<string, number>,
  current: Record<string, number>,
): boolean => {
  const sumTarget = Object.values(target).reduce((acc, cur) => acc + cur, 0);
  const sumCurrent = Object.values(current).reduce((acc, cur) => acc + cur, 0);
  return sumCurrent === sumTarget;
};
