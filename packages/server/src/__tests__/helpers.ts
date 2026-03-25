// ============================================================
// Test helper — builds a Fastify instance for route testing
// Uses vi.mock to mock repo modules so no real DB is needed
// ============================================================

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { RequestUser } from '../lib/request-user.js';

interface BuildAppOptions {
  currentUser?: RequestUser | null;
}

export async function buildApp(
  registerFns: Array<(app: FastifyInstance) => Promise<void>>,
  options?: BuildAppOptions,
): Promise<FastifyInstance>;
export async function buildApp(
  ...registerFns: Array<(app: FastifyInstance) => Promise<void>>
): Promise<FastifyInstance>;
export async function buildApp(
  ...args: Array<unknown>
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest('currentUser', null);

  let registerFns: Array<(app: FastifyInstance) => Promise<void>>;
  let options: BuildAppOptions | undefined;

  if (Array.isArray(args[0])) {
    registerFns = args[0] as Array<(app: FastifyInstance) => Promise<void>>;
    options = args[1] as BuildAppOptions | undefined;
  } else {
    registerFns = args as Array<(app: FastifyInstance) => Promise<void>>;
  }

  if (options?.currentUser) {
    app.addHook('onRequest', async (req) => {
      req.currentUser = options?.currentUser ?? null;
    });
  }

  for (const fn of registerFns) {
    await app.register(fn);
  }
  await app.ready();
  return app;
}
