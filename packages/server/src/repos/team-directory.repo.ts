import { query, transaction } from '../db/pool.js';

export interface LeagueTeamDirectoryRow {
  league_id: number;
  team_id: number;
  team_name: string;
  team_logo: string;
  country: string;
  founded: number | null;
  venue_id: number | null;
  venue_name: string;
  venue_city: string;
  season: number;
  rank: number | null;
  fetched_at: string;
  expires_at: string;
}

export interface ReplaceLeagueTeamsSnapshotInput {
  leagueId: number;
  season: number;
  fetchedAt?: Date;
  expiresAt: Date;
  teams: Array<{
    team: {
      id: number;
      name: string;
      logo: string;
      country: string | null;
      founded: number | null;
    };
    venue: {
      id: number | null;
      name: string | null;
      city: string | null;
    } | null;
    rank: number | null;
  }>;
}

export async function getLeagueTeamDirectory(leagueId: number): Promise<LeagueTeamDirectoryRow[]> {
  const result = await query<LeagueTeamDirectoryRow>(
    `SELECT
       ltd.league_id,
       ltd.team_id,
       t.team_name,
       t.team_logo,
       t.country,
       t.founded,
       t.venue_id,
       t.venue_name,
       t.venue_city,
       ltd.season,
       ltd.rank,
       ltd.fetched_at::text,
       ltd.expires_at::text
     FROM league_team_directory ltd
     JOIN teams t ON t.team_id = ltd.team_id
     WHERE ltd.league_id = $1
     ORDER BY ltd.rank NULLS LAST, t.team_name`,
    [leagueId],
  );
  return result.rows;
}

export async function replaceLeagueTeamsSnapshot(input: ReplaceLeagueTeamsSnapshotInput): Promise<number> {
  const fetchedAt = input.fetchedAt ?? new Date();
  return transaction(async (client) => {
    await client.query('DELETE FROM league_team_directory WHERE league_id = $1', [input.leagueId]);

    for (const row of input.teams) {
      await client.query(
        `INSERT INTO teams (
           team_id, team_name, team_logo, country, founded, venue_id, venue_name, venue_city, source_provider, last_synced_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'api-football', $9, NOW())
         ON CONFLICT (team_id) DO UPDATE SET
           team_name = EXCLUDED.team_name,
           team_logo = EXCLUDED.team_logo,
           country = EXCLUDED.country,
           founded = EXCLUDED.founded,
           venue_id = EXCLUDED.venue_id,
           venue_name = EXCLUDED.venue_name,
           venue_city = EXCLUDED.venue_city,
           source_provider = EXCLUDED.source_provider,
           last_synced_at = EXCLUDED.last_synced_at,
           updated_at = NOW()`,
        [
          row.team.id,
          row.team.name,
          row.team.logo,
          row.team.country ?? '',
          row.team.founded,
          row.venue?.id ?? null,
          row.venue?.name ?? '',
          row.venue?.city ?? '',
          fetchedAt,
        ],
      );

      await client.query(
        `INSERT INTO league_team_directory (
           league_id, team_id, season, rank, source_provider, fetched_at, expires_at
         )
         VALUES ($1, $2, $3, $4, 'api-football', $5, $6)`,
        [
          input.leagueId,
          row.team.id,
          input.season,
          row.rank,
          fetchedAt,
          input.expiresAt,
        ],
      );
    }

    return input.teams.length;
  });
}