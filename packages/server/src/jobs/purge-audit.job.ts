// ============================================================
// Job: Purge Audit Logs
// Deletes audit_logs older than configured retention period.
// ============================================================

import { config } from '../config.js';
import * as auditRepo from '../repos/audit-logs.repo.js';
import { reportJobProgress } from './job-progress.js';

export async function purgeAuditJob(): Promise<{ deleted: number; keepDays: number }> {
  const keepDays = config.auditKeepDays;
  await reportJobProgress('purge-audit', 'purge', `Purging audit logs older than ${keepDays} days...`, 30);
  const deleted = await auditRepo.purgeAuditLogs(keepDays);

  if (deleted > 0) {
    console.log(`[purgeAuditJob] ✅ Purged ${deleted} audit logs older than ${keepDays} days`);
  }

  return { deleted, keepDays };
}
