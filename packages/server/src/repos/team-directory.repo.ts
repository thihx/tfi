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

export interface LeagueTeamDirectoryFreshnessRow {
  league_id: number;
  row_count: number;
  oldest_expires_at: string | null;
  newest_fetched_at: string | null;
  is_fresh: boolean;
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

export async function getLeagueTeamDirectoryFreshness(
  leagueIds: number[],
): Promise<Map<number, LeagueTeamDirectoryFreshnessRow>> {
  const ids = Array.from(new Set(leagueIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return new Map();

  const result = await query<LeagueTeamDirectoryFreshnessRow>(
    `WITH target AS (
       SELECT unnest($1::integer[]) AS league_id
     ),
     directory AS (
       SELECT
         league_id,
         COUNT(*)::int AS row_count,
         MIN(expires_at) AS oldest_expires_at,
         MAX(fetched_at) AS newest_fetched_at
       FROM league_team_directory
       WHERE league_id = ANY($1)
       GROUP BY league_id
     )
     SELECT
       target.league_id,
       COALESCE(directory.row_count, 0)::int AS row_count,
       directory.oldest_expires_at::text,
       directory.newest_fetched_at::text,
       (COALESCE(directory.row_count, 0) > 0 AND directory.oldest_expires_at > NOW()) AS is_fresh
     FROM target
     LEFT JOIN directory ON directory.league_id = target.league_id`,
    [ids],
  );

  return new Map(result.rows.map((row) => [row.league_id, row]));
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

export async function getLeagueIdsForTeams(
  teamIds: Array<number | string>,
  options: { activeOnly?: boolean } = {},
): Promise<number[]> {
  const normalizedIds = Array.from(
    new Set(
      teamIds
        .map((teamId) => String(teamId).trim())
        .filter(Boolean),
    ),
  );
  if (normalizedIds.length === 0) return [];

  const result = await query<{ league_id: number }>(
    `SELECT DISTINCT ltd.league_id
     FROM league_team_directory ltd
     JOIN leagues l ON l.league_id = ltd.league_id
     WHERE ltd.team_id::text = ANY($1)
       AND ($2::boolean = FALSE OR l.active = TRUE)
     ORDER BY ltd.league_id`,
    [normalizedIds, options.activeOnly === true],
  );

  return result.rows.map((row) => row.league_id);
}
