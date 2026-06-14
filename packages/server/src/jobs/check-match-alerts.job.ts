import { reportJobProgress } from './job-progress.js';
import { config } from '../config.js';
import * as rulesRepo from '../repos/match-alert-rules.repo.js';
import * as matchesRepo from '../repos/matches.repo.js';
import * as snapshotsRepo from '../repos/match-snapshots.repo.js';
import { buildMatchAlertContext } from '../lib/match-alert-context.js';
import { evaluateMatchAlertRule, type MatchAlertEvaluationResult } from '../lib/match-alert-rule-engine.js';
import { adjudicateMatchAlertWithLlm } from '../lib/match-alert-llm.js';
import {
  deliverPendingWebPushMatchAlerts,
  deliverPendingNativePushMatchAlerts,
  deliverPendingFallbackMatchAlerts,
  enqueueMatchAlertDelivery,
  hasRecentMatchAlertDelivery,
  recordSuppressedMatchAlertDelivery,
} from '../repos/match-alert-deliveries.repo.js';

export function shouldAdjudicateMatchAlertWithLlm(
  rule: { alertKind: string; source?: string },
  result: MatchAlertEvaluationResult,
  enabled = config.matchAlertLlmEnabled,
): boolean {
  if (!enabled || rule.alertKind !== 'condition_signal' || result.severity === 'high') return false;
  const source = String(rule.source ?? '');
  return source === 'favorite_team' || source === 'favorite_league';
}

export async function checkMatchAlertsJob(): Promise<{
  rules: number;
  matches: number;
  evaluated: number;
  matched: number;
  llmEvaluated: number;
  llmSuppressed: number;
  llmFailed: number;
  enqueued: number;
  webPushDelivered: number;
  webPushFailed: number;
  nativePushDelivered: number;
  nativePushFailed: number;
  smsDelivered: number;
  smsFailed: number;
  voiceCallDelivered: number;
  voiceCallFailed: number;
}> {
  const JOB = 'check-match-alerts';
  await reportJobProgress(JOB, 'load', 'Loading active match alert rules...', 15);
  const rules = await rulesRepo.getCandidateAlertRules();
  if (rules.length === 0) {
    const [webPush, nativePush, sms, voiceCall] = await Promise.all([
      deliverPendingWebPushMatchAlerts(),
      deliverPendingNativePushMatchAlerts(),
      deliverPendingFallbackMatchAlerts('sms'),
      deliverPendingFallbackMatchAlerts('voice_call'),
    ]);
    return {
      rules: 0,
      matches: 0,
      evaluated: 0,
      matched: 0,
      llmEvaluated: 0,
      llmSuppressed: 0,
      llmFailed: 0,
      enqueued: 0,
      webPushDelivered: webPush.delivered,
      webPushFailed: webPush.failed,
      nativePushDelivered: nativePush.delivered,
      nativePushFailed: nativePush.failed,
      smsDelivered: sms.delivered,
      smsFailed: sms.failed,
      voiceCallDelivered: voiceCall.delivered,
      voiceCallFailed: voiceCall.failed,
    };
  }

  const matchIds = Array.from(new Set(rules.map((rule) => rule.matchId).filter((id): id is string => Boolean(id))));
  await reportJobProgress(JOB, 'context', `Building alert context for ${matchIds.length} matches...`, 35);
  const [matches, snapshots] = await Promise.all([
    matchesRepo.getMatchesByIds(matchIds),
    snapshotsRepo.getLatestSnapshotsForMatches(matchIds),
  ]);
  const matchMap = new Map(matches.map((match) => [String(match.match_id), match] as const));
  const contextMap = new Map<string, ReturnType<typeof buildMatchAlertContext>>();
  for (const match of matches) {
    contextMap.set(String(match.match_id), buildMatchAlertContext(match, snapshots.get(String(match.match_id))));
  }

  let evaluated = 0;
  let matched = 0;
  let llmEvaluated = 0;
  let llmSuppressed = 0;
  let llmFailed = 0;
  let enqueued = 0;

  await reportJobProgress(JOB, 'evaluate', `Evaluating ${rules.length} alert rules...`, 60);
  for (const rule of rules) {
    if (!rule.matchId) continue;
    if (!matchMap.has(rule.matchId)) continue;
    const context = contextMap.get(rule.matchId);
    if (!context) continue;
    evaluated += 1;
    let result: MatchAlertEvaluationResult = evaluateMatchAlertRule(rule.alertKind, rule.ruleJson, context);
    if (!result.supported || !result.matched) continue;
    if (result.triggerKey && await hasRecentMatchAlertDelivery(rule, result.triggerKey)) continue;
    matched += 1;
    const metadataPatch: Record<string, unknown> = {};

    if (shouldAdjudicateMatchAlertWithLlm(rule, result)) {
      if (!config.geminiApiKey) {
        metadataPatch.llm = {
          status: 'skipped',
          reason: 'missing_gemini_api_key',
          model: config.geminiMatchAlertModel,
        };
      } else {
        llmEvaluated += 1;
        try {
          const decision = await adjudicateMatchAlertWithLlm({ rule, context, evaluation: result });
          metadataPatch.llm = {
            status: 'succeeded',
            model: decision.model,
            shouldPush: decision.shouldPush,
            confidence: decision.confidence,
            reasonVi: decision.reasonVi,
          };
          if (!decision.shouldPush) {
            llmSuppressed += 1;
            await recordSuppressedMatchAlertDelivery(rule, result, context, {
              llm: {
                status: 'suppressed',
                model: decision.model,
                shouldPush: decision.shouldPush,
                confidence: decision.confidence,
                reasonVi: decision.reasonVi,
              },
            });
            continue;
          }
          result = {
            ...result,
            summaryVi: decision.summaryVi || result.summaryVi,
            suggestedAction: decision.suggestedAction || result.suggestedAction,
          };
        } catch (err) {
          llmFailed += 1;
          metadataPatch.llm = {
            status: 'failed',
            model: config.geminiMatchAlertModel,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
    }

    const delivery = await enqueueMatchAlertDelivery(rule, result, context, metadataPatch);
    if (delivery) enqueued += 1;
  }

  await reportJobProgress(JOB, 'deliver', 'Delivering pending match alerts...', 85);
  const [webPush, nativePush, sms, voiceCall] = await Promise.all([
    deliverPendingWebPushMatchAlerts(),
    deliverPendingNativePushMatchAlerts(),
    deliverPendingFallbackMatchAlerts('sms'),
    deliverPendingFallbackMatchAlerts('voice_call'),
  ]);
  await reportJobProgress(JOB, 'complete', `Evaluated ${evaluated}, enqueued ${enqueued}`, 100);
  return {
    rules: rules.length,
    matches: matchIds.length,
    evaluated,
    matched,
    llmEvaluated,
    llmSuppressed,
    llmFailed,
    enqueued,
    webPushDelivered: webPush.delivered,
    webPushFailed: webPush.failed,
    nativePushDelivered: nativePush.delivered,
    nativePushFailed: nativePush.failed,
    smsDelivered: sms.delivered,
    smsFailed: sms.failed,
    voiceCallDelivered: voiceCall.delivered,
    voiceCallFailed: voiceCall.failed,
  };
}
