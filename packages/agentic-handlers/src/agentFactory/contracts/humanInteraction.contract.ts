import { cleanString, createSimpleArvoContract } from 'arvo-core';
import z from 'zod';

export const humanInteractionContract = createSimpleArvoContract({
  uri: '#/amas/external/human/interaction',
  type: 'human.interaction',
  description: cleanString(`
    Communicate directly with the user for clarification or plan approval. Use when 
    you need information to proceed or when presenting a multi-step execution plan 
    for approval.,
  `),
  versions: {
    '1.0.0': {
      accepts: z.object({
        prompt: z.string().describe(
          cleanString(`
            Your message to the user. For clarification: ask specific questions about what you need to know. 
            For approval: present your complete execution plan with steps, tools, and expected outcomes, 
            then ask if you may proceed. Always address the user directly using 'you' and 'your'.
          `),
        ),
        toolUseId$$: z.string().optional(),
      }),

      emits: z.object({
        response: z.string().describe("The human reviewer's response to your prompt"),
        toolUseId$$: z.string().optional(),
      }),
    },
  },
});

export const humanInteractionServiceDomain = 'human.interaction';
