import { query } from '../db/pool.js';
import { getLeagueTeamDirectory } from '../repos/team-directory.repo.js';

export interface PrematchProfileCandidateTeam {
  league_id: number;
  team_id: number;
  team_name: string;
  source: 'directory' | 'matches';
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function mergePrematchProfileCandidateTeams(
  directoryEntries: PrematchProfileCandidateTeam[],
  matchEntries: PrematchProfileCandidateTeam[],
): PrematchProfileCandidateTeam[] {
  const merged = new Map<string, PrematchProfileCandidateTeam>();

  const add = (entry: PrematchProfileCandidateTeam) => {
    const key = `${entry.league_id}:${entry.team_id}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...entry,
        team_name: normalizeName(entry.team_name),
      });
      return;
    }
    const preferred = existing.source === 'directory' ? existing : entry.source === 'directory' ? entry : existing;
    merged.set(key, {
      ...preferred,
      team_name: normalizeName(preferred.team_name || existing.team_name || entry.team_name),
    });
  };

  directoryEntries.forEach(add);
  matchEntries.forEach(add);

  return [...merged.values()].sort((left, right) =>
    left.league_id - right.league_id
    || left.team_name.localeCompare(right.team_name)
    || left.team_id - right.team_id,
  );
}

async function getDirectoryCandidateTeams(leagueIds: number[]): Promise<PrematchProfileCandidateTeam[]> {
  const directories = await Promise.all(leagueIds.map(async (leagueId) => ({
    leagueId,
    rows: await getLeagueTeamDirectory(leagueId).catch(() => []),
  })));

  return directories.flatMap(({ leagueId, rows }) =>
    rows.map((row) => ({
      league_id: leagueId,
      team_id: row.team_id,
      team_name: row.team_name,
      source: 'directory' as const,
    })),
  );
}

async function getCurrentMatchCandidateTeams(leagueIds: number[]): Promise<PrematchProfileCandidateTeam[]> {
  if (leagueIds.length === 0) return [];

  const result = await query<{
    league_id: number;
    team_id: number;
    team_name: string;
  }>(
    `SELECT DISTINCT league_id, team_id, team_name
     FROM (
       SELECT league_id, home_team_id AS team_id, home_team AS team_name
       FROM matches
       WHERE league_id = ANY($1) AND home_team_id IS NOT NULL
       UNION ALL
       SELECT league_id, away_team_id AS team_id, away_team AS team_name
       FROM matches
       WHERE league_id = ANY($1) AND away_team_id IS NOT NULL
     ) teams
     WHERE team_id IS NOT NULL
     ORDER BY league_id, team_name, team_id`,
    [leagueIds],
  );

  return result.rows.map((row) => ({
    league_id: row.league_id,
    team_id: row.team_id,
    team_name: row.team_name,
    source: 'matches' as const,
  }));
}

export async function getPrematchProfileCandidateTeams(
  leagueIds: number[],
): Promise<PrematchProfileCandidateTeam[]> {
  const uniqueLeagueIds = [...new Set(leagueIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (uniqueLeagueIds.length === 0) return [];

  const [directoryEntries, matchEntries] = await Promise.all([
    getDirectoryCandidateTeams(uniqueLeagueIds),
    getCurrentMatchCandidateTeams(uniqueLeagueIds),
  ]);

  return mergePrematchProfileCandidateTeams(directoryEntries, matchEntries);
}

export const __testables__ = {
  mergePrematchProfileCandidateTeams,
};
