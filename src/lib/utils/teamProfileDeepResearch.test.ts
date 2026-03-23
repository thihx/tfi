import { describe, expect, test } from 'vitest';
import {
  buildTeamProfileDeepResearchPrompt,
  parseImportedTeamProfile,
  summarizeDraft,
  DEFAULT_TEAM_PROFILE_DATA,
  DEFAULT_TEAM_PROFILE_DRAFT,
} from './teamProfileDeepResearch';

// ── buildTeamProfileDeepResearchPrompt ───────────────────────────────────────

describe('buildTeamProfileDeepResearchPrompt', () => {
  test('includes team name in the prompt', () => {
    const prompt = buildTeamProfileDeepResearchPrompt('Arsenal');
    expect(prompt).toContain('"Arsenal"');
    expect(prompt).toContain('"team_name": "Arsenal"');
  });

  test('includes league context when provided', () => {
    const prompt = buildTeamProfileDeepResearchPrompt('Arsenal', 'Premier League');
    expect(prompt).toContain('playing in Premier League');
  });

  test('omits league context when not provided', () => {
    const prompt = buildTeamProfileDeepResearchPrompt('Arsenal');
    expect(prompt).not.toContain('playing in');
  });

  test('contains all required JSON schema fields', () => {
    const prompt = buildTeamProfileDeepResearchPrompt('Arsenal');
    const requiredFields = [
      'attack_style', 'defensive_line', 'pressing_intensity', 'set_piece_threat',
      'home_strength', 'form_consistency', 'squad_depth',
      'avg_goals_scored', 'avg_goals_conceded', 'clean_sheet_rate',
      'btts_rate', 'over_2_5_rate', 'avg_corners_for', 'avg_corners_against',
      'avg_cards', 'first_goal_rate', 'late_goal_rate', 'data_reliability_tier',
      'notes_en', 'notes_vi',
    ];
    for (const field of requiredFields) {
      expect(prompt, `missing field: ${field}`).toContain(field);
    }
  });

  test('instructs AI to return only valid JSON', () => {
    const prompt = buildTeamProfileDeepResearchPrompt('Real Madrid');
    expect(prompt).toContain('Return ONLY valid JSON');
  });
});

// ── parseImportedTeamProfile ──────────────────────────────────────────────────

const FULL_AI_RESPONSE = JSON.stringify({
  team_name: 'Arsenal',
  season: '2024/25',
  data_sources: ['FBref', 'Transfermarkt'],
  sample_confidence: 'high',
  profile: {
    attack_style: 'possession',
    defensive_line: 'high',
    pressing_intensity: 'high',
    set_piece_threat: 'high',
    home_strength: 'strong',
    form_consistency: 'consistent',
    squad_depth: 'deep',
    avg_goals_scored: 2.2,
    avg_goals_conceded: 0.9,
    clean_sheet_rate: 42,
    btts_rate: 48,
    over_2_5_rate: 55,
    avg_corners_for: 6.1,
    avg_corners_against: 3.8,
    avg_cards: 1.4,
    first_goal_rate: 68,
    late_goal_rate: 35,
    data_reliability_tier: 'high',
  },
  notes_en: 'Strong possession team with high press.',
  notes_vi: 'Đội bóng kiểm soát bóng tốt.',
});

describe('parseImportedTeamProfile', () => {
  test('parses a valid full JSON response', () => {
    const { draft, repaired, summary } = parseImportedTeamProfile(FULL_AI_RESPONSE, 'Arsenal');

    expect(repaired).toBe(false);
    expect(draft.profile.attack_style).toBe('possession');
    expect(draft.profile.defensive_line).toBe('high');
    expect(draft.profile.home_strength).toBe('strong');
    expect(draft.profile.form_consistency).toBe('consistent');
    expect(draft.profile.squad_depth).toBe('deep');
    expect(draft.profile.avg_goals_scored).toBe(2.2);
    expect(draft.profile.avg_goals_conceded).toBe(0.9);
    expect(draft.profile.clean_sheet_rate).toBe(42);
    expect(draft.profile.btts_rate).toBe(48);
    expect(draft.profile.over_2_5_rate).toBe(55);
    expect(draft.profile.avg_corners_for).toBe(6.1);
    expect(draft.profile.avg_corners_against).toBe(3.8);
    expect(draft.profile.avg_cards).toBe(1.4);
    expect(draft.profile.first_goal_rate).toBe(68);
    expect(draft.profile.late_goal_rate).toBe(35);
    expect(draft.profile.data_reliability_tier).toBe('high');
    expect(draft.notes_en).toBe('Strong possession team with high press.');
    expect(draft.notes_vi).toBe('Đội bóng kiểm soát bóng tốt.');

    // All 18 summary fields should be marked 'set' (non-default)
    const setCount = summary.filter((r) => r.status === 'set').length;
    expect(setCount).toBeGreaterThan(14);
  });

  test('repairs markdown-fenced JSON and sets repaired=true', () => {
    const fenced = '```json\n' + FULL_AI_RESPONSE + '\n```';
    const { repaired, draft } = parseImportedTeamProfile(fenced, 'Arsenal');

    expect(repaired).toBe(true);
    expect(draft.profile.attack_style).toBe('possession');
  });

  test('repairs JSON with trailing commas', () => {
    const withTrailingComma = `{ "profile": { "attack_style": "counter", "defensive_line": "low", } }`;
    const { repaired, draft } = parseImportedTeamProfile(withTrailingComma, 'Arsenal');

    expect(repaired).toBe(true);
    expect(draft.profile.attack_style).toBe('counter');
    expect(draft.profile.defensive_line).toBe('low');
  });

  test('falls back to defaults for unknown enum values', () => {
    const json = JSON.stringify({
      profile: {
        attack_style: 'tiki-taka',       // invalid
        defensive_line: 'ultra_high',    // invalid
        pressing_intensity: 'medium',
        home_strength: 'fortress',       // invalid
        form_consistency: 'inconsistent',
        squad_depth: 'deep',
        set_piece_threat: 'high',
        data_reliability_tier: 'high',
      },
    });
    const { draft } = parseImportedTeamProfile(json, 'Arsenal');

    expect(draft.profile.attack_style).toBe(DEFAULT_TEAM_PROFILE_DATA.attack_style);       // 'mixed'
    expect(draft.profile.defensive_line).toBe(DEFAULT_TEAM_PROFILE_DATA.defensive_line);   // 'medium'
    expect(draft.profile.home_strength).toBe(DEFAULT_TEAM_PROFILE_DATA.home_strength);     // 'normal'
    expect(draft.profile.pressing_intensity).toBe('medium');  // valid
    expect(draft.profile.squad_depth).toBe('deep');           // valid
  });

  test('returns null for missing numeric fields', () => {
    const json = JSON.stringify({ profile: { attack_style: 'counter' } });
    const { draft } = parseImportedTeamProfile(json, 'Arsenal');

    expect(draft.profile.avg_goals_scored).toBeNull();
    expect(draft.profile.avg_goals_conceded).toBeNull();
    expect(draft.profile.clean_sheet_rate).toBeNull();
    expect(draft.profile.btts_rate).toBeNull();
    expect(draft.profile.over_2_5_rate).toBeNull();
    expect(draft.profile.avg_corners_for).toBeNull();
    expect(draft.profile.avg_corners_against).toBeNull();
    expect(draft.profile.avg_cards).toBeNull();
    expect(draft.profile.first_goal_rate).toBeNull();
    expect(draft.profile.late_goal_rate).toBeNull();
  });

  test('reads notes from top-level when not inside profile block', () => {
    const json = JSON.stringify({
      profile: { attack_style: 'direct' },
      notes_en: 'Long ball team.',
      notes_vi: 'Đội đá dài.',
    });
    const { draft } = parseImportedTeamProfile(json, 'Arsenal');

    expect(draft.notes_en).toBe('Long ball team.');
    expect(draft.notes_vi).toBe('Đội đá dài.');
  });

  test('accepts flat JSON without nested profile block', () => {
    const json = JSON.stringify({
      attack_style: 'counter',
      defensive_line: 'low',
      pressing_intensity: 'low',
      set_piece_threat: 'medium',
      home_strength: 'weak',
      form_consistency: 'volatile',
      squad_depth: 'shallow',
      data_reliability_tier: 'low',
    });
    const { draft } = parseImportedTeamProfile(json, 'Arsenal');

    expect(draft.profile.attack_style).toBe('counter');
    expect(draft.profile.defensive_line).toBe('low');
  });

  test('throws on completely invalid JSON that cannot be repaired', () => {
    expect(() => parseImportedTeamProfile('not json at all !!!', 'Arsenal'))
      .toThrow('Invalid JSON');
  });

  test('throws if parsed value is not an object', () => {
    expect(() => parseImportedTeamProfile('[1, 2, 3]', 'Arsenal'))
      .toThrow('not an object');
  });

  test('does NOT reject profiles with a different team_name (no validation)', () => {
    const json = JSON.stringify({
      team_name: 'Chelsea',
      profile: { attack_style: 'direct' },
    });
    // Unlike LeagueProfile, team name is informational only — no throw expected
    expect(() => parseImportedTeamProfile(json, 'Arsenal')).not.toThrow();
  });

  test('summary marks numeric fields as default when null', () => {
    const json = JSON.stringify({ profile: { attack_style: 'possession' } });
    const { summary } = parseImportedTeamProfile(json, 'Arsenal');

    const goalsScored = summary.find((r) => r.label === 'Goals Scored/90');
    expect(goalsScored?.status).toBe('default');
    expect(goalsScored?.value).toBe('—');
  });

  test('summary marks numeric fields as set when provided', () => {
    const json = JSON.stringify({ profile: { avg_goals_scored: 1.5 } });
    const { summary } = parseImportedTeamProfile(json, 'Arsenal');

    const goalsScored = summary.find((r) => r.label === 'Goals Scored/90');
    expect(goalsScored?.status).toBe('set');
    expect(goalsScored?.value).toBe('1.5');
  });
});

// ── summarizeDraft ────────────────────────────────────────────────────────────

describe('summarizeDraft', () => {
  test('default draft has set=0, total=18', () => {
    const { set, total } = summarizeDraft(DEFAULT_TEAM_PROFILE_DRAFT);
    expect(set).toBe(0);
    expect(total).toBe(18);
  });

  test('counts qualitative fields that differ from defaults', () => {
    const draft = {
      ...DEFAULT_TEAM_PROFILE_DRAFT,
      profile: { ...DEFAULT_TEAM_PROFILE_DATA, attack_style: 'counter' as const, home_strength: 'strong' as const },
    };
    const { set } = summarizeDraft(draft);
    expect(set).toBe(2);
  });

  test('counts quantitative fields that are non-null', () => {
    const draft = {
      ...DEFAULT_TEAM_PROFILE_DRAFT,
      profile: { ...DEFAULT_TEAM_PROFILE_DATA, avg_goals_scored: 1.8, btts_rate: 52, avg_cards: 2.1 },
    };
    const { set } = summarizeDraft(draft);
    expect(set).toBe(3);
  });

  test('counts both qualitative and quantitative fields together', () => {
    const draft = {
      ...DEFAULT_TEAM_PROFILE_DRAFT,
      profile: {
        ...DEFAULT_TEAM_PROFILE_DATA,
        attack_style: 'possession' as const,   // qualitative (1)
        defensive_line: 'high' as const,       // qualitative (2)
        avg_goals_scored: 2.0,                 // quantitative (3)
        clean_sheet_rate: 38,                  // quantitative (4)
      },
    };
    const { set, total } = summarizeDraft(draft);
    expect(set).toBe(4);
    expect(total).toBe(18);
  });

  test('notes are not counted in set/total', () => {
    const draft = { ...DEFAULT_TEAM_PROFILE_DRAFT, notes_en: 'Some note', notes_vi: 'Ghi chu' };
    const { set } = summarizeDraft(draft);
    expect(set).toBe(0); // notes don't contribute to the field count
  });
});
