import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireCurrentUser } from '../lib/authz.js';
import {
  getNotificationChannelConfigs,
  saveNotificationChannelConfig,
  SUPPORTED_NOTIFICATION_CHANNELS,
  type NotificationChannelType,
} from '../repos/notification-channels.repo.js';

interface NotificationChannelBody {
  enabled?: boolean;
  address?: string | null;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSupportedChannelType(value: string): value is NotificationChannelType {
  return SUPPORTED_NOTIFICATION_CHANNELS.includes(value as NotificationChannelType);
}

export async function notificationChannelsRoutes(app: FastifyInstance) {
  const getCurrentUserNotificationChannels = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    return getNotificationChannelConfigs(user.userId);
  };

  const saveCurrentUserNotificationChannel = async (
    req: FastifyRequest<{
      Params: { channelType: string };
      Body: NotificationChannelBody;
    }>,
    reply: FastifyReply,
  ) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;

    if (!isSupportedChannelType(req.params.channelType)) {
      return reply.status(400).send({ error: 'Unsupported notification channel' });
    }

    const body = req.body ?? {};
    const hasUpdate =
      typeof body.enabled === 'boolean'
      || body.address !== undefined
      || isObjectRecord(body.config)
      || isObjectRecord(body.metadata);

    if (!hasUpdate) {
      return reply.status(400).send({ error: 'No notification channel updates provided' });
    }

    return saveNotificationChannelConfig(user.userId, req.params.channelType, {
      enabled: body.enabled,
      address: body.address,
      config: isObjectRecord(body.config) ? body.config : undefined,
      metadata: isObjectRecord(body.metadata) ? body.metadata : undefined,
    });
  };

  app.get('/api/notification-channels', getCurrentUserNotificationChannels);
  app.get('/api/me/notification-channels', getCurrentUserNotificationChannels);

  app.put<{
    Params: { channelType: string };
    Body: NotificationChannelBody;
  }>('/api/notification-channels/:channelType', saveCurrentUserNotificationChannel);

  app.put<{
    Params: { channelType: string };
    Body: NotificationChannelBody;
  }>('/api/me/notification-channels/:channelType', saveCurrentUserNotificationChannel);
}