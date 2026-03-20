// ============================================================
// Frontend Audit Client — fire-and-forget audit log posting
// ============================================================

import type { AppConfig } from '@/types';
import { getToken } from '@/lib/services/auth';

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
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...entry, actor: entry.actor ?? 'user' }),
    credentials: 'include',
  }).catch(() => {
    // Silent — audit failure should never impact UX
  });
}
