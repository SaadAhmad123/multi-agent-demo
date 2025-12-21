import {
  ArvoTestSuite,
  runArvoTestSuites,
  SimpleMachineMemory,
} from 'arvo-event-handler';
import {
  averageWorkflow,
  averageWorkflowContract,
} from '../handlers/average.workflow.ts';
import { createArvoEventFactory } from 'arvo-core';
import { expect } from '@std/expect/expect';
import { addContract } from '../handlers/add.service.ts';
import { productContract } from '../handlers/product.service.ts';
import { denoAdapter } from './utils.ts';

const TEST_EVENT_SOURCE = 'test.test.test';
const memory = new SimpleMachineMemory();

const TEST_DATA = [1, 2, 3, 4, 5];

const unitTest: ArvoTestSuite = {
  config: {
    handler: averageWorkflow({ memory }),
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
            expect(events[0].type).toBe(addContract.type);
            expect(JSON.stringify(events[0].data.numbers)).toBe(
              JSON.stringify(TEST_DATA),
            );
            return true;
          },
        },
        {
          input: (prev) =>
            createArvoEventFactory(addContract.version('1.0.0')).emits({
              // Stitching the context previous event
              subject: prev?.[0]?.data?.parentSubject$$ ?? prev?.[0]?.subject ??
                undefined,
              parentid: prev?.[0]?.id ?? undefined,
              to: prev?.[0]?.source ?? undefined,
              accesscontrol: prev?.[0]?.accesscontrol ?? undefined,
              // Defining the next event data
              source: TEST_EVENT_SOURCE,
              type: 'evt.calculator.add.success',
              data: {
                result: (prev?.[0]?.data?.numbers as number[])?.reduce(
                  (acc, cur) => acc + cur,
                  0,
                ),
              },
            }),
          expectedEvents: (events) => {
            expect(events.length).toBe(1);
            expect(events[0].type).toBe(productContract.type);
            expect(JSON.stringify(events[0].data.numbers)).toBe(JSON.stringify([
              TEST_DATA.reduce((acc, cur) => acc + cur, 0),
              1 / TEST_DATA.length,
            ]));
            return true;
          },
        },
        {
          input: (prev) =>
            createArvoEventFactory(productContract.version('1.0.0')).emits({
              // Stitching the context previous event
              subject: prev?.[0]?.data?.parentSubject$$ ?? prev?.[0]?.subject ??
                undefined,
              parentid: prev?.[0]?.id ?? undefined,
              to: prev?.[0]?.source ?? undefined,
              accesscontrol: prev?.[0]?.accesscontrol ?? undefined,
              // Defining the next event data
              source: TEST_EVENT_SOURCE,
              type: 'evt.calculator.product.success',
              data: {
                result: (prev?.[0]?.data?.numbers as number[])?.reduce(
                  (acc, cur) => acc * cur,
                  1,
                ),
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
  unitTest,
], denoAdapter);
