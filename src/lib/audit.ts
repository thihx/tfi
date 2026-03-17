// ============================================================
// Frontend Audit Client — fire-and-forget audit log posting
// ============================================================

import type { AppConfig } from '@/types';

interface AuditEntry {
  category: string;
  action: string;
  outcome?: string;
  actor?: string;
  match_id?: string | null;
  duration_ms?: number | null;
  metadata?: Record<string, unknown> | null;
  error?: string | null;
}

/** Fire-and-forget: post an audit log to the server. Never throws. */
export function auditLog(config: AppConfig, entry: AuditEntry): void {
  const url = `${config.apiUrl}/api/audit-logs`;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...entry, actor: entry.actor ?? 'user' }),
  }).catch(() => {
    // Silent — audit failure should never impact UX
  });
}
