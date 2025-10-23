import { cleanString, createSimpleArvoContract } from 'arvo-core';
import z from 'zod';

export const humanInteractionContract = createSimpleArvoContract({
  uri: '#/amas/external/human/interaction',
  type: 'human.interaction',
  description: cleanString(`
    Use this tool to communicate directly with the humans while resolving their 
    request. 
    **How to Communicate(())
    - Address the user directly using "you"/"your" - never refer to them in third person.
    - When seeking clarification, ask specific questions about what you need to know. Explain 
      why the information matters and what depends on their answer.
    - When requesting approval, provide a clear structured plan that covers: what actions 
      you'll take, which tools or agents you'll use for each step, why each step is 
      necessary, and what the final outcome will be. Make it easy for them to understand and 
      approve your approach.
    - After they respond, acknowledge what they've provided and either proceed with execution, 
      ask follow-up questions, or revise your plan based on their feedback.
  `),
  versions: {
    '1.0.0': {
      accepts: z.object({
        prompt: z.string().describe(
          cleanString(`
            Your message to prompt the user. The user must feel that you are 
            communicating your request directly to them and provide them enough
            information so that they can facilitate your request.
          `),
        ),
      }),

      emits: z.object({
        response: z.string().describe("The human reviewer's response to your prompt"),
      }),
    },
  },
});

export const humanInteractionServiceDomain = 'human.interaction';
