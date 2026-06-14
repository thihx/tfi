import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { requireCurrentUser } from '../lib/authz.js';
import { resolveTelegramBotUsername } from '../lib/telegram-bot-username.js';
import { assertNotificationChannelAllowed, resolveSubscriptionAccess, sendEntitlementError } from '../lib/subscription-access.js';
import {
  getNotificationChannelConfigs,
  saveNotificationChannelConfig,
  SUPPORTED_NOTIFICATION_CHANNELS,
  type NotificationChannelType,
} from '../repos/notification-channels.repo.js';
import { createTelegramLinkOffer } from '../repos/telegram-link-tokens.repo.js';
import {
  createPhoneVerificationChallenge,
  verifyPhoneVerificationCode,
  type PhoneVerificationChannel,
} from '../repos/notification-phone-verifications.repo.js';
import { sendSmsNotification } from '../lib/twilio.js';

interface NotificationChannelBody {
  enabled?: boolean;
  address?: string | null;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface PhoneVerificationBody {
  address?: unknown;
  code?: unknown;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSupportedChannelType(value: string): value is NotificationChannelType {
  return SUPPORTED_NOTIFICATION_CHANNELS.includes(value as NotificationChannelType);
}

function isPhoneVerificationChannel(value: string): value is PhoneVerificationChannel {
  return value === 'sms' || value === 'voice_call';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isE164PhoneNumber(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

export async function notificationChannelsRoutes(app: FastifyInstance) {
  const postTelegramLinkOffer = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    if (!config.telegramBotToken.trim()) {
      return reply.status(503).send({
        error: 'Telegram bot is not configured on this server',
        code: 'TELEGRAM_BOT_DISABLED',
      });
    }
    try {
      const access = await resolveSubscriptionAccess(user.userId);
      await assertNotificationChannelAllowed(access, user.userId, 'telegram', true);
    } catch (error) {
      const entitlement = sendEntitlementError(error);
      if (entitlement) {
        return reply.status(entitlement.statusCode).send(entitlement.payload);
      }
      throw error;
    }
    const username = await resolveTelegramBotUsername();
    if (!username) {
      return reply.status(503).send({
        error: 'Could not resolve Telegram bot username. Set TELEGRAM_BOT_USERNAME or check TELEGRAM_BOT_TOKEN.',
        code: 'TELEGRAM_BOT_USERNAME_UNAVAILABLE',
      });
    }
    const { token, expiresAt } = await createTelegramLinkOffer(user.userId);
    const deepLinkUrl = `https://t.me/${username}?start=${token}`;
    return { deepLinkUrl, expiresAt: expiresAt.toISOString() };
  };

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

    try {
      if (body.enabled === true && isPhoneVerificationChannel(req.params.channelType)) {
        return reply.status(400).send({
          error: 'SMS and voice call channels must be enabled through phone verification',
          code: 'PHONE_VERIFICATION_REQUIRED',
        });
      }

      if (body.enabled === true) {
        const access = await resolveSubscriptionAccess(user.userId);
        await assertNotificationChannelAllowed(access, user.userId, req.params.channelType, true);
      }

      return saveNotificationChannelConfig(user.userId, req.params.channelType, {
        enabled: body.enabled,
        address: body.address,
        config: isObjectRecord(body.config) ? body.config : undefined,
        metadata: isObjectRecord(body.metadata) ? body.metadata : undefined,
      });
    } catch (error) {
      const entitlement = sendEntitlementError(error);
      if (entitlement) {
        return reply.status(entitlement.statusCode).send(entitlement.payload);
      }
      throw error;
    }
  };

  const startPhoneVerification = async (
    req: FastifyRequest<{
      Params: { channelType: string };
      Body: PhoneVerificationBody;
    }>,
    reply: FastifyReply,
  ) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    if (!isPhoneVerificationChannel(req.params.channelType)) {
      return reply.status(400).send({ error: 'Phone verification is only supported for sms and voice_call' });
    }

    const address = text(req.body?.address);
    if (!isE164PhoneNumber(address)) {
      return reply.status(400).send({ error: 'Phone number must be in E.164 format' });
    }

    try {
      const access = await resolveSubscriptionAccess(user.userId);
      await assertNotificationChannelAllowed(access, user.userId, req.params.channelType, true);
    } catch (error) {
      const entitlement = sendEntitlementError(error);
      if (entitlement) {
        return reply.status(entitlement.statusCode).send(entitlement.payload);
      }
      throw error;
    }

    const challenge = await createPhoneVerificationChallenge(user.userId, req.params.channelType, address);
    const result = await sendSmsNotification(
      address,
      `Your TFI verification code is ${challenge.code}. It expires in 10 minutes.`,
    );
    if (!result.ok) {
      return reply.status(503).send({ error: result.error });
    }

    await saveNotificationChannelConfig(user.userId, req.params.channelType, {
      enabled: false,
      address,
      metadata: {
        phoneVerificationStatus: 'pending',
        criticalFallback: true,
      },
    });

    return { sent: true, expiresAt: challenge.expiresAt };
  };

  const verifyPhone = async (
    req: FastifyRequest<{
      Params: { channelType: string };
      Body: PhoneVerificationBody;
    }>,
    reply: FastifyReply,
  ) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    if (!isPhoneVerificationChannel(req.params.channelType)) {
      return reply.status(400).send({ error: 'Phone verification is only supported for sms and voice_call' });
    }

    const address = text(req.body?.address);
    const code = text(req.body?.code);
    if (!isE164PhoneNumber(address)) {
      return reply.status(400).send({ error: 'Phone number must be in E.164 format' });
    }
    if (!/^\d{6}$/.test(code)) {
      return reply.status(400).send({ error: 'Verification code must be 6 digits' });
    }

    const verified = await verifyPhoneVerificationCode(user.userId, req.params.channelType, address, code);
    if (!verified) {
      return reply.status(400).send({ error: 'Invalid or expired verification code' });
    }

    return saveNotificationChannelConfig(user.userId, req.params.channelType, {
      enabled: true,
      address,
      status: 'verified',
      metadata: {
        phoneVerificationStatus: 'verified',
        phoneVerifiedAt: new Date().toISOString(),
        criticalFallback: true,
      },
    });
  };

  app.post('/api/me/notification-channels/telegram/link-offer', postTelegramLinkOffer);
  app.post('/api/notification-channels/telegram/link-offer', postTelegramLinkOffer);

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

  app.post<{
    Params: { channelType: string };
    Body: PhoneVerificationBody;
  }>('/api/me/notification-channels/:channelType/phone-verification/start', startPhoneVerification);

  app.post<{
    Params: { channelType: string };
    Body: PhoneVerificationBody;
  }>('/api/me/notification-channels/:channelType/phone-verification/verify', verifyPhone);
}
