import { IArvoEventHandler } from 'arvo-event-handler';
import { ArvoEvent } from 'arvo-core';
import { ConcurrentEventBroker } from './index.ts';

export const createConcurrentEventBroker = (
  handlers: {
    handler: IArvoEventHandler;
    prefetch?: number;
  }[],
  options?: {
    onError?: (error: Error, event: ArvoEvent) => void;
    onDomainedEvents?: (param: {
      domain: string;
      event: ArvoEvent;
      broker: ConcurrentEventBroker;
    }) => Promise<void>;
  },
) => {
  const broker = new ConcurrentEventBroker({
    errorHandler: options?.onError ??
      ((error, event) => {
        console.error('Broker error:', {
          message: error.message,
          eventType: event.to,
          event,
        });
      }),
  });

  for (const { handler, prefetch } of handlers) {
    broker.subscribe(
      async (event, publish) => {
        const { events } = await handler.execute(event, {
          inheritFrom: 'EVENT',
        });
        for (const evt of events) {
          if (evt.domain) {
            options?.onDomainedEvents?.({
              domain: evt.domain,
              event: evt,
              broker: broker,
            });
          } else {
            publish(evt);
          }
        }
      },
      {
        topic: handler.source,
        prefetch: prefetch || 1, // Don't allow 0
      },
    );
  }

  const resolve = async (_event: ArvoEvent): Promise<ArvoEvent | null> => {
    if (broker.topics.includes(_event.source)) {
      throw new Error(
        `The event source cannot be one of the handlers in the broker. Please update the event.source, the given is '${_event.source}'`,
      );
    }
    let resolvedEvent: ArvoEvent | null = null;
    broker.subscribe(async (event) => {
      resolvedEvent = event;
    }, {
      topic: _event.source,
      prefetch: 1,
    });
    broker.publish(_event);
    await broker.waitForIdle();
    if (resolvedEvent === null) {
      return null;
    }
    return resolvedEvent;
  };

  return {
    broker,
    resolve,
  };
};
