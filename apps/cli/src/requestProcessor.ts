import { humanReviewContract } from '@repo/agentic-handlers';
import {
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
    name: param.isHumanReview ? 'User Review' : 'User Input',
    disableSpanManagement: false,
    context: param.isHumanReview
      ? {
          inheritFrom: 'TRACE_HEADERS',
          traceHeaders: {
            traceparent: param.humanReviewRequestEvent.traceparent,
            tracestate: param.humanReviewRequestEvent.tracestate,
          },
        }
      : undefined,
    fn: async (span): Promise<RequestProcessorOutput> => {
      try {
        let _message = param.message;
        let agent: ReturnType<typeof parseAgentFromMessage>['agent'] = null;
        let additionalSystemPrompt: string | null = null;
        if (!param.isHumanReview) {
          const agentParsedMessage = parseAgentFromMessage(_message);
          _message = agentParsedMessage.cleanMessage;
          agent = agentParsedMessage.agent;
          additionalSystemPrompt = agentParsedMessage.systemPrompt;
        }

        if (!param.isHumanReview && agent === null) {
          return {
            type: '_INFO',
            data: 'Please specify an agent to process your query. Please type /agents to list which agents are availble',
          };
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
                toolUseId$$: param.humanReviewRequestEvent.data.toolUseId$$,
                response: _message.trim() || 'No reponse. Can you not process and abort the process',
              },
            });
          }
          // biome-ignore lint/style/noNonNullAssertion: This cannot be null
          return createArvoEventFactory(agent!.data.contract).accepts({
            source: 'test.test.test',
            data: {
              parentSubject$$: null,
              message: _message.trim() || 'What can you do?',
              additionalSystemPrompt: additionalSystemPrompt || undefined,
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

        if (response.type === 'com.human.review') {
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

        if (response?.data?.output && typeof response.data.output === 'object' && response.data.output.response) {
          return {
            type: '_END_TURN',
            agentName: agent?.name ?? '',
            data: response.data.output.response,
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
