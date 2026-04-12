import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { processTelegramDeepLinkStart, replyTelegramUser } from '../lib/telegram-link-flow.js';

function extractStartPayload(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^\/start(?:@[\w]+)?(?:\s+(\S+))?/i);
  if (!m) return '';
  return (m[1] ?? '').trim();
}

interface TelegramChat {
  id: number;
}

interface TelegramMessage {
  chat?: TelegramChat;
  text?: string;
}

interface TelegramUpdate {
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export async function telegramWebhookRoutes(app: FastifyInstance) {
  app.post<{ Body: TelegramUpdate }>(
    '/api/telegram/webhook',
    async (req: FastifyRequest<{ Body: TelegramUpdate }>, reply) => {
      const expected = config.telegramWebhookSecret.trim();
      if (expected) {
        const got = req.headers['x-telegram-bot-api-secret-token'];
        if (got !== expected) {
          return reply.status(401).send({ ok: false });
        }
      }

      const body = req.body ?? {};
      const msg = body.message ?? body.edited_message;
      const text = typeof msg?.text === 'string' ? msg.text : '';
      const chatId = msg?.chat?.id;

      if (chatId == null) {
        return reply.send({ ok: true });
      }

      if (!text.trim().toLowerCase().startsWith('/start')) {
        return reply.send({ ok: true });
      }

      const payload = extractStartPayload(text);
      const chatIdStr = String(chatId);

      try {
        const result = await processTelegramDeepLinkStart(payload, chatIdStr);
        if (result.respond) {
          await replyTelegramUser(chatIdStr, result.userMessage);
        }
      } catch (err) {
        app.log.error({ err }, 'telegram webhook: link flow failed');
        try {
          await replyTelegramUser(
            chatIdStr,
            'TFI: Link failed temporarily. Try again later or set your Chat ID in the web app.',
          );
        } catch (sendErr) {
          app.log.error({ err: sendErr }, 'telegram webhook: could not send error reply');
        }
      }

      return reply.send({ ok: true });
    },
  );
}
