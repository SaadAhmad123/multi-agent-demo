import { load } from '@std/dotenv';
import { simpleAgent } from './handlers/simple.agent.ts';
import { ArvoEvent, createArvoEventFactory } from 'arvo-core';
import {
  type AgentStreamListener,
  SimplePermissionManager,
} from '@arvo-tools/agentic';
import { confirm, input } from '@inquirer/prompts';
await load({ export: true });
import {
  context,
  SpanContext,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { calculatorHandler } from './handlers/calculator.service.ts';
import { calculatorAgent } from './handlers/calculator.agent.ts';
import {
  operatorAgent,
  operatorAgentContract,
} from './handlers/operator.agent.ts';
import { humanConversationContract } from './handlers/human.conversation.contract.ts';
import { essayOutlineAgent } from './handlers/essay-outline.agent.ts';
import { essayWriterAgent } from './handlers/essay-writer.agent.ts';
import { essayBuilderWorkflow } from './handlers/essay.builder.workflow/index.ts';
import { humanApprovalContract } from './handlers/human.approval.contract.ts';
import { cleanString } from 'arvo-core';
import {
  ConcurrentMachineMemory,
  createConcurrentEventBroker,
} from '@arvo-tools/concurrent';
const TEST_EVENT_SOURCE = 'test.test.test';

const tracer = trace.getTracer('main-agent-tracer');

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

async function handlePermissionRequest(event: ArvoEvent): Promise<ArvoEvent> {
  return await tracer.startActiveSpan(
    'Permission.HumanApproval',
    {
      kind: SpanKind.INTERNAL,
    },
    createOtelContextFromEvent(event),
    async (span): Promise<ArvoEvent> => {
      try {
        console.log('==== Agent Requesting Tool Use Permission ====');
        const approval = await confirm({
          message: event.data?.reason ??
            'Agent need to call tools. Do you approve?',
        });
        span.setStatus({ code: SpanStatusCode.OK });
        return createArvoEventFactory(
          SimplePermissionManager.VERSIONED_CONTRACT,
        ).emits({
          subject: event.data?.parentSubject$$ ?? event.subject ?? undefined,
          parentid: event.id ?? undefined,
          to: event.source ?? undefined,
          accesscontrol: event.accesscontrol ?? undefined,
          source: TEST_EVENT_SOURCE,
          type: 'evt.arvo.default.simple.permission.request.success',
          data: {
            denied: !approval ? (event.data?.requestedTools ?? []) : [],
            granted: approval ? (event.data?.requestedTools ?? []) : [],
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

async function handleHumanConversation(event: ArvoEvent): Promise<ArvoEvent> {
  return await tracer.startActiveSpan(
    'HumanConversation.Interaction',
    {
      kind: SpanKind.INTERNAL,
    },
    createOtelContextFromEvent(event),
    async (span): Promise<ArvoEvent> => {
      try {
        console.log('==== Agent Initiated Conversation ====');

        const userResponse = await input({
          message: event.data?.prompt ?? 'Agent is requesting input',
        });

        span.setStatus({ code: SpanStatusCode.OK });
        return createArvoEventFactory(
          humanConversationContract.version('1.0.0'),
        ).emits({
          subject: event.data?.parentSubject$$ ?? event.subject ?? undefined,
          parentid: event.id ?? undefined,
          to: event.source ?? undefined,
          accesscontrol: event.accesscontrol ?? undefined,
          source: TEST_EVENT_SOURCE,
          type: 'evt.human.conversation.success',
          data: {
            response: userResponse,
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

async function handleHumanApproval(event: ArvoEvent): Promise<ArvoEvent> {
  return await tracer.startActiveSpan(
    'HumanConversation.Approval',
    {
      kind: SpanKind.INTERNAL,
    },
    createOtelContextFromEvent(event),
    async (span): Promise<ArvoEvent> => {
      try {
        console.log('==== Agent Initiated Plan Approval ====');

        const userResponse = await confirm({
          message: event.data?.prompt ?? 'Agent is requesting approval',
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

const memory = new ConcurrentMachineMemory();
const permissionManager = new SimplePermissionManager({
  domains: ['human.interaction'],
});

// Capturing agent stream as dependency injection as well.
const onStream: AgentStreamListener = ({ type, data }, metadata) => {
  if (type === 'agent.init') {
    console.log('==== [Agent Stream] Agent Initiated ====');
    console.log(
      JSON.stringify({ type, sourceAgent: metadata.selfId, data }, null, 2),
    );
    return;
  }
  if (type === 'agent.output') {
    console.log('==== [Agent Stream] Agent Finalised Output ====');
    console.log(
      JSON.stringify({ type, sourceAgent: metadata.selfId, data }, null, 2),
    );
    return;
  }
  if (type === 'agent.tool.request') {
    console.log('==== [Agent Stream] Tool call requested by Agent ====');
    console.log(
      JSON.stringify({ type, sourceAgent: metadata.selfId, data }, null, 2),
    );
    return;
  }
  if (type === 'agent.tool.permission.requested') {
    console.log('==== [Agent Stream] Tool permission requested by Agent ====');
    console.log(
      JSON.stringify({ type, sourceAgent: metadata.selfId, data }, null, 2),
    );
    return;
  }
};

export const executeHandlers = async (
  event: ArvoEvent,
): Promise<ArvoEvent[]> => {
  const domainedEvents: ArvoEvent[] = [];
  const response = await createConcurrentEventBroker([
    { handler: simpleAgent({ memory, permissionManager, onStream }) },
    { handler: calculatorAgent({ memory, onStream }) },
    { handler: operatorAgent({ memory, onStream }) },
    { handler: calculatorHandler() },
    { handler: essayBuilderWorkflow({ memory }) },
    { handler: essayWriterAgent({ onStream }) },
    { handler: essayOutlineAgent({ onStream }) },
  ], {
    defaultHandlerConfig: { prefetch: 1 },
    onDomainedEvents: async ({ event }) => {
      domainedEvents.push(event);
    },
  }).resolve(event);
  return response ? [response, ...domainedEvents] : domainedEvents;
};

async function main() {
  await tracer.startActiveSpan(
    'main',
    async (span) => {
      let eventToProcess: ArvoEvent = createArvoEventFactory(
        operatorAgentContract.version('1.0.0'),
      )
        .accepts({
          source: TEST_EVENT_SOURCE,
          data: {
            parentSubject$$: null,
            message: cleanString(`
                Can you answer my following queries as accurately as possible:

                - Can you solve for x in 3x + 3x^2 + 45 = 100
                - Can tell me about Astro (at a high level in 2-4 sentences)
                - Can you tell me what day it was yesterday
                - Write an essay on "State of Agentic Systems - A high-level overview"
                  The essay must have only 5 headings and each heading must have only one paragraph.

                Also in your response exactly tell me what tool did you use. And the strategy you 
                employed.
              `),
          },
        });

      let events: ArvoEvent[] = [];
      while (true) {
        const response = await executeHandlers(eventToProcess);
        events = response.length ? response : events;

        const toolRequestEventIndex = events.findIndex(
          (item) =>
            item.type ===
              SimplePermissionManager.VERSIONED_CONTRACT.accepts.type,
        );
        if (toolRequestEventIndex !== -1) {
          eventToProcess = await handlePermissionRequest(
            events[toolRequestEventIndex],
          );
          events.splice(toolRequestEventIndex, 1);
          continue;
        }

        const humanConversationEventIndex = events.findIndex(
          (item) => item.type === humanConversationContract.type,
        );
        if (humanConversationEventIndex !== -1) {
          eventToProcess = await handleHumanConversation(
            events[humanConversationEventIndex],
          );
          events.splice(humanConversationEventIndex, 1);
          continue;
        }

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
      console.log('==== Agent final output ====');
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
