import { ArvoEvent } from 'arvo-core';
import {
  createSimpleEventBroker,
  SimpleMachineMemory,
} from 'arvo-event-handler';
import { simpleAgent } from './simple.agent.ts';
import { addHandler } from './add.service.ts';
import { productHandler } from './product.service.ts';
import { weightedAverageResumable } from './weighted.average.resumable.ts';

export const executeHandlers = async (
  event: ArvoEvent,
): Promise<ArvoEvent[]> => {
  const memory = new SimpleMachineMemory();
  const domainedEvents: ArvoEvent[] = [];

  const response = await createSimpleEventBroker([
    simpleAgent({ memory }),
    addHandler(),
    productHandler(),
    weightedAverageResumable({ memory }),
  ], {
    // deno-lint-ignore require-await
    onDomainedEvents: async ({ event }) => {
      domainedEvents.push(event);
    },
  }).resolve(event);

  return response ? [response, ...domainedEvents] : domainedEvents;
};
