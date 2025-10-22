import { exceptionToSpan, type OpenTelemetryHeaders } from 'arvo-core';
import type { IToolUseApprovalMemory } from '../../types.js';
import type { Span } from '@opentelemetry/api';

export const processToolApprovals = async (
  approvals: Parameters<IToolUseApprovalMemory['setBatched']>[1],
  toolUseApprovalMemory: IToolUseApprovalMemory | undefined,
  handlerType: string,
  span: Span,
  parentOtelHeaders: OpenTelemetryHeaders,
): Promise<void> => {
  await toolUseApprovalMemory
    ?.setBatched(handlerType, approvals, {
      parentSpan: span,
      parentOtelHeaders,
    })
    .catch((e) => exceptionToSpan(e as Error, span));
};
