import { load } from '@std/dotenv';
import {
  ArvoTestSuite,
  createSimpleEventBroker,
  runArvoTestSuites,
  SimpleMachineMemory,
} from 'arvo-event-handler';
import { simpleAgent, simpleAgentContract } from '../handlers/simple.agent.ts';
import { denoAdapter } from './utils.ts';
import { createArvoEventFactory } from 'arvo-core';
import { expect } from '@std/expect/expect';
import { calculatorHandler } from '../handlers/calculator.service.ts';
await load({ export: true });

const TEST_EVENT_SOURCE = 'test.test.test';
const memory = new SimpleMachineMemory();

const simpleAgentIntegrationTest: ArvoTestSuite = {
  config: {
    fn: async (event) => {
      const response = await createSimpleEventBroker([
        simpleAgent({ memory }),
        calculatorHandler(),
      ]).resolve(event);

      return { events: response ? [response] : [] };
    },
  },
  cases: [
    {
      name: 'should process calculation request respond with the final event',
      steps: [
        {
          input: () =>
            createArvoEventFactory(simpleAgentContract.version('1.0.0'))
              .accepts({
                source: TEST_EVENT_SOURCE,
                data: {
                  parentSubject$$: null,
                  message: 'Can you give me the average of 1,2,3?',
                },
              }),
          expectedEvents: (events) => {
            expect(events.length).toBe(1);
            const event = events[0]!;
            expect(event.type).toBe(
              simpleAgentContract.version('1.0.0').metadata.completeEventType,
            );
            expect(event.data.response).toContain('2');
            return true;
          },
        },
      ],
    },
  ],
};

runArvoTestSuites([
  simpleAgentIntegrationTest,
], denoAdapter);
