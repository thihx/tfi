import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../db/pool.js';
import {
  backfillOperationalWatchlistFromLegacy,
  createOperationalWatchlistEntry,
  deleteWatchlistEntry,
  expireOldEntries,
  getActiveOperationalWatchlist,
  getAllOperationalWatchlist,
  getExistingWatchlistMatchIds,
  getAllWatchlist,
  incrementChecksForMatches,
  getKickoffMinutesForMatchIds,
  getOperationalWatchlistByMatchId,
  getWatchlistByMatchId,
  syncWatchlistDates,
  updateOperationalWatchlistEntry,
  updateWatchlistEntry,
} from '../repos/watchlist.repo.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('watchlist repository user-scoped isolation', () => {
  test('getAllWatchlist(userId) does not fall back to legacy watchlist rows', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);

    const result = await getAllWatchlist('user-1');

    expect(result).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(query).mock.calls[0]?.[0])).toContain('FROM user_watch_subscriptions s');
    expect(String(vi.mocked(query).mock.calls[0]?.[0])).not.toContain('FROM watchlist w');
  });

  test('getWatchlistByMatchId(userId) returns null when subscription is missing instead of falling back to legacy row', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);

    const result = await getWatchlistByMatchId('match-1', 'user-1');

    expect(result).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(query).mock.calls[0]?.[0])).toContain('WHERE s.user_id = $1 AND s.match_id = $2');
    expect(String(vi.mocked(query).mock.calls[0]?.[0])).not.toContain('SELECT * FROM watchlist WHERE match_id = $1');
  });

  test('updateWatchlistEntry(userId) returns null when subscription is missing instead of mutating legacy row', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const result = await updateWatchlistEntry('match-1', { priority: 3 }, 'user-1');

    expect(result).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
    const sqlTexts = vi.mocked(query).mock.calls.map((call) => String(call[0]));
    expect(sqlTexts.some((sql) => sql.includes('UPDATE watchlist SET'))).toBe(false);
  });

  test('deleteWatchlistEntry(userId) returns false when subscription is missing instead of deleting legacy row', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 0 } as never);

    const result = await deleteWatchlistEntry('match-1', 'user-1');

    expect(result).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(query).mock.calls[0]?.[0])).toContain('DELETE FROM user_watch_subscriptions');
    expect(String(vi.mocked(query).mock.calls[0]?.[0])).not.toContain('DELETE FROM watchlist');
  });

  test('getExistingWatchlistMatchIds checks monitored matches in addition to legacy and subscriptions', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ match_id: 'match-1' }] } as never);

    await getExistingWatchlistMatchIds(['match-1', 'match-2']);

    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(vi.mocked(query).mock.calls[0]?.[0]);
    expect(sql).toContain('FROM monitored_matches');
    expect(sql).toContain('FROM watchlist');
    expect(sql).toContain('FROM user_watch_subscriptions');
  });

  test('createOperationalWatchlistEntry writes monitored match metadata without inserting legacy watchlist rows', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [{
          match_id: 'match-1',
          mode: 'B',
          priority: 0,
          custom_condition_text: '',
          auto_apply_recommended_condition: true,
          status: 'active',
          source: 'top-league-auto',
          created_at: '2026-03-24T00:00:00.000Z',
          subscriber_count: 0,
          metadata: {
            mode: 'B',
            status: 'active',
            added_by: 'top-league-auto',
            home_team: 'Arsenal',
            away_team: 'Chelsea',
            league: 'Premier League',
          },
          match_date: '2026-03-24',
          match_kickoff: '15:00',
          match_league: 'Premier League',
          home_team: 'Arsenal',
          away_team: 'Chelsea',
          home_logo: '',
          away_logo: '',
          match_status: 'NS',
        }],
      } as never);

    await createOperationalWatchlistEntry({
      match_id: 'match-1',
      home_team: 'Arsenal',
      away_team: 'Chelsea',
      league: 'Premier League',
      mode: 'B',
      status: 'active',
      added_by: 'top-league-auto',
    });

    const sqlTexts = vi.mocked(query).mock.calls.map((call) => String(call[0]));
    expect(sqlTexts.some((sql) => sql.includes('INSERT INTO monitored_matches'))).toBe(true);
    expect(sqlTexts.some((sql) => sql.includes('INSERT INTO watchlist'))).toBe(false);
  });

  test('backfillOperationalWatchlistFromLegacy seeds monitored rows for legacy entries regardless of status', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 4 } as never);

    const inserted = await backfillOperationalWatchlistFromLegacy();

    expect(inserted).toBe(4);
    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(vi.mocked(query).mock.calls[0]?.[0]);
    expect(sql).toContain('INSERT INTO monitored_matches');
    expect(sql).toContain('FROM watchlist w');
    expect(sql).toContain('LEFT JOIN monitored_matches mm ON mm.match_id = w.match_id');
    expect(sql).not.toContain("w.status = 'active'");
  });

  test('getAllOperationalWatchlist backfills legacy rows before reading monitored data only', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rowCount: 3 } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const result = await getAllOperationalWatchlist();

    expect(result).toEqual([]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(query).mock.calls[0]?.[0])).toContain('INSERT INTO monitored_matches');
    expect(String(vi.mocked(query).mock.calls[1]?.[0])).toContain('FROM monitored_matches mm');
    expect(String(vi.mocked(query).mock.calls[1]?.[0])).not.toContain('FROM watchlist w');
  });

  test('getActiveOperationalWatchlist backfills active legacy rows before reading monitored data only', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rowCount: 2 } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const result = await getActiveOperationalWatchlist();

    expect(result).toEqual([]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(query).mock.calls[0]?.[0])).toContain('INSERT INTO monitored_matches');
    expect(String(vi.mocked(query).mock.calls[1]?.[0])).toContain('FROM monitored_matches mm');
  });

  test('getActiveOperationalWatchlist ranks only active subscriptions for each match', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rowCount: 0 } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await getActiveOperationalWatchlist();

    const sql = String(vi.mocked(query).mock.calls[1]?.[0]);
    expect(sql).toContain("WHERE ($1::boolean = false OR s.status = 'active')");
  });

  test('getOperationalWatchlistByMatchId mirrors legacy rows into monitored matches before returning', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [{
          id: 12,
          match_id: 'match-9',
          date: '2026-03-24',
          league: 'Premier League',
          home_team: 'Arsenal',
          away_team: 'Chelsea',
          home_logo: '',
          away_logo: '',
          kickoff: '15:00',
          mode: 'B',
          prediction: null,
          recommended_custom_condition: '',
          recommended_condition_reason: '',
          recommended_condition_reason_vi: '',
          recommended_condition_at: null,
          auto_apply_recommended_condition: true,
          custom_conditions: '',
          priority: 0,
          status: 'active',
          added_at: '2026-03-24T00:00:00.000Z',
          added_by: 'top-league-auto',
          last_checked: null,
          total_checks: 0,
          recommendations_count: 0,
          strategic_context: null,
          strategic_context_at: null,
        }],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [{
          match_id: 'match-9',
          mode: 'B',
          priority: 0,
          custom_condition_text: '',
          auto_apply_recommended_condition: true,
          status: 'active',
          source: 'top-league-auto',
          created_at: '2026-03-24T00:00:00.000Z',
          subscriber_count: 0,
          metadata: {
            home_team: 'Arsenal',
            away_team: 'Chelsea',
            league: 'Premier League',
            added_by: 'top-league-auto',
            status: 'active',
          },
          match_date: '2026-03-24',
          match_kickoff: '15:00',
          match_league: 'Premier League',
          home_team: 'Arsenal',
          away_team: 'Chelsea',
          home_logo: '',
          away_logo: '',
          match_status: 'NS',
        }],
      } as never);

    const result = await getOperationalWatchlistByMatchId('match-9');

    expect(result?.match_id).toBe('match-9');
    const sqlTexts = vi.mocked(query).mock.calls.map((call) => String(call[0]));
    expect(sqlTexts.some((sql) => sql.includes('SELECT * FROM watchlist WHERE match_id = $1'))).toBe(true);
    expect(sqlTexts.some((sql) => sql.includes('INSERT INTO monitored_matches'))).toBe(true);
  });

  test('getOperationalWatchlistByMatchId mirrors expired legacy rows into monitored matches before returning', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [{
          id: 15,
          match_id: 'match-10',
          date: '2026-03-24',
          league: 'La Liga',
          home_team: 'Barcelona',
          away_team: 'Sevilla',
          home_logo: '',
          away_logo: '',
          kickoff: '20:00',
          mode: 'B',
          prediction: null,
          recommended_custom_condition: '',
          recommended_condition_reason: '',
          recommended_condition_reason_vi: '',
          recommended_condition_at: null,
          auto_apply_recommended_condition: true,
          custom_conditions: '',
          priority: 0,
          status: 'expired',
          added_at: '2026-03-24T00:00:00.000Z',
          added_by: 'top-league-auto',
          last_checked: null,
          total_checks: 0,
          recommendations_count: 0,
          strategic_context: null,
          strategic_context_at: null,
        }],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [{
          match_id: 'match-10',
          mode: 'B',
          priority: 0,
          custom_condition_text: '',
          auto_apply_recommended_condition: true,
          status: 'expired',
          source: 'top-league-auto',
          created_at: '2026-03-24T00:00:00.000Z',
          subscriber_count: 0,
          metadata: {
            home_team: 'Barcelona',
            away_team: 'Sevilla',
            league: 'La Liga',
            added_by: 'top-league-auto',
            status: 'expired',
          },
          match_date: '2026-03-24',
          match_kickoff: '20:00',
          match_league: 'La Liga',
          home_team: 'Barcelona',
          away_team: 'Sevilla',
          home_logo: '',
          away_logo: '',
          match_status: 'FT',
        }],
      } as never);

    const result = await getOperationalWatchlistByMatchId('match-10');

    expect(result?.match_id).toBe('match-10');
    expect(result?.status).toBe('expired');
    const sqlTexts = vi.mocked(query).mock.calls.map((call) => String(call[0]));
    expect(sqlTexts.some((sql) => sql.includes('SELECT * FROM watchlist WHERE match_id = $1'))).toBe(true);
    expect(sqlTexts.some((sql) => sql.includes('INSERT INTO monitored_matches'))).toBe(true);
  });

  test('getKickoffMinutesForMatchIds uses monitored metadata fallback instead of legacy watchlist rows', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ match_id: 'match-9', mins_to_kickoff: '42' }],
    } as never);

    const result = await getKickoffMinutesForMatchIds(['match-9']);

    expect(result.get('match-9')).toBe(42);
    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(vi.mocked(query).mock.calls[0]?.[0]);
    expect(sql).toContain('LEFT JOIN monitored_matches mm ON mm.match_id = ids.match_id');
    expect(sql).not.toContain('LEFT JOIN watchlist');
  });

  test('incrementChecksForMatches updates monitored metadata without mutating legacy watchlist rows', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 2 } as never);

    await incrementChecksForMatches(['match-1', 'match-2']);

    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(vi.mocked(query).mock.calls[0]?.[0]);
    expect(sql).toContain('UPDATE monitored_matches');
    expect(sql).not.toContain('UPDATE watchlist');
  });

  test('updateOperationalWatchlistEntry updates monitored metadata and returns monitored view without mutating legacy rows', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rowCount: 1 } as never)
      .mockResolvedValueOnce({
        rows: [{
          match_id: 'match-1',
          mode: 'B',
          priority: 3,
          custom_condition_text: '',
          auto_apply_recommended_condition: true,
          status: 'active',
          source: 'manual',
          created_at: '2026-03-24T00:00:00.000Z',
          subscriber_count: 0,
          metadata: {
            priority: 3,
            status: 'active',
            added_by: 'manual',
          },
          match_date: '2026-03-24',
          match_kickoff: '15:00',
          match_league: 'Premier League',
          home_team: 'Arsenal',
          away_team: 'Chelsea',
          home_logo: '',
          away_logo: '',
          match_status: 'NS',
        }],
      } as never);

    const result = await updateOperationalWatchlistEntry('match-1', { priority: 3 });

    expect(result?.priority).toBe(3);
    const sqlTexts = vi.mocked(query).mock.calls.map((call) => String(call[0]));
    expect(sqlTexts.some((sql) => sql.includes('INSERT INTO monitored_matches'))).toBe(true);
    expect(sqlTexts.some((sql) => sql.includes('UPDATE watchlist SET'))).toBe(false);
  });

  test('syncWatchlistDates updates monitored metadata rather than legacy watchlist rows', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 3 } as never);

    const synced = await syncWatchlistDates();

    expect(synced).toBe(3);
    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(vi.mocked(query).mock.calls[0]?.[0]);
    expect(sql).toContain('UPDATE monitored_matches mm');
    expect(sql).not.toContain('UPDATE watchlist w');
  });

  test('expireOldEntries deletes completed subscriptions and prunes monitored matches without mutating legacy rows', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rowCount: 0 } as never)
      .mockResolvedValueOnce({ rows: [{ match_id: 'match-1' }, { match_id: 'match-2' }, { match_id: 'match-2' }] } as never)
      .mockResolvedValueOnce({ rowCount: 1 } as never)
      .mockResolvedValueOnce({ rowCount: 1 } as never)
      .mockResolvedValueOnce({ rowCount: 2 } as never);

    const expired = await expireOldEntries(120);

    expect(expired).toBe(2);
    const sqlTexts = vi.mocked(query).mock.calls.map((call) => String(call[0]));
    expect(sqlTexts.some((sql) => sql.includes('UPDATE watchlist SET status'))).toBe(false);
    expect(sqlTexts.filter((sql) => sql.includes('DELETE FROM user_watch_subscriptions')).length).toBe(1);
    expect(sqlTexts.filter((sql) => sql.includes('DELETE FROM monitored_matches')).length).toBe(1);
    expect(sqlTexts.filter((sql) => sql.includes('INSERT INTO monitored_matches')).length).toBe(3);
  });
});
