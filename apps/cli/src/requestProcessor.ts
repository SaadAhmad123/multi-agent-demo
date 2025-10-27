import { humanReviewContract, toolApprovalContract } from '@repo/agentic-handlers';
import {
  type ArvoErrorType,
  type ArvoEvent,
  ArvoOpenTelemetry,
  createArvoEventFactory,
  exceptionToSpan,
  type InferVersionedArvoContract,
  type VersionedArvoContract,
} from 'arvo-core';
import type { IMachineMemory } from 'arvo-event-handler';
import { parseAgentFromMessage } from './agentsMap.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { execute } from './handlerExecutor.js';

const matchSysError = (input: string) => {
  return input.startsWith('sys.') && input.endsWith('.error');
};

export type RequestProcessorOutput =
  | {
      type: '_INFO';
      data: string;
    }
  | {
      type: '_END_TURN';
      agentName: string;
      data: string;
    }
  | {
      type: '_EXIT';
      data: string;
    }
  | {
      type: '_HUMAN_REVIEW_REQUESTED';
      data: string;
      agentName: string;
      event: InferVersionedArvoContract<VersionedArvoContract<typeof humanReviewContract, '1.0.0'>>['accepts'];
    }
  | {
      type: '_HUMAN_TOOL_USE_APPROVAL_REQUESTED';
      data: string;
      toolRequestedForApproval: string[];
      agentName: string;
      event: InferVersionedArvoContract<VersionedArvoContract<typeof toolApprovalContract, '1.0.0'>>['accepts'];
    };

export type RequestProcessorInput = {
  memory: IMachineMemory<Record<string, unknown>>;
  message: string;
} & (
  | { isHumanReview: false }
  | {
      isHumanReview: true;
      humanReviewRequestEvent: ArvoEvent;
    }
) &
  (
    | {
        isToolApproval: false;
      }
    | {
        isToolApproval: true;
        toolApprovalMap: Record<string, boolean>;
        toolApprovalRequestEvent: ArvoEvent;
      }
  );

/**
 * Processes user input messages, handling both regular queries and human review responses.
 * Parses agent mentions, validates input, executes the appropriate event handler, and returns structured output
 * indicating the next action (end turn, exit, or request human review).

* @returns A promise resolving to one of three output types: _END_TURN (normal completion), 
 *          _EXIT (termination), or _HUMAN_REVIEW_REQUESTED (requires human intervention)
 * 
 * @example
 * ```typescript
 * const result = await requestProcessor({
 *   message: "@issac calculate 5 + 3",
 *   memory: machineMemory,
 *   isHumanReview: false
 * });
 * ```
 */
export const requestProcessor = async (param: RequestProcessorInput) =>
  await ArvoOpenTelemetry.getInstance().startActiveSpan({
    name: param.isHumanReview ? 'User Review Response' : param.isToolApproval ? 'User Tool Approval' : 'User Input',
    disableSpanManagement: false,
    context: param.isHumanReview
      ? {
          inheritFrom: 'TRACE_HEADERS',
          traceHeaders: {
            traceparent: param.humanReviewRequestEvent.traceparent,
            tracestate: param.humanReviewRequestEvent.tracestate,
          },
        }
      : param.isToolApproval
        ? {
            inheritFrom: 'TRACE_HEADERS',
            traceHeaders: {
              traceparent: param.toolApprovalRequestEvent.traceparent,
              tracestate: param.toolApprovalRequestEvent.tracestate,
            },
          }
        : undefined,
    fn: async (span): Promise<RequestProcessorOutput> => {
      try {
        let _message = param.message;
        let agent: ReturnType<typeof parseAgentFromMessage>['agent'] = null;
        if (!param.isHumanReview && !param.isToolApproval) {
          const agentParsedMessage = parseAgentFromMessage(_message);
          _message = agentParsedMessage.cleanMessage;
          agent = agentParsedMessage.agent;

          if (!agent) {
            return {
              type: '_INFO',
              data: 'Please specify an agent to process your query. Please type /agents to list which agents are availble',
            };
          }
        }

        const event = (() => {
          if (param.isHumanReview) {
            return createArvoEventFactory(humanReviewContract.version('1.0.0')).emits({
              type: 'evt.human.review.success',
              to: param.humanReviewRequestEvent.source,
              subject: param.humanReviewRequestEvent.subject,
              parentid: param.humanReviewRequestEvent.id,
              source: 'test.test.test',
              data: {
                response: _message.trim() || 'No reponse. Can you not process and abort the process',
              },
            });
          }
          if (param.isToolApproval) {
            return createArvoEventFactory(toolApprovalContract.version('1.0.0')).emits({
              type: 'evt.tool.approval.success',
              to: param.toolApprovalRequestEvent.source,
              subject: param.toolApprovalRequestEvent.subject,
              parentid: param.toolApprovalRequestEvent.id,
              source: 'test.test.test',
              data: {
                approvals: Object.entries(param.toolApprovalMap).map(([key, value]) => ({
                  tool: key,
                  value: value,
                })),
              },
            });
          }
          // biome-ignore lint/style/noNonNullAssertion: This cannot be null
          return createArvoEventFactory(agent!.data.contract).accepts({
            source: 'test.test.test',
            data: {
              parentSubject$$: null,
              message: _message.trim() || 'What can you do?',
            },
          });
        })();

        const response = await execute(event, param.memory);

        if (!response) {
          return {
            type: '_EXIT',
            data: 'No response',
          };
        }

        if (response.type === humanReviewContract.version('1.0.0').accepts.type) {
          const hre = response as unknown as InferVersionedArvoContract<
            VersionedArvoContract<typeof humanReviewContract, '1.0.0'>
          >['accepts'];
          return {
            type: '_HUMAN_REVIEW_REQUESTED',
            agentName: agent?.name ?? '',
            data: hre.data.prompt,
            event: hre,
          };
        }

        if (response.type === toolApprovalContract.version('1.0.0').accepts.type) {
          const tuare = response as unknown as InferVersionedArvoContract<
            VersionedArvoContract<typeof toolApprovalContract, '1.0.0'>
          >['accepts'];
          return {
            type: '_HUMAN_TOOL_USE_APPROVAL_REQUESTED',
            agentName: agent?.name ?? '',
            data: tuare.data.message,
            toolRequestedForApproval: tuare.data.tools,
            event: tuare,
          };
        }

        if (response?.data?.output && typeof response.data.output === 'object' && response.data.output.response) {
          return {
            type: '_END_TURN',
            agentName: agent?.name ?? '',
            data: response.data.output.response,
          };
        }

        if (matchSysError(response.type)) {
          const errorData = response.data as ArvoErrorType;
          return {
            type: '_END_TURN',
            agentName: agent?.name ?? '',
            data: `[Error Occurred] ${errorData.errorMessage}`,
          };
        }

        return {
          type: '_EXIT',
          data: `Unrecognized event -> ${response.type}`,
        };
      } catch (e) {
        exceptionToSpan(e as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (e as Error)?.message,
        });
        throw e;
      } finally {
        span.end();
      }
    },
  });
