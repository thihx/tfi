import { describe, expect, test } from 'vitest';

import { __testables__ } from '../lib/profile-coverage.js';

describe('profile coverage', () => {
  test('summarizes top-league profile gaps from league and team coverage', () => {
    const coverage = __testables__.summarizeCoverage(
      [
        {
          league_id: 39,
          league_name: 'Premier League',
          country: 'England',
          tier: '1',
          active: true,
          top_league: true,
          type: 'League',
          logo: '',
          last_updated: '',
        },
        {
          league_id: 98,
          league_name: 'J1 League',
          country: 'Japan',
          tier: '1',
          active: true,
          top_league: true,
          type: 'League',
          logo: '',
          last_updated: '',
        },
      ],
      new Set([39]),
      [
        { league_id: 39, team_id: 1, team_name: 'Arsenal', source: 'directory' },
        { league_id: 39, team_id: 2, team_name: 'Chelsea', source: 'directory' },
        { league_id: 98, team_id: 303, team_name: 'Machida Zelvia', source: 'matches' },
        { league_id: 98, team_id: 292, team_name: 'FC Tokyo', source: 'matches' },
      ],
      new Set(['1', '2', '303']),
    );

    expect(coverage.summary).toEqual({
      topLeagues: 2,
      topLeagueProfiles: 1,
      topLeagueTeams: 4,
      topLeagueTeamsWithProfile: 3,
      teamProfileCoverage: 0.75,
      fullCoverageLeagues: 1,
      partialCoverageLeagues: 1,
      missingCoverageLeagues: 0,
    });
    expect(coverage.leagues[0]).toMatchObject({
      leagueId: 98,
      hasLeagueProfile: false,
      candidateTeams: 2,
      profiledTeams: 1,
      missingTeamProfiles: 1,
      missingTeamNames: ['FC Tokyo'],
    });
    expect(coverage.leagues[1]).toMatchObject({
      leagueId: 39,
      hasLeagueProfile: true,
      candidateTeams: 2,
      profiledTeams: 2,
      missingTeamProfiles: 0,
    });
  });
});
