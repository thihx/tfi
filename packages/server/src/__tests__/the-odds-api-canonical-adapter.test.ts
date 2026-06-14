import { describe, expect, it } from 'vitest';
import {
  buildTheOddsApiErrorEnvelope,
  buildTheOddsApiOddsEnvelope,
  buildTheOddsApiOddsSnapshot,
  theOddsApiEventToSelections,
} from '../lib/canonical/the-odds-api-adapter.js';
import {
  validateCanonicalOddsSnapshot,
  validateProviderEnvelope,
} from '../lib/canonical/provider-domain.js';

const liveEvent = {
  id: 'evt_123',
  sport_key: 'soccer_fifa_world_cup',
  sport_title: 'FIFA World Cup',
  commence_time: '2026-06-14T12:00:00Z',
  home_team: 'Mexico',
  away_team: 'South Africa',
  bookmakers: [{
    key: 'bet365',
    title: 'Bet365',
    last_update: '2026-06-14T12:20:00Z',
    markets: [
      {
        key: 'h2h',
        last_update: '2026-06-14T12:20:05Z',
        outcomes: [
          { name: 'Mexico', price: 2.2 },
          { name: 'Draw', price: 3.1 },
          { name: 'South Africa', price: 3.5 },
        ],
      },
      {
        key: 'totals',
        outcomes: [
          { name: 'Over', price: 1.92, point: 2.5 },
          { name: 'Under', price: 1.94, point: 2.5 },
        ],
      },
      {
        key: 'spreads',
        outcomes: [
          { name: 'Mexico', price: 1.88, point: -0.5 },
          { name: 'South Africa', price: 2.02, point: 0.5 },
        ],
      },
    ],
  }],
};

describe('The Odds API canonical adapter', () => {
  it('maps The Odds API event odds into canonical live selections', () => {
    const selections = theOddsApiEventToSelections({
      event: liveEvent,
      fetchedAt: '2026-06-14T12:20:10.000Z',
      now: new Date('2026-06-14T12:25:00.000Z'),
    });

    expect(selections).toEqual([
      expect.objectContaining({
        market: 'Match Winner',
        selection: 'Home',
        line: null,
        price: 2.2,
        bookmaker: 'Bet365',
        provider: 'the-odds-api',
        kind: 'live',
        fetchedAt: '2026-06-14T12:20:05Z',
        suspended: false,
      }),
      expect.objectContaining({ market: 'Match Winner', selection: 'Draw', price: 3.1 }),
      expect.objectContaining({ market: 'Match Winner', selection: 'Away', price: 3.5 }),
      expect.objectContaining({ market: 'Over/Under', selection: 'Over 2.5', line: 2.5, price: 1.92 }),
      expect.objectContaining({ market: 'Over/Under', selection: 'Under 2.5', line: 2.5, price: 1.94 }),
      expect.objectContaining({ market: 'Asian Handicap', selection: 'Home -0.5', line: -0.5, price: 1.88 }),
      expect.objectContaining({ market: 'Asian Handicap', selection: 'Away +0.5', line: 0.5, price: 2.02 }),
    ]);

    const envelope = buildTheOddsApiOddsEnvelope({
      matchId: '164327',
      event: liveEvent,
      fetchedAt: '2026-06-14T12:20:10.000Z',
      now: new Date('2026-06-14T12:25:00.000Z'),
      quota: 'ok',
    });

    expect(envelope).toMatchObject({
      provider: 'the-odds-api',
      role: 'live_odds',
      providerFixtureId: 'evt_123',
      matchId: '164327',
      coverage: { level: 'complete', itemCount: 7 },
      freshness: 'fresh',
      quota: 'ok',
      normalized: {
        sourceProvider: 'the-odds-api',
        sourceKind: 'live',
      },
    });
    expect(validateCanonicalOddsSnapshot(envelope.normalized)).toMatchObject({ ok: true });
    expect(validateProviderEnvelope(envelope)).toMatchObject({ ok: true });
  });

  it('marks future odds as prematch reference-only and skips malformed rows', () => {
    const snapshot = buildTheOddsApiOddsSnapshot({
      matchId: '164327',
      event: {
        ...liveEvent,
        commence_time: '2026-06-20T12:00:00Z',
        bookmakers: [
          null,
          {
            key: 'draftkings',
            markets: [
              { key: '', outcomes: [{ name: 'Home', price: 2 }] },
              { key: 'totals', outcomes: [
                { name: 'Over', price: 1 },
                { name: '', price: 2 },
                { name: 'Under', price: '2.05', point: '3.5' },
              ] },
            ],
          },
        ],
      },
      fetchedAt: '2026-06-14T12:00:00.000Z',
      now: new Date('2026-06-14T12:00:00.000Z'),
    });

    expect(snapshot).toMatchObject({
      sourceProvider: 'the-odds-api',
      sourceKind: 'prematch',
      warnings: ['prematch_reference_only'],
    });
    expect(snapshot.selections).toEqual([
      expect.objectContaining({
        market: 'Over/Under',
        selection: 'Under 3.5',
        kind: 'prematch',
        price: 2.05,
        bookmaker: 'draftkings',
      }),
    ]);
    expect(validateCanonicalOddsSnapshot(snapshot)).toMatchObject({ ok: true });
  });

  it('covers provider-specific market fallbacks and forced kind handling', () => {
    const selections = theOddsApiEventToSelections({
      event: {
        id: 'evt_special',
        commence_time: 'bad-date',
        home_team: 'Home FC',
        away_team: 'Away FC',
        bookmakers: [{
          key: 'book-without-title',
          last_update: '2026-06-14T12:10:00Z',
          markets: [
            {
              key: 'btts',
              outcomes: [
                { name: 'Yes', price: 1.8 },
                { name: 'No', price: 2.0 },
              ],
            },
            {
              key: 'team_totals',
              outcomes: [
                { name: 'Home FC Over 1.5', price: 1.9 },
              ],
            },
            {
              key: 'spreads',
              outcomes: [
                { name: 'Unknown Side', price: 2.1 },
              ],
            },
            {
              key: 'totals',
              outcomes: [
                { name: 'Exact 3', price: 6.5 },
              ],
            },
          ],
        }],
      },
      fetchedAt: '2026-06-14T12:20:00.000Z',
      forceKind: 'reference',
    });

    expect(selections).toEqual([
      expect.objectContaining({
        market: 'Both Teams To Score',
        selection: 'Yes',
        bookmaker: 'book-without-title',
        kind: 'reference',
        fetchedAt: '2026-06-14T12:10:00Z',
      }),
      expect.objectContaining({ market: 'Both Teams To Score', selection: 'No' }),
      expect.objectContaining({ market: 'team_totals', selection: 'Home FC Over 1.5' }),
      expect.objectContaining({ market: 'Asian Handicap', selection: 'Unknown Side' }),
      expect.objectContaining({ market: 'Over/Under', selection: 'Exact 3' }),
    ]);
    expect(theOddsApiEventToSelections({
      event: 'not-an-object',
      fetchedAt: '2026-06-14T12:20:00.000Z',
    })).toEqual([]);
  });

  it('returns empty coverage for valid empty odds and error envelopes for failures', () => {
    const empty = buildTheOddsApiOddsEnvelope({
      matchId: '164327',
      event: { id: 'evt_empty', commence_time: 'bad-date', bookmakers: [] },
      fetchedAt: '2026-06-14T12:20:10.000Z',
    });
    expect(empty).toMatchObject({
      success: true,
      role: 'reference_odds',
      coverage: { level: 'empty', itemCount: 0 },
      freshness: 'stale',
      normalized: {
        sourceProvider: null,
        sourceKind: 'unknown',
        selections: [],
      },
    });

    const failed = buildTheOddsApiErrorEnvelope({
      matchId: '164327',
      providerFixtureId: 'evt_123',
      fetchedAt: '2026-06-14T12:20:10.000Z',
      error: new Error('quota exceeded'),
      statusCode: 429,
      quota: 'daily_limit',
      warnings: ['the_odds_api_shadow_fetch_failed'],
    });
    expect(failed).toMatchObject({
      success: false,
      provider: 'the-odds-api',
      role: 'live_odds',
      error: 'quota exceeded',
      coverage: { level: 'missing' },
      freshness: 'missing',
      quota: 'daily_limit',
    });
    expect(validateProviderEnvelope(failed)).toMatchObject({ ok: true });

    const stringFailed = buildTheOddsApiErrorEnvelope({
      fetchedAt: '2026-06-14T12:20:10.000Z',
      error: 'plain failure',
    });
    expect(stringFailed).toMatchObject({
      matchId: null,
      providerFixtureId: null,
      statusCode: null,
      quota: 'unknown',
      error: 'plain failure',
      warnings: [],
    });
  });

  it('handles non-object envelope input and invalid event fallback source kind', () => {
    const snapshot = buildTheOddsApiOddsSnapshot({
      matchId: '164327',
      event: 'bad-event',
      fetchedAt: '2026-06-14T12:20:10.000Z',
      generatedAt: '2026-06-14T12:21:00.000Z',
      warnings: [null, 'empty odds'],
    });
    expect(snapshot).toMatchObject({
      generatedAt: '2026-06-14T12:21:00.000Z',
      sourceProvider: null,
      sourceKind: 'unknown',
      warnings: ['empty odds'],
      selections: [],
    });

    const envelope = buildTheOddsApiOddsEnvelope({
      matchId: '164327',
      event: 'bad-event',
      fetchedAt: '2026-06-14T12:20:10.000Z',
      statusCode: null,
      latencyMs: 12,
      raw: { redacted: true },
      forceKind: 'live',
    });
    expect(envelope).toMatchObject({
      role: 'live_odds',
      providerFixtureId: null,
      statusCode: 200,
      latencyMs: 12,
      raw: { redacted: true },
      normalized: {
        sourceProvider: null,
        sourceKind: 'live',
      },
    });
  });
});
