import { afterAll, beforeAll } from 'vitest';
import { telemetrySdkStart, telemetrySdkStop } from './otel.js';

beforeAll(() => {
  telemetrySdkStart();
});

afterAll(async () => {
  await telemetrySdkStop();
});
