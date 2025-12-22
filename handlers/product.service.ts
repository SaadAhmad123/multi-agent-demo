import { createSimpleArvoContract } from 'arvo-core';
import {
  createArvoEventHandler,
  type EventHandlerFactory,
} from 'arvo-event-handler';
import { z } from 'zod';

/**
 * Contract definition that generates standardized event types:
 * - Input: 'com.calculator.product' (createSimpleArvoContract prepends 'com.' to the type)
 * - Success output: 'evt.calculator.product.success'
 * - Error output: 'sys.com.calculator.product.error' (system-generated on handler failure)
 *
 * 'createSimpleArvoContract' is a utility for creating simple request-response like contracts.
 * It automatically generates these event types with standard prefixes. Other contract creation
 * methods use different patterns.
 */
export const productContract = createSimpleArvoContract({
  uri: '#/org/amas/calculator/product',
  type: 'calculator.product',
  description:
    'This service provides the product of all the numbers provided to it.',
  versions: {
    '1.0.0': {
      accepts: z.object({
        // The contract enforces the array requirement and
        // will throw error at event creation time (via the event factory)
        // and it will also throw a ViolationError (ContractViolation)
        // if the event somehow makes its way to the event handler
        numbers: z.number().array().min(2),
      }),
      emits: z.object({
        result: z.number(),
      }),
    },
  },
});

export const productHandler: EventHandlerFactory = () =>
  createArvoEventHandler({
    contract: productContract, // Contract binding ensures type safety through IntelliSense, compile-time validation, and runtime checks
    handler: {
      // Register handlers for all the versions of the contract
      '1.0.0': async ({ event }) => {
        // The error is not needed here because the contract makes
        // sure that invalid data never reaches the handler
        await new Promise((res) => setTimeout(res, 500));
        return {
          type: 'evt.calculator.product.success' as const,
          data: {
            result: event.data.numbers.reduce((acc, cur) => acc * cur, 1),
          },
          executionunits: event.data.numbers.length * 1e-6,
        };
      },
    },
  });
