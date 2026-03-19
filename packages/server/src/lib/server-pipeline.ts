// ============================================================
// Server-Side Pipeline — auto-triggered by check-live-trigger
// Ports the frontend pipeline logic to run server-side:
//   1. Fetch fixture data (stats, events, odds)
//   2. Build AI prompt
//   3. Call Gemini
//   4. Parse AI response
//   5. Save recommendation
//   6. Send Telegram notification
// ============================================================

import { config } from '../config.js';
import { callGemini } from './gemini.js';
import { sendTelegramMessage, sendTelegramPhoto } from './telegram.js';
import { audit } from './audit.js';
import {
  fetchFixturesByIds,
  fetchLiveOdds,
  fetchPreMatchOdds,
  fetchFixtureStatistics,
  fetchFixtureEvents,
  type ApiFixture,
  type ApiFixtureEvent,
  type ApiFixtureStat,
} from './football-api.js';
import { fetchTheOddsLive } from './the-odds-api.js';
import * as watchlistRepo from '../repos/watchlist.repo.js';
import { createRecommendation, getRecommendationsByMatchId } from '../repos/recommendations.repo.js';
import { getSettings } from '../repos/settings.repo.js';

/** Resolved pipeline settings: DB values take priority, env vars as fallback */
interface PipelineSettings {
  telegramChatId: string;
  aiModel: string;
  minConfidence: number;
  minOdds: number;
  latePhaseMinute: number;
  veryLatePhaseMinute: number;
  endgameMinute: number;
}

/** Parse a numeric setting from DB, falling back to envDefault if absent or NaN. */
function parseNumSetting(raw: unknown, envDefault: number): number {
  const n = Number(raw);
  return isFinite(n) && raw !== '' && raw !== null && raw !== undefined ? n : envDefault;
}

async function loadPipelineSettings(): Promise<PipelineSettings> {
  const db = await getSettings().catch(() => ({} as Record<string, unknown>));
  return {
    telegramChatId: String(db['TELEGRAM_CHAT_ID'] || '') || config.pipelineTelegramChatId,
    aiModel: String(db['AI_MODEL'] || '') || config.geminiModel,
    minConfidence: parseNumSetting(db['MIN_CONFIDENCE'], config.pipelineMinConfidence),
    minOdds: parseNumSetting(db['MIN_ODDS'], config.pipelineMinOdds),
    latePhaseMinute: parseNumSetting(db['LATE_PHASE_MINUTE'], config.pipelineLatePhaseMinute),
    veryLatePhaseMinute: parseNumSetting(db['VERY_LATE_PHASE_MINUTE'], config.pipelineVeryLatePhaseMinute),
    endgameMinute: parseNumSetting(db['ENDGAME_MINUTE'], config.pipelineEndgameMinute),
  };
}

// ==================== Types ====================

interface StatsCompact {
  possession: { home: string | null; away: string | null };
  shots: { home: string | null; away: string | null };
  shots_on_target: { home: string | null; away: string | null };
  corners: { home: string | null; away: string | null };
  fouls: { home: string | null; away: string | null };
  offsides: { home: string | null; away: string | null };
  yellow_cards: { home: string | null; away: string | null };
  red_cards: { home: string | null; away: string | null };
  goalkeeper_saves: { home: string | null; away: string | null };
  blocked_shots: { home: string | null; away: string | null };
  total_passes: { home: string | null; away: string | null };
  passes_accurate: { home: string | null; away: string | null };
}

interface EventCompact {
  minute: number;
  extra: number | null;
  team: string;
  type: string;
  detail: string;
  player: string;
}

interface OddsCanonical {
  '1x2'?: { home: number | null; draw: number | null; away: number | null };
  ou?: { line: number; over: number | null; under: number | null };
  ah?: { line: number; home: number | null; away: number | null };
  btts?: { yes: number | null; no: number | null };
  corners_ou?: { line: number; over: number | null; under: number | null };
}

interface DerivedInsights {
  goal_tempo: number;
  btts_status: boolean;
  home_goals_timeline: number[];
  away_goals_timeline: number[];
  last_goal_minute: number | null;
  total_cards: number;
  home_cards: number;
  away_cards: number;
  home_reds: number;
  away_reds: number;
  home_subs: number;
  away_subs: number;
  momentum: 'home' | 'away' | 'neutral';
  intensity: 'low' | 'medium' | 'high';
}

interface ParsedAiResponse {
  should_push: boolean;
  ai_should_push: boolean;
  selection: string;
  bet_market: string;
  confidence: number;
  reasoning_en: string;
  reasoning_vi: string;
  warnings: string[];
  value_percent: number;
  risk_level: string;
  stake_percent: number;
  condition_triggered_suggestion: string;
  custom_condition_matched: boolean;
}

interface MatchPipelineResult {
  matchId: string;
  success: boolean;
  shouldPush: boolean;
  selection: string;
  confidence: number;
  saved: boolean;
  notified: boolean;
  error?: string;
}

export interface PipelineResult {
  totalMatches: number;
  processed: number;
  errors: number;
  results: MatchPipelineResult[];
}

// ==================== Stat Helpers ====================

function getStatValue(
  teamStats: Array<{ type: string; value: string | number | null }>,
  statName: string,
): string | null {
  if (!Array.isArray(teamStats)) return null;
  const stat = teamStats.find((s) => s.type === statName);
  return stat?.value != null ? String(stat.value) : null;
}

function parseTwoSide(h: string | null, a: string | null): { home: string | null; away: string | null } {
  return { home: h ?? null, away: a ?? null };
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ==================== Derive Insights from Events ====================

function deriveInsightsFromEvents(
  events: EventCompact[],
  minute: number,
  homeName: string,
  awayName: string,
): DerivedInsights {
  const homeGoalsTimeline: number[] = [];
  const awayGoalsTimeline: number[] = [];
  let homeCards = 0, awayCards = 0, homeReds = 0, awayReds = 0;
  let homeSubs = 0, awaySubs = 0;
  let lastGoalMinute: number | null = null;
  const recentThreshold = Math.max(0, minute - 15);
  let homeRecent = 0, awayRecent = 0;

  for (const ev of events) {
    const isHome = ev.team === homeName;
    const isAway = ev.team === awayName;

    if (ev.type === 'goal') {
      lastGoalMinute = Math.max(lastGoalMinute ?? 0, ev.minute);
      if (isHome) homeGoalsTimeline.push(ev.minute);
      else if (isAway) awayGoalsTimeline.push(ev.minute);
    }
    if (ev.type === 'card') {
      const isRed = (ev.detail || '').toLowerCase().includes('red');
      if (isHome) { homeCards++; if (isRed) homeReds++; }
      else if (isAway) { awayCards++; if (isRed) awayReds++; }
    }
    if (ev.type === 'subst') {
      if (isHome) homeSubs++;
      else if (isAway) awaySubs++;
    }
    if (ev.minute >= recentThreshold) {
      if (isHome) homeRecent++;
      else if (isAway) awayRecent++;
    }
  }

  const totalCards = homeCards + awayCards;
  const totalGoals = homeGoalsTimeline.length + awayGoalsTimeline.length;
  const goalTempo = minute > 0 ? totalGoals / minute : 0;
  const eventsPerMinute = minute > 0 ? (totalGoals + totalCards) / minute : 0;
  const intensity: 'low' | 'medium' | 'high' = eventsPerMinute > 0.1 ? 'high' : eventsPerMinute > 0.05 ? 'medium' : 'low';
  const momentum: 'home' | 'away' | 'neutral' = homeRecent > awayRecent + 1 ? 'home' : awayRecent > homeRecent + 1 ? 'away' : 'neutral';

  return {
    goal_tempo: Math.round(goalTempo * 1000) / 1000,
    btts_status: homeGoalsTimeline.length > 0 && awayGoalsTimeline.length > 0,
    home_goals_timeline: homeGoalsTimeline,
    away_goals_timeline: awayGoalsTimeline,
    last_goal_minute: lastGoalMinute,
    total_cards: totalCards,
    home_cards: homeCards,
    away_cards: awayCards,
    home_reds: homeReds,
    away_reds: awayReds,
    home_subs: homeSubs,
    away_subs: awaySubs,
    momentum,
    intensity,
  };
}

// ==================== Build Stats Compact ====================

function buildStatsCompact(
  homeStats: Array<{ type: string; value: string | number | null }>,
  awayStats: Array<{ type: string; value: string | number | null }>,
): StatsCompact {
  const getStat = (name: string) => parseTwoSide(
    getStatValue(homeStats, name),
    getStatValue(awayStats, name),
  );
  return {
    possession: getStat('Ball Possession'),
    shots: getStat('Total Shots'),
    shots_on_target: getStat('Shots on Goal'),
    corners: getStat('Corner Kicks'),
    fouls: getStat('Fouls'),
    offsides: getStat('Offsides'),
    yellow_cards: getStat('Yellow Cards'),
    red_cards: getStat('Red Cards'),
    goalkeeper_saves: getStat('Goalkeeper Saves'),
    blocked_shots: getStat('Blocked Shots'),
    total_passes: getStat('Total passes'),
    passes_accurate: getStat('Passes accurate'),
  };
}

// ==================== Build Events Compact ====================

function buildEventsCompact(
  events: ApiFixtureEvent[],
  homeTeamId: number | undefined,
  awayTeamId: number | undefined,
  homeName: string,
  awayName: string,
): EventCompact[] {
  const sorted = [...events].sort((a, b) => (a.time?.elapsed || 0) - (b.time?.elapsed || 0));
  const compact: EventCompact[] = [];

  for (const ev of sorted) {
    const teamId = ev.team?.id;
    const sideName = teamId === homeTeamId ? homeName : teamId === awayTeamId ? awayName : (ev.team?.name || '');
    const type = ev.type || '';
    const detail = ev.detail || '';
    const minute = ev.time?.elapsed ?? 0;

    if (type === 'Goal') {
      compact.push({ minute, extra: ev.time?.extra ?? null, team: sideName, type: 'goal', detail, player: ev.player?.name || '' });
    }
    if (type === 'Card') {
      compact.push({ minute, extra: ev.time?.extra ?? null, team: sideName, type: 'card', detail, player: ev.player?.name || '' });
    }
    if (type === 'subst') {
      const playerIn = ev.assist?.name || '';
      const playerOut = ev.player?.name || '';
      compact.push({ minute, extra: ev.time?.extra ?? null, team: sideName, type: 'subst', detail: `${playerIn} for ${playerOut}`, player: playerIn });
    }
  }

  return compact;
}

// ==================== Build Odds Canonical ====================

function buildOddsCanonical(oddsResponse: unknown[]): { canonical: OddsCanonical; available: boolean } {
  if (!oddsResponse || !Array.isArray(oddsResponse) || oddsResponse.length === 0) {
    return { canonical: {}, available: false };
  }

  const resp = oddsResponse as Array<{ bookmakers?: Array<{ name: string; bets: Array<{ name: string; values: Array<{ value: string; odd: string; handicap?: string }> }> }> }>;
  const bookmakers = resp[0]?.bookmakers || [];
  if (bookmakers.length === 0) return { canonical: {}, available: false };

  const oddsMap: Record<string, number> = {};
  const best1X2 = { home: 0, draw: 0, away: 0 };
  const bestBTTS = { yes: 0, no: 0 };

  for (const bk of bookmakers) {
    for (const bet of bk.bets || []) {
      const betName = String(bet.name || '').toLowerCase();
      const values = bet.values || [];
      const isHalf = /1st half|2nd half|first half|second half|\bht\b|\b1h\b|\b2h\b|half.?time/i.test(betName);
      if (isHalf) continue;

      // 1X2
      if (betName.includes('1x2') || betName.includes('match winner') || betName.includes('fulltime result') || betName === 'full time result') {
        for (const v of values) {
          const label = String(v.value || '').toLowerCase().trim();
          const odd = toNumber(v.odd) ?? 0;
          if (!odd || odd <= 1) continue;
          if (label === 'home' || label === '1') best1X2.home = Math.max(best1X2.home, odd);
          if (label === 'draw' || label === 'x') best1X2.draw = Math.max(best1X2.draw, odd);
          if (label === 'away' || label === '2') best1X2.away = Math.max(best1X2.away, odd);
        }
      }

      // Over/Under
      if (betName.includes('over/under') || betName.includes('over / under') || betName.includes('total goals') || betName.includes('match goals')) {
        for (const v of values) {
          const raw = String(v.value || '').toLowerCase().trim();
          const hc = v.handicap ? String(v.handicap).trim() : '';
          const odd = toNumber(v.odd) ?? 0;
          if (!odd || odd <= 1) continue;
          let key: string;
          if (hc) {
            key = `${raw} ${hc}`;
          } else {
            const m = raw.match(/^(over|under)\s+([0-9]+(?:\.[0-9]+)?)$/);
            if (!m) continue;
            key = raw;
          }
          if (!(key in oddsMap) || odd > (oddsMap[key] ?? 0)) oddsMap[key] = odd;
        }
      }

      // BTTS
      if (betName.includes('both teams') || betName === 'btts') {
        for (const v of values) {
          const label = String(v.value || '').toLowerCase().trim();
          const odd = toNumber(v.odd) ?? 0;
          if (!odd || odd <= 1) continue;
          if (label === 'yes') bestBTTS.yes = Math.max(bestBTTS.yes, odd);
          if (label === 'no') bestBTTS.no = Math.max(bestBTTS.no, odd);
        }
      }

      // Asian Handicap
      if (betName.includes('handicap')) {
        for (const v of values) {
          let raw = String(v.value || '').toLowerCase().trim();
          const hc = v.handicap ? String(v.handicap).trim() : '';
          const odd = toNumber(v.odd) ?? 0;
          if (!odd || odd <= 1) continue;
          let key: string;
          if (hc) {
            if (raw === '1') raw = 'home';
            if (raw === '2') raw = 'away';
            key = `${raw} ${hc}`;
          } else {
            const m = raw.match(/^(home|away|1|2)\s+([-+]?[0-9]+(?:\.[0-9]+)?)$/);
            if (!m) continue;
            let side = m[1];
            if (side === '1') side = 'home';
            if (side === '2') side = 'away';
            key = `${side} ${m[2]}`;
          }
          if (!(key in oddsMap) || odd > (oddsMap[key] ?? 0)) oddsMap[key] = odd;
        }
      }

      // Corners
      if (betName.includes('corner')) {
        for (const v of values) {
          const raw = String(v.value || '').toLowerCase().trim();
          const hc = v.handicap ? String(v.handicap).trim() : '';
          const odd = toNumber(v.odd) ?? 0;
          if (!odd || odd <= 1) continue;
          let key: string | null = null;
          if (hc && (raw === 'over' || raw === 'under')) {
            key = `corners ${raw} ${hc}`;
          } else {
            const m = raw.match(/^(over|under)\s+([0-9]+(?:\.[0-9]+)?)$/);
            if (m) key = `corners ${m[1]} ${m[2]}`;
          }
          if (key && (!(key in oddsMap) || odd > (oddsMap[key] ?? 0))) oddsMap[key] = odd;
        }
      }
    }
  }

  const canonical: OddsCanonical = {};

  if (best1X2.home > 0 || best1X2.away > 0 || best1X2.draw > 0) {
    canonical['1x2'] = {
      home: best1X2.home || null,
      draw: best1X2.draw || null,
      away: best1X2.away || null,
    };
  }

  // Build main OU line
  canonical['ou'] = buildMainOU(oddsMap, /^(over|under)\s+[0-9]+(\.[0-9]+)?$/, /^(over|under)\s+([0-9]+(\.[0-9]+)?)/);
  // Corners OU
  canonical['corners_ou'] = buildMainOU(oddsMap, /^corners\s+(over|under)\s+[0-9]+(\.[0-9]+)?$/, /^corners\s+(over|under)\s+([0-9]+(\.[0-9]+)?)/);
  // AH
  canonical['ah'] = buildMainAH(oddsMap);
  // BTTS
  if (bestBTTS.yes > 0 || bestBTTS.no > 0) {
    canonical['btts'] = { yes: bestBTTS.yes || null, no: bestBTTS.no || null };
  }

  // Validate implied-probability margins — remove markets with unrealistic margins
  const ip = (o: number | null | undefined) => (o && o > 1 ? 1 / o : 0);

  if (canonical['1x2']) {
    const t = ip(canonical['1x2'].home) + ip(canonical['1x2'].draw) + ip(canonical['1x2'].away);
    if (t > 0 && (t < 0.90 || t > 1.20)) delete canonical['1x2'];
  }
  if (canonical['ou'] && canonical['ou'].over !== null && canonical['ou'].under !== null) {
    const t = ip(canonical['ou'].over) + ip(canonical['ou'].under);
    if (t > 0 && (t < 0.85 || t > 1.15)) delete canonical['ou'];
  }
  if (canonical['ah'] && canonical['ah'].home !== null && canonical['ah'].away !== null) {
    const t = ip(canonical['ah'].home) + ip(canonical['ah'].away);
    if (t > 0 && (t < 0.85 || t > 1.15)) delete canonical['ah'];
  }
  if (canonical['btts'] && canonical['btts'].yes !== null && canonical['btts'].no !== null) {
    const t = ip(canonical['btts'].yes) + ip(canonical['btts'].no);
    if (t > 0 && (t < 0.85 || t > 1.15)) delete canonical['btts'];
  }
  if (canonical['corners_ou'] && canonical['corners_ou'].over !== null && canonical['corners_ou'].under !== null) {
    const t = ip(canonical['corners_ou'].over) + ip(canonical['corners_ou'].under);
    if (t > 0 && (t < 0.85 || t > 1.15)) delete canonical['corners_ou'];
  }

  const hasAnyMarket = !!(canonical['1x2'] || canonical['ou'] || canonical['ah'] || canonical['btts'] || canonical['corners_ou']);
  return { canonical, available: hasAnyMarket };
}

function buildMainOU(
  oddsMap: Record<string, number>,
  regexKey: RegExp,
  regexParse: RegExp,
): { line: number; over: number | null; under: number | null } | undefined {
  const entries = Object.entries(oddsMap).filter(([k]) => regexKey.test(k));
  if (!entries.length) return undefined;

  const lineMap = new Map<string, Record<string, number>>();
  for (const [k, odd] of entries) {
    const m = k.match(regexParse);
    if (!m?.[1] || !m[2]) continue;
    const dir = m[1];
    const lineStr = m[2];
    if (!Number.isFinite(Number(lineStr))) continue;
    if (!lineMap.has(lineStr)) lineMap.set(lineStr, {});
    const entry = lineMap.get(lineStr)!;
    entry[dir] = Math.max(entry[dir] || 0, odd);
  }

  let bestLine: string | null = null;
  let bestSpread = Infinity;
  for (const [lineStr, data] of lineMap) {
    const o = data['over'];
    const u = data['under'];
    if (o && u) {
      const spread = Math.abs(o - u);
      if (spread < bestSpread) { bestSpread = spread; bestLine = lineStr; }
    }
  }
  if (!bestLine) {
    const sorted = Array.from(lineMap.keys()).map(Number).filter(Number.isFinite).sort((a, b) => Math.abs(a) - Math.abs(b));
    if (!sorted.length) return undefined;
    bestLine = String(sorted[0]);
  }
  const bestData = lineMap.get(bestLine) || {};
  return { line: Number(bestLine), over: bestData['over'] ?? null, under: bestData['under'] ?? null };
}

function buildMainAH(oddsMap: Record<string, number>): { line: number; home: number | null; away: number | null } | undefined {
  const entries = Object.entries(oddsMap).filter(([k]) => /^(home|away)\s+[-+]?[0-9]+(\.[0-9]+)?$/.test(k));
  if (!entries.length) return undefined;

  const lineMap = new Map<string, Record<string, number>>();
  for (const [k, odd] of entries) {
    const m = k.match(/^(home|away)\s+([-+]?[0-9]+(\.[0-9]+)?)/);
    if (!m?.[1] || !m[2]) continue;
    const lineStr = m[2];
    if (!Number.isFinite(Number(lineStr))) continue;
    if (!lineMap.has(lineStr)) lineMap.set(lineStr, {});
    lineMap.get(lineStr)![m[1]] = Math.max(lineMap.get(lineStr)![m[1]] || 0, odd);
  }

  let bestLine: string | null = null;
  let bestSpread = Infinity;
  for (const [lineStr, data] of lineMap) {
    if (data['home'] && data['away']) {
      const spread = Math.abs(data['home'] - data['away']);
      if (spread < bestSpread) { bestSpread = spread; bestLine = lineStr; }
    }
  }
  if (!bestLine) return undefined;
  const best = lineMap.get(bestLine) || {};
  return { line: Number(bestLine), home: best['home'] ?? null, away: best['away'] ?? null };
}

// ==================== Parse AI Response ====================

function extractJsonString(text: string): string {
  if (!text) return '';
  const jsonFence = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonFence?.[1]) return jsonFence[1].trim();
  const genericFence = text.match(/```\s*([\s\S]*?)```/);
  if (genericFence?.[1]) return genericFence[1].trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) return text.substring(firstBrace, lastBrace + 1);
  return text.trim();
}

function parseAiResponse(aiText: string, oddsCanonical: OddsCanonical, matchMinute = 0, pipelineSettings?: PipelineSettings): ParsedAiResponse {
  const defaults: ParsedAiResponse = {
    should_push: false, ai_should_push: false, selection: '', bet_market: '', confidence: 0,
    reasoning_en: 'AI response could not be parsed.', reasoning_vi: 'AI response could not be parsed.',
    warnings: ['PARSE_ERROR'], value_percent: 0, risk_level: 'HIGH', stake_percent: 0,
    condition_triggered_suggestion: '', custom_condition_matched: false,
  };
  if (!aiText) return defaults;

  const jsonStr = extractJsonString(aiText);
  if (!jsonStr) return defaults;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { ...defaults, warnings: ['JSON_PARSE_ERROR'] };
  }

  const aiSelection = String(parsed.selection || '');
  const betMarket = String(parsed.bet_market || '');
  let aiConfidence = toNumber(parsed.confidence) ?? 0;
  if (aiConfidence > 10) aiConfidence = Math.round(aiConfidence / 10);
  const reasoningEn = String(parsed.reasoning_en || '');
  const reasoningVi = String(parsed.reasoning_vi || '');
  const aiWarnings = Array.isArray(parsed.warnings) ? (parsed.warnings as string[]).map(String) : [];
  const valuePercent = toNumber(parsed.value_percent) ?? 0;
  const riskLevel = (['LOW', 'MEDIUM', 'HIGH'].includes(String(parsed.risk_level)) ? String(parsed.risk_level) : 'HIGH');
  const stakePercent = toNumber(parsed.stake_percent) ?? 0;
  const aiShouldPush = parsed.should_push === true;

  // Map odds from selection
  const mappedOdd = extractOddsFromSelection(aiSelection, oddsCanonical);
  const MIN_ODDS = pipelineSettings?.minOdds ?? config.pipelineMinOdds;
  const MIN_CONFIDENCE = pipelineSettings?.minConfidence ?? config.pipelineMinConfidence;

  const safetyWarnings: string[] = [];
  if (aiShouldPush && !aiSelection) safetyWarnings.push('NO_SELECTION');
  if (aiShouldPush && mappedOdd === null) safetyWarnings.push('ODDS_INVALID');
  if (aiShouldPush && aiConfidence < MIN_CONFIDENCE) safetyWarnings.push('CONFIDENCE_BELOW_MIN');
  if (aiShouldPush && riskLevel === 'HIGH') safetyWarnings.push('HIGH_RISK');

  // Business rule: no 1X2 before minute 35
  if (aiShouldPush && betMarket.toLowerCase().includes('1x2') && matchMinute < 35) {
    safetyWarnings.push('1X2_TOO_EARLY');
  }

  const hasBlocking = safetyWarnings.some((w) => ['NO_SELECTION', 'CONFIDENCE_BELOW_MIN', '1X2_TOO_EARLY'].includes(w));
  const systemShouldBet = aiShouldPush && !hasBlocking;
  const usableOdd = mappedOdd !== null && mappedOdd >= MIN_ODDS ? mappedOdd : null;
  const finalShouldPush = systemShouldBet && usableOdd !== null;

  return {
    should_push: finalShouldPush,
    ai_should_push: aiShouldPush,
    selection: aiSelection,
    bet_market: betMarket,
    confidence: aiConfidence,
    reasoning_en: reasoningEn,
    reasoning_vi: reasoningVi,
    warnings: [...aiWarnings, ...safetyWarnings],
    value_percent: valuePercent,
    risk_level: riskLevel,
    stake_percent: stakePercent,
    condition_triggered_suggestion: String(parsed.condition_triggered_suggestion || ''),
    custom_condition_matched: parsed.custom_condition_matched === true,
  };
}

function extractOddsFromSelection(selection: string, canonical: OddsCanonical): number | null {
  if (!selection) return null;
  const atMatch = selection.match(/@\s*([\d.]+)/);
  if (atMatch?.[1]) {
    const price = parseFloat(atMatch[1]);
    if (!isNaN(price) && price > 1) return price;
  }
  const oc = canonical;
  if (/home\s*win/i.test(selection) && oc['1x2']?.home) return oc['1x2'].home;
  if (/away\s*win/i.test(selection) && oc['1x2']?.away) return oc['1x2'].away;
  if (/\bdraw\b/i.test(selection) && oc['1x2']?.draw) return oc['1x2'].draw;
  if (/over/i.test(selection) && oc.ou?.over) return oc.ou.over;
  if (/under/i.test(selection) && oc.ou?.under) return oc.ou.under;
  if (/btts\s*yes/i.test(selection) && oc.btts?.yes) return oc.btts.yes;
  if (/btts\s*no/i.test(selection) && oc.btts?.no) return oc.btts.no;
  return null;
}

// ==================== Stats Chart (QuickChart.io) ====================

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const idx = text.lastIndexOf(' ', max - 1);
  return text.substring(0, idx > 0 ? idx : max) + '…';
}

function safeTruncateCaption(text: string, limit = 1020): string {
  if (text.length <= limit) return text;
  const idx = text.lastIndexOf('\n', limit);
  return text.substring(0, idx > 0 ? idx : limit);
}

function buildStatsChartUrl(stats: StatsCompact, homeName: string, awayName: string, minute: number | string): string {
  const n = (v: string | null): number => {
    if (v == null || v === '') return 0;
    const num = parseFloat(v.replace('%', ''));
    return isNaN(num) ? 0 : num;
  };

  const share = (h: number, a: number): [number, number] => {
    const total = h + a;
    if (total === 0) return [0, 0];
    return [Math.round(h / total * 100), Math.round(a / total * 100)];
  };

  const posH = n(stats.possession.home); const posA = n(stats.possession.away);
  const shoH = n(stats.shots.home);      const shoA = n(stats.shots.away);
  const sotH = n(stats.shots_on_target.home); const sotA = n(stats.shots_on_target.away);
  const corH = n(stats.corners.home);    const corA = n(stats.corners.away);
  const fouH = n(stats.fouls.home);      const fouA = n(stats.fouls.away);

  if (posH + posA + shoH + shoA + sotH + sotA + corH + corA + fouH + fouA === 0) return '';

  const [posHS, posAS] = posH + posA > 0 ? [posH, posA] : [0, 0];
  const [shoHS, shoAS] = share(shoH, shoA);
  const [sotHS, sotAS] = share(sotH, sotA);
  const [corHS, corAS] = share(corH, corA);
  const [fouHS, fouAS] = share(fouH, fouA);

  const trim = (s: string, max = 14) => s.length > max ? s.substring(0, max - 1) + '…' : s;

  const cfg = {
    type: 'horizontalBar',
    data: {
      labels: [
        `Poss (${posH}/${posA}%)`,
        `Shots (${shoH}/${shoA})`,
        `On Target (${sotH}/${sotA})`,
        `Corners (${corH}/${corA})`,
        `Fouls (${fouH}/${fouA})`,
      ],
      datasets: [
        { label: trim(homeName), backgroundColor: '#3b82f6', data: [posHS, shoHS, sotHS, corHS, fouHS] },
        { label: trim(awayName), backgroundColor: '#ef4444', data: [posAS, shoAS, sotAS, corAS, fouAS] },
      ],
    },
    options: {
      title: { display: true, text: `Live Stats — ${minute}'`, fontSize: 14 },
      legend: { position: 'bottom' },
      scales: {
        xAxes: [{ stacked: true, ticks: { min: 0, max: 100 } }],
        yAxes: [{ stacked: true }],
      },
    },
  };

  return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(cfg))}&w=500&h=240&bkg=white`;
}

/** Condensed caption for sendPhoto (max 1024 chars). Stats replaced by chart image. */
function buildTelegramCaption(
  matchDisplay: string, league: string, score: string, minute: number | string, status: string,
  parsed: ParsedAiResponse, eventsCompact: EventCompact[], model: string, mode: string,
): string {
  const isRec = parsed.should_push;
  const isCondition = parsed.custom_condition_matched;
  const emoji = isRec ? '🎯' : isCondition ? '⚡' : '📊';
  const label = isRec ? 'AI RECOMMENDATION' : isCondition ? 'CONDITION TRIGGERED' : 'MATCH ANALYSIS';

  const INTERNAL = new Set(['FORCE_MODE', 'EARLY_GAME_RISK']);

  let text = `<b>${emoji} ${label}</b>\n`;
  text += `<b>${safeHtml(matchDisplay)}</b>\n`;
  text += `${safeHtml(league)}\n`;
  text += `⏱ ${safeHtml(String(minute))}' | 📋 ${safeHtml(score)} | ${safeHtml(status)}\n`;
  text += `🤖 ${safeHtml(model)} | Mode: ${safeHtml(mode)}\n`;

  if (isRec) {
    text += `\n<b>💰 ${safeHtml(parsed.selection)}</b>\n`;
    text += `Confidence: ${parsed.confidence}/10 | Stake: ${parsed.stake_percent}% | Risk: ${safeHtml(parsed.risk_level)} | Value: ${parsed.value_percent}%\n`;
    const reasoning = parsed.reasoning_vi || parsed.reasoning_en;
    if (reasoning) text += `\n${safeHtml(truncateAtWord(reasoning, 280))}\n`;
  } else {
    const reasoning = parsed.reasoning_vi || parsed.reasoning_en;
    if (reasoning) text += `\n${safeHtml(truncateAtWord(reasoning, 200))}\n`;
  }

  // Key events — goals + cards only, case-insensitive, max 6
  const keyEvents = [...eventsCompact]
    .sort((a, b) => a.minute - b.minute)
    .filter((e) => { const t = e.type.toLowerCase(); return t === 'goal' || t === 'card'; })
    .slice(-6);
  if (keyEvents.length > 0) {
    text += '\n';
    for (const evt of keyEvents) {
      const icon = getEventIcon(evt.type, evt.detail);
      text += `${evt.minute}' ${icon} ${safeHtml(evt.team)} (${safeHtml(evt.detail)})\n`;
    }
  }

  // Warnings (concise, max 3)
  const displayWarnings = parsed.warnings.filter((w) => !INTERNAL.has(w)).slice(0, 3);
  if (displayWarnings.length > 0) {
    text += `\n⚠️ ${safeHtml(displayWarnings.join(' | '))}\n`;
  }

  // Footer last — safeTruncateCaption cuts at \n so this won't be mid-tag
  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  text += `\n<i>🤖 Auto Trigger | ${safeHtml(now)}</i>`;

  return safeTruncateCaption(text);
}

// ==================== Build Telegram Message ====================

function chunkMessage(text: string, maxLen = 3500): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    let idx = remaining.lastIndexOf('\n', maxLen);
    if (idx <= 0) idx = maxLen;
    chunks.push(remaining.substring(0, idx));
    remaining = remaining.substring(idx).replace(/^\n/, '');
  }
  return chunks;
}

function getEventIcon(type: string, detail: string): string {
  const t = type.toLowerCase();
  const d = detail.toLowerCase();
  if (t === 'goal') return d.includes('own') ? '⚽ OG' : d.includes('penalty') ? '⚽ P' : '⚽';
  if (t === 'card') return d.includes('red') || d.includes('second yellow') ? '🟥' : '🟨';
  if (t === 'subst') return '🔄';
  return '•';
}

function buildTelegramMessage(
  matchDisplay: string,
  league: string,
  score: string,
  minute: number | string,
  status: string,
  parsed: ParsedAiResponse,
  statsCompact: StatsCompact,
  statsAvailable: boolean,
  eventsCompact: EventCompact[],
  model: string,
  mode: string,
): string {
  const isRec = parsed.should_push;
  const isCondition = parsed.custom_condition_matched;

  const emoji = isRec ? '🎯' : isCondition ? '⚡' : '📊';
  const label = isRec ? 'AI RECOMMENDATION' : isCondition ? 'CONDITION TRIGGERED' : 'MATCH ANALYSIS';

  let text = `<b>${emoji} ${label}</b>\n`;
  text += `<b>${safeHtml(matchDisplay)}</b>\n`;
  text += `${safeHtml(league)}\n`;
  text += `⏱ ${safeHtml(String(minute))}' | 📋 ${safeHtml(score)} | ${safeHtml(status)}\n`;
  text += `🤖 ${safeHtml(model)} | Mode: ${safeHtml(mode)}\n`;
  text += '\n';

  if (isRec) {
    text += `<b>💰 Investment Idea</b>\n`;
    text += `Selection: <b>${safeHtml(parsed.selection)}</b>\n`;
    text += `Market: ${safeHtml(parsed.bet_market)}\n`;
    text += `Confidence: ${parsed.confidence}/10 | Stake: ${parsed.stake_percent}%\n`;
    text += `Value: ${parsed.value_percent}% | Risk: ${safeHtml(parsed.risk_level)}\n`;
    text += '\n';
    text += `<b>📝 Reasoning (EN):</b>\n${safeHtml(parsed.reasoning_en)}\n\n`;
    text += `<b>📝 Reasoning (VI):</b>\n${safeHtml(parsed.reasoning_vi)}\n`;
  } else {
    text += `<b>📝 Analysis (EN):</b>\n${safeHtml(parsed.reasoning_en)}\n\n`;
    text += `<b>📝 Analysis (VI):</b>\n${safeHtml(parsed.reasoning_vi)}\n`;
  }

  // Live Stats
  if (statsAvailable) {
    const statLines: string[] = [];
    for (const [key, val] of Object.entries(statsCompact)) {
      if (val && val.home != null && val.away != null && val.home !== '' && val.away !== '') {
        const label2 = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        statLines.push(`${label2}: ${val.home} - ${val.away}`);
      }
    }
    if (statLines.length > 0) {
      text += '\n<b>📊 Live Stats</b>\n' + statLines.join('\n') + '\n';
    }
  }

  // Events
  const recentEvents = eventsCompact.slice(-8);
  if (recentEvents.length > 0) {
    text += '\n<b>📋 Events</b>\n';
    for (const evt of recentEvents) {
      const icon = getEventIcon(evt.type, evt.detail);
      text += `${evt.minute}' ${icon} ${safeHtml(evt.team)} - ${safeHtml(evt.player)} (${safeHtml(evt.detail)})\n`;
    }
  }

  // Warnings
  if (parsed.warnings.length > 0) {
    text += `\n⚠️ <b>Warnings:</b> ${safeHtml(parsed.warnings.join(', '))}\n`;
  }

  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  text += `\n<i>🤖 Auto Trigger | ${safeHtml(now)}</i>`;
  return text;
}

function safeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ==================== Process Single Match ====================

async function processMatch(
  matchId: string,
  fixture: ApiFixture,
  watchlistEntry: watchlistRepo.WatchlistRow,
  settings: PipelineSettings,
): Promise<MatchPipelineResult> {
  const matchDisplay = `${fixture.teams?.home?.name || watchlistEntry.home_team} vs ${fixture.teams?.away?.name || watchlistEntry.away_team}`;

  try {
    const homeName = fixture.teams?.home?.name || watchlistEntry.home_team;
    const awayName = fixture.teams?.away?.name || watchlistEntry.away_team;
    const league = fixture.league?.name || watchlistEntry.league;
    const status = fixture.fixture?.status?.short || 'UNKNOWN';
    const minute = fixture.fixture?.status?.elapsed ?? 0;
    const homeGoals = fixture.goals?.home ?? 0;
    const awayGoals = fixture.goals?.away ?? 0;
    const score = `${homeGoals}-${awayGoals}`;
    const homeTeamId = fixture.teams?.home?.id;
    const awayTeamId = fixture.teams?.away?.id;

    // 1. Fetch stats + events in parallel
    const [statsRaw, eventsRaw] = await Promise.all([
      fetchFixtureStatistics(matchId).catch(() => [] as ApiFixtureStat[]),
      fetchFixtureEvents(matchId).catch(() => [] as ApiFixtureEvent[]),
    ]);

    const homeStats = statsRaw[0]?.statistics || [];
    const awayStats = statsRaw[1]?.statistics || [];
    const statsCompact = buildStatsCompact(homeStats, awayStats);
    const statsAvailable = homeStats.length > 0 || awayStats.length > 0;

    const eventsCompact = buildEventsCompact(eventsRaw, homeTeamId, awayTeamId, homeName, awayName);
    const derivedInsights = deriveInsightsFromEvents(eventsCompact, minute, homeName, awayName);

    // 2. Fetch odds (live first, fallback to pre-match, then The Odds API)
    let oddsCanonical: OddsCanonical = {};
    let oddsAvailable = false;
    let oddsSource: string = 'none';
    let oddsFetchedAt: string | null = null;

    const liveOdds = await fetchLiveOdds(matchId).catch(() => []);
    const liveResult = buildOddsCanonical(liveOdds);
    if (liveResult.available) {
      oddsCanonical = liveResult.canonical;
      oddsAvailable = true;
      oddsSource = 'live';
      oddsFetchedAt = new Date().toISOString();
    }

    if (!oddsAvailable) {
      // Try pre-match odds
      const preMatchOdds = await fetchPreMatchOdds(matchId).catch(() => []);
      const preResult = buildOddsCanonical(preMatchOdds);
      if (preResult.available) {
        oddsCanonical = preResult.canonical;
        oddsAvailable = true;
        oddsSource = 'pre-match';
        oddsFetchedAt = new Date().toISOString();
      }
    }

    if (!oddsAvailable) {
      // Try The Odds API fallback
      const kickoff = fixture.fixture?.timestamp;
      const theOddsResult = await fetchTheOddsLive(homeName, awayName, Number(matchId), kickoff).catch(() => null);
      if (theOddsResult && Array.isArray(theOddsResult.bookmakers) && theOddsResult.bookmakers.length > 0) {
        const fallback = buildOddsCanonical([theOddsResult]);
        if (fallback.available) {
          oddsCanonical = fallback.canonical;
          oddsAvailable = true;
          oddsSource = 'the-odds-api';
          oddsFetchedAt = new Date().toISOString();
        }
      }
    }

    // 3. Get previous recommendations for context
    const prevRecs = await getRecommendationsByMatchId(matchId).catch(() => []);
    const prevRecsContext = prevRecs.slice(0, 5).map((r) => ({
      minute: r.minute,
      selection: r.selection,
      bet_market: r.bet_market,
      confidence: r.confidence,
      odds: r.odds,
      result: r.result,
      reasoning: r.reasoning?.substring(0, 150),
    }));

    // 4. Build the prompt (using the same template as frontend)
    const customConditions = (watchlistEntry.custom_conditions || '').trim();
    const recommendedCondition = (watchlistEntry.recommended_custom_condition || '').trim();
    const recommendedConditionReason = (watchlistEntry.recommended_condition_reason || '').trim();
    const strategicContext = watchlistEntry.strategic_context as Record<string, string> | null;
    const prediction = watchlistEntry.prediction as Record<string, unknown> | null;

    const prompt = buildServerPrompt({
      homeName, awayName, league, minute, score, status,
      statsCompact, statsAvailable,
      eventsCompact: eventsCompact.slice(-8),
      oddsCanonical, oddsAvailable, oddsSource, oddsFetchedAt,
      derivedInsights: !statsAvailable ? derivedInsights : null,
      customConditions, recommendedCondition, recommendedConditionReason,
      strategicContext,
      prediction,
      currentTotalGoals: homeGoals + awayGoals,
      previousRecommendations: prevRecsContext,
      preMatchPredictionSummary: '',
      mode: watchlistEntry.mode || 'B',
    }, settings);

    // 5. Call Gemini
    const model = settings.aiModel;
    const aiText = await callGemini(prompt, model);

    // 6. Parse response
    const parsed = parseAiResponse(aiText, oddsCanonical, minute, settings);

    // 7. Save when AI recommends (raw intent) or custom condition matched
    const shouldSave = parsed.ai_should_push || parsed.custom_condition_matched;
    let saved = false;
    let recId: number | null = null;
    let notified = false;

    if (shouldSave) {
      const mappedOdd = extractOddsFromSelection(parsed.selection, oddsCanonical);
      const rec = await createRecommendation({
        match_id: matchId,
        timestamp: new Date().toISOString(),
        league,
        home_team: homeName,
        away_team: awayName,
        status,
        condition_triggered_suggestion: parsed.condition_triggered_suggestion,
        custom_condition_raw: customConditions,
        execution_id: `auto-pipeline-${Date.now()}`,
        odds_snapshot: oddsCanonical as Record<string, unknown>,
        stats_snapshot: statsCompact as unknown as Record<string, unknown>,
        pre_match_prediction_summary: '',
        custom_condition_matched: parsed.custom_condition_matched,
        minute,
        score,
        bet_type: parsed.ai_should_push ? 'AI' : 'NO_BET',
        selection: parsed.selection,
        odds: mappedOdd,
        confidence: parsed.confidence,
        value_percent: parsed.value_percent,
        risk_level: parsed.risk_level,
        stake_percent: parsed.stake_percent,
        reasoning: parsed.reasoning_en,
        key_factors: '',
        warnings: parsed.warnings.join(', '),
        ai_model: model,
        mode: watchlistEntry.mode || 'B',
        bet_market: parsed.bet_market,
        notified: '',
        notification_channels: '',
      });
      saved = true;
      recId = rec.id;

      // 8. Send Telegram notification (only for actionable recommendations)
      if (parsed.should_push && settings.telegramChatId) {
        try {
          const mode = watchlistEntry.mode || 'B';
          const chartUrl = statsAvailable ? buildStatsChartUrl(statsCompact, homeName, awayName, minute) : '';

          let photoSent = false;
          if (chartUrl) {
            try {
              const caption = buildTelegramCaption(
                matchDisplay, league, score, minute, status, parsed, eventsCompact, model, mode,
              );
              await sendTelegramPhoto(settings.telegramChatId, chartUrl, caption);
              photoSent = true;
            } catch {
              // QuickChart or Telegram photo failed — fall through to text
            }
          }

          if (!photoSent) {
            const msg = buildTelegramMessage(
              matchDisplay, league, score, minute, status, parsed,
              statsCompact, statsAvailable, eventsCompact, model, mode,
            );
            for (const chunk of chunkMessage(msg)) {
              await sendTelegramMessage(settings.telegramChatId, chunk);
            }
          }
          notified = true;
        } catch (e) {
          console.error(`[pipeline] Telegram notification failed for ${matchId}:`, e instanceof Error ? e.message : String(e));
        }
      }
    }

    audit({
      category: 'PIPELINE',
      action: 'PIPELINE_MATCH_ANALYZED',
      outcome: parsed.should_push ? 'SUCCESS' : 'SKIPPED',
      actor: 'auto-pipeline',
      metadata: {
        matchId, matchDisplay, selection: parsed.selection,
        confidence: parsed.confidence, shouldPush: parsed.should_push,
        saved, recId, notified,
      },
    });

    return {
      matchId, success: true, shouldPush: parsed.should_push,
      selection: parsed.selection, confidence: parsed.confidence,
      saved, notified,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[pipeline] Error processing match ${matchId}:`, errMsg);

    audit({
      category: 'PIPELINE',
      action: 'PIPELINE_MATCH_ERROR',
      outcome: 'FAILURE',
      actor: 'auto-pipeline',
      error: errMsg,
      metadata: { matchId },
    });

    return {
      matchId, success: false, shouldPush: false,
      selection: '', confidence: 0,
      saved: false, notified: false, error: errMsg,
    };
  }
}

// ==================== Run Pipeline for Batch ====================

/**
 * Run the AI analysis pipeline for a batch of live match IDs.
 * Called by check-live-trigger job when live matches are detected.
 */
export async function runPipelineBatch(matchIds: string[]): Promise<PipelineResult> {
  const result: PipelineResult = { totalMatches: matchIds.length, processed: 0, errors: 0, results: [] };
  if (matchIds.length === 0) return result;

  // Load settings from DB (user config saved via UI) with env fallback
  const settings = await loadPipelineSettings();
  console.log(`[pipeline] Processing batch of ${matchIds.length} matches: ${matchIds.join(', ')} (telegram: ${settings.telegramChatId ? 'YES' : 'NO'}, model: ${settings.aiModel})`);

  // Fetch all fixtures in one API call
  const fixtures = await fetchFixturesByIds(matchIds);
  const fixtureMap = new Map(fixtures.map((f) => [String(f.fixture?.id), f]));

  // Get watchlist entries for metadata
  const watchlistEntries = await Promise.all(
    matchIds.map((id) => watchlistRepo.getWatchlistByMatchId(id)),
  );
  const watchlistMap = new Map<string, watchlistRepo.WatchlistRow>();
  for (let i = 0; i < matchIds.length; i++) {
    const id = matchIds[i]!;
    if (watchlistEntries[i]) watchlistMap.set(id, watchlistEntries[i]!);
  }

  // Process matches sequentially to avoid API rate limits
  for (let i = 0; i < matchIds.length; i++) {
    const matchId = matchIds[i]!;
    const fixture = fixtureMap.get(matchId);
    const wl = watchlistMap.get(matchId);
    if (!fixture || !wl) {
      result.results.push({
        matchId, success: false, shouldPush: false,
        selection: '', confidence: 0, saved: false, notified: false,
        error: !fixture ? 'Fixture not found' : 'Watchlist entry not found',
      });
      result.errors++;
      continue;
    }

    const matchResult = await processMatch(matchId, fixture, wl, settings);
    result.results.push(matchResult);
    result.processed++;
    if (!matchResult.success) result.errors++;

    // Small delay between matches to avoid rate limiting
    if (i < matchIds.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return result;
}

// ==================== Build Server Prompt ====================
// Simplified version of the frontend's buildAiPrompt — same rules, same JSON output format

function buildServerPrompt(data: {
  homeName: string;
  awayName: string;
  league: string;
  minute: number;
  score: string;
  status: string;
  statsCompact: StatsCompact;
  statsAvailable: boolean;
  eventsCompact: EventCompact[];
  oddsCanonical: OddsCanonical;
  oddsAvailable: boolean;
  oddsSource: string;
  oddsFetchedAt: string | null;
  derivedInsights: DerivedInsights | null;
  customConditions: string;
  recommendedCondition: string;
  recommendedConditionReason: string;
  strategicContext: Record<string, string> | null;
  prediction: Record<string, unknown> | null;
  currentTotalGoals: number;
  previousRecommendations: Array<Record<string, unknown>>;
  preMatchPredictionSummary: string;
  mode: string;
}, settings: PipelineSettings): string {
  const MIN_CONFIDENCE = settings.minConfidence;
  const MIN_ODDS = settings.minOdds;
  const LATE_PHASE_MINUTE = settings.latePhaseMinute;
  const VERY_LATE_PHASE_MINUTE = settings.veryLatePhaseMinute;
  const ENDGAME_MINUTE = settings.endgameMinute;

  // Compute current total corners from stats_compact
  const cornersHome = parseInt(String(data.statsCompact?.corners?.home ?? ''), 10);
  const cornersAway = parseInt(String(data.statsCompact?.corners?.away ?? ''), 10);
  const currentTotalCorners = !isNaN(cornersHome) && !isNaN(cornersAway)
    ? cornersHome + cornersAway
    : 'unknown';

  // Check incomplete markets
  const incompleteMarkets: string[] = [];
  const oc = data.oddsCanonical;
  if (oc['1x2']) {
    if (oc['1x2'].home === null || oc['1x2'].draw === null || oc['1x2'].away === null) incompleteMarkets.push('1x2');
  }
  if (oc['ou']) {
    if (oc['ou'].line === null || oc['ou'].over === null || oc['ou'].under === null) incompleteMarkets.push('ou');
  }
  if (oc['ah']) {
    if (oc['ah'].line === null || oc['ah'].home === null || oc['ah'].away === null) incompleteMarkets.push('ah');
  }
  if (oc['btts']) {
    if (oc['btts'].yes === null || oc['btts'].no === null) incompleteMarkets.push('btts');
  }

  const oddsWarnings = incompleteMarkets.length > 0
    ? `WARNING: Incomplete odds data for markets: ${incompleteMarkets.join(', ')}. Do NOT recommend these markets.`
    : '';

  // Previous recommendations section
  let prevRecsSection = '';
  if (data.previousRecommendations.length > 0) {
    const lines = data.previousRecommendations.map((r, i) => {
      const resultStr = r.result ? ` | Result: ${r.result}` : '';
      return `  ${i + 1}. [Min ${r.minute ?? '?'}] ${r.selection || 'No selection'} (${r.bet_market || '?'}) | Conf: ${r.confidence ?? 0}/10 | Odds: ${r.odds ?? 'N/A'}${resultStr}`;
    });
    prevRecsSection = `
========================
PREVIOUS RECOMMENDATIONS FOR THIS MATCH (${data.previousRecommendations.length})
========================
${lines.join('\n')}

IMPORTANT: Reference previous recommendations. Do NOT repeat exact same selection + bet_market unless odds improved by >= 0.10 or minute advanced >= 5.
`;
  }

  // NOTE: This prompt uses the same rules as the frontend prompt (ai-prompt.service.ts).
  // The full ~900-line prompt is intentionally reused to ensure parity.
  return `
You are a professional live football investment insight analyst (not a gambler).
Your task is to analyze ONE live match and determine whether there is exactly ONE realistic, high-quality investment idea, or no idea at all. You must also evaluate a user-defined custom condition objectively.

============================================================
DEFINITIONS & THRESHOLDS (READ FIRST)
============================================================
LATE GAME THRESHOLDS:
- Late phase: minute >= ${LATE_PHASE_MINUTE}
- Very late phase: minute >= ${VERY_LATE_PHASE_MINUTE}
- Endgame: minute >= ${ENDGAME_MINUTE}

MINIMUM ACCEPTABLE ODDS: ${MIN_ODDS}
- NEVER recommend any market with price < ${MIN_ODDS}

BET_MARKET STANDARD VALUES:
- 1X2 markets: "1x2_home", "1x2_away", "1x2_draw"
- Over/Under goals: "over_0.5", "over_1.5", "over_2.5", "over_3.5", "over_4.5", "under_0.5", "under_1.5", "under_2.5", "under_3.5", "under_4.5"
- BTTS: "btts_yes", "btts_no"
- Asian Handicap: "ah_home_[line]", "ah_away_[line]"
- Corners: "corners_over_[line]", "corners_under_[line]"

SELECTION STANDARD FORMAT:
- 1X2: "Home Win @[odds]", "Away Win @[odds]", "Draw @[odds]"
- Over/Under: "Over [line] Goals @[odds]", "Under [line] Goals @[odds]"
- BTTS: "BTTS Yes @[odds]", "BTTS No @[odds]"
- Asian Handicap: "Home [line] @[odds]", "Away [line] @[odds]"
- Corners: "Corners Over [line] @[odds]", "Corners Under [line] @[odds]"
- FORBIDDEN: Do NOT add team names in selection.

VALUE PERCENT CALCULATION:
- value_percent = estimated edge over market price. Range: -50 to +100.

MARKET RESTRICTIONS (READ BEFORE VIEWING ODDS DATA):
${oddsWarnings ? `• ${oddsWarnings}` : '• No restrictions — all available markets have complete odds data.'}
- Do NOT recommend 1X2 markets before minute 35 (too early, game state can change completely).
- Do NOT recommend any market with price < ${MIN_ODDS}.

${buildStrategicContextSection(data.strategicContext)}
========================
MATCH CONTEXT
========================
- Match: ${data.homeName} vs ${data.awayName}
- League: ${data.league}
- Minute: ${data.minute}
- Score: ${data.score}
- Status: ${data.status}
- Force Analyze: NO (auto-pipeline)
- Is Manual Push: NO

========================
LIVE STATS (COMPACT JSON)
========================
${JSON.stringify(data.statsCompact)}

STATS_AVAILABLE: ${data.statsAvailable}
${!data.statsAvailable && data.derivedInsights ? `
========================
DERIVED INSIGHTS (FROM EVENTS)
========================
${JSON.stringify(data.derivedInsights)}
These insights are DERIVED from match events. Reduce confidence by 1 compared to full stats.
` : ''}
========================
${data.oddsSource === 'pre-match' ? 'PRE-MATCH ODDS (REFERENCE ONLY)' : data.oddsSource === 'the-odds-api' ? 'LIVE ODDS (The Odds API fallback)' : 'LIVE ODDS SNAPSHOT (CANONICAL JSON)'}
========================
${JSON.stringify(data.oddsCanonical)}

ODDS_AVAILABLE: ${data.oddsAvailable}
ODDS_SOURCE: ${data.oddsSource}
ODDS_FETCHED_AT: ${data.oddsFetchedAt ?? 'unknown'} (match minute at fetch: ${data.minute})
CURRENT_TOTAL_GOALS: ${data.currentTotalGoals}
CURRENT_TOTAL_CORNERS: ${currentTotalCorners}
${data.oddsSource === 'pre-match' ? '\nCAUTION: These are PRE-MATCH opening odds fetched before kickoff. They do NOT reflect current in-play situation. Use only as directional reference — do NOT base stake/confidence on these odds alone.\n' : ''}${data.oddsSource === 'the-odds-api' ? '\nNOTE: These odds are from The Odds API (fallback). They may have slight delay vs Football API live odds.\n' : ''}
ODDS METHODOLOGY:
- Odds are the BEST available across multiple bookmakers (highest price per outcome).
- Markets with invalid implied-probability margins have been PRE-REMOVED by the system.
- If a market is present in the canonical data, it has PASSED margin validation and is RELIABLE.
- Focus your analysis on the markets that ARE present. Do not infer missing markets.

${buildPreMatchPredictionSection(data.prediction, data.preMatchPredictionSummary)}
========================
RECENT EVENTS (LAST 8)
========================
${JSON.stringify(data.eventsCompact)}

${prevRecsSection}
========================
CONFIG / MODE
========================
- MIN_CONFIDENCE: ${MIN_CONFIDENCE}
- MIN_ODDS: ${MIN_ODDS}
- CUSTOM_CONDITIONS: ${data.customConditions || '(none)'}

========================
AI-RECOMMENDED CONDITION
========================
RECOMMENDED_CONDITION: ${data.recommendedCondition || '(none)'}
RECOMMENDED_CONDITION_REASON: ${data.recommendedConditionReason || '(none)'}

============================================================
PRE-MATCH PREDICTION RULES
============================================================
- Pre-match data is contextual only.
- Must NEVER override live evidence.

WHEN TO USE PRE-MATCH DATA:
- When live stats are sparse but pre-match aligns with observed play style.
- When detecting market overreaction (e.g., strong favourite concedes early → odds swing excessively).
- As supporting evidence when live play confirms pre-match expectations.
- H2H_SUMMARY: If one team dominates H2H (3+ wins in last 5), factor this into 1X2 assessment.
- TEAM_FORM_SEQUENCE: Recent WDLWW pattern reveals momentum — weight recent matches more.

WHEN TO IGNORE PRE-MATCH DATA:
- When live evidence clearly contradicts pre-match expectation.
- When the match situation has fundamentally changed (red cards, injuries, tactical shifts).

WEIGHT: Pre-match should contribute maximum 20% to your reasoning when used.
WEIGHT: Strategic context (motivation, rotation, congestion) can add up to 10% additional weight.

============================================================
GLOBAL RULES
============================================================
- Status 1H or 2H = LIVE → normal analysis.
- Status HT: max confidence 7, max stake 4%.
- Status NS/FT/PST/CANC: should_push = false.

DATA RULES:
- STATS + ODDS available: may recommend if all rules pass.
- STATS only (no odds): should_push = false normally, exception only if extremely clear.
- NO STATS but DERIVED INSIGHTS present: may recommend with confidence cap 7.
- NO STATS and no events: should_push = false normally.

LATE GAME DISCIPLINE:
- minute >= ${LATE_PHASE_MINUTE}: be more conservative.
- minute >= ${VERY_LATE_PHASE_MINUTE}: exceptional circumstances only.
- minute >= ${ENDGAME_MINUTE}: default should_push = false, max stake 2%.

RED CARD PROTOCOL:
- Scan events for red cards. If found: add warning, reduce confidence by 1, re-evaluate.

MARKET SELECTION:
- 1X2 and BTTS No require confidence >= 7 AND significant stat gaps AND pre-match support.
- If not met, evaluate Over/Under instead.
- Historical data: 1x2_home worst market (35.6% win rate), 1x2_draw near-ban (30.3%).
- Odds >= 2.50: confidence cap 6, stake cap 3%.
- Before minute 30: early game caution, 1X2 should_push=false before minute 35.
- Over 3.5+: need current goals >= line-1 or clearly open match.
- CORNERS O/U: MUST calculate cornerTempoSoFar, cornersNeeded, cornersPerMinuteNeeded.
  - If cornersPerMinuteNeeded > cornerTempoSoFar × 1.5 → should_push = false.
  - If cornersNeeded >= 3 AND minutesRemaining <= 20 → should_push = false.
  - After minute 75: Corners Over requires cornersNeeded <= 1.
  - After minute 80: should_push = false for any Corners Over.
- Score 0-0 after minute 55: prefer GOALS Under markets (under_2.5, under_1.5). NOT corners_under.
- risk_level = HIGH → should_push = false.

BTTS RULES (DATA-DRIVEN):
- BTTS YES: 54.5% win rate but PnL -4.55 (break-even trap at avg odds ~1.83).
  - MANDATORY: Calculate break_even_rate = 1/odds. Estimated probability must exceed break_even_rate + 5%.
  - Odds >= 2.00 for BTTS Yes → should_push = false unless BOTH teams have shots_on_target >= 2.
  - "Pressure ≠ Goals": Need evidence BOTH teams are dangerous. If weaker team has 0 SOT → no BTTS Yes.
  - Score 0-0 after minute 60: reduce confidence by 2 for BTTS Yes, prefer Under.
- BTTS NO: 55.5% win rate but PnL -39.46 (worst BTTS market, odds too low).
  - Requires odds >= 1.70 (below = mathematically unprofitable).
  - If BOTH teams have shots_on_target >= 2 → should_push = false for BTTS No.
  - Only justified: score gap >= 2, OR minute >= 70 + one team has 0 SOT, OR minute >= 75 + clean sheet.

BREAK-EVEN CHECK (MANDATORY FOR ALL):
- Before recommending ANY market: break_even_rate = 1/odds × 100.
- Estimated probability must exceed break_even_rate by >= 3% (edge >= 3%).
- If edge < 3% → should_push = false.
- MUST include EXACT text in reasoning_en: "Break-even: X%, My estimate: Y%, Edge: Z%" — NON-NEGOTIABLE.
- Reference: confidence 5→40%, 6→50.2%, 7→51.2%, 8→57.1% actual win rates.

ODDS RULES:
- Treat odds exactly as provided, no adjustments.
- Suspicious odds (contradicting match dynamics) → treat as unreliable → should_push = false normally.
- Price < ${MIN_ODDS} → should_push = false.

STAKE GUIDELINES:
- confidence 8-10: stake 5-8%
- confidence 6-7: stake 3-5%
- confidence 5: stake 2-3%
- confidence < 5: should_push = false, stake = 0

============================================================
CUSTOM CONDITIONS (INDEPENDENT EVALUATION)
============================================================
should_push = your investment recommendation.
custom_condition_matched = whether user's condition pattern is detected (factual check).
These are TWO SEPARATE decisions.

When custom_condition_matched = true, provide:
- condition_triggered_suggestion (bet or "No bet - reason")
- condition_triggered_reasoning_en/vi
- condition_triggered_confidence, condition_triggered_stake

============================================================
OUTPUT FORMAT — STRICT JSON
============================================================
{
  "should_push": boolean,
  "selection": string,
  "bet_market": string,
  "market_chosen_reason": string,
  "confidence": number,
  "reasoning_en": string,
  "reasoning_vi": string,
  "warnings": string[],
  "value_percent": number,
  "risk_level": "LOW" | "MEDIUM" | "HIGH",
  "stake_percent": number,
  "custom_condition_matched": boolean,
  "custom_condition_status": "none" | "evaluated" | "parse_error",
  "custom_condition_summary_en": string,
  "custom_condition_summary_vi": string,
  "custom_condition_reason_en": string,
  "custom_condition_reason_vi": string,
  "condition_triggered_suggestion": string,
  "condition_triggered_reasoning_en": string,
  "condition_triggered_reasoning_vi": string,
  "condition_triggered_confidence": number,
  "condition_triggered_stake": number
}

ALL fields must exist. selection="" when should_push=false. bet_market="" when should_push=false.
The FIRST character MUST be "{" and the LAST must be "}".
NO markdown, NO code fences, NO commentary outside JSON.
`;
}

// ==================== Strategic Context Section ====================

function buildStrategicContextSection(strategicContext: Record<string, string> | null): string {
  if (!strategicContext || typeof strategicContext !== 'object') return '';
  const ctx = strategicContext;
  const hasData = ctx.summary && ctx.summary !== 'No data found';
  if (!hasData) return '';

  const lines: string[] = [];
  lines.push('========================');
  lines.push('STRATEGIC CONTEXT (FROM PRE-MATCH RESEARCH)');
  lines.push('========================');
  if (ctx.home_motivation && ctx.home_motivation !== 'No data found')
    lines.push(`HOME_MOTIVATION: ${ctx.home_motivation}`);
  if (ctx.away_motivation && ctx.away_motivation !== 'No data found')
    lines.push(`AWAY_MOTIVATION: ${ctx.away_motivation}`);
  if (ctx.league_positions && ctx.league_positions !== 'No data found')
    lines.push(`LEAGUE_POSITIONS: ${ctx.league_positions}`);
  if (ctx.fixture_congestion && ctx.fixture_congestion !== 'No data found')
    lines.push(`FIXTURE_CONGESTION: ${ctx.fixture_congestion}`);
  if (ctx.rotation_risk && ctx.rotation_risk !== 'No data found')
    lines.push(`ROTATION_RISK: ${ctx.rotation_risk}`);
  if (ctx.key_absences && ctx.key_absences !== 'No data found')
    lines.push(`KEY_ABSENCES: ${ctx.key_absences}`);
  if (ctx.h2h_narrative && ctx.h2h_narrative !== 'No data found')
    lines.push(`H2H_NARRATIVE: ${ctx.h2h_narrative}`);
  if (ctx.competition_type && ctx.competition_type !== 'No data found')
    lines.push(`COMPETITION_TYPE: ${ctx.competition_type}`);
  lines.push(`SUMMARY: ${ctx.summary}`);
  lines.push('');
  lines.push('STRATEGIC CONTEXT RULES:');
  lines.push('- COMPETITION_TYPE: For european/international/friendly competitions, teams are from DIFFERENT domestic leagues. LEAGUE_POSITIONS CANNOT be compared across leagues — IGNORE position gap signals.');
  lines.push('- LEAGUE_POSITIONS: ONLY for domestic_league matches: Top 3 vs bottom 3 = strong favourite signal. Within 3 places = evenly matched → AVOID 1X2, prefer O/U or BTTS.');
  lines.push('- ROTATION: If team likely rotates key players, reduce confidence for that team winning by 1-2.');
  lines.push('- NOTHING TO PLAY FOR: Expect lower intensity → favors Under, Draw.');
  lines.push('- TITLE RACE / RELEGATION BATTLE: Expect high intensity → supports attacking.');
  lines.push('- FIXTURE_CONGESTION within 3 days of major match significantly increases rotation risk.');
  lines.push('- KEY_ABSENCES of star players should reduce expected goals for that team.');
  lines.push('');

  return lines.join('\n');
}

// ==================== Pre-Match Prediction Section ====================

function buildPreMatchPredictionSection(prediction: Record<string, unknown> | null, summary: string): string {
  if (!prediction && !summary) return '';

  const lines: string[] = [];
  lines.push('========================');
  lines.push('PRE-MATCH PREDICTION (OPTIONAL)');
  lines.push('========================');

  if (prediction && typeof prediction === 'object') {
    const pmPred = (prediction as Record<string, Record<string, unknown>>).predictions || {};
    const pmComp = (prediction as Record<string, Record<string, unknown>>).comparison || {};

    const compact: Record<string, unknown> = {
      pre_favourite: (pmPred.winner as Record<string, unknown>)?.name || null,
      pre_win_or_draw: pmPred.win_or_draw ?? null,
      pre_handicap_home: (pmPred.goals as Record<string, unknown>)?.home ?? null,
      pre_handicap_away: (pmPred.goals as Record<string, unknown>)?.away ?? null,
      pre_percent: pmPred.percent || null,
      pre_form: (pmComp.form as Record<string, unknown>) || null,
      pre_total_rating: (pmComp.total as Record<string, unknown>) || null,
    };

    lines.push(JSON.stringify(compact));

    const h2hSummary = prediction.h2h_summary;
    if (h2hSummary) lines.push(`H2H_SUMMARY: ${JSON.stringify(h2hSummary)}`);

    const teamForm = prediction.team_form;
    if (teamForm) lines.push(`TEAM_FORM_SEQUENCE: ${JSON.stringify(teamForm)}`);
  } else {
    lines.push(summary || 'No pre-match prediction available.');
  }

  lines.push('');
  return lines.join('\n');
}
