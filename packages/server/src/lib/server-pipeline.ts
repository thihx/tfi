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
import { sendTelegramMessage } from './telegram.js';
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
import * as matchRepo from '../repos/matches.repo.js';
import { createRecommendation, getRecommendationsByMatchId } from '../repos/recommendations.repo.js';

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
): DerivedInsights {
  const homeGoalsTimeline: number[] = [];
  const awayGoalsTimeline: number[] = [];
  let homeCards = 0, awayCards = 0, homeReds = 0, awayReds = 0;
  let homeSubs = 0, awaySubs = 0;
  let lastGoalMinute: number | null = null;
  const recentThreshold = Math.max(0, minute - 15);
  let homeRecent = 0, awayRecent = 0;

  for (const ev of events) {
    if (ev.type === 'goal') {
      // We don't know which is home/away from just the event here,
      // but we use the events as labeled by the team name
      lastGoalMinute = Math.max(lastGoalMinute ?? 0, ev.minute);
    }
    if (ev.type === 'card') {
      const isRed = ev.detail.toLowerCase().includes('red');
      // We'll count all cards together; home/away split handled at build time
      homeCards++; // simplified; full split done at match merge level
      if (isRed) homeReds++;
    }
    if (ev.type === 'subst') homeSubs++;
    if (ev.minute >= recentThreshold) homeRecent++;
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
          if (!oddsMap[key] || odd > oddsMap[key]) oddsMap[key] = odd;
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
          if (!oddsMap[key] || odd > oddsMap[key]) oddsMap[key] = odd;
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
          if (key && (!oddsMap[key] || odd > oddsMap[key])) oddsMap[key] = odd;
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

  return { canonical, available: true };
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

function parseAiResponse(aiText: string, oddsCanonical: OddsCanonical): ParsedAiResponse {
  const defaults: ParsedAiResponse = {
    should_push: false, selection: '', bet_market: '', confidence: 0,
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
  const MIN_ODDS = 1.5;
  const MIN_CONFIDENCE = 5;

  const safetyWarnings: string[] = [];
  if (aiShouldPush && !aiSelection) safetyWarnings.push('NO_SELECTION');
  if (aiShouldPush && mappedOdd === null) safetyWarnings.push('ODDS_INVALID');
  if (aiShouldPush && aiConfidence < MIN_CONFIDENCE) safetyWarnings.push('CONFIDENCE_BELOW_MIN');
  if (aiShouldPush && riskLevel === 'HIGH') safetyWarnings.push('HIGH_RISK');

  const hasBlocking = safetyWarnings.some((w) => ['NO_SELECTION', 'CONFIDENCE_BELOW_MIN'].includes(w));
  const systemShouldBet = aiShouldPush && !hasBlocking;
  const usableOdd = mappedOdd !== null && mappedOdd >= MIN_ODDS ? mappedOdd : null;
  const finalShouldPush = systemShouldBet && usableOdd !== null;

  return {
    should_push: finalShouldPush,
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

// ==================== Build Telegram Message ====================

function buildTelegramMessage(
  matchDisplay: string,
  league: string,
  score: string,
  minute: number | string,
  status: string,
  parsed: ParsedAiResponse,
): string {
  const emoji = parsed.should_push ? '🎯' : '📊';
  const label = parsed.should_push ? 'AI RECOMMENDATION' : 'MATCH ANALYSIS';

  let text = `<b>${emoji} ${label}</b>\n`;
  text += `<b>${safeHtml(matchDisplay)}</b>\n`;
  text += `${safeHtml(league)}\n`;
  text += `⏱ ${safeHtml(String(minute))}' | 📋 ${safeHtml(score)} | ${safeHtml(status)}\n\n`;

  if (parsed.should_push) {
    text += `<b>💡 Selection:</b> ${safeHtml(parsed.selection)}\n`;
    text += `<b>📊 Market:</b> ${safeHtml(parsed.bet_market)}\n`;
    text += `<b>🎯 Confidence:</b> ${parsed.confidence}/10\n`;
    text += `<b>💰 Stake:</b> ${parsed.stake_percent}%\n`;
    text += `<b>📈 Value:</b> ${parsed.value_percent}%\n`;
    text += `<b>⚡ Risk:</b> ${safeHtml(parsed.risk_level)}\n\n`;
  }

  text += `<b>📝 Analysis (EN):</b>\n${safeHtml(parsed.reasoning_en)}\n\n`;
  text += `<b>📝 Analysis (VI):</b>\n${safeHtml(parsed.reasoning_vi)}\n`;

  if (parsed.warnings.length > 0) {
    text += `\n⚠️ <b>Warnings:</b> ${safeHtml(parsed.warnings.join(', '))}\n`;
  }

  text += `\n<i>TFI Auto Pipeline | ${safeHtml(new Date().toISOString())}</i>`;
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
    const derivedInsights = deriveInsightsFromEvents(eventsCompact, minute);

    // 2. Fetch odds (live first, fallback to pre-match, then The Odds API)
    let oddsCanonical: OddsCanonical = {};
    let oddsAvailable = false;
    let oddsSource: string = 'none';

    const liveOdds = await fetchLiveOdds(matchId).catch(() => []);
    const liveResult = buildOddsCanonical(liveOdds);
    if (liveResult.available) {
      oddsCanonical = liveResult.canonical;
      oddsAvailable = true;
      oddsSource = 'live';
    }

    if (!oddsAvailable) {
      // Try pre-match odds
      const preMatchOdds = await fetchPreMatchOdds(matchId).catch(() => []);
      const preResult = buildOddsCanonical(preMatchOdds);
      if (preResult.available) {
        oddsCanonical = preResult.canonical;
        oddsAvailable = true;
        oddsSource = 'pre-match';
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

    const prompt = buildServerPrompt({
      homeName, awayName, league, minute, score, status,
      statsCompact, statsAvailable,
      eventsCompact: eventsCompact.slice(-8),
      oddsCanonical, oddsAvailable, oddsSource,
      derivedInsights: !statsAvailable ? derivedInsights : null,
      customConditions, recommendedCondition, recommendedConditionReason,
      currentTotalGoals: homeGoals + awayGoals,
      previousRecommendations: prevRecsContext,
      preMatchPredictionSummary: '',
      mode: watchlistEntry.mode || 'B',
    });

    // 5. Call Gemini
    const model = config.geminiModel;
    const aiText = await callGemini(prompt, model);

    // 6. Parse response
    const parsed = parseAiResponse(aiText, oddsCanonical);

    // 7. Save recommendation (always save for audit trail)
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
      bet_type: parsed.should_push ? 'AI' : 'NO_BET',
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

    // 8. Send Telegram notification (only for actionable recommendations)
    let notified = false;
    if (parsed.should_push && config.pipelineTelegramChatId) {
      try {
        const msg = buildTelegramMessage(matchDisplay, league, score, minute, status, parsed);
        // Chunk for Telegram's 4096 char limit
        const MAX_CHUNK = 3500;
        if (msg.length <= MAX_CHUNK) {
          await sendTelegramMessage(config.pipelineTelegramChatId, msg);
        } else {
          let remaining = msg;
          while (remaining.length > 0) {
            if (remaining.length <= MAX_CHUNK) {
              await sendTelegramMessage(config.pipelineTelegramChatId, remaining);
              break;
            }
            let breakIdx = remaining.lastIndexOf('\n', MAX_CHUNK);
            if (breakIdx <= 0) breakIdx = MAX_CHUNK;
            await sendTelegramMessage(config.pipelineTelegramChatId, remaining.substring(0, breakIdx));
            remaining = remaining.substring(breakIdx).replace(/^\n/, '');
          }
        }
        notified = true;
      } catch (e) {
        console.error(`[pipeline] Telegram notification failed for ${matchId}:`, e instanceof Error ? e.message : String(e));
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
        recId: rec.id, notified,
      },
    });

    return {
      matchId, success: true, shouldPush: parsed.should_push,
      selection: parsed.selection, confidence: parsed.confidence,
      saved: true, notified,
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

  console.log(`[pipeline] Processing batch of ${matchIds.length} matches: ${matchIds.join(', ')}`);

  // Fetch all fixtures in one API call
  const fixtures = await fetchFixturesByIds(matchIds);
  const fixtureMap = new Map(fixtures.map((f) => [String(f.fixture?.id), f]));

  // Get watchlist entries for metadata
  const watchlistEntries = await Promise.all(
    matchIds.map((id) => watchlistRepo.getWatchlistByMatchId(id)),
  );
  const watchlistMap = new Map<string, watchlistRepo.WatchlistRow>();
  for (let i = 0; i < matchIds.length; i++) {
    if (watchlistEntries[i]) watchlistMap.set(matchIds[i], watchlistEntries[i]!);
  }

  // Process matches sequentially to avoid API rate limits
  for (const matchId of matchIds) {
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

    const matchResult = await processMatch(matchId, fixture, wl);
    result.results.push(matchResult);
    result.processed++;
    if (!matchResult.success) result.errors++;

    // Small delay between matches to avoid rate limiting
    if (matchIds.indexOf(matchId) < matchIds.length - 1) {
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
  derivedInsights: DerivedInsights | null;
  customConditions: string;
  recommendedCondition: string;
  recommendedConditionReason: string;
  currentTotalGoals: number;
  previousRecommendations: Array<Record<string, unknown>>;
  preMatchPredictionSummary: string;
  mode: string;
}): string {
  const MIN_CONFIDENCE = 5;
  const MIN_ODDS = 1.5;
  const LATE_PHASE_MINUTE = 75;
  const VERY_LATE_PHASE_MINUTE = 85;
  const ENDGAME_MINUTE = 88;

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
${oddsWarnings ? `• ${oddsWarnings}` : ''}

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
CURRENT_TOTAL_GOALS: ${data.currentTotalGoals}
${data.oddsSource === 'pre-match' ? '\nThese are PRE-MATCH opening odds. Live odds unavailable. Use as reference.\n' : ''}

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
- Score 0-0 after minute 55: prefer Under markets.
- risk_level = HIGH → should_push = false.

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
