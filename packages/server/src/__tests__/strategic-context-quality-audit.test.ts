import { describe, expect, test } from 'vitest';
import { diagnoseStrategicContextQuality } from '../lib/strategic-context-quality-audit.js';

describe('strategic-context-quality-audit', () => {
  test('classifies provider-only fallback as fixture-only and not decision relevant', () => {
    const diagnostics = diagnoseStrategicContextQuality({
      refreshStatus: 'poor',
      searchQuality: 'low',
      sourceMode: 'provider_fallback',
      trustedSourceCount: 1,
      sourceCount: 1,
      queryCount: 0,
      quantitativeCount: 0,
      summary: 'API-Football confirms Germany vs Curacao. Pre-match odds are available.',
      sources: [{ domain: 'api-football.com', url: 'https://www.api-football.com/', trust_tier: 'tier_1' }],
    });

    expect(diagnostics.rootCause).toBe('provider_fallback_provider_only_supported');
    expect(diagnostics.decisionUsefulness).toBe('fixture_only');
    expect(diagnostics.reasonCodes).toEqual(expect.arrayContaining([
      'provider_fallback',
      'trusted_sources_lt_2',
      'quantitative_empty',
      'queries_empty',
    ]));
  });

  test('detects grounded numeric values that only have generic domain URLs', () => {
    const diagnostics = diagnoseStrategicContextQuality({
      refreshStatus: 'good',
      searchQuality: 'high',
      sourceMode: 'grounded',
      trustedSourceCount: 7,
      sourceCount: 3,
      queryCount: 12,
      quantitativeCount: 16,
      sources: [
        { domain: 'fifa.com', url: 'https://fifa.com', trust_tier: 'tier_1' },
        { domain: 'flashscore.com', url: 'https://flashscore.com', trust_tier: 'tier_2' },
        { domain: 'goal.com', url: 'https://goal.com', trust_tier: 'tier_1' },
      ],
    });

    expect(diagnostics.rootCause).toBe('grounded_but_claim_traceability_missing');
    expect(diagnostics.decisionUsefulness).toBe('useful_but_unverified');
    expect(diagnostics.claimTraceability).toBe('domain_only');
    expect(diagnostics.quantitativeIntegrity).toBe('values_without_attribution');
    expect(diagnostics.concreteSourceUrlCount).toBe(0);
    expect(diagnostics.genericSourceUrlCount).toBe(3);
    expect(diagnostics.reasonCodes).toEqual(expect.arrayContaining([
      'generic_domain_urls',
      'no_concrete_source_urls',
      'numeric_values_without_source_url',
    ]));
  });

  test('classifies grounded context with concrete URLs as decision relevant', () => {
    const diagnostics = diagnoseStrategicContextQuality({
      refreshStatus: 'good',
      searchQuality: 'high',
      sourceMode: 'grounded',
      trustedSourceCount: 2,
      sourceCount: 2,
      queryCount: 6,
      quantitativeCount: 8,
      sources: [
        { domain: 'reuters.com', url: 'https://www.reuters.com/sports/soccer/example-2026-06-14/', trust_tier: 'tier_1' },
        { domain: 'fbref.com', url: 'https://fbref.com/en/matches/example', trust_tier: 'tier_2' },
      ],
    });

    expect(diagnostics.rootCause).toBe('usable_grounded_context');
    expect(diagnostics.decisionUsefulness).toBe('decision_relevant');
    expect(diagnostics.claimTraceability).toBe('source_url_only');
    expect(diagnostics.hasConcreteSourceUrls).toBe(true);
  });

  test('separates gateway-blocked fallback from provider-only fallback', () => {
    const diagnostics = diagnoseStrategicContextQuality({
      refreshStatus: 'failed',
      searchQuality: 'low',
      sourceMode: 'provider_fallback',
      trustedSourceCount: 1,
      sourceCount: 1,
      queryCount: 0,
      quantitativeCount: 0,
      lastError: 'AI Gateway blocked Gemini call: breaker_open:loop_detected',
      sources: [{ domain: 'api-football.com', url: 'https://www.api-football.com/', trust_tier: 'tier_1' }],
    });

    expect(diagnostics.rootCause).toBe('provider_fallback_after_gateway_blocked');
    expect(diagnostics.decisionUsefulness).toBe('fixture_only');
  });

  test('separates provider fallback after successful grounding from provider-only fallback', () => {
    const diagnostics = diagnoseStrategicContextQuality({
      refreshStatus: 'poor',
      searchQuality: 'low',
      sourceMode: 'provider_fallback',
      trustedSourceCount: 1,
      sourceCount: 1,
      queryCount: 0,
      quantitativeCount: 0,
      sources: [{ domain: 'api-football.com', url: 'https://www.api-football.com/', trust_tier: 'tier_1' }],
      gateway: {
        groundedStartedCount: 1,
        groundedSucceededCount: 1,
        structuredSucceededCount: 1,
        repairSucceededCount: 1,
        latestReason: 'allowed',
      },
    });

    expect(diagnostics.rootCause).toBe('provider_fallback_after_grounding_sparse');
    expect(diagnostics.reasonCodes).toEqual(expect.arrayContaining([
      'gateway_grounded_succeeded',
      'gateway_structured_succeeded',
      'gateway_repair_succeeded',
    ]));
  });
});
