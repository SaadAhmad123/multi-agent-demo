import {
  calculatorAgent,
  calculatorHandler,
  webInfoAgent,
  findDomainMcpAgent,
  astroDocsMcpAgent,
  fetchWebMcpAgent,
  operatorAgent,
  githubMcpAgent,
} from '@repo/agentic-handlers';
import type { ArvoEvent } from 'arvo-core';
import { createSimpleEventBroker, type IMachineMemory } from 'arvo-event-handler';

/**
 * Executes an ArvoEvent through the event broker system, routing it to the appropriate handler.
 * Creates a simple event broker with calculator handlers and processes the event, capturing any emitted domain events.
 *
 * const event = createArvoEventFactory(contract).accepts({ ... });
 * const result = await execute(event, memory);
 * ```
 */
export const execute = async (
  event: ArvoEvent,
  memory: IMachineMemory<Record<string, unknown>>,
): Promise<ArvoEvent | null> => {
  let domainedEvent: ArvoEvent | null = null;
  const { resolve } = createSimpleEventBroker(
    [
      calculatorHandler(),
      calculatorAgent.handlerFactory({ memory }),
      webInfoAgent.handlerFactory({ memory }),
      findDomainMcpAgent.handlerFactory(),
      astroDocsMcpAgent.handlerFactory(),
      fetchWebMcpAgent.handlerFactory(),
      operatorAgent.handlerFactory({ memory }),
      githubMcpAgent.handlerFactory(),
    ],
    {
      onDomainedEvents: async ({ event }) => {
        domainedEvent = event;
      },
    },
  );
  return (await resolve(event)) ?? domainedEvent;
};
