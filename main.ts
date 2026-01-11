import { load } from '@std/dotenv';
import { simpleAgent } from './handlers/simple.agent.ts';
import {
  ArvoEvent,
  ArvoOpenTelemetry,
  createArvoEventFactory,
} from 'arvo-core';
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
  connectPostgresMachineMemory,
  createPostgresMachineMemoryTables,
  releasePostgressMachineMemory,
} from '@arvo-tools/postgres';
import { ArvoPgBoss } from './pgboss/index.ts';
const TEST_EVENT_SOURCE = 'test.test.test';

const tracer = ArvoOpenTelemetry.getInstance().tracer;
await createPostgresMachineMemoryTables(
  Deno.env.get('POSTGRES_DB_URL') ?? '',
  {
    version: 1,
  },
);

const memory = await connectPostgresMachineMemory({
  version: 1,
  config: {
    connectionString: Deno.env.get('POSTGRES_DB_URL') ?? '',
    enableOtel: false,
  },
});

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

const broker = new ArvoPgBoss({
  connectionString: Deno.env.get('POSTGRES_DB_URL') ?? '',
});

broker.on('error', console.error);

await broker.start();
await broker.register(simpleAgent({ memory, permissionManager, onStream }), {
  recreateQueue: true,
});
await broker.register(calculatorAgent({ memory, onStream }), {
  recreateQueue: true,
});
await broker.register(operatorAgent({ memory, onStream }), {
  recreateQueue: true,
});
await broker.register(calculatorHandler(), { recreateQueue: true });
await broker.register(essayBuilderWorkflow({ memory }), {
  recreateQueue: true,
});
await broker.register(essayWriterAgent({ onStream }), { recreateQueue: true });
await broker.register(essayOutlineAgent({ onStream }), { recreateQueue: true });

broker.onDomainedEvent(async (event) => {
  let evtToProcess: ArvoEvent | null = null;

  if (event.type === SimplePermissionManager.VERSIONED_CONTRACT.accepts.type) {
    evtToProcess = await handlePermissionRequest(event);
  } else if (event.type === humanConversationContract.type) {
    evtToProcess = await handleHumanConversation(event);
  } else if (event.type === humanApprovalContract.type) {
    evtToProcess = await handleHumanApproval(event);
  } else {
    console.log('Unrecognized event domain', event.domain);
  }

  if (evtToProcess) {
    await broker.dispatch(evtToProcess);
  }
});

broker.onWorkflowComplete({
  source: TEST_EVENT_SOURCE,
  listener: (event) => {
    console.log('==== Agent final output ====');
    console.log(event.toString(2));
  },
  options: {
    recreateQueue: true,
  },
});

async function main() {
  await tracer.startActiveSpan(
    'main',
    async () => {
      const eventToProcess: ArvoEvent = createArvoEventFactory(
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
      await broker.dispatch(eventToProcess);
    },
  );
}

if (import.meta.main) {
  await main();
  while (true) {
    await new Promise((res) => setTimeout(res, 2000));
    const resp = await broker.getStats();
    let allSettled = true;
    for (const item of resp) {
      if (item.activeCount !== 0 || item.queuedCount !== 0) {
        allSettled = false;
      }
    }
    if (allSettled) break;
  }
  console.log('Stopping');
  await broker.stop();
  await releasePostgressMachineMemory(memory);
}
