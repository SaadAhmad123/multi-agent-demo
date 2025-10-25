import type { Span } from '@opentelemetry/api';
import type { InferVersionedArvoContract, VersionedArvoContract, OpenTelemetryHeaders } from 'arvo-core';
import type { toolUseApprovalContract } from '../contracts/toolUseApproval.js';

/**
 * Interface for managing tool use approval decisions in persistent storage.
 *
 * Stores and retrieves approval decisions made by human reviewers, supporting
 * different approval durations (one-time use vs 24-hour access). This enables
 * the agent to remember and respect reviewer decisions without requesting
 * approval repeatedly for the same tool within the approved timeframe.
 */

export interface IToolUseApprovalMemory {
  /**
   * Stores an approval decision for a tools for a specific source.
   */
  setBatched(
    source: string,
    approvals: Record<
      string,
      Pick<
        InferVersionedArvoContract<
          VersionedArvoContract<typeof toolUseApprovalContract, '1.0.0'>
        >['emits']['evt.tool.approval.success']['data']['approvals'][number],
        'comments' | 'value'
      >
    >,
    otel: {
      parentSpan: Span;
      parentOtelHeaders: OpenTelemetryHeaders;
    },
  ): Promise<void>;

  /**
   * Retrieves the current approval status for a set of tools for a specific source.
   */
  getBatched(
    source: string,
    toolName: string[],
    otel: {
      parentSpan: Span;
      parentOtelHeaders: OpenTelemetryHeaders;
    },
  ): Promise<Record<string, { value: boolean; comment?: string }>>;
}
