import { ArvoErrorSchema, createArvoOrchestratorContract } from 'arvo-core';
import z from 'zod';

export const essayBuilderWorkflowContract = createArvoOrchestratorContract({
  uri: '#/org/amas/workflow/essay/builder',
  name: 'workflow.essay.builder',
  versions: {
    '1.0.0': {
      init: z.object({
        topic: z.string().describe('The topic of the essay to write'),
        instructions: z.string().nullable().describe(
          'Addition instructions to follow while building the essay',
        ),
      }),
      complete: z.object({
        success: z.boolean(),
        essay: z.string().nullable(),
        comment: z.string(),
        errors: ArvoErrorSchema.array(),
      }),
    },
  },
});
