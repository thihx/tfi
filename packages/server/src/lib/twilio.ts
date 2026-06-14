import { config } from '../config.js';

export type TwilioSendResult =
  | { ok: true }
  | { ok: false; error: string };

export function isTwilioConfigured(): boolean {
  return Boolean(
    config.twilioAccountSid.trim()
    && config.twilioAuthToken.trim()
    && config.twilioFromNumber.trim(),
  );
}

function twilioAuthHeader(): string {
  return `Basic ${Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64')}`;
}

function safeTwiml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function postTwilio(path: string, body: URLSearchParams): Promise<TwilioSendResult> {
  if (!isTwilioConfigured()) return { ok: false, error: 'Twilio is not configured' };
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.twilioAccountSid)}/${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: twilioAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  );
  if (res.ok) return { ok: true };
  const text = await res.text().catch(() => '');
  return { ok: false, error: text || `Twilio request failed with status ${res.status}` };
}

export async function sendSmsNotification(to: string, message: string): Promise<TwilioSendResult> {
  return postTwilio('Messages.json', new URLSearchParams({
    To: to,
    From: config.twilioFromNumber,
    Body: message.slice(0, 1500),
  }));
}

export async function sendVoiceNotification(to: string, message: string): Promise<TwilioSendResult> {
  return postTwilio('Calls.json', new URLSearchParams({
    To: to,
    From: config.twilioFromNumber,
    Twiml: `<Response><Say voice="alice">${safeTwiml(message.slice(0, 900))}</Say></Response>`,
  }));
}
