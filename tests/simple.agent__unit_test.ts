import { load } from '@std/dotenv';
import {
  ArvoTestSuite,
  runArvoTestSuites,
  SimpleMachineMemory,
} from 'arvo-event-handler';
import { simpleAgent, simpleAgentContract } from '../handlers/simple.agent.ts';
import { denoAdapter } from './utils.ts';
import { createArvoEventFactory } from 'arvo-core';
import { expect } from '@std/expect/expect';
import { calculatorContract } from '../handlers/calculator.service.ts';
await load({ export: true });

const TEST_EVENT_SOURCE = 'test.test.test';
const memory = new SimpleMachineMemory();

const simpleAgentUnitTest: ArvoTestSuite = {
  config: {
    handler: simpleAgent({ memory }),
  },
  cases: [
    {
      name:
        'should process calculation request correctly by emitting calculator events and processing the response',
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
              calculatorContract.version('1.0.0').accepts.type,
            );
            expect(event.data.expression).toBeDefined();
            return true;
          },
        },
        {
          input: (prev) =>
            createArvoEventFactory(calculatorContract.version('1.0.0')).emits({
              // Stitching the context previous event
              subject: prev?.[0]?.data?.parentSubject$$ ?? prev?.[0]?.subject ??
                undefined,
              parentid: prev?.[0]?.id ?? undefined,
              to: prev?.[0]?.source ?? undefined,
              accesscontrol: prev?.[0]?.accesscontrol ?? undefined,
              // Defining the next event data
              type: 'evt.calculator.execute.success',
              source: TEST_EVENT_SOURCE,
              data: {
                result: 2,
                expression: '(1+2+3)/3',
              },
            }),
          expectedEvents: (events) => {
            expect(events.length).toBe(1);
            const event = events[0]!;
            // The orchestrator contract API provides the metadata.completeEventType
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
  simpleAgentUnitTest,
], denoAdapter);
