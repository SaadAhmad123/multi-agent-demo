import { load } from '@std/dotenv';
import { simpleAgent } from './handlers/simple.agent.ts';
import { ArvoEvent, createArvoEventFactory } from 'arvo-core';
import {
  createSimpleEventBroker,
  SimpleMachineMemory,
} from 'arvo-event-handler';
import { cleanString } from 'arvo-core';
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

const memory = new SimpleMachineMemory();
const permissionManager = new SimplePermissionManager({
  domains: ['human.interaction'],
});

// Capturing agent stream as dependency injection as well.
const onStream: AgentStreamListener = ({ type, data }, metadata) => {
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
  const response = await createSimpleEventBroker([
    simpleAgent({ memory, permissionManager, onStream }),
    calculatorAgent({ memory, onStream }), // Added calculator agent
    operatorAgent({ memory, onStream }), // Added operator agent
    calculatorHandler(),
  ], {
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
          (item) => item.type === humanConversationContract.type, // The type stays the same across version
        );
        if (humanConversationEventIndex !== -1) {
          eventToProcess = await handleHumanConversation(
            events[humanConversationEventIndex],
          );
          events.splice(humanConversationEventIndex, 1);
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

/*

Console Log

==== [Agent Stream] Tool call requested by Agent ====
{
  "type": "agent.tool.request",
  "sourceAgent": "arvo.orc.agent.operator",
  "data": {
    "tool": {
      "name": "service_arvo_orc_agent_calculator",
      "kind": "arvo",
      "originalName": "arvo.orc.agent.calculator"
    },
    "usage": {
      "prompt": 741,
      "completion": 232
    },
    "executionunits": 973
  }
}
==== [Agent Stream] Tool call requested by Agent ====
{
  "type": "agent.tool.request",
  "sourceAgent": "arvo.orc.agent.operator",
  "data": {
    "tool": {
      "name": "service_arvo_orc_agent_simple",
      "kind": "arvo",
      "originalName": "arvo.orc.agent.simple"
    },
    "usage": {
      "prompt": 741,
      "completion": 232
    },
    "executionunits": 973
  }
}
==== [Agent Stream] Tool call requested by Agent ====
{
  "type": "agent.tool.request",
  "sourceAgent": "arvo.orc.agent.operator",
  "data": {
    "tool": {
      "name": "service_arvo_orc_agent_simple",
      "kind": "arvo",
      "originalName": "arvo.orc.agent.simple"
    },
    "usage": {
      "prompt": 741,
      "completion": 232
    },
    "executionunits": 973
  }
}
==== [Agent Stream] Tool call requested by Agent ====
{
  "type": "agent.tool.request",
  "sourceAgent": "arvo.orc.agent.simple",
  "data": {
    "tool": {
      "name": "internal_current_date_tool",
      "kind": "internal",
      "originalName": "currentDateTool"
    },
    "usage": {
      "prompt": 112,
      "completion": 12
    },
    "executionunits": 124
  }
}
==== [Agent Stream] Tool call requested by Agent ====
{
  "type": "agent.tool.request",
  "sourceAgent": "arvo.orc.agent.simple",
  "data": {
    "tool": {
      "name": "mcp_search_astro_docs",
      "kind": "mcp",
      "originalName": "search_astro_docs"
    },
    "usage": {
      "prompt": 123,
      "completion": 21
    },
    "executionunits": 144
  }
}
==== [Agent Stream] Tool permission requested by Agent ====
{
  "type": "agent.tool.permission.requested",
  "sourceAgent": "arvo.orc.agent.simple",
  "data": {
    "tools": [
      {
        "name": "mcp_search_astro_docs",
        "kind": "mcp",
        "originalName": "search_astro_docs"
      }
    ],
    "usage": {
      "prompt": 123,
      "completion": 21
    },
    "executionunits": 144
  }
}
==== [Agent Stream] Tool call requested by Agent ====
{
  "type": "agent.tool.request",
  "sourceAgent": "arvo.orc.agent.calculator",
  "data": {
    "tool": {
      "name": "service_com_human_conversation",
      "kind": "arvo",
      "originalName": "com.human.conversation"
    },
    "usage": {
      "prompt": 1783,
      "completion": 314
    },
    "executionunits": 2097
  }
}
==== Agent Requesting Tool Use Permission ====
✔ Agent arvo.orc.agent.simple is requesting permission to execute following tools No
==== Agent Initiated Conversation ====
✔ I need to solve the quadratic equation 3x + 3x² + 45 = 100 for x. Here's my execution plan:

1. First, I'll rearrange the equation to standard form: 3x² + 3x + 45 - 100 = 0, which simplifies to 3x² + 3x - 55 = 0

2. I'll use the quadratic formula: x = (-b ± √(b² - 4ac)) / (2a), where a = 3, b = 3, c = -55

3. I'll calculate the discriminant: b² - 4ac = 3² - 4(3)(-55) = 9 + 660 = 669

4. Then calculate the two solutions:
   - x₁ = (-3 + √669) / 6
   - x₂ = (-3 - √669) / 6

5. I'll use the calculator to compute √669 and then the final values for both solutions.

Does this approach look correct to you? Should I proceed with these calculations? why this way?
==== [Agent Stream] Tool call requested by Agent ====
{
  "type": "agent.tool.request",
  "sourceAgent": "arvo.orc.agent.calculator",
  "data": {
    "tool": {
      "name": "service_com_human_conversation",
      "kind": "arvo",
      "originalName": "com.human.conversation"
    },
    "usage": {
      "prompt": 3899,
      "completion": 623
    },
    "executionunits": 4522
  }
}
==== Agent Initiated Conversation ====
✔ Good question! I'm using the quadratic formula because this is a quadratic equation (it has an x² term). Let me explain why this is the most reliable approach:

The equation 3x + 3x² + 45 = 100 is a quadratic equation because of the x² term. When rearranged to standard form (ax² + bx + c = 0), it becomes 3x² + 3x - 55 = 0.

For quadratic equations, we have a few options:
1. **Quadratic formula** - Always works for any quadratic equation
2. **Factoring** - Only works if the equation factors nicely (which this one doesn't appear to)
3. **Completing the square** - Works but is more complex for this particular equation

The quadratic formula is the most systematic and reliable method here. It will give us the exact solutions.

Would you prefer I try a different approach, or shall I proceed with the quadratic formula method I outlined? in quadratic way how many tool calls will be done show me all of them
==== [Agent Stream] Tool call requested by Agent ====
{
  "type": "agent.tool.request",
  "sourceAgent": "arvo.orc.agent.calculator",
  "data": {
    "tool": {
      "name": "service_com_human_conversation",
      "kind": "arvo",
      "originalName": "com.human.conversation"
    },
    "usage": {
      "prompt": 6327,
      "completion": 966
    },
    "executionunits": 7293
  }
}
==== Agent Initiated Conversation ====
✔ Great question! Let me break down all the calculator tool calls I'll need for the quadratic formula approach:

**Tool Call 1:** Calculate the discriminant
- Expression: "3**2 - 4*3*(-55)"
- This gives us b² - 4ac = 9 + 660 = 669

**Tool Call 2:** Calculate √669
- Expression: "sqrt(669)"
- This gives us the square root of the discriminant

**Tool Call 3:** Calculate the first solution x₁
- Expression: "(-3 + sqrt(669)) / (2*3)"
- This is (-b + √discriminant) / (2a)

**Tool Call 4:** Calculate the second solution x₂
- Expression: "(-3 - sqrt(669)) / (2*3)"
- This is (-b - √discriminant) / (2a)

**Total: 4 tool calls**

Since some of these calculations are independent (like calculating √669 separately), I can potentially run some in parallel to be more efficient.

Would you like me to proceed with this plan, or would you prefer to see a different approach? do it
==== [Agent Stream] Tool call requested by Agent ====
{
  "type": "agent.tool.request",
  "sourceAgent": "arvo.orc.agent.calculator",
  "data": {
    "tool": {
      "name": "service_com_calculator_execute",
      "kind": "arvo",
      "originalName": "com.calculator.execute"
    },
    "usage": {
      "prompt": 9092,
      "completion": 1209
    },
    "executionunits": 10301
  }
}
==== [Agent Stream] Tool call requested by Agent ====
{
  "type": "agent.tool.request",
  "sourceAgent": "arvo.orc.agent.calculator",
  "data": {
    "tool": {
      "name": "service_com_calculator_execute",
      "kind": "arvo",
      "originalName": "com.calculator.execute"
    },
    "usage": {
      "prompt": 9092,
      "completion": 1209
    },
    "executionunits": 10301
  }
}
==== [Agent Stream] Tool call requested by Agent ====
{
  "type": "agent.tool.request",
  "sourceAgent": "arvo.orc.agent.calculator",
  "data": {
    "tool": {
      "name": "service_com_calculator_execute",
      "kind": "arvo",
      "originalName": "com.calculator.execute"
    },
    "usage": {
      "prompt": 9092,
      "completion": 1209
    },
    "executionunits": 10301
  }
}
==== [Agent Stream] Tool call requested by Agent ====
{
  "type": "agent.tool.request",
  "sourceAgent": "arvo.orc.agent.calculator",
  "data": {
    "tool": {
      "name": "service_com_calculator_execute",
      "kind": "arvo",
      "originalName": "com.calculator.execute"
    },
    "usage": {
      "prompt": 9092,
      "completion": 1209
    },
    "executionunits": 10301
  }
}
==== Agent final output ====
{
  "id": "7efc16cb-7fe6-436e-a772-baaaaeb80630",
  "source": "arvo.orc.agent.operator",
  "specversion": "1.0",
  "type": "arvo.orc.agent.operator.done",
  "subject": "eJw9jtEKgzAMRf8lz7a0Tjvn38Q2bgXbjhplIP77woS95OGey7k5oFT/opUrcqkwHpAxEYyAdS9amMYnZdblTVejgZ3qGkuWjtVGGzgboA/5jX/hATEIotk553ur7DAE1bX+oaYZb6pzw70NfWfayYgr5sjxWgaWL/T/CAwlYRRl3pZFRhIxiv88v+sOOnU=",
  "datacontenttype": "application/cloudevents+json;charset=UTF-8;profile=arvo",
  "dataschema": "#/org/amas/agent/operator/1.0.0",
  "data": {
    "response": "## Answers to your queries:\n\n1. **Solving 3x + 3x² + 45 = 100:**\n   The equation has two solutions: x ≈ 3.811 or x ≈ -4.811. The calculator agent rearranged it to standard form (3x² + 3x - 55 = 0) and used the quadratic formula to find both solutions.\n\n2. **About Astro:**\n   Astro is a modern web framework designed for building fast, content-focused websites. It emphasizes performance by delivering only the necessary JavaScript to the browser, and it supports a wide range of UI frameworks like React, Vue, and Svelte. Astro is particularly well-suited for static site generation and offers a component-based architecture.\n\n3. **Yesterday's day:**\n   Yesterday was December 14, 2025, which was a Sunday.\n\n## Tools Used and Strategy:\n\n**Tools Used:**\n- \`service_arvo_orc_agent_calculator\` for the mathematical equation\n- \`service_arvo_orc_agent_simple\` for both the Astro information and the date question\n\n**Strategy Employed:**\nI used a **parallel execution strategy** since all three queries were independent and could be processed simultaneously. I made all three tool calls at once rather than sequentially, which is more efficient and follows the directive to parallelize when possible. Each query was routed to the most appropriate agent - the calculator agent for the mathematical problem and the simple agent for the informational queries about Astro and the date."
  },
  "time": "2025-12-16T00:32:41.890+00:00",
  "to": "test.test.test",
  "accesscontrol": null,
  "redirectto": "arvo.orc.agent.operator",
  "executionunits": 2608,
  "traceparent": "00-033a331168a70644cdfd2290cf224d60-1a4e299fcce4fec8-01",
  "tracestate": null,
  "parentid": "ea92c23b-88d0-4a45-99c6-d3098afa156a",
  "domain": null
}

*/
