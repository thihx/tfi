import { describe, expect, test } from 'vitest';
import type { League } from '@/types';
import {
  buildLeagueProfileDeepResearchPrompt,
  parseImportedLeagueProfile,
} from './leagueProfileDeepResearch';

const league: League = {
  league_id: 39,
  league_name: 'Premier League',
  country: 'England',
  tier: '1',
  active: true,
  top_league: true,
  type: 'League',
  logo: '',
  last_updated: '',
};

describe('leagueProfileDeepResearch', () => {
  test('builds a single-league deep research prompt template', () => {
    const prompt = buildLeagueProfileDeepResearchPrompt(league);

    expect(prompt).toContain('- league_id: 39');
    expect(prompt).toContain('- league_name: Premier League');
    expect(prompt).toContain('- country: England');
    expect(prompt).toContain('- tfi_top_league: true');
    expect(prompt).toContain('Return exactly one JSON object, not an array, not markdown.');
  });

  test('parses deep research import schema into a league profile draft', () => {
    const draft = parseImportedLeagueProfile(JSON.stringify({
      league_id: 39,
      league_name: 'Premier League',
      country: 'England',
      qualitative_profile: {
        tempo_tier: 'high',
        goal_tendency: 'very_high',
        home_advantage_tier: 'normal',
        corners_tendency: 'high',
        cards_tendency: 'balanced',
        volatility_tier: 'medium',
        data_reliability_tier: 'high',
      },
      quantitative_verified: {
        avg_goals: 3.01,
        over_2_5_rate: 62.8,
        btts_rate: 57.4,
        late_goal_rate_75_plus: 29.7,
        avg_corners: 10.1,
        avg_cards: 3.8,
      },
      notes_en: 'Open and fast league.',
      notes_vi: 'Giai dau co nhip do cao.',
    }), league);

    expect(draft).toEqual(expect.objectContaining({
      tempo_tier: 'high',
      goal_tendency: 'very_high',
      avg_goals: 3.01,
      avg_corners: 10.1,
      notes_en: 'Open and fast league.',
      notes_vi: 'Giai dau co nhip do cao.',
    }));
  });

  test('rejects import for a different league', () => {
    expect(() => parseImportedLeagueProfile(JSON.stringify({
      league_name: 'La Liga',
      country: 'Spain',
      qualitative_profile: {
        tempo_tier: 'balanced',
      },
    }), league)).toThrow('Imported profile is for "La Liga", not "Premier League".');
  });
});
