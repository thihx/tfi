import type { LiveAnalysisEvidenceMode } from './evidence-mode-market-allowlist.js';

export type LiveOutputKind =
  | 'money_recommendation'
  | 'stats_only_signal'
  | 'watch_insight'
  | 'shadow_candidate'
  | 'no_action';

export type LiveOutputRoute =
  | 'money_path'
  | 'stats_only_path'
  | 'watch_insight_path'
  | 'shadow_path'
  | 'no_action_path';

export type LiveDeliveryKind =
  | 'recommendation'
  | 'match_alert'
  | 'analysis_signal'
  | 'manual_advisory'
  | 'none';

export interface LiveEvidenceClassification {
  evidenceMode: LiveAnalysisEvidenceMode;
  hasStats: boolean;
  hasUsableLiveOdds: boolean;
  hasEvents: boolean;
  eventCount: number;
  missingInputs: string[];
  degradedReason: string | null;
}

export interface LiveOutputDecisionContext {
  contractVersion: 'live-output-v1';
  outputKind: LiveOutputKind;
  finalOutcome: 'saved' | 'notified' | 'shadow_recorded' | 'audited_no_action' | 'blocked';
  evidenceMode: LiveAnalysisEvidenceMode;
  route: LiveOutputRoute;
  auditBucket: string;
  noActionReason?: string;
  candidatePresent: boolean;
  shadowCandidate: boolean;
  statsOnlySignal: boolean;
  userVisible: boolean;
  savedRecommendation: boolean;
  settlementEligible: boolean;
  roiEligible: boolean;
  llmCalled: boolean;
  deliveryKind: LiveDeliveryKind;
  deliveryStatus: 'staged' | 'delivered' | 'skipped' | 'failed' | 'suppressed' | 'none';
}

export interface LiveOutputRouterInput {
  evidenceMode: LiveAnalysisEvidenceMode;
  llmCalled: boolean;
  advisoryOnly?: boolean;
  shadowMode?: boolean;
  saved?: boolean;
  notified?: boolean;
  llmEligibilityReason?: string | null;
  statsOnlySignalTriggered?: boolean;
  statsOnlySignalEnqueued?: number;
  statsOnlySignalWeak?: boolean;
  watchInsightTriggered?: boolean;
  watchInsightEnqueued?: number;
  parsedShouldPush?: boolean;
  parsedFinalShouldBet?: boolean;
  policyBlocked?: boolean;
  policyWarnings?: string[];
  marketResolutionStatus?: string | null;
  llmDecisionDiagnostic?: string | null;
  saveIntegrityStatus?: 'not_attempted' | 'ok' | 'blocked';
  saveBlockedReason?: string | null;
  runtimePolicyShadowMatched?: boolean;
  shadowCandidatePresent?: boolean;
}

export function classifyLiveEvidence(args: {
  statsAvailable: boolean;
  oddsAvailable: boolean;
  eventCount: number;
}): LiveEvidenceClassification {
  const hasStats = args.statsAvailable;
  const hasUsableLiveOdds = args.oddsAvailable;
  const hasEvents = args.eventCount > 0;
  const missingInputs: string[] = [];
  if (!hasStats) missingInputs.push('stats');
  if (!hasUsableLiveOdds) missingInputs.push('live_odds');
  if (!hasEvents) missingInputs.push('events');

  let evidenceMode: LiveAnalysisEvidenceMode;
  let degradedReason: string | null = null;

  if (hasStats && hasUsableLiveOdds) {
    evidenceMode = 'full_live_data';
  } else if (hasStats && !hasUsableLiveOdds) {
    evidenceMode = 'stats_only';
    degradedReason = 'missing_live_odds';
  } else if (!hasStats && hasUsableLiveOdds && hasEvents) {
    evidenceMode = 'odds_events_only_degraded';
    degradedReason = 'missing_stats';
  } else if (!hasStats && !hasUsableLiveOdds && hasEvents) {
    evidenceMode = 'events_only_degraded';
    degradedReason = 'missing_stats_and_live_odds';
  } else {
    evidenceMode = 'low_evidence';
    degradedReason = hasUsableLiveOdds ? 'odds_only_without_stats_events' : 'missing_core_evidence';
  }

  return {
    evidenceMode,
    hasStats,
    hasUsableLiveOdds,
    hasEvents,
    eventCount: Math.max(0, Math.floor(args.eventCount)),
    missingInputs,
    degradedReason,
  };
}

function bucketForLlmBlock(reason: string | null | undefined, evidenceMode: LiveAnalysisEvidenceMode): string {
  if (reason === 'no_active_watch_subscription') return 'no_active_watch_subscription';
  if (reason === 'match_not_live_for_auto_pipeline') return 'no_live_match';
  if (reason === 'minute_outside_auto_pipeline_window') return 'match_too_early';
  if (reason === 'low_evidence') return 'low_evidence';
  if (reason === 'no_tradable_canonical_market') return 'no_tradable_canonical_market';
  if (reason === 'auto_llm_cooldown_active') return 'llm_cooldown';
  if (reason === 'degraded_evidence') {
    if (evidenceMode === 'stats_only') return 'stats_only_weak_trigger';
    if (evidenceMode === 'odds_events_only_degraded') return 'degraded_evidence_odds_events_only';
    if (evidenceMode === 'events_only_degraded') return 'degraded_evidence_events_only';
  }
  return reason || 'no_action';
}

export function routeLiveOutput(input: LiveOutputRouterInput): LiveOutputDecisionContext {
  const savedRecommendation = input.saved === true;
  const notified = input.notified === true;
  const advisoryOnly = input.advisoryOnly === true;
  const shadowMode = input.shadowMode === true;
  const candidatePresent = Boolean(
    input.parsedFinalShouldBet
    || input.parsedShouldPush
    || input.shadowCandidatePresent
    || input.runtimePolicyShadowMatched,
  );

  if (savedRecommendation) {
    return {
      contractVersion: 'live-output-v1',
      outputKind: 'money_recommendation',
      finalOutcome: 'saved',
      evidenceMode: input.evidenceMode,
      route: 'money_path',
      auditBucket: 'recommendation_saved',
      candidatePresent: true,
      shadowCandidate: false,
      statsOnlySignal: false,
      userVisible: true,
      savedRecommendation: true,
      settlementEligible: true,
      roiEligible: true,
      llmCalled: input.llmCalled,
      deliveryKind: 'recommendation',
      deliveryStatus: notified ? 'delivered' : 'staged',
    };
  }

  if (input.statsOnlySignalTriggered) {
    const enqueued = Math.max(0, Number(input.statsOnlySignalEnqueued ?? 0) || 0);
    return {
      contractVersion: 'live-output-v1',
      outputKind: 'stats_only_signal',
      finalOutcome: enqueued > 0 ? 'notified' : 'audited_no_action',
      evidenceMode: input.evidenceMode,
      route: 'stats_only_path',
      auditBucket: enqueued > 0 ? 'stats_only_signal_emitted' : 'stats_only_signal_no_subscriber',
      candidatePresent: true,
      shadowCandidate: false,
      statsOnlySignal: true,
      userVisible: enqueued > 0,
      savedRecommendation: false,
      settlementEligible: false,
      roiEligible: false,
      llmCalled: input.llmCalled,
      deliveryKind: 'match_alert',
      deliveryStatus: enqueued > 0 ? 'staged' : 'skipped',
    };
  }

  if (input.statsOnlySignalWeak) {
    return {
      contractVersion: 'live-output-v1',
      outputKind: 'no_action',
      finalOutcome: 'audited_no_action',
      evidenceMode: input.evidenceMode,
      route: 'stats_only_path',
      auditBucket: 'stats_only_weak_trigger',
      noActionReason: 'stats_only_weak_trigger',
      candidatePresent: false,
      shadowCandidate: false,
      statsOnlySignal: false,
      userVisible: false,
      savedRecommendation: false,
      settlementEligible: false,
      roiEligible: false,
      llmCalled: input.llmCalled,
      deliveryKind: 'none',
      deliveryStatus: 'none',
    };
  }

  if (input.watchInsightTriggered) {
    const enqueued = Math.max(0, Number(input.watchInsightEnqueued ?? 0) || 0);
    return {
      contractVersion: 'live-output-v1',
      outputKind: 'watch_insight',
      finalOutcome: enqueued > 0 ? 'notified' : 'audited_no_action',
      evidenceMode: input.evidenceMode,
      route: 'watch_insight_path',
      auditBucket: enqueued > 0 ? 'watch_insight_emitted' : 'watch_insight_no_subscriber',
      candidatePresent: false,
      shadowCandidate: false,
      statsOnlySignal: false,
      userVisible: enqueued > 0,
      savedRecommendation: false,
      settlementEligible: false,
      roiEligible: false,
      llmCalled: input.llmCalled,
      deliveryKind: 'match_alert',
      deliveryStatus: enqueued > 0 ? 'staged' : 'skipped',
    };
  }

  if (input.saveIntegrityStatus === 'blocked') {
    return {
      contractVersion: 'live-output-v1',
      outputKind: input.runtimePolicyShadowMatched ? 'shadow_candidate' : 'no_action',
      finalOutcome: 'blocked',
      evidenceMode: input.evidenceMode,
      route: input.runtimePolicyShadowMatched ? 'shadow_path' : 'no_action_path',
      auditBucket: 'save_integrity_blocked',
      noActionReason: input.saveBlockedReason || 'save_integrity_blocked',
      candidatePresent: true,
      shadowCandidate: input.runtimePolicyShadowMatched === true,
      statsOnlySignal: false,
      userVisible: input.runtimePolicyShadowMatched === true,
      savedRecommendation: false,
      settlementEligible: false,
      roiEligible: false,
      llmCalled: input.llmCalled,
      deliveryKind: input.runtimePolicyShadowMatched ? 'analysis_signal' : 'none',
      deliveryStatus: input.runtimePolicyShadowMatched ? 'suppressed' : 'none',
    };
  }

  if (input.policyBlocked || input.runtimePolicyShadowMatched || shadowMode) {
    return {
      contractVersion: 'live-output-v1',
      outputKind: 'shadow_candidate',
      finalOutcome: 'shadow_recorded',
      evidenceMode: input.evidenceMode,
      route: 'shadow_path',
      auditBucket: input.policyBlocked ? 'policy_blocked' : 'shadow_candidate',
      noActionReason: input.policyWarnings?.[0],
      candidatePresent,
      shadowCandidate: true,
      statsOnlySignal: false,
      userVisible: !advisoryOnly && !shadowMode,
      savedRecommendation: false,
      settlementEligible: false,
      roiEligible: false,
      llmCalled: input.llmCalled,
      deliveryKind: 'analysis_signal',
      deliveryStatus: 'suppressed',
    };
  }

  if (input.marketResolutionStatus && input.marketResolutionStatus !== 'resolved' && input.marketResolutionStatus !== 'not_requested') {
    return {
      contractVersion: 'live-output-v1',
      outputKind: 'no_action',
      finalOutcome: 'audited_no_action',
      evidenceMode: input.evidenceMode,
      route: 'no_action_path',
      auditBucket: 'market_unresolved',
      noActionReason: input.marketResolutionStatus,
      candidatePresent,
      shadowCandidate: false,
      statsOnlySignal: false,
      userVisible: false,
      savedRecommendation: false,
      settlementEligible: false,
      roiEligible: false,
      llmCalled: input.llmCalled,
      deliveryKind: advisoryOnly ? 'manual_advisory' : 'none',
      deliveryStatus: 'none',
    };
  }

  const llmBlockBucket = input.llmEligibilityReason
    ? bucketForLlmBlock(input.llmEligibilityReason, input.evidenceMode)
    : null;
  const diagnosticBucket = input.llmDecisionDiagnostic === 'no_bet_intentional'
    ? 'model_no_bet'
    : input.llmDecisionDiagnostic === 'market_parse_failed'
      ? 'market_unresolved'
      : input.llmDecisionDiagnostic === 'policy_blocked'
        ? 'policy_blocked'
        : null;
  const auditBucket = llmBlockBucket || diagnosticBucket || 'no_action';

  return {
    contractVersion: 'live-output-v1',
    outputKind: 'no_action',
    finalOutcome: 'audited_no_action',
    evidenceMode: input.evidenceMode,
    route: 'no_action_path',
    auditBucket,
    noActionReason: input.llmEligibilityReason || input.llmDecisionDiagnostic || auditBucket,
    candidatePresent,
    shadowCandidate: false,
    statsOnlySignal: false,
    userVisible: advisoryOnly,
    savedRecommendation: false,
    settlementEligible: false,
    roiEligible: false,
    llmCalled: input.llmCalled,
    deliveryKind: advisoryOnly ? 'manual_advisory' : 'none',
    deliveryStatus: 'none',
  };
}
