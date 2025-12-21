import { createArvoEventFactory } from 'arvo-core';
import { addContract, addHandler } from './handlers/add.service.ts';

export async function executeAddHandler() {
  const event = createArvoEventFactory(addContract.version('1.0.0')).accepts({
    // This can be any valid string. It denotes the source of the initiating event
    source: 'test.test.test',
    data: {
      numbers: [1, 2],
    },
  });

  const { events: emittedEvents } = await addHandler().execute(event, {
    inheritFrom: 'EVENT',
  });

  for (const item of emittedEvents) {
    console.log(item.toString(2));
  }
}

executeAddHandler();

/**
 * Console log output
 *
 * {
 *    "id": "8849e72e-0b5f-4723-b7ca-3f77974ef463",
 *    "source": "com.calculator.add",
 *    "specversion": "1.0",
 *    "type": "evt.calculator.add.success",
 *    "subject": "eJw9jtsKgzAQRP9ln01I0KLxb9bslgZygZiUgvjvri30ZR7mwJk5oFT/4r1VbKXCekDGxLCCL0l7jL7HG2gkggHeXPdQsmCrjTZwDsAf9r19ywMC3cjxRg+DajM8qulprdrmxSs7krOOlpkmFlfIoYXfKDQ5oP8hkErCIMrcY5SRxA3Ff54XqhQ47Q==",
 *    "datacontenttype": "application/cloudevents+json;charset=UTF-8;profile=arvo",
 *    "dataschema": "#/org/amas/calculator/add/1.0.0",
 *    "data": {
 *      "result": 3
 *    },
 *    "time": "2025-12-07T23:15:16.052+00:00",
 *    "to": "test.test.test",
 *    "accesscontrol": null,
 *    "redirectto": null,
 *    "executionunits": 0.000002,
 *    "traceparent": "00-db4686d979e5ceb7e20fbd23f5178256-08a540c14920c2d5-01",
 *    "tracestate": null,
 *    "parentid": "44524657-63c2-4b6e-b710-a7ea16e74b79",
 *    "domain": null
 * }
 */
