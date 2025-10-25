import { ArvoOpenTelemetry, exceptionToSpan, type OpenTelemetryHeaders } from 'arvo-core';
import type { AnyVersionedContract } from '../../types.js';
import type { NonEmptyArray } from '../../types.js';
import type { LLMIntegrationOutput, LLMIntegrationParam, LLMIntergration } from '../types/llm.integration.js';
import { SpanStatusCode, type Span } from '@opentelemetry/api';
import {
  openInferenceSpanInitAttributesSetter,
  openInferenceSpanOutputAttributesSetter,
} from './otel.openinference.js';
import type { CreateAgenticResumableParams } from '../types/index.js';
import { DEFAULT_AGENT_MAX_TOOL_INTERACTIONS } from './defaults.js';

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
        const agenticSystemPrompt =
          params.systemPrompt?.({
            messages: params.messages,
            type: params.type,
            toolDefinitions: params.toolDefinitions,
            maxToolInteractions: params.maxToolInteractions ?? DEFAULT_AGENT_MAX_TOOL_INTERACTIONS,
            toolApproval: params.toolApproval,
            humanInteraction: params.humanInteraction,
            alias: params.alias ?? null,
            handlerSource: params.handlerSource,
            description: params.description ?? null,
            span,
            outputFormat: params.outputFormat,
            currentToolInteractionCount: params.currentToolInteractionCount,
          }) ?? null;
        openInferenceSpanInitAttributesSetter({
          messages: params.messages,
          systemPrompt: agenticSystemPrompt,
          tools: params.toolDefinitions,
          span,
        });
        const result = await agenticLLMCaller({
          ...params,
          systemPrompt: agenticSystemPrompt,
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
