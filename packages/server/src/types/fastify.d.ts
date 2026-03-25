import 'fastify';
import type { RequestUser } from '../lib/request-user.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: RequestUser | null;
  }
}

export {};