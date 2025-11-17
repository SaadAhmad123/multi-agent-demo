import {
  createSimpleEventBroker,
  runArvoTestSuites,
  SimpleMachineMemory,
  type ArvoTestSuite,
} from 'arvo-event-handler';
import { beforeEach, describe, expect, test } from 'vitest';
import { demoOrchestrator } from '../src/handlers/orchestrator.demo/index.js';
import { type ArvoEvent, createArvoEventFactory } from 'arvo-core';
import { demoOrchestratorContract } from '../src/handlers/orchestrator.demo/contract.js';
import { humanApprovalContract } from '../src/handlers/human.approval.contract.js';
import { addContract, addHandler } from '../src/handlers/add.service.js';
import { productContract, productHandler } from '../src/handlers/product.service.js';

const TEST_EVENT_SOURCE = 'test.test.test';

// Using the following event context mechanims to demonstrate multiple ways of stiching event context
// This is especially useful for orchestrations which emit multiple events in parrallel.
let eventContext:
  | {
      subject: string | undefined;
      parentid: string;
      to: string;
    }
  | undefined = undefined;

const updateEventContext = (evt: ArvoEvent) => {
  eventContext = {
    subject: evt.data.parentSubject$$ ?? evt.subject ?? undefined,
    parentid: evt.id,
    to: evt.source,
  };
};

const machineMemory = new SimpleMachineMemory();
const orchestratorUnitTest: ArvoTestSuite = {
  config: {
    handler: demoOrchestrator({
      memory: machineMemory,
    }),
  },

  cases: [
    {
      name: 'must emit follow the expected pipeline behaviour',
      steps: [
        {
          input: () =>
            createArvoEventFactory(demoOrchestratorContract.version('1.0.0')).accepts({
              source: TEST_EVENT_SOURCE,
              data: {
                parentSubject$$: null,
                values: [1, 2, 3],
              },
            }),
          expectedEvents: (events) => {
            expect(events).toHaveLength(1);
            // biome-ignore lint/style/noNonNullAssertion: <explanation>
            const evt = events[0]!;
            updateEventContext(evt);
            expect(evt.type).toBe(humanApprovalContract.type);
            expect(evt.domain).toBe('human.interaction');
            return true;
          },
        },
        {
          input: (prev) =>
            createArvoEventFactory(humanApprovalContract.version('1.0.0')).emits({
              // Stitching the context previous event
              subject: prev?.[0]?.data?.parentSubject$$ ?? prev?.[0]?.subject ?? undefined,
              parentid: prev?.[0]?.id ?? undefined,
              to: prev?.[0]?.source ?? undefined,
              // Defining the next event data
              type: 'evt.human.approval.success',
              source: TEST_EVENT_SOURCE,
              data: {
                approval: true,
              },
            }),
          expectedEvents: (events) => {
            expect(events).toHaveLength(2);
            // biome-ignore lint/style/noNonNullAssertion: This is always non-zero
            updateEventContext(events[0]!);
            const eventTypes = events?.map((item) => item.type) ?? [];
            expect(eventTypes).toContain(addContract.type);
            expect(eventTypes).toContain(productContract.type);
            return true;
          },
        },
        {
          // Input can be sync or async
          input: async () =>
            createArvoEventFactory(addContract.version('1.0.0')).emits({
              subject: eventContext?.subject,
              parentid: eventContext?.parentid,
              to: eventContext?.to,
              type: 'evt.calculator.add.success',
              source: TEST_EVENT_SOURCE,
              data: {
                result: 6,
              },
            }),
          expectedEvents: (events) => {
            expect(events.length).toBe(0);
            return true;
          },
        },
        {
          // Input can be sync or async
          input: async () =>
            createArvoEventFactory(productContract.version('1.0.0')).emits({
              subject: eventContext?.subject,
              parentid: eventContext?.parentid,
              to: eventContext?.to,
              type: 'evt.calculator.product.success',
              source: TEST_EVENT_SOURCE,
              data: {
                result: 6,
              },
            }),
          expectedEvents: (events) => {
            expect(events.length).toBe(1);
            // biome-ignore lint/style/noNonNullAssertion: Cannot be empty
            const evt = events[0]!;
            expect(evt.type).toBe(demoOrchestratorContract.metadata.completeEventType);
            expect(evt.data.success).toBe(true);
            expect(evt.data.product).toBe(6);
            expect(evt.data.sum).toBe(6);
            expect(evt.data.result).toBe(1);
            return true;
          },
        },
      ],
    },
  ],
};

// Let's test the system together. Not just the orchestrator but along
// with the other handlers. This is a form of integration testing in Arvo.
// Since Arvo is an application layer construct it limits its purview to
// business logic integration testing and enables engineers to leverage their
// existing infrastructure tools to test the handlers over the infrastructure
const orchestratorIntegrationTest: ArvoTestSuite = {
  config: {
    name: 'DemoOrchestratorIntegrationTest',
    fn: async (event) => {
      let domainedEvent: ArvoEvent | null = null;
      const result = await createSimpleEventBroker(
        [addHandler(), productHandler(), demoOrchestrator({ memory: machineMemory })],
        {
          onDomainedEvents: async ({ event }) => {
            domainedEvent = event;
          },
        },
      ).resolve(event);
      const resolvedEvent = result ?? domainedEvent ?? null;
      return { events: resolvedEvent === null ? [] : [resolvedEvent] };
    },
  },

  cases: [
    {
      name: 'full integration test',
      steps: [
        {
          input: () =>
            createArvoEventFactory(demoOrchestratorContract.version('1.0.0')).accepts({
              source: TEST_EVENT_SOURCE,
              data: {
                parentSubject$$: null,
                values: [2, 3, 4],
              },
            }),
          expectedEvents: (events) => {
            expect(events.length).toBe(1);
            // biome-ignore lint/style/noNonNullAssertion: Cannot be null
            const evt = events[0]!;
            expect(evt.type).toBe(humanApprovalContract.type);
            return true;
          },
        },
        {
          input: (prev) =>
            createArvoEventFactory(humanApprovalContract.version('1.0.0')).emits({
              // Stitching the context previous event
              subject: prev?.[0]?.data?.parentSubject$$ ?? prev?.[0]?.subject ?? undefined,
              parentid: prev?.[0]?.id ?? undefined,
              to: prev?.[0]?.source ?? undefined,
              // Defining the next event data
              type: 'evt.human.approval.success',
              source: TEST_EVENT_SOURCE,
              data: {
                approval: true,
              },
            }),
          expectedEvents: (events) => {
            expect(events.length).toBe(1);
            // biome-ignore lint/style/noNonNullAssertion: Cannot be empty
            const evt = events[0]!;
            expect(evt.type).toBe(demoOrchestratorContract.metadata.completeEventType);
            expect(evt.data.success).toBe(true);
            expect(evt.data.product).toBe(24);
            expect(evt.data.sum).toBe(9);
            expect(evt.data.result).toBe(9 / 24);
            return true;
          },
        },
      ],
    },
  ],
};

runArvoTestSuites([orchestratorUnitTest, orchestratorIntegrationTest], { test, describe, beforeEach });
