/** Classify job return payloads for scheduler history + UI status. */

export interface JobSkipPayload {
  skipped: true;
  skipReason: string;
  openUntil?: string;
}

export interface ClassifiedJobOutcome {
  status: 'success' | 'skipped';
  skipReason?: string;
  errorMessage?: string;
  planned?: boolean;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function isJobSkipPayload(result: unknown): result is JobSkipPayload {
  const record = asObject(result);
  return record?.skipped === true;
}

export function classifyJobResult(result: unknown): ClassifiedJobOutcome {
  const record = asObject(result);
  if (!record || record.skipped !== true) {
    return { status: 'success' };
  }

  const skipReason = typeof record.skipReason === 'string' && record.skipReason.trim() !== ''
    ? record.skipReason.trim()
    : 'job_skipped';
  const openUntil = typeof record.openUntil === 'string' ? record.openUntil : undefined;

  let errorMessage = `Skipped (${skipReason})`;
  if (skipReason === 'football_api_daily_limit' && openUntil) {
    errorMessage = `Football API daily request limit reached (football_api_daily_limit until ${openUntil})`;
  } else if (skipReason === 'adaptive_poll_backoff') {
    return { status: 'skipped', skipReason, planned: true };
  }

  return { status: 'skipped', skipReason, errorMessage };
}
