import { load } from '@std/dotenv';
import { simpleAgentContract } from './handlers/simple.agent.ts';
import { createArvoEventFactory } from 'arvo-core';
import { executeHandlers } from './handlers/index.ts';
await load({ export: true });

async function main() {
  const event = createArvoEventFactory(simpleAgentContract.version('1.0.0'))
    .accepts({
      source: 'test.test.test',
      data: {
        parentSubject$$: null,
        message: 'Hello, what are you?',
      },
    });
  const response = await executeHandlers(event);
  console.log(JSON.stringify(response, null, 2));
}

if (import.meta.main) {
  await main();
}
