import { describe, expect, test } from 'vitest';
import {
  buildTeamProfileDeepResearchPrompt,
  parseImportedTeamProfile,
  summarizeDraft,
  DEFAULT_TEAM_PROFILE_DATA,
  DEFAULT_TEAM_PROFILE_DRAFT,
} from './teamProfileDeepResearch';

describe('buildTeamProfileDeepResearchPrompt', () => {
  test('includes team name and tactical-overlay-only guidance', () => {
    const prompt = buildTeamProfileDeepResearchPrompt('Arsenal');
    expect(prompt).toContain('"Arsenal"');
    expect(prompt).toContain('TACTICAL OVERLAY ONLY');
    expect(prompt).not.toContain('avg_goals_scored');
  });

  test('includes league context when provided', () => {
    const prompt = buildTeamProfileDeepResearchPrompt('Arsenal', 'Premier League');
    expect(prompt).toContain('associated with Premier League');
  });

  test('contains versioned overlay schema fields and source audit fields', () => {
    const prompt = buildTeamProfileDeepResearchPrompt('Arsenal');
    for (const field of [
      'schema_version',
      'target',
      'entity_type',
      'competition_context',
      'attack_style',
      'defensive_line',
      'pressing_intensity',
      'squad_depth',
      'data_sources',
      'sample_confidence',
      'season',
      'notes_en',
      'notes_vi',
    ]) {
      expect(prompt, `missing field: ${field}`).toContain(field);
    }
  });
});

describe('parseImportedTeamProfile', () => {
  const baseDraft = {
    ...DEFAULT_TEAM_PROFILE_DRAFT,
    profile: {
      ...DEFAULT_TEAM_PROFILE_DATA,
      avg_goals_scored: 2.1,
      avg_goals_conceded: 0.9,
      btts_rate: 48,
      set_piece_threat: 'high' as const,
    },
  };

  test('applies only tactical overlay fields and preserves quantitative core', () => {
    const response = JSON.stringify({
      schema_version: 1,
      target: 'team_tactical_overlay',
      entity_type: 'club',
      team_name: 'Arsenal',
      competition_context: 'Premier League 2025/26',
      season: '2025/26',
      data_sources: ['https://fbref.com/en/squads/arsenal', 'https://transfermarkt.com/arsenal'],
      sample_confidence: 'high',
      profile: {
        attack_style: 'possession',
        defensive_line: 'high',
        pressing_intensity: 'high',
        squad_depth: 'deep',
      },
      notes_en: 'Aggressive high press with strong bench coverage.',
      notes_vi: 'Pressing cao va bench depth tot.',
    });

    const { draft, repaired, summary } = parseImportedTeamProfile(response, 'Arsenal', baseDraft);

    expect(repaired).toBe(false);
    expect(draft.profile.attack_style).toBe('possession');
    expect(draft.profile.defensive_line).toBe('high');
    expect(draft.profile.pressing_intensity).toBe('high');
    expect(draft.profile.squad_depth).toBe('deep');
    expect(draft.profile.avg_goals_scored).toBe(2.1);
    expect(draft.profile.avg_goals_conceded).toBe(0.9);
    expect(draft.profile.btts_rate).toBe(48);
    expect(draft.profile.set_piece_threat).toBe('high');
    expect(draft.overlay_metadata).toEqual({
      source_mode: 'llm_assisted',
      source_confidence: 'high',
      source_urls: ['https://fbref.com/en/squads/arsenal', 'https://transfermarkt.com/arsenal'],
      source_season: '2025/26',
    });
    expect(draft.notes_en).toContain('Aggressive high press');
    expect(summary.find((entry) => entry.label === 'Source Count')?.value).toBe('2');
    expect(summary.find((entry) => entry.label === 'Source Confidence')?.value).toBe('high');
  });

  test('repairs fenced JSON and trailing commas', () => {
    const fenced = '```json\n{ "profile": { "attack_style": "counter", "defensive_line": "low", }, "data_sources": ["https://fbref.com/en/squads/arsenal"] }\n```';
    const { repaired, draft } = parseImportedTeamProfile(fenced, 'Arsenal', baseDraft);
    expect(repaired).toBe(true);
    expect(draft.profile.attack_style).toBe('counter');
    expect(draft.overlay_metadata?.source_urls).toEqual(['https://fbref.com/en/squads/arsenal']);
  });

  test('falls back to current tactical values for invalid enum values', () => {
    const json = JSON.stringify({
      data_sources: ['https://fbref.com/en/squads/arsenal'],
      profile: {
        attack_style: 'tiki-taka',
        defensive_line: 'ultra-high',
        pressing_intensity: 'medium',
        squad_depth: 'deep',
      },
    });
    const { draft } = parseImportedTeamProfile(json, 'Arsenal', baseDraft);
    expect(draft.profile.attack_style).toBe(baseDraft.profile.attack_style);
    expect(draft.profile.defensive_line).toBe(baseDraft.profile.defensive_line);
    expect(draft.profile.pressing_intensity).toBe('medium');
    expect(draft.profile.squad_depth).toBe('deep');
  });

  test('throws when no trusted tactical overlay source URLs are present', () => {
    const json = JSON.stringify({
      profile: {
        attack_style: 'counter',
      },
      data_sources: ['https://reddit.com/r/soccer'],
    });
    expect(() => parseImportedTeamProfile(json, 'Arsenal', baseDraft)).toThrow('No trusted tactical overlay source URLs found');
  });

  test('throws on invalid JSON', () => {
    expect(() => parseImportedTeamProfile('not json', 'Arsenal', baseDraft)).toThrow('Invalid JSON');
  });

  test('throws when target is not the tactical overlay contract', () => {
    expect(() => parseImportedTeamProfile(JSON.stringify({
      schema_version: 1,
      target: 'league_profile_core',
      data_sources: ['https://fbref.com/en/squads/arsenal'],
      profile: {
        attack_style: 'counter',
      },
    }), 'Arsenal', baseDraft)).toThrow('Imported JSON target is not team_tactical_overlay.');
  });
});

describe('summarizeDraft', () => {
  test('counts overlay metadata in addition to profile values', () => {
    const draft = {
      ...DEFAULT_TEAM_PROFILE_DRAFT,
      profile: {
        ...DEFAULT_TEAM_PROFILE_DATA,
        attack_style: 'counter' as const,
        avg_goals_scored: 1.8,
      },
      overlay_metadata: {
        source_mode: 'llm_assisted' as const,
        source_confidence: 'high' as const,
        source_urls: ['https://fbref.com/team'],
        source_season: '2025/26',
      },
    };
    const { set, total } = summarizeDraft(draft);
    expect(set).toBe(5);
    expect(total).toBe(21);
  });
});
