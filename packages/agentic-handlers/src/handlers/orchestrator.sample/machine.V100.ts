import { ArvoDomain, setupArvoMachine, xstate } from 'arvo-event-handler';
import { demoOrchestratorContract } from './contract.js';
import { addContract } from '../add.service.js';
import { productContract } from '../product.service.js';
import { humanApprovalContract } from '../human.approval.contract.js';
import type { ArvoErrorType } from 'arvo-core';

export const demoMachineV100 = setupArvoMachine({
  contracts: {
    self: demoOrchestratorContract.version('1.0.0'),
    services: {
      sum: addContract.version('1.0.0'),
      product: productContract.version('1.0.0'),
      approval: humanApprovalContract.version('1.0.0'),
    },
  },
  types: {
    context: {} as {
      currentSubject: string;
      values: number[];
      sum: number | null;
      product: number | null;
      errors: ArvoErrorType[];
    },
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QTAWwPYFkCGBjAFgJYB2YAagIwAMVAdPgK6rbECCADuwE7oBu2AGwDEYXgBd6TFrWyce-AbVgNcuOLADaVALqJQ7dLEJjC6YnpAAPRAA4atGjQDMVAKwUA7K482KAGhAAT1sKWlcAX3CAlAwcAhJyajpGZjY5PkERcUlUmXSFJRU1WE0KXSQQAyMTMwtrBABODwDghAonADYAFlonVwanL0jotCw8IlJKexSWDm4M4VhA2FpcdFQc6Vl5grAuHi4tcv1DY1NzCvq7OkcqF3cvH38gxCcAJidhkBix+Mmk1aCXAMATYGrEIQQMxgJRiMEwn5xCaJey4IEgsHnI4WKpnWqXWz2W73TzeXwtWw2Dq0BpvBodGxDKLfUZIhJTOhogTA0HgmQQCB44i0MCWMDAsRgLISLk8sHoLj8iCFVTqbEVXHguqvLquWhdGxdQauCltKhNfVUDpvCLMxHjdkA2UYvnYAVCkViiVSpYrNYbZ28hVKkX7BXqk7Vc7ahDXByOEmPckvM0uXo2N6+G1fe1-FGc9G8860VAgkzsASENF80XihiS6WA7ku4PzCAqCTKVUlCOVU5agkIJwUPX0xkdVw2xk2BpW00eWc01zD7N21kO-6owuYswlsuECtVnfC2veoS+1brJtysStnjt3ASPYHXua6ODuPEtykp6mgY9Lo6QZJlmWIdAUHgCpc2RDkcX7d9QHqdpTQAWg6HN1zzDlNjSHZBDgqN8UQxBrWpLpgInKcfAaZ5Wk8BpaFXEZYg3fNrxdBC+0Ii5iIQDpaJIkclxXW1mN+GCnW3V13QHSMhRjdobDCEcOnNDwugoN5qAaLpTSSBjZ2tUSWRYrDJObItdzdQUay9eswAI+TBwoKllNcVSmg0rTzV0lMKH80InAzLNjOgx0tws48lQ9KFSEc2SrBIu5ei8KgRyomcBLafyGKCzNNNCzCJIim9i1LARy0ratOLfIjErNBp52S3URIw0zioLSK+XKyqj1sutJXizikO8U07B6WkxyZMS2U3TrSt3HqDyqqLYocjV4Lq+pVKcFLXDSydXGnGixs0mkgMZQr2vCug1qGrbEH8jwPAcJ5XHen9k1aGxDVoDoF2Aq7xJu0MDnunj6qel6qDej6kyypo6DeK1V0iIA */
  id: 'demoMachineV100',
  // Populate the initial context of the state machine
  context: ({ input }) => ({
    currentSubject: input.subject,
    values: input.data.values,
    errors: [],
    sum: null,
    product: null,
  }),
  // The final output data
  output: ({ context }) => {
    if (context.errors.length) {
      return {
        errors: context.errors,
        sum: null,
        product: null,
        success: false,
        result: null,
      };
    }
    return {
      errors: null,
      sum: context.sum,
      product: context.sum,
      success: true,
      result: context.sum,
    };
  },
  // The initial state of the machine
  initial: 'humanApproval',
  // State definitions
  states: {
    humanApproval: {
      entry: xstate.emit({
        type: 'com.human.approval',
        data: {
          prompt: 'Please provide approval for further execution',
        },
        // Automatically inherit the domain from the contract definition
        domain: [ArvoDomain.FROM_EVENT_CONTRACT],
      }),
      on: {
        'evt.human.approval.success': [
          {
            guard: ({ event }) => event.data.approval,
            description: 'Human provides approval',
            target: 'calculation',
          },
          {
            description: 'Human rejects approval',
            actions: xstate.assign({
              errors: ({ context }) => [
                ...context.errors,
                {
                  errorMessage: 'Unable to obtain human approval',
                  errorName: 'NoHumanApproval',
                  errorStack: '',
                },
              ],
            }),
            target: 'error'
          },
        ],
        'sys.com.human.approval.error': {
          actions: xstate.assign({errors: ({context, event}) => [...context.errors, event.data]}),
          target: 'error'
        },
      },
    },
    calculation: {
      type: 'parallel',
      states: {
        addition: {
          initial: 'execute',
          states: {
            execute: {
              entry: xstate.emit(({ context }) => ({
                type: 'com.calculator.add',
                data: {
                  numbers: context.values,
                },
              })),
              on: {
                'evt.calculator.add.success': {
                  actions: xstate.assign({ sum: ({ event }) => event.data.result }),
                  target: 'done',
                },
                'sys.com.calculator.add.error': {
                  actions: xstate.assign({ errors: ({ context, event }) => [...context.errors, event.data] }),
                  // This state address from the root as the internal state chart does not have visibility of the full
                  // state chart
                  target: '#demoMachineV100.error',
                },
              },
            },
            done: {
              type: 'final',
            },
          },
        },
        multiplication: {
          initial: 'execute',
          states: {
            execute: {
              entry: xstate.emit(({ context }) => ({
                type: 'com.calculator.product',
                data: {
                  numbers: context.values,
                },
              })),
              on: {
                'evt.calculator.product.success': {
                  actions: xstate.assign({ product: ({ event }) => event.data.result }),
                  target: 'done',
                },
                'sys.com.calculator.product.error': {
                  actions: xstate.assign({ errors: ({ context, event }) => [...context.errors, event.data] }),
                  target: '#demoMachineV100.error',
                },
              },
            },
            done: {
              type: 'final',
            },
          },
        },
      },
      onDone: {
        target: 'done',
      },
    },
    done: {
      type: 'final',
    },
    error: {
      type: 'final',
    },
  },
});
