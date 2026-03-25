import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UserRole } from '../repos/users.repo.js';
import type { RequestUser } from './request-user.js';

export function requireCurrentUser(
  req: FastifyRequest,
  reply: FastifyReply,
): RequestUser | null {
  if (!req.currentUser) {
    void reply.status(401).send({ error: 'Unauthorized' });
    return null;
  }
  return req.currentUser;
}

export function requireAnyRole(
  req: FastifyRequest,
  reply: FastifyReply,
  roles: UserRole[],
): RequestUser | null {
  const user = requireCurrentUser(req, reply);
  if (!user) return null;
  if (!roles.includes(user.role)) {
    void reply.status(403).send({ error: 'Forbidden' });
    return null;
  }
  return user;
}

export function requireAdminOrOwner(
  req: FastifyRequest,
  reply: FastifyReply,
): RequestUser | null {
  return requireAnyRole(req, reply, ['admin', 'owner']);
}