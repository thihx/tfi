// ============================================================
// Audit Service — fire-and-forget audit logging
// Wraps repo calls so audit failures never break main flow
// ============================================================

import { insertAuditLog, type AuditLogInput } from '../repos/audit-logs.repo.js';

/** Fire-and-forget audit log — never throws */
export function audit(input: AuditLogInput): void {
  insertAuditLog(input).catch((err) => {
    console.warn('[audit] Failed to write audit log:', err instanceof Error ? err.message : String(err));
  });
}

/** Audit a successful action */
export function auditSuccess(category: string, action: string, extra?: Partial<AuditLogInput>): void {
  audit({ category, action, outcome: 'SUCCESS', ...extra });
}

/** Audit a failed action */
export function auditFailure(category: string, action: string, error: string, extra?: Partial<AuditLogInput>): void {
  audit({ category, action, outcome: 'FAILURE', error, ...extra });
}

/** Audit a skipped action */
export function auditSkipped(category: string, action: string, extra?: Partial<AuditLogInput>): void {
  audit({ category, action, outcome: 'SKIPPED', ...extra });
}

/**
 * Wrap an async function with audit logging — records start, duration, and outcome.
 */
export async function auditWrap<T>(
  category: string,
  action: string,
  fn: () => Promise<T>,
  extra?: Partial<AuditLogInput>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    audit({
      category,
      action,
      outcome: 'SUCCESS',
      duration_ms: Date.now() - start,
      ...extra,
    });
    return result;
  } catch (err) {
    audit({
      category,
      action,
      outcome: 'FAILURE',
      duration_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
      ...extra,
    });
    throw err;
  }
}
