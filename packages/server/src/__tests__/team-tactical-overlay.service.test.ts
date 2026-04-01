import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockGenerateGeminiContent = vi.fn();
const mockGetTopLeagueTacticalOverlayRefreshCandidates = vi.fn();
const mockUpsertTeamProfile = vi.fn();
const mockAuditSuccess = vi.fn();
const mockAuditFailure = vi.fn();
const mockAuditSkipped = vi.fn();

vi.mock('../config.js', () => ({
  config: {
    geminiApiKey: 'test-key',
    geminiStrategicGroundedModel: 'gemini-2.5-flash',
    geminiTimeoutMs: 90_000,
    geminiStrategicGroundedThinkingBudget: 0,
    tacticalOverlayRefreshMaxPerRun: 2,
    tacticalOverlayRefreshStaleDays: 30,
  },
}));

vi.mock('../lib/gemini.js', () => ({
  generateGeminiContent: mockGenerateGeminiContent,
}));

vi.mock('../lib/audit.js', () => ({
  auditSuccess: mockAuditSuccess,
  auditFailure: mockAuditFailure,
  auditSkipped: mockAuditSkipped,
}));

vi.mock('../repos/team-profiles.repo.js', async () => {
  const actual = await vi.importActual<typeof import('../repos/team-profiles.repo.js')>('../repos/team-profiles.repo.js');
  return {
    ...actual,
    getTopLeagueTacticalOverlayRefreshCandidates: mockGetTopLeagueTacticalOverlayRefreshCandidates,
    upsertTeamProfile: mockUpsertTeamProfile,
  };
});

const service = await import('../lib/team-tactical-overlay.service.js');

function buildCandidate(overrides: Partial<import('../repos/team-profiles.repo.js').TacticalOverlayRefreshCandidateRow> = {}) {
  return {
    team_id: '167',
    team_name: 'Arsenal',
    team_logo: 'https://logo/167.png',
    league_id: 39,
    league_name: 'Premier League',
    league_country: 'England',
    league_type: 'League',
    league_season: 2026,
    top_league: true,
    notes_en: 'Existing English note',
    notes_vi: 'Existing Vietnamese note',
    created_at: '2026-04-01T00:00:00.000Z',
    updated_at: '2026-04-01T00:00:00.000Z',
    profile: {
      version: 2,
      source_mode: 'hybrid',
      window: {
        lookback_days: 180,
        sample_matches: 18,
        sample_home_matches: 9,
        sample_away_matches: 9,
        event_summary_matches: 18,
        event_coverage: 1,
        top_league_only: true,
        computed_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-01T00:00:00.000Z',
      },
      quantitative_core: {
        set_piece_threat: 'high',
        home_strength: 'strong',
        form_consistency: 'consistent',
        avg_goals_scored: 1.9,
        avg_goals_conceded: 0.8,
        clean_sheet_rate: 0.4,
        btts_rate: 0.45,
        over_2_5_rate: 0.5,
        avg_corners_for: 6.2,
        avg_corners_against: 4.1,
        avg_cards: 1.9,
        first_goal_rate: 0.61,
        late_goal_rate: 0.33,
        data_reliability_tier: 'high',
      },
      tactical_overlay: {
        attack_style: 'mixed',
        defensive_line: 'medium',
        pressing_intensity: 'medium',
        squad_depth: 'medium',
        source_mode: 'default_neutral',
        source_confidence: null,
        source_urls: [],
        source_season: null,
        updated_at: null,
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('team tactical overlay service', () => {
  test('selects default-neutral and stale llm-assisted candidates, but excludes curated/manual override', () => {
    const selected = service.__testables__.selectTacticalOverlayRefreshCandidates([
      buildCandidate({ team_id: '1', team_name: 'A' }),
      buildCandidate({
        team_id: '2',
        team_name: 'B',
        profile: {
          ...buildCandidate().profile,
          tactical_overlay: {
            ...buildCandidate().profile.tactical_overlay,
            source_mode: 'llm_assisted',
            source_confidence: 'medium',
            source_urls: ['https://fbref.com/en/squads/2'],
            updated_at: '2025-01-01T00:00:00.000Z',
          },
        },
      }),
      buildCandidate({
        team_id: '3',
        team_name: 'C',
        profile: {
          ...buildCandidate().profile,
          tactical_overlay: {
            ...buildCandidate().profile.tactical_overlay,
            source_mode: 'curated',
            source_confidence: 'high',
            source_urls: ['https://fbref.com/en/squads/3'],
            updated_at: '2026-03-30T00:00:00.000Z',
          },
        },
      }),
      buildCandidate({
        team_id: '4',
        team_name: 'D',
        profile: {
          ...buildCandidate().profile,
          tactical_overlay: {
            ...buildCandidate().profile.tactical_overlay,
            source_mode: 'manual_override',
            source_confidence: 'high',
            source_urls: ['https://fbref.com/en/squads/4'],
            updated_at: '2026-03-30T00:00:00.000Z',
          },
        },
      }),
    ], { maxPerRun: 10, staleDays: 30 }, new Date('2026-04-01T00:00:00.000Z'));

    expect(selected.map((row) => row.team_id)).toEqual(['1', '2']);
  });

  test('parses trusted URLs from grounding metadata and caps confidence by source count', () => {
    const parsed = service.__testables__.parseOverlayResponse({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              team_name: 'Arsenal',
              season: '2025/26',
              data_sources: ['https://unknown.example.com/report'],
              sample_confidence: 'high',
              profile: {
                attack_style: 'possession',
                defensive_line: 'high',
                pressing_intensity: 'high',
                squad_depth: 'deep',
              },
              notes_en: 'Aggressive press with strong positional control.',
              notes_vi: 'Ap luc tam cao va kiem soat vi tri tot.',
            }),
          }],
        },
        groundingMetadata: {
          groundingChunks: [
            { web: { uri: 'https://fbref.com/en/squads/arsenal', title: 'Arsenal Stats' } },
            { web: { uri: 'https://www.premierleague.com/clubs/1/Arsenal/overview', title: 'Arsenal Official' } },
          ],
        },
      }],
    });

    expect(parsed.attackStyle).toBe('possession');
    expect(parsed.sourceUrls).toEqual([
      'https://fbref.com/en/squads/arsenal',
      'https://www.premierleague.com/clubs/1/Arsenal/overview',
    ]);
    expect(parsed.sourceConfidence).toBe('medium');
  });

  test('repairs literal newlines inside JSON strings from grounded model output', () => {
    const parsed = service.__testables__.parseOverlayResponse({
      candidates: [{
        content: {
          parts: [{
            text: '{\n  "team_name": "Arsenal",\n  "season": "2025/26",\n  "data_sources": ["https://fbref.com/en/squads/arsenal"],\n  "sample_confidence": "medium",\n  "profile": {\n    "attack_style": "possession",\n    "defensive_line": "high",\n    "pressing_intensity": "high",\n    "squad_depth": "deep"\n  },\n  "notes_en": "Line one\nLine two",\n  "notes_vi": "Dong mot\nDong hai"\n}',
          }],
        },
      }],
    });

    expect(parsed.notesEn).toContain('Line one');
    expect(parsed.notesEn).toContain('Line two');
    expect(parsed.notesVi).toContain('Dong mot');
    expect(parsed.notesVi).toContain('Dong hai');
  });

  test('parses line-based structured output from grounded model', () => {
    const parsed = service.__testables__.parseOverlayResponse({
      candidates: [{
        content: {
          parts: [{
            text: [
              'TEAM_NAME: Arsenal',
              'SEASON: 2025/26',
              'SOURCE_URLS: https://fbref.com/en/squads/arsenal | https://www.premierleague.com/clubs/1/Arsenal/overview',
              'SAMPLE_CONFIDENCE: high',
              'ATTACK_STYLE: possession',
              'DEFENSIVE_LINE: high',
              'PRESSING_INTENSITY: high',
              'SQUAD_DEPTH: deep',
              'NOTES_EN: Possession-heavy shape with aggressive rest defence.',
              'NOTES_VI: Kiem soat bong cao va phong ngu chuyen doi chu dong.',
            ].join('\n'),
          }],
        },
      }],
    });

    expect(parsed.attackStyle).toBe('possession');
    expect(parsed.sourceConfidence).toBe('medium');
    expect(parsed.sourceUrls).toEqual([
      'https://fbref.com/en/squads/arsenal',
      'https://www.premierleague.com/clubs/1/Arsenal/overview',
    ]);
  });

  test('refreshes overlay without mutating quantitative core', async () => {
    mockGenerateGeminiContent.mockResolvedValue({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              team_name: 'Arsenal',
              season: '2025/26',
              data_sources: ['https://fbref.com/en/squads/arsenal'],
              sample_confidence: 'medium',
              profile: {
                attack_style: 'possession',
                defensive_line: 'high',
                pressing_intensity: 'high',
                squad_depth: 'deep',
              },
              notes_en: 'Possession-heavy with aggressive rest defence.',
              notes_vi: 'Kiem soat bong cao va phong ngu chuyen doi tot.',
            }),
          }],
        },
      }],
    });
    mockUpsertTeamProfile.mockResolvedValue(buildCandidate());

    const result = await service.refreshTacticalOverlayForCandidate(buildCandidate());

    expect(result.outcome).toBe('refreshed');
    expect(mockUpsertTeamProfile).toHaveBeenCalledWith('167', expect.objectContaining({
      profile: expect.objectContaining({
        attack_style: 'possession',
        defensive_line: 'high',
        pressing_intensity: 'high',
        squad_depth: 'deep',
        avg_goals_scored: 1.9,
        avg_goals_conceded: 0.8,
      }),
      overlay_metadata: expect.objectContaining({
        source_mode: 'llm_assisted',
        source_confidence: 'low',
        source_urls: ['https://fbref.com/en/squads/arsenal'],
        source_season: '2025/26',
      }),
    }));
  });

  test('returns scheduler-safe skip summary when gemini key is missing', async () => {
    vi.resetModules();
    vi.doMock('../config.js', () => ({
      config: {
        geminiApiKey: '',
        geminiStrategicGroundedModel: 'gemini-2.5-flash',
        geminiTimeoutMs: 90_000,
        geminiStrategicGroundedThinkingBudget: 0,
        tacticalOverlayRefreshMaxPerRun: 2,
        tacticalOverlayRefreshStaleDays: 30,
      },
    }));
    vi.doMock('../lib/gemini.js', () => ({
      generateGeminiContent: mockGenerateGeminiContent,
    }));
    vi.doMock('../lib/audit.js', () => ({
      auditSuccess: mockAuditSuccess,
      auditFailure: mockAuditFailure,
      auditSkipped: mockAuditSkipped,
    }));
    vi.doMock('../repos/team-profiles.repo.js', async () => {
      const actual = await vi.importActual<typeof import('../repos/team-profiles.repo.js')>('../repos/team-profiles.repo.js');
      return {
        ...actual,
        getTopLeagueTacticalOverlayRefreshCandidates: mockGetTopLeagueTacticalOverlayRefreshCandidates,
        upsertTeamProfile: mockUpsertTeamProfile,
      };
    });
    const reloaded = await import('../lib/team-tactical-overlay.service.js');

    const result = await reloaded.refreshTopLeagueTacticalOverlays();

    expect(result.skippedReasons).toEqual({ missing_gemini_api_key: 1 });
    expect(mockGenerateGeminiContent).not.toHaveBeenCalled();
  });
});
