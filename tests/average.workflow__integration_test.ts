import {
  ArvoTestSuite,
  createSimpleEventBroker,
  runArvoTestSuites,
  SimpleMachineMemory,
} from 'arvo-event-handler';
import {
  averageWorkflow,
  averageWorkflowContract,
} from '../handlers/average.workflow.ts';
import { ArvoEvent, createArvoEventFactory } from 'arvo-core';
import { expect } from '@std/expect/expect';
import { addHandler } from '../handlers/add.service.ts';
import { productHandler } from '../handlers/product.service.ts';
import { denoAdapter } from './utils.ts';

const TEST_EVENT_SOURCE = 'test.test.test';
const memory = new SimpleMachineMemory();
const TEST_DATA = [1, 2, 3, 4, 5];

const integrationTest: ArvoTestSuite = {
  config: {
    fn: async (event: ArvoEvent) => {
      const response = await createSimpleEventBroker([
        addHandler(),
        averageWorkflow({ memory }),
        productHandler(),
      ]).resolve(event);
      return { events: response ? [response] : [] };
    },
  },
  cases: [
    {
      name:
        'should emit the addition event, then the product event and then the final event',
      steps: [
        {
          input: () =>
            createArvoEventFactory(averageWorkflowContract.version('1.0.0'))
              .accepts({
                source: TEST_EVENT_SOURCE,
                data: {
                  parentSubject$$: null, // This is a requirement from the orchestrator contract.
                  numbers: TEST_DATA,
                },
              }),
          expectedEvents: (events) => {
            expect(events.length).toBe(1);
            expect(events[0].type).toBe(
              averageWorkflowContract.metadata.completeEventType,
            );
            expect(events[0].data.average).toBe(
              TEST_DATA.reduce((acc, cur) => acc + cur, 0) / TEST_DATA.length,
            );
            return true;
          },
        },
      ],
    },
  ],
};

runArvoTestSuites([
  integrationTest,
], denoAdapter);
