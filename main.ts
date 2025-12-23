import { confirm } from '@inquirer/prompts';
import { ArvoEvent, createArvoEventFactory } from 'arvo-core';
import { addHandler } from './handlers/add.service.ts';
import { productHandler } from './handlers/product.service.ts';
import { averageWorkflow } from './handlers/average.workflow.ts';
import {
  weightedAverageContract,
  weightedAverageResumable,
} from './handlers/weighted.average.resumable.ts';
import {
  context,
  SpanContext,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { humanApprovalContract } from './handlers/human.approval.contract.ts';
import {
  ConcurrentMachineMemory,
  createConcurrentEventBroker,
} from '@arvo-tools/concurrent';

const tracer = trace.getTracer('main-agent-tracer');
const TEST_EVENT_SOURCE = 'test.test.test';
const memory = new ConcurrentMachineMemory();

// Added domained event handling
export const executeHandlers = async (
  event: ArvoEvent,
): Promise<ArvoEvent[]> => {
  const domainedEvents: ArvoEvent[] = [];
  const { resolve, broker } = createConcurrentEventBroker([
    { handler: addHandler(), prefetch: 2 },
    { handler: productHandler(), prefetch: 2 },
    { handler: averageWorkflow({ memory }), prefetch: 3 },
    { handler: weightedAverageResumable({ memory }), prefetch: 2 },
  ], {
    onDomainedEvents: async ({ event }) => {
      domainedEvents.push(event);
    },
  });
  const response = await resolve(event);
  broker.clear();
  return response ? [response, ...domainedEvents] : domainedEvents;
};

// Utility function to create otel context from event
function createOtelContextFromEvent(event: ArvoEvent) {
  const traceParent = event.traceparent;
  let parentContext = context.active();
  if (traceParent) {
    const parts = traceParent.split('-');
    if (parts.length === 4) {
      const [_, traceId, spanId, traceFlags] = parts;
      const spanContext: SpanContext = {
        traceId,
        spanId,
        traceFlags: Number.parseInt(traceFlags),
      };
      parentContext = trace.setSpanContext(context.active(), spanContext);
    }
  }
  return parentContext;
}

// Handle the human approval console interface
async function handleHumanApproval(event: ArvoEvent): Promise<ArvoEvent> {
  return await tracer.startActiveSpan(
    'HumanConversation.Approval',
    {
      kind: SpanKind.INTERNAL,
    },
    createOtelContextFromEvent(event),
    async (span): Promise<ArvoEvent> => {
      try {
        console.log('==== Initiated Plan Approval ====');

        const userResponse = await confirm({
          message: event.data?.prompt ?? 'Apprvoal is requested',
        });

        span.setStatus({ code: SpanStatusCode.OK });
        return createArvoEventFactory(
          humanApprovalContract.version('1.0.0'),
        ).emits({
          subject: event.data?.parentSubject$$ ?? event.subject ?? undefined,
          parentid: event.id ?? undefined,
          to: event.source ?? undefined,
          accesscontrol: event.accesscontrol ?? undefined,
          source: TEST_EVENT_SOURCE,
          type: 'evt.human.approval.success',
          data: {
            approval: userResponse,
          },
        });
      } catch (e) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.recordException(e as Error);
        throw e;
      } finally {
        span.end();
      }
    },
  );
}

// Added otel tracing and nuances event handling
async function main() {
  await tracer.startActiveSpan(
    'main',
    async (span) => {
      let eventToProcess: ArvoEvent = createArvoEventFactory(
        weightedAverageContract.version('1.0.0'),
      )
        .accepts({
          source: TEST_EVENT_SOURCE,
          data: {
            parentSubject$$: null,
            input: [
              [2, 0.3],
              [45, 0.8],
              [2, 0.3],
              [45, 0.8],
              [2, 0.3],
              [45, 0.8],
              [2, 0.3],
              [45, 0.8],
              [2, 0.3],
              [45, 0.8],
              [2, 0.3],
              [45, 0.8],
              [2, 0.3],
              [45, 0.8],
              [2, 0.3],
              [45, 0.8],
              [2, 0.3],
              [45, 0.8],
              [2, 0.3],
              [45, 0.8],
              [2, 0.3],
            ].map(([value, weight]) => ({ value, weight })),
          },
        });

      let events: ArvoEvent[] = [];
      while (true) {
        const response = await executeHandlers(eventToProcess);
        events = response.length ? response : events;

        const humanApprovalEventIndex = events.findIndex(
          (item) => item.type === humanApprovalContract.type,
        );
        if (humanApprovalEventIndex !== -1) {
          eventToProcess = await handleHumanApproval(
            events[humanApprovalEventIndex],
          );
          events.splice(humanApprovalEventIndex, 1);
          continue;
        }

        break;
      }

      console.log('==== Final Event ====');
      for (const evt of events) {
        console.log(evt.toString(2));
      }
      span.end();
    },
  );
}

if (import.meta.main) {
  await main();
}
