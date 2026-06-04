import { AsyncLocalStorage } from 'node:async_hooks';

export interface FootballApiRequestContext {
  jobName?: string;
  consumer?: string;
}

const storage = new AsyncLocalStorage<FootballApiRequestContext>();

export function getFootballApiRequestContext(): FootballApiRequestContext {
  return storage.getStore() ?? {};
}

export function withFootballApiRequestContext<T>(
  context: FootballApiRequestContext,
  fn: () => Promise<T>,
): Promise<T> {
  const parent = storage.getStore() ?? {};
  return storage.run({ ...parent, ...context }, fn);
}
