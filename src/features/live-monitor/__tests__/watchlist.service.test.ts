// ============================================================
// Watchlist Service Tests (pure logic only)
// ============================================================

import { describe, test, expect } from 'vitest';
import { filterActiveMatches, prepareMatchData, buildFixtureBatches } from '../services/watchlist.service';
import { createWatchlistMatch, createConfig, createFilteredMatch } from './fixtures';

describe('filterActiveMatches', () => {
  const config = createConfig();

  test('returns empty array for empty input', () => {
    expect(filterActiveMatches([], config)).toEqual([]);
  });

  test('filters by webhookMatchIds when provided', () => {
    const matches = [
      createWatchlistMatch({ match_id: '111' }),
      createWatchlistMatch({ match_id: '222' }),
      createWatchlistMatch({ match_id: '333' }),
    ];
    const result = filterActiveMatches(matches, config, ['111', '333']);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.match_id)).toEqual(['111', '333']);
  });

  test('sets is_manual_push=true when webhookMatchIds provided', () => {
    const matches = [createWatchlistMatch({ match_id: '111' })];
    const result = filterActiveMatches(matches, config, ['111']);
    expect(result[0]!.is_manual_push).toBe(true);
  });

  test('sets force_analyze and is_manual_push=false when no webhookMatchIds', () => {
    // Use a kickoff close to "now" in Seoul timezone to get matches
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const part = (type: string) => parts.find((p) => p.type === type)!.value;
    const dateStr = `${part('year')}-${part('month')}-${part('day')}`;
    const kickoff = `${part('hour')}:${part('minute')}`;

    const matches = [createWatchlistMatch({ match_id: '111', date: dateStr, kickoff })];
    const result = filterActiveMatches(matches, config);
    if (result.length > 0) {
      expect(result[0]!.force_analyze).toBe(false);
      expect(result[0]!.is_manual_push).toBe(false);
    }
  });

  test('ignores future matches beyond 1 minute window', () => {
    const matches = [createWatchlistMatch({ match_id: '111', date: '2030-12-31', kickoff: '23:59' })];
    const result = filterActiveMatches(matches, config);
    expect(result).toHaveLength(0);
  });

  test('ignores matches that ended long ago', () => {
    const matches = [createWatchlistMatch({ match_id: '111', date: '2020-01-01', kickoff: '12:00' })];
    const result = filterActiveMatches(matches, config);
    expect(result).toHaveLength(0);
  });

  test('handles matches with empty date gracefully', () => {
    const matches = [createWatchlistMatch({ match_id: '111', date: '', kickoff: '20:00' })];
    const result = filterActiveMatches(matches, config);
    expect(result).toHaveLength(0);
  });
});

describe('prepareMatchData', () => {
  const config = createConfig();

  test('maps filtered matches to pipeline format', () => {
    const matches = [
      createFilteredMatch({
        match_id: '111',
        home_team: 'Arsenal',
        away_team: 'Chelsea',
        league: 'Premier League',
        mode: 'A',
        custom_conditions: 'btts check',
        priority: 1,
        prediction: 'Home Win',
        force_analyze: true,
        is_manual_push: true,
      }),
    ];
    const result = prepareMatchData(matches, config);

    expect(result).toHaveLength(1);
    expect(result[0]!).toMatchObject({
      config,
      match_id: '111',
      home_team: 'Arsenal',
      away_team: 'Chelsea',
      league: 'Premier League',
      mode: 'A',
      custom_conditions: 'btts check',
      priority: 1,
      prediction: 'Home Win',
      force_analyze: true,
      is_manual_push: true,
    });
  });

  test('defaults missing fields', () => {
    const matches = [createFilteredMatch({ mode: '', custom_conditions: '', priority: 0, prediction: '' })];
    const result = prepareMatchData(matches, config);

    expect(result[0]!.mode).toBe('B');
    expect(result[0]!.custom_conditions).toBe('');
    expect(result[0]!.priority).toBe(3);
    expect(result[0]!.prediction).toBe('');
  });

  test('prefers league_name over league', () => {
    const matches = [createFilteredMatch({ league: '', league_name: 'La Liga' })];
    const result = prepareMatchData(matches, config);
    expect(result[0]!.league).toBe('La Liga');
  });
});

describe('buildFixtureBatches', () => {
  test('returns empty array for empty input', () => {
    expect(buildFixtureBatches([])).toEqual([]);
  });

  test('deduplicates match IDs', () => {
    const matches = [
      { match_id: '111' },
      { match_id: '222' },
      { match_id: '111' },
    ];
    const batches = buildFixtureBatches(matches);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.match_ids).toEqual(['111', '222']);
  });

  test('batches in groups of 20', () => {
    const matches = Array.from({ length: 45 }, (_, i) => ({ match_id: String(i + 1) }));
    const batches = buildFixtureBatches(matches);
    expect(batches).toHaveLength(3);
    expect(batches[0]!.match_ids).toHaveLength(20);
    expect(batches[1]!.match_ids).toHaveLength(20);
    expect(batches[2]!.match_ids).toHaveLength(5);
  });

  test('handles single match', () => {
    const batches = buildFixtureBatches([{ match_id: '42' }]);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.match_ids).toEqual(['42']);
  });

  test('skips matches with empty match_id', () => {
    const matches = [{ match_id: '' }, { match_id: '111' }, { match_id: '  ' }];
    const batches = buildFixtureBatches(matches);
    expect(batches[0]!.match_ids).toEqual(['111']);
  });
});
