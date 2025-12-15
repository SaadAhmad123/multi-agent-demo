import { type ArvoEvent, createArvoEventFactory } from 'arvo-core';
import { createSimpleEventBroker } from 'arvo-event-handler';
import { addContract, addHandler } from './handlers/add.service.ts';
import { productContract, productHandler } from './handlers/product.service.ts';

/**
 * Creates an in-memory event broker that automatically routes events to registered handlers.
 *
 * The broker uses event routing based on the 'event.to' field matching the handler's 'handler.source' field.
 * The 'resolve' function processes the event through the appropriate handler and returns
 * the final result after all event processing is complete.
 *
 * This pattern enables event brokering without requiring external message brokers and is helpful
 * for rapid development, limited-scoped projects, and testing
 */
const executeBroker = async (event: ArvoEvent) =>
  await createSimpleEventBroker([addHandler(), productHandler()]).resolve(
    event,
  );

export const executeWithEventBrokerPattern = async () => {
  const additionEvent = createArvoEventFactory(addContract.version('1.0.0'))
    .accepts({
      source: 'test.test.test',
      data: {
        numbers: [1, 2, 3, 4],
      },
    });

  const greetingEvent = createArvoEventFactory(productContract.version('1.0.0'))
    .accepts({
      source: 'test.test.test',
      data: {
        numbers: [1, 2, 3, 4],
      },
    });

  await executeBroker(additionEvent).then((result) =>
    console.log(result?.toString(2) ?? 'No event resolved')
  );
  await executeBroker(greetingEvent).then((result) =>
    console.log(result?.toString(2) ?? 'No event resolved')
  );
};

/**
 *  {
 *  "id": "128475f4-7ad6-45dc-a52f-ca686d726f03",
 *    "source": "com.calculator.add",
 *    "specversion": "1.0",
 *    "type": "evt.calculator.add.success",
 *    "subject": "eJw9jksKwzAMRO+idWwcOwl1bqPKKjX4A45TAiF3r9pCN7OYB2/mhNroyVtv2GuD9YSCmWEFqlkTJtrTB2gMAQZ4cdtiLYJHbbSBawA+mPb+LU+IQZBdHNrZOGU8j2pyNig/L6Qezk92upPH2yiuWGKPv1HockD/Q2CoGaMoy56SjGTuKP7regNbuzf6",
 *    "datacontenttype": "application/cloudevents+json;charset=UTF-8;profile=arvo",
 *    "dataschema": "#/org/amas/calculator/add/1.0.0",
 *    "data": {
 *      "result": 10
 *    },
 *    "time": "2025-12-07T23:20:43.735+00:00",
 *    "to": "test.test.test",
 *    "accesscontrol": null,
 *    "redirectto": null,
 *    "executionunits": 0.000004,
 *    "traceparent": "00-c5a71fc0efacbd2412f95b01e50f97ed-a3e18c605f5bbc2d-01",
 *    "tracestate": null,
 *    "parentid": "3a2970a6-5fa3-4a9c-a6a1-d70f54c75814",
 *    "domain": null
 *  }
 */

executeWithEventBrokerPattern();
