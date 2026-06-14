import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireCurrentUser } from '../lib/authz.js';
import { assertNotificationChannelAllowed, resolveSubscriptionAccess, sendEntitlementError } from '../lib/subscription-access.js';
import {
  countNativePushDevicesByUserId,
  deleteNativePushDevice,
  listNativePushDevices,
  upsertNativePushDevice,
  type NativePushPlatform,
  type NativePushProvider,
} from '../repos/native-push-devices.repo.js';
import { saveNotificationChannelConfig } from '../repos/notification-channels.repo.js';
import { getLocalMatchStartAlertSchedule } from '../repos/match-alert-rules.repo.js';
import { isFcmConfigured, sendFcmNotification } from '../lib/native-push.js';

interface NativeDeviceBody {
  deviceId?: unknown;
  platform?: unknown;
  provider?: unknown;
  token?: unknown;
  appVersion?: unknown;
  deviceName?: unknown;
  timezone?: unknown;
  localNotificationsEnabled?: unknown;
  metadata?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePlatform(value: unknown): NativePushPlatform | null {
  return value === 'ios' || value === 'android' ? value : null;
}

function normalizeProvider(value: unknown): NativePushProvider | null {
  return value === 'fcm' || value === 'apns' ? value : null;
}

function parseLookaheadHours(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(168, Math.floor(parsed))) : 48;
}

export async function nativePushRoutes(app: FastifyInstance) {
  const getStatus = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const devices = await listNativePushDevices(user.userId);
    return {
      configured: devices.length > 0,
      deviceCount: devices.length,
      localNotificationDeviceCount: devices.filter((device) => device.localNotificationsEnabled).length,
      senderImplemented: true,
      senderConfigured: isFcmConfigured(),
      devices,
    };
  };

  const registerDevice = async (
    req: FastifyRequest<{ Body: NativeDeviceBody }>,
    reply: FastifyReply,
  ) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;

    const deviceId = text(req.body?.deviceId);
    const tokenValue = text(req.body?.token);
    const platform = normalizePlatform(req.body?.platform);
    const provider = normalizeProvider(req.body?.provider);

    if (!deviceId || !tokenValue || !platform || !provider) {
      return reply.code(400).send({
        error: 'deviceId, token, platform (ios/android), and provider (fcm/apns) are required',
      });
    }

    try {
      const access = await resolveSubscriptionAccess(user.userId);
      await assertNotificationChannelAllowed(access, user.userId, 'native_push', true);
    } catch (error) {
      const entitlement = sendEntitlementError(error);
      if (entitlement) {
        return reply.status(entitlement.statusCode).send(entitlement.payload);
      }
      throw error;
    }

    const device = await upsertNativePushDevice(user.userId, {
      deviceId,
      token: tokenValue,
      platform,
      provider,
      appVersion: text(req.body?.appVersion) || null,
      deviceName: text(req.body?.deviceName) || null,
      timezone: text(req.body?.timezone) || null,
      localNotificationsEnabled: req.body?.localNotificationsEnabled === true,
      metadata: isRecord(req.body?.metadata) ? req.body.metadata : {},
    });

    await saveNotificationChannelConfig(user.userId, 'native_push', {
      enabled: true,
      metadata: {
        setupState: 'native_device_registered',
        senderImplemented: true,
        senderConfigured: isFcmConfigured(),
        supportsLocalNotifications: true,
        lastRegisteredDeviceId: device.deviceId,
      },
    });

    return reply.code(201).send(device);
  };

  app.get('/api/me/native-push/status', getStatus);
  app.get('/api/native-push/status', getStatus);

  app.post<{ Body: NativeDeviceBody }>('/api/me/native-push/devices', registerDevice);
  app.post<{ Body: NativeDeviceBody }>('/api/native-push/devices', registerDevice);

  app.delete<{ Params: { deviceId: string } }>('/api/me/native-push/devices/:deviceId', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const deleted = await deleteNativePushDevice(user.userId, req.params.deviceId);
    if (deleted && await countNativePushDevicesByUserId(user.userId) === 0) {
      await saveNotificationChannelConfig(user.userId, 'native_push', {
        enabled: false,
        metadata: { setupState: 'requires_native_device_registration' },
      });
    }
    return { deleted };
  });

  app.get<{
    Querystring: { lookaheadHours?: string };
  }>('/api/me/native-push/local-match-start-alerts', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const lookaheadHours = parseLookaheadHours(req.query.lookaheadHours);
    const alerts = await getLocalMatchStartAlertSchedule(user.userId, lookaheadHours);
    return {
      lookaheadHours,
      alerts,
    };
  });

  app.post('/api/me/native-push/test', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    if (!isFcmConfigured()) {
      return reply.code(503).send({ error: 'FCM is not configured' });
    }

    const devices = (await listNativePushDevices(user.userId)).filter((device) => device.provider === 'fcm');
    if (devices.length === 0) {
      return reply.code(409).send({ error: 'No FCM native push device registered' });
    }

    let delivered = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const device of devices) {
      const result = await sendFcmNotification(device.token, {
        title: 'TFI native push test',
        body: 'Native push is ready on this device.',
        data: {
          channelType: 'native_push',
          type: 'native_push_test',
          tab: 'matches',
        },
      });
      if (result.ok) {
        delivered += 1;
      } else {
        failed += 1;
        errors.push(result.error);
      }
    }

    return {
      attempted: devices.length,
      delivered,
      failed,
      errors: errors.slice(0, 3),
    };
  });
}
