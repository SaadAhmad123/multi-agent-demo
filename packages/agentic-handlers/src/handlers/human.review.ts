import { cleanString, createSimpleArvoContract } from 'arvo-core';
import z from 'zod';

export const humanReviewContract = createSimpleArvoContract({
  uri: '#/amas/external/human/review',
  type: 'human.review',
  description: cleanString(`
    Prompt human for the reivew with the prompt from which they can read the details of the decision they are being requested to make.
    Please, provide all the relevant information to facilitate the human
  `),
  versions: {
    '1.0.0': {
      accepts: z.object({
        prompt: z.string(),
        toolUseId$$: z.string().optional(),
      }),

      emits: z.object({
        response: z.string(),
        toolUseId$$: z.string().optional(),
      }),
    },
  },
});

export const humanReviewServiceDomain = 'human.review';
