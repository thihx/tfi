import { describe, expect, test } from 'vitest';

import { __testables__ } from '../lib/prematch-profile-team-candidates.js';

describe('prematch profile team candidates', () => {
  test('prefers directory entries while filling gaps from current matches', () => {
    const merged = __testables__.mergePrematchProfileCandidateTeams(
      [
        { league_id: 98, team_id: 303, team_name: 'Machida Zelvia', source: 'directory' },
        { league_id: 98, team_id: 111, team_name: 'Kawasaki Frontale', source: 'directory' },
      ],
      [
        { league_id: 98, team_id: 303, team_name: 'Machida   Zelvia', source: 'matches' },
        { league_id: 98, team_id: 292, team_name: 'FC Tokyo', source: 'matches' },
      ],
    );

    expect(merged).toEqual([
      { league_id: 98, team_id: 292, team_name: 'FC Tokyo', source: 'matches' },
      { league_id: 98, team_id: 111, team_name: 'Kawasaki Frontale', source: 'directory' },
      { league_id: 98, team_id: 303, team_name: 'Machida Zelvia', source: 'directory' },
    ]);
  });
});
