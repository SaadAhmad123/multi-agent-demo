import { cleanString, createSimpleArvoContract } from 'arvo-core';
import z from 'zod';

export const toolUseApprovalContract = createSimpleArvoContract({
  uri: '#/amas/agent/tool/approval',
  type: 'tool.approval',
  description: cleanString(`
    Request approval from the user before using restricted tools. This is the second approval 
    gate after plan approval - use this immediately before calling each restricted tool. 
    Explain what you need to do with the tool as outlined in your approved plan.
  `),
  versions: {
    '1.0.0': {
      accepts: z.object({
        toolUseId$$: z.string().optional(),
        message: z.string().describe(
          cleanString(`
            Your message to the user requesting permission to use the restricted tool. 
            Address them directly using "you" and "your". Explain what you need to do with 
            this tool and reference your approved plan. Example: "I need to use [tool] to 
            [action] as outlined in our approved plan. May I proceed?"
          `),
        ),
        tools: z.string().array().describe('List of restricted tool names you need approval to use'),
      }),
      emits: z.object({
        toolUseId$$: z.string().optional(),
        approvals: z
          .object({
            tool: z.string().describe('The tool name this approval applies to'),
            value: z.boolean().describe('Whether the user approved (true) or denied (false) this tool'),
            comments: z.string().optional().describe('Optional feedback or instructions from the user about this tool'),
          })
          .array()
          .describe('Approval decisions for each restricted tool you requested'),
      }),
    },
  },
});
