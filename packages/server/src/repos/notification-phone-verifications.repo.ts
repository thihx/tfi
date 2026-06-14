import crypto from 'node:crypto';
import { query } from '../db/pool.js';

export type PhoneVerificationChannel = 'sms' | 'voice_call';

export interface PhoneVerificationChallenge {
  code: string;
  expiresAt: string;
}

function hashCode(userId: string, channelType: PhoneVerificationChannel, phoneNumber: string, code: string): string {
  return crypto
    .createHash('sha256')
    .update(`${userId}:${channelType}:${phoneNumber}:${code}`)
    .digest('hex');
}

function randomCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function createPhoneVerificationChallenge(
  userId: string,
  channelType: PhoneVerificationChannel,
  phoneNumber: string,
): Promise<PhoneVerificationChallenge> {
  const code = randomCode();
  const result = await query<{ expires_at: string }>(
    `INSERT INTO user_notification_phone_verifications (
        user_id,
        channel_type,
        phone_number,
        code_hash,
        expires_at
      )
      VALUES ($1, $2, $3, $4, NOW() + INTERVAL '10 minutes')
      RETURNING expires_at::text`,
    [userId, channelType, phoneNumber, hashCode(userId, channelType, phoneNumber, code)],
  );
  return {
    code,
    expiresAt: result.rows[0]?.expires_at ?? new Date(Date.now() + 10 * 60_000).toISOString(),
  };
}

export async function verifyPhoneVerificationCode(
  userId: string,
  channelType: PhoneVerificationChannel,
  phoneNumber: string,
  code: string,
): Promise<boolean> {
  const result = await query<{ id: number }>(
    `WITH candidate AS (
        SELECT id
          FROM user_notification_phone_verifications
         WHERE user_id = $1
           AND channel_type = $2
           AND phone_number = $3
           AND consumed_at IS NULL
           AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 1
      ),
      touched AS (
        UPDATE user_notification_phone_verifications v
           SET attempt_count = attempt_count + 1
          FROM candidate c
         WHERE v.id = c.id
           AND v.attempt_count < 5
        RETURNING v.id, v.code_hash
      ),
      consumed AS (
        UPDATE user_notification_phone_verifications v
           SET consumed_at = NOW()
          FROM touched t
         WHERE v.id = t.id
           AND t.code_hash = $4
        RETURNING v.id
      )
      SELECT id FROM consumed`,
    [userId, channelType, phoneNumber, hashCode(userId, channelType, phoneNumber, code)],
  );
  return (result.rowCount ?? result.rows.length) > 0;
}
