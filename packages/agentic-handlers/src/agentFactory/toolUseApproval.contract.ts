import { cleanString, createSimpleArvoContract } from 'arvo-core';
import z from 'zod';

export const toolUseApprovalContract = createSimpleArvoContract({
  uri: '#/amas/agent/tool/approval',
  type: 'tool.approval',
  description: cleanString(`
    Request approval from a human reviewer before you can use certain tools. Tools that 
    require approval are marked with [[REQUIRE APPROVAL]] in their description (you are free 
    to use tools which don't have this in their description). When requesting approval, provide 
    clear context about why you need these tools and what you intend to do with them so the 
    reviewer can make an informed decisio
  `),
  versions: {
    '1.0.0': {
      accepts: z.object({
        toolUseId$$: z.string().optional(),
        message: z.string().describe(
          cleanString(`
            Explain to the reviewer why you need to use these tools and what you're trying to accomplish. 
            Be clear and specific so they can make an informed decision.
          `),
        ),
        tools: z.string().array().describe('List of tool names you need approval to use'),
      }),
      emits: z.object({
        toolUseId$$: z.string().optional().describe('Same identifier from the request to match the response'),
        approvals: z
          .object({
            tool: z.string().describe('The tool name this approval applies to'),
            value: z.boolean(),
            comments: z
              .string()
              .optional()
              .describe('Optional feedback or instructions from the reviewer about this tool'),
          })
          .array()
          .describe('Approval decisions for each tool you requested'),
      }),
    },
  },
});
