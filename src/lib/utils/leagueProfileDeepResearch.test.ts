import { describe, expect, test } from 'vitest';
import type { League } from '@/types';
import {
  buildLeagueProfileDeepResearchPrompt,
  parseImportedLeagueProfile,
  repairJson,
  summarizeDraft,
  DEFAULT_LEAGUE_PROFILE_DRAFT,
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

describe('buildLeagueProfileDeepResearchPrompt', () => {
  test('contains league metadata', () => {
    const prompt = buildLeagueProfileDeepResearchPrompt(league);

    expect(prompt).toContain('- league_name: Premier League');
    expect(prompt).toContain('- country: England');
    expect(prompt).toContain('Return exactly one JSON object, not an array, not markdown.');
  });

  test('uses 3-level tier values only', () => {
    const prompt = buildLeagueProfileDeepResearchPrompt(league);

    expect(prompt).toContain('"low|balanced|high"');
    expect(prompt).not.toContain('very_low');
    expect(prompt).not.toContain('very_high');
    expect(prompt).not.toContain('"normal"');
  });

  test('includes quantitative field definitions', () => {
    const prompt = buildLeagueProfileDeepResearchPrompt(league);

    expect(prompt).toContain('avg_goals');
    expect(prompt).toContain('over_2_5_rate');
    expect(prompt).toContain('btts_rate');
    expect(prompt).toContain('avg_corners');
    expect(prompt).toContain('avg_cards');
  });
});

describe('parseImportedLeagueProfile', () => {
  test('parses valid 3-level tier import', () => {
    const result = parseImportedLeagueProfile(JSON.stringify({
      league_id: 39,
      league_name: 'Premier League',
      country: 'England',
      qualitative_profile: {
        tempo_tier: 'high',
        goal_tendency: 'high',
        home_advantage_tier: 'balanced',
        corners_tendency: 'high',
        cards_tendency: 'low',
        volatility_tier: 'low',
        data_reliability_tier: 'high',
      },
      quantitative_verified: {
        avg_goals: 3.01,
        over_2_5_rate: 0.628,
        btts_rate: 0.574,
        late_goal_rate_75_plus: 0.297,
        avg_corners: 10.1,
        avg_cards: 3.8,
      },
      notes_en: 'Open and fast league.',
      notes_vi: 'Giai dau co nhip do cao.',
    }), league);

    expect(result.draft.profile.tempo_tier).toBe('high');
    expect(result.draft.profile.goal_tendency).toBe('high');
    expect(result.draft.profile.home_advantage_tier).toBe('balanced');
    expect(result.draft.profile.avg_goals).toBe(3.01);
    expect(result.draft.profile.avg_corners).toBe(10.1);
    expect(result.draft.notes_en).toBe('Open and fast league.');
    expect(result.draft.notes_vi).toBe('Giai dau co nhip do cao.');
  });

  test('falls back to "balanced" for unrecognised tier values', () => {
    const result = parseImportedLeagueProfile(JSON.stringify({
      league_name: 'Premier League',
      country: 'England',
      qualitative_profile: {
        tempo_tier: 'very_high',       // no longer valid → balanced
        goal_tendency: 'medium',       // not a valid tier → balanced
        home_advantage_tier: 'normal', // no longer valid → balanced
        corners_tendency: 'high',
        cards_tendency: 'low',
        volatility_tier: 'balanced',
        data_reliability_tier: 'high',
      },
    }), league);

    expect(result.draft.profile.tempo_tier).toBe('balanced');
    expect(result.draft.profile.goal_tendency).toBe('balanced');
    expect(result.draft.profile.home_advantage_tier).toBe('balanced');
    expect(result.draft.profile.corners_tendency).toBe('high');
  });

  test('rejects import for a different league', () => {
    expect(() => parseImportedLeagueProfile(JSON.stringify({
      league_name: 'La Liga',
      country: 'Spain',
    }), league)).toThrow('Imported profile is for "La Liga", not "Premier League".');
  });

  test('rejects empty input', () => {
    expect(() => parseImportedLeagueProfile('', league)).toThrow('Import content is empty.');
  });

  test('rejects non-JSON string', () => {
    expect(() => parseImportedLeagueProfile('not json {{{', league)).toThrow();
  });

  test('extracts from nested profile key', () => {
    const result = parseImportedLeagueProfile(JSON.stringify({
      league_name: 'Premier League',
      country: 'England',
      profile: {
        tempo_tier: 'low',
        avg_goals: 2.5,
      },
    }), league);

    expect(result.draft.profile.tempo_tier).toBe('low');
    expect(result.draft.profile.avg_goals).toBe(2.5);
  });

  test('sets repaired flag when JSON was auto-repaired', () => {
    const brokenJson = '{"league_name": "Premier League", "country": "England", "tempo_tier": ,}';
    const result = parseImportedLeagueProfile(brokenJson, league);
    expect(result.repaired).toBe(true);
  });

  test('parses notes from root object', () => {
    const result = parseImportedLeagueProfile(JSON.stringify({
      league_name: 'Premier League',
      country: 'England',
      notes_en: 'High tempo.',
      notes_vi: 'Toc do cao.',
    }), league);

    expect(result.draft.notes_en).toBe('High tempo.');
    expect(result.draft.notes_vi).toBe('Toc do cao.');
  });

  test('returns null for missing quantitative fields', () => {
    const result = parseImportedLeagueProfile(JSON.stringify({
      league_name: 'Premier League',
      country: 'England',
    }), league);

    expect(result.draft.profile.avg_goals).toBeNull();
    expect(result.draft.profile.over_2_5_rate).toBeNull();
  });
});

describe('repairJson', () => {
  test('strips markdown code fences', () => {
    const input = '```json\n{"key": "value"}\n```';
    expect(repairJson(input)).toBe('{"key": "value"}');
  });

  test('removes trailing commas', () => {
    const input = '{"a": 1, "b": 2,}';
    expect(repairJson(input)).toBe('{"a": 1, "b": 2}');
  });

  test('replaces empty values with null', () => {
    const input = '{"a": , "b": 2}';
    expect(repairJson(input)).toBe('{"a": null, "b": 2}');
  });
});

describe('summarizeDraft', () => {
  test('marks all defaults as "default" status', () => {
    const summary = summarizeDraft(DEFAULT_LEAGUE_PROFILE_DRAFT);
    const allDefault = summary.every((f) => f.status === 'default');
    expect(allDefault).toBe(true);
  });

  test('marks changed tier as "set" status', () => {
    const draft = {
      ...DEFAULT_LEAGUE_PROFILE_DRAFT,
      profile: { ...DEFAULT_LEAGUE_PROFILE_DRAFT.profile, tempo_tier: 'high' as const },
    };
    const summary = summarizeDraft(draft);
    const tempoField = summary.find((f) => f.label === 'Tempo');
    expect(tempoField?.status).toBe('set');
    expect(tempoField?.value).toBe('high');
  });

  test('marks changed quantitative as "set" status', () => {
    const draft = {
      ...DEFAULT_LEAGUE_PROFILE_DRAFT,
      profile: { ...DEFAULT_LEAGUE_PROFILE_DRAFT.profile, avg_goals: 2.8 },
    };
    const summary = summarizeDraft(draft);
    const avgGoals = summary.find((f) => f.label === 'Avg Goals');
    expect(avgGoals?.status).toBe('set');
    expect(avgGoals?.value).toBe('2.8');
  });

  test('returns 15 summary fields', () => {
    const summary = summarizeDraft(DEFAULT_LEAGUE_PROFILE_DRAFT);
    expect(summary).toHaveLength(15);
  });
});
