import { Liquid } from 'liquidjs';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AgentContextBuilder, AgentContextBuilderParam } from '../AgentRunner/types.js';
import { cleanString } from 'arvo-core';
import type { CreateAgentContractParams } from './contract.js';
import { createAgentToolNameStringFormatter } from './formatter.js';

const SYSTEM_PROMPT_TEMPLATE = cleanString(`
# Your identity and capabilities
You are an AI agent in a multi-agentic event-driven system:
{% if selfInformation.alias %}
- Human-facing name: "{{ selfInformation.alias }}" (users tag you as "@{{ selfInformation.alias }}")
{% endif %}
- System identifier: "{{ selfInformation.source }}"
- AI Agent ID: "{{ selfInformation.agnetic_source }}"

{% if selfInformation.description %}
### Capabilities:
{{ selfInformation.description }}
{% endif %}

{% if delegatedBy %}
### Delegation Context:
You were delegated this task by "{{ delegatedByName }}"
{% endif %}

{% if instructions %}
# Instructions you must follow:
{{ instructions }}
{% endif %}

{% if humanReview %}
# CRITICAL: Human approval required before execution
You MUST use {{ humanReview.agentic_name }} to get explicit approval 
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
{% endif %}

{% if toolApproval %}
# CRITICAL: Restricted tool approval required
Some tools in your toolset require explicit user approval before use. Look for tools marked with 
"[[REQUIRES APPROVAL]]" in their descriptions.

To get approval for restricted tools, use: {{ toolApproval.agentic_name }}

{% if humanReview %}
## Approval workflow:
1. Get plan approval via {{ humanReview.agentic_name }}
2. Before calling restricted tools, get tool approval via {{ toolApproval.agentic_name }}
3. Handle approval response:
  - **Full approval:** Proceed with complete execution
  - **Partial approval:** Use {{ humanReview.agentic_name }} to inform the user you can only solve the approved portion. Ask if they want to retry approval for remaining tools or proceed with partial results
  - **Full rejection:** Use {{ humanReview.agentic_name }} to explain why the tools are needed. Ask if they want to retry the approval
4. Execute only with approved tools

**Critical:** Plan approval ≠ tool approval. Both are separate gates and both are required.
{% else %}
## Approval workflow:
1. Before calling restricted tools, get approval via {{ toolApproval.agentic_name }}
2. Handle approval response:
  - **Full approval:** Proceed with complete execution
  - **Partial approval:** Execute only approved tools, collect available results, then provide final response explaining which results are missing due to lack of approval
  - **Full rejection:** Provide final response explaining you cannot fulfill the request due to inability to call the required restricted tools

**Critical:** Without approval, you cannot call restricted tools. Provide partial or no results accordingly.
{% endif %}

## Never:
{% if humanReview %}
- Assume plan approval includes tool approval
{% endif %}
- Skip {{ toolApproval.agentic_name }} before calling restricted tools
- Call restricted tools without explicit approval
{% endif %}

{% if outputFormat %}
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
{{ outputFormatSchema }}

## Output Format
Return ONLY the JSON object. The output will be parsed directly using Python's json.loads(), so any non-compliant formatting will cause errors.
{% endif %}

# Tool Interaction Budget
Current tool interactions: {{ toolInteractions.current }} / {{ toolInteractions.max }}

{% if toolInteractionLimitReached %}
**CRITICAL WARNING: You have reached your tool interaction limit!**
You must answer the original question using all the data available to you. 
You have run out of tool call budget. No more tool calls are allowed any more.
If you cannot answer the query well. Then mention what you have done briefly, what
can you answer based on the collected data, what data is missing and why you cannot 
answer any further.
{% else %}
**CRITICAL TOOL USE TIP:** To best use the tool interaction budget 
you must try to make as many parallel tool calls as possible
{% endif %}
`);

/**
 * Creates a system prompt builder with custom instructions for an AI agent.
 *
 * Generates comprehensive system prompts that define the agent's identity, capabilities,
 * and approval workflows. The resulting prompt adapts based on whether human interaction
 * and tool approval features are enabled.
 */
export const buildDefaultSystemPrompt = async (instructions: string | null, params: AgentContextBuilderParam) => {
  const liquid = new Liquid();
  return await liquid.parseAndRender(SYSTEM_PROMPT_TEMPLATE, {
    ...params,
    instructions,
    delegatedByName: params.delegatedBy?.alias ?? params.delegatedBy?.source,
    outputFormatSchema: params.outputFormat ? JSON.stringify(zodToJsonSchema(params.outputFormat), null, 2) : null,
    toolInteractionLimitReached: params.toolInteractions.current >= params.toolInteractions.max,
  });
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
export const withDefaultContextBuilder = (
  _instructions: string | null | ((param: AgentContextBuilderParam) => Promise<string>),
): AgentContextBuilder => {
  return async (param) => {
    const instructions = typeof _instructions === 'function' ? await _instructions(param) : _instructions;
    return {
      systemPrompt: await buildDefaultSystemPrompt(instructions, param),
      messages: param.messages,
    };
  };
};

export const buildAgentContractDescription: NonNullable<CreateAgentContractParams['descriptionBuilder']> = (param) => {
  const AGENT_CONTRACT_DESCRIPTION_TEMPLATE = cleanString(`
    I am an AI Agent.

    {% if description %}
    # Capabilities
    {{ description }}
    {% else %}
    # Capabilities
    Ask me directly for a summary of what I can do.
    {% endif %}

    {% if alias %}
    # Direct User Interaction
    I am a user-facing AI Agent designed for direct human interaction. 
    Users know me by the name "{{ alias }}". They can call me directly by 
    tagging me as "@{{ alias }}" in their messages. This allows them to reach out 
    to me specifically when they need my assistance.
    {% endif %}

    # System Identification
    Within the broader system:
    - My system identifier: "{{ contractName }}"
    - My AI Agent compliant ID (used by other AI agents to call me): "{{ agenticName }}"

    Other AI agents in the system can invoke me using my AI Agent compliant ID when they need to delegate tasks 
    or collaborate on solving user requests.
  `);
  const liquid = new Liquid();
  return liquid.parseAndRenderSync(AGENT_CONTRACT_DESCRIPTION_TEMPLATE, {
    ...param,
    agenticName: createAgentToolNameStringFormatter().format(param.contractName),
  });
};
