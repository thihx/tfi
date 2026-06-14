import crypto from 'node:crypto';
import { config } from '../config.js';

interface FcmServiceAccount {
  project_id?: string;
  client_email?: string;
  private_key?: string;
}

export interface NativePushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export type NativePushSendResult =
  | { ok: true }
  | { ok: false; gone: boolean; error: string };

let cachedAccessToken: { token: string; expiresAtMs: number } | null = null;

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function parseServiceAccount(): FcmServiceAccount {
  if (config.fcmServiceAccountJson.trim()) {
    try {
      return JSON.parse(config.fcmServiceAccountJson) as FcmServiceAccount;
    } catch {
      return {};
    }
  }
  return {
    project_id: config.fcmProjectId,
    client_email: config.fcmClientEmail,
    private_key: config.fcmPrivateKey,
  };
}

function resolveFcmConfig(): { projectId: string; clientEmail: string; privateKey: string } | null {
  const account = parseServiceAccount();
  const projectId = String(account.project_id ?? '').trim();
  const clientEmail = String(account.client_email ?? '').trim();
  const privateKey = String(account.private_key ?? '').trim().replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

export function isFcmConfigured(): boolean {
  return resolveFcmConfig() != null;
}

function buildJwt(clientEmail: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(unsigned)
    .sign(privateKey);
  return `${unsigned}.${base64Url(signature)}`;
}

async function getFcmAccessToken(clientEmail: string, privateKey: string): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAtMs > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }
  const assertion = buildJwt(clientEmail, privateKey);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !payload.access_token) {
    throw new Error(payload.error || `FCM OAuth failed with status ${res.status}`);
  }
  cachedAccessToken = {
    token: payload.access_token,
    expiresAtMs: Date.now() + Math.max(60, Number(payload.expires_in ?? 3600) - 30) * 1000,
  };
  return payload.access_token;
}

function stringifyData(data: Record<string, unknown> | undefined): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (value == null) continue;
    output[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return output;
}

export async function sendFcmNotification(
  token: string,
  payload: NativePushPayload,
): Promise<NativePushSendResult> {
  const fcm = resolveFcmConfig();
  if (!fcm) return { ok: false, gone: false, error: 'FCM is not configured' };

  try {
    const accessToken = await getFcmAccessToken(fcm.clientEmail, fcm.privateKey);
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(fcm.projectId)}/messages:send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: {
            title: payload.title,
            body: payload.body,
          },
          data: stringifyData(payload.data),
          android: {
            priority: 'HIGH',
            notification: {
              channel_id: 'critical_alerts',
              priority: 'PRIORITY_HIGH',
              default_vibrate_timings: true,
              default_sound: true,
            },
          },
          apns: {
            payload: {
              aps: {
                sound: 'default',
                interruptionLevel: 'time-sensitive',
              },
            },
          },
        },
      }),
    });
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => '');
    const gone = res.status === 404 || text.includes('UNREGISTERED') || text.includes('INVALID_ARGUMENT');
    return { ok: false, gone, error: text || `FCM send failed with status ${res.status}` };
  } catch (error) {
    return { ok: false, gone: false, error: error instanceof Error ? error.message : String(error) };
  }
}
