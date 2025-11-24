import type z from 'zod';
import type { AgentInternalTool, OtelInfoType } from './types.js';
import { ArvoOpenTelemetry, getOtelHeaderFromSpan } from 'arvo-core';
import { SpanStatusCode } from '@opentelemetry/api';
import {
  SemanticConventions as OpenInferenceSemanticConventions,
  OpenInferenceSpanKind,
} from '@arizeai/openinference-semantic-conventions';

export const createAgentTool = <TInputSchema extends z.ZodTypeAny, TOutputSchema extends z.ZodTypeAny>(
  param: AgentInternalTool<TInputSchema, TOutputSchema>,
) =>
  ({
    ...param,
    fn: async (input: z.infer<TInputSchema>, config: { otelInfo: OtelInfoType }) =>
      await ArvoOpenTelemetry.getInstance().startActiveSpan({
        name: `AgentTool<${param.name}>.execute`,
        disableSpanManagement: true,
        context: {
          inheritFrom: 'TRACE_HEADERS',
          traceHeaders: config.otelInfo.headers,
        },
        spanOptions: {
          attributes: {
            [OpenInferenceSemanticConventions.OPENINFERENCE_SPAN_KIND]: OpenInferenceSpanKind.TOOL,
          },
        },
        fn: async (span) => {
          try {
            const inputValidation = param.input.safeParse(input);
            if (inputValidation.error)
              throw new Error(
                `Invalid tool input data. Please send the correct data and its structure as per the input schema. ${inputValidation.error.toString()}`,
              );
            return await param.fn(inputValidation.data, {
              otelInfo: {
                span,
                headers: getOtelHeaderFromSpan(span),
              },
            });
          } catch (err) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error)?.message });
            throw err;
          } finally {
            span.end();
          }
        },
      }),
  }) as AgentInternalTool<TInputSchema, TOutputSchema>;
