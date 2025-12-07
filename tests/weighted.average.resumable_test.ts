import {
  ArvoTestSuite,
  createSimpleEventBroker,
  runArvoTestSuites,
  SimpleMachineMemory,
} from 'arvo-event-handler';
import { denoAdapter } from './utils.ts';
import { ArvoEvent, createArvoEventFactory } from 'arvo-core';
import { addHandler } from '../handlers/add.service.ts';
import { productHandler } from '../handlers/product.service.ts';
import {
  weightedAverageContract,
  weightedAverageResumable,
} from '../handlers/weighted.average.resumable.ts';
import { expect } from '@std/expect';
import { humanApprovalContract } from '../handlers/human.approval.contract.ts';

const TEST_EVENT_SOURCE = 'test.test.test';
const memory = new SimpleMachineMemory();

// Test data: [value, weight] pairs
const TEST_INPUT = [
  [34, 0.2],
  [45, 0.1],
  [67, 0.7],
];

const resumableIntegrationTest: ArvoTestSuite = {
  config: {
    fn: async (event) => {
      const domainedEvents: ArvoEvent[] = [];
      const response = await createSimpleEventBroker([
        addHandler(),
        productHandler(),
        weightedAverageResumable({ memory }),
      ], {
        // deno-lint-ignore require-await
        onDomainedEvents: async ({ event }) => {
          domainedEvents.push(event);
        },
      }).resolve(event);
      return {
        events: response ? [response, ...domainedEvents] : domainedEvents,
      };
    },
  },
  cases: [
    {
      name: 'must complete the whole workflow',
      steps: [
        {
          input: () =>
            createArvoEventFactory(weightedAverageContract.version('1.0.0'))
              .accepts({
                source: TEST_EVENT_SOURCE,
                data: {
                  // parentSubject$$ identifies parent orchestrator (null = root workflow)
                  parentSubject$$: null,
                  input: TEST_INPUT.map(([value, weight]) => ({
                    value,
                    weight,
                  })),
                },
              }),
          expectedEvents: (events) => {
            expect(events).toHaveLength(1);
            const evt = events[0]!;
            expect(evt.type).toBe(humanApprovalContract.type);
            expect(evt.domain).toBe('human.interaction');
            return true;
          },
        },
        {
          input: (prev) =>
            createArvoEventFactory(humanApprovalContract.version('1.0.0'))
              .emits({
                subject: prev?.[0]?.data?.parentSubject$$ ??
                  prev?.[0]?.subject ?? undefined,
                parentid: prev?.[0]?.id ?? undefined,
                to: prev?.[0]?.source ?? undefined,
                accesscontrol: prev?.[0]?.accesscontrol ?? undefined,
                type: 'evt.human.approval.success',
                source: TEST_EVENT_SOURCE,
                data: {
                  approval: true,
                },
              }),
          expectedEvents: (events) => {
            expect(events).toHaveLength(1);
            const evt = events[0]!;
            expect(evt.type).toBe(
              weightedAverageContract.metadata.completeEventType,
            );
            const expectedAvg = TEST_INPUT.reduce(
              (acc, [value, weight]) => acc + (value * weight), 
              0
            ) / TEST_INPUT.length;
            expect(evt.data.output.toFixed(1)).toBe(expectedAvg.toFixed(1));
            return true;
          },
        },
      ],
    },
  ],
};

runArvoTestSuites([
  resumableIntegrationTest,
], denoAdapter);
