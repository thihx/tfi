import { describe, expect, test } from 'vitest';
import {
  auditOddsCoverageSample,
  buildProviderOddsCoverageFlags,
  summarizeOddsCoverageAudit,
} from '../provider-coverage-audit.js';

describe('provider coverage audit', () => {
  test('passes when stored and recomputed flags cover canonical markets', () => {
    const result = auditOddsCoverageSample({
      id: 1,
      matchId: '100',
      coverageFlags: {
        has_ou: true,
        has_ah: true,
        has_btts: true,
      },
      normalizedPayload: [{
        bookmakers: [{
          name: 'Live Odds',
          bets: [
            {
              name: 'Goals Over/Under',
              values: [
                { value: 'Over', odd: '1.90', handicap: '2.5' },
                { value: 'Under', odd: '1.95', handicap: '2.5' },
              ],
            },
            {
              name: 'Asian Handicap',
              values: [
                { value: 'Home', odd: '1.90', handicap: '-0.25' },
                { value: 'Away', odd: '1.95', handicap: '+0.25' },
              ],
            },
            {
              name: 'Both Teams To Score',
              values: [
                { value: 'Yes', odd: '1.80' },
                { value: 'No', odd: '2.00' },
              ],
            },
          ],
        }],
      }],
    });

    expect(result.ok).toBe(true);
    expect(result.canonicalKeys).toEqual(expect.arrayContaining(['ou', 'ah', 'btts']));
    expect(result.rawFlags).toEqual(expect.objectContaining({
      has_ou: true,
      has_ah: true,
      has_btts: true,
    }));
    expect(result.canonicalFlags).toEqual(expect.objectContaining({
      has_ou: true,
      has_ah: true,
      has_btts: true,
    }));
    expect(result.missingStoredFlags).toEqual([]);
    expect(result.missingRecomputedFlags).toEqual([]);
  });

  test('reports stored flag mismatches when canonical market exists', () => {
    const result = auditOddsCoverageSample({
      id: 2,
      matchId: '101',
      coverageFlags: {
        has_ou: false,
      },
      normalizedPayload: [{
        bookmakers: [{
          name: 'Live Odds',
          bets: [{
            name: 'Goals Over/Under',
            values: [
              { value: 'Over', odd: '1.90', handicap: '2.5' },
              { value: 'Under', odd: '1.95', handicap: '2.5' },
            ],
          }],
        }],
      }],
    });

    expect(result.ok).toBe(false);
    expect(result.missingStoredFlags).toEqual(['has_ou']);
    expect(result.missingRecomputedFlags).toEqual([]);
  });

  test('does not fail when raw flags exist but canonical rejects a market', () => {
    const result = auditOddsCoverageSample({
      id: 3,
      matchId: '102',
      coverageFlags: {
        has_ou: true,
      },
      normalizedPayload: [{
        bookmakers: [{
          name: 'Live Odds',
          bets: [{
            name: 'Goals Over/Under',
            values: [
              { value: 'Over', odd: '9.00', handicap: '2.5' },
              { value: 'Under', odd: '9.00', handicap: '2.5' },
            ],
          }],
        }],
      }],
    });

    expect(result.ok).toBe(true);
    expect(result.canonicalKeys).not.toContain('ou');
    expect(result.rawWithoutCanonicalFlags).toEqual(['has_ou']);
    expect(result.flaggedWithoutCanonical).toEqual(['has_ou']);
    expect(result.canonicalRejectReasons).toEqual([{
      flag: 'has_ou',
      reason: 'raw_goals_ou_present_but_not_canonical_tradable:invalid_margin',
    }]);
  });

  test('builds explicit raw and canonical coverage flags for backfills', () => {
    const flags = buildProviderOddsCoverageFlags([{
      bookmakers: [{
        name: 'Live Odds',
        bets: [{
          name: 'Goals Over/Under',
          values: [
            { value: 'Over', odd: '1.90', handicap: '2.5' },
            { value: 'Under', odd: '1.95', handicap: '2.5' },
          ],
        }],
      }],
    }]);

    expect(flags).toEqual(expect.objectContaining({
      has_ou: true,
      raw_has_ou: true,
      canonical_has_ou: true,
      raw_has_1x2: false,
      canonical_has_1x2: false,
    }));
  });

  test('counts adjacent and extra canonical ladder lines as O/U and AH coverage', () => {
    const flags = buildProviderOddsCoverageFlags([{
      bookmakers: [{
        name: 'Live Odds',
        bets: [
          {
            name: 'Goals Over/Under',
            values: [
              { value: 'Over', odd: '9.00', handicap: '2.5' },
              { value: 'Under', odd: '9.00', handicap: '2.5' },
              { value: 'Over', odd: '1.90', handicap: '3.5' },
              { value: 'Under', odd: '1.95', handicap: '3.5' },
            ],
          },
          {
            name: 'Asian Handicap',
            values: [
              { value: 'Home', odd: '1.88', handicap: '-0.25' },
              { value: 'Away', odd: '1.95', handicap: '+0.25' },
              { value: 'Home', odd: '1.90', handicap: '-0.75' },
              { value: 'Away', odd: '1.95', handicap: '+0.75' },
            ],
          },
        ],
      }],
    }]);

    expect(flags).toEqual(expect.objectContaining({
      raw_has_ou: true,
      raw_has_ah: true,
      canonical_has_ou: true,
      canonical_has_ah: true,
    }));
  });

  test('summarizes mismatches and examples', () => {
    const results = [
      auditOddsCoverageSample({
        id: 1,
        normalizedPayload: [{
          bookmakers: [{
            bets: [{
              name: 'Goals Over/Under',
              values: [
                { value: 'Over', odd: '1.90', handicap: '2.5' },
                { value: 'Under', odd: '1.95', handicap: '2.5' },
              ],
            }],
          }],
        }],
        coverageFlags: { has_ou: true },
      }),
      auditOddsCoverageSample({
        id: 2,
        normalizedPayload: [{
          bookmakers: [{
            bets: [{
              name: 'Asian Handicap',
              values: [
                { value: 'Home', odd: '1.90', handicap: '-0.25' },
                { value: 'Away', odd: '1.95', handicap: '+0.25' },
              ],
            }],
          }],
        }],
        coverageFlags: { has_ah: false },
      }),
    ];

    expect(summarizeOddsCoverageAudit(results)).toEqual(expect.objectContaining({
      total: 2,
      ok: 1,
      mismatchedStored: 1,
      mismatchedRecomputed: 0,
      rawWithoutCanonical: 0,
      byMissingStoredFlag: [{ key: 'has_ah', count: 1 }],
      byRawWithoutCanonicalFlag: [],
      byCanonicalRejectReason: [],
    }));
  });

  test('classifies missing raw market pairs separately from invalid margins', () => {
    const result = auditOddsCoverageSample({
      id: 4,
      matchId: '103',
      coverageFlags: {
        has_btts: true,
      },
      normalizedPayload: [{
        bookmakers: [{
          name: 'Live Odds',
          bets: [{
            name: 'Both Teams To Score',
            values: [
              { value: 'Yes', odd: '1.80' },
            ],
          }],
        }],
      }],
    });

    expect(result.ok).toBe(true);
    expect(result.rawWithoutCanonicalFlags).toEqual(['has_btts']);
    expect(result.canonicalRejectReasons).toEqual([{
      flag: 'has_btts',
      reason: 'raw_btts_present_but_not_canonical_tradable:missing_pair_or_selection',
    }]);
  });
});
