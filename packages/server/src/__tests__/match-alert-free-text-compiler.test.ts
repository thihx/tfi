import { describe, expect, it } from 'vitest';
import { buildMatchAlertContext } from '../lib/match-alert-context.js';
import { compileMatchAlertFreeTextRule, validateCompiledRuleJson } from '../lib/match-alert-free-text-compiler.js';
import { evaluateMatchAlertRule } from '../lib/match-alert-rule-engine.js';
import type { MatchRow } from '../repos/matches.repo.js';
import type { MatchSnapshotRow } from '../repos/match-snapshots.repo.js';

function match(overrides: Partial<MatchRow> = {}): MatchRow {
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
    status: '2H',
    home_score: 0,
    away_score: 0,
    current_minute: 72,
    last_updated: '2026-06-05T12:12:00.000Z',
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
    captured_at: '2026-06-05T12:12:00.000Z',
    source: 'test',
    minute: 72,
    status: '2H',
    home_score: 0,
    away_score: 0,
    stats: {},
    events: [],
    odds: {},
    ...overrides,
  };
}

describe('match alert free text compiler', () => {
  it('compiles Vietnamese no-accent no-goal text into a scoreless late rule', async () => {
    const compiled = await compileMatchAlertFreeTextRule('Neu 2 doi ko co ban thang sau phut 70');
    expect(compiled.status).toBe('compiled');
    expect(compiled.source).toBe('deterministic');
    expect(compiled.ruleJson).toEqual(expect.objectContaining({
      id: 'free_text_no_goals_after_minute',
      all: expect.arrayContaining([
        { field: 'minute', op: '>=', value: 70 },
        { field: 'score.total', op: '=', value: 0 },
      ]),
    }));

    const context = buildMatchAlertContext(match(), snapshot());
    const evaluation = evaluateMatchAlertRule('condition_signal', compiled.ruleJson, context);
    expect(evaluation.supported).toBe(true);
    expect(evaluation.matched).toBe(true);
  });

  it('keeps supporting existing DSL recommendation conditions', async () => {
    const compiled = await compileMatchAlertFreeTextRule('(Minute >= 60) AND (NOT Home leading)');
    expect(compiled.status).toBe('compiled');
    expect(compiled.ruleJson).toEqual(expect.objectContaining({
      all: [
        { field: 'minute', op: '>=', value: 60 },
        { field: 'score.state', op: '!=', value: 'home_leading' },
      ],
    }));
  });

  it('compiles compact red-card shorthand', async () => {
    const compiled = await compileMatchAlertFreeTextRule('rc');
    expect(compiled.status).toBe('compiled');
    expect(compiled.ruleJson).toEqual(expect.objectContaining({
      all: [{ field: 'events.red_card.side', op: 'exists' }],
    }));
  });

  it('validates LLM compiled rules against allowed fields and operators', () => {
    expect(validateCompiledRuleJson({
      supported: true,
      id: 'bad',
      all: [{ field: 'odds.live.home', op: '>=', value: 1.9 }],
    })).toBeNull();

    expect(validateCompiledRuleJson({
      supported: true,
      id: 'good',
      label: 'Good',
      all: [{ field: 'minute', op: '>=', value: 70 }],
    })).toEqual(expect.objectContaining({ id: 'good' }));
  });
});
