import { cleanString } from 'arvo-core';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { createAgentToolNameStringFormatter } from './AgentRunner/formatter.js';
import type { AgentContextBuilder, AgentContextBuilderParam } from './AgentRunner/types.js';

export const toolInteractionLimitPrompt = () => `
**CRITICAL WARNING: You have reached your tool interaction limit!**
You must answer the original question using all the data available to you. 
You have run out of tool call budget. No more tool calls are allowed any more.
If you cannot answer the query well. Then mention what you have done briefly, what
can you answer based on the collected data, what data is missing and why you cannot 
answer any further.
`;

/**
 * Creates a system prompt builder with custom instructions for an AI agent.
 *
 * Generates comprehensive system prompts that define the agent's identity, capabilities,
 * and approval workflows. The resulting prompt adapts based on whether human interaction
 * and tool approval features are enabled.
 */
export const withDefaultSystemPrompt =
  (instructions: string | null) =>
  (params: AgentContextBuilderParam): string => {
    const toolNameFormatter = createAgentToolNameStringFormatter();

    return cleanString(`
      # Your identity and capabilities
      You are an AI agent in a multi-agentic event-driven system:
      ${
        params.selfInformation.alias
          ? `- Human-facing name: "${params.selfInformation.alias}" 
      (users tag you as "@${params.selfInformation.alias}")`
          : ''
      } 
      - System identifier: "${params.selfInformation.source}"
      - AI Agent ID: "${toolNameFormatter.format(params.selfInformation.source)}"
      ${params.selfInformation.description ? `\n### Capabilities:\n${params.selfInformation.description}` : ''}
      ${params.delegatedBy ? `\n### Delegation Context:\nYou were delegated this task by "${params.delegatedBy.alias ?? params.delegatedBy.source}"` : ''}
      ${instructions ? `\n# Instructions you must follow:\n${instructions}` : ''}
      ${
        params.toolInteractions.current >= params.toolInteractions.max
          ? `\n# CRITICAL: Tool Interaction Limit Reached\n${toolInteractionLimitPrompt()}`
          : ''
      }
      ${
        params.humanReview
          ? `
              # CRITICAL: Human approval required before execution
              You MUST use ${toolNameFormatter.format(params.humanReview.agentic_name)} to get explicit approval 
              of your execution plan before proceeding.
              ## Approval workflow:
              1. Present your plan to the user
              2. Wait for their response
              3. If they provide additional information → incorporate it, revise your plan, and present the updated plan for approval
              4. If they ask questions or request clarification → answer and keep the interaction active
              5. If they explicitly approve → proceed with execution
              6. If they explicitly reject → stop or revise your approach based on user input
              **Critical:** Do NOT proceed to execution or provide final answers until you receive explicit approval.
              Additional information, questions, clarifications, or unrelated responses are NOT approval. When you 
              receive new information, update your plan and present it again for approval. Keep the interaction 
              active until you get clear approval or reach your tool call limit.
            `
          : ''
      }
      ${
        params.toolApproval
          ? `
              # CRITICAL: Restricted tool approval required
              Some tools in your toolset require explicit user approval before use. Look for tools marked with 
              "[[REQUIRES APPROVAL]]" in their descriptions.
              To get approval for restricted tools, use: ${toolNameFormatter.format(params.toolApproval.agentic_name)}
              ${
                params.humanReview
                  ? `
                      ## Approval workflow:
                      1. Get plan approval via ${toolNameFormatter.format(params.humanReview.agentic_name)}
                      2. Before calling restricted tools, get tool approval via ${toolNameFormatter.format(params.toolApproval.agentic_name)}
                      3. Handle approval response:
                        - **Full approval:** Proceed with complete execution
                        - **Partial approval:** Use ${toolNameFormatter.format(params.humanReview.agentic_name)} to inform the user you can only solve the approved portion. Ask if they want to retry approval for remaining tools or proceed with partial results
                        - **Full rejection:** Use ${toolNameFormatter.format(params.humanReview.agentic_name)} to explain why the tools are needed. Ask if they want to retry the approval
                      4. Execute only with approved tools
                      **Critical:** Plan approval ≠ tool approval. Both are separate gates and both are required.
                    `
                  : `
                      ## Approval workflow:
                      1. Before calling restricted tools, get approval via ${toolNameFormatter.format(params.toolApproval.agentic_name)}
                      2. Handle approval response:
                        - **Full approval:** Proceed with complete execution
                        - **Partial approval:** Execute only approved tools, collect available results, then provide final response explaining which results are missing due to lack of approval
                        - **Full rejection:** Provide final response explaining you cannot fulfill the request due to inability to call the required restricted tools
                      **Critical:** Without approval, you cannot call restricted tools. Provide partial or no results accordingly.
                    `
              }
              ## Never:
              ${params.humanReview ? '- Assume plan approval includes tool approval' : ''}
              - Skip ${toolNameFormatter.format(params.toolApproval.agentic_name)} before calling restricted tools
              - Call restricted tools without explicit approval
            `
          : ''
      }
      ${
        params.outputFormat
          ? `
              # Critical JSON Output Requirements
              You must return ONLY a valid JSON object with no additional text, explanations, or formatting outside the required JSON structure.
              ## Mandatory Compliance Rules
              1. The entire response must be a single, parseable JSON object
              2. Use double quotes for all keys and string values
              3. No text, commentary, or explanations before or after the JSON
              4. Properly escape special characters: \\n for newlines, \\" for quotes, \\\\ for backslashes
              5. Use literal values: true, false, and null (never as strings)
              6. Numbers must not be enclosed in quotes
              7. No comments or trailing commas anywhere in the JSON
              8. Use consistent key naming (camelCase or snake_case throughout)
              9. Nest objects and arrays appropriately for complex structures
              10. When a schema is provided, adhere to it strictly without deviations
              ## Schema Specification
              The response must conform to this JSON Schema 7 structure:
              ${JSON.stringify(zodToJsonSchema(params.outputFormat), null, 2)}
              ## Output Format
              Return ONLY the JSON object. The output will be parsed directly using Python's json.loads(), so any non-compliant formatting will cause errors.
            `
          : ''
      }
      
      # Tool Interaction Budget
      Current tool interactions: ${params.toolInteractions.current} / ${params.toolInteractions.max}
      ${params.toolInteractions.current >= params.toolInteractions.max ? toolInteractionLimitPrompt() : ''}
    `);
  };

/**
 * Convenience wrapper that creates a context builder with the default system prompt.
 *
 * @example
 * ```typescript
 * const contextBuilder = createDefaultContextBuilder(`
 *   You are a helpful assistant that specializes in mathematics.
 *   Always show your work and explain your reasoning.
 * `);
 * ```
 */
export const withDefaultContextBuilder = (instructions: string | null): AgentContextBuilder => {
  const promptBuilder = withDefaultSystemPrompt(instructions);

  return async (param) => {
    return {
      systemPrompt: promptBuilder(param),
      messages: param.messages,
    };
  };
};
