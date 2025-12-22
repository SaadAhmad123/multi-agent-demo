import {
  ArvoErrorSchema,
  ArvoErrorType,
  createArvoOrchestratorContract,
} from 'arvo-core';
import {
  createArvoOrchestrator,
  EventHandlerFactory,
  IMachineMemory,
  setupArvoMachine,
  xstate,
} from 'arvo-event-handler';
import z from 'zod';
import { addContract } from './add.service.ts';
import { productContract } from './product.service.ts';

// Workflow and orchestrators in Arvo are event handlers which
// emit event mid process to coordinate the workflows. Their execution
// is initiated via the init event, during the lifecycle of the
// worflow they can emit many events to different services and
// get triggered by the response events and at the end of the workflow
// they emit the complete event as the workflow output.
export const averageWorkflowContract = createArvoOrchestratorContract({
  uri: '#/org/amas/calculator/average',
  name: 'workflow.average',
  versions: {
    '1.0.0': {
      // The init schema defines the orchestrator's initial event
      init: z.object({
        numbers: z.number().array().min(2),
      }),
      // The complete schema defines the orchestrator's final event
      complete: z.object({
        success: z.boolean(),
        average: z.number().nullable(),
        errors: ArvoErrorSchema.array().nullable(),
      }),
    },
  },
});

// The ArvoMachine is integrated with the xstate
// ecosystem. This means that you can visulise the
// state machine using the xstate visualiser in your
// IDE
const machineV100 = setupArvoMachine({
  // Declare the exhaustive interface of the state machine
  // which defines the workflow
  contracts: {
    // Declare the contract for the workflow itself
    self: averageWorkflowContract.version('1.0.0'),
    // Declare the contracts of the services this workflow
    // will invoke during the lifecycle. The worflow does not
    // invoke these services directly. Rather, it emits the
    // events which may eventually invoke the service
    services: {
      add: addContract.version('1.0.0'),
      product: productContract.version('1.0.0'),
    },
  },
  types: {
    context: {} as {
      numbers: number[];
      sum: number | null;
      average: number | null;
      errors: ArvoErrorType[];
    },
  },
}).createMachine({
  id: 'machine', // Keep it like this. It is just an ID
  // Hydrate the machine context from the init event.
  // The context is the JSON object which store the
  // workflow relevant data and preserves it durably
  // across the start-stop executions.
  context: ({ input }) => ({
    numbers: input.data.numbers,
    sum: null,
    average: null,
    errors: [],
  }),
  output: ({ context }) => ({
    average: context.average,
    errors: context.errors.length ? context.errors : null,
    success: !context.errors.length,
  }),
  initial: 'add',
  states: {
    add: {
      // This xstate function registers an
      // event to be emitted to the ArvoOrchestrator.
      // When the machine execution reaches a stable state
      // i.e. when all the transitions for the execution
      // have been carried out. The orchestrator execution engine
      // collects all these events from be emitted and emits
      // them together. The orchestrator triggers again when
      // a response event arrives and performs the next state
      // transition. This process goes on until the state machine
      // reaches the terminal state
      entry: xstate.emit(({ context }) => ({
        type: 'com.calculator.add',
        data: {
          numbers: context.numbers,
        },
      })),
      on: {
        // This declares that when the event of type (event.type) evt.calculator.add.success
        // arrives then perform this state transition
        'evt.calculator.add.success': {
          target: 'divide',
          actions: xstate.assign({ sum: ({ event }) => event.data.result }),
        },
        'sys.com.calculator.add.error': {
          target: 'error',
          actions: xstate.assign({
            errors: ({ event, context }) => [...context.errors, event.data],
          }),
        },
      },
    },
    divide: {
      entry: xstate.emit(({ context }) => ({
        type: 'com.calculator.product',
        data: {
          numbers: [context.sum ?? 0, 1 / (context.numbers.length)],
        },
      })),
      on: {
        'evt.calculator.product.success': {
          target: 'done',
          actions: xstate.assign({ average: ({ event }) => event.data.result }),
        },
        'sys.com.calculator.product.error': {
          target: 'error',
          actions: xstate.assign({
            errors: ({ event, context }) => [...context.errors, event.data],
          }),
        },
      },
    },
    done: {
      // A final state marks the termianl state of the
      // state chart and triggers the output event creation
      type: 'final',
    },
    error: {
      type: 'final',
    },
  },
});

// The ArvoOrchestrator provides a event-driven, distributed system compliant
// and durable execution runtime for the state machine declartion. When the
// orchestrator emits the events it store a minimal state (in JSON) object to
// logically resume the workflow when the next event arrives. Between events,
// the orchestrator releases all compute resources and leaves this effective state
// in the memory backend. The memory backend can be any technology as long
// as it implements the interface IMachineMemory there is more information
// about it in the '/machine-memroy' documentation. In summary, the machine memory
// backend in Arvo needs to be an optimistically lockable key value pair where
// the key is init event subject and the value is the state. This same prinicpal
// works for the ArvoResumable.
// The memory backend is provided as a dependency injection so that the exeuction
// layer can decide whiuch backedn to use.
export const averageWorkflow: EventHandlerFactory<
  { memory: IMachineMemory }
> = ({ memory }) =>
  createArvoOrchestrator({
    machines: [machineV100],
    memory,
  });
