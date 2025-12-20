import {
  createArvoOrchestrator,
  EventHandlerFactory,
  IMachineMemory,
  MachineMemoryRecord,
} from 'arvo-event-handler';
import { machineV100 } from './machineV100.ts';

export const essayBuilderWorkflow: EventHandlerFactory<
  { memory: IMachineMemory<Record<string, unknown>> }
> = ({ memory }) =>
  createArvoOrchestrator({
    // Type casting because the orchestrator interface requires a stricter type to satisfy typescript compiler
    memory: memory as IMachineMemory<MachineMemoryRecord>,
    executionunits: 1,
    machines: [
      machineV100,
    ],
  });
