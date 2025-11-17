import { ArvoErrorSchema, cleanString, createArvoOrchestratorContract } from 'arvo-core';
import z from 'zod';

export const demoOrchestratorContract = createArvoOrchestratorContract({
  uri: '#/org/amas/orchestrator/demo',
  name: 'demo',
  description: cleanString(`
        A demo orchestrator which shows how an orchestrator can works in Arvo.
        
        - It takes a number set of numbers.
        - It asks of users permission to execute the handlers
        - It, in parrallel, emits event to add and multiply the numbers
        - It returns the product of the numbers, sum of the numbers and result of sum divided by product
        
        This demonstrates, by a very simple example, the machine declaration 
        and execution in Arvo. 
    `),
  versions: {
    '1.0.0': {
      init: z.object({
        values: z.number().array(),
      }),
      complete: z.object({
        success: z.boolean(),
        errors: ArvoErrorSchema.array().nullable(),
        product: z.number().nullable(),
        sum: z.number().nullable(),
        result: z.number().nullable(),
      }),
    },
  },
});
