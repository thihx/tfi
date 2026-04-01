import { getTopLeagues, type LeagueRow } from '../repos/leagues.repo.js';
import { getAllLeagueProfiles } from '../repos/league-profiles.repo.js';
import { getTeamIdsWithProfile } from '../repos/team-profiles.repo.js';
import { getPrematchProfileCandidateTeams } from './prematch-profile-team-candidates.js';

export interface TopLeagueProfileCoverageSummary {
  topLeagues: number;
  topLeagueProfiles: number;
  topLeagueTeams: number;
  topLeagueTeamsWithProfile: number;
  teamProfileCoverage: number | null;
  fullCoverageLeagues: number;
  partialCoverageLeagues: number;
  missingCoverageLeagues: number;
}

export interface TopLeagueProfileCoverageRow {
  leagueId: number;
  leagueName: string;
  country: string;
  hasLeagueProfile: boolean;
  candidateTeams: number;
  profiledTeams: number;
  missingTeamProfiles: number;
  teamProfileCoverage: number | null;
  missingTeamNames: string[];
}

export interface TopLeagueProfileCoverage {
  summary: TopLeagueProfileCoverageSummary;
  leagues: TopLeagueProfileCoverageRow[];
}

function round(value: number | null, digits = 3): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function classifyCoverage(league: TopLeagueProfileCoverageRow): 'full' | 'partial' | 'missing' {
  const hasAnyCoverage = league.hasLeagueProfile || league.profiledTeams > 0;
  const isFull = league.hasLeagueProfile
    && league.candidateTeams > 0
    && league.profiledTeams >= league.candidateTeams;

  if (isFull) return 'full';
  if (hasAnyCoverage) return 'partial';
  return 'missing';
}

function summarizeCoverage(
  leagues: LeagueRow[],
  leagueProfileIds: Set<number>,
  candidateTeams: Awaited<ReturnType<typeof getPrematchProfileCandidateTeams>>,
  profiledTeamIds: Set<string>,
): TopLeagueProfileCoverage {
  const teamsByLeague = new Map<number, typeof candidateTeams>();
  for (const team of candidateTeams) {
    const list = teamsByLeague.get(team.league_id) ?? [];
    list.push(team);
    teamsByLeague.set(team.league_id, list);
  }

  const rows: TopLeagueProfileCoverageRow[] = leagues.map((league) => {
    const leagueTeams = teamsByLeague.get(league.league_id) ?? [];
    const profiledTeams = leagueTeams.filter((team) => profiledTeamIds.has(String(team.team_id)));
    const missingTeams = leagueTeams.filter((team) => !profiledTeamIds.has(String(team.team_id)));
    return {
      leagueId: league.league_id,
      leagueName: league.league_name,
      country: league.country,
      hasLeagueProfile: leagueProfileIds.has(league.league_id),
      candidateTeams: leagueTeams.length,
      profiledTeams: profiledTeams.length,
      missingTeamProfiles: missingTeams.length,
      teamProfileCoverage: leagueTeams.length > 0 ? round(profiledTeams.length / leagueTeams.length) : null,
      missingTeamNames: missingTeams.slice(0, 5).map((team) => team.team_name),
    };
  }).sort((left, right) =>
    (left.teamProfileCoverage ?? -1) - (right.teamProfileCoverage ?? -1)
    || right.missingTeamProfiles - left.missingTeamProfiles
    || Number(left.hasLeagueProfile) - Number(right.hasLeagueProfile)
    || left.leagueName.localeCompare(right.leagueName),
  );

  let fullCoverageLeagues = 0;
  let partialCoverageLeagues = 0;
  let missingCoverageLeagues = 0;
  for (const row of rows) {
    const classification = classifyCoverage(row);
    if (classification === 'full') fullCoverageLeagues += 1;
    else if (classification === 'partial') partialCoverageLeagues += 1;
    else missingCoverageLeagues += 1;
  }

  return {
    summary: {
      topLeagues: leagues.length,
      topLeagueProfiles: leagues.filter((league) => leagueProfileIds.has(league.league_id)).length,
      topLeagueTeams: candidateTeams.length,
      topLeagueTeamsWithProfile: candidateTeams.filter((team) => profiledTeamIds.has(String(team.team_id))).length,
      teamProfileCoverage: candidateTeams.length > 0
        ? round(candidateTeams.filter((team) => profiledTeamIds.has(String(team.team_id))).length / candidateTeams.length)
        : null,
      fullCoverageLeagues,
      partialCoverageLeagues,
      missingCoverageLeagues,
    },
    leagues: rows,
  };
}

export async function getTopLeagueProfileCoverage(): Promise<TopLeagueProfileCoverage> {
  const topLeagues = await getTopLeagues();
  const leagueIds = topLeagues.map((league) => league.league_id);
  const [leagueProfiles, candidateTeams, profiledTeamIds] = await Promise.all([
    getAllLeagueProfiles(),
    getPrematchProfileCandidateTeams(leagueIds),
    getTeamIdsWithProfile(),
  ]);

  return summarizeCoverage(
    topLeagues,
    new Set(leagueProfiles.map((profile) => profile.league_id)),
    candidateTeams,
    profiledTeamIds,
  );
}

export const __testables__ = {
  summarizeCoverage,
};
