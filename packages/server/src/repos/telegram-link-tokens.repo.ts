import { randomBytes } from 'node:crypto';
import { query } from '../db/pool.js';

const TOKEN_BYTES = 18;
const TTL_MINUTES = 15;

function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

export interface TelegramLinkOffer {
  token: string;
  expiresAt: Date;
}

/** Replace any previous unconsumed token for this user. */
export async function createTelegramLinkOffer(userId: string): Promise<TelegramLinkOffer> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000);

  await query(
    `DELETE FROM telegram_link_tokens
      WHERE user_id = $1
        AND consumed_at IS NULL`,
    [userId],
  );

  await query(
    `INSERT INTO telegram_link_tokens (token, user_id, expires_at)
     VALUES ($1, $2, $3)`,
    [token, userId, expiresAt.toISOString()],
  );

  return { token, expiresAt };
}

function normalizeToken(token: string): string | null {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  if (!trimmed || !/^[a-f0-9]+$/i.test(trimmed)) return null;
  return trimmed;
}

/** Read user_id for a valid pending token without consuming (for linking flow before DB writes). */
export async function peekTelegramLinkToken(token: string): Promise<string | null> {
  const t = normalizeToken(token);
  if (!t) return null;
  const result = await query<{ user_id: string }>(
    `SELECT user_id FROM telegram_link_tokens
      WHERE token = $1
        AND consumed_at IS NULL
        AND expires_at > NOW()`,
    [t],
  );
  return result.rows[0]?.user_id ?? null;
}

/** Marks token consumed. Returns true if a row was updated. */
export async function consumeTelegramLinkToken(token: string): Promise<boolean> {
  const t = normalizeToken(token);
  if (!t) return false;
  const result = await query(
    `UPDATE telegram_link_tokens
        SET consumed_at = NOW()
      WHERE token = $1
        AND consumed_at IS NULL
        AND expires_at > NOW()`,
    [t],
  );
  return (result.rowCount ?? 0) > 0;
}
