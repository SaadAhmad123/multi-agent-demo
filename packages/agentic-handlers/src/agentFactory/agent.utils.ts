import { ArvoOpenTelemetry, cleanString, exceptionToSpan, type OpenTelemetryHeaders } from 'arvo-core';
import { z } from 'zod';
import { StringFormatter } from './utils.js';
import type {
  AnyVersionedContract,
  CreateAgenticResumableParams,
  LLMIntegrationOutput,
  LLMIntegrationParam,
  LLMIntergration,
} from './types.js';
import { SpanStatusCode, type Span } from '@opentelemetry/api';
import { openInferenceSpanInitAttributesSetter, openInferenceSpanOutputAttributesSetter } from './helpers.otel.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { jsonUsageIntentPrompt } from './helpers.prompt.js';

/**
 * Default output format for agents that don't specify a custom output schema.
 * Provides a simple string response format for basic conversational agents.
 */
export const DEFAULT_AGENT_OUTPUT_FORMAT = z.object({ response: z.string() });

export const buildAgentContractDescription = (param: {
  alias?: string;
  description?: string;
  contractName: string;
}) => {
  const aliasContent = cleanString(
    param.alias
      ? `
    # Direct Human User Interaction:
    I am a human user facing agent to which the user can reach out directly.
    To humans, I am known by the alias "${param.alias}" and the user can directly
    call me if they want by mentioning me "@${param.alias}" in their message. 
  `
      : '',
  );
  const internalSystemContent = cleanString(`
    # Internal System Interactions:
    Within the multi-agent event driven eco-system I am know by my system id "${param.contractName}".
    And my fellow AI Agents can call me by my AI Agent Compliant ID "${param.contractName.replaceAll('.', '_')}"
  `);
  const descriptionContent = cleanString(`
    # My Description 
    ${param.description || 'I am an AI Agent but my description is not avaiable. Please ask me to provide you with a quick summary of my capabilities'}
  `);
  return [aliasContent, internalSystemContent, descriptionContent].join('\n\n');
};

/**
 * Create a string formatter which can convert tool names to an agent compliant format
 */
export const createAgentToolNameStringFormatter = () => new StringFormatter((str) => str.replaceAll('.', '_'));

/**
 * Wraps the LLM caller with OpenTelemetry observability and system prompt generation.
 *
 * Creates a new OTEL span for each LLM call, handles prompt composition,
 * and ensures proper error tracking. The wrapper combines user-provided
 * system prompts with structured output instructions when applicable.
 */
export const otelAgenticLLMCaller: (
  agenticLLMCaller: LLMIntergration,
  param: Omit<LLMIntegrationParam, 'span' | 'systemPrompt'> & {
    systemPrompt: string | null;
    description: string | null;
    alias: CreateAgenticResumableParams<string, z.AnyZodObject>['alias'];
    handlerSource: string;
    toolsWhichRequireApproval?: string[];
    toolApprovalContract?: AnyVersionedContract;
    humanInteractionContract?: AnyVersionedContract;
    humanInteraction?: CreateAgenticResumableParams<string, z.AnyZodObject>['humanInteraction'];
  },
  otel: {
    parentSpan: Span;
    parentOtelHeaders: OpenTelemetryHeaders;
  },
) => Promise<LLMIntegrationOutput> = async (agenticLLMCaller, params, otel) => {
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
        const finalSystemPrompt =
          [
            cleanString(`
              # Your Identity
              You are an AI agent in a multi-agentic event driven system with the following identities:
              ${params.alias ? `- You are a human user facing agent. Your name known to human user is "${params.alias}" NOT "@${params.alias}". However, human users can interact directly with you by tagging you as "@${params.alias} in the text"` : ''} 
              - Your broaded event-driven system identifier is "${params.handlerSource}"
              - Other AI agents know via you AI Agent compliant ID "${toolNameFormatter.format(params.handlerSource)}"
                      `),
            ...(params.description
              ? [`# Your Capabilities As Known By Users and System: \n${params.description}`]
              : []),
            ...(params.systemPrompt ? [`# Your Instructions To Follow\n${params.systemPrompt}`] : []),
            ...(params.humanInteraction && params.humanInteractionContract
              ? [
                  cleanString(`
                    # CRITICAL: Human Interaction

                    Use ${toolNameFormatter.format(params.humanInteractionContract.accepts.type)} to communicate 
                    directly with the user and keep them in the loop when needed.
                    ## Two Situations Require This Tool
                    **Missing Information:** When the request is unclear or you lack details 
                    needed to proceed, use this tool to ask the user directly. Don't guess.
                    **Multi-Step Plans:** When your solution requires interpreting the problem 
                    and creating a multi-step plan involving multiple tool calls or sequential steps, 
                    present your complete plan and get approval before executing. Only do this 
                    if you're actually solving a problem within your scope.

                    ## How to Communicate

                    Address the user directly using "you" and "your" - never refer to them in third person.
                    When seeking clarification, ask specific questions about what you need to know. Explain 
                    why the information matters and what depends on their answer.
                    When requesting approval, provide a clear structured plan that covers: what actions 
                    you'll take, which tools or agents you'll use for each step, why each step is 
                    necessary, and what the final outcome will be. Make it easy for them to understand and 
                    approve your approach.
                    After they respond, acknowledge what they've provided and either proceed with execution, 
                    ask follow-up questions, or revise your plan based on their feedback.

                    ## After The User Responds

                    If they clarified: build your plan and request approval, or ask more questions.
                    If they approved: execute your plan immediately.
                    If they want changes: revise and resubmit.

                    Keep the dialogue going until you're clear on what they need and have approval to proceed.

                    **Critical:** This tool is synchronous dialogue with the user. Communicate naturally and directly.
                  `),
                ]
              : []),
            ...(params.toolsWhichRequireApproval?.length && params.toolApprovalContract
              ? [
                  cleanString(`
                    # CRITICAL: Restricted Tool Approval Required
                    These tools need explicit approval before use:
                    ${params.toolsWhichRequireApproval.map((tool) => `- ${tool}`).join('\n')}
                    ## Two-Stage Approval for Restricted Tools
                    When your execution plan includes restricted tools:
                    1. **First, get plan approval via com_human_interaction** as normal
                    2. **Then, before using each restricted tool, call com_tool_approval** to request specific tool approval
                    ## How to Request Tool Approval
                    Address the user directly via com_tool_approval:
                    "I need to use [restricted tool] to [specific action] as outlined in our approved plan. May I proceed?"
                    **Never:**
                    - Assume plan approval includes tool approval for restricted tools
                    - Skip the com_tool_approval step even if the plan mentions the restricted tool
                    - Call restricted tools directly after plan approval
                    **Critical:** Plan approval and restricted tool approval are separate gates. Both are required.
                  `),
                ]
              : []),
            cleanString(`
              # CRITICAL: Parallel Tool Execution

              ${params.humanInteraction || params.toolsWhichRequireApproval?.length ? 'After obtaining all required approvals, c' : 'C'}all independent tools/agents in parallel 
              to minimize latency and cost.

              **Parallelize when:**
              - Tools/agents don't depend on each other's outputs
              - Multiple data sources need simultaneous querying
              - Calculations or retrievals can happen concurrently

              **Sequential only when:**
              - Later calls require data from earlier calls
              - Execution order affects the outcome

              Maximize parallelism to reduce user wait time and system cost.
            `),
            ...(params.outputFormat
              ? [
                  `# Required Response Format\nYou must respond in the following JSON format:\n${jsonUsageIntentPrompt(zodToJsonSchema(params.outputFormat))}`,
                ]
              : []),
          ]
            .join('\n\n')
            .trim() || null; // This is not null-coelese because I want it to become undefined on empty string

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
