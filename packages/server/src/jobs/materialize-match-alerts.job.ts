import { reportJobProgress } from './job-progress.js';
import { materializeMatchStartAlertRules } from '../repos/match-alert-rules.repo.js';

export async function materializeMatchAlertsJob(): Promise<{
  favoriteTeamRules: number;
  favoriteLeagueRules: number;
}> {
  const JOB = 'materialize-match-alerts';
  await reportJobProgress(JOB, 'materialize', 'Materializing favorite match alert rules...', 50);
  const result = await materializeMatchStartAlertRules();
  await reportJobProgress(
    JOB,
    'complete',
    `Materialized ${result.favoriteTeamRules + result.favoriteLeagueRules} match alert rules`,
    100,
  );
  return result;
}
