// ============================================================
// AI Analysis Service
// Equivalent to: "Route AI Provider" + Gemini/Claude call + "Parse AI Response"
// ============================================================

import type { AppConfig } from '@/types';
import type {
  LiveMonitorConfig,
  MergedMatchData,
  ParsedAiResponse,
  OddsCanonical,
  AiPromptContext,
} from '../types';
import { runAiAnalysis } from './proxy.service';
import {
  parseBetMarketLineSuffix as parseLineSuffix,
  sameOddsLine as sameLine,
} from '../../../lib/odds-line-utils';

// ==================== Helpers ====================

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

/**
 * Extract JSON string from AI response that may include markdown code fences.
 * Mirrors n8n "Parse AI Response" extractJsonString exactly.
 */
function extractJsonString(text: string): string {
  if (!text || typeof text !== 'string') return '';

  // Try ```json ... ``` first
  const jsonFence = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonFence?.[1]) return jsonFence[1].trim();

  // Try ``` ... ``` (generic fence)
  const genericFence = text.match(/```\s*([\s\S]*?)```/);
  if (genericFence?.[1]) return genericFence[1].trim();

  // Try raw JSON object
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return text.substring(firstBrace, lastBrace + 1);
  }

  return text.trim();
}

/** Mirror packages/server extractOddsFromSelection(bet_market-driven). */
function extractOddsFromBetMarket(betMarket: string, canonical: OddsCanonical): number | null {
  const market = (betMarket || '').toLowerCase();
  const oc = canonical;
  if (!market) return null;

  if (market === '1x2_home') return oc['1x2']?.home ?? null;
  if (market === '1x2_away') return oc['1x2']?.away ?? null;
  if (market === '1x2_draw') return oc['1x2']?.draw ?? null;
  if (market === 'btts_yes') return oc.btts?.yes ?? null;
  if (market === 'btts_no') return oc.btts?.no ?? null;

  if (market === 'ht_1x2_home') return oc['ht_1x2']?.home ?? null;
  if (market === 'ht_1x2_away') return oc['ht_1x2']?.away ?? null;
  if (market === 'ht_1x2_draw') return oc['ht_1x2']?.draw ?? null;
  if (market === 'ht_btts_yes') return oc.ht_btts?.yes ?? null;
  if (market === 'ht_btts_no') return oc.ht_btts?.no ?? null;

  const htGoalOverLine = parseLineSuffix('ht_over_', market);
  if (htGoalOverLine !== null) {
    if (sameLine(htGoalOverLine, oc.ht_ou?.line)) return oc.ht_ou?.over ?? null;
    if (sameLine(htGoalOverLine, oc.ht_ou_adjacent?.line)) return oc.ht_ou_adjacent?.over ?? null;
    return null;
  }

  const htGoalUnderLine = parseLineSuffix('ht_under_', market);
  if (htGoalUnderLine !== null) {
    if (sameLine(htGoalUnderLine, oc.ht_ou?.line)) return oc.ht_ou?.under ?? null;
    if (sameLine(htGoalUnderLine, oc.ht_ou_adjacent?.line)) return oc.ht_ou_adjacent?.under ?? null;
    return null;
  }

  const htAhHomeLine = parseLineSuffix('ht_asian_handicap_home_', market);
  if (htAhHomeLine !== null) {
    if (sameLine(htAhHomeLine, oc.ht_ah?.line)) return oc.ht_ah?.home ?? null;
    if (sameLine(htAhHomeLine, oc.ht_ah_adjacent?.line)) return oc.ht_ah_adjacent?.home ?? null;
    return null;
  }

  const htAhAwayLine = parseLineSuffix('ht_asian_handicap_away_', market);
  if (htAhAwayLine !== null) {
    const matchMain =
      sameLine(htAhAwayLine, oc.ht_ah?.line) || sameLine(-htAhAwayLine, oc.ht_ah?.line);
    if (matchMain) return oc.ht_ah?.away ?? null;
    const matchAdj =
      sameLine(htAhAwayLine, oc.ht_ah_adjacent?.line) || sameLine(-htAhAwayLine, oc.ht_ah_adjacent?.line);
    if (matchAdj) return oc.ht_ah_adjacent?.away ?? null;
    return null;
  }

  const goalOverLine = parseLineSuffix('over_', market);
  if (goalOverLine !== null) {
    if (sameLine(goalOverLine, oc.ou?.line)) return oc.ou?.over ?? null;
    if (sameLine(goalOverLine, oc.ou_adjacent?.line)) return oc.ou_adjacent?.over ?? null;
    return null;
  }

  const goalUnderLine = parseLineSuffix('under_', market);
  if (goalUnderLine !== null) {
    if (sameLine(goalUnderLine, oc.ou?.line)) return oc.ou?.under ?? null;
    if (sameLine(goalUnderLine, oc.ou_adjacent?.line)) return oc.ou_adjacent?.under ?? null;
    return null;
  }

  const ahHomeLine = parseLineSuffix('asian_handicap_home_', market);
  if (ahHomeLine !== null) {
    if (sameLine(ahHomeLine, oc.ah?.line)) return oc.ah?.home ?? null;
    if (sameLine(ahHomeLine, oc.ah_adjacent?.line)) return oc.ah_adjacent?.home ?? null;
    return null;
  }

  const ahAwayLine = parseLineSuffix('asian_handicap_away_', market);
  if (ahAwayLine !== null) {
    const matchMain =
      sameLine(ahAwayLine, oc.ah?.line) || sameLine(-ahAwayLine, oc.ah?.line);
    if (matchMain) return oc.ah?.away ?? null;
    const matchAdj =
      sameLine(ahAwayLine, oc.ah_adjacent?.line) || sameLine(-ahAwayLine, oc.ah_adjacent?.line);
    if (matchAdj) return oc.ah_adjacent?.away ?? null;
    return null;
  }

  const cornersOverLine = parseLineSuffix('corners_over_', market);
  if (cornersOverLine !== null) {
    return sameLine(cornersOverLine, oc.corners_ou?.line) ? (oc.corners_ou?.over ?? null) : null;
  }

  const cornersUnderLine = parseLineSuffix('corners_under_', market);
  if (cornersUnderLine !== null) {
    return sameLine(cornersUnderLine, oc.corners_ou?.line) ? (oc.corners_ou?.under ?? null) : null;
  }

  return null;
}

/**
 * Extract odds: prefer structured bet_market (server-aligned), else selection heuristics + oddsMap.
 */
function extractOddsFromSelection(
  selection: string,
  betMarket: string,
  oddsMap: Record<string, number>,
  oddsCanonical: OddsCanonical,
): number | null {
  const fromMarket = extractOddsFromBetMarket(betMarket, oddsCanonical);
  if (fromMarket !== null) return fromMarket;

  if (!selection) return null;

  const atMatch = selection.match(/@\s*([\d.]+)/);
  if (atMatch?.[1]) {
    const price = parseFloat(atMatch[1]);
    if (!isNaN(price) && price > 1) return price;
  }

  const selLower = selection.toLowerCase().trim();
  if (oddsMap[selLower] !== undefined) return oddsMap[selLower];

  for (const [key, value] of Object.entries(oddsMap)) {
    if (selLower.includes(key) || key.includes(selLower)) return value;
  }

  const oc = oddsCanonical;
  const htCtx = /\b(1st\s*half|first\s*half|\bh1\b|\bht\b)/i.test(selection);

  if (htCtx && oc['ht_1x2']) {
    if (/home\s*win/i.test(selection) && oc['ht_1x2'].home) return oc['ht_1x2'].home;
    if (/away\s*win/i.test(selection) && oc['ht_1x2'].away) return oc['ht_1x2'].away;
    if (/\bdraw\b/i.test(selection) && oc['ht_1x2'].draw) return oc['ht_1x2'].draw;
  }
  if (htCtx && oc.ht_ou) {
    if (/over/i.test(selection) && oc.ht_ou.over) return oc.ht_ou.over;
    if (/under/i.test(selection) && oc.ht_ou.under) return oc.ht_ou.under;
  }
  if (htCtx && oc.ht_btts) {
    if (/btts\s*yes/i.test(selection) && oc.ht_btts.yes) return oc.ht_btts.yes;
    if (/btts\s*no/i.test(selection) && oc.ht_btts.no) return oc.ht_btts.no;
  }

  if (/home\s*win/i.test(selection) && oc['1x2']?.home) return oc['1x2'].home;
  if (/away\s*win/i.test(selection) && oc['1x2']?.away) return oc['1x2'].away;
  if (/\bdraw\b/i.test(selection) && oc['1x2']?.draw) return oc['1x2'].draw;

  if (/over/i.test(selection) && oc.ou?.over) return oc.ou.over;
  if (/under/i.test(selection) && oc.ou?.under) return oc.ou.under;

  if (/btts\s*yes/i.test(selection) && oc.btts?.yes) return oc.btts.yes;
  if (/btts\s*no/i.test(selection) && oc.btts?.no) return oc.btts.no;

  if (/home.*[+-]?\d/i.test(selection) && oc.ah?.home) return oc.ah.home;
  if (/away.*[+-]?\d/i.test(selection) && oc.ah?.away) return oc.ah.away;

  if (/corner.*over/i.test(selection) && oc.corners_ou?.over) return oc.corners_ou.over;
  if (/corner.*under/i.test(selection) && oc.corners_ou?.under) return oc.corners_ou.under;

  return null;
}

// ==================== Route & Call AI ====================

/**
 * Route to the correct AI provider and call via proxy.
 * Returns raw AI text response.
 */
export async function routeAndCallAi(
  appConfig: AppConfig,
  monitorConfig: LiveMonitorConfig,
  matchData: MergedMatchData,
  _context?: AiPromptContext,
): Promise<string> {
  void _context;
  const provider = monitorConfig.AI_PROVIDER;
  const model = monitorConfig.AI_MODEL;
  return runAiAnalysis(
    appConfig,
    matchData.match_id,
    provider,
    model,
    matchData.force_analyze === true || matchData.is_manual_push === true,
  );
}

// ==================== Parse AI Response ====================

/**
 * Parse the raw AI response text into a structured ParsedAiResponse.
 * Mirrors the n8n "Parse AI Response" node exactly.
 */
export function parseAiResponse(
  aiRawResponse: string,
  matchData: MergedMatchData,
  config: LiveMonitorConfig,
): ParsedAiResponse {
  const oddsCanonical = matchData.odds_canonical || {};
  const minute = matchData.minute;
  const status = matchData.status;
  const oddsAvailable = matchData.odds_available;

  // Build oddsMap for lookup
  const oddsMap: Record<string, number> = {};
  const oc = oddsCanonical;
  if (oc['1x2']) {
    if (oc['1x2'].home) oddsMap['home win'] = oc['1x2'].home;
    if (oc['1x2'].draw) oddsMap['draw'] = oc['1x2'].draw;
    if (oc['1x2'].away) oddsMap['away win'] = oc['1x2'].away;
  }
  if (oc.ou) {
    if (oc.ou.over) oddsMap[`over ${oc.ou.line}`] = oc.ou.over;
    if (oc.ou.under) oddsMap[`under ${oc.ou.line}`] = oc.ou.under;
  }
  if (oc.ou_adjacent) {
    if (oc.ou_adjacent.over) oddsMap[`over ${oc.ou_adjacent.line}`] = oc.ou_adjacent.over;
    if (oc.ou_adjacent.under) oddsMap[`under ${oc.ou_adjacent.line}`] = oc.ou_adjacent.under;
  }
  if (oc.ah) {
    if (oc.ah.home) oddsMap[`home ${oc.ah.line}`] = oc.ah.home;
    if (oc.ah.away) oddsMap[`away ${oc.ah.line}`] = oc.ah.away;
  }
  if (oc.ah_adjacent) {
    if (oc.ah_adjacent.home) oddsMap[`home ${oc.ah_adjacent.line}`] = oc.ah_adjacent.home;
    if (oc.ah_adjacent.away) oddsMap[`away ${oc.ah_adjacent.line}`] = oc.ah_adjacent.away;
  }
  if (oc.btts) {
    if (oc.btts.yes) oddsMap['btts yes'] = oc.btts.yes;
    if (oc.btts.no) oddsMap['btts no'] = oc.btts.no;
  }
  if (oc.corners_ou) {
    if (oc.corners_ou.over) oddsMap[`corners over ${oc.corners_ou.line}`] = oc.corners_ou.over;
    if (oc.corners_ou.under) oddsMap[`corners under ${oc.corners_ou.line}`] = oc.corners_ou.under;
  }
  if (oc['ht_1x2']) {
    if (oc['ht_1x2'].home) {
      oddsMap['ht home win'] = oc['ht_1x2'].home;
      oddsMap['1st half home'] = oc['ht_1x2'].home;
    }
    if (oc['ht_1x2'].draw) {
      oddsMap['ht draw'] = oc['ht_1x2'].draw;
      oddsMap['1st half draw'] = oc['ht_1x2'].draw;
    }
    if (oc['ht_1x2'].away) {
      oddsMap['ht away win'] = oc['ht_1x2'].away;
      oddsMap['1st half away'] = oc['ht_1x2'].away;
    }
  }
  if (oc.ht_ou) {
    if (oc.ht_ou.over) oddsMap[`ht over ${oc.ht_ou.line}`] = oc.ht_ou.over;
    if (oc.ht_ou.under) oddsMap[`ht under ${oc.ht_ou.line}`] = oc.ht_ou.under;
  }
  if (oc.ht_ou_adjacent) {
    if (oc.ht_ou_adjacent.over) oddsMap[`ht over ${oc.ht_ou_adjacent.line}`] = oc.ht_ou_adjacent.over;
    if (oc.ht_ou_adjacent.under) oddsMap[`ht under ${oc.ht_ou_adjacent.line}`] = oc.ht_ou_adjacent.under;
  }
  if (oc.ht_ah) {
    if (oc.ht_ah.home) oddsMap[`ht home ${oc.ht_ah.line}`] = oc.ht_ah.home;
    if (oc.ht_ah.away) oddsMap[`ht away ${oc.ht_ah.line}`] = oc.ht_ah.away;
  }
  if (oc.ht_ah_adjacent) {
    if (oc.ht_ah_adjacent.home) oddsMap[`ht home ${oc.ht_ah_adjacent.line}`] = oc.ht_ah_adjacent.home;
    if (oc.ht_ah_adjacent.away) oddsMap[`ht away ${oc.ht_ah_adjacent.line}`] = oc.ht_ah_adjacent.away;
  }
  if (oc.ht_btts) {
    if (oc.ht_btts.yes) oddsMap['ht btts yes'] = oc.ht_btts.yes;
    if (oc.ht_btts.no) oddsMap['ht btts no'] = oc.ht_btts.no;
  }

  // Try to extract AI text from multiple response formats
  let aiText = '';

  if (typeof aiRawResponse === 'string') {
    aiText = aiRawResponse;
  } else if (typeof aiRawResponse === 'object' && aiRawResponse !== null) {
    const resp = aiRawResponse as Record<string, unknown>;

    // Anthropic format: content[].text
    if (Array.isArray(resp.content)) {
      const textBlock = (resp.content as Array<{ type: string; text?: string }>).find(
        (c) => c.type === 'text' && c.text,
      );
      if (textBlock?.text) aiText = textBlock.text;
    }
    // Gemini format: candidates[].content.parts[].text
    else if (Array.isArray(resp.candidates)) {
      const candidate = (resp.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }>)[0];
      const part = candidate?.content?.parts?.[0];
      if (part?.text) aiText = part.text;
    }
    // Direct fields
    else if (typeof resp.output_text === 'string') {
      aiText = resp.output_text;
    } else if (typeof resp.text === 'string') {
      aiText = resp.text;
    } else if (typeof resp.completion === 'string') {
      aiText = resp.completion;
    } else if (typeof resp.result === 'string') {
      aiText = resp.result;
    }
  }

  // Default empty result
  const defaultResult: ParsedAiResponse = {
    should_push: false,
    selection: '',
    bet_market: '',
    market_chosen_reason: '',
    confidence: 0,
    reasoning_en: 'AI response could not be parsed.',
    reasoning_vi: 'AI response could not be parsed.',
    warnings: ['PARSE_ERROR'],
    value_percent: 0,
    risk_level: 'HIGH',
    stake_percent: 0,
    custom_condition_matched: false,
    custom_condition_status: 'none',
    custom_condition_summary_en: '',
    custom_condition_summary_vi: '',
    custom_condition_reason_en: '',
    custom_condition_reason_vi: '',
    condition_triggered_suggestion: '',
    condition_triggered_reasoning_en: '',
    condition_triggered_reasoning_vi: '',
    condition_triggered_confidence: 0,
    condition_triggered_stake: 0,
    ai_should_push: false,
    system_should_bet: false,
    final_should_bet: false,
    ai_selection: '',
    ai_confidence: 0,
    ai_odd_raw: null,
    ai_warnings: [],
    usable_odd: null,
    mapped_odd: null,
    odds_for_display: null,
    condition_triggered_should_push: false,
  };

  if (!aiText) return defaultResult;

  // Extract JSON from text
  const jsonStr = extractJsonString(aiText);
  if (!jsonStr) return defaultResult;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { ...defaultResult, warnings: ['JSON_PARSE_ERROR'], reasoning_en: `Failed to parse JSON: ${jsonStr.substring(0, 200)}` };
  }

  // Extract core fields
  const aiSelection = String(parsed.selection || '');
  const betMarket = String(parsed.bet_market || '');
  const marketChosenReason = String(parsed.market_chosen_reason || '');
  let aiConfidence = toNumber(parsed.confidence) ?? 0;
  const reasoningEn = String(parsed.reasoning_en || '');
  const reasoningVi = String(parsed.reasoning_vi || '');
  const aiWarnings = Array.isArray(parsed.warnings)
    ? (parsed.warnings as string[]).map(String)
    : [];
  const valuePercent = toNumber(parsed.value_percent) ?? 0;
  const riskLevel = (['LOW', 'MEDIUM', 'HIGH'].includes(String(parsed.risk_level))
    ? String(parsed.risk_level)
    : 'HIGH') as 'LOW' | 'MEDIUM' | 'HIGH';
  const stakePercent = toNumber(parsed.stake_percent) ?? 0;

  // Normalize confidence (0-10 scale)
  if (aiConfidence > 10) {
    aiConfidence = Math.round(aiConfidence / 10);
  }

  // should_push from AI
  const aiShouldPush = parsed.should_push === true;

  // Map odds from selection
  const mappedOdd = extractOddsFromSelection(aiSelection, betMarket, oddsMap, oddsCanonical);
  const aiOddRaw = mappedOdd;

  // Safety checks
  const safetyWarnings: string[] = [];

  // NO_SELECTION: should_push=true but no selection
  if (aiShouldPush && !aiSelection) {
    safetyWarnings.push('NO_SELECTION');
  }

  // ODDS_INVALID: should_push=true but no valid odds
  if (aiShouldPush && mappedOdd === null && oddsAvailable) {
    safetyWarnings.push('ODDS_INVALID');
  }

  // NO_CONFIDENCE: confidence is 0
  if (aiShouldPush && aiConfidence === 0) {
    safetyWarnings.push('NO_CONFIDENCE');
  }

  // CONFIDENCE_BELOW_MIN
  if (aiShouldPush && aiConfidence < config.MIN_CONFIDENCE) {
    safetyWarnings.push('CONFIDENCE_BELOW_MIN');
  }

  // MINUTE_TOO_EARLY / MINUTE_TOO_LATE
  const minuteNum = toNumber(minute);
  if (minuteNum !== null) {
    if (minuteNum < 5) safetyWarnings.push('MINUTE_TOO_EARLY');
    if (minuteNum >= 90) safetyWarnings.push('MINUTE_TOO_LATE');
  }

  // 1X2_TOO_EARLY: business rule — no 1X2 bets before minute 35
  const bmLower = betMarket.toLowerCase();
  if (
    aiShouldPush
    && bmLower.includes('1x2')
    && !bmLower.startsWith('ht_')
    && minuteNum !== null
    && minuteNum < 35
  ) {
    safetyWarnings.push('1X2_TOO_EARLY');
  }

  // STATUS_NOT_LIVE
  if (!['1H', '2H'].includes(String(status))) {
    safetyWarnings.push('STATUS_NOT_LIVE');
  }

  // ODDS_NOT_AVAILABLE
  if (aiShouldPush && !oddsAvailable) {
    safetyWarnings.push('ODDS_NOT_AVAILABLE');
  }

  // Determine system should bet
  const hasBlockingSafety = safetyWarnings.some((w) =>
    ['NO_SELECTION', 'NO_CONFIDENCE', 'CONFIDENCE_BELOW_MIN', 'STATUS_NOT_LIVE', '1X2_TOO_EARLY'].includes(w),
  );
  const systemShouldBet = aiShouldPush && !hasBlockingSafety;

  // Usable odd
  const usableOdd = mappedOdd !== null && mappedOdd >= config.MIN_ODDS ? mappedOdd : null;
  const oddsForDisplay = usableOdd ?? mappedOdd ?? (aiShouldPush ? 'N/A' : null);

  // Final should bet
  const finalShouldBet = systemShouldBet && (usableOdd !== null || !oddsAvailable);

  // Custom condition fields
  const customConditionMatched = parsed.custom_condition_matched === true;
  const customConditionStatus = (['none', 'evaluated', 'parse_error'].includes(
    String(parsed.custom_condition_status),
  )
    ? String(parsed.custom_condition_status)
    : 'none') as 'none' | 'evaluated' | 'parse_error';
  const customConditionSummaryEn = String(parsed.custom_condition_summary_en || '');
  const customConditionSummaryVi = String(parsed.custom_condition_summary_vi || '');
  const customConditionReasonEn = String(parsed.custom_condition_reason_en || '');
  const customConditionReasonVi = String(parsed.custom_condition_reason_vi || '');

  // Condition-triggered fields
  const conditionTriggeredSuggestion = String(parsed.condition_triggered_suggestion || '');
  const conditionTriggeredReasoningEn = String(parsed.condition_triggered_reasoning_en || '');
  const conditionTriggeredReasoningVi = String(parsed.condition_triggered_reasoning_vi || '');
  const conditionTriggeredConfidence = toNumber(parsed.condition_triggered_confidence) ?? 0;
  const conditionTriggeredStake = toNumber(parsed.condition_triggered_stake) ?? 0;
  const conditionTriggeredShouldPush =
    customConditionMatched &&
    customConditionStatus === 'evaluated' &&
    conditionTriggeredConfidence >= config.MIN_CONFIDENCE &&
    !!conditionTriggeredSuggestion &&
    !conditionTriggeredSuggestion.toLowerCase().startsWith('no bet');

  return {
    should_push: finalShouldBet,
    selection: aiSelection,
    bet_market: betMarket,
    market_chosen_reason: marketChosenReason,
    confidence: aiConfidence,
    reasoning_en: reasoningEn,
    reasoning_vi: reasoningVi,
    warnings: [...aiWarnings, ...safetyWarnings],
    value_percent: valuePercent,
    risk_level: riskLevel,
    stake_percent: stakePercent,
    custom_condition_matched: customConditionMatched,
    custom_condition_status: customConditionStatus,
    custom_condition_summary_en: customConditionSummaryEn,
    custom_condition_summary_vi: customConditionSummaryVi,
    custom_condition_reason_en: customConditionReasonEn,
    custom_condition_reason_vi: customConditionReasonVi,
    condition_triggered_suggestion: conditionTriggeredSuggestion,
    condition_triggered_reasoning_en: conditionTriggeredReasoningEn,
    condition_triggered_reasoning_vi: conditionTriggeredReasoningVi,
    condition_triggered_confidence: conditionTriggeredConfidence,
    condition_triggered_stake: conditionTriggeredStake,
    ai_should_push: aiShouldPush,
    system_should_bet: systemShouldBet,
    final_should_bet: finalShouldBet,
    ai_selection: aiSelection,
    ai_confidence: aiConfidence,
    ai_odd_raw: aiOddRaw,
    ai_warnings: safetyWarnings,
    usable_odd: usableOdd,
    mapped_odd: mappedOdd,
    odds_for_display: oddsForDisplay,
    condition_triggered_should_push: conditionTriggeredShouldPush,
  };
}
