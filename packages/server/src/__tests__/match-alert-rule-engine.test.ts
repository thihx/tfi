import { describe, expect, it } from 'vitest';
import { buildMatchAlertContext } from '../lib/match-alert-context.js';
import { evaluateMatchAlertRule, type MatchAlertContext } from '../lib/match-alert-rule-engine.js';
import { SYSTEM_CONDITION_ALERT_PRESETS } from '../lib/match-alert-presets.js';
import type { MatchRow } from '../repos/matches.repo.js';
import type { MatchSnapshotRow } from '../repos/match-snapshots.repo.js';

function baseMatch(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    match_id: '1001',
    date: '2026-06-05',
    kickoff: '20:00',
    kickoff_at_utc: '2026-06-05T11:00:00.000Z',
    league_id: 39,
    league_name: 'Premier League',
    home_team: 'Home FC',
    away_team: 'Away FC',
    home_logo: '',
    away_logo: '',
    venue: 'TBD',
    status: '1H',
    home_score: 0,
    away_score: 1,
    current_minute: 18,
    last_updated: '2026-06-05T11:18:00.000Z',
    home_team_id: 1,
    away_team_id: 2,
    home_reds: 0,
    away_reds: 0,
    home_yellows: 0,
    away_yellows: 0,
    ...overrides,
  };
}

function snapshot(overrides: Partial<MatchSnapshotRow> = {}): MatchSnapshotRow {
  return {
    id: 1,
    match_id: '1001',
    captured_at: '2026-06-05T11:18:00.000Z',
    source: 'test',
    minute: 18,
    status: '1H',
    home_score: 0,
    away_score: 1,
    stats: {
      shots_on_target: { home: '1', away: '3' },
      corners: { home: '2', away: '3' },
      red_cards: { home: '0', away: '0' },
      yellow_cards: { home: '0', away: '1' },
    },
    events: [
      { minute: 18, team: 'Away FC', type: 'goal', detail: 'Normal Goal', player: 'A' },
    ],
    odds: {},
    ...overrides,
  };
}

function presetRule(id: string) {
  const preset = SYSTEM_CONDITION_ALERT_PRESETS.find((row) => row.id === id);
  expect(preset).toBeTruthy();
  return preset!.ruleJson;
}

describe('match alert rule engine', () => {
  it('matches away scores first preset', () => {
    const context = buildMatchAlertContext(baseMatch(), snapshot());
    const result = evaluateMatchAlertRule('condition_signal', presetRule('away_scores_first'), context);
    expect(result.supported).toBe(true);
    expect(result.matched).toBe(true);
    expect(result.triggerKey).toBe('away_scores_first:1001:away:18');
  });

  it('matches red cards and includes side/minute in trigger key', () => {
    const context = buildMatchAlertContext(
      baseMatch({ home_score: 1, away_score: 0, current_minute: 54 }),
      snapshot({
        minute: 54,
        home_score: 1,
        away_score: 0,
        events: [
          { minute: 20, team: 'Home FC', type: 'goal', detail: 'Normal Goal', player: 'H' },
          { minute: 54, team: 'Home FC', type: 'card', detail: 'Red Card', player: 'H2' },
        ],
      }),
    );
    const result = evaluateMatchAlertRule('condition_signal', presetRule('red_card'), context);
    expect(result.supported).toBe(true);
    expect(result.matched).toBe(true);
    expect(result.triggerKey).toBe('red_card:1001:home:54');
  });

  it('supports any branches for leading team red card', () => {
    const context = buildMatchAlertContext(
      baseMatch({ home_score: 0, away_score: 1, current_minute: 62 }),
      snapshot({
        minute: 62,
        home_score: 0,
        away_score: 1,
        events: [
          { minute: 18, team: 'Away FC', type: 'goal', detail: 'Normal Goal', player: 'A' },
          { minute: 62, team: 'Away FC', type: 'card', detail: 'Red Card', player: 'A2' },
        ],
      }),
    );
    const result = evaluateMatchAlertRule('condition_signal', presetRule('leading_team_red_card'), context);
    expect(result.supported).toBe(true);
    expect(result.matched).toBe(true);
    expect(result.triggerKey).toBe('leading_team_red_card:1001:away:62');
  });

  it('matches 0-0 pressure after minute 55 with corner pressure', () => {
    const context = buildMatchAlertContext(
      baseMatch({ home_score: 0, away_score: 0, current_minute: 58 }),
      snapshot({
        minute: 58,
        home_score: 0,
        away_score: 0,
        stats: {
          shots_on_target: { home: '2', away: '2' },
          corners: { home: '5', away: '4' },
        },
        events: [],
      }),
    );
    const result = evaluateMatchAlertRule('condition_signal', presetRule('zero_zero_pressure_after_55'), context);
    expect(result.supported).toBe(true);
    expect(result.matched).toBe(true);
  });

  it('reports unsupported clauses without matching', () => {
    const context: MatchAlertContext = buildMatchAlertContext(baseMatch(), snapshot());
    const result = evaluateMatchAlertRule('condition_signal', {
      version: 1,
      id: 'unsupported',
      all: [{ field: 'odds.ou.over', op: '~=', value: 1.9 }],
    }, context);
    expect(result.supported).toBe(false);
    expect(result.matched).toBe(false);
  });
});
