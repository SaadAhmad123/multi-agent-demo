import { createArvoContract } from 'arvo-core';
import {
  createArvoEventHandler,
  type EventHandlerFactory,
} from 'arvo-event-handler';
import { z } from 'zod';

export const productContract = createArvoContract({
  uri: '#/org/amas/calculator/product',
  type: 'com.calculator.product',
  description:
    'This service provides the product of all the numbers provided to it.',
  versions: {
    '1.0.0': {
      accepts: z.object({
        numbers: z.number().array(),
      }),
      emits: {
        'evt.calculator.product.success': z.object({
          result: z.number(),
        }),
      },
    },
  },
});

export const productHandler: EventHandlerFactory = () =>
  createArvoEventHandler({
    contract: productContract,
    executionunits: 0,
    handler: {
      // deno-lint-ignore require-await
      '1.0.0': async ({ event }) => {
        if (event.data.numbers.length === 0) {
          // This will result in 'sys.calculator.product.error' event
          throw new Error('Numbers array cannot be empty');
        }
        return {
          type: 'evt.calculator.product.success',
          data: {
            result: event.data.numbers.reduce((acc, cur) => acc * cur, 1),
          },
          executionunits: event.data.numbers.length * 1e-6,
        };
      },
    },
  });
