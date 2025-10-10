import { createArvoContract, createArvoEventFactory } from 'arvo-core';
import z from 'zod';

// Define a contract with multiple versions
const userEnquiryContract = createArvoContract({
  uri: '#/services/user/enquiry',
  type: 'com.user.enquiry',
  versions: {
    '1.0.0': {
      accepts: z.object({
        user_id: z.string(),
      }),
      emits: {
        'evt.user.enquiry.success': z.object({
          user_id: z.string(),
          name: z.string(),
          dob: z.string(),
          age: z.number(),
        }),
      },
    },
    '2.0.0': {
      accepts: z.object({
        user_id: z.string(),
        region: z.enum(['US', 'UK', 'AUD']),
      }),
      emits: {
        'evt.user.enquiry.success': z.object({
          user_id: z.string(),
          name: z.string(),
          dob: z.string(),
          age: z.number(),
        }),
      },
    },
  },
});

export const testC = () => {
  // Create a factory instance for version 1.0.0
  const eventFactoryV100 = createArvoEventFactory(userEnquiryContract.version('1.0.0'));

  const serviceInputEventV100 = eventFactoryV100.accepts({
    source: 'test.test.test',
    data: {
      user_id: 'some-user-id',
    },
  });
  console.log(serviceInputEventV100.toString(2));

  const serviceOutputEventV100 = eventFactoryV100.emits({
    source: 'test.test.test',
    type: 'evt.user.enquiry.success',
    subject: serviceInputEventV100.subject,
    data: {
      user_id: serviceInputEventV100.data.user_id,
      name: 'John Doe',
      dob: 'Feb 31, 1900',
      age: 125,
    },
    executionunits: 1.3,
  });
  console.log(serviceOutputEventV100.toString(2));

  const serviceErrorEvent = eventFactoryV100.systemError({
    source: 'test.test.test',
    subject: serviceInputEventV100.subject,
    parentid: serviceInputEventV100.id,
    executionunits: 1.3,
    error: new Error('Something went wrong'),
  });
  console.log(serviceErrorEvent.toString(2));

  try {
    eventFactoryV100.accepts({
      source: 'test.test.test',
      subject: 'some-unique-subject',
      data: {
        // @ts-ignore - Forcing typescript compiler to ignore
        invalidField: 'unexpected value', // This will trigger a validation error
      },
    });
  } catch (error) {
    console.error('Validation failed:', (error as Error).message);
  }
};
