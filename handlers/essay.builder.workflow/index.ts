import {
  createArvoOrchestrator,
  EventHandlerFactory,
  IMachineMemory,
} from 'arvo-event-handler';
import { machineV100 } from './machineV100.ts';

export const essayBuilderWorkflow: EventHandlerFactory<
  { memory: IMachineMemory }
> = ({ memory }) =>
  createArvoOrchestrator({
    // Type casting because the orchestrator interface requires a stricter type to satisfy typescript compiler
    memory,
    executionunits: 1,
    machines: [
      machineV100,
    ],
  });
