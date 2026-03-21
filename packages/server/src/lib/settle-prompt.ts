import { type SettlementResult, isSettlementResult } from './settle-types.js';

export interface SettlePromptMatchContext {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  finalStatus: string;
  settlementScope: 'regular_time';
  statistics?: Array<{ type: string; home: string | number | null; away: string | number | null }>;
}

export interface SettlePromptBet {
  id: number;
  market: string;
  selection: string;
  odds: number;
  stakePercent: number;
}

export interface ParsedSettleResult {
  id: number;
  result: SettlementResult;
  explanation: string;
}

export const SETTLE_PROMPT_VERSION = 'v1-strict-unresolved';

const MAX_EXPLANATION_LENGTH = 500;

export function buildSettlePrompt(
  match: SettlePromptMatchContext,
  bets: SettlePromptBet[],
): string {
  const score = `${match.homeScore}-${match.awayScore}`;
  const totalGoals = match.homeScore + match.awayScore;
  const statsSection = match.statistics && match.statistics.length > 0
    ? match.statistics.map(
      (s) => `- ${s.type}: ${s.home ?? '?'} (Home) - ${s.away ?? '?'} (Away)`,
    ).join('\n')
    : 'No detailed official statistics available.';
  const betsSection = bets.map((b, i) =>
    `${i + 1}. [ID: ${b.id}] Market="${b.market}" Selection="${b.selection}" Odds=${b.odds}`,
  ).join('\n');

  return `SETTLE_PROMPT_VERSION=${SETTLE_PROMPT_VERSION}
You are a soccer bet settlement engine for unsupported or stats-dependent markets only.
The deterministic settle engine has already resolved all standard markets it can trust.
Only decide the bets listed below.

MATCH CONTEXT:
${match.homeTeam} ${score} ${match.awayTeam}
Total goals: ${totalGoals}
Official final status: ${match.finalStatus || 'FT'}
Settlement scope: regular time only (90 minutes plus stoppage time). Extra time and penalties are excluded for standard soccer markets.
The score shown above is already the score to use for this settlement scope.

OFFICIAL MATCH STATISTICS:
${statsSection}

BETS TO RESOLVE:
${betsSection}

RULES:
- Only use official evidence from the score and official statistics shown above.
- If a market needs official statistics that are missing, return "unresolved". Missing data is NOT a push.
- Use "push" only when the actual outcome lands exactly on the bookmaker line.
- Do not infer corners or cards from goals, momentum, or narrative clues.
- If a cards market needs unclear weighting or missing official card data, return "unresolved".
- If the market is still too ambiguous even with the available official evidence, return "unresolved".
- Allowed results only: "win", "loss", "push", "half_win", "half_loss", "void", "unresolved".
- Return exactly ${bets.length} items, one per input bet, with the same IDs and no duplicates.
- Return JSON only. No markdown. No commentary outside JSON.

RESPONSE FORMAT:
[
  { "id": <bet_id>, "result": "<allowed_result>", "explanation": "<short Vietnamese explanation>" }
]`;
}

export function parseAISettleResponse(
  aiText: string,
  bets: SettlePromptBet[],
): ParsedSettleResult[] {
  const expectedIds = new Set(bets.map((b) => b.id));
  const jsonCandidate = extractJsonArray(aiText);
  if (!jsonCandidate) {
    console.error('[ai-settle] Cannot parse AI response as JSON array:', aiText.substring(0, 300));
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonCandidate);
  } catch (err) {
    console.error('[ai-settle] JSON parse error:', err instanceof Error ? err.message : err);
    return [];
  }

  if (!Array.isArray(parsed) || parsed.length !== bets.length) {
    console.error('[ai-settle] Invalid settle item count');
    return [];
  }

  const byId = new Map<number, ParsedSettleResult>();
  for (const item of parsed) {
    if (!isParsedSettleItem(item)) {
      console.error('[ai-settle] Invalid settle item shape');
      return [];
    }
    if (!expectedIds.has(item.id) || byId.has(item.id) || !isSettlementResult(item.result)) {
      console.error('[ai-settle] Invalid settle item id/result');
      return [];
    }

    byId.set(item.id, {
      id: item.id,
      result: item.result,
      explanation: item.explanation.trim().slice(0, MAX_EXPLANATION_LENGTH),
    });
  }

  if (byId.size !== expectedIds.size) {
    console.error('[ai-settle] Missing settle items');
    return [];
  }

  return bets.map((bet) => byId.get(bet.id)!);
}

function extractJsonArray(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    if (withoutFence.trim().startsWith('[')) return withoutFence.trim();
  }

  const match = trimmed.match(/\[[\s\S]*\]/);
  return match ? match[0] : null;
}

function isParsedSettleItem(
  value: unknown,
): value is { id: number; result: SettlementResult; explanation: string } {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return Number.isFinite(row.id)
    && typeof row.result === 'string'
    && typeof row.explanation === 'string'
    && row.explanation.trim().length > 0;
}
