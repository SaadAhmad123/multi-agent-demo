import { beforeEach, describe, it } from '@std/testing/bdd';
import { IArvoTestFramework } from 'arvo-event-handler';

export const denoAdapter: IArvoTestFramework = {
  describe,
  test: it,
  beforeEach,
};
