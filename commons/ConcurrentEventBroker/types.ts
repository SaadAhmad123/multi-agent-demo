import { ArvoEvent } from 'arvo-core';
import PQueue from 'p-queue';

export type EventHandler = (
  event: ArvoEvent,
  publish: (event: ArvoEvent) => Promise<void>,
) => Promise<void>;

export type SubscriptionConfig = {
  topic: string;
  prefetch: number;
};

export type BrokerConfig = {
  errorHandler: (error: Error, event: ArvoEvent) => void;
};

export type Subscription = {
  handler: EventHandler;
  queue: PQueue;
  prefetch: number;
};
