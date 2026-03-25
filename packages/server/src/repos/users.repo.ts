import { randomUUID } from 'node:crypto';
import { query, transaction } from '../db/pool.js';

export type UserRole = 'owner' | 'admin' | 'member';
export type UserStatus = 'active' | 'disabled' | 'invited';

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

export interface ResolveUserFromIdentityInput {
  provider: string;
  providerSubject: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeDisplayName(displayName: string, email: string): string {
  const trimmed = displayName.trim();
  return trimmed || email;
}

export async function getUserById(userId: string): Promise<UserRow | null> {
  const result = await query<UserRow>('SELECT * FROM users WHERE id = $1 LIMIT 1', [userId]);
  return result.rows[0] ?? null;
}

export async function resolveOrCreateUserFromIdentity(input: ResolveUserFromIdentityInput): Promise<UserRow> {
  const provider = input.provider.trim().toLowerCase();
  const providerSubject = input.providerSubject.trim();
  const email = normalizeEmail(input.email);
  const displayName = normalizeDisplayName(input.displayName, email);
  const avatarUrl = (input.avatarUrl ?? '').trim();

  if (!provider || !providerSubject || !email) {
    throw new Error('Invalid identity payload');
  }

  return transaction(async (client) => {
    const existingByIdentity = await client.query<UserRow>(
      `SELECT u.*
         FROM user_auth_identities identities
         JOIN users u ON u.id = identities.user_id
        WHERE identities.provider = $1
          AND identities.provider_subject = $2
        LIMIT 1`,
      [provider, providerSubject],
    );

    const userByIdentity = existingByIdentity.rows[0] ?? null;
    if (userByIdentity) {
      const refreshed = await client.query<UserRow>(
        `UPDATE users
            SET email = $2,
                display_name = $3,
                avatar_url = $4,
                updated_at = NOW()
          WHERE id = $1
        RETURNING *`,
        [userByIdentity.id, email, displayName, avatarUrl],
      );

      await client.query(
        `UPDATE user_auth_identities
            SET provider_email = $3
          WHERE provider = $1
            AND provider_subject = $2`,
        [provider, providerSubject, email],
      );

      return refreshed.rows[0] ?? userByIdentity;
    }

    const existingByEmail = await client.query<UserRow>(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email],
    );

    let user = existingByEmail.rows[0] ?? null;

    if (!user) {
      const countResult = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users');
      const isFirstUser = Number(countResult.rows[0]?.count ?? '0') === 0;
      const created = await client.query<UserRow>(
        `INSERT INTO users (id, email, display_name, avatar_url, role, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         RETURNING *`,
        [randomUUID(), email, displayName, avatarUrl, isFirstUser ? 'owner' : 'member'],
      );
      user = created.rows[0] ?? null;
    } else {
      const refreshed = await client.query<UserRow>(
        `UPDATE users
            SET email = $2,
                display_name = $3,
                avatar_url = $4,
                updated_at = NOW()
          WHERE id = $1
        RETURNING *`,
        [user.id, email, displayName, avatarUrl],
      );
      user = refreshed.rows[0] ?? user;
    }

    if (!user) throw new Error('Failed to resolve user');

    await client.query(
      `INSERT INTO user_auth_identities (user_id, provider, provider_subject, provider_email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider, provider_subject)
       DO UPDATE SET user_id = EXCLUDED.user_id,
                     provider_email = EXCLUDED.provider_email`,
      [user.id, provider, providerSubject, email],
    );

    return user;
  });
}