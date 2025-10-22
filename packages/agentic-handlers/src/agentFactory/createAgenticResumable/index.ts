import type { AgenticStateContext, CreateAgenticResumableParams } from './types.js';
import type { AgenticResumableContract } from './contract.js';
import { resolveServiceConfig } from './utils/index.js';
import { createArvoResumable, type IMachineMemory } from 'arvo-event-handler';
import { type ArvoOrchestratorContract } from 'arvo-core';

export const createAgenticResumable = <TContract extends AgenticResumableContract>({
  contract,
  llm,
  memory,
  services,
  systemPrompt,
  maxToolInteractions,
  enableHumanInteraction,
  enableToolApproval,
}: CreateAgenticResumableParams<TContract>) => {
  const resolvedServices = resolveServiceConfig(services ?? null);
  return createArvoResumable({
    contracts: {
      self: contract as ArvoOrchestratorContract,
      services: resolvedServices.contracts,
    },
    types: {
      context: {} as AgenticStateContext,
    },
    executionunits: 0,
    memory: memory as IMachineMemory<Record<string, unknown>>,
    handler: {
      '1.0.0': async () => {},
    },
  });
};
