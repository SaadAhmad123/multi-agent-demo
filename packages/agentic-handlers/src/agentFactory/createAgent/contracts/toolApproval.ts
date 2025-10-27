import { cleanString, createSimpleArvoContract } from 'arvo-core';
import z from 'zod';

export const toolApprovalContract = createSimpleArvoContract({
  uri: '#/amas/agent/tool/approval',
  type: 'tool.approval',
  description: cleanString(`
    Use this tool to get explicit approval from the user for using the restricted tool.

    ## How to Request Tool Approval

    - Address the user directly using "you"/"your" - never refer to them in third person.
    - The approval request message must feel to the user as if you are directly talking to them rather than
      being mechanical and im-personal

  `),
  versions: {
    '1.0.0': {
      accepts: z.object({
        message: z.string().describe(
          cleanString(`
            Your message to the user informing them about the tools for which you need
            the approval. The user, in this message, must feel that you are directly talking
            to them.
          `),
        ),
        tools: z.string().array().describe('List of restricted tool names you need approval to use'),
      }),
      emits: z.object({
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
