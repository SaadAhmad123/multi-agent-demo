import { type ArvoEvent } from 'arvo-core';
import PQueue from 'p-queue';
import {
  BrokerConfig,
  EventHandler,
  Subscription,
  SubscriptionConfig,
} from './types.ts';
import { cleanString } from 'arvo-core';

export class ConcurrentEventBroker {
  private readonly subscriptions: Map<string, Subscription>;
  private readonly onError: (error: Error, event: ArvoEvent) => void;
  readonly inFlightMap = new Map<string, number>();

  constructor(config: BrokerConfig) {
    this.subscriptions = new Map();
    this.onError = config.errorHandler;
  }

  get topics(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  subscribe(handler: EventHandler, config: SubscriptionConfig): () => void {
    const { topic, prefetch = 1 } = config;

    if (this.subscriptions.has(topic)) {
      throw new Error(cleanString(`
        Subscription conflict: A handler is already registered for topic '${topic}'.
        Each topic can only have one handler. To replace the existing handler,
        unsubscribe the current handler first.
      `));
    }

    const queue = new PQueue({ concurrency: prefetch });
    const subscription: Subscription = { handler, queue, prefetch };

    this.subscriptions.set(topic, subscription);

    return () => {
      queue.clear();
      this.subscriptions.delete(topic);
    };
  }

  async publish(event: ArvoEvent): Promise<void> {
    if (!event.to) {
      throw new Error(cleanString(`
        Invalid event: Missing required 'to' field. Events must specify a destination
        topic in the 'to' property to be routable.
      `));
    }

    const subscription = this.subscriptions.get(event.to);

    if (!subscription) {
      this.onError(
        new Error(cleanString(`
          Routing failed: No handler registered for topic '${event.to}'.
          Available topics: [${this.topics.join(', ') || 'none'}].
          Register a handler using subscribe() before publishing to this topic.
        `)),
        event,
      );
      return;
    }

    event.to &&
      this.inFlightMap.set(event.to, (this.inFlightMap.get(event.to) ?? 0) + 1);
    subscription.queue.add(async () => {
      try {
        await subscription.handler(event, this.publish.bind(this));
      } catch (error) {
        this.onError(
          error instanceof Error ? error : new Error(String(error)),
          event,
        );
      } finally {
        event.to &&
          this.inFlightMap.set(
            event.to,
            (this.inFlightMap.get(event.to) ?? 0) - 1,
          );
      }
    });
  }

  getStats(topic: string) {
    const subscription = this.subscriptions.get(topic);
    if (!subscription) return null;

    return {
      prefetch: subscription.prefetch,
      pending: subscription.queue.pending,
      size: subscription.queue.size,
    };
  }

  get stats() {
    return Array.from(this.subscriptions.entries()).map((
      [key, subscription],
    ) => ({
      topic: key,
      prefetch: subscription.prefetch,
      pending: subscription.queue.pending,
      size: subscription.queue.size,
    }));
  }

  async waitForIdle(
    timeoutMs?: number,
    pollIntervalMs: number = 10,
  ): Promise<void> {
    const startTime = Date.now();

    while (true) {
      const hasInflightWork = Array.from(this.inFlightMap.values()).some(
        (count) => count > 0,
      );

      if (!hasInflightWork) {
        return;
      }

      if (timeoutMs && (Date.now() - startTime >= timeoutMs)) {
        throw new Error(`waitForIdle timed out after ${timeoutMs}ms`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  clear(): void {
    for (const subscription of this.subscriptions.values()) {
      subscription.queue.clear();
    }
    this.subscriptions.clear();
  }
}
