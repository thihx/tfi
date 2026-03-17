// ============================================================
// Test helper — builds a Fastify instance for route testing
// Uses vi.mock to mock repo modules so no real DB is needed
// ============================================================

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

export async function buildApp(...registerFns: Array<(app: FastifyInstance) => Promise<void>>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  for (const fn of registerFns) {
    await app.register(fn);
  }
  await app.ready();
  return app;
}
