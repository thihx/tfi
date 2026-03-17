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
import { buildAiPrompt } from './ai-prompt.service';
import { runAiAnalysis } from './proxy.service';

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

/**
 * Extract odds value from AI selection text + odds maps.
 * 3-method extraction exactly like n8n node.
 */
function extractOddsFromSelection(
  selection: string,
  oddsMap: Record<string, number>,
  oddsCanonical: OddsCanonical,
): number | null {
  if (!selection) return null;

  // Method 1: Extract @ price from selection text (e.g., "Home Win @2.10")
  const atMatch = selection.match(/@\s*([\d.]+)/);
  if (atMatch?.[1]) {
    const price = parseFloat(atMatch[1]);
    if (!isNaN(price) && price > 1) return price;
  }

  // Method 2: Direct oddsMap lookup
  const selLower = selection.toLowerCase().trim();
  if (oddsMap[selLower] !== undefined) return oddsMap[selLower];

  // Partial key matching
  for (const [key, value] of Object.entries(oddsMap)) {
    if (selLower.includes(key) || key.includes(selLower)) return value;
  }

  // Method 3: Canonical market detection
  const oc = oddsCanonical;

  // 1X2
  if (/home\s*win/i.test(selection) && oc['1x2']?.home) return oc['1x2'].home;
  if (/away\s*win/i.test(selection) && oc['1x2']?.away) return oc['1x2'].away;
  if (/\bdraw\b/i.test(selection) && oc['1x2']?.draw) return oc['1x2'].draw;

  // O/U
  if (/over/i.test(selection) && oc.ou?.over) return oc.ou.over;
  if (/under/i.test(selection) && oc.ou?.under) return oc.ou.under;

  // BTTS
  if (/btts\s*yes/i.test(selection) && oc.btts?.yes) return oc.btts.yes;
  if (/btts\s*no/i.test(selection) && oc.btts?.no) return oc.btts.no;

  // AH
  if (/home.*[+-]?\d/i.test(selection) && oc.ah?.home) return oc.ah.home;
  if (/away.*[+-]?\d/i.test(selection) && oc.ah?.away) return oc.ah.away;

  // Corners
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
  context?: AiPromptContext,
): Promise<string> {
  const prompt = buildAiPrompt(matchData, context);
  const provider = monitorConfig.AI_PROVIDER;
  const model = monitorConfig.AI_MODEL;
  return runAiAnalysis(appConfig, prompt, provider, model);
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
  if (oc.ah) {
    if (oc.ah.home) oddsMap[`home ${oc.ah.line}`] = oc.ah.home;
    if (oc.ah.away) oddsMap[`away ${oc.ah.line}`] = oc.ah.away;
  }
  if (oc.btts) {
    if (oc.btts.yes) oddsMap['btts yes'] = oc.btts.yes;
    if (oc.btts.no) oddsMap['btts no'] = oc.btts.no;
  }
  if (oc.corners_ou) {
    if (oc.corners_ou.over) oddsMap[`corners over ${oc.corners_ou.line}`] = oc.corners_ou.over;
    if (oc.corners_ou.under) oddsMap[`corners under ${oc.corners_ou.line}`] = oc.corners_ou.under;
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
  const mappedOdd = extractOddsFromSelection(aiSelection, oddsMap, oddsCanonical);
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
  if (aiShouldPush && betMarket.toLowerCase().includes('1x2') && minuteNum !== null && minuteNum < 35) {
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
