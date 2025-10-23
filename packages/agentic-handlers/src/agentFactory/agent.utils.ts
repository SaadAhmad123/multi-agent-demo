import { ArvoOpenTelemetry, cleanString, exceptionToSpan, type OpenTelemetryHeaders } from 'arvo-core';
import { z } from 'zod';
import { StringFormatter } from './utils.js';
import type {
  AnyVersionedContract,
  LLMIntegrationOutput,
  LLMIntegrationParam,
  LLMIntergration,
  NonEmptyArray,
} from './types.js';
import { SpanStatusCode, type Span } from '@opentelemetry/api';
import { openInferenceSpanInitAttributesSetter, openInferenceSpanOutputAttributesSetter } from './helpers.otel.js';
import type { CreateAgenticResumableParams } from './createAgenticResumable/types.js';

/**
 * Default output format for agents that don't specify a custom output schema.
 * Provides a simple string response format for basic conversational agents.
 */
export const DEFAULT_AGENT_OUTPUT_FORMAT = z.object({ response: z.string() });
export const DEFAULT_AGENT_MAX_TOOL_INTERACTIONS = 5;

/**
 * Create a string formatter which can convert tool names to an agent compliant format
 */
export const createAgentToolNameStringFormatter = () => new StringFormatter((str) => str.replaceAll('.', '_'));

export type OtelLLMIntegrationParam = Omit<LLMIntegrationParam, 'span' | 'systemPrompt'> & {
  systemPrompt: NonNullable<CreateAgenticResumableParams['systemPrompt']> | null;
  maxToolInteractions: number | null;
  description: string | null;
  alias: string | null;
  handlerSource: string;
  toolApproval: {
    toolNames: NonEmptyArray<string>;
    contract: AnyVersionedContract;
  } | null;
  humanInteraction: {
    contract: AnyVersionedContract;
  } | null;
};

/**
 * Wraps the LLM caller with OpenTelemetry observability and system prompt generation.
 *
 * Creates a new OTEL span for each LLM call, handles prompt composition,
 * and ensures proper error tracking. The wrapper combines user-provided
 * system prompts with structured output instructions when applicable.
 */
export const otelLLMIntegration: (
  agenticLLMCaller: LLMIntergration,
  param: OtelLLMIntegrationParam,
  otel: {
    parentSpan: Span;
    parentOtelHeaders: OpenTelemetryHeaders;
  },
) => Promise<LLMIntegrationOutput> = async (agenticLLMCaller, params, otel) => {
  const agenticSystemPrompt =
    params.systemPrompt?.({
      messages: params.messages,
      type: params.type,
      toolDefinitions: params.toolDefinitions,
      maxToolInteractions: params.maxToolInteractions ?? DEFAULT_AGENT_MAX_TOOL_INTERACTIONS,
      toolApproval: params.toolApproval,
      humanInteraction: params.humanInteraction,
    }) ?? null;

  // This function automatically inherits from the parent span
  return await ArvoOpenTelemetry.getInstance().startActiveSpan({
    name: 'Agentic LLM Call',
    disableSpanManagement: true,
    context: {
      inheritFrom: 'TRACE_HEADERS',
      traceHeaders: otel.parentOtelHeaders,
    },
    fn: async (span) => {
      try {
        const toolNameFormatter = createAgentToolNameStringFormatter();
        const finalSystemPrompt = cleanString(`
          # Your identity and capabilities
          You are an AI agent in a multi-agentic event-driven system:
          ${params.alias ? `- Human-facing name: "${params.alias}" (users tag you as "@${params.alias}")` : ''} 
          - System identifier: "${params.handlerSource}"
          - AI Agent ID: "${toolNameFormatter.format(params.handlerSource)}"
          ${params.description ? `\n### Capabilities:\n${params.description}` : ''}
          ${agenticSystemPrompt ? `# Instructions you must follow:\n${agenticSystemPrompt}` : ''}
          ${
            params.humanInteraction
              ? `# CRITICAL: Human approval required before execution
                You MUST use ${toolNameFormatter.format(params.humanInteraction.contract.accepts.type)} to get explicit approval 
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
                active until you get clear approval or reach your tool call limit.`
              : ''
          }
          ${
            params.toolApproval
              ? `# CRITICAL: Restricted tool approval required

                These tools require explicit user approval via ${toolNameFormatter.format(params.toolApproval.contract.accepts.type)}:
                ${params.toolApproval.toolNames.map((tool) => `- ${toolNameFormatter.format(tool)}`).join('\n')}

                ${
                  params.humanInteraction
                    ? `## Approval workflow:
                      1. Get plan approval via ${toolNameFormatter.format(params.humanInteraction.contract.accepts.type)}
                      2. Before calling restricted tools, get tool approval via ${toolNameFormatter.format(params.toolApproval.contract.accepts.type)}
                      3. Handle approval response:
                        - **Full approval:** Proceed with complete execution
                        - **Partial approval:** Use ${toolNameFormatter.format(params.humanInteraction.contract.accepts.type)} to inform the user you can only solve the approved portion. Ask if they want to retry approval for remaining tools or proceed with partial results
                        - **Full rejection:** Use ${toolNameFormatter.format(params.humanInteraction.contract.accepts.type)} to explain why the tools are needed. Ask if they want to retry the approval
                      4. Execute only with approved tools
                      **Critical:** Plan approval ≠ tool approval. Both are separate gates and both are required.`
                    : `## Approval workflow:
                      1. Before calling restricted tools, get approval via ${toolNameFormatter.format(params.toolApproval.contract.accepts.type)}
                      2. Handle approval response:
                        - **Full approval:** Proceed with complete execution
                        - **Partial approval:** Execute only approved tools, collect available results, then provide final response explaining which results are missing due to lack of approval
                        - **Full rejection:** Provide final response explaining you cannot fulfill the request due to inability to call the required restricted tools
                      **Critical:** Without approval, you cannot call restricted tools. Provide partial or no results accordingly.`
                }

                ## Never:
                ${params.humanInteraction ? '- Assume plan approval includes tool approval' : ''}
                - Skip ${toolNameFormatter.format(params.toolApproval.contract.accepts.type)} before calling restricted tools
                - Call restricted tools without explicit approval`
              : ''
          }
        `);
        openInferenceSpanInitAttributesSetter({
          messages: params.messages,
          systemPrompt: finalSystemPrompt,
          tools: params.toolDefinitions,
          span,
        });
        const result = await agenticLLMCaller({
          ...params,
          systemPrompt: finalSystemPrompt ?? null,
          span,
        });
        openInferenceSpanOutputAttributesSetter({
          ...result,
          span,
        });
        return result;
      } catch (e) {
        exceptionToSpan(e as Error, span);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (e as Error)?.message ?? 'Something went wrong',
        });
        throw e;
      } finally {
        span.end();
      }
    },
  });
};
