import { load } from '@std/dotenv';
import {
  ArvoTestSuite,
  createSimpleEventBroker,
  runArvoTestSuites,
  SimpleMachineMemory,
} from 'arvo-event-handler';
import { denoAdapter } from './utils.ts';
import { createArvoEventFactory } from 'arvo-core';
import { expect } from '@std/expect/expect';
import { calculatorHandler } from '../handlers/calculator.service.ts';
import {
  calculatorAgent,
  calculatorAgentContract,
} from '../handlers/calculator.agent.ts';
await load({ export: true });

const TEST_EVENT_SOURCE = 'test.test.test';
const memory = new SimpleMachineMemory();

const simpleAgentIntegrationTest: ArvoTestSuite = {
  config: {
    fn: async (event) => {
      const response = await createSimpleEventBroker([
        calculatorAgent({ memory }),
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
            createArvoEventFactory(calculatorAgentContract.version('1.0.0'))
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
              calculatorAgentContract.version('1.0.0').metadata
                .completeEventType,
            );
            expect(event.data.output).toBe(2);
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
