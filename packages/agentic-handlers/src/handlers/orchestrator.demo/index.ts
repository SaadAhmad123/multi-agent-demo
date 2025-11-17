import {
  createArvoOrchestrator,
  type EventHandlerFactory,
  type IMachineMemory,
  type MachineMemoryRecord,
} from 'arvo-event-handler';
import { demoMachineV100 } from './machine.V100.js';

export const demoOrchestrator: EventHandlerFactory<{ memory: IMachineMemory<Record<string, unknown>> }> = ({
  memory,
}) =>
  createArvoOrchestrator({
    memory: memory as IMachineMemory<MachineMemoryRecord>,
    executionunits: 0,
    machines: [demoMachineV100],
  });
