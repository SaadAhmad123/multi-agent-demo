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
  /** @xstate-layout N4IgpgJg5mDOIC5QTAWwPYFkCGBjAFgJYB2YAagIwAMVAdPgK6rbECCADuwE7oBu2AGwDEYXgBd6TFrWyce-AbVgNcuOLADaVALqJQ7dLEJjC6YnpAAPRAFoAzAHYAHLSdOATJ-dUALAE5-AFZAhwAaEABPRD86Jz8ANgpAmioKJ0CPOwBfLPCUDBwCEnJqOkZmNjk+QRFxSQqZKoUlFTVYTQpdJBADIxMzC2sEezs7Wnc-PydqCjs4jPd48KiEH3iXCniQ9yTUu0nAnLy0LDwiUkoaepYObmrhWAjYWlx0VGviRrvmsC4eLi0XX0hmMpnM3SGNni7jGgUmdgyqUSU2WiB8TjGfiSDh2FACdi2fiOIHypyKF1KL0EuAYAmw-WIQggZjASjE9NZpMK5xKV1w1Np9LBgIsvVBAwhiAo7gcPloAVmfgRjji8SWkUQjjlWwoiuCdioTgcauJXLOxUudH5AhpdIZMggEHFnzAljANLEYFqEmttvp6C4DogLVU6hF3TFDMGiAcBNosbx8TmgS2-jsqIQIUC8eNgQJiVmHlNJ25FspvsF9uwjudtFd7oYnqEj2er3eFbtAaDdb+AfDwL6YOjCANLl8E32+xhPgyGecdACgRh8R8-jViWLBXNFL5ArtYNoqFpJnYAkI-Pt9Y9XtEPr3-sDdwgKgkylD7X7PRBUclCAcVAccZNgRHxdTzOYfAzRY-FoOxp11As5jxBxNzJHlLSpG1KwPI8BBPM8LwPK9Gy9FsXjeTC-TELsnxfHt-k-SMh1-AJxgcUofH-Ti4TiDN0UxbFcXxQkclyEBiHQFB4G6M1yV5KhRW-ZjQEheJ2NoOElURTY8ScDMxn2RJOIxOI1iTJVUNLHcyikSpvkERTBwlFTbBTMd1l1Hx3FAgl3ECfSqGzOD0SXOJZRXNTLO3eTKOw5yvyc8EXNWJdxm4tx0lTJUM1YuC7B8KhEmcRxdSiuSMI7IUzCDZ1HNq38lxg407F0uEHGNKh0w1VY3DYrZ2o8QJdSSbIxNk9Dy3vKsa0vN1rzqn9kpCQDmtavx2viTqMwyJq8yoSZhrmdwyom3csP3arqyde1mVIBblKsaJWOhRZfDA0YnEg7q2vjPaDt1I6TrLM6qJw49CFPc8qqShL6qWq5vIcDI3BTQI0wzNIKFcadDVMo0VycIHrNii7Plw-CodmhtPXu+KhjRlxEeRzK0ey7r3AxcZJnW0CAemdaiZiyr7XJiGCOh2hbrAWmYaGSZtU8TbefAz6oKxLnJllQ7+ZQsaS2ijCpZl4cKFXQD-CSPwZXynwWr07qSvlVI8TWJVpniCy9a3crKV+f5jd-Gw0fiDTNpat6tNSDMjToNINqNU2KBxUaciAA */
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
      product: context.product,
      success: true,
      result: context.sum === null || context.product === null ? null : context.sum / context.product,
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
            target: 'error',
          },
        ],
        'sys.com.human.approval.error': {
          actions: xstate.assign({ errors: ({ context, event }) => [...context.errors, event.data] }),
          target: 'error',
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
