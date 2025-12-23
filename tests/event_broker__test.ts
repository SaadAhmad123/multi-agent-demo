import { assertEquals, assertRejects } from '@std/assert';
import { ArvoEvent } from 'arvo-core';
import { ConcurrentEventBroker } from '../commons/ConcurrentEventBroker/index.ts';

Deno.test('ConcurrentEventBroker - subscribe registers handler', () => {
  const broker = new ConcurrentEventBroker({
    errorHandler: () => {},
  });

  const handler = async () => {};
  const unsub = broker.subscribe(handler, { topic: 'test.topic', prefetch: 1 });

  assertEquals(broker.topics.includes('test.topic'), true);
  unsub();
  assertEquals(broker.topics.includes('test.topic'), false);
});

Deno.test('ConcurrentEventBroker - subscribe throws on duplicate topic', () => {
  const broker = new ConcurrentEventBroker({
    errorHandler: () => {},
  });

  const handler = async () => {};
  broker.subscribe(handler, { topic: 'test.topic', prefetch: 1 });

  try {
    broker.subscribe(handler, { topic: 'test.topic', prefetch: 1 });
    throw new Error('Should have thrown');
  } catch (error) {
    assertEquals(
      (error as Error).message.includes('Subscription conflict'),
      true,
    );
  }
});

Deno.test('ConcurrentEventBroker - publish throws on missing to field', () => {
  const broker = new ConcurrentEventBroker({
    errorHandler: () => {},
  });

  const event = { id: '1', type: 'test' } as ArvoEvent;

  try {
    broker.publish(event);
    throw new Error('Should have thrown');
  } catch (error) {
    assertEquals((error as Error).message.includes('Missing required'), true);
  }
});

Deno.test('ConcurrentEventBroker - publish calls error handler on missing subscription', () => {
  let errorCalled = false;
  const broker = new ConcurrentEventBroker({
    errorHandler: (error) => {
      errorCalled = true;
      assertEquals(error.message.includes('Routing failed'), true);
    },
  });

  const event = { id: '1', type: 'test', to: 'unknown.topic' } as ArvoEvent;
  broker.publish(event);

  assertEquals(errorCalled, true);
});

Deno.test('ConcurrentEventBroker - publish routes event to handler', async () => {
  const broker = new ConcurrentEventBroker({
    errorHandler: () => {},
  });

  let handlerCalled = false;
  const handler = async (event: ArvoEvent) => {
    handlerCalled = true;
    assertEquals(event.to, 'test.topic');
  };

  broker.subscribe(handler, { topic: 'test.topic', prefetch: 1 });

  const event = { id: '1', type: 'test', to: 'test.topic' } as ArvoEvent;
  broker.publish(event);

  await broker.waitForIdle();
  assertEquals(handlerCalled, true);
});

Deno.test('ConcurrentEventBroker - waitForIdle waits for all work', async () => {
  const broker = new ConcurrentEventBroker({
    errorHandler: () => {},
  });

  let completedCount = 0;
  const handler = async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    completedCount++;
  };

  broker.subscribe(handler, { topic: 'test.topic', prefetch: 2 });

  broker.publish({ id: '1', type: 'test', to: 'test.topic' } as ArvoEvent);
  broker.publish({ id: '2', type: 'test', to: 'test.topic' } as ArvoEvent);
  broker.publish({ id: '3', type: 'test', to: 'test.topic' } as ArvoEvent);

  assertEquals(completedCount, 0);

  await broker.waitForIdle();
  assertEquals(completedCount, 3);
});

Deno.test('ConcurrentEventBroker - waitForIdle times out', async () => {
  const broker = new ConcurrentEventBroker({
    errorHandler: () => {},
  });

  let timeout: unknown = null;
  const handler = async () => {
    await new Promise((resolve) => {
      timeout = setTimeout(resolve, 1000);
    });
  };

  broker.subscribe(handler, { topic: 'test.topic', prefetch: 1 });
  broker.publish({ id: '1', type: 'test', to: 'test.topic' } as ArvoEvent);

  await assertRejects(
    async () => await broker.waitForIdle({ timeoutMs: 100 }),
    Error,
    'timed out',
  );
  // deno-lint-ignore no-explicit-any
  clearTimeout(timeout as any);
});

Deno.test('ConcurrentEventBroker - getStats returns queue info', () => {
  const broker = new ConcurrentEventBroker({
    errorHandler: () => {},
  });

  const handler = async () => {};
  broker.subscribe(handler, { topic: 'test.topic', prefetch: 5 });

  const stats = broker.getStats('test.topic');
  assertEquals(stats?.prefetch, 5);
  assertEquals(stats?.pending, 0);
  assertEquals(stats?.size, 0);
  assertEquals(stats?.inFlight, 0);
});

Deno.test('ConcurrentEventBroker - getStats returns null for unknown topic', () => {
  const broker = new ConcurrentEventBroker({
    errorHandler: () => {},
  });

  const stats = broker.getStats('unknown.topic');
  assertEquals(stats, null);
});

Deno.test('ConcurrentEventBroker - stats returns all topics', () => {
  const broker = new ConcurrentEventBroker({
    errorHandler: () => {},
  });

  const handler = async () => {};
  broker.subscribe(handler, { topic: 'topic1', prefetch: 1 });
  broker.subscribe(handler, { topic: 'topic2', prefetch: 2 });

  const stats = broker.stats;
  assertEquals(stats.length, 2);
  assertEquals(stats.some((s) => s.topic === 'topic1'), true);
  assertEquals(stats.some((s) => s.topic === 'topic2'), true);
});

Deno.test('ConcurrentEventBroker - clear removes all subscriptions', () => {
  const broker = new ConcurrentEventBroker({
    errorHandler: () => {},
  });

  const handler = async () => {};
  broker.subscribe(handler, { topic: 'topic1', prefetch: 1 });
  broker.subscribe(handler, { topic: 'topic2', prefetch: 1 });

  assertEquals(broker.topics.length, 2);

  broker.clear();

  assertEquals(broker.topics.length, 0);
});

Deno.test('ConcurrentEventBroker - handler can publish cascading events', async () => {
  const broker = new ConcurrentEventBroker({
    errorHandler: () => {},
  });

  const results: string[] = [];

  broker.subscribe(async (_, publish) => {
    results.push('handler1');
    publish({ id: '2', type: 'test', to: 'topic2' } as ArvoEvent);
  }, { topic: 'topic1', prefetch: 1 });

  broker.subscribe(async (_) => {
    results.push('handler2');
  }, { topic: 'topic2', prefetch: 1 });

  broker.publish({ id: '1', type: 'test', to: 'topic1' } as ArvoEvent);

  await broker.waitForIdle();

  assertEquals(results.length, 2);
  assertEquals(results.includes('handler1'), true);
  assertEquals(results.includes('handler2'), true);
});

Deno.test('ConcurrentEventBroker - prefetch controls concurrency', async () => {
  const broker = new ConcurrentEventBroker({
    errorHandler: () => {},
  });

  let concurrentCount = 0;
  let maxConcurrent = 0;

  const handler = async () => {
    concurrentCount++;
    maxConcurrent = Math.max(maxConcurrent, concurrentCount);
    await new Promise((resolve) => setTimeout(resolve, 50));
    concurrentCount--;
  };

  broker.subscribe(handler, { topic: 'test.topic', prefetch: 3 });

  for (let i = 0; i < 10; i++) {
    broker.publish({ id: `${i}`, type: 'test', to: 'test.topic' } as ArvoEvent);
  }

  await broker.waitForIdle();

  assertEquals(maxConcurrent, 3);
});

Deno.test('ConcurrentEventBroker - error handler called on handler exception', async () => {
  let errorHandlerCalled = false;
  const broker = new ConcurrentEventBroker({
    errorHandler: (error) => {
      errorHandlerCalled = true;
      assertEquals(error.message, 'Handler failed');
    },
  });

  const handler = async () => {
    throw new Error('Handler failed');
  };

  broker.subscribe(handler, { topic: 'test.topic', prefetch: 1 });
  broker.publish({ id: '1', type: 'test', to: 'test.topic' } as ArvoEvent);

  await broker.waitForIdle();

  assertEquals(errorHandlerCalled, true);
});
