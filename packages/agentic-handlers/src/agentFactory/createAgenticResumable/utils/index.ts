import { VersionedArvoContract } from 'arvo-core';
import type { AnyVersionedContract, NonEmptyArray } from '../../types.js';
import type { CreateAgenticResumableParams } from '../types.js';

export const resolveServiceConfig = (services: NonNullable<CreateAgenticResumableParams['services']> | null) => {
  const resolvedServiceContracts: Record<string, AnyVersionedContract> = {};
  const resolvedServiceDomains: Record<string, NonEmptyArray<string>> = {};
  const resolvedServiceRequiringApproval: Record<string, { cache: boolean }> = {};

  for (const value of Object.values(services ?? {})) {
    if (value instanceof VersionedArvoContract) {
      resolvedServiceContracts[value.accepts.type] = value;
    } else {
      const key = value.contract.accepts.type;
      resolvedServiceContracts[key] = value.contract;
      resolvedServiceDomains[key] = value.domains;
      if (value.approval) {
        resolvedServiceRequiringApproval[key] = {
          cache: typeof value.approval === 'boolean' ? false : value.approval.cache,
        };
      }
    }
  }

  return {
    contracts: resolvedServiceContracts,
    domains: resolvedServiceDomains,
    approval: resolvedServiceRequiringApproval,
  };
};

// /**
//  * [Utility] Compares expected event counts with actual collected event counts.
//  *
//  * Used to determine if all expected service responses have been received
//  * before proceeding with the next step in the agentic workflow.
//  */
// export const compareCollectedEventCounts = (target: Record<string, number>, current: Record<string, number>) => {
//   const sumTarget = Object.values(target).reduce((acc, cur) => acc + cur, 0);
//   const sumCurrent = Object.values(current).reduce((acc, cur) => acc + cur, 0);
//   return sumCurrent === sumTarget;
// };

// export const handlerConfigResolver = <TName extends string, TOutput extends z.AnyZodObject = z.AnyZodObject>(
//   handlerRegistrationTimeExtensions: {
//     services?: CreateAgenticResumableParams<TName, TOutput>['services'];
//     serviceDomains?: CreateAgenticResumableParams<TName, TOutput>['serviceDomains'];
//     servicesRequireApproval?: string[];
//   },
//   factoryDefinitionTimeParam: CreateAgenticResumableParams<TName, TOutput>,
// ) => {
//   const hrContract = humanInteractionContract.version('1.0.0');
//   const tuaContract = toolUseApprovalContract.version('1.0.0');
//   const handlerServices: Record<string, AnyVersionedContract> = {};

//   for (const serviceContract of [
//     ...Object.values(handlerRegistrationTimeExtensions.services ?? {}),
//     ...Object.values(factoryDefinitionTimeParam.services ?? {}),
//   ]) {
//     if (!handlerServices[serviceContract.dataschema]) {
//       handlerServices[serviceContract.dataschema] = serviceContract;
//     }
//   }

//   const handlerToolUseApproval = !factoryDefinitionTimeParam.toolUseApproval
//     ? undefined
//     : {
//         ...factoryDefinitionTimeParam.toolUseApproval,
//         tools: [
//           ...factoryDefinitionTimeParam.toolUseApproval.tools,
//           ...(handlerRegistrationTimeExtensions.servicesRequireApproval ?? []),
//         ].filter((item) => !([hrContract.accepts.type, tuaContract.accepts.type] as string[]).includes(item)),
//       };

//   const handlerServiceDomains: Record<string, string[]> = factoryDefinitionTimeParam.serviceDomains ?? {};

//   for (const [key, value] of Object.entries(handlerRegistrationTimeExtensions.serviceDomains ?? {})) {
//     if (handlerServiceDomains[key]) {
//       handlerServiceDomains[key] = Array.from(new Set([...handlerServiceDomains[key], ...value]));
//     } else {
//       handlerServiceDomains[key] = value;
//     }
//   }

//   // For human and tool use approval events, the domains defined by the repective configurations are prioratised
//   if (factoryDefinitionTimeParam.humanInteraction) {
//     handlerServices[hrContract.dataschema] = hrContract;
//     handlerServiceDomains[humanInteractionContract.type] = factoryDefinitionTimeParam.humanInteraction.domain;
//   }
//   if (handlerToolUseApproval) {
//     handlerServices[tuaContract.dataschema] = tuaContract;
//     handlerServiceDomains[toolUseApprovalContract.type] = handlerToolUseApproval.domain;
//   }

//   return {
//     services: handlerServices,
//     serviceDomains: handlerServiceDomains,
//     humanInteractionContract: hrContract,
//     toolUseApprovalContract: tuaContract,
//     toolUseApproval: handlerToolUseApproval,
//   };
// };

// /**
//  * Converts Arvo service contracts to LLM-compatible tool definitions.
//  */
// export const createAgentToolDefinitions = async <TName extends string, TOutput extends z.AnyZodObject = z.AnyZodObject>(
//   param: {
//     handlerSource: string;
//     services?: CreateAgenticResumableParams<TName, TOutput>['services'];
//     toolUseApproval?: CreateAgenticResumableParams<TName, TOutput>['toolUseApproval'];
//     toolUseApprovalMemory?: IToolUseApprovalMemory;
//   },
//   otel: {
//     parentSpan: Span;
//     parentOtelHeaders: OpenTelemetryHeaders;
//   },
// ) => {
//   let toolApprovalMap: Awaited<ReturnType<IToolUseApprovalMemory['getBatched']>> = {};

//   if (param.toolUseApproval?.tools.length && param.toolUseApprovalMemory) {
//     const toolNameFormatter = createAgentToolNameStringFormatter();
//     const toolNames: string[] = [];
//     for (const item of Object.values(param.services ?? {})) {
//       toolNames.push(item.accepts.type);
//       // This takes care of the fact that the tool name registered
//       // by the Agent may be in Agent Compliant Format
//       toolNames.push(toolNameFormatter.format(item.accepts.type));
//     }
//     toolApprovalMap = (await param.toolUseApprovalMemory?.getBatched(param.handlerSource, toolNames, otel)) ?? {};
//     // Reverse the toolname from agent format to original to create a correct approval look up
//     for (const item of toolNames) {
//       if (!toolApprovalMap[item]) continue;
//       toolApprovalMap[toolNameFormatter.reverse(item) ?? item] = toolApprovalMap[item];
//     }
//   }

//   const toolsWhichRequireApproval: string[] = [];
//   const toolDef: AgenticToolDefinition[] = [];

//   for (const item of Object.values(param.services ?? {})) {
//     const inputSchema = item.toJsonSchema().accepts.schema;
//     // @ts-ignore - The 'properties' field exists in there but is not pick up by typescript compiler
//     const { toolUseId$$, parentSubject$$, ...cleanedProperties } = inputSchema?.properties ?? {};
//     // @ts-ignore - The 'required' field exists in there but is not pick up by typescript compiler
//     const cleanedRequired = (inputSchema?.required ?? []).filter(
//       (item: string) => item !== 'toolUseId$$' && item !== 'parentSubject$$',
//     );
//     // Cleaning the description so that approval requirement is set explicitly by the configuration
//     let finalDescription = item.description.replaceAll('[[REQUIRE APPROVAL]]', '');
//     if (param.toolUseApproval?.tools.includes(item.accepts.type) && !toolApprovalMap[item.accepts.type]?.value) {
//       finalDescription = `[[REQUIRE APPROVAL]]. ${finalDescription}`;
//       toolsWhichRequireApproval.push(item.accepts.type);
//     }
//     toolDef.push({
//       name: item.accepts.type,
//       description: finalDescription,
//       input_schema: {
//         ...inputSchema,
//         properties: cleanedProperties,
//         required: cleanedRequired,
//       },
//     });
//   }

//   return { toolDef, toolsWhichRequireApproval };
// };
