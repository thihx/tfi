import { describe, expect, test } from 'vitest';
import { classifyLiveEvidence, routeLiveOutput } from '../lib/live-output-router.js';

describe('live output router', () => {
  test('classifies full, stats-only, degraded, and low-evidence modes', () => {
    expect(classifyLiveEvidence({ statsAvailable: true, oddsAvailable: true, eventCount: 3 })).toMatchObject({
      evidenceMode: 'full_live_data',
      missingInputs: [],
      degradedReason: null,
    });
    expect(classifyLiveEvidence({ statsAvailable: true, oddsAvailable: false, eventCount: 3 })).toMatchObject({
      evidenceMode: 'stats_only',
      missingInputs: ['live_odds'],
      degradedReason: 'missing_live_odds',
    });
    expect(classifyLiveEvidence({ statsAvailable: false, oddsAvailable: true, eventCount: 2 })).toMatchObject({
      evidenceMode: 'odds_events_only_degraded',
      missingInputs: ['stats'],
      degradedReason: 'missing_stats',
    });
    expect(classifyLiveEvidence({ statsAvailable: false, oddsAvailable: false, eventCount: 1 })).toMatchObject({
      evidenceMode: 'events_only_degraded',
      missingInputs: ['stats', 'live_odds'],
      degradedReason: 'missing_stats_and_live_odds',
    });
    expect(classifyLiveEvidence({ statsAvailable: false, oddsAvailable: true, eventCount: 0 })).toMatchObject({
      evidenceMode: 'low_evidence',
      missingInputs: ['stats', 'events'],
      degradedReason: 'odds_only_without_stats_events',
    });
  });

  test('routes saved recommendations as settlement and ROI eligible only when saved', () => {
    const result = routeLiveOutput({
      evidenceMode: 'full_live_data',
      llmCalled: true,
      saved: true,
      notified: true,
      parsedFinalShouldBet: true,
    });

    expect(result).toMatchObject({
      outputKind: 'money_recommendation',
      route: 'money_path',
      auditBucket: 'recommendation_saved',
      savedRecommendation: true,
      settlementEligible: true,
      roiEligible: true,
      deliveryKind: 'recommendation',
      deliveryStatus: 'delivered',
    });
  });

  test('routes stats-only signal without LLM or settlement eligibility', () => {
    const result = routeLiveOutput({
      evidenceMode: 'stats_only',
      llmCalled: false,
      statsOnlySignalTriggered: true,
      statsOnlySignalEnqueued: 2,
    });

    expect(result).toMatchObject({
      outputKind: 'stats_only_signal',
      route: 'stats_only_path',
      auditBucket: 'stats_only_signal_emitted',
      statsOnlySignal: true,
      savedRecommendation: false,
      settlementEligible: false,
      roiEligible: false,
      deliveryKind: 'match_alert',
    });
  });

  test('routes policy blocked candidates as shadow candidates', () => {
    const result = routeLiveOutput({
      evidenceMode: 'full_live_data',
      llmCalled: true,
      parsedShouldPush: true,
      policyBlocked: true,
      policyWarnings: ['POLICY_BLOCKED'],
      runtimePolicyShadowMatched: true,
    });

    expect(result).toMatchObject({
      outputKind: 'shadow_candidate',
      route: 'shadow_path',
      auditBucket: 'policy_blocked',
      savedRecommendation: false,
      settlementEligible: false,
      deliveryKind: 'analysis_signal',
      deliveryStatus: 'suppressed',
    });
  });

  test('routes blocked or weak inputs to explicit no-action buckets', () => {
    expect(routeLiveOutput({
      evidenceMode: 'stats_only',
      llmCalled: false,
      statsOnlySignalWeak: true,
    })).toMatchObject({
      outputKind: 'no_action',
      auditBucket: 'stats_only_weak_trigger',
      llmCalled: false,
    });

    expect(routeLiveOutput({
      evidenceMode: 'low_evidence',
      llmCalled: false,
      llmEligibilityReason: 'low_evidence',
    })).toMatchObject({
      outputKind: 'no_action',
      auditBucket: 'low_evidence',
      noActionReason: 'low_evidence',
    });
  });

  test('routes save-integrity blocked candidates without settlement eligibility', () => {
    const result = routeLiveOutput({
      evidenceMode: 'full_live_data',
      llmCalled: true,
      parsedFinalShouldBet: true,
      saveIntegrityStatus: 'blocked',
      saveBlockedReason: 'provider_line_unavailable_or_stale',
    });

    expect(result).toMatchObject({
      outputKind: 'no_action',
      auditBucket: 'save_integrity_blocked',
      noActionReason: 'provider_line_unavailable_or_stale',
      savedRecommendation: false,
      settlementEligible: false,
      roiEligible: false,
    });
  });
});
