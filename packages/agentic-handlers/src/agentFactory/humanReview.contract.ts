import { cleanString, createSimpleArvoContract } from 'arvo-core';
import z from 'zod';

export const humanReviewContract = createSimpleArvoContract({
  uri: '#/amas/external/human/review',
  type: 'human.review',
  description: cleanString(`
    Request a human review when you need guidance, clarification, or a decision on something. 
    Provide all relevant context in your prompt so the human can give you a useful response.
  `),
  versions: {
    '1.0.0': {
      accepts: z.object({
        prompt: z.string().describe(
          cleanString(`
            Your message to the human explaining what you need reviewed and why. 
            Include all relevant details and context to help them understand the situation and provide a clear response.
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

export const humanReviewServiceDomain = 'human.review';
