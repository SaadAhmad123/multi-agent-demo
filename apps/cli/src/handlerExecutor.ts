import {
  findDomainMcpAgent,
  astroDocsMcpAgent,
  calculatorAgent,
  calculatorHandler,
  operatorAgent,
  githubMcpAgent,
  zapierGmailAndWeatherMcpAgent,
  zapierGoogleDocsMcpAgent,
  fetchWebMcpAgent,
} from '@repo/agentic-handlers';
import type { ArvoEvent } from 'arvo-core';
import { createSimpleEventBroker, type IMachineMemory } from 'arvo-event-handler';

export const humanInteractionServiceDomain = 'human.interaction';

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
  const humanInteractionDomain = [humanInteractionServiceDomain] as [string, ...string[]];
  const { resolve } = createSimpleEventBroker(
    [
      calculatorHandler(),
      operatorAgent({ memory, humanInteractionDomain }),
      calculatorAgent({ memory, humanInteractionDomain }),
      astroDocsMcpAgent({ memory, humanInteractionDomain }),
      githubMcpAgent({ memory }),
      zapierGmailAndWeatherMcpAgent({ memory }),
      zapierGoogleDocsMcpAgent({ memory, humanInteractionDomain }),
      findDomainMcpAgent({ memory }),
      fetchWebMcpAgent({ memory }),
    ],
    {
      onDomainedEvents: async ({ event }) => {
        domainedEvent = event;
      },
    },
  );
  return (await resolve(event)) ?? domainedEvent;
};
