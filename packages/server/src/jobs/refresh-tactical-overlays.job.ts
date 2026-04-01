import { config } from '../config.js';
import { refreshTopLeagueTacticalOverlays } from '../lib/team-tactical-overlay.service.js';
import { reportJobProgress } from './job-progress.js';

const JOB = 'refresh-tactical-overlays';

export async function refreshTacticalOverlaysJob(): Promise<{
  maxPerRun: number;
  staleDays: number;
  candidateTeams: number;
  selectedTeams: number;
  refreshedTeams: number;
  skippedTeams: number;
  failedTeams: number;
  skippedReasons: Record<string, number>;
}> {
  const maxPerRun = Math.max(1, Math.trunc(config.tacticalOverlayRefreshMaxPerRun));
  const staleDays = Math.max(1, Math.trunc(config.tacticalOverlayRefreshStaleDays));

  await reportJobProgress(
    JOB,
    'planning',
    `Scanning approved competition team profiles for stale tactical overlays (max ${maxPerRun}, stale after ${staleDays}d).`,
    10,
  );

  const result = await refreshTopLeagueTacticalOverlays({ maxPerRun, staleDays });

  await reportJobProgress(
    JOB,
    'complete',
    `Tactical overlay refresh complete. Candidates=${result.candidateTeams}, selected=${result.selectedTeams}, refreshed=${result.refreshedTeams}, skipped=${result.skippedTeams}, failed=${result.failedTeams}.`,
    100,
  );

  return {
    maxPerRun,
    staleDays,
    candidateTeams: result.candidateTeams,
    selectedTeams: result.selectedTeams,
    refreshedTeams: result.refreshedTeams,
    skippedTeams: result.skippedTeams,
    failedTeams: result.failedTeams,
    skippedReasons: result.skippedReasons,
  };
}
